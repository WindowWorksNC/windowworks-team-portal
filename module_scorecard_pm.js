/* ============================================================
   SCORECARD PM MODULE (Keith + future PM employees)
   Uses PAGE_CONFIG.scorecardDomains and scorecardBonusPerDomain
   ============================================================ */

async function loadScorecardPM(config) {
  const q = getCurrentQuarter();
  const el = document.getElementById('sc-quarter');
  if (el) el.textContent = q;

  await Promise.all([
    loadPMDomainData(config),
    loadScorecardArchivePM(config),
  ]);
}

async function loadPMDomainData(config) {
  // Load overdue activities for data integrity domain
  try {
    const d = await api({ action: 'read', tab: 'Overdue_Activities' });
    if (d.success) {
      const c = cols(d.data[0]);
      // Find rows for this employee's Pipedrive ID
      const rows = d.data.slice(1).filter(r => r.some(x => x));
      if (rows.length) {
        // Use team average or individual if available
        const latest = rows[rows.length - 1];
        const avg = Number(latest[c('Team Average')] || latest[2]) || 0;
        const valEl = document.getElementById('d-data-val');
        if (valEl) valEl.textContent = avg.toFixed(1) + ' avg';
        updateDomainPM('domain-data', 'd-data-pill', avg === 0, false);
      }
    }
  } catch (e) {}

  // Load review counts from Reviews sheet
  try {
    const d = await api({ action: 'read', tab: 'Reviews' });
    if (d.success) {
      const c = cols(d.data[0]);
      const q = getCurrentQuarter();
      const year = new Date().getFullYear();
      const rows = d.data.slice(1).filter(r =>
        (r[c('Employee')] || '').trim() === config.name &&
        Number(r[c('Quarter')] || r[1]) === q
      );
      const count = rows.length;
      const valEl = document.getElementById('d-satisfaction-val');
      if (valEl) valEl.textContent = count + '/3';
      updateDomainPM('domain-satisfaction', 'd-satisfaction-pill', count >= 3, count === 0);
      // Render entries
      renderReviewEntries(rows, c);
    }
  } catch (e) {}

  updatePMTotal(config);
}

function renderReviewEntries(rows, c) {
  const container = document.getElementById('d-satisfaction-entries');
  if (!container) return;
  container.innerHTML = rows.map(r => `<div style="padding:6px 0;border-bottom:1px solid #f0ece6;font-size:13px;display:flex;justify-content:space-between">
    <span>${r[c('Customer Name')] || ''}</span>
    <span style="color:#888">${r[c('Type')] || ''} &bull; ${fmtDate(r[c('Date')])}</span>
  </div>`).join('');
}

async function addReviewEntry() {
  const name = document.getElementById('d-satisfaction-name')?.value?.trim();
  const date = document.getElementById('d-satisfaction-date')?.value;
  const type = document.getElementById('d-satisfaction-type')?.value;
  if (!name || !date) { alert('Customer name and date are required.'); return; }

  try {
    const q = getCurrentQuarter();
    const year = new Date().getFullYear();
    const row = [PAGE_CONFIG.name, name, date, type, q, year];
    await api({ action: 'append', tab: 'Reviews', row: JSON.stringify(row) });
    // Clear inputs
    const nameEl = document.getElementById('d-satisfaction-name');
    const dateEl = document.getElementById('d-satisfaction-date');
    if (nameEl) nameEl.value = '';
    if (dateEl) dateEl.value = '';
    // Reload
    loadPMDomainData(PAGE_CONFIG);
  } catch (e) { alert('Error saving. Please try again.'); }
}

function calcMeasurement() {
  const reorder = Number(document.getElementById('d-measurement-reorder')?.value) || 0;
  const total = Number(document.getElementById('d-measurement-total')?.value) || 0;
  if (total === 0) { alert('Total product cost cannot be zero.'); return; }
  const pct = (reorder / total) * 100;
  const pass = pct < 1;
  const valEl = document.getElementById('d-measurement-val');
  if (valEl) valEl.textContent = pct.toFixed(2) + '%';
  updateDomainPM('domain-measurement', 'd-measurement-pill', pass, false);
  updatePMTotal(PAGE_CONFIG);
}

