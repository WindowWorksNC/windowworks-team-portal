/* ============================================================
   WINDOW WORKS TEAM PORTAL
   portal-shared.js
   Shared utilities loaded on every page
   ============================================================ */

const PROXY = 'https://script.google.com/macros/s/AKfycbwfE3icMtaSGtMqP6SMfyJyvluAkUyzhiI7EGz_LV07nYtBiG1UupXaOUxbOC5EBhgCBw/exec';

// ---- API -----------------------------------------------
async function api(params) {
  const url = PROXY + '?' + new URLSearchParams(params);
  const res = await fetch(url);
  return res.json();
}

// ---- COLUMN LOOKUP ------------------------------------
// Usage: const c = cols(d.data[0]); c('Column Name')
function cols(headers) {
  const trimmed = (headers || []).map(h => (h || '').toString().trim());
  return name => trimmed.indexOf(name.trim());
}

// ---- FORMATTING ---------------------------------------
function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const parsed = new Date(typeof d === 'string' ? d.replace(' ', 'T') + (d.includes('Z') || d.includes('T') ? '' : 'Z') : d);
    if (isNaN(parsed)) return d;
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) { return d; }
}

function fmtDateShort(d) {
  if (!d) return '';
  try {
    const parsed = new Date(typeof d === 'string' ? d.replace(' ', 'T') + (d.includes('Z') || d.includes('T') ? '' : 'Z') : d);
    if (isNaN(parsed)) return d;
    return (parsed.getMonth() + 1) + '/' + parsed.getDate() + '/' + String(parsed.getFullYear()).slice(2);
  } catch (e) { return d; }
}

// ---- PILLS --------------------------------------------
function statusPill(s) {
  const map = { Pending: 'pill-pending', Approved: 'pill-approved', Denied: 'pill-denied' };
  return `<span class="pill ${map[s] || 'pill-pending'}">${s || 'Pending'}</span>`;
}

function passFailPill(pass, pending) {
  if (pending) return '<span class="pill pill-gray">Pending</span>';
  return pass ? '<span class="pill pill-approved">Pass</span>' : '<span class="pill pill-denied">Fail</span>';
}

function missingPill() { return '<span class="pill pill-denied">Missing</span>'; }
function presentPill() { return '<span class="pill pill-approved">On File</span>'; }

// ---- TAB SYSTEM ----------------------------------------
// All tabs use class="tab-pane" and id="pane-{name}"
// Buttons use data-pane="{name}"
function initTabs(containerEl) {
  if (!containerEl) return;
  // Collect only the pane IDs managed by THIS tabs container
  const managedPanes = Array.from(containerEl.querySelectorAll('[data-pane]'))
    .map(btn => btn.dataset.pane);

  containerEl.querySelectorAll('[data-pane]').forEach(btn => {
    btn.addEventListener('click', () => {
      const paneName = btn.dataset.pane;
      // Deactivate all buttons in this tabs container
      containerEl.querySelectorAll('[data-pane]').forEach(b => b.classList.remove('active'));
      // Deactivate only panes managed by this container
      managedPanes.forEach(id => {
        const p = document.getElementById('pane-' + id);
        if (p) p.classList.remove('active');
      });
      // Activate clicked button and its pane
      btn.classList.add('active');
      const pane = document.getElementById('pane-' + paneName);
      if (pane) pane.classList.add('active');
    });
  });
  // Activate first tab by default
  const firstBtn = containerEl.querySelector('[data-pane]');
  if (firstBtn) firstBtn.click();
}

// Legacy switchTab compatibility
function switchTab(name, btn) {
  if (!btn) return;
  const body = btn.closest('.body') || document.body;
  body.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const el = document.getElementById('pane-' + name);
  if (el) el.classList.add('active');
}

// ---- VIEW TOGGLE (Team Mgmt / My Dashboard) -----------
function initViewToggle() {
  const teamBtn = document.getElementById('view-team-btn');
  const meBtn = document.getElementById('view-me-btn');
  const teamView = document.getElementById('view-team');
  const meView = document.getElementById('view-me');
  if (!teamBtn || !meBtn) return;

  function switchView(view) {
    const isTeam = view === 'team';
    teamBtn.classList.toggle('active', isTeam);
    teamBtn.classList.toggle('inactive', !isTeam);
    meBtn.classList.toggle('active', !isTeam);
    meBtn.classList.toggle('inactive', isTeam);
    if (teamView) teamView.style.display = isTeam ? 'block' : 'none';
    if (meView) meView.style.display = isTeam ? 'none' : 'block';
    // Activate first tab in the view
    const activeView = isTeam ? teamView : meView;
    if (activeView) {
      const firstTab = activeView.querySelector('.tab');
      if (firstTab) firstTab.click();
    }
  }

  teamBtn.addEventListener('click', () => switchView('team'));
  meBtn.addEventListener('click', () => switchView('me'));
  switchView('team'); // default
}

// ---- PAY PERIOD ----------------------------------------
const PAY_PERIOD_BASE = new Date('2025-12-18T12:00:00Z');

