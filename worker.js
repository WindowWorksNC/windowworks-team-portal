// Window Works Call Coach Worker
//
// Routes (all JSON unless noted, all require the X-WW-Key header except
// the signed audio route):
//   GET    /me                          who am I, role, rep visibility
//   GET    /settings                    coach only
//   POST   /settings                    coach only, {repVisibility: bool}
//   POST   /uploads                     start upload {customer, appointmentDate, filename, contentType, size}
//   PUT    /uploads/:id/parts/:n?uploadId=   raw bytes of one part
//   POST   /uploads/:id/complete        {uploadId, parts: [{partNumber, etag}]}
//   POST   /uploads/:id/abort           {uploadId}
//   GET    /calls?from=&to=&rep=        list summaries (reps: own only, when enabled)
//   GET    /calls/:id                   summary, scorecard, transcript
//   POST   /calls/:id/audio-link        coach only, short-lived playback URL
//   GET    /calls/:id/audio?exp=&sig=   signed audio stream (no key header)
//   POST   /calls/:id/rescore           coach only, {override: bool}
//   DELETE /calls/:id                   coach only, removes audio and results
//
// Storage layout in the CALLS bucket:
//   audio/<id>.<ext>             customer audio (90 day lifecycle)
//   calls/<id>/meta.json         call record
//   calls/<id>/transcript.json   cached transcript (scoring retries reuse it)
//   calls/<id>/scorecard.json    full scorecard
//   index/<id>                   empty object, summary in customMetadata for fast listing
//   config/settings.json         {repVisibility}

// ===== RUBRIC (edit this section to change scoring) =====

// Scoring rubric for in-home appointments.
//
// PILOT NOTE: the steps below are a placeholder skeleton. Replace the names,
// "lookFor" descriptions, and weights with the steps from the Top Rep
// workbook so the scorecard matches the process reps are trained on.
// The disclosure check is separate from the steps and gates scoring.

const RUBRIC = {
  company:
    "Window Works, a residential window and door replacement company serving the Raleigh-Durham Triangle",
  appointmentType: "an in-home sales appointment with a homeowner",

  disclosure: {
    lookFor:
      "Near the start of the appointment, the rep tells the customer they are using a notetaker or recording to keep track of the conversation, and gives the customer a chance to object. Any clear wording counts. It also counts if the customer clearly acknowledges it (for example, 'sure, record away').",
  },

  steps: [
    {
      id: "rapport_agenda",
      name: "Rapport and agenda",
      weight: 10,
      lookFor:
        "Builds genuine rapport, then sets a clear agenda for the visit so the customer knows what will happen and how long it takes.",
    },
    {
      id: "discovery",
      name: "Discovery",
      weight: 20,
      lookFor:
        "Uncovers why they are replacing now, problems with current windows or doors, priorities (energy, noise, looks, maintenance), timeline, budget expectations, and who else is involved in the decision.",
    },
    {
      id: "walkthrough",
      name: "Home walkthrough",
      weight: 10,
      lookFor:
        "Inspects and measures with the customer, points out issues, and ties what they see back to what the customer said matters to them.",
    },
    {
      id: "presentation",
      name: "Product presentation",
      weight: 15,
      lookFor:
        "Presents products as solutions to the customer's stated needs rather than a generic feature list. Checks for understanding and agreement along the way.",
    },
    {
      id: "price",
      name: "Price and financing",
      weight: 15,
      lookFor:
        "Presents price confidently without apologizing or discounting unprompted. Offers financing as an option.",
    },
    {
      id: "objections",
      name: "Objection handling",
      weight: 15,
      lookFor:
        "Acknowledges objections, asks questions to find the real concern, and addresses it directly rather than arguing or immediately dropping price.",
    },
    {
      id: "close",
      name: "Asking for the business",
      weight: 10,
      lookFor: "Clearly asks the customer to move forward today.",
    },
    {
      id: "next_steps",
      name: "Next steps",
      weight: 5,
      lookFor:
        "Whatever the outcome, confirms concrete next steps (signed paperwork and install expectations, or a specific follow-up date and who else needs to be there).",
    },
  ],
};

