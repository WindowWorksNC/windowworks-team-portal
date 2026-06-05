/* ============================================================
   RECORD MODULE
   Handles employee record, documents, equipment display
   ============================================================ */

const ALL_DOCS_BASE = ['Offer Letter', 'Government ID', 'W-4', 'Direct Deposit Form', 'Employee Handbook Acknowledgment'];

async function loadRecord(config) {
  await Promise.all([
    loadEmployeeRecord(config),
    loadDocs(config),
    loadEquipmentDisplay(config),
  ]);
}

async function loadEmployeeRecord(config) {
  const loadEl = document.getElementById('record-loading');
  const contentEl = document.getElementById('record-content');
  try {
    const d = await api({ action: 'read', tab: 'Employee_Records' });
    if (loadEl) loadEl.style.display = 'none';
    if (!d.success) { if (contentEl) contentEl.style.display = 'block'; return; }
    const c = cols(d.data[0]);
    const row = d.data.slice(1).find(r => (r[c('Employee')] || '').trim() === config.name);
    if (contentEl) contentEl.style.display = 'block';
    const tbody = document.getElementById('record-body');
    if (!tbody) return;
    if (!row) { tbody.innerHTML = '<tr><td colspan="2" class="empty-state">No record on file yet.</td></tr>'; return; }
    const fields = [
      ['Role', row[c('Role')]],
      ['Hire Date', fmtDate(row[c('Hire Date')])],
      ['90-Day Review', fmtDate(row[c('Review Due 90Day')])],
      ['Annual Review Due', fmtDate(row[c('Review Due Annual')])],
      ['Last Review', fmtDate(row[c('Last Review')])],
      ['Next Review', fmtDate(row[c('Next Review')])],
      ['Status', row[c('Status')]],
    ];
    tbody.innerHTML = fields.map(([label, val]) => `<tr>
      <td style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#aaa;width:160px;white-space:nowrap">${label}</td>
      <td>${val || '<span style="color:#ddd">&mdash;</span>'}</td>
    </tr>`).join('');
    // Update hire-meta in header
    if (row[c('Hire Date')]) {
      const hm = document.getElementById('hire-meta');
      if (hm) hm.textContent = 'Hire date: ' + fmtDate(row[c('Hire Date')]);
    }
  } catch (e) { console.error('loadEmployeeRecord:', e); }
}

async function loadDocs(config) {
  const hasCommissionDoc = config.type === 'b2b' || config.type === 'b2c';
  const docs = [...ALL_DOCS_BASE];
  if (hasCommissionDoc) docs.push('Commission / Incentive Outline');
  try {
    const d = await api({ action: 'read', tab: 'Employee_Records' });
    const loadEl = document.getElementById('docs-loading');
    if (loadEl) loadEl.style.display = 'none';
    let docData = {};
    if (d.success) {
      const c = cols(d.data[0]);
      const row = d.data.slice(1).find(r => (r[c('Employee')] || '').trim() === config.name);
      const docsCol = c('Documents') >= 0 ? c('Documents') : 8;
      if (row && row[docsCol]) {
        try { docData = JSON.parse(row[docsCol]); } catch (e) {}
      }
    }
    const container = document.getElementById('docs-list');
    if (!container) return;
    const idExpiry = docData['Government ID - Expiry'] || '';
    container.innerHTML = docs.map(doc => {
      const url = docData[doc] || '';
      const isID = doc === 'Government ID';
      const safeDoc = doc.replace(/[^a-zA-Z0-9]/g, '-');
      const expirySection = isID ? `<div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
        <span class="${expiryClass(idExpiry)}" id="expiry-label">${expiryLabel(idExpiry)}</span>
        <input type="date" class="form-input" style="width:140px;font-size:12px;padding:4px 8px" id="expiry-input" value="${idExpiry}" oninput="saveExpiry('${config.name}')">
      </div>` : '';
      return `<div class="doc-row">
        <div><div class="doc-name">${doc}</div>${expirySection}</div>
        <div class="doc-actions">
          ${url ? `${presentPill()} <a class="doc-link" href="${url}" target="_blank">View</a>` : missingPill()}
          <input type="text" class="doc-input" id="doc-${safeDoc}" value="${url}" placeholder="Paste OneDrive link..." onblur="saveDocLink('${config.name}','${doc}',this.value)">
        </div>
      </div>`;
    }).join('');
  } catch (e) { console.error('loadDocs:', e); }
}

