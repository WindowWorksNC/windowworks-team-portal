/* ============================================================
   TEAM PTO MODULE
   Admin view: pending requests, all balances, create records
   ============================================================ */

async function loadTeamPTO(config) {
  await Promise.all([
    loadAdminPTO(config),
    loadAllBalances(),
    populateCreatePTOEmployees(),
  ]);
}

async function loadAdminPTO(config) {
  const pendingLoadEl = document.getElementById('pending-loading');
  const allLoadEl = document.getElementById('all-requests-loading');
  try {
    const d = await api({ action: 'read', tab: 'PTO_Requests' });
    if (pendingLoadEl) pendingLoadEl.style.display = 'none';
    if (allLoadEl) allLoadEl.style.display = 'none';
    if (!d.success) return;
    const c = cols(d.data[0]);
    const today = new Date().toISOString().split('T')[0];
    const rows = d.data.slice(1).filter(r => r.some(x => x));

    // Pending
    const pending = rows.filter(r => {
      const status = (r[c('Status')] || '').trim();
      return !status || status === 'Pending';
    });
    const pendingCountEl = document.getElementById('pending-count');
    if (pendingCountEl) pendingCountEl.textContent = pending.length + ' pending';

    if (pending.length) {
      const table = document.getElementById('pending-table');
      if (table) table.style.display = 'table';
      const tbody = document.getElementById('pending-body');
      if (tbody) tbody.innerHTML = pending.map(r => {
        const idx = d.data.indexOf(r) + 1;
        const dates = fmtDate(r[c('Start Date')]) + (r[c('End Date')] && r[c('End Date')] !== r[c('Start Date')] ? ' to ' + fmtDate(r[c('End Date')]) : '');
        // Brandon's own requests only shown to owners
        const isBrandon = (r[c('Employee')] || '').trim() === 'Brandon McClure';
        const canApprove = !isBrandon || config.type === 'owner';
        return `<tr>
          <td><strong>${r[c('Employee')] || ''}</strong></td>
          <td>${r[c('Type')] || ''}</td>
          <td>${dates}</td>
          <td>${r[c('Days')] || ''}</td>
          <td>${r[c('Reason')] || ''}</td>
          <td>${canApprove ? `
            <button class="action-btn btn-approve" onclick="reviewPTO(${idx}, 'Approved')">Approve</button>
            <button class="action-btn btn-deny" onclick="reviewPTO(${idx}, 'Denied')">Deny</button>` : '<span style="font-size:12px;color:#aaa">Owner only</span>'}
          </td>
        </tr>`;
      }).join('');
    } else {
      const emptyEl = document.getElementById('pending-empty');
      if (emptyEl) emptyEl.style.display = 'block';
    }

    // Active/upcoming
    const active = rows.filter(r => {
      const status = (r[c('Status')] || 'Pending').trim();
      const endDate = (r[c('End Date')] || r[c('Start Date')] || '').trim();
      return status === 'Pending' || (status === 'Approved' && endDate >= today) || (status === 'Denied' && endDate >= today);
    });

    if (active.length) {
      const table = document.getElementById('all-requests-table');
      if (table) table.style.display = 'table';
      const tbody = document.getElementById('all-requests-body');
      if (tbody) tbody.innerHTML = active.slice().reverse().map(r => {
        const dates = fmtDate(r[c('Start Date')]) + (r[c('End Date')] && r[c('End Date')] !== r[c('Start Date')] ? ' to ' + fmtDate(r[c('End Date')]) : '');
        return `<tr>
          <td>${r[c('Employee')] || ''}</td>
          <td>${fmtDate(r[c('Submitted')])}</td>
          <td>${r[c('Type')] || ''}</td>
          <td>${dates}</td>
          <td>${r[c('Days')] || ''}</td>
          <td>${statusPill(r[c('Status')])}</td>
          <td>${r[c('Reviewed By')] || ''}</td>
        </tr>`;
      }).join('');
    } else {
      const emptyEl = document.getElementById('all-requests-empty');
      if (emptyEl) emptyEl.style.display = 'block';
    }

  } catch (e) { console.error('loadAdminPTO:', e); }
}

