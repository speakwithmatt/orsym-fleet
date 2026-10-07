// Orsym Fleet app: the screens from the clickable demo, now reading from and
// writing to Supabase for the signed-in installer business.
import { DAY, startOfDay, addDays, addMonths, daysBetween, sevRank, fmtDate, fmtShort, money, esc } from "./util.js";
import * as db from "./db.js";

let TODAY = startOfDay(new Date());
let CTX; // { org, user, role, members, invites }
function rel(d){const n=daysBetween(TODAY,d); if(n===0) return "today"; if(n===1) return "tomorrow"; if(n===-1) return "yesterday"; return n>0? "in "+n+" days" : Math.abs(n)+" days ago"}

let D;
const byId = id => D.systems.find(s=>s.id===id);

/* ---------- state ---------- */
const S = { view:"overview", q:"", fBrand:"", fStatus:"", fPlan:"", fType:"", sort:"id", dir:1, page:0, alertTab:"open", planTab:"all", jobTab:"schedule", rules:null };
const VIEWS = [["overview","Overview"],["claude","Ask Claude"],["systems","Systems"],["alerts","Alerts"],["jobs","Service jobs"],["plans","Service plans"],["stock","Stock and warranty"],["connections","Connections"],["team","Team"]];

function statusChip(st){const c={Online:"s-good",Underperforming:"s-warn",Offline:"s-bad",Fault:"s-bad"}[st]; return '<span class="chip '+c+'">'+st+'</span>'}
function planChip(p){ if(p==="None") return '<span class="chip plain muted">No plan</span>'; return '<span class="chip plain s-orange">'+p+'</span>'}
function sevChip(s){return '<span class="chip '+({critical:"s-bad",warning:"s-warn",info:"s-info"}[s])+'">'+s[0].toUpperCase()+s.slice(1)+'</span>'}

function stats(){
  const sys=D.systems;
  const online=sys.filter(s=>s.status==="Online").length;
  const openAlerts=D.alerts.filter(a=>a.state==="open");
  const onPlan=sys.filter(s=>s.plan!=="None");
  const arr=onPlan.reduce((t,s)=>t+s.planFee,0);
  const due30=D.jobs.filter(j=>j.state!=="done" && daysBetween(TODAY,j.due)<=30);
  const overdue=D.jobs.filter(j=>j.state!=="done" && j.due<TODAY);
  const kw=sys.reduce((t,s)=>t+s.kw,0);
  return {n:sys.length,online,openAlerts,critical:openAlerts.filter(a=>a.sev==="critical").length,onPlan:onPlan.length,arr,due30,overdue,kw};
}

/* ---------- nav ---------- */
function renderNav(){
  const st=stats();
  const badge={systems:st.n,alerts:st.openAlerts.length,jobs:st.due30.length,plans:st.onPlan};
  document.getElementById("navlist").innerHTML = VIEWS.map(([k,l])=>'<button class="nav'+(S.view===k?' on':'')+'" data-nav="'+k+'" type="button"'+(S.view===k?' aria-current="page"':'')+'>'+l+(badge[k]!=null?'<small class="num'+(k==="alerts"&&st.critical?' hot':'')+'">'+badge[k]+'</small>':'')+'</button>').join("");
}

/* ---------- charts ---------- */
function fleetSeries(){
  const out=[];
  for(let d=29;d>=0;d--){
    const w=D.weather[29-d]; let act=0, exp=0;
    for(const s of D.systems){ const e=s.exp*w; exp+=e; let p=s.perf; if(s.status==="Offline" && d>=s.offlineDays) p=.96; act+=e*p }
    out.push({date:addDays(TODAY,-d),act:act/1000,exp:exp/1000});
  }
  return out;
}
function outputChart(series){
  const W=720,H=230,pl=44,pr=10,pt=12,pb=26;
  const max=Math.ceil(Math.max(...series.map(p=>p.exp))/10)*10;
  const x=i=>pl+(i+.5)*(W-pl-pr)/series.length, bw=(W-pl-pr)/series.length*.62;
  const y=v=>pt+(H-pt-pb)*(1-v/max);
  let g="";
  const ticks=[0,max/2,max];
  for(const t of ticks){ g+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y(t)+'" y2="'+y(t)+'" stroke="var(--line-soft)"/><text x="'+(pl-8)+'" y="'+(y(t)+4)+'" text-anchor="end" font-size="11" fill="var(--muted)">'+t.toFixed(0)+'</text>' }
  series.forEach((p,i)=>{ const last=i===series.length-1; g+='<rect x="'+(x(i)-bw/2)+'" y="'+y(p.act)+'" width="'+bw+'" height="'+(y(0)-y(p.act))+'" rx="2" fill="var(--orange)" opacity="'+(last?1:.78)+'"><title>'+fmtShort(p.date)+': '+p.act.toFixed(1)+' MWh of '+p.exp.toFixed(1)+' expected</title></rect>' });
  g+='<polyline fill="none" stroke="var(--expected)" stroke-width="1.6" stroke-dasharray="4 3" points="'+series.map((p,i)=>x(i)+","+y(p.exp)).join(" ")+'"/>';
  [0,7,14,21,29].forEach(i=>{ g+='<text x="'+x(i)+'" y="'+(H-6)+'" text-anchor="middle" font-size="11" fill="var(--muted)">'+fmtShort(series[i].date)+'</text>' });
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Fleet output, last 30 days, MWh per day">'+g+'</svg>';
}
function sysChart(s){
  const W=500,H=150,pl=34,pr=6,pt=10,pb=22,n=14;
  const pts=[]; for(let d=n-1;d>=0;d--){ const w=D.weather[29-d]; const e=s.exp*w; let p=s.perf; if(s.status==="Offline"&&d>=s.offlineDays) p=.96; pts.push({date:addDays(TODAY,-d),e,a:e*p}) }
  const max=Math.max(1,Math.ceil(Math.max(...pts.map(p=>p.e))/10)*10);
  const x=i=>pl+i*(W-pl-pr)/(n-1), y=v=>pt+(H-pt-pb)*(1-v/max);
  let g='';
  [0,max/2,max].forEach(t=>{ g+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y(t)+'" y2="'+y(t)+'" stroke="var(--line-soft)"/><text x="'+(pl-6)+'" y="'+(y(t)+4)+'" text-anchor="end" font-size="10" fill="var(--muted)">'+Math.round(t)+'</text>' });
  g+='<path d="M'+x(0)+','+y(0)+' '+pts.map((p,i)=>'L'+x(i)+','+y(p.a)).join(' ')+' L'+x(n-1)+','+y(0)+'Z" fill="var(--orange)" opacity=".16"/>';
  g+='<polyline fill="none" stroke="var(--orange)" stroke-width="2" points="'+pts.map((p,i)=>x(i)+','+y(p.a)).join(' ')+'"/>';
  g+='<polyline fill="none" stroke="var(--expected)" stroke-width="1.4" stroke-dasharray="4 3" points="'+pts.map((p,i)=>x(i)+','+y(p.e)).join(' ')+'"/>';
  g+='<circle cx="'+x(n-1)+'" cy="'+y(pts[n-1].a)+'" r="3.5" fill="var(--orange)"/>';
  [0,6,13].forEach(i=>{ g+='<text x="'+x(i)+'" y="'+(H-5)+'" text-anchor="'+(i===0?'start':i===13?'end':'middle')+'" font-size="10" fill="var(--muted)">'+fmtShort(pts[i].date)+'</text>' });
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Daily kWh, last 14 days">'+g+'</svg>';
}

/* ---------- views ---------- */
function head(title,sub,right){return '<div class="page-head"><div><h1>'+title+'</h1><p>'+sub+'</p></div>'+(right||'')+'</div>'}

function vOverview(){
  if(!D.systems.length) return vWelcome();
  const st=stats(), series=fleetSeries(), today=series[series.length-1];
  const pctToday=Math.round(today.act/today.exp*100);
  const brandCounts=brands().map(b=>[b,D.systems.filter(s=>s.brand===b).length]);
  const maxB=brandCounts[0][1];
  const topAlerts=D.alerts.filter(a=>a.state==="open").slice(0,7);
  const upcoming=D.jobs.filter(j=>j.state!=="done").slice(0,6);
  const noPlan=D.systems.filter(s=>s.plan==="None").length;
  return head(greeting()+", "+esc(CTX.org.name),TODAY.toLocaleDateString("en-NZ",{weekday:"long"})+" "+fmtDate(TODAY)+" · "+st.n+" systems · "+(st.kw/1000).toFixed(2)+" MW installed")+
  '<div class="grid g-kpi">'+
    '<button class="kpi" data-nav="systems" data-filter="status:" type="button"><span>Systems online</span><b>'+Math.round(st.online/st.n*100)+'%</b><em>'+st.online+' of '+st.n+' reporting normally</em></button>'+
    '<button class="kpi" data-nav="alerts" type="button"><span>Open alerts</span><b>'+st.openAlerts.length+'</b><em class="'+(st.critical?'down':'')+'">'+st.critical+' critical need a look</em></button>'+
    '<button class="kpi" data-nav="plans" type="button"><span>Plan income</span><b>'+money(st.arr/12)+'<small style="font-size:.8rem;font-weight:500;color:var(--muted)">/mo</small></b><em class="up">'+st.onPlan+' systems on a plan</em></button>'+
    '<button class="kpi" data-nav="jobs" type="button"><span>Services due</span><b>'+st.due30.length+'</b><em class="'+(st.overdue.length?'down':'')+'">'+st.overdue.length+' overdue, rest within 30 days</em></button>'+
    '<button class="kpi opp" data-nav="plans" data-plantab="none" type="button"><span>Plan opportunity</span><b>'+money(noPlan*.25*349/12)+'<small style="font-size:.8rem;font-weight:500;color:var(--muted)">/mo</small></b><em>Revenue from signing 1/4 of your remaining '+noPlan+' installs onto a plan</em></button>'+
  '</div>'+
  '<div class="grid g-2">'+
    '<section class="card"><div class="card-h"><h2>Fleet output, last 30 days</h2><span class="muted num" style="font-size:.8rem">Today '+today.act.toFixed(1)+' MWh · '+pctToday+'% of expected</span></div><div class="card-b chart">'+outputChart(series)+'<div class="legend" style="margin-top:8px"><span><i style="background:var(--orange)"></i>Actual MWh</span><span><i style="background:var(--expected)"></i>Expected for the weather</span></div></div></section>'+
    '<section class="card"><div class="card-h"><h2>Needs attention</h2><button class="link" data-nav="alerts" type="button">All alerts</button></div><div class="list" style="margin-top:6px">'+topAlerts.map(a=>alertRow(a,true)).join("")+'</div></section>'+
  '</div>'+
  '<div class="grid g-2e">'+
    '<section class="card"><div class="card-h"><h2>Systems by inverter brand</h2></div><div class="card-b bars">'+brandCounts.map(([b,n])=>'<div class="bar"><span>'+b+'</span><i><b style="width:'+(n/maxB*100)+'%"></b></i><span>'+n+'</span></div>').join("")+'</div></section>'+
    '<section class="card"><div class="card-h"><h2>Coming up</h2><button class="link" data-nav="jobs" type="button">All jobs</button></div><div class="list" style="margin-top:6px">'+upcoming.map(j=>{const s=byId(j.sys);return '<button class="row" data-sys="'+s.id+'" type="button"><span class="sev '+(j.due<TODAY?'warning':'info')+'"></span><span style="min-width:0"><span class="t" style="display:block">'+esc(s.name)+'</span><span class="d" style="display:block">'+esc(j.kind)+' · '+pname(j.who)+'</span></span><span class="chip plain '+(j.due<TODAY?'s-warn':'')+'">'+(j.due<TODAY?'Overdue':fmtShort(j.due))+'</span></button>'}).join("")+'</div></section>'+
  '</div>';
}