function getCurrentPayPeriod() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const diffDays = Math.floor((today - PAY_PERIOD_BASE) / (1000 * 60 * 60 * 24));
  const periodNum = Math.floor(diffDays / 14);
  const start = new Date(PAY_PERIOD_BASE);
  start.setDate(start.getDate() + periodNum * 14);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  return { start, end, num: periodNum };
}

function fmtPayPeriodLabel(period) {
  const fmt = d => (d.getMonth() + 1).toString().padStart(2, '0') + '/' +
    d.getDate().toString().padStart(2, '0') + '/' +
    String(d.getFullYear()).slice(2);
  return fmt(period.start) + ' \u2013 ' + fmt(period.end);
}

function getCurrentPayPeriodLabel() {
  return fmtPayPeriodLabel(getCurrentPayPeriod());
}

function getNextPayDate(fromDate) {
  const base = PAY_PERIOD_BASE;
  const d = fromDate || new Date();
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const diffDays = Math.floor((today - base) / (1000 * 60 * 60 * 24));
  const periodNum = Math.floor(diffDays / 14);
  const nextEnd = new Date(base);
  nextEnd.setDate(nextEnd.getDate() + (periodNum + 1) * 14 - 1);
  const payDay = new Date(nextEnd);
  payDay.setDate(payDay.getDate() + 2);
  return payDay;
}

