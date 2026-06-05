/* ============================================================
   INIT MODULE
   Central initPage() called by every page on DOMContentLoaded
   Also handles pending approval badge
   ============================================================ */

async function initPage(config) {
  const t = config.type;

  // Load My Dashboard tabs (all employees)
  loadRecord(config);
  loadPTO(config);

  // Role-specific loads
  if (t === 'b2b' || t === 'b2c') {
    loadCommission(config);
  }
  if (t === 'b2b') {
    loadB2BBonuses(config);
  }
  if (t === 'pm') {
    loadScorecardPM(config);
  }
  if (t === 'admin') {
    loadScorecardAdmin(config);
    // Team Management
    loadTeamCommission(config);
    loadTeamIncentive(config);
    loadTeamPTO(config);
    loadTeamRecords(config);
    loadTeamDashboard(config);
  }
  if (t === 'owner') {
    // Team Management
    loadTeamCommission(config);
    loadTeamIncentive(config);
    loadTeamPTO(config);
    loadTeamRecords(config);
    loadTeamDashboard(config);
    loadConsistentPerformance(config);
  }

  // Resources loaded on tab click (lazy)
  const resBtn = document.querySelector('[data-pane="resources"]');
  if (resBtn) {
    resBtn.addEventListener('click', () => {
      if (typeof renderPayroll === 'function' && !resBtn._loaded) {
        resBtn._loaded = true;
        try {
          document.getElementById('year-sel').value = new Date().getFullYear();
          document.getElementById('hol-yr').value = new Date().getFullYear();
          renderPayroll();
          renderHolidays();
        } catch (e) {}
      }
    });
  }
}

async function checkPendingApprovals() {
  const t = PAGE_CONFIG.type;
  if (t !== 'admin' && t !== 'owner') return;

  try {
    let count = 0;
    const items = [];

    // Check commissions
    try {
      const d = await api({ action: 'read', tab: 'Commissions' });
      if (d.success) {
        const c = cols(d.data[0]);
        const pending = d.data.slice(1).filter(r => r.some(x => x) && !r[c('Approved by')] && !r[c('Approved By')]);
        if (pending.length) { count += pending.length; items.push(`${pending.length} commission${pending.length > 1 ? 's' : ''}`); }
      }
    } catch (e) {}

    // Check PTO
    try {
      const d = await api({ action: 'read', tab: 'PTO_Requests' });
      if (d.success) {
        const c = cols(d.data[0]);
        const pending = d.data.slice(1).filter(r => {
          const status = (r[c('Status')] || '').trim();
          const emp = (r[c('Employee')] || '').trim();
          // Admin: see all except own; Owner: see all
          if (t === 'admin' && emp === PAGE_CONFIG.name) return false;
          return !status || status === 'Pending';
        });
        if (pending.length) { count += pending.length; items.push(`${pending.length} PTO request${pending.length > 1 ? 's' : ''}`); }
      }
    } catch (e) {}

    // Check bonuses
    try {
      const [d1, d2, d3] = await Promise.all([
        api({ action: 'read', tab: 'B2B_Partner_Bounties' }).catch(() => ({ success: false })),
        api({ action: 'read', tab: 'B2B_Booking_Bonuses' }).catch(() => ({ success: false })),
        api({ action: 'read', tab: 'Bonuses' }).catch(() => ({ success: false })),
      ]);
      let bonusCount = 0;
      if (d1.success) {
        const c = cols(d1.data[0]);
        bonusCount += d1.data.slice(1).filter(r => r.some(x => x) && !r[c('Approved By')]).length;
      }
      if (d2.success) {
        const c = cols(d2.data[0]);
        bonusCount += d2.data.slice(1).filter(r => r.some(x => x) && !r[c('Approved By')]).length;
      }
      if (d3.success) {
        const c = cols(d3.data[0]);
        d3.data.slice(1).filter(r => r.some(x => x) && !r[c('Approved By')]).forEach(r => {
          // Brandon's scorecard bonus only shown to owners
          const emp = (r[c('Employee')] || '').trim();
          if (emp === 'Brandon McClure' && t !== 'owner') return;
          bonusCount++;
        });
      }
      if (bonusCount) { count += bonusCount; items.push(`${bonusCount} bonus item${bonusCount > 1 ? 's' : ''}`); }
    } catch (e) {}

    // Update badge
    const badge = document.getElementById('pending-badge');
    if (badge && count > 0) {
      badge.style.display = 'inline-block';
      badge.textContent = `${count} pending`;
      badge.title = items.join(', ');
    }
  } catch (e) { console.error('checkPendingApprovals:', e); }
}
