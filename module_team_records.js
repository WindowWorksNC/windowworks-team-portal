/* ============================================================
   TEAM RECORDS MODULE
   Employee records admin -- edit, equipment management
   ============================================================ */

let _currentEditEmployee = null;
let _employeeRecordsData = null;

async function loadTeamRecords(config) {
  const loadEl = document.getElementById('records-loading');
  try {
    const d = await api({ action: 'read', tab: 'Employee_Records' });
    _employeeRecordsData = d;
    if (loadEl) loadEl.style.display = 'none';
    if (!d.success) return;
    const c = cols(d.data[0]);
    const rows = d.data.slice(1).filter(r => r[c('Employee')]);

    // Expiry alerts
    const expiring = rows.filter(r => {
      let expiry = '';
      const docsCol = c('Documents') >= 0 ? c('Documents') : 8;
      if (r[docsCol]) try { expiry = JSON.parse(r[docsCol])['Government ID - Expiry'] || ''; } catch(e) {}
      const d = expiryDays(expiry);
      return d !== null && d < 30;
    });
    const alertEl = document.getElementById('expiry-alert');
    if (alertEl && expiring.length) {
      alertEl.style.display = 'block';
      alertEl.textContent = `${expiring.length} employee${expiring.length > 1 ? 's' : ''} with expiring or expired government ID: ${expiring.map(r => r[c('Employee')]).join(', ')}`;
    }

    const table = document.getElementById('records-table');
    if (table) table.style.display = 'table';
    const tbody = document.getElementById('records-body');
    if (!tbody) return;
    tbody.innerHTML = rows.map((r, i) => {
      const rowIdx = d.data.indexOf(r) + 1;
      return `<tr>
        <td><strong>${r[c('Employee')] || ''}</strong></td>
        <td>${r[c('Role')] || ''}</td>
        <td>${fmtDate(r[c('Hire Date')])}</td>
        <td>${fmtDate(r[c('Review Due 90Day')])}</td>
        <td>${fmtDate(r[c('Review Due Annual')])}</td>
        <td>${fmtDate(r[c('Next Review')])}</td>
        <td>${r[c('Status')] || ''}</td>
        <td><button class="action-btn btn-edit" onclick="openEditEmployee(${rowIdx})">Edit</button></td>
      </tr>`;
    }).join('');
  } catch (e) { console.error('loadTeamRecords:', e); }
}

async function openEditEmployee(rowIndex) {
  const d = _employeeRecordsData;
  if (!d || !d.data[rowIndex - 1]) return;
  const c = cols(d.data[0]);
  const row = d.data[rowIndex - 1];
  _currentEditEmployee = { rowIndex, name: (row[c('Employee')] || '').trim() };

  const nameEl = document.getElementById('edit-employee-name');
  if (nameEl) nameEl.textContent = _currentEditEmployee.name;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('edit-role', row[c('Role')]);
  set('edit-email', row[c('Email')]);
  set('edit-status', row[c('Status')] || 'Active');
  set('edit-hire-date', row[c('Hire Date')] ? new Date(row[c('Hire Date')]).toISOString().split('T')[0] : '');
  set('edit-90day', row[c('Review Due 90Day')] ? new Date(row[c('Review Due 90Day')]).toISOString().split('T')[0] : '');
  set('edit-last-review', row[c('Last Review')] ? new Date(row[c('Last Review')]).toISOString().split('T')[0] : '');
  set('edit-next-review', row[c('Next Review')] ? new Date(row[c('Next Review')]).toISOString().split('T')[0] : '');

  // PIN only for owners
  const pinEl = document.getElementById('edit-pin');
  if (pinEl) {
    if (PAGE_CONFIG.type === 'owner') {
      const pinCol = c('PIN');
      set('edit-pin', pinCol >= 0 ? row[pinCol] : '');
    }
  }

  const card = document.getElementById('edit-employee-card');
  if (card) {
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });
  }

  loadEditEquipment(_currentEditEmployee.name);
}

function closeEditEmployee() {
  _currentEditEmployee = null;
  const card = document.getElementById('edit-employee-card');
  if (card) card.style.display = 'none';
}

