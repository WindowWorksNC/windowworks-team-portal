/* ============================================================
   COMMISSION MODULE
   Handles commission display for B2C and B2B employees
   ============================================================ */

async function loadCommission(config) {
  const loadEl = document.getElementById('comm-loading');
  const contentEl = document.getElementById('comm-content');
  const emptyEl = document.getElementById('comm-empty');
  const periodEl = document.getElementById('comm-period-display');

  try {
    const d = await api({ action: 'read', tab: 'Commissions' });
    if (loadEl) loadEl.style.display = 'none';
    if (!d.success) return;
    const c = cols(d.data[0]);
    const allRows = d.data.slice(1).filter(r => (r[c('Employee')] || '').trim() === config.name && r.some(x => x));

    const currentPeriod = getCurrentPayPeriodLabel();
    let displayPeriod = currentPeriod;
    let currentRows = allRows.filter(r => (r[c('Pay Period')] || '').trim() === currentPeriod);

    // Fall back to most recent period with data
    if (!currentRows.length && allRows.length) {
      const periods = [...new Set(allRows.map(r => (r[c('Pay Period')] || '').trim()).filter(Boolean))];
      if (periods.length) {
        displayPeriod = periods[periods.length - 1];
        currentRows = allRows.filter(r => (r[c('Pay Period')] || '').trim() === displayPeriod);
      }
    }

    if (periodEl) periodEl.textContent = displayPeriod;

    const periodTotal = currentRows.reduce((s, r) => s + (Number(r[c('Commission')]) || 0), 0);
    const ytd = allRows.reduce((s, r) => s + (Number(r[c('Commission')]) || 0), 0);

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('comm-period-total', fmtMoney(periodTotal));
    set('comm-ytd', fmtMoney(ytd));

    if (contentEl) contentEl.style.display = 'block';

    if (!currentRows.length) {
      if (emptyEl) emptyEl.style.display = 'block';
    } else {
      const table = document.getElementById('comm-table');
      if (table) table.style.display = 'table';
      const tbody = document.getElementById('comm-body');
      if (tbody) tbody.innerHTML = currentRows.slice().reverse().map(r => `<tr>
        <td>${fmtDate(r[c('Date')])}</td>
        <td>${r[c('Deal Name')] || ''}</td>
        <td>${fmtMoney(r[c('Deal Value')])}</td>
        <td>${(r[c('Rate')] || '').trim()}</td>
        <td><strong style="color:#c4581f">${fmtMoney(r[c('Commission')])}</strong></td>
        <td>${r[c('Approved by')] || r[c('Approved By')] || '<span style="color:#aaa">Pending</span>'}</td>
        <td>${fmtDate(r[c('Approved date')] || r[c('Approved Date')])}</td>
        <td>${r[c('Pay Date')] || ''}</td>
      </tr>`).join('');
    }

    // Load previous periods
    loadPrevPeriods(allRows, displayPeriod, c);

  } catch (e) {
    if (loadEl) loadEl.style.display = 'none';
    console.error('loadCommission:', e);
  }
}

function loadPrevPeriods(allRows, currentPeriod, c) {
  const loadEl = document.getElementById('prev-comm-loading');
  const bodyEl = document.getElementById('prev-comm-body');
  if (loadEl) loadEl.style.display = 'none';
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
    const id = 'pp-' + period.replace(/[^a-z0-9]/gi, '');
    return `<div style="border-top:1px solid #f0ece6;padding:10px 0">
      <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="toggleEl('${id}')">
        <span style="font-size:13px;font-weight:600">${period}</span>
        <span style="font-size:14px;color:#c4581f;font-weight:700">${fmtMoney(total)}</span>
      </div>
      <div id="${id}" style="display:none;margin-top:8px">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Deal</th><th>Value</th><th>Commission</th><th>Approved By</th><th>Pay Date</th></tr></thead>
          <tbody>${pRows.map(r => `<tr>
            <td>${fmtDate(r[c('Date')])}</td>
            <td>${r[c('Deal Name')] || ''}</td>
            <td>${fmtMoney(r[c('Deal Value')])}</td>
            <td><strong style="color:#c4581f">${fmtMoney(r[c('Commission')])}</strong></td>
            <td>${r[c('Approved by')] || r[c('Approved By')] || '<span style="color:#aaa">Pending</span>'}</td>
            <td>${r[c('Pay Date')] || ''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}