// ---- APPROVAL MODAL ------------------------------------
function showApprovalModal(opts) {
  // opts: { sheet, rowIndex, employeeName, type, amount, onConfirm }
  const existing = document.getElementById('approval-modal');
  if (existing) existing.remove();

  const today = new Date();
  const nextPay = getNextPayDate(today);
  const approvalDateStr = today.toLocaleDateString('en-US');
  const payDateStr = nextPay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const overlay = document.createElement('div');
  overlay.id = 'approval-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">Confirm Approval</div>
      <div style="font-size:14px;color:#555;margin-bottom:16px">
        <strong>${opts.employeeName || ''}</strong> &mdash; ${opts.type || ''}<br>
        <strong style="color:#c4581f;font-size:16px">${fmtMoney(opts.amount)}</strong>
      </div>
      <div style="background:#f5f0eb;border-radius:6px;padding:14px;font-size:13px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="color:#888">Approval date</span>
          <span style="font-weight:600">${approvalDateStr}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#888">Pay date</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-weight:600;color:#c4581f" id="modal-pay-display">${payDateStr}</span>
            <input type="date" id="modal-pay-input" value="${nextPay.toISOString().split('T')[0]}"
              style="font-size:12px;border:1px solid #ddd;border-radius:4px;padding:2px 6px;display:none"
              oninput="document.getElementById('modal-pay-display').textContent=new Date(this.value+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})">
            <button onclick="document.getElementById('modal-pay-input').style.display=document.getElementById('modal-pay-input').style.display==='none'?'inline-block':'none'"
              style="font-size:11px;color:#c4581f;background:none;border:none;cursor:pointer;text-decoration:underline">change</button>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="submit-btn" id="modal-confirm-btn" onclick="confirmApprovalModal()">Confirm</button>
        <button class="submit-btn" style="background:#f0ece6;color:#1a1a1a" onclick="document.getElementById('approval-modal').remove()">Cancel</button>
      </div>
    </div>`;

  // Store opts for confirm handler
  overlay._opts = opts;
  overlay._approvalDateStr = approvalDateStr;
  document.body.appendChild(overlay);
}

async function confirmApprovalModal() {
  const overlay = document.getElementById('approval-modal');
  if (!overlay) return;
  const opts = overlay._opts;
  const approvalDateStr = overlay._approvalDateStr;
  const payDateStr = document.getElementById('modal-pay-display')?.textContent || '';

  overlay.querySelectorAll('button').forEach(b => b.disabled = true);

  try {
    const d = await api({ action: 'read', tab: opts.sheet });
    if (!d.success) throw new Error('Read failed');
    const c = cols(d.data[0]);
    const row = [...d.data[opts.rowIndex - 1]];

    const approvedByIdx = c('Approved By') >= 0 ? c('Approved By') : c('Approved by');
    const approvedDateIdx = c('Approved Date') >= 0 ? c('Approved Date') : c('Date Approved');
    const payDateIdx = c('Pay Date');

    if (approvedByIdx >= 0) row[approvedByIdx] = opts.approver || 'Manager';
    if (approvedDateIdx >= 0) row[approvedDateIdx] = approvalDateStr;
    if (payDateIdx >= 0) row[payDateIdx] = payDateStr;

    await api({ action: 'update', tab: opts.sheet, rowIndex: opts.rowIndex, row: JSON.stringify(row) });
    overlay.remove();
    if (opts.onConfirm) opts.onConfirm();
  } catch (e) {
    console.error('confirmApprovalModal error:', e);
    overlay.querySelectorAll('button').forEach(b => b.disabled = false);
    alert('Error saving. Please try again.');
  }
}

// ---- PTO UTILITIES -------------------------------------
function getHolidays(year) {
  // Returns array of date strings 'YYYY-MM-DD' for company holidays
  const h = [];
  // Good Friday (2 days before Easter)
  const easter = getEaster(year);
  const gf = new Date(easter); gf.setDate(gf.getDate() - 2);
  h.push(gf.toISOString().split('T')[0]);
  // Memorial Day (last Monday of May)
  h.push(getNthDayOfMonth(year, 4, 1, -1).toISOString().split('T')[0]);
  // Independence Day (July 4, observed)
  const july4 = new Date(year, 6, 4);
  const july4day = july4.getDay();
  if (july4day === 6) h.push(new Date(year, 6, 3).toISOString().split('T')[0]);
  else if (july4day === 0) h.push(new Date(year, 6, 5).toISOString().split('T')[0]);
  else h.push(new Date(year, 6, 4).toISOString().split('T')[0]);
  // Labor Day (first Monday of September)
  h.push(getNthDayOfMonth(year, 8, 1, 1).toISOString().split('T')[0]);
  // Thanksgiving (4th Thursday of November) + Friday
  const thurs = getNthDayOfMonth(year, 10, 4, 4);
  h.push(thurs.toISOString().split('T')[0]);
  const fri = new Date(thurs); fri.setDate(fri.getDate() + 1);
  h.push(fri.toISOString().split('T')[0]);
  // Christmas (3 days - varies, use Dec 24, 25, 26 as placeholder)
  h.push(`${year}-12-24`, `${year}-12-25`, `${year}-12-26`);
  // New Year's (Dec 31 + Jan 1)
  h.push(`${year}-12-31`, `${year + 1}-01-01`);
  return h;
}

function getEaster(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month, day);
}

function getNthDayOfMonth(year, month, dayOfWeek, n) {
  // n > 0: nth occurrence; n < 0: nth from end
  if (n > 0) {
    const d = new Date(year, month, 1);
    while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
    d.setDate(d.getDate() + (n - 1) * 7);
    return d;
  } else {
    const d = new Date(year, month + 1, 0);
    while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() - 1);
    return d;
  }
}

function countWorkingDays(startStr, endStr) {
  if (!startStr) return 0;
  const end = new Date((endStr || startStr) + 'T12:00:00');
  const holidays = [
    ...getHolidays(end.getFullYear()),
    ...getHolidays(end.getFullYear() - 1)
  ];
  let count = 0;
  const cur = new Date(startStr + 'T12:00:00');
  while (cur <= end) {
    const day = cur.getDay();
    const ds = cur.toISOString().split('T')[0];
    if (day !== 0 && day !== 6 && !holidays.includes(ds)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ---- PTO ACCRUAL ----------------------------------------
function getPTOBalance(hireDate, existingUsed) {
  // Returns { vacAccrued, sickAccrued, vacUsed, sickUsed, vacBalance, sickBalance, eligible, eligibleDate }
  const hire = new Date(hireDate);
  const now = new Date();
  const eligibleDate = new Date(hire);
  eligibleDate.setDate(eligibleDate.getDate() + 90);
  const eligible = now >= eligibleDate;

  const hireYear = hire.getFullYear();
  const currentYear = now.getFullYear();

  let vacAccrued, sickAccrued;

  if (currentYear > hireYear) {
    // Year 2+: full grant on Jan 1
    vacAccrued = 10;
    sickAccrued = 5;
  } else {
    // Year 1: prorate from hire date
    const monthsWorked = (now.getFullYear() - hire.getFullYear()) * 12 +
      (now.getMonth() - hire.getMonth()) +
      (now.getDate() >= hire.getDate() ? 0 : -1);
    const fullMonths = Math.max(0, monthsWorked);
    vacAccrued = Math.min(10, Math.round(fullMonths * 0.8333 * 10) / 10);
    sickAccrued = Math.min(5, Math.round(fullMonths * 0.4167 * 10) / 10);
  }

  const vacUsed = Number((existingUsed || {}).vacUsed || 0);
  const sickUsed = Number((existingUsed || {}).sickUsed || 0);

  return {
    vacAccrued,
    sickAccrued,
    vacUsed,
    sickUsed,
    vacBalance: Math.max(0, vacAccrued - vacUsed),
    sickBalance: Math.max(0, sickAccrued - sickUsed),
    eligible,
    eligibleDate
  };
}

// ---- EXPIRY --------------------------------------------
function expiryDays(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
}
function expiryClass(dateStr) {
  const d = expiryDays(dateStr);
  if (d === null) return '';
  if (d < 0 || d < 30) return 'expiry-danger';
  if (d < 60) return 'expiry-warn';
  return 'expiry-ok';
}
function expiryLabel(dateStr) {
  const d = expiryDays(dateStr);
  if (d === null) return 'No expiry set';
  if (d < 0) return `Expired ${Math.abs(d)}d ago`;
  return `Expires in ${d}d`;
}

// ---- QUARTER -------------------------------------------
function getCurrentQuarter() {
  return Math.floor(new Date().getMonth() / 3) + 1;
}
