/* Window Works shared scorecard scoring. Single source of truth for the
   scoring math behind Brandon's and Keith's performance scorecards. Consumed
   by brandon.html and keith.html (their own pages) and by rose.html and
   justin.html (the owner Scorecards summary), so the numbers are computed live
   in exactly one place. Depends on page globals: api, cols, getActiveYear,
   getCurrentQuarter (all defined inline on every consuming page) and fetch. */
window.WWSC = (function () {
  var PD_TOKEN = 'e3ede19f7c61fad229f89cf091af089cd5a2318e';
  var PD = 'https://api.pipedrive.com/v1';
  var AMT = { brandon: { full: 1500, half: 750 }, keith: { full: 1250, half: 625 } };
  function amt(who, tier) { var a = AMT[who] || { full: 0, half: 0 }; return tier === 'full' ? a.full : tier === 'half' ? a.half : 0; }

  function pql(s) {
    s = String(s || '').trim(); if (!s) return null;
    if (s.indexOf('-') === 4) { var p = s.split('-'); return new Date(+p[0], (+p[1]) - 1, parseInt((p[2] || '1'), 10), 12, 0, 0); }
    var x = new Date(s); if (!isNaN(x)) { x.setHours(12, 0, 0, 0); return x; } return null;
  }
  function inQ(s) { var x = pql(s); return !!x && x.getFullYear() === getActiveYear() && (Math.floor(x.getMonth() / 3) + 1) === getCurrentQuarter(); }

  // ---- shared survey rating scorer (Brandon office = Q1_Office, Keith install = Q2_Project) ----
  async function surveyRating(qKey) {
    try {
      var d = await api({ action: 'read', tab: 'Survey' });
      if (d.success && d.data && d.data.length > 1) {
        var c = cols(d.data[0]);
        var ti = c('Timestamp'), ri = c('RID'), qi = c(qKey), q1i = c('Q1_Office'), q2i = c('Q2_Project'), si = c('Stage');
        var seen = {};
        d.data.slice(1).forEach(function (r) { var rid = String(r[ri] || ''); if (!rid) return; var st = String(r[si] || '').toLowerCase(); if (!seen[rid] || st === 'complete') seen[rid] = r; });
        var resp = Object.keys(seen).map(function (k) { return seen[k]; }).filter(function (r) { return inQ(r[ti]) && r[qi] !== '' && r[qi] != null; });
        var respRows = resp.map(function (r) { return { rid: String(r[ri] || ''), office: r[q1i], project: r[q2i], ts: r[ti] }; });
        if (resp.length >= 3) {
          var avg = resp.reduce(function (a, r) { return a + Number(r[qi] || 0); }, 0) / resp.length;
          return { tier: avg >= 4.5 ? 'full' : avg >= 4.0 ? 'half' : 'none', display: avg.toFixed(2) + ' avg (' + resp.length + ')', extra: { resp: respRows } };
        }
        return { tier: 'pending', display: resp.length + ' / 3 responses', extra: { resp: respRows } };
      }
      return { tier: 'pending', display: '0 / 3 responses', extra: { resp: [] } };
    } catch (e) { console.error(e); return { tier: 'pending', display: '0 / 3 responses', extra: { resp: [] } }; }
  }

  // ---- Brandon domain 1: Pipeline Accuracy ----
  async function bPipeline() {
    try {
      var d = await api({ action: 'read', tab: 'Pipeline_Accuracy' });
      if (d.success && d.data && d.data.length > 1) {
        var c = cols(d.data[0]); var di = c('Date'), pi = c('Clean_Pct'), fi = c('Failing');
        var rows = d.data.slice(1).filter(function (r) { return inQ(r[di]); });
        if (rows.length) {
          var avg = rows.reduce(function (a, r) { return a + Number(r[pi] || 0); }, 0) / rows.length;
          return { tier: avg >= 95 ? 'full' : avg >= 85 ? 'half' : 'none', display: avg.toFixed(1) + '% avg', extra: { rows: rows, di: di, pi: pi, fi: fi } };
        }
        return { tier: 'pending', display: 'No data this quarter', extra: null };
      }
      return { tier: 'pending', display: 'No data yet', extra: null };
    } catch (e) { console.error(e); return { tier: 'pending', display: 'No data yet', extra: null }; }
  }

  var _installPipelineId = null;
  async function pdInstallPipelineId() {
    if (_installPipelineId !== null) return _installPipelineId;
    try {
      var r = await fetch(PD + '/pipelines?api_token=' + PD_TOKEN);
      var list = ((await r.json()) || {}).data || [];
      var hit = list.find(function (p) { return /install/i.test(String(p.name || '')) && !/service/i.test(String(p.name || '')); });
      _installPipelineId = hit ? hit.id : 4;
    } catch (e) { _installPipelineId = 4; }
    return _installPipelineId;
  }

  // ---- Brandon domain 2: Collections (live Pipedrive) ----
  async function bCollections() {
    try {
      var pid = await pdInstallPipelineId();
      var acts = [], start = 0, guard = 0;
      while (guard++ < 8) {
        var r = await fetch(PD + '/activities?api_token=' + PD_TOKEN + '&type=installation&done=1&user_id=0&limit=500&start=' + start);
        var j = (await r.json()) || {};
        acts = acts.concat(j.data || []);
        var more = j.additional_data && j.additional_data.pagination && j.additional_data.pagination.more_items_in_collection;
        if (!more) break; start += 500;
      }
      var installByDeal = {};
      acts.forEach(function (a) {
        var id = a.deal_id, mdt = a.marked_as_done_time;
        if (!id || !mdt || !inQ(mdt)) return;
        var d = pql(mdt); if (!d) return;
        if (!installByDeal[id] || d > installByDeal[id].d) installByDeal[id] = { d: d, raw: mdt };
      });
      var dealIds = Object.keys(installByDeal);
      var daysList = [], contrib = [];
      for (var k = 0; k < dealIds.length; k++) {
        var id = dealIds[k], installDate = installByDeal[id].d, installRaw = installByDeal[id].raw;
        var deal = null, dacts = [];
        try { deal = (((await (await fetch(PD + '/deals/' + id + '?api_token=' + PD_TOKEN)).json()) || {}).data) || null; } catch (e) { continue; }
        if (!deal || deal.status !== 'won' || Number(deal.pipeline_id) !== Number(pid)) continue;
        try { dacts = (((await (await fetch(PD + '/deals/' + id + '/activities?api_token=' + PD_TOKEN)).json()) || {}).data) || []; } catch (e) { continue; }
        var collectDate = null, collectRaw = '';
        dacts.forEach(function (a) {
          if (a.type !== 'collect_payment' || !a.done || !a.marked_as_done_time) return;
          var cd = pql(a.marked_as_done_time);
          if (!cd || cd < installDate) return;
          if (!collectDate || cd < collectDate) { collectDate = cd; collectRaw = a.marked_as_done_time; }
        });
        if (!collectDate) continue;
        var days = Math.round((collectDate - installDate) / 86400000);
        daysList.push(days);
        contrib.push({ id: id, name: deal.title || ('Deal ' + id), install: installRaw, collect: collectRaw, days: days });
      }
      if (daysList.length) {
        daysList.sort(function (a, b) { return a - b; });
        var mid = Math.floor(daysList.length / 2);
        var med = daysList.length % 2 ? daysList[mid] : (daysList[mid - 1] + daysList[mid]) / 2;
        return { tier: med <= 2 ? 'full' : med <= 5 ? 'half' : 'none', display: med.toFixed(1) + ' day median (' + daysList.length + ')', extra: { contrib: contrib } };
      }
      return { tier: 'pending', display: 'No completed installs paid this quarter', extra: { contrib: [] } };
    } catch (e) { console.error(e); return { tier: 'pending', display: 'Could not load from Pipedrive', extra: { contrib: null } }; }
  }

  // ---- Keith domain 2: Data Integrity ----
  // Scored on the share of scheduled work days with zero overdue Pipedrive
  // activities, full at 98 percent or better. The nightly job writes a row
  // every day, so weekends and company holidays are filtered out first: he is
  // not expected to be clearing activities on days the office is closed.
  // Holidays come from getHolidays(year) in resources.js, the same source that
  // drives the Resources tab, so the scorecard and the published holiday list
  // cannot disagree. Ranges are expanded to individual days, and the prior
  // year is included because the Christmas and New Year's closure can start in
  // December and end in January.
  var _holCache = {};
  function dkey(x) { return x.getFullYear() + '-' + (x.getMonth() + 1) + '-' + x.getDate(); }
  function holidaySet(year) {
    if (_holCache[year]) return _holCache[year];
    var set = {};
    if (typeof getHolidays === 'function') {
      [year - 1, year].forEach(function (y) {
        var hs = [];
        try { hs = getHolidays(y) || []; } catch (e) { hs = []; }
        hs.forEach(function (h) {
          if (!h || !h.start || !h.end) return;
          var d = new Date(h.start.getFullYear(), h.start.getMonth(), h.start.getDate(), 12, 0, 0);
          var end = new Date(h.end.getFullYear(), h.end.getMonth(), h.end.getDate(), 12, 0, 0);
          var guard = 0;
          while (d <= end && guard++ < 60) {
            set[dkey(d)] = 1;
            d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12, 0, 0);
          }
        });
      });
    }
    _holCache[year] = set;
    return set;
  }
  function isScoredDay(s) {
    var x = pql(s); if (!x) return false;
    var g = x.getDay(); if (g < 1 || g > 5) return false;
    return !holidaySet(x.getFullYear())[dkey(x)];
  }
  async function kData() {
    try {
      var d = await api({ action: 'read', tab: 'Overdue_Activities' });
      if (d.success) {
        var c = cols((d.data && d.data[0]) || []); var di = c('Date'), ei = c('Employee'), oi = c('Overdue Count');
        var rows = d.data.slice(1).filter(function (r) { return (r[ei] || '').trim() === 'Keith Howze' && inQ(r[di]) && isScoredDay(r[di]); });
        if (rows.length) {
          var total = rows.reduce(function (a, r) { return a + Number(r[oi] || 0); }, 0); var avg = total / rows.length;
          var clean = rows.filter(function (r) { return Number(r[oi] || 0) === 0; }).length;
          var pct = (clean / rows.length) * 100;
          return { tier: pct >= 98 ? 'full' : 'none', display: clean + '/' + rows.length + ' days (' + pct.toFixed(1) + '%)', extra: { rows: rows, di: di, oi: oi, total: total, avg: avg, clean: clean, pct: pct } };
        }
        return { tier: 'pending', display: 'No data this quarter', extra: null };
      }
      return { tier: 'pending', display: 'No data this quarter', extra: null };
    } catch (e) { console.error(e); return { tier: 'pending', display: 'No data this quarter', extra: null }; }
  }

  // ---- Keith domain 3: Yard Sign Rate ----
  async function kYardsign() {
    try {
      var d = await api({ action: 'read', tab: 'Yard_Signs' });
      if (d.success && d.data && d.data.length > 1) {
        var c = cols(d.data[0]); var di = c('Completed_Date'), sgi = c('Sign');
        var rows = d.data.slice(1).filter(function (r) { return inQ(r[di]); });
        if (rows.length) {
          var yes = rows.filter(function (r) { return String(r[sgi] || '').trim().toLowerCase() === 'yes'; }).length;
          var pct = (yes / rows.length) * 100;
          return { tier: pct >= 90 ? 'full' : 'none', display: yes + '/' + rows.length + ' (' + pct.toFixed(0) + '%)', extra: null };
        }
        return { tier: 'none', display: '0 signs', extra: null };
      }
      return { tier: 'none', display: '0 signs', extra: null };
    } catch (e) { console.error(e); return { tier: 'none', display: '0 signs', extra: null }; }
  }

  // ---- Keith domain 4: Testimonials ----
  async function kTestimonials() {
    try {
      var d = await api({ action: 'read', tab: 'Testimonials' });
      if (d.success && d.data && d.data.length > 1) {
        var c = cols(d.data[0]); var di = c('Date'), cap = c('Capturer');
        var cnt = d.data.slice(1).filter(function (r) { return (r[cap] || '').trim() === 'Keith Howze' && inQ(r[di]); }).length;
        return { tier: cnt >= 5 ? 'full' : cnt >= 3 ? 'half' : 'none', display: cnt + (cnt === 1 ? ' video' : ' videos'), extra: null };
      }
      return { tier: 'pending', display: 'No data yet', extra: null };
    } catch (e) { console.error(e); return { tier: 'pending', display: 'No data yet', extra: null }; }
  }

  var BRANDON_DOMAINS = [
    { key: 'pipeline', label: 'Pipeline Accuracy', valEl: 'd1-val', pillEl: 'd1-pill', domEl: 'domain-pipeline', breakdownEl: 'd1-breakdown' },
    { key: 'collections', label: 'Collections', valEl: 'd2-val', pillEl: 'd2-pill', domEl: 'domain-collections', breakdownEl: 'd2-breakdown' },
    { key: 'office', label: 'Office Satisfaction', valEl: 'd3-val', pillEl: 'd3-pill', domEl: 'domain-office', breakdownEl: 'd3-breakdown' }
  ];
  var KEITH_DOMAINS = [
    { key: 'install', label: 'Install Satisfaction', valEl: 'd1-val', pillEl: 'd1-pill', domEl: 'domain-install', breakdownEl: null },
    { key: 'data', label: 'Data Integrity', valEl: 'd2-avg', pillEl: 'd2-pill', domEl: 'domain-data', breakdownEl: 'd2-breakdown' },
    { key: 'yardsign', label: 'Yard Sign Rate', valEl: 'd3-val', pillEl: 'd3-pill', domEl: 'domain-yardsign', breakdownEl: null },
    { key: 'testimonials', label: 'Testimonials', valEl: 'd4-val', pillEl: 'd4-pill', domEl: 'domain-testimonials', breakdownEl: null }
  ];

  function enrich(who, defs, results) {
    var domains = defs.map(function (def, i) {
      var res = results[i] || { tier: 'pending', display: '', extra: null };
      return { key: def.key, label: def.label, valEl: def.valEl, pillEl: def.pillEl, domEl: def.domEl, breakdownEl: def.breakdownEl, tier: res.tier, earned: amt(who, res.tier), display: res.display, extra: res.extra };
    });
    var total = domains.reduce(function (a, d) { return a + Number(d.earned || 0); }, 0);
    return { who: who, domains: domains, total: total };
  }

  async function computeBrandon() {
    var r = await Promise.all([bPipeline(), bCollections(), surveyRating('Q1_Office')]);
    return enrich('brandon', BRANDON_DOMAINS, r);
  }
  async function computeKeith() {
    var r = await Promise.all([surveyRating('Q2_Project'), kData(), kYardsign(), kTestimonials()]);
    return enrich('keith', KEITH_DOMAINS, r);
  }

  return { amt: amt, inQ: inQ, pql: pql, PD_TOKEN: PD_TOKEN, PD_BASE: PD, computeBrandon: computeBrandon, computeKeith: computeKeith, BRANDON_DOMAINS: BRANDON_DOMAINS, KEITH_DOMAINS: KEITH_DOMAINS };
})();
