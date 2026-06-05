/* ============================================================
   TEAM DASHBOARD MODULE
   Commission summary, bonus summary, PTO overview
   ============================================================ */

async function loadTeamDashboard(config) {
  // Load all three sub-tabs
  loadDashCommissions();
  loadDashBonuses();
  loadDashPTO();
}

async function loadDashCommissions() {
  const loadEl = document.getElementById('dash-comm-loading');
  const contentEl = document.getElementById('dash-comm-content');
  try {
    const d = await api({ action: 'read', tab: 'Commissions' });
    if (loadEl) loadEl.style.display = 'none';
    if (!d.success) return;
    const c = cols(d.data[0]);
    const rows = d.data.slice(1).filter(r => r.some(x => x));

    // YTD by employee
    const byEmployee = {};
    const currentYear = new Date().getFullYear().toString().slice(2);
    rows.forEach(r => {
      const emp = (r[c('Employee')] || '').trim();
      if (!emp) return;
      if (!byEmployee[emp]) byEmployee[emp] = { ytd: 0, pending: 0, approved: 0 };
      const comm = Number(r[c('Commission')]) || 0;
      byEmployee[emp].ytd += comm;
      if (r[c('Approved by')] || r[c('Approved By')]) byEmployee[emp].approved += comm;
      else byEmployee[emp].pending += comm;
    });

    if (contentEl) contentEl.style.display = 'block';

    const stats = Object.entries(byEmployee);
    const statsEl = document.getElementById('dash-comm-stats');
    if (statsEl) {
      statsEl.innerHTML = stats.map(([emp, data]) => `<div class="stat-block">
        <div class="stat-number orange">${fmtMoney(data.ytd)}</div>
        <div class="stat-label">${emp.split(' ')[0]} YTD</div>
        <div class="stat-sub">${fmtMoney(data.pending)} pending</div>
      </div>`).join('') + `<div class="stat-block">
        <div class="stat-number">${fmtMoney(stats.reduce((s,[,d]) => s+d.ytd, 0))}</div>
        <div class="stat-label">Total YTD</div>
      </div>`;
    }

    const table = document.getElementById('dash-comm-table');
    if (table) table.style.display = 'table';
    const tbody = document.getElementById('dash-comm-body');
    if (tbody) {
      // Group by period
      const byPeriod = {};
      rows.forEach(r => {
        const period = (r[c('Pay Period')] || '').trim();
        const emp = (r[c('Employee')] || '').trim();
        if (!period || !emp) return;
        const key = period + '|' + emp;
        if (!byPeriod[key]) byPeriod[key] = { period, emp, total: 0, approved: 0 };
        byPeriod[key].total += Number(r[c('Commission')]) || 0;
        if (r[c('Approved by')] || r[c('Approved By')]) byPeriod[key].approved += Number(r[c('Commission')]) || 0;
      });
      tbody.innerHTML = Object.values(byPeriod)
        .sort((a, b) => b.period.localeCompare(a.period))
        .map(row => `<tr>
          <td>${row.period}</td>
          <td>${row.emp}</td>
          <td><strong style="color:#c4581f">${fmtMoney(row.total)}</strong></td>
          <td>${row.approved >= row.total
            ? '<span class="pill pill-approved">Approved</span>'
            : row.approved > 0
              ? '<span class="pill pill-pending">Partial</span>'
              : '<span class="pill pill-pending">Pending</span>'}</td>
        </tr>`).join('');
    }
  } catch (e) { console.error('loadDashCommissions:', e); }
}