function buildSystemPrompt(rubric = RUBRIC) {
  const steps = rubric.steps
    .map((s) => `- id "${s.id}", name "${s.name}": ${s.lookFor}`)
    .join("\n");

  return `You are a sales coach reviewing a transcript of ${rubric.appointmentType} for ${rubric.company}.

The transcript has speaker labels and timestamps. Speaker numbers come from automatic diarization and may occasionally be wrong. First decide which speaker is the sales rep and which are customers.

STEP 1: DISCLOSURE CHECK
${rubric.disclosure.lookFor}
If no disclosure is found, set "disclosure.given" to false, set "scored" to false, return an empty "steps" array, and still fill in "summary" and "outcome". Do not score the appointment.

STEP 2: SCORE EACH STEP (only if disclosure was given)
Score each step from 0 to 3:
0 = not attempted
1 = attempted but weak
2 = solid
3 = excellent, a model for other reps
Use null only if the step genuinely did not apply to this appointment (for example, no objections came up). Do not use null just because the rep skipped a step; that is a 0.

Steps:
${steps}

For each step give short evidence with a timestamp, and one specific, practical coaching note written directly to the rep ("you"). Be honest and direct but constructive. Base everything on what is in the transcript; do not invent details.

Return ONLY a JSON object, no preamble and no markdown fences, with exactly this shape:
{
  "rep_speaker": "Speaker N",
  "disclosure": { "given": true, "timestamp": "mm:ss or null", "evidence": "short paraphrase" },
  "scored": true,
  "outcome": "sold" | "not sold" | "follow up scheduled" | "unclear",
  "steps": [
    { "id": "step id", "score": 0, "evidence": "[mm:ss] short paraphrase", "coaching": "one specific suggestion" }
  ],
  "objections": [
    { "objection": "what the customer raised", "timestamp": "mm:ss", "how_handled": "short description", "effective": true }
  ],
  "strengths": ["up to 3 short items"],
  "top_coaching_point": "the single most valuable thing for this rep to work on next",
  "summary": "3 to 4 sentences describing the appointment and the customer's situation"
}`;
}

// Weighted 0 to 100 score, ignoring steps scored null.
function computeOverall(steps, rubric = RUBRIC) {
  let earned = 0;
  let possible = 0;
  for (const s of rubric.steps) {
    const result = steps.find((r) => r.id === s.id);
    if (!result || result.score === null || result.score === undefined) continue;
    earned += (Math.max(0, Math.min(3, result.score)) / 3) * s.weight;
    possible += s.weight;
  }
  return possible ? Math.round((earned / possible) * 100) : null;
}

// ===== END RUBRIC =====


const PART_SIZE = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 400 * 1024 * 1024;
const PLAYBACK_LINK_SECONDS = 2 * 60 * 60;
const DEEPGRAM_LINK_SECONDS = 60 * 60;
const MAX_ATTEMPTS = 3;
const SHEET_TAB = "Call_Scorecards";
const AUDIO_EXTS = ["m4a", "mp3", "wav", "aac", "mp4", "webm", "ogg", "flac", "opus"];
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      return await route(request, env, ctx, cors);
    } catch (err) {
      console.error("fetch error", err && err.stack ? err.stack : err);
      return json({ error: "server_error" }, 500, cors);
    }
  },

  async queue(batch, env, ctx) {
    for (const msg of batch.messages) {
      try {
        await processCall(msg.body, env);
        msg.ack();
      } catch (err) {
        console.error("queue error", msg.body && msg.body.id, err && err.stack ? err.stack : err);
        if (msg.attempts >= MAX_ATTEMPTS) {
          await markError(env, msg.body && msg.body.id, String(err && err.message ? err.message : err));
          msg.ack();
        } else {
          msg.retry({ delaySeconds: 60 * msg.attempts });
        }
      }
    }
  },
};

// ---------- routing ----------

