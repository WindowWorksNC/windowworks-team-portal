/* ============================================================
   PTO MODULE
   Handles PTO balances, requests, and year-end payout
   ============================================================ */

async function loadPTO(config) {
  await Promise.all([
    loadPTOBalances(config),
    loadMyPTORequests(config),
  ]);
  checkPayoutEligibility(config);
}

async function loadPTOBalances(config) {
  try {
    const d = await api({ action: 'read', tab: 'PTO_Balances' });
    if (!d.success) return;
    const c = cols(d.data[0]);
    const row = d.data.slice(1).find(r => (r[c('Employee')] || '').trim() === config.name);
    if (!row) return;

    const vacUsed = Number(row[c('Vacation Used')]) || 0;
    const sickUsed = Number(row[c('Sick Used')]) || 0;
    const vacBal = Number(row[c('Vacation Balance')]) || 0;
    const sickBal = Number(row[c('Sick Balance')]) || 0;
    const hireDate = row[c('Hire Date')] || '';
    const vacTotal = vacUsed + vacBal;
    const sickTotal = sickUsed + sickBal;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setW = (id, v) => { const el = document.getElementById(id); if (el) el.style.width = v; };

    set('vac-remaining', vacBal);
    set('vac-used', `of ${vacTotal} used: ${vacUsed}`);
    setW('vac-bar', vacTotal > 0 ? Math.min(100, (vacUsed / vacTotal) * 100) + '%' : '0%');
    set('sick-remaining', sickBal);
    set('sick-used', `of ${sickTotal} used: ${sickUsed}`);
    setW('sick-bar', sickTotal > 0 ? Math.min(100, (sickUsed / sickTotal) * 100) + '%' : '0%');

    if (hireDate) {
      const hire = new Date(hireDate);
      const eligibleDate = new Date(hire);
      eligibleDate.setDate(eligibleDate.getDate() + 90);
      const now = new Date();
      const noticeEl = document.getElementById('pto-eligibility-notice');
      if (noticeEl) {
        if (now < eligibleDate) {
          noticeEl.style.display = 'block';
          noticeEl.textContent = `PTO accruing now. You may submit requests, but they cannot be approved until your 90-day probation ends on ${fmtDate(eligibleDate)}.`;
        } else {
          noticeEl.style.display = 'none';
        }
      }
      const hm = document.getElementById('hire-meta');
      if (hm) hm.textContent = 'Hire date: ' + fmtDate(hireDate);
    }
  } catch (e) { console.error('loadPTOBalances:', e); }
}

