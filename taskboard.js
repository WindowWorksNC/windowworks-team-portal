// Task board - call initTaskBoard(slug) after including this script.
//
// Storage model (changed): each board is stored in the Google Sheet "Tasks" tab via
// api(), keyed by page slug, so a board follows the person to any device. A local
// cache (localStorage) keeps the board rendering instantly and surviving a flaky
// connection; on load it reconciles against the sheet, which is the source of truth.
//
// Tasks tab columns (created in the sheet, looked up with cols(), never by index):
//   Slug | Task ID | Bucket | Text | Notes | Subtasks | Status | Done | Order | Added | Bucket Names | Updated
//   - Normal task rows leave "Bucket Names" empty.
//   - One meta row per slug (Task ID = "__buckets__") stores the custom bucket names
//     as JSON in "Bucket Names"; its other task columns are blank and it is not rendered.
//   - Subtasks is a JSON array string. Done is "1" or "". Status is the literal string.
//
// Public API is unchanged: initTaskBoard(slug) plus the window['tb*_'+slug] globals,
// so the page markup that calls them does not change.

function initTaskBoard(slug) {
  const TASKS_TAB = 'Tasks';
  const META_ID = '__buckets__';
  const CACHE_KEY = 'ww_tb_cache_' + slug;
  const LEGACY_TKEY = 'ww_tasks_' + slug;            // old localStorage-only store
  const LEGACY_NKEY = 'ww_bucket_names_' + slug;     // old bucket names store
  const RESET_KEY = 'ww_tb_reset_' + slug;

  const DEFAULT_NAMES = {
    'this-week': 'This Week',
    'recurring': 'Recurring',
    'projects': 'Larger Projects',
    'waiting': 'Waiting On'
  };
  const BUCKETS = ['this-week','recurring','projects','waiting'];
  const LOCKED = ['recurring'];

  // The required Tasks tab columns (used to validate the sheet header).
  const REQUIRED_COLS = ['Slug','Task ID','Bucket','Text','Notes','Subtasks','Status','Done','Order','Added','Bucket Names','Updated'];

  let tasks = {};                 // id -> task object
  let bucketNames = {...DEFAULT_NAMES};
  let dragId = null, dropTarget = null, dropPos = null;

  // Pending changes not yet confirmed by the sheet (survives flaky connections).
  let pending = { upserts: {}, deletes: {}, buckets: false };
  let syncing = false, syncAgain = false, retryTimer = null, lastReconcile = 0;

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7);
  }
  function esc(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ---------- Local cache ----------
  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        tasks, bucketNames, pending, syncedAt: Date.now()
      }));
    } catch(e) {}
  }
  function loadCache() {
    // Prefer the new cache; otherwise migrate the old localStorage-only board once.
    try {
      const d = localStorage.getItem(CACHE_KEY);
      if (d) {
        const p = JSON.parse(d);
        tasks = p.tasks || {};
        bucketNames = Object.assign({}, DEFAULT_NAMES, p.bucketNames || {});
        pending = p.pending && p.pending.upserts ? p.pending : { upserts:{}, deletes:{}, buckets:false };
        return;
      }
    } catch(e) {}
    migrateLegacy();
  }
  function migrateLegacy() {
    tasks = {}; bucketNames = {...DEFAULT_NAMES};
    pending = { upserts:{}, deletes:{}, buckets:false };
    try {
      const raw = localStorage.getItem(LEGACY_TKEY);
      if (raw) {
        const p = JSON.parse(raw);
        const old = p.tasks || {};
        // Re-key onto stable unique ids and mark everything for upload to the sheet.
        Object.values(old).forEach(t => {
          const id = uid('t');
          tasks[id] = {
            id, text: t.text||'', notes: t.notes||'', bucket: t.bucket||'this-week',
            subs: (t.subs||[]).map(s => ({ id: uid('s'), text: s.text||'', done: !!s.done })),
            status: t.status||'not-started', done: !!t.done,
            order: Number(t.order)||0, added: t.added||''
          };
          pending.upserts[id] = true;
        });
      }
      const names = JSON.parse(localStorage.getItem(LEGACY_NKEY) || 'null');
      if (names) { bucketNames = Object.assign({}, DEFAULT_NAMES, names); pending.buckets = true; }
    } catch(e) {}
  }

  // ---------- Sync status indicator ----------
  function setStatus(state) {
    const el = document.getElementById('tb-sync-' + slug);
    if (!el) return;
    const map = {
      saving:  { t: 'Saving...', c: '#c4581f' },
      synced:  { t: 'Synced', c: '#28a745' },
      offline: { t: 'Offline - will sync when reconnected', c: '#c0392b' }
    };
    const s = map[state] || map.synced;
    el.textContent = s.t;
    el.style.color = s.c;
  }
  function ensureStatusEl() {
    if (document.getElementById('tb-sync-' + slug)) return;
    const bar = document.querySelector('.tb-add-bar');
    if (!bar || !bar.parentNode) return;
    const el = document.createElement('div');
    el.id = 'tb-sync-' + slug;
    el.style.cssText = "font-family:'Barlow',Arial,sans-serif;font-size:11px;font-weight:600;margin:2px 0 10px;color:#28a745";
    el.textContent = 'Synced';
    bar.parentNode.insertBefore(el, bar.nextSibling);
  }

  // ---------- Sheet row helpers ----------
  function colMap(header) { return cols(header); }
  function headerOk(c) { return REQUIRED_COLS.every(name => c(name) >= 0); }
  function blankRow(len) { const a = new Array(len); for (let i=0;i<len;i++) a[i]=''; return a; }

  function buildTaskRow(c, len, t) {
    const row = blankRow(len);
    const put = (name, val) => { const i = c(name); if (i >= 0) row[i] = val; };
    put('Slug', slug);
    put('Task ID', t.id);
    put('Bucket', t.bucket);
    put('Text', t.text || '');
    put('Notes', t.notes || '');
    put('Subtasks', JSON.stringify(t.subs || []));
    put('Status', t.status || 'not-started');
    put('Done', t.done ? '1' : '');
    put('Order', String(t.order || 0));
    put('Added', t.added || '');
    put('Bucket Names', '');
    put('Updated', new Date().toISOString());
    return row;
  }
  function buildMetaRow(c, len) {
    const row = blankRow(len);
    const put = (name, val) => { const i = c(name); if (i >= 0) row[i] = val; };
    put('Slug', slug);
    put('Task ID', META_ID);
    put('Bucket Names', JSON.stringify(bucketNames));
    put('Updated', new Date().toISOString());
    return row;
  }
  // Read the sheet and index this slug's rows by Task ID, with their 1-based sheet rowIndex.
  async function readSlugIndex() {
    const d = await api({ action:'read', tab: TASKS_TAB });
    if (!d || !d.success || !d.data || !d.data.length) throw new Error('read failed');
    const header = d.data[0];
    const c = colMap(header);
    if (!headerOk(c)) throw new Error('Tasks tab is missing required columns');
    const byId = {};
    for (let i = 1; i < d.data.length; i++) {
      const r = d.data[i];
      if ((r[c('Slug')] || '').toString().trim() !== slug) continue;
      const id = (r[c('Task ID')] || '').toString().trim();
      if (!id) continue;
      byId[id] = { rowIndex: i + 1, row: r }; // header is row 1; data row k is sheet row k+1
    }
    return { header, c, byId, len: header.length };
  }

  // ---------- Push (flush pending to the sheet) ----------
  function scheduleSync(immediate) {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (immediate) { flush(); return; }
    retryTimer = setTimeout(flush, 600);
  }
  function hasPending() {
    return pending.buckets || Object.keys(pending.upserts).length > 0 || Object.keys(pending.deletes).length > 0;
  }

  async function flush() {
    if (!hasPending()) { setStatus('synced'); return; }
    if (syncing) { syncAgain = true; return; }
    syncing = true; setStatus('saving');
    try {
      let idx = await readSlugIndex();

      // 1) Deletes (highest rowIndex first so earlier indexes stay valid).
      const delTargets = Object.keys(pending.deletes)
        .map(id => idx.byId[id])
        .filter(Boolean)
        .sort((a,b) => b.rowIndex - a.rowIndex);
      for (const t of delTargets) {
        await api({ action:'delete', tab: TASKS_TAB, rowIndex: t.rowIndex });
      }
      pending.deletes = {}; // ids absent from the sheet were never synced; drop them too
      if (delTargets.length) idx = await readSlugIndex(); // indexes shifted, re-read

      // 2) Upserts (append new, update existing). Appends go to the end and do not shift
      //    existing rows; updates do not change row count, so idx stays valid here.
      for (const id of Object.keys(pending.upserts)) {
        const t = tasks[id];
        if (!t) { delete pending.upserts[id]; continue; } // deleted in the meantime
        const row = buildTaskRow(idx.c, idx.len, t);
        const hit = idx.byId[id];
        if (hit) {
          await api({ action:'update', tab: TASKS_TAB, rowIndex: hit.rowIndex, row: JSON.stringify(row) });
        } else {
          await api({ action:'append', tab: TASKS_TAB, row: JSON.stringify(row) });
        }
        delete pending.upserts[id];
      }

      // 3) Bucket names meta row.
      if (pending.buckets) {
        const metaRow = buildMetaRow(idx.c, idx.len);
        const hit = idx.byId[META_ID];
        if (hit) await api({ action:'update', tab: TASKS_TAB, rowIndex: hit.rowIndex, row: JSON.stringify(metaRow) });
        else await api({ action:'append', tab: TASKS_TAB, row: JSON.stringify(metaRow) });
        pending.buckets = false;
      }

      saveCache();
      syncing = false;
      if (syncAgain || hasPending()) { syncAgain = false; scheduleSync(true); }
      else setStatus('synced');
    } catch(e) {
      console.error('[taskboard] sync failed:', e);
      syncing = false; syncAgain = false;
      setStatus('offline');
      saveCache();
      retryTimer = setTimeout(flush, 15000); // retry on a backoff
    }
  }

  // ---------- Pull (rebuild local state from the sheet) ----------
  // Accepts an already-fetched index so a reconcile does not read the sheet twice.
  async function pull(idx) {
    if (!idx) idx = await readSlugIndex();
    const next = {};
    Object.keys(idx.byId).forEach(id => {
      if (id === META_ID) return;
      const r = idx.byId[id].row, c = idx.c;
      let subs = [];
      try { subs = JSON.parse(r[c('Subtasks')] || '[]') || []; } catch(_) { subs = []; }
      next[id] = {
        id,
        text: (r[c('Text')] || '').toString(),
        notes: (r[c('Notes')] || '').toString(),
        bucket: (r[c('Bucket')] || 'this-week').toString(),
        subs: subs.map(s => ({ id: s.id || uid('s'), text: s.text||'', done: !!s.done })),
        status: (r[c('Status')] || 'not-started').toString(),
        done: (r[c('Done')] || '').toString() === '1',
        order: Number(r[c('Order')]) || 0,
        added: (r[c('Added')] || '').toString()
      };
    });
    tasks = next;
    const meta = idx.byId[META_ID];
    bucketNames = {...DEFAULT_NAMES};
    if (meta) {
      try {
        const nm = JSON.parse(meta.row[idx.c('Bucket Names')] || 'null');
        if (nm) bucketNames = Object.assign({}, DEFAULT_NAMES, nm);
      } catch(_) {}
    }
    saveCache();
    renderBoard();
  }

  // ---------- Reconcile on load ----------
  async function reconcile() {
    try {
      // Flush any offline edits first so they are not lost, then take the sheet as truth.
      if (hasPending()) { await flush(); }

      const idx = await readSlugIndex();
      const sheetHasRows = Object.keys(idx.byId).some(id => id !== META_ID) || !!idx.byId[META_ID];

      if (!sheetHasRows && Object.keys(tasks).length) {
        // First device with data, empty sheet: seed the sheet from this board.
        Object.keys(tasks).forEach(id => { pending.upserts[id] = true; });
        pending.buckets = true;
        await flush();
        renderBoard();
      } else {
        await pull(idx);        // reuse the read above; sheet is the source of truth
      }
      lastReconcile = Date.now();
      setStatus('synced');
    } catch(e) {
      console.error('[taskboard] load reconcile failed, using local cache:', e);
      setStatus('offline');
      retryTimer = setTimeout(reconcile, 15000);
    }
  }

  // ---------- Mutations (mark dirty + cache + render + schedule sync) ----------
  function touch(id) { pending.upserts[id] = true; }
  function commit(immediate) { saveCache(); renderBoard(); scheduleSync(immediate); }

  function nextOrder(bucket) {
    const inB = Object.values(tasks).filter(t => t.bucket === bucket);
    return inB.length ? Math.max.apply(null, inB.map(t => t.order||0)) + 10 : 10;
  }

  // ---------- Render ----------
  function renderBoard() {
    BUCKETS.forEach(b => {
      const items = Object.values(tasks).filter(t => t.bucket === b)
        .sort((a,c) => (a.order||0) - (c.order||0));
      const list = document.getElementById('tl-' + b);
      if (!list) return;
      list.innerHTML = items.length === 0
        ? '<div class="tb-empty">Drop tasks here</div>'
        : items.map(t => taskHTML(t, b)).join('');
      const cnt = document.getElementById('tc-' + b);
      if (cnt) cnt.textContent = items.length;
      const hdr = document.getElementById('th-' + b);
      if (hdr) hdr.textContent = bucketNames[b] || DEFAULT_NAMES[b];
    });
    attachTaskEvents();
  }

  function taskHTML(t, b) {
    const isOpen = t.open ? 'open' : '';
    const isRecurring = b === 'recurring';
    const isProject = b === 'projects';
    const subs = t.subs || [];
    const doneCount = subs.filter(s => s.done).length;
    const meta = t.added ? 'Added ' + t.added : '';
    const moveBtns = ['this-week','recurring','projects','waiting']
      .filter(x => x !== b)
      .map(x => `<button class="tb-mv" onclick="tbMove_${slug}('${t.id}','${x}')">${bucketNames[x]||DEFAULT_NAMES[x]}</button>`)
      .join('');

    const subsHTML = subs.map(s => `
      <div class="tb-sub">
        <input type="checkbox" class="tb-subcheck" ${s.done?'checked':''} onchange="tbToggleSub_${slug}('${t.id}','${s.id}')">
        <span class="tb-subtext${s.done?' tb-subdone':''}">${esc(s.text)}</span>
        <button class="tb-subdel" onclick="tbDelSub_${slug}('${t.id}','${s.id}')">&#x2715;</button>
      </div>`).join('');

    const statusPill = isProject
      ? `<span class="tb-status ${t.status==='in-progress'?'tb-status-progress':'tb-status-new'}" onclick="tbCycleStatus_${slug}('${t.id}')">${t.status==='in-progress'?'In Progress':'Not Started'}</span>`
      : '';

    const recurringCheck = isRecurring
      ? `<input type="checkbox" class="tb-rcheck" ${t.done?'checked':''} onchange="tbToggleRecurring_${slug}('${t.id}')">`
      : '';

    return `<div class="tb-task${t.done&&isRecurring?' tb-rdone':''}" id="tbt-${t.id}" draggable="true">
      <div class="tb-task-top">
        ${recurringCheck}
        <div class="tb-task-body">
          <div class="tb-task-text${t.done&&isRecurring?' tb-text-done':''}" id="tbtxt-${t.id}">${esc(t.text)}</div>
          ${statusPill}
          <div class="tb-meta">${meta}${subs.length?' &bull; '+doneCount+'/'+subs.length+' steps':''}</div>
        </div>
        <div class="tb-task-btns">
          <button class="tb-del" onclick="tbDel_${slug}('${t.id}')">&#x2715;</button>
          <button class="tb-edit" onclick="tbEdit_${slug}('${t.id}')">&#9998;</button>
          <button class="tb-exp" onclick="tbTog_${slug}('${t.id}')">${isOpen?'&#9650;':'&#9660;'}</button>
        </div>
      </div>
      <div class="tb-detail ${isOpen}" id="tbd-${t.id}">
        <div class="tb-detail-label">Notes &amp; links</div>
        <textarea class="tb-notes" id="tbn-${t.id}" onblur="tbSaveNotes_${slug}('${t.id}')" placeholder="Notes, links, ideas...">${esc(t.notes||'')}</textarea>
        <div class="tb-subs-section">
          <div class="tb-detail-label">Steps / dependencies</div>
          <div id="tbsubs-${t.id}">${subsHTML}</div>
          <div class="tb-add-sub-row">
            <input type="text" class="tb-sub-inp" id="tbsi-${t.id}" placeholder="Add a step..." onkeydown="if(event.key==='Enter')tbAddSub_${slug}('${t.id}')">
            <button class="tb-sub-btn" onclick="tbAddSub_${slug}('${t.id}')">+ Step</button>
          </div>
        </div>
        <div class="tb-move-row"><span class="tb-move-lbl">Move to:</span>${moveBtns}</div>
      </div>
    </div>`;
  }

  function attachTaskEvents() {
    document.querySelectorAll('[id^="tbt-"]').forEach(el => {
      el.addEventListener('dragstart', e => {
        if (e.target && e.target.closest && e.target.closest('input, textarea')) { e.preventDefault(); return; }
        dragId = el.id.replace('tbt-','');
        setTimeout(() => el.classList.add('tb-dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragover', e => {
        e.preventDefault();
        document.querySelectorAll('.tb-drop-above,.tb-drop-below').forEach(x => x.classList.remove('tb-drop-above','tb-drop-below'));
        const rect = el.getBoundingClientRect();
        dropTarget = el.id.replace('tbt-','');
        if (e.clientY < rect.top + rect.height/2) { el.classList.add('tb-drop-above'); dropPos = 'above'; }
        else { el.classList.add('tb-drop-below'); dropPos = 'below'; }
      });
      el.addEventListener('drop', e => { e.stopPropagation(); });
      // Firefox will not place a text caret inside an input or textarea whose ancestor
      // is draggable=true: it claims the mousedown as the start of a card drag before
      // any caret lands, and cancelling dragstart afterward does not bring the caret
      // back. So while any field inside the card is focused we turn the card's
      // draggability off, and restore it on blur. The next renderBoard rebuilds the
      // card with draggable=true regardless, so nothing needs to be reset by hand.
      el.addEventListener('focusin', e => { if (e.target && e.target.closest && e.target.closest('input, textarea')) el.draggable = false; });
      el.addEventListener('focusout', () => { el.draggable = true; });
    });
  }

  // ---------- Global functions for this board instance ----------
  window['tbMove_' + slug] = (id, bucket) => {
    if (tasks[id]) { tasks[id].bucket = bucket; tasks[id].order = nextOrder(bucket); touch(id); commit(); }
  };
  window['tbDel_' + slug] = (id) => {
    if (tasks[id]) {
      delete tasks[id];
      delete pending.upserts[id];
      pending.deletes[id] = true;
      commit();
    }
  };
  window['tbTog_' + slug] = (id) => {
    if (tasks[id]) { tasks[id].open = !tasks[id].open; renderBoard(); } // open state is view-only, not persisted
  };
  window['tbEdit_' + slug] = (id) => {
    const el = document.getElementById('tbtxt-'+id);
    if (!el || !tasks[id]) return;
    const val = tasks[id].text;
    el.outerHTML = `<input class="tb-edit-inp" id="tbedit-${id}" value="${val.replace(/"/g,'&quot;')}" onblur="tbSaveEdit_${slug}('${id}')" onkeydown="if(event.key==='Enter')tbSaveEdit_${slug}('${id}');if(event.key==='Escape')renderBoard_${slug}()">`;
    const inp = document.getElementById('tbedit-'+id);
    if (inp) { inp.focus(); inp.select(); }
  };
  window['tbSaveEdit_' + slug] = (id) => {
    const inp = document.getElementById('tbedit-'+id);
    if (inp && tasks[id]) { if(inp.value.trim()) tasks[id].text = inp.value.trim(); touch(id); commit(); }
  };
  window['renderBoard_' + slug] = renderBoard;
  window['tbSaveNotes_' + slug] = (id) => {
    const el = document.getElementById('tbn-'+id);
    if (el && tasks[id] && tasks[id].notes !== el.value) { tasks[id].notes = el.value; touch(id); commit(); }
  };
  window['tbToggleSub_' + slug] = (tid, sid) => {
    if (!tasks[tid]) return;
    const sub = (tasks[tid].subs||[]).find(s => s.id === sid);
    if (sub) sub.done = !sub.done;
    touch(tid); commit();
  };
  window['tbDelSub_' + slug] = (tid, sid) => {
    if (!tasks[tid]) return;
    tasks[tid].subs = (tasks[tid].subs||[]).filter(s => s.id !== sid);
    touch(tid); commit();
  };
  window['tbAddSub_' + slug] = (tid) => {
    const inp = document.getElementById('tbsi-'+tid);
    if (!inp || !tasks[tid]) return;
    const text = inp.value.trim();
    if (!text) return;
    if (!tasks[tid].subs) tasks[tid].subs = [];
    tasks[tid].subs.push({ id: uid('s'), text, done:false });
    tasks[tid].open = true;
    touch(tid); commit();
  };
  window['tbCycleStatus_' + slug] = (id) => {
    if (!tasks[id]) return;
    tasks[id].status = tasks[id].status === 'in-progress' ? 'not-started' : 'in-progress';
    touch(id); commit();
  };
  window['tbToggleRecurring_' + slug] = (id) => {
    if (!tasks[id]) return;
    tasks[id].done = !tasks[id].done;
    touch(id); commit();
  };

  // Add task
  window['tbAdd_' + slug] = () => {
    const inp = document.getElementById('tb-add-inp');
    const bucketEl = document.getElementById('tb-add-bucket');
    if (!inp || !bucketEl) return;
    const bucket = bucketEl.value;
    const text = inp.value.trim();
    if (!text) return;
    const id = uid('t');
    tasks[id] = { id, text, notes:'', bucket, added:fmtDate(new Date()), open:false, subs:[], status:'not-started', done:false, order: nextOrder(bucket) };
    touch(id); commit();
    inp.value = ''; inp.focus();
  };

  // Edit bucket names
  window['tbRenameBucket_' + slug] = (b) => {
    if (LOCKED.includes(b)) return;
    const hdr = document.getElementById('th-'+b);
    if (!hdr) return;
    const cur = hdr.textContent;
    hdr.outerHTML = `<input class="tb-bucket-name-inp" id="thr-${b}" value="${cur.replace(/"/g,'&quot;')}" onblur="tbSaveBucketName_${slug}('${b}')" onkeydown="if(event.key==='Enter')tbSaveBucketName_${slug}('${b}')">`;
    const inp = document.getElementById('thr-'+b);
    if (inp) { inp.focus(); inp.select(); }
  };
  window['tbSaveBucketName_' + slug] = (b) => {
    const inp = document.getElementById('thr-'+b);
    if (!inp) return;
    bucketNames[b] = inp.value.trim() || DEFAULT_NAMES[b];
    pending.buckets = true;
    commit();
  };

  // Monday reset for recurring tasks (once per Monday per device; changes sync up).
  function checkMondayReset() {
    const today = new Date();
    if (today.getDay() !== 1) return;
    const todayStr = today.toDateString();
    let last = null;
    try { last = localStorage.getItem(RESET_KEY); } catch(_) {}
    if (last === todayStr) return;
    let changed = false;
    Object.values(tasks).forEach(t => {
      if (t.bucket === 'recurring' && t.done) { t.done = false; touch(t.id); changed = true; }
    });
    try { localStorage.setItem(RESET_KEY, todayStr); } catch(_) {}
    if (changed) { saveCache(); scheduleSync(true); }
  }

  // Column drag/drop reordering
  document.querySelectorAll('.tb-col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('tb-col-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('tb-col-over'));
    col.addEventListener('drop', e => {
      e.preventDefault();
      col.classList.remove('tb-col-over');
      document.querySelectorAll('.tb-drop-above,.tb-drop-below,.tb-dragging').forEach(x => {
        x.classList.remove('tb-drop-above','tb-drop-below','tb-dragging');
      });
      if (!dragId || !tasks[dragId]) return;
      const bucket = col.dataset.bucket;
      const moved = new Set([dragId]);
      tasks[dragId].bucket = bucket;
      if (dropTarget && tasks[dropTarget] && dropTarget !== dragId) {
        const sorted = Object.values(tasks).filter(t => t.bucket === bucket && t.id !== dragId)
          .sort((a,b) => (a.order||0)-(b.order||0));
        const idx = sorted.findIndex(t => t.id === dropTarget);
        if (idx >= 0) sorted.splice(dropPos === 'above' ? idx : idx+1, 0, tasks[dragId]);
        else sorted.push(tasks[dragId]);
        sorted.forEach((t,i) => { if (t.order !== i*10) { t.order = i*10; moved.add(t.id); } });
      } else {
        tasks[dragId].order = nextOrder(bucket);
      }
      moved.forEach(id => touch(id));
      dragId = null; dropTarget = null; dropPos = null;
      commit(true);
    });
  });

  // ---------- Init ----------
  loadCache();
  ensureStatusEl();
  renderBoard();          // instant render from cache
  reconcile().then(() => { checkMondayReset(); }); // then reconcile against the sheet

  // Pull fresh when the connection returns or the tab is refocused, so a task added on
  // one device shows up on another without a manual hard refresh. The refocus pull is
  // throttled so switching apps repeatedly on a phone does not hammer the slow sheet API.
  window.addEventListener('online', () => { if (!syncing) reconcile(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || syncing) return;
    if (Date.now() - lastReconcile < 30000) return; // at most once every 30s on refocus
    reconcile();
  });

  const addInp = document.getElementById('tb-add-inp');
  if (addInp) addInp.addEventListener('keydown', e => { if(e.key==='Enter') window['tbAdd_' + slug](); });
}
