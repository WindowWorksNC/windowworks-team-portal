// callcoach.js - Window Works Team Portal
// Call Coach: rep upload card and coach review card. Talks to the
// ww-call-coach Cloudflare Worker. Each person enters their personal key
// once per device; it is kept in localStorage, never in page source.
//
//   CallCoach.initRecorder('cc-root', 'Tyler Wallace')   rep pages
//   CallCoach.initCoach('cc-root')                       owner pages
(function () {
  var API = 'https://ww-call-coach.misty-moon-cbc9.workers.dev';
  var KEY_STORE = 'ww_cc_key';
  var RESUME_STORE = 'ww_cc_resume';
  var PART_TRIES = 4;
  var ACTIVE = ['queued', 'transcribing', 'scoring'];

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function getKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch (e) {} }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtDate(s) {
    if (!s) return '';
    var p = String(s).split('-');
    if (p.length !== 3) return esc(s);
    return Number(p[1]) + '/' + Number(p[2]) + '/' + p[0].slice(2);
  }
  function mmss(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + r : m + ':' + r;
  }
  function mb(bytes) { return (bytes / 1048576).toFixed(1) + ' MB'; }

  async function api(method, path, body, raw) {
    var headers = { 'X-WW-Key': getKey() };
    var opts = { method: method, headers: headers };
    if (raw) { opts.body = raw; headers['Content-Type'] = 'application/octet-stream'; }
    else if (body !== undefined) { opts.body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    var res = await fetch(API + path, opts);
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var err = new Error((data && data.error) || ('HTTP ' + res.status));
      err.status = res.status;
      err.code = data && data.error;
      throw err;
    }
    return data;
  }

  var STATUS = {
    queued: ['Queued', 'pill-gray'],
    transcribing: ['Transcribing', 'pill-yellow'],
    scoring: ['Scoring', 'pill-yellow'],
    scored: ['Scored', 'pill-approved'],
    flagged: ['No disclosure', 'pill-denied'],
    no_speech: ['No speech', 'pill-gray'],
    error: ['Error', 'pill-denied'],
  };
  function statusPill(s) {
    var v = STATUS[s] || [s || 'Unknown', 'pill-gray'];
    return '<span class="pill ' + v[1] + '">' + esc(v[0]) + '</span>';
  }

  // ---------- key gate (shared) ----------
  // Renders a key prompt into root and resolves with the /me identity.
  async function ensureKey(root, intro) {
    if (getKey()) {
      try { return await api('GET', '/me'); }
      catch (e) {
        if (e.status !== 401) {
          root.innerHTML = '<div class="alert alert-error">Call Coach is unreachable right now. Refresh to try again.</div>';
          return null;
        }
        setKey('');
      }
    }
    return new Promise(function (resolve) {
      root.innerHTML =
        '<div class="cc-key">' +
        '<div class="cc-note">' + esc(intro) + '</div>' +
        '<div class="form-row"><div class="form-group"><label class="form-label">Your Call Coach key</label>' +
        '<input class="form-input" id="cc-key-inp" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"></div></div>' +
        '<div id="cc-key-msg"></div>' +
        '<button class="submit-btn" id="cc-key-btn">Save Key</button></div>';
      var inp = $('cc-key-inp'), btn = $('cc-key-btn'), msg = $('cc-key-msg');
      async function go() {
        var k = inp.value.trim().toUpperCase();
        if (!k) return;
        btn.disabled = true; msg.innerHTML = '';
        setKey(k);
        try { resolve(await api('GET', '/me')); }
        catch (e) {
          setKey('');
          btn.disabled = false;
          msg.innerHTML = '<div class="alert alert-error">' + (e.status === 401 ? 'That key was not recognized. Check it and try again.' : 'Could not reach Call Coach. Try again.') + '</div>';
        }
      }
      btn.onclick = go;
      inp.onkeydown = function (ev) { if (ev.key === 'Enter') go(); };
    });
  }

  function switchKeyLink() {
    return '<button class="cc-link" onclick="CallCoach.forgetKey()">Use a different key</button>';
  }

  // ---------- scorecard detail (shared) ----------
  function speakerName(sc, s) {
    return sc && sc.rep_speaker === 'Speaker ' + s ? 'Rep' : 'Speaker ' + s;
  }

  function renderDetail(d, mode) {
    var c = d.call, sc = d.scorecard, tr = d.transcript;
    var h = '';
    var scoreHtml = c.overall == null ? '' :
      '<span class="cc-score' + (mode === 'rep' ? ' cc-score-quiet' : '') + '">' + esc(c.overall) + '</span>';

    h += '<div class="cc-detail-head"><div><div class="cc-detail-title">' + esc(c.customer) + '</div>' +
      '<div class="cc-detail-meta">' + (mode === 'coach' ? esc(c.rep) + ' &bull; ' : '') + fmtDate(c.appointmentDate) +
      (c.outcome ? ' &bull; ' + esc(c.outcome) : '') + ' &bull; ' + statusPill(c.status) + '</div></div>' +
      (mode === 'coach' ? scoreHtml : '') + '</div>';

    if (c.status === 'flagged') {
      h += '<div class="alert alert-warning">No notetaker disclosure was found, so this call was not scored.' +
        (mode === 'coach' ? ' Listen to the opening; if the disclosure is there, use Score Anyway.' : '') + '</div>';
    }
    if (c.status === 'error') h += '<div class="alert alert-error">Processing failed: ' + esc(c.error || 'unknown error') + '</div>';
    if (ACTIVE.indexOf(c.status) !== -1) h += '<div class="alert alert-info">Still processing. This usually takes a few minutes.</div>';

    if (sc && sc.scored) {
      if (sc.top_coaching_point) h += '<div class="cc-block"><div class="cc-label">Top Coaching Point</div><div class="cc-top">' + esc(sc.top_coaching_point) + '</div></div>';
      if (sc.strengths && sc.strengths.length) {
        h += '<div class="cc-block"><div class="cc-label">Strengths</div><ul class="cc-list">' +
          sc.strengths.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
      }
    }
    if (sc && sc.summary) h += '<div class="cc-block"><div class="cc-label">Summary</div><div>' + esc(sc.summary) + '</div></div>';

    if (sc && sc.scored && sc.steps && sc.steps.length) {
      var byId = {};
      sc.steps.forEach(function (s) { byId[s.id] = s; });
      h += '<div class="cc-block"><div class="cc-label">Steps</div><div class="cc-steps">';
      (sc.rubricSteps || []).forEach(function (rs) {
        var s = byId[rs.id] || {};
        var val = s.score == null ? 'n/a' : s.score + '/3';
        h += '<div class="cc-step"><div class="cc-step-head"><span class="cc-step-name">' + esc(rs.name) + '</span>' +
          '<span class="cc-step-score cc-s' + (s.score == null ? 'na' : s.score) + '">' + val + '</span></div>' +
          (s.evidence ? '<div class="cc-step-ev">' + esc(s.evidence) + '</div>' : '') +
          (s.coaching ? '<div class="cc-step-co">' + esc(s.coaching) + '</div>' : '') +
          (rs.id === 'needs' ? needsCoverage(sc) : '') + '</div>';
      });
      h += '</div></div>';
      if (mode === 'rep' && c.overall != null) h += '<div class="cc-quiet-line">Overall ' + scoreHtml + ' of 100</div>';
    }

    if (sc && sc.objections && sc.objections.length) {
      h += '<div class="cc-block"><div class="cc-label">Objections</div><ul class="cc-list">' +
        sc.objections.map(function (o) {
          var card = o.card && o.card !== 'none' ? '<div class="cc-obj-card">Card: ' + esc(o.card) + '</div>' : '';
          var cs = '';
          if (o.four_cs) {
            cs = '<div class="cc-4c">' + ['concede', 'commit', 'convince', 'close'].map(function (k) {
              return '<span class="cc-c ' + (o.four_cs[k] ? 'cc-c-yes' : 'cc-c-no') + '">' + k.charAt(0).toUpperCase() + k.slice(1) + '</span>';
            }).join('') + '</div>';
          }
          return '<li><strong>' + esc(o.objection) + '</strong>' + (o.timestamp ? ' <span class="rb-muted">' + esc(o.timestamp) + '</span>' : '') +
            card + '<div>' + esc(o.how_handled) + '</div>' + cs + '</li>';
        }).join('') + '</ul></div>';
    }

    if (mode === 'coach') {
      h += '<div class="cc-actions">' +
        '<button class="submit-btn secondary-btn" onclick="CallCoach._audio(\'' + c.id + '\')">Play Audio</button>' +
        (c.status === 'flagged' ? '<button class="submit-btn" onclick="CallCoach._rescore(\'' + c.id + '\',true)">Score Anyway</button>' : '') +
        '<button class="submit-btn secondary-btn" onclick="CallCoach._rescore(\'' + c.id + '\',false)">Rescore</button>' +
        '<button class="submit-btn secondary-btn cc-danger" onclick="CallCoach._delete(\'' + c.id + '\')">Delete</button>' +
        '</div><div id="cc-audio-wrap"></div><div id="cc-action-msg"></div>';
    }

    if (tr && tr.utterances && tr.utterances.length) {
      h += '<div class="cc-block"><button class="cc-link" onclick="var t=document.getElementById(\'cc-tr\');t.style.display=t.style.display===\'none\'?\'block\':\'none\'">Show or hide transcript</button>' +
        '<div id="cc-tr" class="cc-tr" style="display:none">' +
        tr.utterances.map(function (u) {
          var who = speakerName(sc, u.s);
          return '<div class="cc-utt' + (who === 'Rep' ? ' cc-utt-rep' : '') + '"><button class="cc-ts" onclick="CallCoach._seek(' + u.t + ')">' + mmss(u.t) + '</button>' +
            '<span class="cc-who">' + esc(who) + '</span> ' + esc(u.x) + '</div>';
        }).join('') + '</div></div>';
    } else if (mode === 'coach' && c.status !== 'queued' && c.status !== 'transcribing') {
      h += '<div class="rb-muted">Transcript no longer available.</div>';
    }
    return h;
  }

  function needsCoverage(sc) {
    var list = sc.needsQuestions, asked = sc.needs_questions_asked;
    if (!list || !Array.isArray(asked)) return '';
    var set = {};
    asked.forEach(function (n) { set[Number(n)] = 1; });
    var missed = list.filter(function (q, i) { return !set[i + 1]; });
    return '<div class="cc-needs"><div class="cc-needs-count">Covered ' + (list.length - missed.length) + ' of ' + list.length + ' needs questions</div>' +
      (missed.length ? '<div class="rb-muted">Skipped:</div><ul class="cc-list">' + missed.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
  }

  // ---------- rep: recorder ----------
  var rec = { root: null, employee: '', me: null };

  async function initRecorder(rootId, employee) {
    rec.root = $(rootId);
    rec.employee = employee;
    if (!rec.root) return;
    rec.me = await ensureKey(rec.root, 'Enter the Call Coach key you were given. You only need to do this once on this device.');
    if (!rec.me) return;
    if (rec.me.name !== employee) {
      rec.root.innerHTML = '<div class="alert alert-warning">This device is signed in to Call Coach as ' + esc(rec.me.name) +
        '. Uploads on this page need ' + esc(employee) + '\'s key.</div>' + switchKeyLink();
      return;
    }
    renderRecorder();
  }

  function renderRecorder() {
    var resume = loadResume();
    rec.root.innerHTML =
      '<div class="cc-note"><strong>Start recording before you introduce the notetaker,</strong> then mention it near the start and give the customer a chance to say no. If they decline, stop recording and do not upload.</div>' +
      (resume ? '<div class="alert alert-info">An upload for ' + esc(resume.customer) + ' (' + esc(resume.fileName) + ') did not finish. Choose the same file again to pick up where it left off.</div>' : '') +
      '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">Customer Name</label><input class="form-input" id="cc-customer" value="' + esc(resume ? resume.customer : '') + '"></div>' +
      '<div class="form-group" style="max-width:180px"><label class="form-label">Appointment Date</label><input type="date" class="form-input" id="cc-date" value="' + esc(resume ? resume.date : todayStr()) + '"></div>' +
      '</div>' +
      '<div class="form-row"><div class="form-group"><label class="form-label">Recording</label>' +
      '<input type="file" class="form-input" id="cc-file" accept="audio/*,.m4a,.mp3,.wav,.aac,.mp4,.webm,.ogg,.flac,.opus"></div></div>' +
      '<div id="cc-up-msg"></div>' +
      '<div id="cc-progress" class="cc-progress" style="display:none"><div class="cc-bar"><div class="cc-fill" id="cc-fill"></div></div><div class="cc-prog-txt" id="cc-prog-txt"></div></div>' +
      '<button class="submit-btn" id="cc-up-btn">Upload Recording</button>' +
      '<div id="cc-mine"></div>' +
      '<div class="cc-foot">Signed in as ' + esc(rec.me.name) + '. ' + switchKeyLink() + '</div>';
    $('cc-up-btn').onclick = startUpload;
    if (rec.me.repVisibility) loadMine();
  }

  function loadResume() {
    try {
      var r = JSON.parse(localStorage.getItem(RESUME_STORE) || 'null');
      return r && r.rep === rec.employee ? r : null;
    } catch (e) { return null; }
  }
  function saveResume(r) { try { localStorage.setItem(RESUME_STORE, JSON.stringify(r)); } catch (e) {} }
  function clearResume() { try { localStorage.removeItem(RESUME_STORE); } catch (e) {} }

  function upMsg(kind, text) { $('cc-up-msg').innerHTML = text ? '<div class="alert alert-' + kind + '">' + text + '</div>' : ''; }

  async function startUpload() {
    var customer = $('cc-customer').value.trim();
    var date = $('cc-date').value;
    var file = $('cc-file').files[0];
    if (!customer) return upMsg('error', 'Enter the customer name.');
    if (!date) return upMsg('error', 'Enter the appointment date.');
    if (!file) return upMsg('error', 'Choose the recording file.');
    upMsg('', '');

    var btn = $('cc-up-btn');
    btn.disabled = true;
    var wake = null;
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) {}

    try {
      var r = loadResume();
      var same = r && r.fileName === file.name && r.size === file.size && r.lastModified === file.lastModified;
      if (!same) {
        var init = await api('POST', '/uploads', {
          customer: customer, appointmentDate: date, filename: file.name, contentType: file.type || '', size: file.size,
        });
        r = {
          rep: rec.employee, id: init.id, uploadId: init.uploadId, partSize: init.partSize, partCount: init.partCount,
          fileName: file.name, size: file.size, lastModified: file.lastModified, customer: customer, date: date, done: {},
        };
        saveResume(r);
      }

      $('cc-progress').style.display = 'block';
      for (var n = 1; n <= r.partCount; n++) {
        progress(r, n);
        if (r.done[n]) continue;
        var blob = file.slice((n - 1) * r.partSize, Math.min(n * r.partSize, file.size));
        r.done[n] = await sendPart(r, n, blob);
        saveResume(r);
      }
      progress(r, r.partCount + 1);

      var parts = [];
      for (var p = 1; p <= r.partCount; p++) parts.push({ partNumber: p, etag: r.done[p] });
      await api('POST', '/uploads/' + r.id + '/complete', { uploadId: r.uploadId, parts: parts });
      clearResume();

      $('cc-progress').style.display = 'none';
      $('cc-customer').value = '';
      $('cc-file').value = '';
      $('cc-date').value = todayStr();
      upMsg('success', 'Uploaded ' + esc(r.customer) + '. Scoring runs in the background; you can close this page.');
      if (rec.me.repVisibility) loadMine();
    } catch (e) {
      $('cc-progress').style.display = 'none';
      if (e.code === 'upload_not_found') {
        clearResume();
        upMsg('error', 'That upload expired. Tap Upload Recording to start it fresh.');
      } else if (e.code === 'unsupported_file') {
        upMsg('error', 'That file type is not supported. Use the audio file from your recorder app (usually .m4a).');
      } else if (e.code === 'file_too_large') {
        upMsg('error', 'That file is larger than 400 MB. Check that it is the audio file, not a video.');
      } else {
        upMsg('error', 'Upload stopped (' + esc(e.message) + '). Check your connection and tap Upload Recording again; it will pick up where it left off.');
      }
    } finally {
      btn.disabled = false;
      try { if (wake) wake.release(); } catch (e) {}
    }
  }

  async function sendPart(r, n, blob) {
    var last;
    for (var t = 1; t <= PART_TRIES; t++) {
      try {
        var res = await api('PUT', '/uploads/' + r.id + '/parts/' + n + '?uploadId=' + encodeURIComponent(r.uploadId), undefined, blob);
        return res.etag;
      } catch (e) {
        last = e;
        if (e.code === 'upload_not_found') throw e;
        await sleep(1500 * t);
      }
    }
    throw last;
  }

  function progress(r, n) {
    var done = Math.min(n - 1, r.partCount);
    var pct = Math.round((done / r.partCount) * 100);
    $('cc-fill').style.width = pct + '%';
    $('cc-prog-txt').textContent = n > r.partCount ? 'Finishing up...' :
      'Uploading part ' + n + ' of ' + r.partCount + ' (' + mb(r.size) + ' total). Keep this page open.';
  }

  async function loadMine() {
    var box = $('cc-mine');
    if (!box) return;
    box.innerHTML = '<div class="cc-label cc-mine-head">My Scorecards</div><div class="loading">Loading...</div>';
    try {
      var d = await api('GET', '/calls');
      if (!d.calls.length) { box.innerHTML = '<div class="cc-label cc-mine-head">My Scorecards</div><div class="empty-state">No calls yet.</div>'; return; }
      box.innerHTML = '<div class="cc-label cc-mine-head">My Scorecards</div>' +
        d.calls.map(function (c) {
          return '<div class="cc-mine-row" onclick="CallCoach._openMine(\'' + c.id + '\')"><div><strong>' + esc(c.customer) + '</strong> <span class="rb-muted">' + fmtDate(c.appointmentDate) + '</span></div>' +
            '<div class="cc-mine-top">' + (c.status === 'scored' ? esc(c.topCoachingPoint) : statusPill(c.status)) + '</div></div>' +
            '<div id="cc-mine-' + c.id + '" class="cc-mine-detail" style="display:none"></div>';
        }).join('');
    } catch (e) {
      box.innerHTML = '';
    }
  }

  async function openMine(id) {
    var el = $('cc-mine-' + id);
    if (!el) return;
    if (el.style.display === 'block') { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = '<div class="loading">Loading...</div>';
    try { el.innerHTML = renderDetail(await api('GET', '/calls/' + id), 'rep'); }
    catch (e) { el.innerHTML = '<div class="alert alert-error">Could not load this call.</div>'; }
  }

  // ---------- coach ----------
  var co = { root: null, me: null, calls: [], range: '30', rep: '', open: '', timer: null };

  async function initCoach(rootId) {
    co.root = $(rootId);
    if (!co.root) return;
    co.me = await ensureKey(co.root, 'Enter your Call Coach coach key. You only need to do this once on this device.');
    if (!co.me) return;
    if (co.me.role !== 'coach') {
      co.root.innerHTML = '<div class="alert alert-warning">The key on this device (' + esc(co.me.name) + ') does not have coach access.</div>' + switchKeyLink();
      return;
    }
    co.root.innerHTML =
      '<div class="cc-toolbar">' +
      '<select class="form-input cc-sel" id="cc-f-rep"><option value="">All reps</option></select>' +
      '<select class="form-input cc-sel" id="cc-f-range"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="">All</option></select>' +
      '<button class="submit-btn secondary-btn" id="cc-refresh">Refresh</button>' +
      '<label class="cc-toggle"><input type="checkbox" id="cc-vis"> Reps can see their own scorecards</label>' +
      '</div>' +
      '<div id="cc-weekly"></div><div id="cc-list"><div class="loading">Loading...</div></div><div id="cc-detail"></div>' +
      '<div class="cc-foot">Signed in as ' + esc(co.me.name) + '. ' + switchKeyLink() + '</div>';
    $('cc-vis').checked = !!co.me.repVisibility;
    $('cc-vis').onchange = setVisibility;
    $('cc-f-rep').onchange = function () { co.rep = this.value; renderList(); };
    $('cc-f-range').onchange = function () { co.range = this.value; loadCalls(); };
    $('cc-refresh').onclick = loadCalls;
    loadCalls();
  }

  async function setVisibility() {
    var box = $('cc-vis');
    var want = box.checked;
    var msg = want ? 'Turn on rep access? Tyler and Michael will see their own scorecards in their portal.' : 'Turn off rep access? Reps will no longer see their scorecards.';
    if (!confirm(msg)) { box.checked = !want; return; }
    box.disabled = true;
    try { var s = await api('POST', '/settings', { repVisibility: want }); box.checked = !!s.repVisibility; }
    catch (e) { box.checked = !want; alert('Could not change the setting. Try again.'); }
    box.disabled = false;
  }

  function rangeFrom() {
    if (!co.range) return '';
    var d = new Date();
    d.setDate(d.getDate() - Number(co.range));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  async function loadCalls() {
    clearTimeout(co.timer);
    try {
      // Always pull at least two weeks so the weekly upload counts stay complete.
      var from = rangeFrom();
      var twoWk = new Date(); twoWk.setDate(twoWk.getDate() - 14);
      var tw = twoWk.toISOString().slice(0, 10);
      var q = from && from > tw ? tw : from;
      var d = await api('GET', '/calls' + (q ? '?from=' + q : ''));
      co.calls = d.calls;
      renderWeekly();
      renderRepFilter();
      renderList();
      if (co.calls.some(function (c) { return ACTIVE.indexOf(c.status) !== -1; })) {
        co.timer = setTimeout(loadCalls, 20000);
      }
    } catch (e) {
      $('cc-list').innerHTML = '<div class="alert alert-error">Could not load calls. Refresh to try again.</div>';
    }
  }

  function weekStart(offsetWeeks) {
    var d = new Date();
    var day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day - 7 * offsetWeeks);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function renderWeekly() {
    var thisWk = weekStart(0), lastWk = weekStart(1);
    var reps = {};
    co.calls.forEach(function (c) {
      reps[c.rep] = reps[c.rep] || { now: 0, last: 0 };
      if (c.appointmentDate >= thisWk) reps[c.rep].now++;
      else if (c.appointmentDate >= lastWk) reps[c.rep].last++;
    });
    var names = Object.keys(reps).sort();
    if (!names.length) { $('cc-weekly').innerHTML = ''; return; }
    $('cc-weekly').innerHTML = '<div class="stat-grid">' + names.map(function (n) {
      return '<div class="stat-block"><div class="stat-number">' + reps[n].now + '</div><div class="stat-label">' + esc(n.split(' ')[0]) + ' this week</div><div class="stat-sub">' + reps[n].last + ' last week</div></div>';
    }).join('') + '</div>';
  }

  function renderRepFilter() {
    var sel = $('cc-f-rep');
    var names = {};
    co.calls.forEach(function (c) { names[c.rep] = 1; });
    var cur = co.rep;
    sel.innerHTML = '<option value="">All reps</option>' + Object.keys(names).sort().map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }

  function renderList() {
    var from = rangeFrom();
    var rows = co.calls.filter(function (c) {
      return (!co.rep || c.rep === co.rep) && (!from || c.appointmentDate >= from);
    });
    if (!rows.length) { $('cc-list').innerHTML = '<div class="empty-state">No calls in this range.</div>'; return; }
    $('cc-list').innerHTML = '<div class="table-wrap"><table class="data-table cc-table"><thead><tr><th>Date</th><th>Rep</th><th>Customer</th><th>Status</th><th>Score</th><th>Outcome</th><th>Top Coaching Point</th></tr></thead><tbody>' +
      rows.map(function (c) {
        return '<tr class="cc-row' + (c.id === co.open ? ' cc-row-open' : '') + '" onclick="CallCoach._open(\'' + c.id + '\')">' +
          '<td>' + fmtDate(c.appointmentDate) + '</td><td>' + esc(c.rep) + '</td><td>' + esc(c.customer) + '</td>' +
          '<td>' + statusPill(c.status) + '</td><td>' + (c.overall == null ? '' : '<strong>' + esc(c.overall) + '</strong>') + '</td>' +
          '<td>' + esc(c.outcome) + '</td><td class="cc-top-cell">' + esc(c.topCoachingPoint) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function closeCall() {
    co.open = '';
    $('cc-detail').innerHTML = '';
    renderList();
  }

  async function openCall(id) {
    if (co.open === id) { closeCall(); return; }
    co.open = id;
    renderList();
    var box = $('cc-detail');
    box.innerHTML = '<div class="cc-detail"><div class="loading">Loading...</div></div>';
    try {
      var d = await api('GET', '/calls/' + id);
      box.innerHTML = '<div class="cc-detail"><button class="cc-close" onclick="CallCoach._close()" aria-label="Close">Close</button>' + renderDetail(d, 'coach') + '</div>';
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      box.innerHTML = '<div class="alert alert-error">Could not load this call.</div>';
    }
  }

  async function playAudio(id) {
    var wrap = $('cc-audio-wrap');
    wrap.innerHTML = '<div class="loading">Loading audio...</div>';
    try {
      var d = await api('POST', '/calls/' + id + '/audio-link');
      wrap.innerHTML = '<audio id="cc-audio" controls preload="metadata" src="' + esc(d.url) + '" class="cc-audio"></audio>';
    } catch (e) {
      wrap.innerHTML = '<div class="alert alert-warning">' + (e.code === 'audio_expired' ? 'The audio for this call has passed its 90 day retention and was deleted.' : 'Could not load the audio.') + '</div>';
    }
  }

  function seek(t) {
    var a = $('cc-audio');
    if (!a) { alert('Tap Play Audio first, then use the timestamps to jump.'); return; }
    a.currentTime = t;
    a.play();
  }

  async function rescore(id, override) {
    var q = override ? 'Score this call even though no disclosure was detected? Only do this if you heard the disclosure.' : 'Rescore this call with the current rubric?';
    if (!confirm(q)) return;
    var m = $('cc-action-msg');
    try {
      await api('POST', '/calls/' + id + '/rescore', { override: !!override });
      m.innerHTML = '<div class="alert alert-success">Queued. The score updates in a minute or two.</div>';
      loadCalls();
    } catch (e) { m.innerHTML = '<div class="alert alert-error">Could not queue it. Try again.</div>'; }
  }

  async function del(id) {
    if (!confirm('Delete this call? The audio, transcript, and scorecard are removed permanently.')) return;
    try {
      await api('DELETE', '/calls/' + id);
      co.open = '';
      $('cc-detail').innerHTML = '';
      loadCalls();
    } catch (e) { $('cc-action-msg').innerHTML = '<div class="alert alert-error">Could not delete it. Try again.</div>'; }
  }

  function forgetKey() {
    if (!confirm('Remove the Call Coach key from this device?')) return;
    setKey('');
    location.reload();
  }

  window.CallCoach = {
    initRecorder: initRecorder,
    initCoach: initCoach,
    forgetKey: forgetKey,
    _open: openCall,
    _close: closeCall,
    _openMine: openMine,
    _audio: playAudio,
    _seek: seek,
    _rescore: rescore,
    _delete: del,
  };
})();
