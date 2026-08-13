/* Window Works Team Portal - light PIN gate for employee dashboards.
   - An employee unlocks with their own PIN (stored in Employee_Records).
   - Rose or Justin can unlock any dashboard with their own PIN, and their own pages
     mark the session as owner so they are never prompted again.
   - Brandon's PIN unlocks any page and grants admin roam (approver tier, not owner).
   - If an employee has no PIN set yet, their dashboard is not gated, so nobody is
     locked out before PINs are configured. The gate turns on once a PIN exists.
   This is a convenience gate, not hard security: the data connection is still open.

   v207 notes:
   - Pages that do not declare window.WW_EMPLOYEE return immediately instead of
     building the overlay. index.html and resources.html do not load this file today,
     so this changes nothing live; it stops a future page from being locked out of a
     PIN screen it has no api() to satisfy.
   - An unlock now persists on the device for UNLOCK_DAYS, mirrored into sessionStorage
     so wwIsOwner() in rose.html and justin.html and isAdmin() in docnaming.js keep
     reading the same flags they always have.
   - The PIN read retries with a timeout instead of treating one failed fetch as
     "no PINs exist", which used to turn every correct PIN into "Incorrect PIN" until
     a full reload. A failed load says so and offers Retry.
   - A PIN typed before the read finishes is held and checked automatically when the
     read lands, instead of dead ending on "One moment". */