function alertRow(a,compact){
  const s=byId(a.sys);
  if(compact) return '<button class="row" data-sys="'+s.id+'" type="button"><span class="sev '+a.sev+'"></span><span style="min-width:0"><span class="t" style="display:block">'+esc(a.title)+'</span><span class="d" style="display:block">'+esc(s.name)+' · '+s.town+' · '+s.brand+'</span></span>'+sevChip(a.sev)+'</button>';
  return '<div class="row"><span class="sev '+(a.state==="open"?a.sev:"done")+'"></span><button style="all:unset;cursor:pointer;min-width:0" data-sys="'+s.id+'" type="button"><span class="t" style="display:block">'+esc(a.title)+'</span><span class="d" style="display:block">'+esc(s.name)+' · '+s.town+' · '+s.brand+' · '+rel(a.at)+'</span></button>'+
  '<span class="acts">'+(a.state==="open"?'<button class="btn sm" data-ack="'+a.id+'" type="button">Acknowledge</button><button class="btn sm primary" data-job="'+a.id+'" type="button">Create job</button>':'<span class="chip plain">'+(a.state==="job"?"Job created":"Acknowledged")+'</span>')+'</span></div>';
}

function filtered(){
  const q=S.q.trim().toLowerCase();
  let r=D.systems.filter(s=>(!S.fBrand||s.brand===S.fBrand)&&(!S.fStatus||(S.fStatus==="Issues"?s.status!=="Online":s.status===S.fStatus))&&(!S.fPlan||s.plan===S.fPlan)&&(!S.fType||s.type===S.fType)&&(!q||(s.name+" "+s.address+" "+s.id+" "+s.serial+" "+s.model).toLowerCase().includes(q)));
  const k=S.sort, dir=S.dir;
  r.sort((a,b)=>{ let va=a[k], vb=b[k]; if(va instanceof Date){va=+va;vb=+vb} if(va==null)va=-Infinity; if(vb==null)vb=-Infinity; return (va>vb?1:va<vb?-1:0)*dir });
  return r;
}
function vSystems(){
  const r=filtered(), per=25, pages=Math.max(1,Math.ceil(r.length/per)); if(S.page>=pages) S.page=pages-1;
  const rows=r.slice(S.page*per,S.page*per+per);
  const opt=(arr,v)=>arr.map(x=>'<option'+(x[0]===v?' selected':'')+' value="'+x[0]+'">'+x[1]+'</option>').join("");
  const th=(k,l,cls)=>'<th class="'+(cls||'')+'"><button data-sort="'+k+'" class="'+(S.sort===k?'sorted':'')+'" type="button">'+l+(S.sort===k?(S.dir>0?' ↑':' ↓'):'')+'</button></th>';
  return head("Systems","Every system you've installed, with live status from each inverter portal",'<span class="acts-row"><button class="btn" data-import="1" type="button">Import CSV</button><button class="btn primary" data-addsys="1" type="button">+ Add system</button></span>')+
  '<section class="card"><div class="toolbar">'+
    '<input class="input" id="q" type="search" placeholder="Search name, address, serial or model" value="'+esc(S.q)+'" aria-label="Search systems">'+
    '<select class="select" id="fBrand" aria-label="Brand">'+opt([["","All brands"],...brands().map(b=>[b,b])],S.fBrand)+'</select>'+
    '<select class="select" id="fStatus" aria-label="Status">'+opt([["","Any status"],["Issues","Any issue"],["Online","Online"],["Underperforming","Underperforming"],["Offline","Offline"],["Fault","Fault"]],S.fStatus)+'</select>'+
    '<select class="select" id="fPlan" aria-label="Plan">'+opt([["","Any plan"],["None","No plan"],["Monitor","Monitor"],["Care","Care"],["Commercial","Commercial"]],S.fPlan)+'</select>'+
    '<select class="select" id="fType" aria-label="Type">'+opt([["","All types"],["Residential","Residential"],["Commercial","Commercial"],["Farm","Farm"]],S.fType)+'</select>'+
    '<span class="count num">'+r.length+' systems</span>'+
  '</div><div class="tbl-wrap"><table><thead><tr>'+th("name","Customer")+th("brand","Inverter")+th("kw","Size","r")+th("status","Status")+th("plan","Plan")+th("installed","Installed")+th("nextService","Next service")+'</tr></thead><tbody>'+
  (rows.length?rows.map(s=>'<tr class="click" data-sys="'+s.id+'" tabindex="0"><td><strong>'+esc(s.name)+'</strong><span class="sub">'+esc(s.address)+'</span></td><td>'+s.brand+'<span class="sub">'+s.model+'</span></td><td class="r num">'+s.kw+' kW</td><td>'+statusChip(s.status)+'</td><td>'+planChip(s.plan)+'</td><td class="num">'+fmtDate(s.installed)+'</td><td class="num">'+(s.nextService?'<span'+(s.nextService<TODAY?' style="color:var(--warn);font-weight:600"':'')+'>'+fmtDate(s.nextService)+'</span>':'<span class="muted">—</span>')+'</td></tr>').join(""):'<tr><td colspan="7" class="empty">No systems match. Clear a filter to see more.</td></tr>')+
  '</tbody></table></div><div class="pager"><span class="num">'+(r.length?(S.page*per+1)+'–'+Math.min(r.length,S.page*per+per)+' of '+r.length:'0 results')+'</span><div><button class="btn sm" data-pg="-1" type="button"'+(S.page===0?' disabled':'')+'>Previous</button><button class="btn sm" data-pg="1" type="button"'+(S.page>=pages-1?' disabled':'')+'>Next</button></div></div></section>';
}

function vAlerts(){
  const tabs=[["open","Open"],["critical","Critical"],["closed","Handled"]];
  let list=D.alerts.filter(a=>S.alertTab==="open"?a.state==="open":S.alertTab==="critical"?a.state==="open"&&a.sev==="critical":a.state!=="open");
  const open=D.alerts.filter(a=>a.state==="open");
  return head("Alerts","Pulled from every inverter portal every 15 minutes, plus service and warranty dates",'<button class="btn" data-ackall="1" type="button"'+(open.filter(a=>a.sev==="info").length?'':' disabled')+'>Acknowledge all info</button>')+
  '<div class="grid g-kpi">'+[["critical","Critical"],["warning","Warnings"],["info","Info"]].map(([k,l])=>'<div class="kpi"><span>'+l+'</span><b>'+open.filter(a=>a.sev===k).length+'</b><em>open</em></div>').join("")+'<div class="kpi"><span>Handled this week</span><b>'+D.alerts.filter(a=>a.state!=="open").length+'</b><em>acknowledged or turned into jobs</em></div></div>'+
  '<section class="card"><div class="toolbar"><div class="seg" role="tablist">'+tabs.map(([k,l])=>'<button type="button" role="tab" aria-selected="'+(S.alertTab===k)+'" class="'+(S.alertTab===k?'on':'')+'" data-atab="'+k+'">'+l+'</button>').join("")+'</div><span class="count num">'+list.length+' alerts</span></div><div class="list">'+(list.length?list.map(alertRow).join(""):'<div class="empty">Nothing here. Alerts you acknowledge or turn into jobs move to Handled.</div>')+'</div></section>';
}

