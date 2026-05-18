// Task board - call initTaskBoard(slug) after including this script
// TASK BOARD
function initTaskBoard(slug) {
  const TKEY = 'ww_tasks_' + slug;
  const NKEY = 'ww_bucket_names_' + slug;
  const DEFAULT_NAMES = {
    'this-week': 'This Week',
    'recurring': 'Recurring',
    'projects': 'Larger Projects',
    'waiting': 'Waiting On'
  };
  const BUCKETS = ['this-week','recurring','projects','waiting'];
  const LOCKED = ['recurring'];
  let tasks = {}, nextId = 1, dragId = null, dropTarget = null, dropPos = null;

  function getBucketNames() {
    try { return JSON.parse(localStorage.getItem(NKEY)) || {...DEFAULT_NAMES}; }
    catch(e) { return {...DEFAULT_NAMES}; }
  }
  function saveBucketNames(names) {
    localStorage.setItem(NKEY, JSON.stringify(names));
  }
  function save() {
    try { localStorage.setItem(TKEY, JSON.stringify({tasks, nextId})); } catch(e) {}
  }
  function load() {
    try {
      const d = localStorage.getItem(TKEY);
      if (d) { const p = JSON.parse(d); tasks = p.tasks; nextId = p.nextId; return; }
    } catch(e) {}
    tasks = {}; nextId = 1;
  }
);
  }
  function esc(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderBoard() {
    const names = getBucketNames();
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
      // bucket name header
      const hdr = document.getElementById('th-' + b);
      if (hdr) hdr.textContent = names[b] || DEFAULT_NAMES[b];
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
      .map(x => {
        const names = getBucketNames();
        return `<button class="tb-mv" onclick="tbMove_${slug}('${t.id}','${x}')">${names[x]||DEFAULT_NAMES[x]}</button>`;
      }).join('');

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
        dragId = el.id.replace('tbt-','');
        setTimeout(() => el.classList.add('tb-dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragover', e => {
        e.preventDefault();
        document.querySelectorAll('.tb-drop-above,.tb-drop-below').forEach(x => x.classList.remove('tb-drop-above','tb-drop-below'));
        const rect = el.getBoundingClientRect();
        dropTarget = el.id.replace('tbt-','');
        if (e.clientY < rect.top + rect.height/2) {
          el.classList.add('tb-drop-above'); dropPos = 'above';
        } else {
          el.classList.add('tb-drop-below'); dropPos = 'below';
        }
      });
      el.addEventListener('drop', e => {
        e.stopPropagation();
      });
    });
  }

  // Global functions for this board instance
  window['tbMove_' + slug] = (id, bucket) => {
    if (tasks[id]) tasks[id].bucket = bucket;
    save(); renderBoard();
  };
  window['tbDel_' + slug] = (id) => {
    delete tasks[id]; save(); renderBoard();
  };
  window['tbTog_' + slug] = (id) => {
    if (tasks[id]) tasks[id].open = !tasks[id].open;
    save(); renderBoard();
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
    if (inp && tasks[id]) { if(inp.value.trim()) tasks[id].text = inp.value.trim(); save(); renderBoard(); }
  };
  window['renderBoard_' + slug] = renderBoard;
  window['tbSaveNotes_' + slug] = (id) => {
    const el = document.getElementById('tbn-'+id);
    if (el && tasks[id]) { tasks[id].notes = el.value; save(); }
  };
  window['tbToggleSub_' + slug] = (tid, sid) => {
    if (!tasks[tid]) return;
    const sub = tasks[tid].subs.find(s => s.id === sid);
    if (sub) sub.done = !sub.done;
    save(); renderBoard();
  };
  window['tbDelSub_' + slug] = (tid, sid) => {
    if (!tasks[tid]) return;
    tasks[tid].subs = tasks[tid].subs.filter(s => s.id !== sid);
    save(); renderBoard();
  };
  window['tbAddSub_' + slug] = (tid) => {
    const inp = document.getElementById('tbsi-'+tid);
    if (!inp || !tasks[tid]) return;
    const text = inp.value.trim();
    if (!text) return;
    tasks[tid].subs.push({id:'s'+nextId++, text, done:false});
    save(); renderBoard();
  };
  window['tbCycleStatus_' + slug] = (id) => {
    if (!tasks[id]) return;
    tasks[id].status = tasks[id].status === 'in-progress' ? 'not-started' : 'in-progress';
    save(); renderBoard();
  };
  window['tbToggleRecurring_' + slug] = (id) => {
    if (!tasks[id]) return;
    tasks[id].done = !tasks[id].done;
    save(); renderBoard();
  };

  // Add task
  window['tbAdd_' + slug] = () => {
    const inp = document.getElementById('tb-add-inp');
    const bucket = document.getElementById('tb-add-bucket').value;
    const text = inp.value.trim();
    if (!text) return;
    const id = 'i' + nextId++;
    tasks[id] = {id, text, notes:'', bucket, added:fmtDate(new Date()), open:false, subs:[], status:'not-started', done:false, order:nextId};
    save(); renderBoard();
    inp.value = ''; inp.focus();
  };

  // Edit bucket names
  window['tbRenameBucket_' + slug] = (b) => {
    if (LOCKED.includes(b)) return;
    const hdr = document.getElementById('th-'+b);
    if (!hdr) return;
    const cur = hdr.textContent;
    hdr.outerHTML = `<input class="tb-bucket-name-inp" id="thr-${b}" value="${cur}" onblur="tbSaveBucketName_${slug}('${b}')" onkeydown="if(event.key==='Enter')tbSaveBucketName_${slug}('${b}')">`;
    const inp = document.getElementById('thr-'+b);
    if (inp) { inp.focus(); inp.select(); }
  };
  window['tbSaveBucketName_' + slug] = (b) => {
    const inp = document.getElementById('thr-'+b);
    if (!inp) return;
    const names = getBucketNames();
    names[b] = inp.value.trim() || DEFAULT_NAMES[b];
    saveBucketNames(names);
    renderBoard();
  };

  // Monday reset for recurring
  function checkMondayReset() {
    const today = new Date();
    if (today.getDay() !== 1) return;
    const lastReset = localStorage.getItem('ww_monday_reset_' + slug);
    const todayStr = today.toDateString();
    if (lastReset === todayStr) return;
    Object.values(tasks).forEach(t => {
      if (t.bucket === 'recurring') t.done = false;
    });
    localStorage.setItem('ww_monday_reset_' + slug, todayStr);
    save();
  }

  // Column drag/drop
  document.querySelectorAll('.tb-col').forEach(col => {
    col.addEventListener('dragover', e => {
      e.preventDefault();
      col.classList.add('tb-col-over');
    });
    col.addEventListener('dragleave', () => col.classList.remove('tb-col-over'));
    col.addEventListener('drop', e => {
      e.preventDefault();
      col.classList.remove('tb-col-over');
      document.querySelectorAll('.tb-drop-above,.tb-drop-below,.tb-dragging').forEach(x => {
        x.classList.remove('tb-drop-above','tb-drop-below','tb-dragging');
      });
      if (!dragId || !tasks[dragId]) return;
      const bucket = col.dataset.bucket;
      tasks[dragId].bucket = bucket;
      if (dropTarget && tasks[dropTarget] && dropTarget !== dragId) {
        const sorted = Object.values(tasks).filter(t => t.bucket === bucket && t.id !== dragId)
          .sort((a,b) => (a.order||0)-(b.order||0));
        const idx = sorted.findIndex(t => t.id === dropTarget);
        if (idx >= 0) sorted.splice(dropPos === 'above' ? idx : idx+1, 0, tasks[dragId]);
        else sorted.push(tasks[dragId]);
        sorted.forEach((t,i) => t.order = i*10);
      }
      dragId = null; dropTarget = null; dropPos = null;
      save(); renderBoard();
    });
  });

  load();
  checkMondayReset();
  renderBoard();

  // Enter to add
  const addInp = document.getElementById('tb-add-inp');
  if (addInp) addInp.addEventListener('keydown', e => { if(e.key==='Enter') window['tbAdd_' + slug](); });
}

initTaskBoard("colin");