async function route(request, env, ctx, cors) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = request.method;

  // Signed audio stream: authorized by signature, not key header, so an
  // <audio> tag and Deepgram can both fetch it.
  if (parts[0] === "calls" && parts[2] === "audio" && parts.length === 3 && (method === "GET" || method === "HEAD")) {
    return streamAudio(request, env, parts[1], url, cors);
  }

  const me = identify(request, env);
  if (!me) return json({ error: "unauthorized" }, 401, cors);

  if (parts[0] === "me" && method === "GET") {
    const settings = await getSettings(env);
    return json({ name: me.name, role: me.role, repVisibility: settings.repVisibility }, 200, cors);
  }

  if (parts[0] === "settings") {
    if (me.role !== "coach") return json({ error: "forbidden" }, 403, cors);
    if (method === "GET") return json(await getSettings(env), 200, cors);
    if (method === "POST") {
      const body = await readJson(request);
      const settings = await getSettings(env);
      if (typeof body.repVisibility === "boolean") settings.repVisibility = body.repVisibility;
      await env.CALLS.put("config/settings.json", JSON.stringify(settings));
      return json(settings, 200, cors);
    }
  }

  if (parts[0] === "uploads") {
    if (parts.length === 1 && method === "POST") return startUpload(request, env, me, url, cors);
    const id = parts[1];
    if (!ID_RE.test(id || "")) return json({ error: "bad_id" }, 400, cors);
    if (parts[2] === "parts" && parts.length === 4 && method === "PUT") return uploadPart(request, env, me, id, parts[3], url, cors);
    if (parts[2] === "complete" && method === "POST") return completeUpload(request, env, me, id, cors);
    if (parts[2] === "abort" && method === "POST") return abortUpload(request, env, me, id, cors);
  }

  if (parts[0] === "calls") {
    if (parts.length === 1 && method === "GET") return listCalls(env, me, url, cors);
    const id = parts[1];
    if (!ID_RE.test(id || "")) return json({ error: "bad_id" }, 400, cors);
    if (parts.length === 2 && method === "GET") return getCall(env, me, id, cors);
    if (parts.length === 2 && method === "DELETE") return deleteCall(env, me, id, cors);
    if (parts[2] === "audio-link" && method === "POST") return audioLink(env, me, id, url, cors);
    if (parts[2] === "rescore" && method === "POST") return rescore(request, env, me, id, cors);
  }

  return json({ error: "not_found" }, 404, cors);
}

// ---------- auth and settings ----------

function identify(request, env) {
  const key = request.headers.get("X-WW-Key");
  if (!key) return null;
  let keys;
  try {
    keys = JSON.parse(env.REP_KEYS || "{}");
  } catch (e) {
    console.error("REP_KEYS is not valid JSON");
    return null;
  }
  const entry = Object.prototype.hasOwnProperty.call(keys, key) ? keys[key] : null;
  if (!entry || !entry.name || (entry.role !== "rep" && entry.role !== "coach")) return null;
  return { name: entry.name, role: entry.role };
}

async function getSettings(env) {
  const stored = await getJson(env, "config/settings.json");
  return { repVisibility: !!(stored && stored.repVisibility) };
}

// A coach sees everything. A rep sees only their own calls, and only once
// rep visibility is switched on.
async function canView(env, me, meta) {
  if (me.role === "coach") return true;
  if (meta.rep !== me.name) return false;
  return (await getSettings(env)).repVisibility;
}

// ---------- uploads ----------

async function startUpload(request, env, me, url, cors) {
  const body = await readJson(request);
  const customer = String(body.customer || "").trim().slice(0, 120);
  const appointmentDate = String(body.appointmentDate || "").trim();
  const filename = String(body.filename || "").trim().slice(0, 200);
  const size = Number(body.size);
  const ext = (filename.split(".").pop() || "").toLowerCase();

  if (!customer) return json({ error: "customer_required" }, 400, cors);
  if (!DATE_RE.test(appointmentDate)) return json({ error: "bad_date" }, 400, cors);
  if (!AUDIO_EXTS.includes(ext)) return json({ error: "unsupported_file", allowed: AUDIO_EXTS }, 400, cors);
  if (!Number.isFinite(size) || size <= 0) return json({ error: "bad_size" }, 400, cors);
  if (size > MAX_AUDIO_BYTES) return json({ error: "file_too_large", maxBytes: MAX_AUDIO_BYTES }, 400, cors);

  const id = crypto.randomUUID();
  const audioKey = `audio/${id}.${ext}`;
  const contentType = String(body.contentType || "").slice(0, 100) || "application/octet-stream";
  const mpu = await env.CALLS.createMultipartUpload(audioKey, { httpMetadata: { contentType } });

  const meta = {
    id,
    rep: me.name,
    customer,
    appointmentDate,
    filename,
    size,
    audioKey,
    uploadId: mpu.uploadId,
    baseUrl: url.origin,
    status: "uploading",
    createdAt: new Date().toISOString(),
  };
  await putJson(env, `calls/${id}/meta.json`, meta);

  return json({ id, uploadId: mpu.uploadId, partSize: PART_SIZE, partCount: Math.ceil(size / PART_SIZE) }, 200, cors);
}