/* ---------- scheduling ---------- */
let TEAM=[];
const person=id=>TEAM.find(p=>p.id===id);
function pname(id){const p=person(id); return p?(p.short||p.name):"Unassigned"}
const SLOTS=["8:00 am","10:30 am","1:30 pm","3:30 pm"];
const DEFAULT_RULES={mode:"auto",lead:30,residential:"wash",commercial:"josh",fault:"anyteam",team:{cal:true,email:true,board:true},contractor:{email:true,board:false},customer:true};
function weekdays(from,n){const out=[];let d=new Date(from);while(out.length<n){const w=d.getDay();if(w!==0&&w!==6)out.push(new Date(d));d=addDays(d,1)}return out}
const dkey=d=>d.getFullYear()+"-"+d.getMonth()+"-"+d.getDate();
function fmtDay(d){return d.toLocaleDateString("en-NZ",{weekday:"short",day:"numeric",month:"short"})}
function loadOn(who,d){return D.jobs.filter(j=>j.who===who&&j.slot&&j.state!=="done"&&dkey(j.slot)===dkey(d)).length}
function pickWho(j){
  const r=S.rules; let w=j.cat==="fault"?r.fault:j.cat==="commercial"?r.commercial:r.residential;
  if(w==="anyteam"){ const days=weekdays(addDays(TODAY,1),5); w=TEAM.filter(p=>p.kind==="team").map(p=>[p.id,days.reduce((t,d)=>t+loadOn(p.id,d),0)]).sort((a,b)=>a[1]-b[1])[0][0] }
  return w;
}
function findSlot(who,j){
  const tmr=addDays(TODAY,1); let start=tmr;
  if(j.cat!=="fault"){ const s=addDays(j.due,-10); if(s>tmr) start=s }
  const max=person(who).kind==="contractor"?4:3;
  for(const d of weekdays(start,80)){ const n=loadOn(who,d); if(n<max){ const taken=D.jobs.filter(x=>x.who===who&&x.slot&&x.state!=="done"&&dkey(x.slot)===dkey(d)).map(x=>x.time); return {date:d,time:SLOTS.find(t=>!taken.includes(t))||SLOTS[0]} } }
}
function viaFor(who){
  const p=person(who), r=S.rules, v=[];
  if(p.kind==="team"){ if(r.team.cal)v.push("cal"); if(r.team.email)v.push("email"); if(r.team.board)v.push("board") }
  else { if(r.contractor.email)v.push("email"); if(r.contractor.board)v.push("board") }
  return v;
}
function viaText(who,via){const p=person(who); return via.map(v=>v==="cal"?p.cal+" invite":v==="email"?(p.kind==="contractor"?"work order email":"email"):"Fergus job board").join(", ")}
function scheduleJob(j,who,date,time,via,cust,how){
  const p=person(who), s=byId(j.sys);
  Object.assign(j,{who,slot:date,time,via,cust,state:p.kind==="contractor"?"sent":"scheduled",confirmed:false});
  const w=viaText(who,via);
  D.log.unshift({at:how,text:(how.startsWith("Auto")?"Booked ":"You booked ")+j.id+" ("+s.name+") with "+pname(who)+" for "+fmtDay(date)+", "+time+"."+(w?" Sent "+w+".":"")+(cust?" Customer booking email sent.":"")});
}
function queue(){return D.jobs.filter(j=>j.state==="unscheduled"&&daysBetween(TODAY,j.due)<=S.rules.lead).sort((a,b)=>a.due-b.due)}
function autoRun(label){
  let n=0; const ext=new Set();
  for(const j of queue()){ const who=pickWho(j), sl=findSlot(who,j); if(!sl) continue; scheduleJob(j,who,sl.date,sl.time,viaFor(who),S.rules.customer,label); n++; if(person(who).kind==="contractor") ext.add(pname(who)) }
  return {n,ext:[...ext]};
}
function newJob(s,kind,cat,due){
  const n=Math.max(5000,...D.jobs.map(j=>+j.id.slice(4)||0))+1;
  const j={id:"JOB-"+n,sys:s.id,kind,cat,due,who:null,slot:null,state:"unscheduled"};
  D.jobs.push(j); D.jobs.sort((a,b)=>a.due-b.due); return j;
}
// Fill a new account with the sample fleet so there's something to click
// around, then save it all to the database.
async function loadSample(){
  const {buildSample,SAMPLE_TEAM}=await import("./sample.js");
  const x=buildSample(TODAY);
  x.systems.forEach(s=>s.source="sample");
  const me=TEAM.filter(p=>!SAMPLE_TEAM.some(q=>q.id===p.id));
  TEAM=[...me,...SAMPLE_TEAM];
  D={...D,systems:x.systems,alerts:x.alerts.map(a=>({...a,id:"new"+a.id})),jobs:x.jobs,stock:x.stock,claims:x.claims};
  S.rules={mode:"auto",lead:30,residential:"wash",commercial:"josh",fault:"anyteam",team:{cal:true,email:true,board:true},contractor:{email:true,board:false},customer:true};
  CTX.org.settings={...CTX.org.settings,rules:S.rules,weather:x.weather};
  D.weather=x.weather;
  const pre=D.jobs.filter((j,i)=>j.state==="unscheduled"&&(j.cat==="fault"||(daysBetween(TODAY,j.due)<=22&&i%4!==0)));
  for(const j of pre){ const who=pickWho(j), sl=findSlot(who,j); if(sl) scheduleJob(j,who,sl.date,sl.time,viaFor(who),true,"Auto-run") }
  D.jobs.filter(j=>j.state==="sent").forEach((j,i)=>{ if(i%3!==0){ j.state="scheduled"; j.confirmed=true } });
  const o=CTX.org.id, uuidOf=ref=>byId(ref).uuid;
  await db.savePeople(o,SAMPLE_TEAM);
  await db.saveSystems(o,D.systems);
  await db.saveAlerts(o,D.alerts,uuidOf);
  await db.saveJobs(o,D.jobs,uuidOf);
  await db.replaceStockAndClaims(o,D.stock,D.claims,uuidOf);
  await db.saveSettings(CTX.org);
  snapshot();
}
function ruleChange(el){
  const r=S.rules, id=el.id.slice(2);
  if(id==="lead") r.lead=+el.value;
  else if(["residential","commercial","fault"].includes(id)) r[id]=el.value;
  else if(id.startsWith("team-")) r.team[id.slice(5)]=el.checked;
  else if(id.startsWith("con-")) r.contractor[id.slice(4)]=el.checked;
  else if(id==="customer") r.customer=el.checked;
}
function jobStateChip(j){
  if(j.state==="done") return '<span class="chip s-good">Done</span>';
  if(j.state==="unscheduled") return '<span class="chip '+(j.due<TODAY?'s-warn':'')+'">Not booked</span>';
  if(j.state==="sent") return '<span class="chip s-info">Waiting on contractor</span>';
  return '<span class="chip s-good">Booked</span>';
}
function whoOptions(sel,withAny){
  const g=(k,l)=>'<optgroup label="'+l+'">'+TEAM.filter(p=>p.kind===k).map(p=>'<option value="'+p.id+'"'+(p.id===sel?' selected':'')+'>'+esc(p.name)+'</option>').join("")+'</optgroup>';
  return (withAny?'<option value="anyteam"'+(sel==="anyteam"?' selected':'')+'>Whoever on the team is free</option>':'')+g("team","Your team")+g("contractor","Contractors");
}

function vJobs(){
  const tabs=[["schedule","Schedule"],["list","All jobs"]];
  return head("Service jobs","Services fall due from plan dates. Orsym books them with your team or contractors and keeps Fergus in step.",
    '<div class="seg" role="tablist">'+tabs.map(([k,l])=>'<button type="button" role="tab" aria-selected="'+(S.jobTab===k)+'" class="'+(S.jobTab===k?'on':'')+'" data-jtab="'+k+'">'+l+'</button>').join("")+'</div>')+
    (S.jobTab==="list"?jobsList():jobsSchedule());
}

function jobsList(){
  const open=D.jobs.filter(j=>j.state!=="done");
  const groups=[["Overdue",open.filter(j=>j.due<TODAY)],["Next 30 days",open.filter(j=>j.due>=TODAY&&daysBetween(TODAY,j.due)<=30)],["Later",open.filter(j=>daysBetween(TODAY,j.due)>30)],["Done",D.jobs.filter(j=>j.state==="done").slice().reverse()]];
  const row=j=>{const s=byId(j.sys);return '<tr class="click" data-sys="'+s.id+'"><td class="mono">'+j.id+'</td><td><strong>'+esc(s.name)+'</strong><span class="sub">'+s.town+' · '+s.brand+' '+s.kw+' kW</span></td><td>'+esc(j.kind)+'</td><td class="num">'+fmtDate(j.due)+'<span class="sub">'+rel(j.due)+'</span></td><td>'+(j.who?esc(pname(j.who))+(j.slot&&j.state!=="done"?'<span class="sub num">'+fmtDay(j.slot)+', '+j.time+'</span>':''):'<span class="muted">Unassigned</span>')+'</td><td>'+jobStateChip(j)+'</td><td class="r">'+(j.state==="done"?'':j.state==="unscheduled"?'<button class="btn sm primary" data-sched="'+j.id+'" type="button">Schedule</button>':'<button class="btn sm" data-done="'+j.id+'" type="button">Mark done</button>')+'</td></tr>'};
  return groups.map(([l,js])=>'<section class="card"><div class="card-h"><h2>'+l+' <span class="muted num" style="font-weight:500">'+js.length+'</span></h2></div>'+(js.length?'<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Job</th><th>Customer</th><th>Work</th><th>Due</th><th>Booked with</th><th>Status</th><th class="r"></th></tr></thead><tbody>'+js.slice(0,l==="Done"?8:80).map(row).join("")+'</tbody></table></div>':'<div class="empty">No jobs here.</div>')+'</section>').join("");
}

function jobsSchedule(){
  const r=S.rules, q=queue(), waiting=D.jobs.filter(j=>j.state==="sent");
  const chk=(id,label,on)=>'<label><input type="checkbox" id="'+id+'"'+(on?' checked':'')+'> '+label+'</label>';
  const rules='<section class="card"><div class="card-h"><h2>Scheduling rules</h2>'+(r.mode==="auto"?'<span class="chip s-good">Auto · runs 6:00 am daily</span>':'<span class="chip plain">Manual</span>')+'</div><div class="card-b rules">'+
    '<div class="rule"><span>How jobs get booked</span><div class="seg"><button type="button" data-mode="auto" class="'+(r.mode==="auto"?'on':'')+'" aria-pressed="'+(r.mode==="auto")+'">Auto-schedule</button><button type="button" data-mode="manual" class="'+(r.mode==="manual"?'on':'')+'" aria-pressed="'+(r.mode==="manual")+'">I\'ll book them</button></div></div>'+
    '<p class="hint">'+(r.mode==="auto"?'Each morning Orsym books every job in the window below, sends it to whoever does the work and emails the customer. You can still move or rebook anything.':'Jobs wait in Ready to book. Orsym suggests who and when, and you click Schedule.')+'</p>'+
    '<div class="rule"><label for="r-lead">Start booking a service</label><select class="select" id="r-lead">'+[14,21,30,45].map(n=>'<option value="'+n+'"'+(r.lead===n?' selected':'')+'>'+n+' days before it\'s due</option>').join("")+'</select></div>'+
    '<div class="rule"><label for="r-residential">Residential cleans and checks go to</label><select class="select" id="r-residential">'+whoOptions(r.residential,true)+'</select></div>'+
    '<div class="rule"><label for="r-commercial">Commercial services go to</label><select class="select" id="r-commercial">'+whoOptions(r.commercial,true)+'</select></div>'+
    '<div class="rule"><label for="r-fault">Fault callouts go to</label><select class="select" id="r-fault">'+whoOptions(r.fault,true)+'</select></div>'+
    '<div class="divider"></div>'+
    '<div class="rule"><span>Your team gets</span><div class="checks">'+chk("r-team-cal","Calendar invite",r.team.cal)+chk("r-team-email","Email",r.team.email)+chk("r-team-board","Fergus job board",r.team.board)+'</div></div>'+
    '<div class="rule"><span>Contractors get</span><div class="checks">'+chk("r-con-email","Work order email",r.contractor.email)+chk("r-con-board","Fergus job board",r.contractor.board)+'</div></div>'+
    '<div class="rule"><span>Customers get</span><div class="checks">'+chk("r-customer","Booking email and a reminder 2 days before",r.customer)+'</div></div>'+
  '</div></section>';

  const qcard='<section class="card"><div class="card-h"><h2>Ready to book <span class="muted num" style="font-weight:500">'+q.length+'</span></h2>'+(q.length&&r.mode==="auto"?'<button class="btn sm primary" data-autorun="1" type="button">Run auto-schedule now</button>':'')+'</div>'+
    '<p class="hint" style="padding:4px 16px 0">Due in the next '+r.lead+' days and not booked yet.</p><div class="list" style="margin-top:6px">'+
    (q.length?q.slice(0,8).map(j=>{const s=byId(j.sys), who=pickWho(j);return '<div class="row"><span class="sev '+(j.due<TODAY?'warning':j.cat==="fault"?'critical':'info')+'"></span><button style="all:unset;cursor:pointer;min-width:0" data-sys="'+s.id+'" type="button"><span class="t" style="display:block">'+esc(s.name)+'</span><span class="d" style="display:block">'+esc(j.kind)+' · due '+rel(j.due)+' · suggest '+esc(pname(who))+'</span></button><span class="acts"><button class="btn sm" data-sched="'+j.id+'" type="button">Schedule</button></span></div>'}).join("")+(q.length>8?'<div class="empty" style="padding:10px">and '+(q.length-8)+' more</div>':''):'<div class="empty">Everything due in the next '+r.lead+' days is booked.</div>')+'</div></section>';

  const wcard='<section class="card"><div class="card-h"><h2>Waiting on contractors <span class="muted num" style="font-weight:500">'+waiting.length+'</span></h2></div><p class="hint" style="padding:4px 16px 0">Work orders sent. Orsym chases them after 24 hours.</p><div class="list" style="margin-top:6px">'+
    (waiting.length?waiting.slice(0,6).map(j=>{const s=byId(j.sys);return '<div class="row"><span class="sev info"></span><button style="all:unset;cursor:pointer;min-width:0" data-sys="'+s.id+'" type="button"><span class="t" style="display:block">'+esc(s.name)+'</span><span class="d" style="display:block">'+esc(pname(j.who))+' · '+fmtDay(j.slot)+', '+j.time+'</span></button><span class="acts"><button class="btn sm" data-confirm="'+j.id+'" type="button">Mark confirmed</button></span></div>'}).join(""):'<div class="empty">All contractor bookings are confirmed.</div>')+'</div></section>';

  const days=weekdays(TODAY,10);
  const cal='<section class="card"><div class="card-h"><h2>Schedule</h2><div class="legend"><span><i style="background:var(--orange)"></i>Booked</span><span><i style="background:var(--info)"></i>Waiting on contractor</span><span><i style="background:var(--bad)"></i>Fault callout</span></div></div><div class="tbl-wrap" style="margin-top:10px"><table class="cal"><thead><tr><th>Who</th>'+days.map(d=>'<th class="'+(dkey(d)===dkey(TODAY)?'today':'')+'">'+fmtDay(d).replace(/ [A-Z][a-z]+$/,"")+'</th>').join("")+'</tr></thead><tbody>'+
    TEAM.map(p=>'<tr><td class="who"><b>'+esc(p.name)+'</b><span>'+p.role+(p.kind==="team"?' · '+p.cal:'')+'</span></td>'+days.map(d=>{const js=D.jobs.filter(j=>j.who===p.id&&j.slot&&j.state!=="done"&&dkey(j.slot)===dkey(d)).sort((a,b)=>SLOTS.indexOf(a.time)-SLOTS.indexOf(b.time));return '<td class="'+(dkey(d)===dkey(TODAY)?'today':'')+'">'+(js.length?js.map(j=>{const s=byId(j.sys);return '<button class="cj'+(j.cat==="fault"?' fault':'')+(j.state==="sent"?' sent':'')+'" data-sys="'+s.id+'" type="button" title="'+esc(j.kind)+'"><b>'+j.time+'</b> '+esc(s.name)+'<em>'+s.town+'</em></button>'}).join(""):'<span class="cell-free">Free</span>')+'</td>'}).join("")+'</tr>').join("")+
    '</tbody></table></div></section>';

  return '<div class="grid g-2e" style="align-items:start">'+rules+'<div class="grid">'+qcard+wcard+'</div></div>'+cal;
}