(function(){
  var EMP = (window.WW_EMPLOYEE || '').trim();
  if (!EMP) return; // ungated: no employee declared on this page

  var UNLOCK_DAYS = 30; // how long one PIN entry lasts on this device

  var OWNER_KEY = 'ww_owner';
  var ADMIN_KEY = 'ww_admin';
  var UNLOCK_KEY = 'ww_unlock_' + EMP;
  var STORE_KEY = 'ww_gate';

  function ssGet(k){ try{ return sessionStorage.getItem(k); }catch(e){ return null; } }
  function ssSet(k,v){ try{ sessionStorage.setItem(k,v); }catch(e){} }
  function lsGet(){ try{ var s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; }catch(e){ return null; } }
  function lsSet(o){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(o)); }catch(e){} }
  function lsClear(){ try{ localStorage.removeItem(STORE_KEY); }catch(e){} }

  // Restore a still valid device unlock into this session before anything reads the flags.
  var saved = lsGet();
  if (saved && Number(saved.exp) > Date.now()) {
    if (saved.emp === EMP || saved.owner === 1 || saved.admin === 1) {
      ssSet(UNLOCK_KEY,'1');
      if (saved.owner === 1) ssSet(OWNER_KEY,'1');
      if (saved.admin === 1) ssSet(ADMIN_KEY,'1');
    }
  } else if (saved) {
    lsClear();
  }

  // Already an owner or admin this session, or this dashboard already unlocked: no gate.
  if (ssGet(OWNER_KEY) === '1' || ssGet(ADMIN_KEY) === '1' || ssGet(UNLOCK_KEY) === '1') return;

  var pins = { emp:'', rose:'', justin:'', brandon:'' };
  var state = 'loading'; // loading, ready, failed
  var attempts = 0;
  var MAX_ATTEMPTS = 4;
  var apiWaits = 0;
  var MAX_API_WAITS = 80; // about 12 seconds at 150ms
  var pending = null;

  var ov = document.createElement('div');
  ov.id = 'ww-gate';
  ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-family:Barlow,Arial,sans-serif';
  ov.innerHTML =
    '<div style="background:#edeae4;border-radius:10px;padding:36px 30px;max-width:330px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.45)">' +
      '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-weight:800;font-size:22px;letter-spacing:0.12em;text-transform:uppercase;color:#1a1a1a">WINDOW <span style="color:#c4581f">WORKS</span></div>' +
      '<div style="font-size:13px;color:#888;margin:6px 0 22px">Enter your PIN to continue</div>' +
      '<input id="ww-gate-pin" type="password" inputmode="numeric" enterkeyhint="go" maxlength="8" autocomplete="one-time-code" autocapitalize="off" autocorrect="off" spellcheck="false" style="width:100%;padding:12px;font-size:18px;text-align:center;letter-spacing:6px;border:1px solid #c9bfae;border-radius:6px;background:#fff;color:#1a1a1a;outline:none">' +
      '<div id="ww-gate-err" style="color:#c0392b;font-size:13px;min-height:18px;margin:8px 0"></div>' +
      '<button id="ww-gate-btn" type="button" style="width:100%;padding:12px;background:#c4581f;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:15px;letter-spacing:0.05em;text-transform:uppercase;cursor:pointer">Unlock</button>' +
    '</div>';

  function attach(){
    document.body.appendChild(ov);
    var i = document.getElementById('ww-gate-pin');
    if (i) {
      i.focus();
      i.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); onSubmit(); }
      });
      i.addEventListener('input', function(){ if (state !== 'failed') setErr(''); });
    }
  }
  function showOverlay(){
    if (document.body) attach();
    else document.addEventListener('DOMContentLoaded', attach);
  }
  function removeOverlay(){ var e = document.getElementById('ww-gate'); if (e && e.parentNode) e.parentNode.removeChild(e); }
  function setErr(m){ var e = document.getElementById('ww-gate-err'); if (e) e.textContent = m || ''; }
  function setBtn(label, busy){
    var b = document.getElementById('ww-gate-btn');
    if (!b) return;
    b.textContent = label;
    b.disabled = !!busy;
    b.style.opacity = busy ? '0.6' : '1';
  }
  showOverlay();

  function withTimeout(p, ms){
    return new Promise(function(resolve, reject){
      var t = setTimeout(function(){ reject(new Error('timeout')); }, ms);
      p.then(function(v){ clearTimeout(t); resolve(v); }, function(e){ clearTimeout(t); reject(e); });
    });
  }

  function markFailed(){
    state = 'failed';
    setErr('Cannot reach records. Tap retry.');
    setBtn('Retry', false);
  }

  // api() and cols() are defined by the page's own script, available by DOMContentLoaded.
  function loadPins(){
    if (state === 'ready') return;
    if (typeof api !== 'function' || typeof cols !== 'function') {
      apiWaits++;
      if (apiWaits > MAX_API_WAITS) { markFailed(); return; }
      setTimeout(loadPins, 150);
      return;
    }
    attempts++;
    withTimeout(api({ action:'read', tab:'Employee_Records' }), 15000).then(function(d){
      if (!d || !d.success || !d.data || d.data.length < 2) throw new Error('empty read');
      var c = cols(d.data[0]);
      var ei = c('Employee'), pi = c('PIN');
      pins = { emp:'', rose:'', justin:'', brandon:'' };
      d.data.slice(1).forEach(function(r){
        var n = (r[ei] == null ? '' : r[ei]).toString().trim();
        var p = (r[pi] == null ? '' : r[pi]).toString().trim();
        if (n === EMP) pins.emp = p;
        if (n === 'Rose Reif') pins.rose = p;
        if (n === 'Justin Reif') pins.justin = p;
        if (n === 'Brandon McClure') pins.brandon = p;
      });
      state = 'ready';
      attempts = 0;
      setErr('');
      setBtn('Unlock', false);
      if (!pins.emp) { removeOverlay(); return; } // no PIN set for this person yet: not gated
      if (pending !== null) { var held = pending; pending = null; check(held); }
    }).catch(function(){
      if (attempts < MAX_ATTEMPTS) {
        setErr('Connecting...');
        setTimeout(loadPins, 1200 * attempts);
      } else {
        markFailed();
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadPins);
  else loadPins();

  // Retry on the two events that usually mean the phone is back on a usable connection.
  function retry(){
    if (state !== 'failed') return;
    attempts = 0;
    apiWaits = 0;
    state = 'loading';
    setErr('Connecting...');
    setBtn('Unlock', true);
    loadPins();
  }
  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) retry(); });

  var OWNER_NAMES = ['Rose Reif','Justin Reif'];
  var ADMIN_NAMES = ['Rose Reif','Justin Reif','Brandon McClure'];

  function persist(asOwner, asAdmin){
    ssSet(UNLOCK_KEY,'1');
    if (asOwner) ssSet(OWNER_KEY,'1');
    if (asAdmin) ssSet(ADMIN_KEY,'1');
    lsSet({ emp:EMP, owner: asOwner ? 1 : 0, admin: asAdmin ? 1 : 0, exp: Date.now() + UNLOCK_DAYS * 86400000 });
  }
  function doUnlock(asOwner, asAdmin){
    persist(asOwner, asAdmin);
    removeOverlay();
    try { document.dispatchEvent(new CustomEvent('ww-auth',{ detail:{ owner:!!asOwner, admin:!!asAdmin } })); } catch(e){}
  }

  // Sheets can hand back a PIN as a number, which drops any leading zero, so compare
  // the trimmed strings first and then a zero stripped form as a fallback.
  function norm(v){ return (v == null ? '' : String(v)).trim().replace(/^0+(?=[0-9])/,''); }
  function same(a,b){
    if (!a || !b) return false;
    return String(a).trim() === String(b).trim() || norm(a) === norm(b);
  }
  function check(pin){
    setBtn('Unlock', false);
    if (same(pin, pins.emp)) { doUnlock(OWNER_NAMES.indexOf(EMP) >= 0, ADMIN_NAMES.indexOf(EMP) >= 0); return; }
    if (same(pin, pins.rose) || same(pin, pins.justin)) { doUnlock(true, true); return; }
    if (same(pin, pins.brandon)) { doUnlock(false, true); return; }
    setErr('Incorrect PIN');
    var inp = document.getElementById('ww-gate-pin');
    if (inp) { inp.value = ''; inp.focus(); }
  }
  function onSubmit(){
    var inp = document.getElementById('ww-gate-pin');
    if (!inp) return;
    var pin = (inp.value || '').replace(/[^0-9]/g,'');
    if (state === 'failed') { if (pin) pending = pin; retry(); return; }
    if (!pin) { setErr('Enter your PIN'); return; }
    if (state !== 'ready') { pending = pin; setErr('Checking your PIN...'); setBtn('Checking', true); return; }
    check(pin);
  }
  document.addEventListener('click', function(e){ if (e.target && e.target.id === 'ww-gate-btn') onSubmit(); });
  document.addEventListener('keydown', function(e){
    if ((e.key === 'Enter' || e.keyCode === 13) && document.getElementById('ww-gate')) onSubmit();
  });

  // Self-service PIN change, called from the My Record tab.
  window.wwChangePin = async function(){
    var a = document.getElementById('chpin-alert');
    function g(id){ var el = document.getElementById(id); return el ? (el.value || '').trim() : ''; }
    var cur = g('chpin-current'), n1 = g('chpin-new'), n2 = g('chpin-confirm');
    if (!n1) { if (a) a.innerHTML = '<div class="alert alert-error">Enter a new PIN.</div>'; return; }
    if (n1 !== n2) { if (a) a.innerHTML = '<div class="alert alert-error">New PINs do not match.</div>'; return; }
    if (!/^[0-9]{4,8}$/.test(n1)) { if (a) a.innerHTML = '<div class="alert alert-error">PIN must be 4 to 8 digits.</div>'; return; }
    try {
      var d = await api({ action:'read', tab:'Employee_Records' });
      var c = cols(d.data[0]); var ei = c('Employee'), pi = c('PIN');
      var idx = -1;
      for (var i = 1; i < d.data.length; i++) { if ((d.data[i][ei] || '').toString().trim() === EMP) { idx = i; break; } }
      if (idx < 0) { if (a) a.innerHTML = '<div class="alert alert-error">Record not found.</div>'; return; }
      var stored = (d.data[idx][pi] == null ? '' : d.data[idx][pi]).toString().trim();
      if (stored && !same(cur, stored)) { if (a) a.innerHTML = '<div class="alert alert-error">Current PIN is incorrect.</div>'; return; }
      var row = d.data[idx].slice();
      while (row.length < d.data[0].length) row.push('');
      row[pi] = n1;
      await api({ action:'update', tab:'Employee_Records', rowIndex: idx + 1, row: JSON.stringify(row) });
      pins.emp = n1;
      persist(ssGet(OWNER_KEY) === '1', ssGet(ADMIN_KEY) === '1');
      if (a) a.innerHTML = '<div class="alert alert-success">PIN updated.</div>';
      ['chpin-current','chpin-new','chpin-confirm'].forEach(function(id){ var el = document.getElementById(id); if (el) el.value=''; });
    } catch(e) { if (a) a.innerHTML = '<div class="alert alert-error">Error updating PIN. Please try again.</div>'; }
  };

  // Clears the device unlock, for a lost or shared phone.
  window.wwForgetDevice = function(){
    lsClear();
    try { sessionStorage.removeItem(OWNER_KEY); sessionStorage.removeItem(ADMIN_KEY); sessionStorage.removeItem(UNLOCK_KEY); } catch(e){}
    location.reload();
  };
})();
