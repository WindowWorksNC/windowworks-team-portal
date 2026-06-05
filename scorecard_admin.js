/* ============================================================
   SCORECARD ADMIN MODULE (Brandon)
   3 domains: Pipedrive Perfect, A/R Management, Consistent Performance
   ============================================================ */

const QTR_BONUS_BRANDON = 1500;

async function loadScorecardAdmin(config) {
  const q = getCurrentQuarter();
  const el = document.getElementById('sc-quarter');
  if (el) el.textContent = q;

  await Promise.all([
    loadPipedriveData(),
    loadConsistentFromSheet(),
    loadARHistory(),
    loadScorecardArchiveAdmin(),
  ]);
}

async function loadPipedriveData() {
  try {
    const d = await api({ action: 'read', tab: 'Overdue_Activities' });
    if (!d.success) return;
    const c = cols(d.data[0]);
    const rows = d.data.slice(1).filter(r => r[c('Date')] || r[0]);
    if (!rows.length) return;
    const avg = rows.reduce((s, r) => s + (Number(r[c('Team Average')] || r[2]) || 0), 0) / rows.length;
    const valEl = document.getElementById('d-pipedrive-val');
    if (valEl) valEl.textContent = avg.toFixed(1) + ' team avg';
    updateDomainAdmin('domain-pipedrive', 'd-pipedrive-pill', avg === 0, false);
  } catch (e) { console.error('loadPipedriveData:', e); }
}

async function loadConsistentFromSheet() {
  try {
    const q = getCurrentQuarter();
    const year = new Date().getFullYear();
    const d = await api({ action: 'read', tab: 'Bonuses' });
    if (!d.success) return;
    const c = cols(d.data[0]);
    const row = d.data.slice(1).find(r =>
      (r[c('Employee')] || '').trim() === 'Brandon McClure' &&
      String(r[c('Quarter')]) === String(q) &&
      (r[c('Type')] || '').trim() === 'Scorecard'
    );
    if (row) {
      const pass = (row[c('Status')] || '').trim() === 'Pass';
      updateDomainAdmin('domain-consistent', 'd-consistent-pill', pass, false);
    }
  } catch (e) {}
  updateBTotalAdmin();
}

function processARFile() {
  const file = document.getElementById('ar-file')?.files[0];
  if (!file) return;
  const alertEl = document.getElementById('ar-alert');
  const resultEl = document.getElementById('ar-result');
  if (alertEl) alertEl.innerHTML = '<div class="alert alert-info">Processing...</div>';

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const text = new TextDecoder().decode(e.target.result);
      const lines = text.split('\n');
      const totalLine = lines.find(l => l.toLowerCase().startsWith('total'));
      let total = 0, past30 = 0, p31_60 = 0, p61_90 = 0, p91 = 0;

      if (totalLine) {
        const csvCols = [];
        let cur = '', inQ = false;
        for (let ch of totalLine) {
          if (ch === '"') { inQ = !inQ; }
          else if (ch === ',' && !inQ) { csvCols.push(cur); cur = ''; }
          else { cur += ch; }
        }
        csvCols.push(cur.replace(/\r?\n/, ''));
        const clean = v => Math.abs(Number((v || '').replace(/[$,"]/g, ''))) || 0;
        total = clean(csvCols[6]);
        p31_60 = clean(csvCols[3]);
        p61_90 = clean(csvCols[4]);
        p91 = clean(csvCols[5]);
        past30 = p31_60 + p61_90 + p91;
      }

      if (total > 0) {
        const pct = (past30 / total) * 100;
        const pass = pct < 10;
        const valEl = document.getElementById('d-ar-val');
        if (valEl) valEl.textContent = pct.toFixed(2) + '%';
        if (resultEl) resultEl.innerHTML = `Past 30 days: ${fmtMoney(past30)} / Total: ${fmtMoney(total)} = <strong>${pct.toFixed(2)}%</strong> ${pass ? '<span class="pill pill-approved">Pass</span>' : '<span class="pill pill-denied">Fail</span>'}`;
        if (alertEl) alertEl.innerHTML = '<div class="alert alert-success">File processed.</div>';
        updateDomainAdmin('domain-ar', 'd-ar-pill', pass, false);
        updateBTotalAdmin();

        // Save snapshot
        try {
          const qLabel = 'Q' + getCurrentQuarter() + ' ' + new Date().getFullYear();
          const arRow = [new Date().toLocaleDateString('en-US'), 0, 0, p31_60, p61_90, p91, total, past30, pct.toFixed(2), qLabel];
          await api({ action: 'append', tab: 'AR_Tracking', row: JSON.stringify(arRow) });
          loadARHistory();
        } catch (err) { console.error('AR save:', err); }
      } else {
        if (alertEl) alertEl.innerHTML = '<div class="alert alert-warning">Could not parse totals. Please use the CSV version of the QBO A/R Aging Summary.</div>';
      }
    } catch (err) {
      if (alertEl) alertEl.innerHTML = '<div class="alert alert-error">Error processing file.</div>';
    }
  };
  reader.readAsArrayBuffer(file);
}

async function loadARHistory() {
  try {
    const d = await api({ action: 'read', tab: 'AR_Tracking' });
    const loadEl = document.getElementById('ar-history-loading');
    const tableEl = document.getElementById('ar-history-table');
    if (loadEl) loadEl.style.display = 'none';
    if (!d.success) return;
    const c = cols(d.data[0]);
    const q = getCurrentQuarter();
    const year = new Date().getFullYear();
    const qLabel = 'Q' + q + ' ' + year;
    const rows = d.data.slice(1).filter(r => (r[c('Pay Period')] || r[9] || '').toString().trim() === qLabel);
    if (!rows.length) return;
    if (tableEl) tableEl.style.display = 'table';
    const tbody = document.getElementById('ar-history-body');
    if (!tbody) return;
    tbody.innerHTML = rows.slice().reverse().map(r => {
      const pct = Number(r[c('Past30 Percent')] || r[8]) || 0;
      const pass = pct < 10;
      return `<tr>
        <td>${r[c('Date')] || r[0] || ''}</td>
        <td>${fmtMoney(r[c('Past30 Amount')] || r[7])}</td>
        <td>${fmtMoney(r[c('Total')] || r[6])}</td>
        <td>${pct.toFixed(2)}%</td>
        <td>${pass ? '<span class="pill pill-approved">Pass</span>' : '<span class="pill pill-denied">Fail</span>'}</td>
      </tr>`;
    }).join('');
  } catch (e) { console.error('loadARHistory:', e); }
}

function updateDomainAdmin(domainId, pillId, pass, pending) {
  const el = document.getElementById(domainId);
  if (!el) return;
  el.className = 'domain-row ' + (pending ? 'pending' : pass ? 'pass' : 'fail');
  const pillEl = document.getElementById(pillId);
  if (pillEl) pillEl.innerHTML = passFailPill(pass, pending);
  updateBTotalAdmin();
}

function updateBTotalAdmin() {
  let total = 0;
  ['domain-pipedrive', 'domain-ar', 'domain-consistent'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.classList.contains('pass')) total += QTR_BONUS_BRANDON;
  });
  const el = document.getElementById('sc-total');
  if (el) el.textContent = fmtMoney(total);
}