async function loadMyPTORequests(config) {
  const loadEl = document.getElementById('my-requests-loading');
  const tableEl = document.getElementById('my-requests-table');
  const emptyEl = document.getElementById('my-requests-empty');
  try {
    const d = await api({ action: 'read', tab: 'PTO_Requests' });
    if (loadEl) loadEl.style.display = 'none';
    if (!d.success) { if (emptyEl) emptyEl.style.display = 'block'; return; }
    const c = cols(d.data[0]);
    const today = new Date().toISOString().split('T')[0];
    const rows = d.data.slice(1).filter(r => (r[c('Employee')] || '').trim() === config.name && r.some(x => x));
    if (!rows.length) { if (emptyEl) emptyEl.style.display = 'block'; return; }
    if (tableEl) tableEl.style.display = 'table';
    const tbody = document.getElementById('my-requests-body');
    if (!tbody) return;
    tbody.innerHTML = rows.slice().reverse().map(r => {
      const status = (r[c('Status')] || 'Pending').trim();
      const endDate = (r[c('End Date')] || r[c('Start Date')] || '').trim();
      let pill;
      if (status === 'Approved' && endDate >= today) pill = '<span class="pill" style="background:#d4edda;color:#155724">Upcoming</span>';
      else if (status === 'Approved') pill = '<span class="pill pill-approved">Approved</span>';
      else if (status === 'Denied') pill = '<span class="pill pill-denied">Denied</span>';
      else pill = '<span class="pill pill-pending">Pending</span>';
      const dates = fmtDate(r[c('Start Date')]) + (r[c('End Date')] && r[c('End Date')] !== r[c('Start Date')] ? ' to ' + fmtDate(r[c('End Date')]) : '');
      return `<tr>
        <td>${fmtDate(r[c('Submitted')])}</td>
        <td>${r[c('Type')] || ''}</td>
        <td>${dates}</td>
        <td>${r[c('Days')] || ''}</td>
        <td>${pill}</td>
        <td>${r[c('Reviewed By')] || ''}</td>
        <td>${r[c('Reason')] || ''}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    if (loadEl) loadEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    console.error('loadMyPTORequests:', e);
  }
}

async function submitPTO(employeeName, approver) {
  const type = document.getElementById('pto-type')?.value;
  const start = document.getElementById('pto-start')?.value;
  const end = document.getElementById('pto-end')?.value || start;
  const days = document.getElementById('pto-days')?.value;
  const notes = document.getElementById('pto-notes')?.value || '';
  const alertEl = document.getElementById('pto-form-alert');

  if (!start || !days) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-error">Start date and number of days are required.</div>';
    return;
  }

  const btn = document.getElementById('pto-submit-btn');
  btn.disabled = true; btn.textContent = 'Submitting...';

  try {
    const row = [`PTO-${Date.now()}`, employeeName, type, start, end, Number(days), notes, 'Pending', new Date().toLocaleDateString('en-US'), ''];
    await api({ action: 'append', tab: 'PTO_Requests', row: JSON.stringify(row) });
    if (alertEl) alertEl.innerHTML = `<div class="alert alert-success">Request submitted. ${approver} will review it.</div>`;
    ['pto-start', 'pto-end', 'pto-days', 'pto-notes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('pto-warnings').innerHTML = '';
    await loadMyPTORequests(PAGE_CONFIG);
  } catch (e) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-error">Error submitting. Please try again.</div>';
  }
  btn.disabled = false; btn.textContent = 'Submit Request';
}

function checkPayoutEligibility(config) {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed, Oct=9
  const wrap = document.getElementById('payout-request-wrap');
  if (!wrap) return;
  if (month >= 9) { // Oct-Dec
    wrap.style.display = 'block';
    const vacBal = Number(document.getElementById('vac-remaining')?.textContent) || 0;
    const eligible = Math.min(5, vacBal);
    const msgEl = document.getElementById('payout-eligible-msg');
    if (msgEl) msgEl.innerHTML = `<div class="alert alert-info" style="margin-bottom:8px">You have ${vacBal} unused vacation day${vacBal !== 1 ? 's' : ''}. Up to ${eligible} day${eligible !== 1 ? 's' : ''} eligible for payout.</div>`;
    const btn = document.getElementById('payout-btn');
    if (btn) btn.disabled = eligible <= 0;
  }
}

async function submitPayoutRequest(slug) {
  const btn = document.getElementById('payout-btn');
  if (!btn) return;
  const vacBal = Number(document.getElementById('vac-remaining')?.textContent) || 0;
  const eligible = Math.min(5, vacBal);
  if (eligible <= 0) return;
  if (!confirm(`Request payout for ${eligible} unused vacation day${eligible !== 1 ? 's' : ''}?`)) return;
  btn.disabled = true; btn.textContent = 'Submitting...';
  try {
    const now = new Date();
    const row = [`PTO-PAYOUT-${Date.now()}`, PAGE_CONFIG.name, 'Payout Request', now.toISOString().split('T')[0], now.toISOString().split('T')[0], eligible, `Year-end vacation payout request: ${eligible} days`, 'Pending', now.toLocaleDateString('en-US'), ''];
    await api({ action: 'append', tab: 'PTO_Requests', row: JSON.stringify(row) });
    btn.textContent = 'Submitted!';
    btn.style.background = '#d4edda'; btn.style.color = '#155724';
    setTimeout(() => { btn.textContent = 'Request Year-End Payout'; btn.style.background = ''; btn.style.color = ''; btn.disabled = false; }, 3000);
    await loadMyPTORequests(PAGE_CONFIG);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Request Year-End Payout';
    alert('Error submitting. Please try again.');
  }
}
