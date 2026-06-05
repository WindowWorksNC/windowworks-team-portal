/* ============================================================
   CONSISTENT PERFORMANCE MODULE
   Rose/Justin only -- set Brandon's and other subjective domains
   ============================================================ */

async function loadConsistentPerformance(config) {
  const q = getCurrentQuarter();
  const year = new Date().getFullYear();
  const qEl = document.getElementById('consistent-quarter');
  if (qEl) qEl.textContent = `Q${q} ${year}`;

  try {
    const d = await api({ action: 'read', tab: 'Bonuses' });
    if (!d.success) return;
    const c = cols(d.data[0]);
    const existing = d.data.slice(1).find(r =>
      (r[c('Employee')] || '').trim() === 'Brandon McClure' &&
      String(r[c('Quarter')]) === String(q) &&
      String(r[c('Year')] || '') === String(year) &&
      (r[c('Type')] || '').trim() === 'Scorecard'
    );

    const statusEl = document.getElementById('consistent-current-status');
    if (existing) {
      const result = r[c('Status')] || '';
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.className = result === 'Pass' ? 'alert alert-success' : 'alert alert-warning';
        statusEl.textContent = `Q${q} already set to: ${result}. You can update it below.`;
      }
      const sel = document.getElementById('consistent-result');
      if (sel) sel.value = result;
    } else {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.className = 'alert alert-warning';
        statusEl.textContent = `Q${q} Consistent Performance has not been set yet for Brandon McClure.`;
      }
    }
  } catch (e) { console.error('loadConsistentPerformance:', e); }
}

async function saveConsistentPerformance() {
  const q = getCurrentQuarter();
  const year = new Date().getFullYear();
  const result = document.getElementById('consistent-result')?.value || 'Pass';
  const notes = document.getElementById('consistent-notes')?.value || '';
  const btn = document.querySelector('[onclick="saveConsistentPerformance()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const d = await api({ action: 'read', tab: 'Bonuses' });
    if (!d.success) throw new Error('Read failed');
    const c = cols(d.data[0]);

    const existingIdx = d.data.findIndex(r =>
      (r[c('Employee')] || '').trim() === 'Brandon McClure' &&
      String(r[c('Quarter')]) === String(q) &&
      String(r[c('Year')] || '') === String(year) &&
      (r[c('Type')] || '').trim() === 'Scorecard'
    );

    if (existingIdx > 0) {
      const row = [...d.data[existingIdx]];
      if (c('Status') >= 0) row[c('Status')] = result;
      if (c('Notes') >= 0) row[c('Notes')] = notes;
      await api({ action: 'update', tab: 'Bonuses', rowIndex: existingIdx + 1, row: JSON.stringify(row) });
    } else {
      const row = ['Brandon McClure', 'Scorecard', 'Consistent Performance', 1500, q, result, new Date().toLocaleDateString('en-US'), PAGE_CONFIG.name, '', notes];
      await api({ action: 'append', tab: 'Bonuses', row: JSON.stringify(row) });
    }

    const statusEl = document.getElementById('consistent-current-status');
    if (statusEl) {
      statusEl.className = result === 'Pass' ? 'alert alert-success' : 'alert alert-warning';
      statusEl.textContent = `Q${q} set to: ${result}. Saved by ${PAGE_CONFIG.name}.`;
    }
    if (document.getElementById('consistent-notes')) document.getElementById('consistent-notes').value = '';
  } catch (e) {
    alert('Error saving. Please try again.');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
}