function calcDelivery() {
  const scheduled = Number(document.getElementById('d-delivery-scheduled')?.value) || 0;
  const ontime = Number(document.getElementById('d-delivery-ontime')?.value) || 0;
  if (scheduled === 0) { alert('Jobs scheduled cannot be zero.'); return; }
  const pct = (ontime / scheduled) * 100;
  const pass = pct >= 95;
  const valEl = document.getElementById('d-delivery-val');
  if (valEl) valEl.textContent = pct.toFixed(1) + '%';
  updateDomainPM('domain-delivery', 'd-delivery-pill', pass, false);
  updatePMTotal(PAGE_CONFIG);
}

function updateDomainPM(domainId, pillId, pass, pending) {
  const el = document.getElementById(domainId);
  if (!el) return;
  el.className = 'domain-row ' + (pending ? 'pending' : pass ? 'pass' : 'fail');
  const pillEl = document.getElementById(pillId);
  if (pillEl) pillEl.innerHTML = passFailPill(pass, pending);
  updatePMTotal(PAGE_CONFIG);
}

function updatePMTotal(config) {
  const bonus = config.scorecardBonusPerDomain || 1250;
  const domains = config.scorecardDomains || [];
  let total = 0;
  domains.forEach(id => {
    const el = document.getElementById('domain-' + id);
    if (el && el.classList.contains('pass')) total += bonus;
  });
  const el = document.getElementById('sc-total');
  if (el) el.textContent = fmtMoney(total);
}

async function closeQuarter() {
  const btn = document.getElementById('close-qtr-btn');
  const alertEl = document.getElementById('close-qtr-alert');
  const q = getCurrentQuarter();
  const year = new Date().getFullYear();
  const config = PAGE_CONFIG;

  if (!confirm(`Close Q${q} scorecard? This will submit your bonus for approval.`)) return;
  btn.disabled = true; btn.textContent = 'Closing...';

  try {
    const bonus = config.scorecardBonusPerDomain || 1250;
    const domains = config.scorecardDomains || [];
    let total = 0;
    const domainResults = domains.map(id => {
      const el = document.getElementById('domain-' + id);
      const pass = el?.classList.contains('pass');
      if (pass) total += bonus;
      const valEl = document.getElementById('d-' + id + '-val');
      return { id, pass, val: valEl?.textContent || '--' };
    });

    // Archive row
    const archiveRow = [config.name, q, year,
      ...domainResults.flatMap(d => [d.val, d.pass ? 'Pass' : 'Fail']),
      total, new Date().toLocaleDateString('en-US'), ''];
    await api({ action: 'append', tab: 'Scorecard_Archive', row: JSON.stringify(archiveRow) });

    // Create bonus entry for approval
    const bonusRow = [config.name, 'Scorecard', `Q${q} ${year} Scorecard`, total, q, 'Earned',
      new Date().toLocaleDateString('en-US'), '', '', `Q${q} ${year}`];
    await api({ action: 'append', tab: 'Bonuses', row: JSON.stringify(bonusRow) });

    if (alertEl) alertEl.innerHTML = '<div class="alert alert-success">Quarter closed. Your bonus has been submitted for approval.</div>';
    loadScorecardArchivePM(config);
  } catch (e) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-error">Error closing quarter. Please try again.</div>';
  }
  btn.disabled = false; btn.textContent = 'Close Quarter';
}

async function loadScorecardArchivePM(config) {
  try {
    const d = await api({ action: 'read', tab: 'Scorecard_Archive' });
    if (!d.success) return;
    const c = cols(d.data[0]);
    const rows = d.data.slice(1).filter(r => (r[c('Employee')] || '').trim() === config.name);
    const container = document.getElementById('sc-archive-body');
    if (!container) return;
    if (!rows.length) { container.innerHTML = '<div class="empty-state">No past quarters yet.</div>'; return; }
    container.innerHTML = `<table class="data-table">
      <thead><tr><th>Q</th><th>Year</th><th>Total Earned</th><th>Closed</th></tr></thead>
      <tbody>${rows.slice().reverse().map(r => `<tr>
        <td>Q${r[c('Quarter')] || r[1]}</td>
        <td>${r[c('Year')] || r[2]}</td>
        <td><strong style="color:#c4581f">${fmtMoney(r[c('Total Earned')] || r[rows[0].length - 3] || 0)}</strong></td>
        <td>${fmtDate(r[c('Closed Date')] || r[rows[0].length - 2])}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (e) { console.error('loadScorecardArchivePM:', e); }
}