async function loadUploading(env, me, id, uploadId) {
  const meta = await getMeta(env, id);
  if (!meta || meta.rep !== me.name || meta.status !== "uploading") return null;
  if (!uploadId || uploadId !== meta.uploadId) return null;
  return meta;
}

async function uploadPart(request, env, me, id, partStr, url, cors) {
  const partNumber = Number(partStr);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return json({ error: "bad_part" }, 400, cors);
  const meta = await loadUploading(env, me, id, url.searchParams.get("uploadId"));
  if (!meta) return json({ error: "upload_not_found" }, 404, cors);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > PART_SIZE) return json({ error: "bad_part_size" }, 400, cors);

  const mpu = env.CALLS.resumeMultipartUpload(meta.audioKey, meta.uploadId);
  const part = await mpu.uploadPart(partNumber, bytes);
  return json({ partNumber: part.partNumber, etag: part.etag }, 200, cors);
}

async function completeUpload(request, env, me, id, cors) {
  const body = await readJson(request);
  const meta = await loadUploading(env, me, id, body.uploadId);
  if (!meta) return json({ error: "upload_not_found" }, 404, cors);
  if (!Array.isArray(body.parts) || body.parts.length === 0) return json({ error: "parts_required" }, 400, cors);

  const parts = body.parts
    .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag || "") }))
    .sort((a, b) => a.partNumber - b.partNumber);

  const mpu = env.CALLS.resumeMultipartUpload(meta.audioKey, meta.uploadId);
  await mpu.complete(parts);

  delete meta.uploadId;
  meta.status = "queued";
  meta.uploadedAt = new Date().toISOString();
  await saveMeta(env, meta);
  await safeSheet(env, meta);
  await env.SCORE_QUEUE.send({ id });

  return json({ id, status: meta.status }, 200, cors);
}

async function abortUpload(request, env, me, id, cors) {
  const body = await readJson(request);
  const meta = await loadUploading(env, me, id, body.uploadId);
  if (!meta) return json({ error: "upload_not_found" }, 404, cors);
  try {
    await env.CALLS.resumeMultipartUpload(meta.audioKey, meta.uploadId).abort();
  } catch (e) {
    console.error("abort failed", id, e);
  }
  await env.CALLS.delete(`calls/${id}/meta.json`);
  return json({ id, status: "aborted" }, 200, cors);
}

// ---------- results ----------

