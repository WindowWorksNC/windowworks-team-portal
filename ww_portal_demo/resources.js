// ============================================================
// DATE UTILITIES
// ============================================================
function pd(str) {
  // Parse M/D/YYYY or MM/DD/YY
  const p = str.split('/');
  let yr = parseInt(p[2]);
  if (yr < 100) yr += yr < 50 ? 2000 : 1900;
  return new Date(yr, parseInt(p[0])-1, parseInt(p[1]), 12);
}
function fmt(d) {
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function fmtLong(d) {
  return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
}
function fmtRange(a, b) {
  if (!b || a.toDateString()===b.toDateString()) return fmtLong(a);
  return fmtLong(a) + ' - ' + fmtLong(b);
}
function D(y,m,d) { return new Date(y,m-1,d,12); }
function addDays(d,n) { const x=new Date(d); x.setDate(x.getDate()+n); return x; }

// ============================================================
// PAYROLL
// ============================================================
const P2026 = [
  {n:1, s:'12/18/25',e:'12/31/25',due:'12/31/2025',pay:'1/2/2026'},
  {n:2, s:'01/01/26',e:'01/14/26',due:'1/14/2026', pay:'1/16/2026'},
  {n:3, s:'01/15/26',e:'01/28/26',due:'1/28/2026', pay:'1/30/2026'},
  {n:4, s:'01/29/26',e:'02/11/26',due:'2/11/2026', pay:'2/13/2026'},
  {n:5, s:'02/12/26',e:'02/25/26',due:'2/25/2026', pay:'2/27/2026'},
  {n:6, s:'02/26/26',e:'03/11/26',due:'3/11/2026', pay:'3/13/2026'},
  {n:7, s:'03/12/26',e:'03/25/26',due:'3/25/2026', pay:'3/27/2026'},
  {n:8, s:'03/26/26',e:'04/08/26',due:'4/8/2026',  pay:'4/10/2026'},
  {n:9, s:'04/09/26',e:'04/22/26',due:'4/22/2026', pay:'4/24/2026'},
  {n:10,s:'04/23/26',e:'05/06/26',due:'5/6/2026',  pay:'5/8/2026'},
  {n:11,s:'05/07/26',e:'05/20/26',due:'5/20/2026', pay:'5/22/2026'},
  {n:12,s:'05/21/26',e:'06/03/26',due:'6/3/2026',  pay:'6/5/2026'},
  {n:13,s:'06/04/26',e:'06/17/26',due:'6/17/2026', pay:'6/19/2026'},
  {n:14,s:'06/18/26',e:'07/01/26',due:'7/1/2026',  pay:'7/3/2026'},
  {n:15,s:'07/02/26',e:'07/15/26',due:'7/15/2026', pay:'7/17/2026'},
  {n:16,s:'07/16/26',e:'07/29/26',due:'7/29/2026', pay:'7/31/2026'},
  {n:17,s:'07/30/26',e:'08/12/26',due:'8/12/2026', pay:'8/14/2026'},
  {n:18,s:'08/13/26',e:'08/26/26',due:'8/26/2026', pay:'8/28/2026'},
  {n:19,s:'08/27/26',e:'09/09/26',due:'9/9/2026',  pay:'9/11/2026'},
  {n:20,s:'09/10/26',e:'09/23/26',due:'9/23/2026', pay:'9/25/2026'},
  {n:21,s:'09/24/26',e:'10/07/26',due:'10/7/2026', pay:'10/9/2026'},
  {n:22,s:'10/08/26',e:'10/21/26',due:'10/21/2026',pay:'10/23/2026'},
  {n:23,s:'10/22/26',e:'11/04/26',due:'11/4/2026', pay:'11/6/2026'},
  {n:24,s:'11/05/26',e:'11/18/26',due:'11/18/2026',pay:'11/20/2026'},
  {n:25,s:'11/19/26',e:'12/02/26',due:'12/2/2026', pay:'12/4/2026'},
  {n:26,s:'12/03/26',e:'12/16/26',due:'12/16/2026',pay:'12/18/2026'},
];

function genPayroll(year) {
  if (year===2026) return P2026;
  const prev = genPayroll(year-1);
  const last = prev[prev.length-1];
  let start = addDays(pd(last.e), 1);
  const periods = [];
  for (let n=1; n<=26; n++) {
    const end = addDays(start, 13);
    const due = new Date(end);
    let pay = addDays(due, 2);
    if (pay.getDay()===0) pay = addDays(pay, 1);
    if (pay.getDay()===6) pay = addDays(pay, 2);
    const ms = d => (d.getMonth()+1)+'/'+('0'+d.getDate()).slice(-2)+'/'+(d.getFullYear()%100).toString().padStart(2,'0');
    const mf = d => (d.getMonth()+1)+'/'+d.getDate()+'/'+d.getFullYear();
    periods.push({n, s:ms(start), e:ms(end), due:mf(due), pay:mf(pay)});
    start = addDays(end, 1);
  }
  return periods;
}

function renderPayroll() {
  const year = parseInt(document.getElementById('year-sel').value);
  const periods = genPayroll(year);
  const today = new Date(); today.setHours(12,0,0,0);
  let nextPay=null, curPeriod=null;

  periods.forEach(p => {
    const sd=pd(p.s), ed=pd(p.e), payd=pd(p.pay);
    if (today>=sd && today<=ed) curPeriod=p;
    if (payd>=today && !nextPay) nextPay=p;
  });

  const nw = document.getElementById('next-pay-wrap');
  if (nextPay) {
    const payd=pd(nextPay.pay);
    const days=Math.round((payd-today)/(1000*60*60*24));
    const isToday=days===0;
    nw.innerHTML=`<div class="next-pay">
      <div><div class="np-label">${isToday?'Payday! 🤑':'Next Paycheck'}</div>
        <div class="np-date">${isToday?'Today':fmt(payd)}</div>
        <div class="np-sub">${isToday?'Go check your bank 💸':'Period #'+nextPay.n+': '+nextPay.s+' - '+nextPay.e}</div>
      </div>
      <div style="text-align:right">
        <div class="np-date" style="color:${isToday?'#28a745':'#c4581f'}">${isToday?'🎉':days}</div>
        <div class="np-sub">${isToday?'':' days away'}</div>
      </div>
    </div>`;
  } else nw.innerHTML='';

  document.getElementById('payroll-body').innerHTML = periods.map(p => {
    const isCur = curPeriod && p.n===curPeriod.n;
    const isNext = nextPay && p.n===nextPay.n;
    const active = isCur;
    return `<tr class="${active?'cur':''}">
      <td style="text-align:left">${p.n}${active?'<span class="badge badge-org">Current</span>':''}</td>
      <td style="text-align:left">${p.s} - ${p.e}</td>
      <td style="text-align:left">${fmt(pd(p.due))}</td>
      <td style="text-align:left"><strong>${fmt(pd(p.pay))}</strong></td>
    </tr>`;
  }).join('');
}

// ============================================================
// HOLIDAYS
// ============================================================

function getEaster(y) {
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4;
  const l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const mo=Math.floor((h+l-7*m+114)/31)-1;
  const day=((h+l-7*m+114)%31)+1;
  return new Date(y,mo,day,12);
}

function nthWeekday(y,month,weekday,nth) {
  // month 1-based, weekday 0=Sun
  let d=new Date(y,month-1,1,12);
  while(d.getDay()!==weekday) d=addDays(d,1);
  return addDays(d,(nth-1)*7);
}

function lastWeekday(y,month,weekday) {
  let d=new Date(y,month,0,12); // last day of month
  while(d.getDay()!==weekday) d=addDays(d,-1);
  return d;
}

function getHolidays(y) {
  const hols = [];

  // Good Friday (Friday before Easter)
  const easter = getEaster(y);
  const goodFri = addDays(easter,-2);
  hols.push({name:'Good Friday', start:goodFri, end:goodFri, days:1});

  // Memorial Day (last Monday of May)
  const memDay = lastWeekday(y,5,1);
  hols.push({name:'Memorial Day', start:memDay, end:memDay, days:1});

  // Independence Day
  const jul4 = D(y,7,4);
  const jul4day = jul4.getDay();
  let indDay;
  if (jul4day===6) indDay=D(y,7,3);       // Sat -> Fri before
  else if (jul4day===0) indDay=D(y,7,5);  // Sun -> Mon after
  else indDay=jul4;
  hols.push({name:'Independence Day', start:indDay, end:indDay, days:1});

  // Labor Day (first Monday of September)
  const laborDay = nthWeekday(y,9,1,1);
  hols.push({name:'Labor Day', start:laborDay, end:laborDay, days:1});

  // Thanksgiving (4th Thursday of November + Friday)
  const thu = nthWeekday(y,11,4,4);
  const thuFri = addDays(thu,1);
  hols.push({name:'Thanksgiving', start:thu, end:thuFri, days:2});

  // Christmas - follows doc exactly by day of week of Dec 25
  const dec25 = D(y,12,25);
  const dow = dec25.getDay(); // 0=Sun
  let xStart, xEnd, nyStart, nyEnd;

  if (dow===1) { // Monday: close Mon(25)-Wed(27). NY: Mon(1)-Tue(2)
    xStart=D(y,12,25); xEnd=D(y,12,27);
    nyStart=D(y+1,1,1); nyEnd=D(y+1,1,2);
  } else if (dow===2) { // Tuesday: close Mon(24)-Wed(26). NY: Mon(31)-Tue(1)
    xStart=D(y,12,24); xEnd=D(y,12,26);
    nyStart=D(y,12,31); nyEnd=D(y+1,1,1);
  } else if (dow===3) { // Wednesday: close Tue(24)-Thu(26). NY: Tue(31)-Wed(1)
    xStart=D(y,12,24); xEnd=D(y,12,26);
    nyStart=D(y,12,31); nyEnd=D(y+1,1,1);
  } else if (dow===4) { // Thursday: close Wed(24)-Fri(26). NY: Wed(31)-Thu(1)
    xStart=D(y,12,24); xEnd=D(y,12,26);
    nyStart=D(y,12,31); nyEnd=D(y+1,1,1);
  } else if (dow===5) { // Friday: close Wed(23)-Fri(25). NY: Thu(31)-Fri(1)
    xStart=D(y,12,23); xEnd=D(y,12,25);
    nyStart=D(y,12,31); nyEnd=D(y+1,1,1);
  } else if (dow===6) { // Saturday: close Thu(23)-Mon(27). NY: Thu(30)-Fri(31)
    xStart=D(y,12,23); xEnd=D(y,12,27);
    nyStart=D(y,12,30); nyEnd=D(y,12,31);
  } else { // Sunday: close Fri(23)-Tue(27). NY: Fri(30)-Mon(2)
    xStart=D(y,12,23); xEnd=D(y,12,27);
    nyStart=D(y,12,30); nyEnd=D(y+1,1,2);
  }

  // Count workdays
  function workdays(s,e) {
    let ct=0,d=new Date(s);
    while(d<=e){if(d.getDay()!==0&&d.getDay()!==6)ct++;d=addDays(d,1);}
    return ct;
  }

  hols.push({name:'Christmas', start:xStart, end:xEnd, days:workdays(xStart,xEnd)});
  hols.push({name:"New Year's", start:nyStart, end:nyEnd, days:workdays(nyStart,nyEnd)});

  return hols;
}

function renderHolidays() {
  const y = parseInt(document.getElementById('hol-yr').value);
  const today = new Date(); today.setHours(12,0,0,0);
  const hols = getHolidays(y);
  document.getElementById('holidays-body').innerHTML = hols.map(h => {
    const isPast = h.end < today;
    const isCur = h.start<=today && h.end>=today;
    const isUp = h.start>today;
    const badge = isCur ? '<span class="badge badge-grn">This Week</span>' :
                  isPast ? '<span class="badge badge-gry">Past</span>' :
                  '<span class="badge badge-grn">Upcoming</span>';
    return `<div class="hol-row">
      <div>
        <div class="hol-name">${h.name} ${badge}</div>
        <div class="hol-dates">${fmtRange(h.start, h.end)}</div>
      </div>
      <div>
        <div class="hol-ct">${h.days}</div>
        <div class="hol-ct-lbl">day${h.days!==1?'s':''} off</div>
      </div>
    </div>`;
  }).join('');
}

// Init
document.getElementById('year-sel').value = new Date().getFullYear();
document.getElementById('hol-yr').value = new Date().getFullYear();
renderPayroll();
renderHolidays();