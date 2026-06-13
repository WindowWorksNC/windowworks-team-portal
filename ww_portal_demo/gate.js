/* Window Works Team Portal - light PIN gate for employee dashboards.
   - An employee unlocks with their own PIN (stored in Employee_Records).
   - Olivia or Owen can unlock any dashboard with their own PIN, and their own pages
     mark the session as owner so they are never prompted again.
   - If an employee has no PIN set yet, their dashboard is not gated, so nobody is
     locked out before PINs are configured. The gate turns on once a PIN exists.
   This is a convenience gate, not hard security: the data connection is still open. */
(function(){
  var EMP = (window.WW_EMPLOYEE || '').trim();
  function ssGet(k){ try{ return sessionStorage.getItem(k); }catch(e){ return null; } }
  function ssSet(k,v){ try{ sessionStorage.setItem(k,v); }catch(e){} }
  var OWNER_KEY = 'ww_owner';
  var UNLOCK_KEY = 'ww_unlock_' + EMP;

  // Already an owner this session, or this dashboard already unlocked: no gate.
  if (ssGet(OWNER_KEY) === '1' || ssGet(UNLOCK_KEY) === '1') return;

  var pins = { emp:'', olivia:'', owen:'' };
  var loaded = false;

  var ov = document.createElement('div');
  ov.id = 'ww-gate';
  ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-family:Barlow,Arial,sans-serif';
  ov.innerHTML =
    '<div style="background:#edeae4;border-radius:10px;padding:36px 30px;max-width:330px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.45)">' +
      '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-weight:800;font-size:22px;letter-spacing:0.12em;text-transform:uppercase;color:#1a1a1a">WINDOW <span style="color:#c4581f">WORKS</span></div>' +
      '<div style="font-size:13px;color:#888;margin:6px 0 22px">Enter your PIN to continue</div>' +
      '<input id="ww-gate-pin" type="password" inputmode="numeric" autocomplete="off" style="width:100%;padding:12px;font-size:18px;text-align:center;letter-spacing:6px;border:1px solid #c9bfae;border-radius:6px;background:#fff;color:#1a1a1a;outline:none">' +
      '<div id="ww-gate-err" style="color:#c0392b;font-size:13px;min-height:18px;margin:8px 0"></div>' +
      '<button id="ww-gate-btn" type="button" style="width:100%;padding:12px;background:#c4581f;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:15px;letter-spacing:0.05em;text-transform:uppercase;cursor:pointer">Unlock</button>' +
    '</div>';

  function showOverlay(){
    if (document.body) { document.body.appendChild(ov); focusPin(); }
    else document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(ov); focusPin(); });
  }
  function focusPin(){ var i = document.getElementById('ww-gate-pin'); if (i) i.focus(); }
  function removeOverlay(){ var e = document.getElementById('ww-gate'); if (e) e.parentNode.removeChild(e); }
  function setErr(m){ var e = document.getElementById('ww-gate-err'); if (e) e.textContent = m || ''; }
  showOverlay();

  // api() and cols() are defined by the page's own script, available by DOMContentLoaded.
  function loadPins(){
    if (typeof api !== 'function') { setTimeout(loadPins, 150); return; }
    api({ action:'read', tab:'Employee_Records' }).then(function(d){
      if (!d || !d.success || !d.data || !d.data.length) { loaded = true; return; }
      var c = cols(d.data[0]);
      var ei = c('Employee'), pi = c('PIN');
      d.data.slice(1).forEach(function(r){
        var n = (r[ei] || '').toString().trim();
        var p = (r[pi] || '').toString().trim();
        if (n === EMP) pins.emp = p;
        if (n === 'Olivia Owner') pins.olivia = p;
        if (n === 'Owen Owner') pins.owen = p;
      });
      loaded = true;
      if (!pins.emp) removeOverlay(); // no PIN set for this person yet: not gated
    }).catch(function(){ loaded = true; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadPins);
  else loadPins();

  var OWNER_NAMES = ['Olivia Owner','Owen Owner'];
  function doUnlock(asOwner){ ssSet(UNLOCK_KEY,'1'); if (asOwner) ssSet(OWNER_KEY,'1'); removeOverlay(); }
  function tryUnlock(){
    var inp = document.getElementById('ww-gate-pin'); if (!inp) return;
    var pin = (inp.value || '').trim();
    if (!pin) { setErr('Enter your PIN'); return; }
    if (!loaded) { setErr('One moment...'); return; }
    // Own PIN: grants owner roam only if this page belongs to Olivia or Owen.
    if (pins.emp && pin === pins.emp) { doUnlock(OWNER_NAMES.indexOf(EMP) >= 0); return; }
    // Olivia's or Owen's PIN unlocks any page and grants owner roam for the session.
    if ((pins.olivia && pin === pins.olivia) || (pins.owen && pin === pins.owen)) { doUnlock(true); return; }
    setErr('Incorrect PIN'); inp.value=''; inp.focus();
  }
  document.addEventListener('click', function(e){ if (e.target && e.target.id === 'ww-gate-btn') tryUnlock(); });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Enter' && document.getElementById('ww-gate')) {
      var inp = document.getElementById('ww-gate-pin');
      if (inp && document.activeElement === inp) tryUnlock();
    }
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
      var stored = (d.data[idx][pi] || '').toString().trim();
      if (stored && cur !== stored) { if (a) a.innerHTML = '<div class="alert alert-error">Current PIN is incorrect.</div>'; return; }
      var row = d.data[idx].slice();
      while (row.length < d.data[0].length) row.push('');
      row[pi] = n1;
      await api({ action:'update', tab:'Employee_Records', rowIndex: idx + 1, row: JSON.stringify(row) });
      ssSet('ww_unlock_' + EMP, '1');
      if (a) a.innerHTML = '<div class="alert alert-success">PIN updated.</div>';
      ['chpin-current','chpin-new','chpin-confirm'].forEach(function(id){ var el = document.getElementById(id); if (el) el.value=''; });
    } catch(e) { if (a) a.innerHTML = '<div class="alert alert-error">Error updating PIN. Please try again.</div>'; }
  };
})();
