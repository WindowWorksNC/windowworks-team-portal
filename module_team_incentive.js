/* ============================================================
   TEAM INCENTIVE PAY MODULE
   All bonus/scorecard approvals in one view
   ============================================================ */

let _incentiveAllRows = [];
let _incentiveD1 = null; // B2B_Partner_Bounties
let _incentiveD2 = null; // B2B_Booking_Bonuses
let _incentiveD3 = null; // Bonuses (scorecard)
let _incentiveD4 = null; // PTO_Requests (payout type)

async function loadTeamIncentive(config) {
  const loadEl = document.getElementById('incentive-loading');
  const contentEl = document.getElementById('incentive-content');

  try {
    // Load all bonus sheets in parallel
    const [d1, d2, d3, d4] = await Promise.all([
      api({ action: 'read', tab: 'B2B_Partner_Bounties' }).catch(() => ({ success: false })),
      api({ action: 'read', tab: 'B2B_Booking_Bonuses' }).catch(() => ({ success: false })),
      api({ action: 'read', tab: 'Bonuses' }).catch(() => ({ success: false })),
      api({ action: 'read', tab: 'PTO_Requests' }).catch(() => ({ success: false })),
    ]);

    _incentiveD1 = d1; _incentiveD2 = d2; _incentiveD3 = d3; _incentiveD4 = d4;

    if (loadEl) loadEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';

    // Populate employee filter
    const employees = new Set();
    _incentiveAllRows = [];

    if (d1.success) {
      const c = cols(d1.data[0]);
      d1.data.slice(1).filter(r => r.some(x => x)).forEach(r => {
        const emp = (r[c('Employee')] || '').trim();
        if (emp) employees.add(emp);
        _incentiveAllRows.push({
          sheet: 'B2B_Partner_Bounties',
          rowIndex: d1.data.indexOf(r) + 1,
          employee: emp,
          type: (r[c('Bonus Type')] || 'New Partner Bounty').trim(),
          detail: r[c('Org Name')] || r[c('Account')] || r[c('Deal Name')] || '',
          amount: Number(r[c('Amount')]) || 250,
          submitted: fmtDate(r[c('Date')]),
          approvedBy: (r[c('Approved By')] || '').trim(),
          approvedDate: fmtDate(r[c('Approved Date')]),
          payDate: r[c('Pay Date')] || '',
        });
      });
    }

    if (d2.success) {
      const c = cols(d2.data[0]);
      d2.data.slice(1).filter(r => r.some(x => x)).forEach(r => {
        const emp = (r[c('Employee')] || '').trim();
        if (emp) employees.add(emp);
        _incentiveAllRows.push({
          sheet: 'B2B_Booking_Bonuses',
          rowIndex: d2.data.indexOf(r) + 1,
          employee: emp,
          type: 'Booking Bonus',
          detail: r[c('Customer Name')] || '',
          amount: 75,
          submitted: fmtDate(r[c('Date')]),
          approvedBy: (r[c('Approved By')] || '').trim(),
          approvedDate: fmtDate(r[c('Approved Date')]),
          payDate: r[c('Pay Date')] || '',
        });
      });
    }

    if (d3.success) {
      const c = cols(d3.data[0]);
      d3.data.slice(1).filter(r => r.some(x => x)).forEach(r => {
        const emp = (r[c('Employee')] || '').trim();
        const type = (r[c('Type')] || '').trim();
        if (!emp) return;
        // Only include scorecard bonuses, not manual entries
        const isBrandonScorecard = emp === 'Brandon McClure' && type === 'Scorecard';
        // Brandon's scorecard bonus: only Rose/Justin can approve
        if (isBrandonScorecard && config.type !== 'owner') return;
        employees.add(emp);
        _incentiveAllRows.push({
          sheet: 'Bonuses',
          rowIndex: d3.data.indexOf(r) + 1,
          employee: emp,
          type: 'Scorecard Bonus',
          detail: `Q${r[c('Quarter')]} ${r[c('Year')] || ''}`,
          amount: Number(r[c('Amount')]) || 0,
          submitted: fmtDate(r[c('Date Approved')]),
          approvedBy: (r[c('Approved By')] || '').trim(),
          approvedDate: fmtDate(r[c('Date Approved')]),
          payDate: r[c('Pay Date')] || '',
        });
      });
    }

    if (d4.success) {
      const c = cols(d4.data[0]);
      d4.data.slice(1).filter(r => r.some(x => x)).forEach(r => {
        const type = (r[c('Type')] || '').trim();
        if (type !== 'Payout Request') return;
        const emp = (r[c('Employee')] || '').trim();
        if (emp) employees.add(emp);
        _incentiveAllRows.push({
          sheet: 'PTO_Requests',
          rowIndex: d4.data.indexOf(r) + 1,
          employee: emp,
          type: 'Payout Request',
          detail: `${r[c('Days')] || ''} vacation days`,
          amount: 0, // payout calculated separately
          submitted: fmtDate(r[c('Submitted')]),
          approvedBy: (r[c('Reviewed By')] || '').trim(),
          approvedDate: '',
          payDate: '',
        });
      });
    }

    // Populate filter
    const empFilter = document.getElementById('incentive-filter-employee');
    if (empFilter) {
      const existing = empFilter.innerHTML;
      empFilter.innerHTML = '<option value="">All Employees</option>' +
        [...employees].sort().map(e => `<option value="${e}">${e}</option>`).join('');
    }

    renderIncentiveTable();

  } catch (e) {
    if (loadEl) loadEl.style.display = 'none';
    console.error('loadTeamIncentive:', e);
  }
}

function filterIncentive() {
  renderIncentiveTable();
}

function renderIncentiveTable() {
  const empFilter = document.getElementById('incentive-filter-employee')?.value || '';
  const typeFilter = document.getElementById('incentive-filter-type')?.value || '';
  const statusFilter = document.getElementById('incentive-filter-status')?.value || '';

  let rows = _incentiveAllRows.filter(r => {
    if (empFilter && r.employee !== empFilter) return false;
    if (typeFilter && r.type !== typeFilter) return false;
    if (statusFilter === 'Pending' && r.approvedBy) return false;
    if (statusFilter === 'Approved' && !r.approvedBy) return false;
    return true;
  });

  const tbody = document.getElementById('incentive-body');
  const emptyEl = document.getElementById('incentive-empty');

  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  tbody.innerHTML = rows.map(r => {
    const approved = !!r.approvedBy;
    return `<tr>
      <td><strong>${r.employee}</strong></td>
      <td><span class="pill pill-orange">${r.type}</span></td>
      <td style="font-size:12px;color:#888">${r.detail}</td>
      <td><strong style="color:#c4581f">${r.amount > 0 ? fmtMoney(r.amount) : '&mdash;'}</strong></td>
      <td>${r.submitted}</td>
      <td>${r.approvedBy || ''}</td>
      <td>${r.approvedDate || ''}</td>
      <td style="color:#28a745">${r.payDate || ''}</td>
      <td>${approved
        ? '<span class="pill pill-approved">Approved</span>'
        : `<button class="action-btn btn-approve" onclick="approveIncentiveItem('${r.sheet}',${r.rowIndex},'${r.employee}','${r.type}',${r.amount})">Approve</button>`
      }</td>
    </tr>`;
  }).join('');
}

function approveIncentiveItem(sheet, rowIndex, employeeName, type, amount) {
  showApprovalModal({
    sheet,
    rowIndex,
    employeeName,
    type,
    amount,
    approver: PAGE_CONFIG.name,
    onConfirm: () => loadTeamIncentive(PAGE_CONFIG),
  });
}