async function saveEmployeeRecord() {
  if (!_currentEditEmployee) return;
  const alertEl = document.getElementById('edit-record-alert');
  const btn = document.querySelector('#edit-employee-card .submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const d = await api({ action: 'read', tab: 'Employee_Records' });
    if (!d.success) throw new Error('Read failed');
    const c = cols(d.data[0]);
    const row = [...d.data[_currentEditEmployee.rowIndex - 1]];

    const get = id => document.getElementById(id)?.value || '';
    if (c('Role') >= 0) row[c('Role')] = get('edit-role');
    if (c('Email') >= 0) row[c('Email')] = get('edit-email');
    if (c('Status') >= 0) row[c('Status')] = get('edit-status');
    if (c('Hire Date') >= 0) row[c('Hire Date')] = get('edit-hire-date');
    if (c('Review Due 90Day') >= 0) row[c('Review Due 90Day')] = get('edit-90day');
    if (c('Last Review') >= 0) row[c('Last Review')] = get('edit-last-review');
    if (c('Next Review') >= 0) row[c('Next Review')] = get('edit-next-review');
    if (PAGE_CONFIG.type === 'owner' && c('PIN') >= 0) row[c('PIN')] = get('edit-pin');

    await api({ action: 'update', tab: 'Employee_Records', rowIndex: _currentEditEmployee.rowIndex, row: JSON.stringify(row) });
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-success">Saved.</div>';
    setTimeout(() => { if (alertEl) alertEl.innerHTML = ''; }, 2000);
    _employeeRecordsData = null;
    loadTeamRecords(PAGE_CONFIG);
  } catch (e) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-error">Error saving. Please try again.</div>';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
}

async function loadEditEquipment(employeeName) {
  const listEl = document.getElementById('edit-equipment-list');
  if (!listEl) return;
  try {
    const d = await api({ action: 'read', tab: 'Equipment' });
    if (!d.success) { listEl.innerHTML = ''; return; }
    const c = cols(d.data[0]);
    const rows = d.data.slice(1).filter(r => (r[c('Employee')] || '').trim() === employeeName && r.some(x => x));
    if (!rows.length) { listEl.innerHTML = '<div class="empty-state" style="text-align:left">No equipment on record.</div>'; return; }
    listEl.innerHTML = rows.map(r => {
      const rowIdx = d.data.indexOf(r) + 1;
      const returned = r[c('Date Returned')];
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0ece6">
        <div>
          <span style="font-size:13px;font-weight:600">${r[c('Make Model')] || r[c('Item Type')] || ''}</span>
          <span style="font-size:12px;color:#888;margin-left:8px">${r[c('Item Type')] || ''}</span>
          ${returned ? `<span class="pill pill-gray" style="margin-left:8px">Returned ${fmtDate(returned)}</span>` : ''}
        </div>
        ${!returned ? `<button class="action-btn btn-deny" onclick="markEquipmentReturned(${rowIdx}, '${employeeName}')">Mark Returned</button>` : ''}
      </div>`;
    }).join('');
  } catch (e) { console.error('loadEditEquipment:', e); }
}

async function markEquipmentReturned(rowIndex, employeeName) {
  const returnDate = new Date().toLocaleDateString('en-US');
  try {
    const d = await api({ action: 'read', tab: 'Equipment' });
    if (!d.success) return;
    const c = cols(d.data[0]);
    const row = [...d.data[rowIndex - 1]];
    if (c('Date Returned') >= 0) row[c('Date Returned')] = returnDate;
    await api({ action: 'update', tab: 'Equipment', rowIndex, row: JSON.stringify(row) });
    loadEditEquipment(employeeName);
  } catch (e) { alert('Error updating equipment.'); }
}

async function addEquipmentItem() {
  if (!_currentEditEmployee) return;
  const itemSel = document.getElementById('equip-item');
  const customEl = document.getElementById('equip-custom');
  const descEl = document.getElementById('equip-desc');
  const issuedEl = document.getElementById('equip-issued');

  const itemType = itemSel?.value === 'other' ? (customEl?.value || 'Other') : (itemSel?.value || '');
  const desc = descEl?.value || '';
  const issued = issuedEl?.value || new Date().toLocaleDateString('en-US');

  if (!itemType) { alert('Please select or enter an item type.'); return; }

  try {
    const row = [_currentEditEmployee.name, itemType, desc, '', issued, ''];
    await api({ action: 'append', tab: 'Equipment', row: JSON.stringify(row) });
    if (descEl) descEl.value = '';
    if (customEl) customEl.value = '';
    loadEditEquipment(_currentEditEmployee.name);
  } catch (e) { alert('Error adding equipment.'); }
}