async function listCalls(env, me, url, cors) {
  if (me.role !== "coach" && !(await getSettings(env)).repVisibility) {
    return json({ error: "not_enabled" }, 403, cors);
  }
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const repFilter = me.role === "coach" ? url.searchParams.get("rep") || "" : me.name;

  const calls = [];
  let cursor;
  do {
    const page = await env.CALLS.list({ prefix: "index/", include: ["customMetadata"], cursor, limit: 1000 });
    for (const obj of page.objects) {
      const m = obj.customMetadata || {};
      if (repFilter && m.rep !== repFilter) continue;
      if (from && m.date < from) continue;
      if (to && m.date > to) continue;
      calls.push({
        id: obj.key.slice("index/".length),
        rep: m.rep || "",
        appointmentDate: m.date || "",
        customer: m.customer || "",
        status: m.status || "",
        overall: m.overall === "" || m.overall === undefined ? null : Number(m.overall),
        outcome: m.outcome || "",
        disclosure: m.disclosure || "",
        topCoachingPoint: m.top || "",
        uploadedAt: m.uploadedAt || "",
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  calls.sort((a, b) => (b.appointmentDate + b.uploadedAt).localeCompare(a.appointmentDate + a.uploadedAt));
  return json({ calls }, 200, cors);
}

async function getCall(env, me, id, cors) {
  const meta = await getMeta(env, id);
  if (!meta || meta.status === "uploading") return json({ error: "not_found" }, 404, cors);
  if (!(await canView(env, me, meta))) return json({ error: "forbidden" }, 403, cors);

  const [scorecard, transcript] = await Promise.all([
    getJson(env, `calls/${id}/scorecard.json`),
    getJson(env, `calls/${id}/transcript.json`),
  ]);
  return json({ call: publicMeta(meta), scorecard, transcript }, 200, cors);
}

async function audioLink(env, me, id, url, cors) {
  if (me.role !== "coach") return json({ error: "forbidden" }, 403, cors);
  const meta = await getMeta(env, id);
  if (!meta || meta.status === "uploading") return json({ error: "not_found" }, 404, cors);
  const head = await env.CALLS.head(meta.audioKey);
  if (!head) return json({ error: "audio_expired" }, 404, cors);
  const link = await signedAudioUrl(env, url.origin, id, PLAYBACK_LINK_SECONDS);
  return json({ url: link }, 200, cors);
}

async function rescore(request, env, me, id, cors) {
  if (me.role !== "coach") return json({ error: "forbidden" }, 403, cors);
  const body = await readJson(request);
  const meta = await getMeta(env, id);
  if (!meta || meta.status === "uploading") return json({ error: "not_found" }, 404, cors);
  meta.status = "queued";
  await saveMeta(env, meta);
  await env.SCORE_QUEUE.send({ id, override: body.override === true });
  return json({ id, status: "queued" }, 200, cors);
}

async function deleteCall(env, me, id, cors) {
  if (me.role !== "coach") return json({ error: "forbidden" }, 403, cors);
  const meta = await getMeta(env, id);
  if (!meta) return json({ error: "not_found" }, 404, cors);
  await env.CALLS.delete([
    meta.audioKey,
    `calls/${id}/meta.json`,
    `calls/${id}/transcript.json`,
    `calls/${id}/scorecard.json`,
    `index/${id}`,
  ]);
  meta.status = "deleted";
  meta.topCoachingPoint = "";
  await safeSheet(env, meta);
  return json({ id, status: "deleted" }, 200, cors);
}

async function streamAudio(request, env, id, url, cors) {
  if (!ID_RE.test(id || "")) return new Response("Not found", { status: 404, headers: cors });
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") || "";
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return new Response("Link expired", { status: 403, headers: cors });
  if (!(await verifySig(env, `${id}.${exp}`, sig))) return new Response("Forbidden", { status: 403, headers: cors });

  const meta = await getMeta(env, id);
  if (!meta) return new Response("Not found", { status: 404, headers: cors });

  const headers = new Headers(cors);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store");

  if (request.method === "HEAD") {
    const head = await env.CALLS.head(meta.audioKey);
    if (!head) return new Response(null, { status: 404, headers });
    head.writeHttpMetadata(headers);
    headers.set("Content-Length", String(head.size));
    return new Response(null, { status: 200, headers });
  }

  const hasRange = request.headers.has("Range");
  const obj = await env.CALLS.get(meta.audioKey, hasRange ? { range: request.headers } : undefined);
  if (!obj) return new Response("Audio expired", { status: 404, headers });
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);

  if (hasRange && obj.range) {
    const offset = obj.range.offset || 0;
    const length = obj.range.length !== undefined ? obj.range.length : obj.size - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

// ---------- queue consumer ----------

async function processCall(job, env) {
  const id = job && job.id;
  if (!ID_RE.test(id || "")) return;
  const meta = await getMeta(env, id);
  if (!meta || meta.status === "uploading") return;

  // 1. Transcript, cached so a scoring retry never pays for transcription twice.
  let transcript = await getJson(env, `calls/${id}/transcript.json`);
  if (!transcript) {
    meta.status = "transcribing";
    await saveMeta(env, meta);
    transcript = await transcribe(env, meta);
    await putJson(env, `calls/${id}/transcript.json`, transcript);
  }

  if (!transcript.utterances.length) {
    meta.status = "no_speech";
    meta.scoredAt = new Date().toISOString();
    await saveMeta(env, meta);
    await safeSheet(env, meta);
    return;
  }

  // 2. Score.
  meta.status = "scoring";
  await saveMeta(env, meta);

  const override = job.override === true;
  const result = await score(env, meta, transcript, override);

  const disclosed = !!(result.disclosure && result.disclosure.given);
  const scored = override || (disclosed && result.scored !== false);
  const steps = scored && Array.isArray(result.steps) ? result.steps : [];
  const overall = scored ? computeOverall(steps) : null;

  const scorecard = {
    ...result,
    steps,
    scored,
    overall,
    disclosureOverride: override,
    rubricSteps: RUBRIC.steps.map((s) => ({ id: s.id, name: s.name, weight: s.weight })),
    model: env.SCORING_MODEL,
    scoredAt: new Date().toISOString(),
  };
  await putJson(env, `calls/${id}/scorecard.json`, scorecard);

  meta.status = scored ? "scored" : "flagged";
  meta.overall = overall;
  meta.outcome = String(result.outcome || "unclear");
  meta.disclosure = override ? "override" : disclosed ? "yes" : "no";
  meta.topCoachingPoint = scored ? String(result.top_coaching_point || "") : "";
  meta.scoredAt = scorecard.scoredAt;
  delete meta.error;
  await saveMeta(env, meta);
  await safeSheet(env, meta);
}

async function transcribe(env, meta) {
  const audioUrl = await signedAudioUrl(env, meta.baseUrl, meta.id, DEEPGRAM_LINK_SECONDS);
  const params = new URLSearchParams({
    model: "nova-3",
    language: "en-US",
    diarize: "true",
    utterances: "true",
    smart_format: "true",
    punctuate: "true",
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: audioUrl }),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const utterances = ((data.results && data.results.utterances) || []).map((u) => ({
    s: Number(u.speaker) || 0,
    t: Math.round((u.start || 0) * 10) / 10,
    e: Math.round((u.end || 0) * 10) / 10,
    x: String(u.transcript || "").trim(),
  })).filter((u) => u.x);
  return {
    duration: (data.metadata && data.metadata.duration) || null,
    model: "nova-3",
    utterances,
  };
}

async function score(env, meta, transcript, override) {
  let system = buildSystemPrompt(RUBRIC);
  if (override) {
    system += `

COACH OVERRIDE: A coach listened to this recording and confirmed the notetaker disclosure was given. Skip STEP 1. Set "disclosure.given" to true and "scored" to true, and score every step in STEP 2.`;
  }

  const lines = transcript.utterances.map((u) => `[${mmss(u.t)}] Speaker ${u.s}: ${u.x}`).join("\n");
  const user = `Appointment date: ${meta.appointmentDate}\nLength: ${transcript.duration ? mmss(transcript.duration) : "unknown"}\n\nTRANSCRIPT\n${lines}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.SCORING_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return parseModelJson(text);
}

function parseModelJson(text) {
  const clean = String(text).replace(/```json|```/g, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Scoring response had no JSON object");
  const obj = JSON.parse(clean.slice(start, end + 1));
  if (!obj || typeof obj !== "object" || !obj.disclosure) throw new Error("Scoring response missing disclosure");
  return obj;
}

async function markError(env, id, message) {
  if (!ID_RE.test(id || "")) return;
  const meta = await getMeta(env, id);
  if (!meta) return;
  meta.status = "error";
  meta.error = message.slice(0, 300);
  await saveMeta(env, meta);
  await safeSheet(env, meta);
}

// ---------- Sheets (Call_Scorecards tab) ----------

// Header names in the Call_Scorecards tab. Order in the sheet does not
// matter; values are placed by header name through cols().
function sheetRecord(meta) {
  return {
    "Call ID": meta.id,
    Rep: meta.rep,
    "Appointment Date": meta.appointmentDate,
    Customer: meta.status === "deleted" ? "" : meta.customer,
    Status: meta.status,
    "Overall Score": meta.overall === null || meta.overall === undefined ? "" : meta.overall,
    Outcome: meta.outcome || "",
    Disclosure: meta.disclosure || "",
    "Top Coaching Point": meta.topCoachingPoint || "",
    "Uploaded At": meta.uploadedAt || "",
    "Scored At": meta.scoredAt || "",
  };
}

function cols(headers) {
  const map = {};
  headers.forEach((h, i) => {
    map[String(h).trim()] = i;
  });
  return map;
}

async function proxy(env, params) {
  const res = await fetch(`${env.PROXY_URL}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`Proxy ${res.status}`);
  return res.json();
}

async function upsertSheetRow(env, meta) {
  const d = await proxy(env, { action: "read", tab: SHEET_TAB });
  const data = (d && d.data) || [];
  if (!data.length) throw new Error(`${SHEET_TAB} tab has no header row`);
  const headers = data[0];
  const c = cols(headers);
  if (c["Call ID"] === undefined) throw new Error(`${SHEET_TAB} tab is missing the Call ID header`);

  const record = sheetRecord(meta);
  let k = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][c["Call ID"]]).trim() === meta.id) {
      k = i;
      break;
    }
  }

  const row = k === -1 ? new Array(headers.length).fill("") : data[k].slice();
  while (row.length < headers.length) row.push("");
  for (const [name, value] of Object.entries(record)) {
    if (c[name] !== undefined) row[c[name]] = value;
  }

  if (k === -1) {
    await proxy(env, { action: "append", tab: SHEET_TAB, row: JSON.stringify(row) });
  } else {
    await proxy(env, { action: "update", tab: SHEET_TAB, rowIndex: String(k + 1), row: JSON.stringify(row) });
  }
}

