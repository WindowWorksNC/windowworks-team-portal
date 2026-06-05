/* ============================================================
   TEAM COMMISSION MODULE
   Brandon, Rose, Justin -- commission admin view
   ============================================================ */

async function loadTeamCommission(config) {
  const loadEl = document.getElementById('team-comm-loading');
  const contentEl = document.getElementById('team-comm-content');
  const emptyEl = document.getElementById('team-comm-empty');
  const periodEl = document.getElementById('team-comm-period');

  try {
    const d = await api({ action: 'read', tab: 'Commissions' });
    if (loadEl) loadEl.style.display = 'none';
    if (!d.success) return;
    const c = cols(d.data[0]);
    const allRows = d.data.slice(1).filter(r => r.some(x => x));

    const currentPeriod = getCurrentPayPeriodLabel();
    let displayPeriod = currentPeriod;
    let currentRows = allRows.filter(r => (r[c('Pay Period')] || '').trim() === currentPeriod);

    if (!currentRows.length && allRows.length) {
      const periods = [...new Set(allRows.map(r => (r[c('Pay Period')] || '').trim()).filter(Boolean))];
      if (periods.length) {
        displayPeriod = periods[periods.length - 1];
        currentRows = allRows.filter(r => (r[c('Pay Period')] || '').trim() === displayPeriod);
      }
    }

    if (periodEl) periodEl.textContent = displayPeriod;

    // Stats by employee
    const employees = ['Colin Glenn', 'Jimmie Coleman'];
    const stats = {};
    employees.forEach(e => {
      stats[e] = currentRows.filter(r => (r[c('Employee')] || '').trim() === e)
        .reduce((s, r) => s + (Number(r[c('Commission')]) || 0), 0);
    });
    const periodTotal = Object.values(stats).reduce((a, b) => a + b, 0);

    const statsEl = document.getElementById('team-comm-stats');
    if (statsEl) {
      statsEl.innerHTML = employees.map(e => `<div class="stat-block">
        <div class="stat-number orange">${fmtMoney(stats[e])}</div>
        <div class="stat-label">${e.split(' ')[0]}</div>
      </div>`).join('') + `<div class="stat-block">
        <div class="stat-number">${fmtMoney(periodTotal)}</div>
        <div class="stat-label">Period Total</div>
      </div>`;
    }

    if (contentEl) contentEl.style.display = 'block';

    if (!currentRows.length) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    const table = document.getElementById('team-comm-table');
    if (table) table.style.display = 'table';
    const tbody = document.getElementById('team-comm-body');
    if (tbody) tbody.innerHTML = currentRows.slice().reverse().map(r => {
      const rowIdx = d.data.indexOf(r) + 1;
      const approved = r[c('Approved by')] || r[c('Approved By')];
      return `<tr>
        <td>${fmtDate(r[c('Date')])}</td>
        <td><strong>${(r[c('Employee')] || '').trim()}</strong></td>
        <td>${r[c('Deal Name')] || ''}</td>
        <td>${fmtMoney(r[c('Deal Value')])}</td>
        <td>${(r[c('Rate')] || '').trim()}</td>
        <td><strong style="color:#c4581f">${fmtMoney(r[c('Commission')])}</strong></td>
        <td style="font-size:12px">${(r[c('Pay Period')] || '').trim()}</td>
        <td>${approved || ''}</td>
        <td>${fmtDate(r[c('Approved date')] || r[c('Approved Date')])}</td>
        <td style="color:#28a745">${(c('Pay Date') >= 0 ? r[c('Pay Date')] : '') || ''}</td>
        <td>${approved
          ? '<span class="pill pill-approved">Approved</span>'
          : `<button class="action-btn btn-approve" onclick="approveCommission(${rowIdx}, '${(r[c('Employee')] || '').trim()}', ${Number(r[c('Commission')]) || 0})">Approve</button>`
        }</td>
      </tr>`;
    }).join('');

    loadTeamPrevComm(allRows, displayPeriod, c, d);

  } catch (e) {
    if (loadEl) loadEl.style.display = 'none';
    console.error('loadTeamCommission:', e);
  }
}

function approveCommission(rowIndex, employeeName, amount) {
  showApprovalModal({
    sheet: 'Commissions',
    rowIndex,
    employeeName,
    type: 'Commission',
    amount,
    approver: PAGE_CONFIG.name,
    onConfirm: () => loadTeamCommission(PAGE_CONFIG),
  });
}

function loadTeamPrevComm(allRows, currentPeriod, c, d) {
  const bodyEl = document.getElementById('team-prev-comm-body');
  if (!bodyEl) return;

  const periods = {};
  allRows.forEach(r => {
    const p = (r[c('Pay Period')] || '').trim();
    if (!p || p === currentPeriod) return;
    if (!periods[p]) periods[p] = [];
    periods[p].push(r);
  });

  const keys = Object.keys(periods).sort().reverse();
  if (!keys.length) { bodyEl.innerHTML = '<div class="empty-state">No previous periods.</div>'; return; }

  bodyEl.innerHTML = keys.map(period => {
    const pRows = periods[period];
    const total = pRows.reduce((s, r) => s + (Number(r[c('Commission')]) || 0), 0);
    const id = 'tpp-' + period.replace(/[^a-z0-9]/gi, '');
    return `<div style="border-top:1px solid #f0ece6;padding:10px 0">
      <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="toggleEl('${id}')">
        <span style="font-size:13px;font-weight:600">${period}</span>
        <span style="font-size:14px;color:#c4581f;font-weight:700">${fmtMoney(total)}</span>
      </div>
      <div id="${id}" style="display:none;margin-top:8px">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Employee</th><th>Deal</th><th>Commission</th><th>Approved By</th><th>Pay Date</th></tr></thead>
          <tbody>${pRows.map(r => `<tr>
            <td>${fmtDate(r[c('Date')])}</td>
            <td>${(r[c('Employee')] || '').trim()}</td>
            <td>${r[c('Deal Name')] || ''}</td>
            <td><strong style="color:#c4581f">${fmtMoney(r[c('Commission')])}</strong></td>
            <td>${r[c('Approved by')] || r[c('Approved By')] || '<span style="color:#aaa">Pending</span>'}</td>
            <td>${r[c('Pay Date')] || ''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}