async function saveDocLink(employee, doc, url) {
  try {
    const d = await api({ action: 'read', tab: 'Employee_Records' });
    if (!d.success) return;
    const c = cols(d.data[0]);
    const rowIdx = d.data.findIndex(r => (r[c('Employee')] || '').trim() === employee);
    if (rowIdx < 0) return;
    const row = [...d.data[rowIdx]];
    const docsCol = c('Documents') >= 0 ? c('Documents') : 8;
    let docData = {};
    if (row[docsCol]) try { docData = JSON.parse(row[docsCol]); } catch (e) {}
    docData[doc] = url;
    row[docsCol] = JSON.stringify(docData);
    await api({ action: 'update', tab: 'Employee_Records', rowIndex: rowIdx + 1, row: JSON.stringify(row) });
  } catch (e) { console.error('saveDocLink:', e); }
}

async function saveExpiry(employee) {
  const val = document.getElementById('expiry-input')?.value || '';
  const label = document.getElementById('expiry-label');
  if (label) { label.className = expiryClass(val); label.textContent = expiryLabel(val); }
  try {
    const d = await api({ action: 'read', tab: 'Employee_Records' });
    if (!d.success) return;
    const c = cols(d.data[0]);
    const rowIdx = d.data.findIndex(r => (r[c('Employee')] || '').trim() === employee);
    if (rowIdx < 0) return;
    const row = [...d.data[rowIdx]];
    const docsCol = c('Documents') >= 0 ? c('Documents') : 8;
    let docData = {};
    if (row[docsCol]) try { docData = JSON.parse(row[docsCol]); } catch (e) {}
    docData['Government ID - Expiry'] = val;
    row[docsCol] = JSON.stringify(docData);
    await api({ action: 'update', tab: 'Employee_Records', rowIndex: rowIdx + 1, row: JSON.stringify(row) });
  } catch (e) { console.error('saveExpiry:', e); }
}

async function loadEquipmentDisplay(config) {
  const loadEl = document.getElementById('equip-loading');
  const listEl = document.getElementById('equip-list');
  const emptyEl = document.getElementById('equip-empty');
  try {
    const d = await api({ action: 'read', tab: 'Equipment' });
    if (loadEl) loadEl.style.display = 'none';
    if (!d.success) { if (emptyEl) emptyEl.style.display = 'block'; return; }
    const c = cols(d.data[0]);
    const rows = d.data.slice(1).filter(r => (r[c('Employee')] || '').trim() === config.name && r.some(x => x) && !(r[c('Date Returned')]));
    if (!rows.length) { if (emptyEl) emptyEl.style.display = 'block'; return; }
    if (listEl) {
      listEl.innerHTML = rows.map(r => `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0ece6;align-items:flex-start">
        <div>
          <div style="font-size:14px;font-weight:600">${r[c('Make Model')] || r[c('Item Type')] || ''}</div>
          <div style="font-size:12px;color:#888">${r[c('Item Type')] || ''}${r[c('Serial Number')] ? ' &bull; S/N: ' + r[c('Serial Number')] : ''}</div>
        </div>
        <div style="font-size:12px;color:#aaa;text-align:right">Issued ${fmtDate(r[c('Date Issued')])}</div>
      </div>`).join('');
    }
  } catch (e) {
    if (loadEl) loadEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    console.error('loadEquipmentDisplay:', e);
  }
}
