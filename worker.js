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
//
// Built from the Window Works In-Home Appointment Self-Assessment, the Vendo
// needs assessment, and the Top Rep Pivot Points objection deck. Only things
// that can be heard on a recording are scored; prep, photos, measuring, and
// Vendo builds stay on the self-assessment.

const RUBRIC = {
  company:
    "Window Works, a residential window and door replacement company serving the Raleigh-Durham Triangle",
  appointmentType: "an in-home sales appointment with a homeowner",

  disclosure: {
    lookFor:
      "Near the start of the appointment, the rep tells the customer they are using a notetaker or recording to keep track of the conversation, and gives the customer a chance to object. Any clear wording counts. It also counts if the customer clearly acknowledges it (for example, 'sure, record away').",
  },

  outcomes: ["signed", "pending", "lost"],

  needsQuestions: [
    "Opens by referencing the customer notes, showing they know whether it is windows (and how many), doors, or both",
    "How long have you lived here?",
    "Do you have any plans on selling the home?",
    "Have you had any previous experience with window or door replacement or installation?",
    "What are the reasons you're considering new windows or doors?",
    "What made you call Window Works?",
    "How long have you been thinking about getting new windows or doors?",
    "What made you decide it was time to move forward with this project now?",
    "How old are your current windows or doors?",
    "Which of these are important to you? (energy efficiency, change the look, keep the look, function better (open, close, lock), stop fading on rugs, floors, furniture, drapes, reduce noise, easier to clean, cut down on maintenance)",
    "Of these, which is most important to you?",
    "The research question: products, contractors, and pricing can look similar, so what has to be different for you to make a decision?",
    "When are you wanting to start your project?",
    "Are there any homeowners association guidelines we need to consider?",
    "Do you have any specific questions about the installation process?",
  ],

  steps: [
    {
      id: "door",
      name: "At the door",
      weight: 5,
      lookFor:
        "Asks whether where they parked is ok, mentions or offers the Window Works shoe mat, greets both homeowners by name, and asks whether now is still a good time to spend about 90 minutes. If a decision maker is missing, uses the Be Back strategy (playbook: They're not home).",
    },
    {
      id: "setup",
      name: "Set up the appointment",
      weight: 10,
      lookFor:
        "Asks whether the office told them what to expect, then tells them the plan again in their own words. Brings out any elephant in the room early, such as a for sale sign or other contractors already out (playbook: We're moving; My brother does this work).",
    },
    {
      id: "needs",
      name: "Needs assessment",
      weight: 20,
      lookFor:
        "Asks the Vendo needs assessment questions listed below, in their own words, and gets real answers. Score by coverage and depth: 3 means essentially all were covered with follow-up, 2 most, 1 a few, 0 none. In the coaching note, name the specific questions that were skipped.",
    },
    {
      id: "inspection",
      name: "Inspection",
      weight: 10,
      lookFor:
        "Asks the homeowner to walk them through their issues and lets the homeowner sell themselves on why this project matters. Acts as the expert, explains what they find, and builds urgency and credibility (playbook: Purpose of the inspection). Do not score measuring or photos.",
    },
    {
      id: "presentation",
      name: "Presentation",
      weight: 10,
      lookFor:
        "Runs the full Ingage presentation without cutting it short, even if the homeowner said time was tight, and ties it back to the priorities and the research answer from the needs assessment. Introduces the Value Match Guarantee when it fits.",
    },
    {
      id: "trial_close",
      name: "Trial close",
      weight: 10,
      lookFor:
        "Before presenting price, asks some version of: 'Other than price and affordability, is there any reason I can't get you on our production schedule today?' The purpose is to funnel every concern down to money before price.",
    },
    {
      id: "price",
      name: "Price and financing",
      weight: 10,
      lookFor:
        "Presents price with confidence, offers financing using the term 'trade partner' even if the customer says they want to pay cash, and does not lead with the best payment option up front.",
    },
    {
      id: "objections",
      name: "Objection handling",
      weight: 10,
      lookFor:
        "Handles each objection the way the matching playbook card describes, using the 4 C's: Concede (puts themselves on the customer's side; the most important C), Commit (gets a commitment), Convince (makes the case), Close (asks again). Score null if no objections came up.",
    },
    {
      id: "not_signed",
      name: "If they didn't sign",
      weight: 10,
      lookFor:
        "Sends the quote while still in the house and confirms out loud that the customer received it, calls a supervisor if something couldn't be quoted on site, and sets the next step with a specific date and time before leaving. Never leaves without a clear and definite future. Score null if the customer signed.",
    },
    {
      id: "silence",
      name: "Silence",
      weight: 5,
      lookFor:
        "After presenting price and after asking for the business, stops talking and lets the customer respond, instead of talking past the moment ('park and puke'). When the couple look at each other, gives them room to talk, for example by stepping out to take more pictures (playbook: Mum's the word). Use the transcript timestamps to judge pauses.",
    },
  ],

  // Top Rep Pivot Points deck, condensed. The cards were written for roofing;
  // apply them to windows and doors.
  playbook: [
    ["Purpose of the inspection", "The inspection is where the job is sold. Build urgency and credibility, be the expert, explain your competitive advantage."],
    ["Mum's the word (after price, one spouse looks at the other)", "They have approved and want the other's okay. Give them room: 'I don't know how it works in your house, but my wife and I like to talk about investments like this. I have more pictures to take, about 5 to 10 minutes. Would that be enough time?' The best way to stay quiet is to not be there."],
    ["We're moving (for sale sign)", "Bring it out early: 'What is your goal for our visit today?' Buyers walk away or negotiate about 10% over the repair cost when something needs replacing, so it is best to get the work done before buyers see it."],
    ["We are not buying anything today", "Lower their guard: 'Absolutely, didn't our office tell you I'm only here to give you information?' Make them comfortable."],
    ["You're being too pushy", "Stay calm: 'I'm so sorry, that's not my intent. Please don't mistake my passion for pushiness. My biggest fear is you'll choose a lesser option because of cost and have years of issues and regret.'"],
    ["They're not home (a decision maker is missing)", "Be Back strategy: confirm they can't join, set expectations, do the full inspection, share findings, take measurements back to the office, and book a time to return with both decision makers. Whoever meets with all the homeowners wins the job."],
    ["I need to talk to my spouse (end of appointment)", "'How does your spouse feel about this? If they were here, what would they say about everything we went through? Is it a big conversation, or just letting them know the framework and whether to go monthly or half down? Would you be against reaching out to them right now so I can answer their questions?'"],
    ["I don't want to pay anything down", "'A lot of our customers decide against paying anything down. We can do this for nothing down with one of our trade partners; if you qualify, pay in full at the end of the job or keep the terms.'"],
    ["It's out of our budget", "Use if the monthly payment rebuttal didn't work: 'When I find something that solves a problem or makes my life easier, I buy it. We work hard for our money to buy things we deserve, and you deserve this.' People budget differently for investments than for groceries."],
    ["We can't afford that monthly payment", "'Everything else you love? So what could you afford, so I'm not taking away from date night?' If it is a payment you can offer: confirm they would move forward today at that payment, then call to see what you can do. If not: revisit the scope (fewer windows now, the rest later) or step down the product. Never give the best payment option up front."],
    ["My brother, family, or friend does this work", "'If your brother does this work, why am I here? You didn't think I could do it cheaper than he could, did you?' Best handled early: 'Have you had anyone else out? What did they say?'"],
    ["I need to talk to my son or daughter", "'My parents do the same. I always ask them three things: will it solve your problem, do you like and trust the company and the person in front of you, and can you afford it?' Then stop talking. Follow this one to the letter."],
    ["I need to talk to my dad, uncle, neighbor", "'Can we get them on the phone so I can answer their questions?' If not: 'If they were unreachable for three months, how do you personally feel about spending this?' Take it back to money."],
    ["It's just the total amount", "'Before I came out, what did you think this would cost? After everything I showed you, where are you now? So we're only that far apart; how long would it take to come up with the rest?' Close the gap with financing, not a discount."],
    ["This is just more than we can afford right now", "'Is it the monthly payment or the down payment?' Get a commitment on what they could afford, then go to financing (Window Works does not use a marketing agreement). If they insist it is the total, use the total amount card."],
    ["We have a bonus or tax return coming", "Timing, not price: 'When are you expecting it? If I were here then, we'd be doing business?' Then offer to do the project now with a trade partner so they don't pay until the money comes."],
    ["Your price is too much", "First ask: 'How do you mean?' Find out what too much means; it may be timing."],
    ["Your competitor is cheaper", "'You can always find someone cheaper. If both proposals were the same price, who would you choose? Why?' Let them build your value, ask 'why else?', then: 'So with all that, don't you see the extra difference?'"],
    ["Stone wall (want more contractors, won't decide tonight)", "'It appears there's no way to earn your business while I'm here. Can I ask a favor: give me the same respect and not do business with the others the night of? When is the last estimate, so I can schedule a follow-up?'"],
    ["Stone wall version 2 (a pact not to buy up front)", "Call it out respectfully: 'I'm getting the impression you had no intention of buying today. If I offered this for $500, you still wouldn't take it?' When they say they'd consider it: 'So there's a number in mind. What is it?'"],
    ["We want to sleep on it", "'If there were a way I could help with both of these numbers, could that help you decide?' Consider a porchlight close (step out to take more pictures so they can talk). If still stuck, set a time the next morning; never leave without a definite future."],
    ["We need to think about it", "A stall; work through it slowly: 'How long do you need?' Confirm they love the product and trust us to install it, so it comes down to money, which is value, affordability, or timing. 'Which is it for you?'"],
    ["We need 3 estimates", "'Is there any other reason you wouldn't choose us? When you compare bids, what criteria will you use?' Get them to confirm best value. 'If within 7 to 10 days our value meets your expectations, could you see yourselves as a customer?' Introduce the Value Match Guarantee."],
    ["We need 3 estimates, part 2", "Remind them of the Value Match Guarantee: 'If we put that in writing, isn't it almost impossible to beat? What would you look for in another company that you haven't found in us? Isn't it easier to get it done now?'"],
    ["Value Match Guarantee", "If the customer finds an apples-to-apples quote (same materials, professional install, warranty, accredited company) for less, they bring it in writing and Window Works refunds the difference plus $100 for their time."],
    ["Trial close", "'Other than price and affordability, is there any reason we can't get you on the production schedule while I'm here?' Never go to price until the final decision is funneled to money."],
  ],
};