// The sheet is the CRM import copy, not the system of record, so a sheet
// failure is logged and never blocks an upload or a score.
async function safeSheet(env, meta) {
  try {
    await upsertSheetRow(env, meta);
  } catch (err) {
    console.error("sheet write failed", meta.id, err && err.message ? err.message : err);
  }
}

// ---------- R2 helpers ----------

async function getJson(env, key) {
  const obj = await env.CALLS.get(key);
  if (!obj) return null;
  try {
    return await obj.json();
  } catch (e) {
    return null;
  }
}

async function putJson(env, key, value) {
  await env.CALLS.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
}

function getMeta(env, id) {
  return getJson(env, `calls/${id}/meta.json`);
}

// Writes meta plus the index object whose customMetadata powers /calls.
async function saveMeta(env, meta) {
  await putJson(env, `calls/${meta.id}/meta.json`, meta);
  await env.CALLS.put(`index/${meta.id}`, "", {
    customMetadata: {
      rep: meta.rep,
      date: meta.appointmentDate,
      customer: meta.customer.slice(0, 120),
      status: meta.status,
      overall: meta.overall === null || meta.overall === undefined ? "" : String(meta.overall),
      outcome: meta.outcome || "",
      disclosure: meta.disclosure || "",
      top: (meta.topCoachingPoint || "").slice(0, 600),
      uploadedAt: meta.uploadedAt || "",
    },
  });
}