async function closeQuarterBrandon() {
  const btn = document.getElementById('close-qtr-btn');
  const alertEl = document.getElementById('close-qtr-alert');
  const q = getCurrentQuarter();
  const year = new Date().getFullYear();
  if (!confirm(`Close Q${q} scorecard? This will submit your bonus for Rose and Justin to approve.`)) return;
  btn.disabled = true; btn.textContent = 'Closing...';

  try {
    const d1pass = document.getElementById('domain-pipedrive')?.classList.contains('pass');
    const d2pass = document.getElementById('domain-ar')?.classList.contains('pass');
    const d3pass = document.getElementById('domain-consistent')?.classList.contains('pass');
    const total = (d1pass ? QTR_BONUS_BRANDON : 0) + (d2pass ? QTR_BONUS_BRANDON : 0) + (d3pass ? QTR_BONUS_BRANDON : 0);

    // Archive
    const archiveRow = ['Brandon McClure', q, year,
      document.getElementById('d-pipedrive-val')?.textContent || '--', d1pass ? 'Pass' : 'Fail',
      document.getElementById('d-ar-val')?.textContent || '--', d2pass ? 'Pass' : 'Fail',
      d3pass ? 'Pass' : 'Fail', '', '',
      total, new Date().toLocaleDateString('en-US'), ''];
    await api({ action: 'append', tab: 'Scorecard_Archive', row: JSON.stringify(archiveRow) });

    // Add to Bonuses sheet as pending approval (Rose/Justin will approve)
    const bonusRow = ['Brandon McClure', 'Scorecard', `Q${q} ${year} Scorecard`, total, q, 'Earned',
      new Date().toLocaleDateString('en-US'), '', '', `Q${q} ${year}`];
    await api({ action: 'append', tab: 'Bonuses', row: JSON.stringify(bonusRow) });

    if (alertEl) alertEl.innerHTML = '<div class="alert alert-success">Quarter closed. Rose and Justin have been notified in their portal.</div>';
    loadScorecardArchiveAdmin();
  } catch (e) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-error">Error closing quarter. Please try again.</div>';
  }
  btn.disabled = false; btn.textContent = 'Close Quarter';
}

async function loadScorecardArchiveAdmin() {
  try {
    const d = await api({ action: 'read', tab: 'Scorecard_Archive' });
    if (!d.success) return;
    const c = cols(d.data[0]);
    const rows = d.data.slice(1).filter(r => (r[c('Employee')] || '').trim() === 'Brandon McClure');
    const container = document.getElementById('sc-archive-body');
    if (!container) return;
    if (!rows.length) { container.innerHTML = '<div class="empty-state">No past quarters yet.</div>'; return; }
    container.innerHTML = `<table class="data-table">
      <thead><tr><th>Quarter</th><th>Year</th><th>Pipedrive Perfect</th><th>A/R Management</th><th>Consistent Performance</th><th>Total Earned</th><th>Closed</th></tr></thead>
      <tbody>${rows.slice().reverse().map(r => `<tr>
        <td>Q${r[c('Quarter')] || r[1]}</td>
        <td>${r[c('Year')] || r[2]}</td>
        <td>${(r[c('D1 Status')] || r[4]) === 'Pass' ? '<span class="pill pill-approved">Pass</span>' : '<span class="pill pill-denied">Fail</span>'}</td>
        <td>${(r[c('D2 Status')] || r[6]) === 'Pass' ? '<span class="pill pill-approved">Pass</span>' : '<span class="pill pill-denied">Fail</span>'}</td>
        <td>${(r[c('D3 Status')] || r[8]) === 'Pass' ? '<span class="pill pill-approved">Pass</span>' : '<span class="pill pill-denied">Fail</span>'}</td>
        <td><strong style="color:#c4581f">${fmtMoney(r[c('Total Earned')] || r[11] || 0)}</strong></td>
        <td>${fmtDate(r[c('Closed Date')] || r[12])}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (e) { console.error('loadScorecardArchiveAdmin:', e); }
}