/* schedule form */
let SCHED_DAYS=[];
function openSched(jid){
  const j=D.jobs.find(x=>x.id===jid), s=byId(j.sys);
  const who=j.who||pickWho(j), sl=j.slot?{date:j.slot,time:j.time}:findSlot(who,j);
  SCHED_DAYS=weekdays(TODAY,15); if(!SCHED_DAYS.some(d=>dkey(d)===dkey(sl.date))) SCHED_DAYS.push(sl.date);
  const di=SCHED_DAYS.findIndex(d=>dkey(d)===dkey(sl.date));
  document.getElementById("drawer-root").innerHTML='<div class="scrim" data-close="1"></div><aside class="drawer" data-jobid="'+j.id+'" role="dialog" aria-modal="true" aria-label="Schedule '+j.id+'">'+
  '<div class="dr-head"><div class="top"><div><span class="mono muted">'+j.id+' · due '+fmtDate(j.due)+'</span><h1 style="font-size:1.3rem">Schedule '+esc(j.kind.toLowerCase())+'</h1><p class="muted">'+esc(s.name)+' · '+esc(s.address)+'</p></div><button class="x" data-close="1" type="button" aria-label="Close">×</button></div><div class="acts-row">'+planChip(s.plan)+'<span class="chip plain">'+s.brand+' '+s.model+' · '+s.kw+' kW</span></div></div>'+
  '<div class="dr-body">'+
    '<div class="form-grid">'+
      '<label class="field" style="grid-column:1/-1"><span>Who does the work</span><select class="select" id="sf-who">'+whoOptions(who,false)+'</select></label>'+
      '<label class="field"><span>Day</span><select class="select" id="sf-date">'+dayOptions(who,di)+'</select></label>'+
      '<label class="field"><span>Time</span><select class="select" id="sf-time">'+SLOTS.map(t=>'<option'+(t===sl.time?' selected':'')+'>'+t+'</option>').join("")+'</select></label>'+
    '</div>'+
    '<div class="field"><span>Send it by</span><div class="checks"><label id="sf-cal-wrap"><input type="checkbox" id="sf-cal"> <span id="sf-cal-label">Calendar invite</span></label><label><input type="checkbox" id="sf-email"> <span id="sf-email-label">Email</span></label><label><input type="checkbox" id="sf-board"> Add to Fergus job board</label></div></div>'+
    '<div class="field"><span>Customer</span><div class="checks"><label><input type="checkbox" id="sf-cust"'+(S.rules.customer?' checked':'')+'> Email '+esc(s.contact)+' a booking confirmation</label></div></div>'+
    '<div class="field"><span id="sf-prev-label">Preview</span><pre class="mail" id="sf-preview"></pre></div>'+
    '<div class="acts-row"><button class="btn primary" data-schedsave="'+j.id+'" type="button">Book job</button><button class="btn" data-close="1" type="button">Cancel</button></div>'+
  '</div></aside>';
  schedDefaults(); schedPreview();
  document.getElementById("sf-who").focus();
}
function dayOptions(who,di){return SCHED_DAYS.map((d,i)=>'<option value="'+i+'"'+(i===di?' selected':'')+'>'+fmtDay(d)+(loadOn(who,d)?' ('+loadOn(who,d)+' booked)':'')+'</option>').join("")}
function schedRetime(){
  const who=document.getElementById("sf-who").value, jid=document.querySelector(".drawer[data-jobid]").dataset.jobid, j=D.jobs.find(x=>x.id===jid);
  const sl=findSlot(who,j); if(!SCHED_DAYS.some(d=>dkey(d)===dkey(sl.date))) SCHED_DAYS.push(sl.date);
  document.getElementById("sf-date").innerHTML=dayOptions(who,SCHED_DAYS.findIndex(d=>dkey(d)===dkey(sl.date)));
  document.getElementById("sf-time").value=sl.time;
}
function schedDefaults(){
  const p=person(document.getElementById("sf-who").value), r=S.rules;
  const team=p.kind==="team";
  document.getElementById("sf-cal-wrap").hidden=!team;
  document.getElementById("sf-cal-label").textContent=team?p.cal+" invite":"Calendar invite";
  document.getElementById("sf-email-label").textContent=team?"Email "+p.name.split(" ")[0]:"Work order email";
  document.getElementById("sf-cal").checked=team&&r.team.cal;
  document.getElementById("sf-email").checked=team?r.team.email:r.contractor.email;
  document.getElementById("sf-board").checked=team?r.team.board:r.contractor.board;
}
function schedForm(){
  const who=document.getElementById("sf-who").value, p=person(who);
  const via=[]; if(p.kind==="team"&&document.getElementById("sf-cal").checked) via.push("cal"); if(document.getElementById("sf-email").checked) via.push("email"); if(document.getElementById("sf-board").checked) via.push("board");
  return {who,p,date:SCHED_DAYS[+document.getElementById("sf-date").value],time:document.getElementById("sf-time").value,via,cust:document.getElementById("sf-cust").checked};
}
function schedPreview(){
  const jid=document.querySelector(".drawer[data-jobid]").dataset.jobid, j=D.jobs.find(x=>x.id===jid), s=byId(j.sys), f=schedForm();
  const openAlert=D.alerts.find(a=>a.sys===s.id&&a.state==="open");
  const first=f.p.kind==="team"?f.p.name.split(" ")[0]:"team";
  const lines=[
    "To: "+f.p.email,
    "Subject: "+(f.p.kind==="contractor"?"Work order "+j.id+": ":"")+j.kind+", "+s.name+", "+fmtDay(f.date)+" "+f.time,
    "",
    "Hi "+first+",",
    "",
    (f.p.kind==="contractor"?esc(CTX.org.name)+" would like to book you for ":"You're booked for ")+"a "+j.kind.toLowerCase()+" on "+fmtDay(f.date)+" at "+f.time+".",
    "",
    "Site: "+s.address,
    "Contact: "+s.contact+", "+s.phone,
    "System: "+s.kw+" kW, "+s.panels+" × "+s.panelModel+", "+s.brand+" "+s.model+(s.battery?", "+s.battery:""),
    "Last service: "+(s.lastService?fmtDate(s.lastService):"none on record"),
    openAlert?"Open alert: "+openAlert.title:"Open alerts: none",
    "",
    f.p.kind==="contractor"?"Reply YES to confirm or suggest another time. The service checklist and report form are at the link below.":"The checklist and report form are on the job in Fergus.",
    "",
    esc(CTX.org.name)+", via Orsym Fleet"
  ];
  document.getElementById("sf-preview").textContent=lines.join("\n");
  document.getElementById("sf-prev-label").textContent=f.via.includes("email")?"Email preview":"Job details";
}
function saveSched(jid){
  const j=D.jobs.find(x=>x.id===jid), f=schedForm();
  scheduleJob(j,f.who,f.date,f.time,f.via,f.cust,"You · just now");
  closeDrawer();
  const w=viaText(f.who,f.via);
  toast(j.id+" booked with "+pname(f.who)+" for "+fmtDay(f.date)+", "+f.time+(w?". Sent "+w:"")+" (prototype: no email sent yet)");
  render(true);
}

function vPlans(){
  const sys=D.systems, st=stats();
  const tiers=[["Monitor",149,"Remote monitoring only",["Alerts when output drops","Yearly performance summary","Priority fault callouts"]],["Care",349,"Remote monitoring plus annual visit",["Everything in Monitor","Annual clean and safety check","Written health report"]],["Commercial",null,"Custom, priced per site",["Everything in Care","Quarterly reports for the owner","Agreed response times"]]];
  const offerList=sys.filter(s=>s.plan==="None"&&s.status!=="Offline").sort((a,b)=>b.kw-a.kw);
  const tabs=[["all","All systems on plans"],["none","Offer a plan"],["renew","Renewing in 60 days"]];
  let body="";
  if(S.planTab==="none"){
    body='<table><thead><tr><th>Customer</th><th>Type</th><th class="r">Size</th><th>Installed</th><th>Suggested plan</th><th class="r"></th></tr></thead><tbody>'+offerList.slice(0,40).map(s=>{const sug=s.type==="Commercial"?"Commercial":s.ageDays>1100||s.kw>8?"Care":"Monitor";return '<tr class="click" data-sys="'+s.id+'"><td><strong>'+esc(s.name)+'</strong><span class="sub">'+s.town+'</span></td><td>'+s.type+'</td><td class="r num">'+s.kw+' kW</td><td class="num">'+fmtDate(s.installed)+'</td><td>'+planChip(sug)+'</td><td class="r">'+(s.offer?'<span class="chip s-info">Offer sent</span>':'<button class="btn sm primary" data-offer="'+s.id+'" type="button">Send offer</button>')+'</td></tr>'}).join("")+'</tbody></table>';
  } else {
    let list=sys.filter(s=>s.plan!=="None");
    if(S.planTab==="renew") list=list.filter(s=>{let r=new Date(s.planStart); while(r<TODAY) r=addMonths(r,12); s._renew=r; return daysBetween(TODAY,r)<=60}).sort((a,b)=>a._renew-b._renew);
    body='<table><thead><tr><th>Customer</th><th>Plan</th><th class="r">Fee / yr</th><th>Started</th><th>'+(S.planTab==="renew"?"Renews":"Next service")+'</th><th>Billing</th></tr></thead><tbody>'+list.slice(0,60).map(s=>'<tr class="click" data-sys="'+s.id+'"><td><strong>'+esc(s.name)+'</strong><span class="sub">'+s.town+'</span></td><td>'+planChip(s.plan)+'</td><td class="r num">'+money(s.planFee)+'</td><td class="num">'+fmtDate(s.planStart)+'</td><td class="num">'+(S.planTab==="renew"?fmtDate(s._renew):(s.nextService?fmtDate(s.nextService):'<span class="muted">Remote only</span>'))+'</td><td><span class="chip s-good">Xero direct debit</span></td></tr>').join("")+'</tbody></table>';
  }
  return head("Service plans","Recurring income from the systems you've already installed",'<span class="chip plain s-orange num" style="font-size:.85rem;padding:6px 12px">'+money(st.arr)+' a year · '+money(st.arr/12)+' a month</span>')+
  '<div class="grid g-3">'+tiers.map(([n,p,d,f])=>{const on=sys.filter(s=>s.plan===n);const v=on.reduce((t,s)=>t+s.planFee,0);return '<section class="card tier"><span class="chip plain s-orange" style="justify-self:start">'+n+'</span><div class="price num">'+(p?money(p)+'<small> + GST / year</small>':'from $1,200<small> / year</small>')+'</div><p class="muted">'+d+'</p><ul>'+f.map(x=>'<li>'+x+'</li>').join("")+'</ul><div class="stat"><span>'+on.length+' systems</span><b class="num" style="color:var(--ink)">'+money(v)+'/yr</b></div></section>'}).join("")+'</div>'+
  '<section class="card"><div class="toolbar"><div class="seg" role="tablist">'+tabs.map(([k,l])=>'<button type="button" role="tab" aria-selected="'+(S.planTab===k)+'" class="'+(S.planTab===k?'on':'')+'" data-ptab="'+k+'">'+l+'</button>').join("")+'</div>'+(S.planTab==="none"?'<span class="count">'+offerList.length+' systems, biggest first</span><button class="btn sm" data-offerall="1" type="button">Send to top 10</button>':'')+'</div><div class="tbl-wrap">'+body+'</div></section>';
}