async function reviewPTO(rowIndex, status) {
  try {
    const d = await api({ action: 'read', tab: 'PTO_Requests' });
    if (!d.success) return;
    const c = cols(d.data[0]);
    const row = [...d.data[rowIndex - 1]];
    row[c('Status')] = status;
    row[c('Reviewed By')] = PAGE_CONFIG.name;
    await api({ action: 'update', tab: 'PTO_Requests', rowIndex, row: JSON.stringify(row) });
    loadAdminPTO(PAGE_CONFIG);
    loadAllBalances();
  } catch (e) { alert('Error updating request'); }
}

async function loadAllBalances() {
  const loadEl = document.getElementById('balances-loading');
  try {
    const d = await api({ action: 'read', tab: 'PTO_Balances' });
    if (loadEl) loadEl.style.display = 'none';
    if (!d.success) return;
    const c = cols(d.data[0]);
    const rows = d.data.slice(1).filter(r => r[c('Employee')] && r[c('Employee')] !== 'Employee');
    if (!rows.length) return;
    const table = document.getElementById('balances-table');
    if (table) table.style.display = 'table';
    const tbody = document.getElementById('balances-body');
    if (!tbody) return;
    tbody.innerHTML = rows.map(r => {
      const vacUsed = Number(r[c('Vacation Used')]) || 0;
      const sickUsed = Number(r[c('Sick Used')]) || 0;
      const vacBal = Number(r[c('Vacation Balance')]) || 0;
      const sickBal = Number(r[c('Sick Balance')]) || 0;
      return `<tr>
        <td><strong>${r[c('Employee')]}</strong></td>
        <td>${vacUsed}</td>
        <td>${vacBal}</td>
        <td>${sickUsed}</td>
        <td>${sickBal}</td>
      </tr>`;
    }).join('');
  } catch (e) { console.error('loadAllBalances:', e); }
}

async function populateCreatePTOEmployees() {
  try {
    const d = await api({ action: 'read', tab: 'Employee_Records' });
    if (!d.success) return;
    const c = cols(d.data[0]);
    const employees = d.data.slice(1)
      .filter(r => (r[c('Status')] || '').trim() === 'Active' || !(r[c('Status')]))
      .map(r => (r[c('Employee')] || '').trim())
      .filter(Boolean);
    const sel = document.getElementById('create-pto-employee');
    if (!sel) return;
    sel.innerHTML = employees.map(e => `<option value="${e}">${e}</option>`).join('');
  } catch (e) {}
}

async function createPTORecord() {
  const employee = document.getElementById('create-pto-employee')?.value;
  const type = document.getElementById('create-pto-type')?.value;
  const start = document.getElementById('create-pto-start')?.value;
  const end = document.getElementById('create-pto-end')?.value || start;
  const notes = document.getElementById('create-pto-notes')?.value || '';
  const alertEl = document.getElementById('create-pto-alert');

  if (!employee || !start) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-error">Employee and start date are required.</div>';
    return;
  }

  const days = countWorkingDays(start, end);

  try {
    const row = [
      `PTO-ADMIN-${Date.now()}`,
      employee, type, start, end, days, notes,
      'Approved', // auto-approve
      new Date().toLocaleDateString('en-US'),
      PAGE_CONFIG.name  // reviewed by creator
    ];
    await api({ action: 'append', tab: 'PTO_Requests', row: JSON.stringify(row) });
    if (alertEl) alertEl.innerHTML = `<div class="alert alert-success">PTO record created and approved for ${employee}.</div>`;
    ['create-pto-start', 'create-pto-end', 'create-pto-notes'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    loadAdminPTO(PAGE_CONFIG);
    loadAllBalances();
  } catch (e) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-error">Error creating record. Please try again.</div>';
  }
}
