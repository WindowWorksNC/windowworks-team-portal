/* ============================================================
   B2B BONUSES MODULE (Colin + future B2B employees)
   Booking bonuses, partner bounties, Pipedrive opportunities
   ============================================================ */

const PIPEDRIVE_TOKEN = 'e3ede19f7c61fad229f89cf091af089cd5a2318e';

async function loadB2BBonuses(config) {
  await Promise.all([
    loadBonusSummary(config),
    loadBookingBonuses(config),
    loadPipedriveOpportunities(config),
  ]);
}

async function loadBonusSummary(config) {
  const loadEl = document.getElementById('bonus-summary-loading');
  const contentEl = document.getElementById('bonus-summary-content');

  try {
    const [d1, d2, d3] = await Promise.all([
      api({ action: 'read', tab: 'B2B_Partner_Bounties' }),
      api({ action: 'read', tab: 'B2B_Booking_Bonuses' }),
      api({ action: 'read', tab: 'Bonuses' }),
    ]);

    if (loadEl) loadEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';

    const pending = [], approved = [];

    if (d1.success) {
      const c = cols(d1.data[0]);
      d1.data.slice(1).filter(r => (r[c('Employee')] || '').trim() === config.name && r.some(x => x)).forEach(r => {
        const entry = {
          type: (r[c('Bonus Type')] || 'New Partner Bounty').trim(),
          account: r[c('Org Name')] || r[c('Account')] || '',
          amount: Number(r[c('Amount')]) || 250,
          detail: 'First B2B sale',
          approvedBy: (r[c('Approved By')] || '').trim(),
          approvedDate: fmtDate(r[c('Approved Date')]),
          payDate: r[c('Pay Date')] || '',
        };
        if (entry.approvedBy) approved.push(entry);
        else pending.push(entry);
      });
    }

    if (d2.success) {
      const c = cols(d2.data[0]);
      const currentPeriod = getCurrentPayPeriodLabel();
      d2.data.slice(1).filter(r => (r[c('Employee')] || '').trim() === config.name && r.some(x => x)).forEach(r => {
        const entry = {
          type: 'Booking Bonus',
          account: r[c('Customer Name')] || '',
          amount: 75,
          detail: 'In-home lead booked',
          approvedBy: (r[c('Approved By')] || '').trim(),
          approvedDate: fmtDate(r[c('Approved Date')]),
          payDate: r[c('Pay Date')] || '',
        };
        if (entry.approvedBy) approved.push(entry);
        else pending.push(entry);
      });
    }

    // Totals
    const pendingTotal = pending.reduce((s, e) => s + e.amount, 0);
    const approvedTotal = approved.reduce((s, e) => s + e.amount, 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('bonus-pending-total', fmtMoney(pendingTotal));
    set('bonus-approved-total', fmtMoney(approvedTotal));

    // Pending section
    const pendingBody = document.getElementById('bonus-pending-body');
    const pendingEmpty = document.getElementById('bonus-pending-empty');
    if (pendingBody) {
      if (!pending.length) {
        if (pendingEmpty) pendingEmpty.style.display = 'block';
      } else {
        pendingBody.innerHTML = pending.filter(e => e.account).map(e => bonusRow(e)).join('');
      }
    }

    // Approved section
    const approvedBody = document.getElementById('bonus-approved-body');
    const approvedEmpty = document.getElementById('bonus-approved-empty');
    if (approvedBody) {
      if (!approved.length) {
        if (approvedEmpty) approvedEmpty.style.display = 'block';
      } else {
        approvedBody.innerHTML = approved.filter(e => e.account).map(e => bonusRow(e)).join('');
      }
    }
  } catch (e) {
    if (loadEl) loadEl.style.display = 'none';
    console.error('loadBonusSummary:', e);
  }
}

function bonusRow(entry) {
  const dateInfo = entry.approvedBy
    ? `<div class="incentive-row-meta">${entry.approvedDate ? 'Approved: ' + entry.approvedDate : ''}${entry.approvedDate && entry.payDate ? ' &bull; ' : ''}${entry.payDate ? 'Pay date: <strong style="color:#28a745">' + entry.payDate + '</strong>' : ''}</div>`
    : '';
  const pill = entry.approvedBy
    ? '<span class="pill pill-approved">Approved</span>'
    : '<span class="pill pill-pending">Pending</span>';
  return `<div class="incentive-row">
    <div class="type-label">${entry.type}</div>
    <div class="incentive-row-body">
      <div>
        <div class="incentive-row-title">${entry.account}</div>
        <div class="incentive-row-detail">${entry.detail}</div>
        ${dateInfo}
      </div>
      <div class="incentive-row-right">
        <span class="incentive-amount">${fmtMoney(entry.amount)}</span>
        ${pill}
      </div>
    </div>
  </div>`;
}

async function loadBookingBonuses(config) {
  const loadEl = document.getElementById('booking-loading');
  const contentEl = document.getElementById('booking-content');
  const emptyEl = document.getElementById('booking-empty');

  try {
    const d = await api({ action: 'read', tab: 'B2B_Booking_Bonuses' });
    if (loadEl) loadEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';
    if (!d.success) return;
    const c = cols(d.data[0]);
    const currentPeriod = getCurrentPayPeriodLabel();
    const allRows = d.data.slice(1).filter(r => (r[c('Employee')] || '').trim() === config.name && r.some(x => x));
    const currentRows = allRows.filter(r => (r[c('Pay Period')] || '').trim() === currentPeriod);
    const bonus = (config.bonuses || {}).booking || 75;
    const ytd = allRows.reduce((s, r) => s + bonus, 0);
    const periodTotal = currentRows.length * bonus;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('booking-period-count', currentRows.length);
    set('booking-period-total', fmtMoney(periodTotal));
    set('booking-ytd-total', fmtMoney(ytd));

    if (!currentRows.length) { if (emptyEl) emptyEl.style.display = 'block'; return; }

    const tableWrap = document.getElementById('booking-table-wrap');
    if (tableWrap) tableWrap.style.display = 'block';
    const tbody = document.getElementById('booking-body');
    if (tbody) tbody.innerHTML = currentRows.slice().reverse().map(r => `<tr>
      <td>${fmtDate(r[c('Date')])}</td>
      <td>${r[c('Customer Name')] || ''}</td>
      <td>${fmtDate(r[c('Appointment Date')])}</td>
      <td><strong style="color:#c4581f">${fmtMoney(bonus)}</strong></td>
      <td>${r[c('Approved By')] || '<span style="color:#aaa">Pending</span>'}</td>
      <td>${r[c('Notes')] || ''}</td>
    </tr>`).join('');
  } catch (e) {
    if (loadEl) loadEl.style.display = 'none';
    console.error('loadBookingBonuses:', e);
  }
}

async function submitBooking() {
  const customer = document.getElementById('booking-customer')?.value?.trim();
  const apptDate = document.getElementById('booking-appt-date')?.value;
  const notes = document.getElementById('booking-notes')?.value || '';
  const msgEl = document.getElementById('booking-submit-msg');
  const btn = document.getElementById('booking-submit-btn');

  if (!customer || !apptDate) {
    if (msgEl) msgEl.innerHTML = '<span style="color:#dc3545">Customer name and appointment date are required.</span>';
    return;
  }

  btn.disabled = true; btn.textContent = 'Logging...';
  try {
    const period = getCurrentPayPeriodLabel();
    const row = [PAGE_CONFIG.name, new Date().toLocaleDateString('en-US'), customer, apptDate, '', '', '', notes, period];
    await api({ action: 'append', tab: 'B2B_Booking_Bonuses', row: JSON.stringify(row) });
    if (msgEl) msgEl.innerHTML = '<span style="color:#28a745">Booking logged. Pending approval.</span>';
    const custEl = document.getElementById('booking-customer');
    const dateEl = document.getElementById('booking-appt-date');
    const notesEl = document.getElementById('booking-notes');
    if (custEl) custEl.value = '';
    if (dateEl) dateEl.value = '';
    if (notesEl) notesEl.value = '';
    setTimeout(() => { if (msgEl) msgEl.innerHTML = ''; }, 3000);
    loadBookingBonuses(PAGE_CONFIG);
    loadBonusSummary(PAGE_CONFIG);
  } catch (e) {
    if (msgEl) msgEl.innerHTML = '<span style="color:#dc3545">Error logging. Please try again.</span>';
  }
  btn.disabled = false; btn.textContent = 'Log Booking Bonus';
}

async function loadPipedriveOpportunities(config) {
  const loadEl = document.getElementById('opp-loading');
  const contentEl = document.getElementById('opp-content');
  if (!config.pipedriveId) {
    if (loadEl) loadEl.style.display = 'none';
    return;
  }
  try {
    // Fetch won deals for this user from Pipedrive
    const res = await fetch(`https://api.pipedrive.com/v1/deals?user_id=${config.pipedriveId}&status=won&limit=100&api_token=${PIPEDRIVE_TOKEN}`);
    const data = await res.json();
    if (loadEl) loadEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';
    if (!data.data) return;

    const deals = data.data;
    const now = new Date();
    const bonuses = config.bonuses || {};

    // Group by org
    const orgs = {};
    deals.forEach(deal => {
      const orgId = deal.org_id?.value || deal.org_name || 'Unknown';
      const orgName = deal.org_id?.name || deal.org_name || 'Unknown';
      if (!orgs[orgId]) orgs[orgId] = { name: orgName, deals: [], totalValue: 0, firstDate: null };
      orgs[orgId].deals.push(deal);
      orgs[orgId].totalValue += deal.value || 0;
      const wonDate = new Date(deal.won_time || deal.close_time || now);
      if (!orgs[orgId].firstDate || wonDate < orgs[orgId].firstDate) orgs[orgId].firstDate = wonDate;
    });

    // Anchor opportunities (3 contracts + $150k in first 12 months)
    const anchorOpps = Object.values(orgs)
      .filter(o => o.deals.length < 3 || o.totalValue < 150000)
      .map(o => {
        const monthsIn = o.firstDate ? Math.floor((now - o.firstDate) / (1000 * 60 * 60 * 24 * 30)) : 0;
        const monthsLeft = Math.max(0, 12 - monthsIn);
        return { ...o, monthsLeft, contractsNeed: Math.max(0, 3 - o.deals.length), revenueNeed: Math.max(0, 150000 - o.totalValue) };
      })
      .filter(o => o.monthsLeft > 0)
      .sort((a, b) => a.revenueNeed - b.revenueNeed)
      .slice(0, 3);

    const anchorEl = document.getElementById('opp-anchor');
    if (anchorEl) anchorEl.innerHTML = anchorOpps.length
      ? anchorOpps.map(o => `<div style="padding:6px 0;border-bottom:1px solid #f0ece6;font-size:13px">
          <div style="font-weight:600">${o.name}</div>
          <div style="color:#888">${o.deals.length}/3 contracts &bull; ${fmtMoney(o.totalValue)}/${fmtMoney(150000)} &bull; ${o.monthsLeft} months left</div>
        </div>`).join('')
      : '<div class="empty-state" style="text-align:left">No anchor opportunities in progress.</div>';

    // Wallet Share (20% growth, $60k min)
    const walletEl = document.getElementById('opp-wallet');
    if (walletEl) walletEl.innerHTML = '<div style="font-size:12px;color:#aaa">Requires prior year data comparison. Coming soon.</div>';

    // Retention ($200k in calendar year)
    const currentYear = now.getFullYear();
    const retentionOpps = Object.values(orgs)
      .filter(o => {
        const thisYearValue = o.deals
          .filter(d => new Date(d.won_time || d.close_time || now).getFullYear() === currentYear)
          .reduce((s, d) => s + (d.value || 0), 0);
        return thisYearValue < 200000 && thisYearValue > 0;
      })
      .map(o => {
        const thisYearValue = o.deals
          .filter(d => new Date(d.won_time || d.close_time || now).getFullYear() === currentYear)
          .reduce((s, d) => s + (d.value || 0), 0);
        return { ...o, thisYearValue, need: 200000 - thisYearValue };
      })
      .sort((a, b) => a.need - b.need)
      .slice(0, 3);

    const retentionEl = document.getElementById('opp-retention');
    if (retentionEl) retentionEl.innerHTML = retentionOpps.length
      ? retentionOpps.map(o => `<div style="padding:6px 0;border-bottom:1px solid #f0ece6;font-size:13px">
          <div style="font-weight:600">${o.name}</div>
          <div style="color:#888">${fmtMoney(o.thisYearValue)} this year &bull; needs ${fmtMoney(o.need)} more</div>
        </div>`).join('')
      : '<div class="empty-state" style="text-align:left">No retention opportunities in progress.</div>';

  } catch (e) {
    if (loadEl) loadEl.style.display = 'none';
    console.error('loadPipedriveOpportunities:', e);
  }
}

async function submitB2BBonuses() {
  const btn = document.getElementById('submit-b2b-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  try {
    // Re-load bonuses summary which will refresh the display
    await loadBonusSummary(PAGE_CONFIG);
    if (btn) { btn.textContent = 'Submitted!'; }
    setTimeout(() => {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit for Approval'; }
    }, 2000);
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit for Approval'; }
    alert('Error submitting. Please try again.');
  }
}
