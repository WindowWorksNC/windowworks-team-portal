/* Window Works Team Portal - document file naming guide.
   Injects a "File naming guide" button into the Documents card on any record page.
   Visible only to admins (Rose, Justin, Brandon) via the gate's ww_admin session flag.
   The naming convention lives here as the single source of truth. */
(function(){
  function ssGet(k){ try { return sessionStorage.getItem(k); } catch(e){ return null; } }
  function isAdmin(){
    if (typeof window.wwDocsEditable === 'function') return window.wwDocsEditable();
    if (ssGet('ww_admin') === '1' || ssGet('ww_owner') === '1') return true;
    var emp = (window.WW_EMPLOYEE || '').trim();
    return ['Rose Reif','Justin Reif','Brandon McClure'].indexOf(emp) >= 0;
  }

  var DOC_CODES = [
    ['Employment Contract','EmploymentContract'],
    ['Commission Earnings Agreement (Sales Consultant)','EarningsCommission'],
    ['Performance Earnings Agreement (Project Manager)','EarningsPerformancePM'],
    ['Performance Earnings Agreement (Admin Professional)','EarningsPerformanceAdmin'],
    ['Lead Generation Agreement','LeadGeneration'],
    ['I-9 Authorization to Work in the US','I9'],
    ['Government ID','ID'],
    ['Company Policies','Policies'],
    ['Company Dress Code','DressCode'],
    ['PTO Policy','PTO'],
    ['W-4 Tax Form','W4'],
    ['Direct Deposit Form','DirectDeposit'],
    ['Equipment Assignment Form','EquipmentAssignment'],
    ['Emergency Contact and Medical Information','Emergency']
  ];

  function modalHTML(){
    var rows = DOC_CODES.map(function(r){
      return '<tr><td style="padding:5px 10px;border-bottom:1px solid #e8e2d6;font-size:13px;color:#333">'+r[0]+'</td>'+
             '<td style="padding:5px 10px;border-bottom:1px solid #e8e2d6;font-size:13px;font-family:monospace;color:#1a1a1a;white-space:nowrap">'+r[1]+'</td></tr>';
    }).join('');
    return '<div id="docname-modal" style="position:fixed;inset:0;z-index:100000;background:rgba(26,26,26,0.55);display:none;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto;font-family:Barlow,Arial,sans-serif">'+
      '<div style="background:#f5ede0;border-radius:10px;max-width:640px;width:100%;box-shadow:0 24px 70px rgba(0,0,0,0.4);overflow:hidden">'+
        '<div style="background:#1a1a1a;padding:16px 22px;display:flex;align-items:center;justify-content:space-between">'+
          '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-weight:800;font-size:18px;letter-spacing:0.1em;text-transform:uppercase;color:#fff">File Naming Guide</div>'+
          '<button id="docname-close" type="button" style="background:none;border:none;color:#bbb;font-size:24px;line-height:1;cursor:pointer;padding:0 4px">&times;</button>'+
        '</div>'+
        '<div style="padding:22px;max-height:70vh;overflow:auto">'+
          '<div style="font-size:14px;color:#333;line-height:1.55">Name every signed copy with this pattern, and keep one folder per person:</div>'+
          '<div style="background:#fff;border:1px solid #e4dbd0;border-radius:6px;padding:12px 14px;margin:12px 0;font-family:monospace;font-size:14px;color:#c4581f;text-align:center">YYYY-MM-DD_DocCode_Lastname-Firstname.ext</div>'+
          '<div style="font-size:13px;color:#555;line-height:1.55;margin-bottom:16px">Date first so each person\'s folder reads as a clean timeline, then the document code, then the name. The DocCode is fixed and matches the row in this portal exactly:</div>'+
          '<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e4dbd0;border-radius:6px;overflow:hidden;margin-bottom:18px">'+
            '<tr><th style="text-align:left;padding:7px 10px;background:#edeae4;font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#888">Portal document</th>'+
            '<th style="text-align:left;padding:7px 10px;background:#edeae4;font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#888">DocCode</th></tr>'+
            rows+
          '</table>'+
          '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#c4581f;margin-bottom:8px">Examples</div>'+
          '<div style="font-family:monospace;font-size:12.5px;color:#333;line-height:1.7;margin-bottom:18px">'+
            '2025-03-10_EmploymentContract_Glenn-Colin.pdf<br>'+
            '2025-03-10_EarningsCommission_Glenn-Colin.pdf<br>'+
            '2024-11-02_EarningsPerformancePM_Howze-Keith.pdf<br>'+
            '2025-03-10_I9_Glenn-Colin.pdf<br>'+
            '2024-02-25_ID_Glenn-Colin.pdf'+
          '</div>'+
          '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#c4581f;margin-bottom:8px">Rules</div>'+
          '<ul style="font-size:13px;color:#444;line-height:1.6;margin:0;padding-left:18px">'+
            '<li>The date is the signature or effective date. For a Government ID it is the issue date printed on the ID, not the day the copy was made; the expiration is tracked here in the portal, not in the filename.</li>'+
            '<li>One document per file. The contract and the earnings agreement are signed together but stay two files, since they are two rows here.</li>'+
            '<li>Re-signs never overwrite. A re-signed document is a new file with the new date; keep the older copy for the audit trail. Add _v2 before the extension only if two files would otherwise collide on date, code, and name.</li>'+
            '<li>Lowercase extension, no spaces.</li>'+
          '</ul>'+
        '</div>'+
      '</div>'+
    '</div>';
  }

  function ensureModal(){
    if (document.getElementById('docname-modal')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = modalHTML();
    document.body.appendChild(wrap.firstChild);
    var m = document.getElementById('docname-modal');
    var x = document.getElementById('docname-close');
    if (x) x.addEventListener('click', hide);
    if (m) m.addEventListener('click', function(e){ if (e.target === m) hide(); });
  }
  function show(){ ensureModal(); var m = document.getElementById('docname-modal'); if (m) m.style.display = 'flex'; }
  function hide(){ var m = document.getElementById('docname-modal'); if (m) m.style.display = 'none'; }
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') hide(); });

  // Two cards can host the guide: the personal Documents card on every page, and
  // the Employee Documents card on Brandon's Team Management view.
  var TARGETS = [['docs-list','docname-btn'], ['docs-admin-list','docname-btn-admin']];

  function refresh(){
    var on = isAdmin();
    TARGETS.forEach(function(t){
      var b = document.getElementById(t[1]);
      if (b) b.style.display = on ? 'inline-block' : 'none';
    });
  }

  function injectButton(){
    TARGETS.forEach(function(t){
      var list = document.getElementById(t[0]);
      if (!list) return;
      var card = list.closest('.card');
      if (!card) return;
      var title = card.querySelector('.card-title');
      if (!title || document.getElementById(t[1])) return;
      var btn = document.createElement('button');
      btn.id = t[1];
      btn.type = 'button';
      btn.textContent = 'File naming guide';
      btn.style.cssText = 'display:none;font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#c4581f;background:#fff;border:1px solid #c4581f;border-radius:4px;padding:4px 10px;cursor:pointer;margin-left:10px';
      btn.addEventListener('click', show);
      title.appendChild(btn);
    });
    refresh();
  }

  function init(){ injectButton(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('ww-auth', refresh);
})();