function buildSystemPrompt(rubric = RUBRIC) {
  const steps = rubric.steps.map((s) => `- id "${s.id}", name "${s.name}": ${s.lookFor}`).join("\n");
  const needs = rubric.needsQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  const playbook = rubric.playbook.map(([title, body]) => `- ${title}: ${body}`).join("\n");

  return `You are a sales coach reviewing a transcript of ${rubric.appointmentType} for ${rubric.company}.

The transcript has speaker labels and timestamps. Speaker numbers come from automatic diarization and may occasionally be wrong. First decide which speaker is the sales rep and which are customers.

Only judge what can be heard. Do not penalize the rep for things a recording cannot capture (photos, measuring, what was on the iPad screen) unless they are discussed out loud.

STEP 1: DISCLOSURE CHECK
${rubric.disclosure.lookFor}
If no disclosure is found, set "disclosure.given" to false, set "scored" to false, return an empty "steps" array, and still fill in "summary" and "outcome". Do not score the appointment.

STEP 2: SCORE EACH STEP (only if disclosure was given)
Score each step from 0 to 3:
0 = not attempted
1 = attempted but weak
2 = solid
3 = excellent, a model for other reps
Use null only if the step genuinely did not apply (for example, no objections came up, or the customer signed so the not-signed step does not apply). Do not use null just because the rep skipped a step; that is a 0.

Steps:
${steps}

VENDO NEEDS ASSESSMENT QUESTIONS (for the needs step; the rep may use their own words):
${needs}

TOP REP OBJECTION PLAYBOOK (the company's trained responses; written for roofing, so apply them to windows and doors):
${playbook}

For each step give short evidence with a timestamp, and one specific, practical coaching note written directly to the rep ("you"). When a playbook card applies, say what the card would have the rep do. Be honest and direct but constructive. Base everything on what is in the transcript; do not invent details.

For each objection the customer raised, name the playbook card it matches (or "none"), and judge each of the 4 C's: concede, commit, convince, close.

Outcome is one of: ${rubric.outcomes.map((o) => `"${o}"`).join(", ")}, or "unclear". "pending" means no signature but a follow-up is set or a decision is still open; "lost" means the customer clearly said no.

Return ONLY a JSON object, no preamble and no markdown fences, with exactly this shape:
{
  "rep_speaker": "Speaker N",
  "disclosure": { "given": true, "timestamp": "mm:ss or null", "evidence": "short paraphrase" },
  "scored": true,
  "outcome": "signed" | "pending" | "lost" | "unclear",
  "steps": [
    { "id": "step id", "score": 0, "evidence": "[mm:ss] short paraphrase", "coaching": "one specific suggestion" }
  ],
  "needs_questions_asked": [1, 2, 5],
  "objections": [
    { "objection": "what the customer raised", "timestamp": "mm:ss", "card": "playbook card title or none", "how_handled": "short description", "four_cs": { "concede": true, "commit": false, "convince": true, "close": false }, "effective": true }
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
    needsQuestions: RUBRIC.needsQuestions,
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
      max_tokens: 8000,
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