function vStock(){
  const soon=D.systems.filter(s=>{const d=daysBetween(TODAY,s.invWarranty);return d>-1&&d<=365}).sort((a,b)=>a.invWarranty-b.invWarranty);
  return head("Stock and warranty","Swap units on the shelf, open claims with suppliers, and warranties about to end")+
  '<div class="grid g-2e">'+
  '<section class="card"><div class="card-h"><h2>Van and warehouse stock</h2></div><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Part</th><th class="r">On hand</th><th class="r">Min</th><th></th></tr></thead><tbody>'+D.stock.map(p=>'<tr><td>'+esc(p.part)+'</td><td class="r num">'+p.qty+'</td><td class="r num muted">'+p.min+'</td><td class="r">'+(p.qty<p.min?'<span class="chip s-warn">Reorder</span>':'<span class="chip s-good">OK</span>')+'</td></tr>').join("")+'</tbody></table></div></section>'+
  '<section class="card"><div class="card-h"><h2>Open warranty claims</h2></div><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Claim</th><th>Item</th><th>Lodged</th><th>Status</th></tr></thead><tbody>'+D.claims.map(c=>'<tr class="click" data-sys="'+c.sys+'"><td class="mono">'+c.id+'</td><td>'+esc(c.item)+'<span class="sub mono">'+c.serial+'</span></td><td class="num">'+fmtShort(c.lodged)+'</td><td><span class="chip '+(c.state==="Replacement shipped"?"s-good":"s-info")+'">'+c.state+'</span></td></tr>').join("")+'</tbody></table></div></section>'+
  '</div>'+
  '<section class="card"><div class="card-h"><h2>Inverter warranties ending in the next 12 months <span class="muted num" style="font-weight:500">'+soon.length+'</span></h2></div><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Customer</th><th>Inverter</th><th>Serial</th><th>Ends</th><th>Plan</th></tr></thead><tbody>'+(soon.length?soon.map(s=>'<tr class="click" data-sys="'+s.id+'"><td><strong>'+esc(s.name)+'</strong><span class="sub">'+s.town+'</span></td><td>'+s.brand+' '+s.model+'</td><td class="mono">'+s.serial+'</td><td class="num">'+fmtDate(s.invWarranty)+'<span class="sub">'+rel(s.invWarranty)+'</span></td><td>'+planChip(s.plan)+'</td></tr>').join(""):'<tr><td colspan="5" class="empty">No warranties end in the next year.</td></tr>')+'</tbody></table></div></section>';
}

function vConnections(){
  // Only these show, in this order. A provider with no row yet shows as Not connected.
  const pick=(names,kind)=>names.map(n=>D.conns.find(x=>x.name===n)||{name:n,kind,state:"Not connected"});
  const inv=pick(["GoodWe","Sungrow","Sigenergy"],"Inverter portal"), other=pick(["Claude"],"AI assistant");
  const count=n=>D.systems.filter(s=>s.brand===n&&s.source!=="sample").length;
  const card=x=>{const n=x.kind==="Inverter portal"?count(x.name):null; return '<div class="conn"><span class="mark">'+esc(x.name.replace(/[^A-Za-z]/g,"").slice(0,2))+'</span><span style="min-width:0"><b style="color:var(--ink)">'+esc(x.name)+'</b><span class="muted" style="display:block;font-size:.78rem">'+esc(x.kind)+(n!=null?' · '+n+' systems':'')+(x.syncedAt?' · last sync '+rel(x.syncedAt):'')+(x.error?' · '+esc(x.error):'')+'</span></span><span class="acts-row">'+
    (x.name==="Claude"&&x.state==="Connected"?'<button class="btn sm" data-nav="claude" type="button">Ask Claude</button><span class="chip s-good">Connected</span>'+(CTX.role!=="member"?'<button class="btn sm" data-cldisconnect="1" type="button">Disconnect</button>':''):
     x.name==="GoodWe"&&x.state!=="Not connected"?'<button class="btn sm" data-gwsync="1" type="button">Sync now</button>'+(x.state==="Reconnect needed"?'<button class="btn sm primary" data-connect="GoodWe" type="button">Reconnect</button>':'<span class="chip s-good">Connected</span>')+(CTX.role!=="member"?'<button class="btn sm" data-gwdisconnect="1" type="button">Disconnect</button>':''):
     x.state==="Connected"?'<span class="chip s-good">Connected</span>':x.state==="Reconnect needed"?'<button class="btn sm primary" data-connect="'+esc(x.name)+'" type="button">Reconnect</button>':(x.name==="Claude"||x.name==="GoodWe")?'<button class="btn sm primary" data-connect="'+esc(x.name)+'" type="button">Connect</button>':'<span class="chip plain muted">Coming soon</span>')+'</span></div>'};
  return head("Connections","Orsym Fleet reads from the tools you already use. GoodWe and Claude are live; Sungrow and Sigenergy are next.")+
  '<div class="grid g-2e"><section class="card"><div class="card-h"><h2>Inverter portals</h2></div><div style="margin-top:6px">'+inv.map(card).join("")+'</div></section><section class="card"><div class="card-h"><h2>Software</h2></div><div style="margin-top:6px">'+other.map(card).join("")+'</div></section></div>';
}

/* ---------- Ask Claude ---------- */

