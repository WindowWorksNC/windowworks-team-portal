/* Window Works Team Portal - DEMO / TRAINING build.

   This file replaces the live api() proxy and the live Pipedrive fetch with a
   fully in-memory mock. Nothing here talks to a real Google Sheet, a real Apps
   Script proxy, or real Pipedrive. Every read returns seeded dummy data, every
   write (append, update, delete) succeeds and mutates only this in-memory store,
   so all changes reset the moment the page is reloaded.

   The data shape matches the live proxy exactly: reads return
   { success:true, data:[ headerRow, ...dataRows ] } and the same column order and
   column names the pages look up with cols(). rowIndex stays 1 based with the
   header occupying row 1, matching how the pages compute it.

   Because this defines a global api() before each page's own script runs, and the
   page scripts have had their inline api()/PROXY removed in the demo build, this
   mock is the only api() in play.
*/
(function () {
  'use strict';

  // ----------------------------------------------------------------------------
  // Date helpers, mirrored from the page logic so seeded rows land in the
  // "current" buckets the UI computes, no matter what day the demo is recorded.
  // ----------------------------------------------------------------------------
  function pad2(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function usDate(d) { return d.toLocaleDateString('en-US'); }
  function addDaysISO(base, n) { var d = new Date(base); d.setDate(d.getDate() + n); return iso(d); }

  // Mirrors getActiveQuarter() in the pages.
  function activeQuarter() {
    var n = new Date(); n.setHours(0, 0, 0, 0);
    var cq = Math.floor(n.getMonth() / 3) + 1, cy = n.getFullYear();
    var qs = new Date(cy, (cq - 1) * 3, 1);
    var ds = Math.round((n - qs) / 86400000);
    if (ds < 14) { return cq === 1 ? { q: 4, year: cy - 1 } : { q: cq - 1, year: cy }; }
    return { q: cq, year: cy };
  }

  // Mirrors getCurrentPayPeriodLabel_*() in the pages: 14 day periods anchored
  // at 2025-12-18, formatted "MM/DD/YY - MM/DD/YY".
  function payPeriodLabel(offsetPeriods) {
    var startMs = Date.UTC(2025, 11, 18);
    var now = new Date();
    var todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var periodNum = Math.floor((todayMs - startMs) / (14 * 86400000)) + (offsetPeriods || 0);
    var psMs = startMs + periodNum * 14 * 86400000;
    var peMs = psMs + 13 * 86400000;
    var fmt = function (ms) {
      var d = new Date(ms);
      return pad2(d.getUTCMonth() + 1) + '/' + pad2(d.getUTCDate()) + '/' + String(d.getUTCFullYear()).slice(2);
    };
    return fmt(psMs) + ' - ' + fmt(peMs);
  }

  var AQ = activeQuarter();
  var Q = AQ.q, YEAR = AQ.year;
  var PERIOD = payPeriodLabel(0);
  var PREV_PERIOD = payPeriodLabel(-1);
  var TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
  var TODAY_ISO = iso(TODAY);
  var TODAY_US = usDate(TODAY);

  // ----------------------------------------------------------------------------
  // Dummy people. These are the only identities in the demo.
  // ----------------------------------------------------------------------------
  // Display name            PIN     role
  // Olivia Owner            1111    Co-Owner (owner roam)
  // Owen Owner              2222    Co-Owner (owner roam)
  // Able Admin              3333    Admin / Payroll
  // Wally Windowsalesguy    4444    Sales (B2C commissions + B2B bonuses)
  // Polly Projectmanager    5555    Project Manager (scorecard + bonuses)

  // ----------------------------------------------------------------------------
  // Seeded tables. Header row first, exactly matching the live column names.
  // ----------------------------------------------------------------------------
  var DB = {};

  // Document blobs stored in the Employee_Records "Documents" column as a JSON
  // string, exactly like the live sheet. Keys are the document names the page
  // lists, each mapped to a OneDrive style link (these are harmless example.com
  // placeholders). The special key "Government ID - Expiry" drives the expiry
  // badges. Wally is set to expire soon and Polly is already expired so the
  // Expiring IDs panel and the Employee Records badge both light up; Able is far
  // out so it shows as healthy.
  var ableDocs = JSON.stringify({
    'Signed Offer Letter': 'https://example.com/onedrive/able-admin/signed-offer-letter',
    'Employee Handbook Acknowledgment': 'https://example.com/onedrive/able-admin/handbook-acknowledgment',
    'Government ID': 'https://example.com/onedrive/able-admin/government-id',
    'Government ID - Expiry': addDaysISO(TODAY_ISO, 240),
    'Direct Deposit Authorization': 'https://example.com/onedrive/able-admin/direct-deposit',
    'W-4': 'https://example.com/onedrive/able-admin/w4',
    'I-9 Verification': 'https://example.com/onedrive/able-admin/i9-verification',
    'Emergency Contact': 'https://example.com/onedrive/able-admin/emergency-contact'
  });
  var wallyDocs = JSON.stringify({
    'Signed Offer Letter': 'https://example.com/onedrive/wally-windowsalesguy/signed-offer-letter',
    'Government ID': 'https://example.com/onedrive/wally-windowsalesguy/government-id',
    'Government ID - Expiry': addDaysISO(TODAY_ISO, 18),
    'Direct Deposit Authorization': 'https://example.com/onedrive/wally-windowsalesguy/direct-deposit',
    'I-9 Verification': 'https://example.com/onedrive/wally-windowsalesguy/i9-verification',
    'Commission / Incentive Outline': 'https://example.com/onedrive/wally-windowsalesguy/commission-outline'
  });
  var pollyDocs = JSON.stringify({
    'Signed Offer Letter': 'https://example.com/onedrive/polly-projectmanager/signed-offer-letter',
    'Government ID': 'https://example.com/onedrive/polly-projectmanager/government-id',
    'Government ID - Expiry': addDaysISO(TODAY_ISO, -6),
    'W-4': 'https://example.com/onedrive/polly-projectmanager/w4',
    'Emergency Contact': 'https://example.com/onedrive/polly-projectmanager/emergency-contact'
  });

  DB.Employee_Records = [
    ['Employee', 'Role', 'Hire Date', 'Email', 'Status', 'PIN', 'Review Due 90Day', 'Review Due Annual', 'Last Review', 'Next Review', 'Documents', 'Notes'],
    ['Olivia Owner', 'Co-Owner', '2007-03-01', 'olivia@example.com', 'Active', '1111', '', '', '', '', '', 'Demo owner account'],
    ['Owen Owner', 'Co-Owner', '2007-03-01', 'owen@example.com', 'Active', '2222', '', '', '', '', '', 'Demo owner account'],
    ['Able Admin', 'Admin / Payroll', '2021-06-14', 'able@example.com', 'Active', '3333', addDaysISO('2021-06-14', 90), addDaysISO('2021-06-14', 365), addDaysISO(TODAY_ISO, -200), addDaysISO(TODAY_ISO, 165), ableDocs, ''],
    ['Wally Windowsalesguy', 'In-Home Sales', '2022-02-01', 'wally@example.com', 'Active', '4444', addDaysISO('2022-02-01', 90), addDaysISO('2022-02-01', 365), addDaysISO(TODAY_ISO, -100), addDaysISO(TODAY_ISO, 265), wallyDocs, ''],
    ['Polly Projectmanager', 'Project Manager', '2020-09-15', 'polly@example.com', 'Active', '5555', addDaysISO('2020-09-15', 90), addDaysISO('2020-09-15', 365), addDaysISO(TODAY_ISO, -60), addDaysISO(TODAY_ISO, 305), pollyDocs, '']
  ];

  DB.PTO_Balances = [
    ['Employee', 'Hire Date', 'Vacation Balance', 'Vacation Used', 'Sick Balance', 'Sick Used'],
    ['Olivia Owner', '2007-03-01', 0, 0, 0, 0],
    ['Owen Owner', '2007-03-01', 0, 0, 0, 0],
    ['Able Admin', '2021-06-14', 7, 3, 4, 1],
    ['Wally Windowsalesguy', '2022-02-01', 9, 1, 5, 0],
    ['Polly Projectmanager', '2020-09-15', 5, 5, 3, 2]
  ];

  DB.PTO_Requests = [
    ['Request ID', 'Employee', 'Type', 'Start Date', 'End Date', 'Days', 'Notes', 'Status', 'Submitted', 'Approved By', 'Reviewed By'],
    ['PTO-1001', 'Wally Windowsalesguy', 'Vacation', addDaysISO(TODAY_ISO, 12), addDaysISO(TODAY_ISO, 14), 3, 'Long weekend trip', 'Pending', usDate(new Date(TODAY.getTime() - 2 * 86400000)), '', ''],
    ['PTO-1002', 'Polly Projectmanager', 'Sick', addDaysISO(TODAY_ISO, -5), addDaysISO(TODAY_ISO, -5), 1, 'Doctor visit', 'Approved', usDate(new Date(TODAY.getTime() - 7 * 86400000)), 'Olivia Owner', 'Olivia Owner'],
    ['PTO-1003', 'Able Admin', 'Vacation', addDaysISO(TODAY_ISO, 20), addDaysISO(TODAY_ISO, 21), 2, 'Family visit', 'Pending', usDate(new Date(TODAY.getTime() - 1 * 86400000)), '', '']
  ];

  // PTO_Archive starts empty but carries the same header so reads are well formed.
  DB.PTO_Archive = [
    ['Request ID', 'Employee', 'Type', 'Start Date', 'End Date', 'Days', 'Notes', 'Status', 'Submitted', 'Approved By', 'Reviewed By']
  ];

  DB.Commissions = [
    ['Date', 'Employee', 'Deal Name', 'Deal Value', 'Stage', 'Status', 'Rate', 'Commission', 'Approved By', 'Deal ID', 'Pay Period', 'Approved Date'],
    [addDaysISO(TODAY_ISO, -3), 'Wally Windowsalesguy', 'Thompson - Full Frame Replacement', 18500, 'Won', 'Approved', '8', 1480, 'Olivia Owner', '5001', PERIOD, TODAY_US],
    [addDaysISO(TODAY_ISO, -2), 'Wally Windowsalesguy', 'Garcia - Patio Door', 6200, 'Won', 'Pending', '8', 496, '', '5002', PERIOD, ''],
    [addDaysISO(TODAY_ISO, -1), 'Wally Windowsalesguy', 'Nguyen - 9 Window Package', 22750, 'Won', 'Pending', '8', 1820, '', '5003', PERIOD, ''],
    [addDaysISO(TODAY_ISO, -16), 'Wally Windowsalesguy', 'Patel - Bay Window', 9400, 'Won', 'Approved', '8', 752, 'Owen Owner', '4901', PREV_PERIOD, usDate(new Date(TODAY.getTime() - 14 * 86400000))],
    [addDaysISO(TODAY_ISO, -18), 'Wally Windowsalesguy', 'Reynolds - Entry Door + Sidelights', 7800, 'Won', 'Approved', '8', 624, 'Owen Owner', '4902', PREV_PERIOD, usDate(new Date(TODAY.getTime() - 14 * 86400000))]
  ];

  DB.B2B_Booking_Bonuses = [
    ['Employee', 'Date', 'Customer', 'Appointment Date', 'Approved By', 'Notes', 'Pay Period', 'Deal ID'],
    ['Wally Windowsalesguy', usDate(new Date(TODAY.getTime() - 2 * 86400000)), 'The Hendersons', addDaysISO(TODAY_ISO, 4), 'Olivia Owner', 'In-home estimate booked', PERIOD, '5301'],
    ['Wally Windowsalesguy', usDate(new Date(TODAY.getTime() - 1 * 86400000)), 'Priya Raman', addDaysISO(TODAY_ISO, 6), '', 'In-home estimate booked', PERIOD, '5302'],
    ['Wally Windowsalesguy', usDate(new Date(TODAY.getTime() - 15 * 86400000)), 'The Okafor Family', addDaysISO(TODAY_ISO, -10), 'Owen Owner', 'In-home estimate booked', PREV_PERIOD, '5303']
  ];

  DB.B2B_Partner_Bounties = [
    ['Employee', 'Date', 'Account', 'Org Name', 'Deal ID', 'Deal Name', 'Status', 'Amount', 'Bonus Type', 'Approved By', 'Approved Date', 'Pay Date'],
    ['Wally Windowsalesguy', usDate(new Date(TODAY.getTime() - 30 * 86400000)), 'Apex Builders Group', 'Apex Builders Group', '4801', '', 'Approved', 250, 'New Partner', 'Olivia Owner', usDate(new Date(TODAY.getTime() - 25 * 86400000)), ''],
    ['Wally Windowsalesguy', usDate(new Date(TODAY.getTime() - 10 * 86400000)), 'Cary Home Renovators', 'Cary Home Renovators', '4802', '', 'Pending', 250, 'New Partner', '', '', '']
  ];

  // Bonuses: Polly has a current quarter scorecard in progress (with saved field
  // values so her scorecard tab pre-fills). Able's Consistent Performance is left
  // unset on purpose so an owner can demo setting it live.
  DB.Bonuses = [
    ['Employee', 'Type', 'Description', 'Amount', 'Quarter', 'Status', 'Year', 'Data', 'Approved By', 'Date Approved', 'Pay Date'],
    ['Polly Projectmanager', 'Scorecard', 'Q' + Q + ' Performance Scorecard', 3000, Q, 'In Progress', YEAR,
      JSON.stringify({ d1reorder: '2', d1total: '40', d3entries: [{ date: TODAY_ISO, note: 'Strong customer follow up on Thompson job' }], d4scheduled: '38', d4ontime: '36' }),
      '', '', '']
  ];

  DB.Equipment = [
    ['Employee', 'Item Type', 'Make / Model', 'Serial Number', 'Date Issued', 'Date Returned', 'Notes'],
    ['Wally Windowsalesguy', 'Company vehicle', 'Ford Transit Connect', 'VIN-DEMO-7781', '2022-02-01', '', 'Wrapped van'],
    ['Wally Windowsalesguy', 'iPad', 'iPad Air', 'SN-DEMO-1042', '2022-02-05', '', 'Measure app loaded'],
    ['Polly Projectmanager', 'Computer', 'Dell Latitude', 'SN-DEMO-3310', '2020-09-16', '', ''],
    ['Able Admin', 'Store keys', 'Showroom key set', 'KEY-DEMO-09', '2021-06-15', '', '']
  ];

  DB.Scorecard_Archive = [
    ['Employee', 'Quarter', 'Year', 'D1 Value', 'D1 Status', 'D2 Value', 'D2 Status', 'D3 Value', 'D3 Status', 'D4 Value', 'D4 Status', 'Total', 'Date Closed', 'Notes'],
    ['Able Admin', Q === 1 ? 4 : Q - 1, Q === 1 ? YEAR - 1 : YEAR, '0.0 team avg', 'Pass', '4.20%', 'Pass', 'Pass', 'Pass', '', '', 4500, usDate(new Date(TODAY.getTime() - 30 * 86400000)), ''],
    ['Polly Projectmanager', Q === 1 ? 4 : Q - 1, Q === 1 ? YEAR - 1 : YEAR, '95%', 'Pass', '92%', 'Pass', 'Pass', 'Pass', '90%', 'Pass', 4500, usDate(new Date(TODAY.getTime() - 30 * 86400000)), '']
  ];

  // Weekly overdue snapshots in the current quarter so Able's domain 1 has data.
  DB.Overdue_Activities = (function () {
    var rows = [['Date', 'Employee', 'Overdue Count', 'Completed Count']];
    var people = ['Wally Windowsalesguy', 'Polly Projectmanager', 'Able Admin'];
    var counts = { 'Wally Windowsalesguy': [0, 0, 1, 0], 'Polly Projectmanager': [0, 0, 0, 0], 'Able Admin': [0, 0, 0, 0] };
    for (var w = 3; w >= 0; w--) {
      var snap = usDate(new Date(TODAY.getTime() - w * 7 * 86400000));
      people.forEach(function (p) {
        rows.push([snap, p, counts[p][3 - w], 12 + w]);
      });
    }
    return rows;
  })();

  DB.AR_Tracking = [
    ['Date', 'Current', 'Bucket 1 30', 'Bucket 31 60', 'Bucket 61 90', 'Bucket 91 Plus', 'Total', 'Past 30', 'Percent', 'Quarter'],
    [TODAY_US, 0, 0, 1200, 600, 200, 50000, 2000, '4.00', 'Q' + Q + ' ' + YEAR]
  ];

  // ----------------------------------------------------------------------------
  // Mock won deals for the B2B account tracker (Wally page). Returned by the
  // fetch shim below when the page calls the Pipedrive deals endpoint. Org names
  // line up with the partner bounty Accounts so claimed vs unclaimed partners
  // both render. won_time uses the "YYYY-MM-DD HH:MM:SS" format the page parses.
  // ----------------------------------------------------------------------------
  function pdWon(d) { return iso(new Date(TODAY.getTime() - d * 86400000)) + ' 14:30:00'; }
  var MOCK_PD_DEALS = [
    { id: 5001, value: 18500, org_id: { value: 9001, name: 'Thompson Residence' }, won_time: pdWon(3) },
    { id: 4801, value: 14200, org_id: { value: 9101, name: 'Apex Builders Group' }, won_time: pdWon(30) },
    { id: 4810, value: 16750, org_id: { value: 9101, name: 'Apex Builders Group' }, won_time: pdWon(12) },
    { id: 4802, value: 9800, org_id: { value: 9102, name: 'Cary Home Renovators' }, won_time: pdWon(10) },
    { id: 4901, value: 11300, org_id: { value: 9103, name: 'Oakwood Renovations' }, won_time: pdWon(60) },
    { id: 5050, value: 8700, org_id: { value: 9104, name: 'Maple Street Contractors' }, won_time: pdWon(5) },

    // ---- Close to ANCHOR ACCOUNT (3 contracts + $150k inside first 12 months) ----
    // Hatcher: 2 contracts, $115k, inside its first year. Closest to anchor.
    { id: 5203, value: 60000, org_id: { value: 9202, name: 'Hatcher Construction' }, won_time: pdWon(150) },
    { id: 5204, value: 55000, org_id: { value: 9202, name: 'Hatcher Construction' }, won_time: pdWon(40) },
    // Crestline: 2 contracts, $80k, inside its first year.
    { id: 5201, value: 42000, org_id: { value: 9201, name: 'Crestline Builders' }, won_time: pdWon(90) },
    { id: 5202, value: 38000, org_id: { value: 9201, name: 'Crestline Builders' }, won_time: pdWon(20) },

    // ---- Close to WALLET SHARE (20% growth over prior year, $60k+ this year) ----
    // Birchwood: $70k last year, $72k this year, just shy of the 20% growth target.
    { id: 5205, value: 70000, org_id: { value: 9203, name: 'Birchwood Homes LLC' }, won_time: '2025-05-10 14:30:00' },
    { id: 5206, value: 72000, org_id: { value: 9203, name: 'Birchwood Homes LLC' }, won_time: pdWon(30) }
  ];

  // ----------------------------------------------------------------------------
  // Deep clone so the pages can edit the arrays they read without corrupting the
  // store. All values are JSON safe (strings, numbers).
  // ----------------------------------------------------------------------------
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function parseRow(row) {
    if (Array.isArray(row)) return row.slice();
    if (typeof row === 'string') { try { return JSON.parse(row); } catch (e) { return [row]; } }
    return [];
  }

  function ensureTab(tab) {
    if (!DB[tab]) DB[tab] = [[]];
    return DB[tab];
  }

  function handle(params) {
    var action = params && params.action;
    var tab = params && params.tab;
    var table = ensureTab(tab);

    if (action === 'read') {
      return { success: true, data: clone(table) };
    }
    if (action === 'append') {
      table.push(parseRow(params.row));
      return { success: true };
    }
    if (action === 'update') {
      var ui = Number(params.rowIndex);
      if (ui >= 1 && ui <= table.length) { table[ui - 1] = parseRow(params.row); return { success: true }; }
      return { success: false, error: 'row out of range' };
    }
    if (action === 'delete') {
      var di = Number(params.rowIndex);
      if (di >= 1 && di <= table.length) { table.splice(di - 1, 1); return { success: true }; }
      return { success: false, error: 'row out of range' };
    }
    return { success: false, error: 'unknown action: ' + action };
  }

  // Global api(), same signature and return shape as the live proxy, with a small
  // simulated latency so loading states still flash like the real thing.
  window.api = function (params) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(handle(params || {})); }, 120);
    });
  };

  // ----------------------------------------------------------------------------
  // Fetch shim: only the Pipedrive deals endpoint is intercepted and answered
  // from MOCK_PD_DEALS. Everything else (fonts, etc.) passes through untouched.
  // ----------------------------------------------------------------------------
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('api.pipedrive.com') !== -1) {
      var body = {
        success: true,
        data: clone(MOCK_PD_DEALS),
        additional_data: { pagination: { more_items_in_collection: false } }
      };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () { return Promise.resolve(body); },
        text: function () { return Promise.resolve(JSON.stringify(body)); }
      });
    }
    if (realFetch) return realFetch(input, init);
    return Promise.reject(new Error('fetch unavailable in demo for ' + url));
  };

  // Expose the store for console tinkering during a demo. Reload to reset.
  window.__WW_DEMO_DB = DB;
  window.WW_DEMO = true;
})();