function publicMeta(meta) {
  return {
    id: meta.id,
    rep: meta.rep,
    customer: meta.customer,
    appointmentDate: meta.appointmentDate,
    status: meta.status,
    overall: meta.overall === undefined ? null : meta.overall,
    outcome: meta.outcome || "",
    disclosure: meta.disclosure || "",
    topCoachingPoint: meta.topCoachingPoint || "",
    uploadedAt: meta.uploadedAt || "",
    scoredAt: meta.scoredAt || "",
    error: meta.error || "",
  };
}

// ---------- signing ----------

async function hmacKey(env) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.LINK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signedAudioUrl(env, origin, id, ttlSeconds) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(`${id}.${exp}`));
  return `${origin}/calls/${id}/audio?exp=${exp}&sig=${toHex(sig)}`;
}

async function verifySig(env, payload, sigHex) {
  if (!/^[0-9a-f]{64}$/.test(sigHex)) return false;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(sigHex.substr(i * 2, 2), 16);
  return crypto.subtle.verify("HMAC", await hmacKey(env), bytes, new TextEncoder().encode(payload));
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- misc ----------

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const headers = {
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-WW-Key, Range",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, ETag",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function readJson(request) {
  try {
    return (await request.json()) || {};
  } catch (e) {
    return {};
  }
}

function mmss(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}