const CHAT=[]; let ASKING=false;
const ASK_IDEAS=["Which systems need attention this week?","Who is overdue for a service?","Which customers without a plan should I offer one to?","Draft a friendly service reminder for my next due customer"];
// Claude's reply as light HTML: bold, bullet lists, tables, and SYS refs that open the system.
function md(text){
  const inline=t=>esc(t).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/`([^`]+)`/g,"<code>$1</code>")
    .replace(/\bSYS-\d+\b/g,r=>byId(r)?'<button class="ref" data-sys="'+r+'" type="button">'+r+'</button>':r);
  const out=[]; const lines=text.split("\n");
  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    if(/^\s*\|/.test(l)){ const rows=[]; while(i<lines.length&&/^\s*\|/.test(lines[i])) rows.push(lines[i++]); i--;
      const cells=r=>r.trim().replace(/^\||\|$/g,"").split("|").map(c=>c.trim());
      const body=rows.filter(r=>!/^\s*\|[\s:|-]+\|\s*$/.test(r));
      out.push('<div class="tbl-wrap"><table>'+body.map((r,k)=>'<tr>'+cells(r).map(c=>k?'<td>'+inline(c)+'</td>':'<th>'+inline(c)+'</th>').join("")+'</tr>').join("")+'</table></div>'); continue }
    if(/^\s*([-*]|\d+\.)\s+/.test(l)){ const items=[]; const ol=/^\s*\d+\./.test(l); while(i<lines.length&&/^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/,"")); i--;
      out.push((ol?'<ol>':'<ul>')+items.map(t=>'<li>'+inline(t)+'</li>').join("")+(ol?'</ol>':'</ul>')); continue }
    if(/^#{1,4}\s/.test(l)){ out.push('<p><b>'+inline(l.replace(/^#+\s/,""))+'</b></p>'); continue }
    if(l.trim()) out.push('<p>'+inline(l)+'</p>');
  }
  return out.join("");
}
function claudeConn(){ return D.conns.find(c=>c.name==="Claude") }
function vClaude(){
  const c=claudeConn(), on=c&&c.state==="Connected";
  if(!on) return head("Ask Claude","Ask questions about your fleet in plain English, or get Claude to draft customer messages.")+
    '<section class="card" style="padding:22px;display:grid;gap:12px;max-width:620px"><h2>Connect Claude to get started</h2><p class="muted">'+(c&&c.state==="Reconnect needed"?"Claude's API key stopped working. Connect it again with a current key.":"Claude reads your systems, alerts, jobs and plans, and answers using only what you can see in Fleet.")+'</p>'+
    (CTX.role!=="member"?'<div><button class="btn primary" data-connect="Claude" type="button">Connect Claude</button></div>':'<p class="hint">Ask an owner or admin to connect Claude under Connections.</p>')+'</section>';
  const msgs=CHAT.map(m=>m.role==="user"?'<div class="msg me">'+esc(m.content).replace(/\n/g,"<br>")+'</div>':'<div class="msg ai'+(m.error?' err':'')+'">'+(m.error?esc(m.content):md(m.content))+'</div>').join("")+
    (ASKING?'<div class="msg ai thinking" aria-live="polite">Claude is looking through your fleet…</div>':'');
  return head("Ask Claude","Claude answers from your live fleet data. It can't send emails or change anything yet.",CHAT.length?'<button class="btn sm" data-clnew="1" type="button">New chat</button>':'')+
  '<section class="card chat"><div class="chat-log" id="chatlog">'+(msgs||'<div class="chat-empty"><p class="muted">Try asking</p><div class="ideas">'+ASK_IDEAS.map(q=>'<button class="btn sm" data-askidea="'+esc(q)+'" type="button">'+esc(q)+'</button>').join("")+'</div></div>')+'</div>'+
  '<form id="askForm" class="chat-in"><textarea class="input" id="ask-q" rows="2" placeholder="Ask about your fleet…" aria-label="Ask Claude"'+(ASKING?' disabled':'')+'></textarea><button class="btn primary" type="submit"'+(ASKING?' disabled':'')+'>Ask</button></form></section>';
}
async function ask(q){
  q=q.trim(); if(!q||ASKING) return;
  CHAT.push({role:"user",content:q}); ASKING=true; render(true); scrollChat();
  try{ const r=await db.askClaude(CTX.org.id,CHAT.filter(m=>!m.error).map(({role,content})=>({role,content}))); CHAT.push({role:"assistant",content:r.text||"(No answer)"}) }
  catch(err){ CHAT.push({role:"assistant",content:err.message||String(err),error:true}); if(/API key/.test(err.message||"")) await reload().catch(()=>{}) }
  ASKING=false; if(S.view==="claude"){ render(true); scrollChat(); const t=document.getElementById("ask-q"); if(t) t.focus() }
}
function scrollChat(){ const l=document.getElementById("chatlog"); if(l) l.scrollTop=l.scrollHeight; const m=document.getElementById("main"); m.scrollTop=m.scrollHeight }
function openClaude(){
  document.getElementById("drawer-root").innerHTML='<div class="scrim" data-close="1"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Connect Claude"><div class="dr-head"><div class="top"><div><h1 style="font-size:1.3rem">Connect Claude</h1><p class="muted">Paste an API key from your Anthropic account. Your whole team can then use Ask Claude, and usage is billed to that account.</p></div><button class="x" data-close="1" type="button" aria-label="Close">×</button></div></div>'+
  '<form class="dr-body" id="clForm" style="display:grid;gap:10px"><label class="fld"><span>Anthropic API key</span><input class="input" id="cl-key" type="password" required autocomplete="off" placeholder="sk-ant-…"></label>'+
  '<p class="hint">Create one at console.anthropic.com under API keys. The key is encrypted and only Fleet\'s server can read it.</p>'+
  '<div class="acts-row"><button class="btn primary" type="submit">Connect</button><button class="btn" data-close="1" type="button">Cancel</button></div><p class="err" id="cl-err"></p></form></aside>';
  document.getElementById("cl-key").focus();
}

/* ---------- welcome (empty account) ---------- */
function vWelcome(){
  return head(greeting()+", "+esc(CTX.org.name),"Your fleet is empty. Pick how you'd like to start.")+
  '<div class="grid g-3">'+
   '<section class="card tier"><h2>Try it with sample data</h2><p class="muted">Loads about 450 made-up Waikato systems, alerts and jobs so you can click around. You can clear them later from the Team screen.</p><button class="btn primary" data-sample="1" type="button">Load sample data</button></section>'+
   '<section class="card tier"><h2>Import your systems</h2><p class="muted">Upload a CSV exported from your job system or a spreadsheet. One row per system.</p><button class="btn" data-import="1" type="button">Import CSV</button></section>'+
   '<section class="card tier"><h2>Add one by hand</h2><p class="muted">Enter a single system with its inverter, size, install date and plan.</p><button class="btn" data-addsys="1" type="button">+ Add system</button></section>'+
  '</div>';
}

/* ---------- team ---------- */
function vTeam(){
  const T=CTX.team||{members:[],invites:[]}, admin=CTX.role!=="member";
  const mrow=m=>'<tr><td><strong>'+esc(m.email||"Member")+'</strong>'+(m.user_id===CTX.user.id?'<span class="sub">You</span>':'')+'</td><td>'+esc(m.role[0].toUpperCase()+m.role.slice(1))+'</td><td class="r">'+(admin&&m.role!=="owner"&&m.user_id!==CTX.user.id?'<button class="btn sm" data-rmmember="'+m.user_id+'" type="button">Remove</button>':'')+'</td></tr>';
  const irow=i=>'<tr><td><strong>'+esc(i.email)+'</strong><span class="sub">Invited '+fmtShort(new Date(i.created_at))+'</span></td><td>'+esc(i.role[0].toUpperCase()+i.role.slice(1))+'</td><td class="r">'+(admin?'<button class="btn sm" data-rminvite="'+i.id+'" type="button">Cancel</button>':'')+'</td></tr>';
  const prow=p=>'<tr><td><strong>'+esc(p.name)+'</strong><span class="sub">'+esc(p.role||"")+'</span></td><td>'+(p.kind==="team"?"Team":"Contractor")+'</td><td class="muted" style="overflow-wrap:anywhere">'+esc(p.email)+'</td><td class="r">'+(p.id!=="me"?'<button class="btn sm" data-rmperson="'+esc(p.id)+'" type="button">Remove</button>':'')+'</td></tr>';
  const hasSample=D.systems.some(s=>s.source==="sample");
  return head("Team","Who can sign in to "+esc(CTX.org.name)+", and who jobs can be booked with")+
  '<div class="grid g-2e">'+
   '<section class="card"><div class="card-h"><h2>People with access</h2></div><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Email</th><th>Role</th><th class="r"></th></tr></thead><tbody>'+T.members.map(mrow).join("")+T.invites.map(irow).join("")+'</tbody></table></div>'+
   (admin?'<form class="card-b" id="inviteForm" style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="inv-email" type="email" required placeholder="name@business.co.nz" aria-label="Email to invite" style="flex:1 1 220px"><select class="select" id="inv-role" aria-label="Role"><option value="member">Member</option><option value="admin">Admin</option></select><button class="btn primary" type="submit">Send invite</button></form>':'')+'</section>'+
   '<section class="card"><div class="card-h"><h2>Techs and contractors</h2></div><p class="hint" style="padding:4px 16px 0">Service jobs get booked with these people. They don\'t need a login.</p><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Name</th><th>Type</th><th>Email</th><th class="r"></th></tr></thead><tbody>'+TEAM.map(prow).join("")+'</tbody></table></div>'+
   '<form class="card-b" id="personForm" style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="p-name" required placeholder="Name" aria-label="Name" style="flex:1 1 140px"><input class="input" id="p-email" type="email" placeholder="Email" aria-label="Email" style="flex:1 1 160px"><select class="select" id="p-kind" aria-label="Type"><option value="team">Team</option><option value="contractor">Contractor</option></select><button class="btn" type="submit">Add</button></form></section>'+
  '</div>'+
  (hasSample&&admin?'<section class="card"><div class="card-h"><h2>Sample data</h2><button class="btn sm" data-clearsample="1" type="button">Clear sample data</button></div><p class="hint" style="padding:4px 16px 14px">Removes the made-up systems, alerts, jobs and contractors. Anything you added yourself stays.</p></section>':'');
}

/* ---------- add system + CSV import ---------- */
const PLAN_FEES={None:0,Monitor:149,Care:349,Commercial:1200};
function nextRef(){ return "SYS-"+(Math.max(1000,...D.systems.map(s=>+s.id.slice(4)||0))+1) }
function newSystem(f){
  const kw=+f.kw||0, installed=f.installed?new Date(f.installed+"T00:00:00"):TODAY, plan=PLAN_FEES[f.plan]!=null?f.plan:"None";
  const yrs=f.brand==="Enphase"?25:(f.brand==="Fronius"||f.brand==="SolarEdge"?12:10);
  return {id:f.ref||nextRef(),name:f.name,contact:f.contact||f.name,type:["Residential","Commercial","Farm"].includes(f.type)?f.type:"Residential",brand:f.brand||"Unknown",model:f.model||"",kw,panels:+f.panels||0,panelModel:f.panel_model||"",battery:f.battery||null,
    town:f.town||"",address:f.address||"",phone:f.phone||"",email:f.email||"",serial:f.serial||"",installed,ageDays:Math.max(0,daysBetween(installed,TODAY)),status:"Online",plan,planFee:+f.plan_fee||PLAN_FEES[plan],
    planStart:plan!=="None"?TODAY:null,lastService:null,nextService:plan==="Care"||plan==="Commercial"?addMonths(TODAY,12):null,invWarranty:addMonths(installed,yrs*12),exp:kw*3.9,perf:1,offlineDays:0,fault:null,offer:null,connected:true,source:f.source||"manual"};
}
function openAddSys(){
  const fld=(id,l,t,extra)=>'<label class="fld"><span>'+l+'</span><input class="input" id="as-'+id+'" type="'+(t||"text")+'"'+(extra||"")+'></label>';
  const sel=(id,l,opts)=>'<label class="fld"><span>'+l+'</span><select class="select" id="as-'+id+'">'+opts.map(o=>'<option>'+o+'</option>').join("")+'</select></label>';
  document.getElementById("drawer-root").innerHTML='<div class="scrim" data-close="1"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Add system"><div class="dr-head"><div class="top"><div><h1 style="font-size:1.3rem">Add a system</h1><p class="muted">Status shows Online until an inverter portal is connected.</p></div><button class="x" data-close="1" type="button" aria-label="Close">×</button></div></div>'+
  '<form class="dr-body" id="addSysForm" style="display:grid;gap:10px">'+fld("name","Customer or site name","text"," required")+fld("address","Address")+fld("town","Town")+fld("phone","Phone","tel")+fld("email","Email","email")+
  sel("type","Type",["Residential","Commercial","Farm"])+fld("brand","Inverter brand","text",' list="brandlist" required')+'<datalist id="brandlist">'+["Fronius","SolarEdge","Huawei","Enphase","GoodWe","Sungrow","SMA","Fox ESS","Solis","Deye"].map(b=>'<option value="'+b+'">').join("")+'</datalist>'+
  fld("model","Inverter model")+fld("serial","Inverter serial")+fld("kw","System size (kW)","number",' step="0.1" min="0" required')+fld("installed","Install date","date")+sel("plan","Service plan",["None","Monitor","Care","Commercial"])+
  '<div class="acts-row"><button class="btn primary" type="submit">Save system</button><button class="btn" data-close="1" type="button">Cancel</button></div></form></aside>';
  document.getElementById("as-name").focus();
}
function openGoodWe(){
  document.getElementById("drawer-root").innerHTML='<div class="scrim" data-close="1"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Connect GoodWe"><div class="dr-head"><div class="top"><div><h1 style="font-size:1.3rem">Connect GoodWe</h1><p class="muted">Sign in with the SEMS account you use to see your customers\' GoodWe systems. Every plant on it comes into Fleet and refreshes every 15 minutes.</p></div><button class="x" data-close="1" type="button" aria-label="Close">×</button></div></div>'+
  '<form class="dr-body" id="gwForm" style="display:grid;gap:10px"><label class="fld"><span>SEMS email</span><input class="input" id="gw-account" type="email" required autocomplete="off"></label><label class="fld"><span>SEMS password</span><input class="input" id="gw-password" type="password" required autocomplete="new-password"></label>'+
  '<p class="hint">Best practice: in SEMS, create a read-only visitor account for Fleet rather than using your main login. The password is encrypted and only Fleet\'s server can read it.</p>'+
  '<div class="acts-row"><button class="btn primary" type="submit">Connect</button><button class="btn" data-close="1" type="button">Cancel</button></div><p class="err" id="gw-err"></p></form></aside>';
  document.getElementById("gw-account").focus();
}
function parseCSV(text){
  const rows=[]; let row=[], f="", q=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i++} else q=false } else f+=c }
    else if(c==='"') q=true; else if(c===','){row.push(f);f=""} else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i+1]==='\n') i++; row.push(f); rows.push(row); row=[]; f="" } else f+=c }
  if(f||row.length){row.push(f);rows.push(row)}
  return rows.filter(r=>r.some(x=>x.trim()));
}
const CSV_ALIASES={name:["name","customer","customer name","site","site name"],address:["address","site address","street"],town:["town","city","suburb"],phone:["phone","mobile"],email:["email","e-mail"],type:["type","system type"],brand:["brand","inverter brand","inverter"],model:["model","inverter model"],serial:["serial","inverter serial","serial number"],kw:["kw","size","system size","size (kw)","kwp"],installed:["installed","install date","installed on","date installed"],plan:["plan","service plan"],panels:["panels","panel count"],panel_model:["panel model","panels model"],battery:["battery"]};
async function importCSV(file){
  const rows=parseCSV(await file.text()); if(rows.length<2){ toast("That file has no rows to import"); return }
  const hdr=rows[0].map(h=>h.trim().toLowerCase()), col={};
  for(const [k,al] of Object.entries(CSV_ALIASES)){ const i=hdr.findIndex(h=>al.includes(h)); if(i>=0) col[k]=i }
  if(col.name==null){ toast("Couldn't find a name or customer column in that file"); return }
  const list=[]; let ref=Math.max(1000,...D.systems.map(s=>+s.id.slice(4)||0));
  for(const r of rows.slice(1)){ const f={source:"csv"}; for(const [k,i] of Object.entries(col)) f[k]=(r[i]||"").trim(); if(!f.name) continue;
    if(f.installed&&!/^\d{4}-\d{2}-\d{2}$/.test(f.installed)){ const m=f.installed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/); f.installed=m?(m[3].length===2?"20"+m[3]:m[3])+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0"):"" }
    f.ref="SYS-"+(++ref); list.push(newSystem(f)) }
  toast("Importing "+list.length+" systems…");
  await db.saveSystems(CTX.org.id,list); D.systems.push(...list); snapshot();
  toast(list.length+" systems imported"); go("systems");
}

/* ---------- saving ---------- */
// Every action edits the in-memory objects; flush() diffs them against the
// last saved copy and writes whatever changed.
const SNAP=new Map();
const keyOf=(t,o)=>t+":"+o.id;
const ser=o=>JSON.stringify(o,(k,v)=>k==="uuid"?undefined:v);
function snapshot(){ SNAP.clear(); for(const [t,l] of [["s",D.systems],["a",D.alerts],["j",D.jobs]]) for(const o of l) SNAP.set(keyOf(t,o),ser(o)); SNAP.set("rules",JSON.stringify(S.rules)) }
let saving=Promise.resolve();
function flush(){
  const ch={s:[],a:[],j:[]};
  for(const [t,l] of [["s",D.systems],["a",D.alerts],["j",D.jobs]]) for(const o of l){ const k=keyOf(t,o), v=ser(o); if(SNAP.get(k)!==v){ ch[t].push(o); SNAP.set(k,v) } }
  const rules=JSON.stringify(S.rules), rulesChanged=SNAP.get("rules")!==rules; SNAP.set("rules",rules);
  if(!ch.s.length&&!ch.a.length&&!ch.j.length&&!rulesChanged) return;
  const o=CTX.org.id, uuidOf=ref=>byId(ref).uuid;
  saving=saving.then(async()=>{
    if(ch.s.length) await db.saveSystems(o,ch.s);
    if(ch.a.length) await db.saveAlerts(o,ch.a,uuidOf);
    if(ch.j.length) await db.saveJobs(o,ch.j,uuidOf);
    if(rulesChanged){ CTX.org.settings={...CTX.org.settings,rules:S.rules}; await db.saveSettings(CTX.org) }
  }).catch(err=>{ console.error(err); toast("Couldn't save that change. Refresh to see what was saved. ("+(err.message||err)+")") });
}

/* ---------- drawer ---------- */
function openSys(id){
  const s=byId(id); if(!s) return;
  const al=D.alerts.filter(a=>a.sys===id), js=D.jobs.filter(j=>j.sys===id);
  const hist=[[s.installed,"Installed"+(s.panels?" ("+s.panels+" × "+s.panelModel+")":"")]];
  if(s.planStart) hist.push([s.planStart,"Joined "+s.plan+" plan"]);
  if(s.lastService) hist.push([s.lastService,"Annual clean and check completed"]);
  js.forEach(j=>hist.push([j.slot||j.due,j.kind+(j.state==="done"?" (done by "+pname(j.who)+")":j.state==="unscheduled"?" (due, not booked yet)":" (booked with "+pname(j.who)+", "+j.time+")")]));
  al.forEach(a=>hist.push([a.at,"Alert: "+a.title]));
  hist.sort((a,b)=>b[0]-a[0]);
  const ytd=Math.round(s.exp*s.perf*(s.status==="Offline"?.96/Math.max(s.perf,.01):1)*278);
  document.getElementById("drawer-root").innerHTML='<div class="scrim" data-close="1"></div><aside class="drawer" data-sysid="'+s.id+'" role="dialog" aria-modal="true" aria-label="'+esc(s.name)+'">'+
  '<div class="dr-head"><div class="top"><div><span class="mono muted">'+s.id+' · '+s.type+'</span><h1 style="font-size:1.3rem">'+esc(s.name)+'</h1><p class="muted">'+esc(s.address)+'</p></div><button class="x" data-close="1" type="button" aria-label="Close">×</button></div><div class="acts-row">'+statusChip(s.status)+planChip(s.plan)+(s.connected?'':'<span class="chip s-warn">Portal reconnect needed</span>')+'</div></div>'+
  '<div class="dr-body">'+
   (s.status!=="Online"&&al.length?'<div class="card" style="border-color:var(--bad);background:var(--bad-bg)"><div class="card-b" style="display:grid;gap:8px"><b style="color:var(--ink)">'+esc(al[0].title)+'</b><span class="muted" style="font-size:.82rem">'+esc(al[0].detail)+' · '+rel(al[0].at)+'</span>'+(al[0].state==="open"?'<div class="acts-row"><button class="btn sm primary" data-job="'+al[0].id+'" type="button">Create fault job</button><button class="btn sm" data-ack="'+al[0].id+'" type="button">Acknowledge</button></div>':'')+'</div></div>':'')+
   '<section class="card"><div class="card-h"><h2>Output, last 14 days</h2><span class="muted num" style="font-size:.78rem">kWh / day</span></div><div class="card-b chart">'+sysChart(s)+'<div class="legend" style="margin-top:6px"><span><i style="background:var(--orange)"></i>Actual</span><span><i style="background:var(--expected)"></i>Expected</span><span class="num">About '+ytd.toLocaleString("en-NZ")+' kWh this year</span></div></div></section>'+
   '<section class="card"><div class="card-b kv">'+
     '<div><span>Contact</span><b>'+esc(s.contact)+'</b><div class="muted">'+s.phone+'</div><div class="muted" style="overflow-wrap:anywhere">'+s.email+'</div></div>'+
     '<div><span>System</span><b class="num">'+s.kw+' kW</b><div class="muted">'+s.panels+' × '+s.panelModel+'</div></div>'+
     '<div><span>Inverter</span><b>'+s.brand+' '+s.model+'</b><div class="mono muted">'+s.serial+'</div></div>'+
     '<div><span>Battery</span><b>'+(s.battery||"None")+'</b></div>'+
     '<div><span>Installed</span><b class="num">'+fmtDate(s.installed)+'</b><div class="muted">'+(s.ageDays/365).toFixed(1)+' years ago</div></div>'+
     '<div><span>Inverter warranty</span><b class="num">'+fmtDate(s.invWarranty)+'</b><div class="muted">'+rel(s.invWarranty)+'</div></div>'+
     '<div><span>Plan</span><b>'+(s.plan==="None"?"No plan":s.plan+" · "+money(s.planFee)+"/yr")+'</b>'+(s.offer?'<div class="muted">Offer sent '+fmtShort(s.offer)+'</div>':'')+'</div>'+
     '<div><span>Next service</span><b class="num">'+(s.nextService?fmtDate(s.nextService):"Not scheduled")+'</b>'+(s.nextService?'<div class="muted">'+rel(s.nextService)+'</div>':'')+'</div>'+
   '</div></section>'+
   '<div class="acts-row"><button class="btn primary" data-book="'+s.id+'" type="button">Book a service</button>'+(s.plan==="None"?(s.offer?'<button class="btn" disabled type="button">Plan offer sent</button>':'<button class="btn" data-offer="'+s.id+'" type="button">Send plan offer</button>'):'')+'<button class="btn" data-toast="Customer health reports are coming in a later version" type="button">Send health report</button></div>'+
   '<section class="card"><div class="card-h"><h2>History</h2></div><div class="card-b timeline">'+hist.map(([d,t])=>'<div><span class="num muted">'+fmtShort(d)+' '+d.getFullYear()+'</span><span>'+esc(t)+'</span></div>').join("")+'</div></section>'+
  '</div></aside>';
  const x=document.querySelector(".drawer .x"); if(x) x.focus();
}
function closeDrawer(){document.getElementById("drawer-root").innerHTML=""}

/* ---------- render + events ---------- */
const RENDER={overview:vOverview,claude:vClaude,systems:vSystems,alerts:vAlerts,jobs:vJobs,plans:vPlans,stock:vStock,connections:vConnections,team:vTeam};
function render(keepScroll){
  renderNav();
  const m=document.getElementById("main"), y=m.scrollTop;
  document.getElementById("page").innerHTML=(!D.systems.length&&!["team","connections","claude"].includes(S.view))?vWelcome():RENDER[S.view]();
  m.scrollTop = keepScroll? y : 0;
  const open=document.querySelector(".drawer[data-sysid]"); if(open) openSys(open.dataset.sysid);
}
let tt;
function toast(msg){const r=document.getElementById("toast-root"); r.innerHTML='<div class="toast" role="status">'+esc(msg)+'</div>'; clearTimeout(tt); tt=setTimeout(()=>r.innerHTML="",3200)}
function go(v){ S.view=v; try{history.replaceState(null,"","#"+v)}catch(e){} closeDrawer(); render() }
function greeting(){ const h=new Date().getHours(); return h<12?"Good morning":h<17?"Good afternoon":"Good evening" }
function brands(){ const m=new Map(); D.systems.forEach(s=>m.set(s.brand,(m.get(s.brand)||0)+1)); return [...m].sort((a,b)=>b[1]-a[1]).map(x=>x[0]) }
async function busy(btn,label,fn){ const t=btn&&btn.textContent; if(btn){btn.disabled=true;btn.textContent=label} try{ await fn() } catch(err){ console.error(err); toast(err.message||String(err)) } finally{ if(btn&&btn.isConnected){btn.disabled=false;btn.textContent=t} } }
async function refreshTeam(){ CTX.team=await db.team(CTX.org.id); if(S.view==="team") render(true) }

function onClick(e){
  const t=e.target.closest("button,[data-sys],[data-close]"); if(!t) return;
  const d=t.dataset;
  if(d.close){closeDrawer();return}
  if(d.nav){ if(d.plantab) S.planTab=d.plantab; if(d.filter){S.fStatus="";} go(d.nav); return }
  if(d.sort){ if(S.sort===d.sort) S.dir*=-1; else {S.sort=d.sort;S.dir=1} render(true); return }
  if(d.pg){ S.page+=+d.pg; render(); return }
  if(d.atab){ S.alertTab=d.atab; render(true); return }
  if(d.ptab){ S.planTab=d.ptab; render(true); return }
  if(d.ack){ const a=D.alerts.find(x=>x.id==d.ack); a.state="ack"; toast("Alert acknowledged"); render(true); return }
  if(d.ackall){ D.alerts.forEach(a=>{if(a.state==="open"&&a.sev==="info")a.state="ack"}); toast("Info alerts acknowledged"); render(true); return }
  if(d.job){ const a=D.alerts.find(x=>x.id==d.job); a.state="job"; const s=byId(a.sys); const j=newJob(s,"Fault callout: "+a.title.toLowerCase(),"fault",addDays(TODAY,1));
    const sl=S.rules.mode==="auto"&&findSlot(pickWho(j),j);
    if(sl){ const who=pickWho(j); scheduleJob(j,who,sl.date,sl.time,viaFor(who),S.rules.customer,"Auto-run · just now"); toast(j.id+" booked with "+pname(who)+" for "+fmtDay(sl.date)+" "+sl.time+" (prototype: no email sent yet)") }
    else toast(j.id+" created. It's waiting in Ready to book");
    render(true); return }
  if(d.jtab){ S.jobTab=d.jtab; render(true); return }
  if(d.mode){ S.rules.mode=d.mode; render(true); toast(d.mode==="auto"?"Auto-scheduling on":"Manual scheduling. Jobs wait in Ready to book for you"); return }
  if(d.autorun){ const r=autoRun("Auto-run · just now"); toast(r.n?r.n+" jobs booked"+(r.ext.length?" with "+r.ext.join(" and "):"")+" (prototype: no email sent yet)":"Nothing to book"); render(true); return }
  if(d.sched){ openSched(d.sched); return }
  if(d.schedsave){ saveSched(d.schedsave); return }
  if(d.confirm){ const j=D.jobs.find(x=>x.id===d.confirm); j.state="scheduled"; j.confirmed=true; toast(pname(j.who)+" confirmed "+j.id); render(true); return }
  if(d.done){ const j=D.jobs.find(x=>x.id===d.done); j.state="done"; const s=byId(j.sys); if(s.nextService&&/Annual|Commercial service/.test(j.kind)){ s.lastService=TODAY; s.nextService=addMonths(TODAY,12); D.alerts.forEach(a=>{if(a.sys===s.id&&/overdue/.test(a.title))a.state="ack"}) } toast(j.id+" marked done"); render(true); return }
  if(d.offer){ const s=byId(d.offer); s.offer=TODAY; toast("Marked plan offer as sent to "+s.contact+" (prototype: no email sent yet)"); render(true); return }
  if(d.offerall){ const l=D.systems.filter(s=>s.plan==="None"&&s.status!=="Offline"&&!s.offer).sort((a,b)=>b.kw-a.kw).slice(0,10); l.forEach(s=>s.offer=TODAY); toast(l.length+" plan offers marked as sent (prototype: no email sent yet)"); render(true); return }
  if(d.book){ const s=byId(d.book); const j=newJob(s,s.type==="Commercial"?"Commercial service + report":"Annual clean and check",s.type==="Commercial"?"commercial":"annual",addDays(TODAY,14)); render(true); openSched(j.id); return }
  if(d.connect==="GoodWe"){ openGoodWe(); return }
  if(d.connect==="Claude"){ openClaude(); return }
  if(d.askidea){ ask(d.askidea); return }
  if(d.clnew){ CHAT.length=0; render(); return }
  if(d.cldisconnect){ if(!confirm("Disconnect Claude? Ask Claude stops working until it's connected again.")) return; busy(t,"…",async()=>{ await db.disconnectClaude(CTX.org.id); await reload(); render(true); toast("Claude disconnected") }); return }
  if(d.gwsync){ busy(t,"Syncing…",async()=>{ const r=await db.syncGoodWe(CTX.org.id); if(r&&r.error) throw new Error(r.error); await reload(); render(true); toast("GoodWe synced: "+(r.stations??0)+" systems"+(r.created?", "+r.created+" new":"")) }); return }
  if(d.gwdisconnect){ if(!confirm("Disconnect GoodWe? Systems already pulled in stay in Fleet but stop updating.")) return; busy(t,"…",async()=>{ await db.disconnectGoodWe(CTX.org.id); await reload(); render(true); toast("GoodWe disconnected") }); return }
  if(d.connect){ toast(d.connect+" is coming soon"); return }
  if(d.sample){ busy(t,"Loading sample data…",async()=>{ await loadSample(); toast(D.systems.length+" sample systems loaded"); render() }); return }
  if(d.clearsample){ if(!confirm("Remove all sample systems, alerts, jobs and contractors?")) return; busy(t,"Clearing…",async()=>{ await db.clearSample(CTX.org.id); await reload(); toast("Sample data cleared"); render() }); return }
  if(d.import){ const inp=document.createElement("input"); inp.type="file"; inp.accept=".csv,text/csv"; inp.onchange=()=>{ if(inp.files[0]) importCSV(inp.files[0]).catch(err=>toast(err.message||String(err))) }; inp.click(); return }
  if(d.addsys){ openAddSys(); return }
  if(d.rminvite){ busy(t,"…",async()=>{ await db.cancelInvite(d.rminvite); await refreshTeam() }); return }
  if(d.rmmember){ if(!confirm("Remove this person's access?")) return; busy(t,"…",async()=>{ await db.removeMember(CTX.org.id,d.rmmember); await refreshTeam() }); return }
  if(d.rmperson){ busy(t,"…",async()=>{ await db.deletePerson(CTX.org.id,d.rmperson); TEAM=TEAM.filter(p=>p.id!==d.rmperson); render(true) }); return }
  if(d.toast){ toast(d.toast); return }
  if(d.sys){ openSys(d.sys); return }
}
function onSubmit(e){
  const f=e.target; e.preventDefault();
  const v=id=>(document.getElementById(id)||{}).value||"";
  const btn=f.querySelector("button[type=submit]");
  if(f.id==="addSysForm"){ busy(btn,"Saving…",async()=>{
    const s=newSystem({name:v("as-name"),address:v("as-address"),town:v("as-town"),phone:v("as-phone"),email:v("as-email"),type:v("as-type"),brand:v("as-brand"),model:v("as-model"),serial:v("as-serial"),kw:v("as-kw"),installed:v("as-installed"),plan:v("as-plan")});
    await db.saveSystems(CTX.org.id,[s]); D.systems.push(s); snapshot(); closeDrawer(); toast(s.name+" added"); S.view==="overview"?go("systems"):render(true) }); return }
  if(f.id==="gwForm"){ btn.disabled=true; btn.textContent="Connecting…"; document.getElementById("gw-err").textContent="";
    db.connectGoodWe(CTX.org.id,v("gw-account"),v("gw-password")).then(async r=>{ closeDrawer(); await reload(); go("systems"); toast("GoodWe connected: "+r.stations+" systems found") })
      .catch(err=>{ document.getElementById("gw-err").textContent=err.message||String(err); btn.disabled=false; btn.textContent="Connect" }); return }
  if(f.id==="askForm"){ ask(v("ask-q")); return }
  if(f.id==="clForm"){ btn.disabled=true; btn.textContent="Checking key…"; document.getElementById("cl-err").textContent="";
    db.connectClaude(CTX.org.id,v("cl-key")).then(async()=>{ closeDrawer(); await reload(); go("claude"); toast("Claude connected") })
      .catch(err=>{ document.getElementById("cl-err").textContent=err.message||String(err); btn.disabled=false; btn.textContent="Connect" }); return }
  if(f.id==="inviteForm"){ busy(btn,"Sending…",async()=>{ const email=v("inv-email"); const r=await db.invite(CTX.org.id,email,v("inv-role")); toast(r.emailed?"Invite emailed to "+email:"Invite saved. "+email+" gets access when they sign in with that email"); await refreshTeam() }); return }
  if(f.id==="personForm"){ busy(btn,"Adding…",async()=>{ const name=v("p-name").trim(), kind=v("p-kind"); let key=name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"person"; while(TEAM.some(p=>p.id===key)) key+="-2";
    const p={id:key,name,kind,role:kind==="team"?"Technician":"Contractor",cal:"Google Calendar",email:v("p-email").trim()}; await db.savePeople(CTX.org.id,[p]); TEAM.push(p); render(true); toast(name+" added") }); return }
}

async function reload(){
  const x=await db.load(CTX.org);
  TEAM=x.people.length?x.people:[{id:"me",name:"Me",kind:"team",role:"Owner",cal:"Google Calendar",email:CTX.user.email}];
  D={systems:x.systems,alerts:x.alerts,jobs:x.jobs,stock:x.stock,claims:x.claims,conns:x.conns,log:[],
     weather:(CTX.org.settings&&CTX.org.settings.weather)||Array(30).fill(.8)};
  D.alerts.sort((a,b)=>sevRank(a.sev)-sevRank(b.sev)||b.at-a.at); D.jobs.sort((a,b)=>a.due-b.due);
  S.rules=Object.assign({mode:"manual",lead:30,residential:"anyteam",commercial:"anyteam",fault:"anyteam",team:{cal:true,email:true,board:false},contractor:{email:true,board:false},customer:true},(CTX.org.settings||{}).rules||{});
  for(const k of ["residential","commercial","fault"]) if(S.rules[k]!=="anyteam"&&!person(S.rules[k])) S.rules[k]="anyteam";
  snapshot();
}

// Entry point, called once signed in with an org picked.
export async function startApp(ctx){
  CTX=ctx; TODAY=startOfDay(new Date());
  document.getElementById("orgname").textContent=ctx.org.name;
  document.getElementById("whoami").textContent=ctx.user.email;
  await reload();
  CTX.team=await db.team(ctx.org.id).catch(()=>({members:[],invites:[]}));
  document.addEventListener("click",e=>{ onClick(e); setTimeout(flush) });
  document.addEventListener("submit",onSubmit);
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape") closeDrawer();
    if(e.key==="Enter"&&!e.shiftKey&&e.target.id==="ask-q"){ e.preventDefault(); ask(e.target.value); return }
    if(e.key==="Enter"&&e.target.matches("tr[data-sys]")) openSys(e.target.dataset.sys);
  });
  document.addEventListener("input",e=>{ if(e.target.id==="q"){ S.q=e.target.value; S.page=0; const pos=e.target.selectionStart; render(true); const q=document.getElementById("q"); q.focus(); q.setSelectionRange(pos,pos) } });
  document.addEventListener("change",e=>{
    const id=e.target.id;
    if(["fBrand","fStatus","fPlan","fType"].includes(id)){ S[id]=e.target.value; S.page=0; render(true); return }
    if(id.startsWith("r-")){ ruleChange(e.target); render(true); flush(); const el=document.getElementById(id); if(el) el.focus(); return }
    if(id.startsWith("sf-")){ if(id==="sf-who"){ schedDefaults(); schedRetime() } schedPreview(); }
  });
  const [h,qs]=(location.hash||"").slice(1).split("?"); if(RENDER[h]) S.view=h;
  render();
  const err=new URLSearchParams(qs||"").get("error"); if(err){ toast("Couldn't connect: "+err); history.replaceState(null,"","#"+S.view) }
}