async function loadDashBonuses() {
  const loadEl = document.getElementById('dash-bonus-loading');
  const contentEl = document.getElementById('dash-bonus-content');
  const emptyEl = document.getElementById('dash-bonus-empty');
  try {
    const [d1, d2, d3] = await Promise.all([
      api({ action: 'read', tab: 'B2B_Partner_Bounties' }).catch(() => ({ success: false })),
      api({ action: 'read', tab: 'B2B_Booking_Bonuses' }).catch(() => ({ success: false })),
      api({ action: 'read', tab: 'Bonuses' }).catch(() => ({ success: false })),
    ]);

    if (loadEl) loadEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';

    const allRows = [];

    if (d1.success) {
      const c = cols(d1.data[0]);
      d1.data.slice(1).filter(r => r.some(x => x)).forEach(r => {
        allRows.push({
          employee: (r[c('Employee')] || '').trim(),
          type: (r[c('Bonus Type')] || 'Partner Bounty').trim(),
          detail: r[c('Org Name')] || r[c('Account')] || '',
          amount: Number(r[c('Amount')]) || 250,
          approvedBy: (r[c('Approved By')] || '').trim(),
          approvedDate: fmtDate(r[c('Approved Date')]),
          payDate: r[c('Pay Date')] || '',
        });
      });
    }
    if (d2.success) {
      const c = cols(d2.data[0]);
      d2.data.slice(1).filter(r => r.some(x => x)).forEach(r => {
        allRows.push({
          employee: (r[c('Employee')] || '').trim(),
          type: 'Booking Bonus',
          detail: r[c('Customer Name')] || '',
          amount: 75,
          approvedBy: (r[c('Approved By')] || '').trim(),
          approvedDate: fmtDate(r[c('Approved Date')]),
          payDate: r[c('Pay Date')] || '',
        });
      });
    }
    if (d3.success) {
      const c = cols(d3.data[0]);
      d3.data.slice(1).filter(r => r.some(x => x)).forEach(r => {
        allRows.push({
          employee: (r[c('Employee')] || '').trim(),
          type: 'Scorecard Bonus',
          detail: `Q${r[c('Quarter')]} ${r[c('Year')] || ''}`,
          amount: Number(r[c('Amount')]) || 0,
          approvedBy: (r[c('Approved By')] || '').trim(),
          approvedDate: fmtDate(r[c('Date Approved')]),
          payDate: r[c('Pay Date')] || '',
        });
      });
    }

    if (!allRows.length) { if (emptyEl) emptyEl.style.display = 'block'; return; }

    const tbody = document.getElementById('dash-bonus-body');
    if (tbody) tbody.innerHTML = allRows.map(r => `<tr>
      <td><strong>${r.employee}</strong></td>
      <td><span class="pill pill-orange">${r.type}</span></td>
      <td style="font-size:12px;color:#888">${r.detail}</td>
      <td><strong style="color:#c4581f">${r.amount > 0 ? fmtMoney(r.amount) : '&mdash;'}</strong></td>
      <td>${r.approvedBy ? '<span class="pill pill-approved">Approved</span>' : '<span class="pill pill-pending">Pending</span>'}</td>
      <td>${r.approvedBy || ''}</td>
      <td>${r.approvedDate || ''}</td>
      <td style="color:#28a745">${r.payDate || ''}</td>
    </tr>`).join('');
  } catch (e) { console.error('loadDashBonuses:', e); }
}

async function loadDashPTO() {
  const loadEl = document.getElementById('dash-pto-loading');
  const upcomingLoadEl = document.getElementById('dash-upcoming-loading');
  try {
    const [dBal, dReq] = await Promise.all([
      api({ action: 'read', tab: 'PTO_Balances' }),
      api({ action: 'read', tab: 'PTO_Requests' }),
    ]);
    if (loadEl) loadEl.style.display = 'none';
    if (upcomingLoadEl) upcomingLoadEl.style.display = 'none';

    if (dBal.success) {
      const c = cols(dBal.data[0]);
      const rows = dBal.data.slice(1).filter(r => r[c('Employee')]);
      const table = document.getElementById('dash-pto-table');
      if (table) table.style.display = 'table';
      const tbody = document.getElementById('dash-pto-body');
      if (tbody) tbody.innerHTML = rows.map(r => {
        const vacUsed = Number(r[c('Vacation Used')]) || 0;
        const sickUsed = Number(r[c('Sick Used')]) || 0;
        const vacBal = Number(r[c('Vacation Balance')]) || 0;
        const sickBal = Number(r[c('Sick Balance')]) || 0;
        return `<tr>
          <td><strong>${r[c('Employee')]}</strong></td>
          <td>${vacUsed + vacBal}</td>
          <td>${vacUsed}</td>
          <td>${vacBal}</td>
          <td>${sickUsed + sickBal}</td>
          <td>${sickUsed}</td>
          <td>${sickBal}</td>
        </tr>`;
      }).join('');
    }

    if (dReq.success) {
      const c = cols(dReq.data[0]);
      const today = new Date().toISOString().split('T')[0];
      const upcoming = dReq.data.slice(1).filter(r => {
        const status = (r[c('Status')] || '').trim();
        const endDate = (r[c('End Date')] || r[c('Start Date')] || '').trim();
        return status === 'Approved' && endDate >= today;
      }).sort((a, b) => (a[c('Start Date')] || '').localeCompare(b[c('Start Date')] || ''));

      const table = document.getElementById('dash-upcoming-table');
      const emptyEl = document.getElementById('dash-upcoming-empty');
      if (!upcoming.length) { if (emptyEl) emptyEl.style.display = 'block'; return; }
      if (table) table.style.display = 'table';
      const tbody = document.getElementById('dash-upcoming-body');
      if (tbody) tbody.innerHTML = upcoming.map(r => {
        const dates = fmtDate(r[c('Start Date')]) + (r[c('End Date')] && r[c('End Date')] !== r[c('Start Date')] ? ' to ' + fmtDate(r[c('End Date')]) : '');
        return `<tr>
          <td><strong>${r[c('Employee')]}</strong></td>
          <td>${r[c('Type')]}</td>
          <td>${dates}</td>
          <td>${r[c('Days')]}</td>
          <td>${statusPill(r[c('Status')])}</td>
        </tr>`;
      }).join('');
    }
  } catch (e) { console.error('loadDashPTO:', e); }
}
