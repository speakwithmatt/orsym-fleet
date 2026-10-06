// Sample fleet generator: a made-up Waikato installer with ~450 systems.
// Used by "Load sample data" so a new account has something to click around.
import { addDays, addMonths, daysBetween, sevRank, fmtDate } from "./util.js";
/* ---------- seeded demo data ---------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let R;
const pick = a => a[Math.floor(R()*a.length)];
const wpick = (items) => { let s=0; for(const [,w] of items) s+=w; let r=R()*s; for(const [v,w] of items){ if((r-=w)<=0) return v } return items[0][0] };
const rint = (a,b) => a+Math.floor(R()*(b-a+1));

export const BRANDS = [["Fronius",22],["SolarEdge",16],["Huawei",15],["Enphase",12],["GoodWe",12],["Sungrow",10],["SMA",7],["Fox ESS",6]];
const MODELS = {Fronius:["Primo 5.0","Primo 8.2","Symo 10.0","Symo 20.0","Tauro 50"],SolarEdge:["SE5000H","SE8250H","SE10K","SE25K"],Huawei:["SUN2000-5KTL","SUN2000-8KTL","SUN2000-20KTL","SUN2000-50KTL"],Enphase:["IQ8+ micro","IQ8M micro","IQ7+ micro"],GoodWe:["GW5000-DNS","GW8K-DT","GW15K-ET","GW50K-MT"],Sungrow:["SG5.0RS","SG8.0RS","SG15RT","SG50CX"],SMA:["Sunny Boy 5.0","Sunny Tripower 10","Sunny Tripower 25"],"Fox ESS":["F5000","H3-10.0","T20"]};
const PANELS = ["Jinko Tiger Neo 440W","Trina Vertex S+ 445W","LONGi Hi-MO 6 435W","Canadian Solar 440W","REC Alpha 410W","Q Cells 415W"];
const BATTS = ["BYD HVS 7.7","Tesla Powerwall 3","Huawei LUNA 10","Sungrow SBR 9.6","Fox ECS 10.4"];
const FIRST = ["Aroha","Ben","Chloe","Daniel","Emma","Finn","Grace","Hemi","Isla","Jack","Kiri","Liam","Mia","Noah","Olivia","Paora","Ruby","Sam","Tama","Zoe","Hannah","Josh","Mere","Tom","Anika","Rawiri","Sophie","Wiremu","Ella","Lucas","Ngaio","Ollie","Priya","Ravi","Lily","Mason","Te Aio","Charlotte","George","Amelia"];
const LAST = ["Anderson","Bennett","Campbell","Davies","Edwards","Fraser","Gray","Harris","Iti","Johnson","Kereama","Lawson","McKenzie","Nikora","O'Brien","Parata","Quinn","Robertson","Smith","Tane","Walker","Wilson","Young","Thompson","Reid","Patel","Singh","Chen","Murray","Hughes","Ngata","Paki","Taylor","Watson","Clarke","Morgan","Brown","Kingi","Stewart","Mitchell"];
const TOWNS = [["Hamilton",34],["Cambridge",12],["Te Awamutu",10],["Raglan",7],["Morrinsville",7],["Matamata",7],["Huntly",5],["Ngāruawāhia",5],["Te Aroha",4],["Ōtorohanga",4],["Thames",3],["Tokoroa",2]];
const STREETS = ["Kowhai Rd","Totara Dr","Rimu St","Matai Pl","Kauri Ave","Pukeko Lane","Tui St","Harakeke Way","Ruru Cres","Manuka Rd","Puriri St","Kereru Rise","Riverlea Rd","Ridge Rd","Station Rd","Orchard Lane"];
const BIZ = ["Joinery","Motors","Engineering","Vets","Storage","Medical Centre","Garden Centre","Packhouse","Transport","Physio","Builders","Café"];
const FARM = ["Dairy","Farms","Orchard","Poultry","Nursery"];
const FAULTS = [["Isolation fault on string 2","critical"],["Grid overvoltage trips","warning"],["Arc fault detected","critical"],["Inverter fan error","warning"],["Earth leakage warning","critical"],["Communication board fault","warning"]];

export function buildSample(TODAY){
  R = mulberry32(450);
  const systems = [];
  const N = 452;
  for(let i=0;i<N;i++){
    const type = wpick([["Residential",80],["Commercial",15],["Farm",5]]);
    const brand = wpick(BRANDS);
    const ageDays = Math.floor(Math.pow(R(),1.6)*3900); // weighted to recent installs
    const installed = addDays(TODAY,-ageDays-20);
    const kw = type==="Residential" ? Math.round((3+R()*10)*10)/10 : type==="Commercial" ? Math.round(20+R()*130) : Math.round(10+R()*50);
    const town = wpick(TOWNS);
    const fn = pick(FIRST), ln = pick(LAST);
    const name = type==="Residential" ? fn+" "+ln : type==="Commercial" ? ln+" "+pick(BIZ) : ln+" "+pick(FARM);
    const contact = type==="Residential" ? name : fn+" "+ln;
    const panelW = parseInt(pick(PANELS).match(/(\d+)W/)[1]);
    const panelModel = pick(PANELS);
    const panels = Math.round(kw*1000/parseInt(panelModel.match(/(\d+)W/)[1]));
    const model = (()=>{ const m=MODELS[brand]; if(type==="Residential") return m[Math.min(m.length-1,kw>8?1:0)]; return m[m.length-1-(kw<40?1:0)] })();
    const battery = type==="Residential" && ageDays<1500 && R()<.3 ? pick(BATTS) : null;
    const status = wpick([["Online",910],["Underperforming",45],["Offline",25],["Fault",20]]);
    let plan = "None";
    if(type==="Commercial") plan = R()<.62 ? "Commercial" : "None";
    else if(type==="Farm") plan = wpick([["Care",40],["Monitor",20],["None",40]]);
    else plan = wpick([["Care",21],["Monitor",16],["None",63]]);
    const planFee = plan==="Monitor"?149:plan==="Care"?349:plan==="Commercial"?Math.round((900+kw*14)/50)*50:0;
    const planStart = plan!=="None" ? addDays(TODAY,-rint(10,Math.min(ageDays+10,1100))) : null;
    const lastService = plan==="Care"||plan==="Commercial" ? addDays(TODAY,-rint(30,420)) : (R()<.2 && ageDays>400 ? addDays(TODAY,-rint(200,900)) : null);
    const nextService = (plan==="Care"||plan==="Commercial") ? addMonths(lastService,12) : null;
    const invWarrantyYrs = brand==="Enphase"?25:(brand==="Fronius"||brand==="SolarEdge"?12:10);
    const invWarranty = addMonths(installed,invWarrantyYrs*12);
    const exp = kw*3.9; // spring kWh/day expected
    const perf = status==="Online"? .9+R()*.14 : status==="Underperforming"? .55+R()*.2 : status==="Fault"? .25+R()*.35 : 0;
    const offlineDays = status==="Offline" ? rint(1,9) : 0;
    const serial = brand.slice(0,2).toUpperCase().replace(" ","")+(10000000+Math.floor(R()*89999999));
    systems.push({
      id:"SYS-"+String(1001+i), name, contact, type, brand, model, kw, panels, panelModel, battery,
      town, address: rint(1,240)+" "+pick(STREETS)+", "+town,
      phone:"02"+rint(1,9)+" "+rint(100,999)+" "+rint(1000,9999), email:(fn+"."+ln).toLowerCase().replace(/[^a-z.]/g,"")+"@example.co.nz",
      installed, ageDays, status, plan, planFee, planStart, lastService, nextService, invWarranty, exp, perf, offlineDays, serial,
      fault: status==="Fault" ? pick(FAULTS) : null,
      offer: null, connected: true
    });
  }
  // fleet weather for last 30 days, shared by all systems
  const weather = []; for(let d=0;d<30;d++) weather.push(.55+R()*.5);
  // alerts
  const alerts = []; let aid=1;
  for(const s of systems){
    if(s.status==="Offline") alerts.push({id:aid++,sys:s.id,sev:"critical",title:"No data for "+s.offlineDays+(s.offlineDays===1?" day":" days"),detail:s.brand+" portal reports the inverter offline",at:addDays(TODAY,-s.offlineDays),state:"open"});
    if(s.status==="Fault") alerts.push({id:aid++,sys:s.id,sev:s.fault[1],title:s.fault[0],detail:s.brand+" "+s.model+" event log",at:addDays(TODAY,-rint(0,6)),state:"open"});
    if(s.status==="Underperforming") alerts.push({id:aid++,sys:s.id,sev:"warning",title:"Output "+Math.round((1-s.perf)*100)+"% below expected",detail:"7-day average vs similar systems nearby",at:addDays(TODAY,-rint(1,7)),state:"open"});
    if(s.nextService && s.nextService<TODAY) alerts.push({id:aid++,sys:s.id,sev:"warning",title:"Annual service overdue",detail:"Due "+fmtDate(s.nextService)+" on "+s.plan+" plan",at:s.nextService,state:"open"});
    const wd = daysBetween(TODAY,s.invWarranty); if(wd>0 && wd<=120) alerts.push({id:aid++,sys:s.id,sev:"info",title:"Inverter warranty ends in "+wd+" days",detail:"Good time to offer a health check",at:addDays(TODAY,-rint(0,10)),state:"open"});
  }
  alerts.sort((a,b)=>sevRank(a.sev)-sevRank(b.sev) || b.at-a.at);
  // jobs
  const jobs = []; let jid=5001;
  for(const s of systems){
    if(s.nextService && daysBetween(TODAY,s.nextService)<=75) jobs.push({id:"JOB-"+jid++,sys:s.id,kind:s.plan==="Commercial"?"Commercial service + report":"Annual clean and check",cat:s.plan==="Commercial"?"commercial":"annual",due:s.nextService,who:null,slot:null,state:"unscheduled"});
  }
  for(const s of systems){ if(s.status==="Fault" && R()<.5) jobs.push({id:"JOB-"+jid++,sys:s.id,kind:"Fault callout: "+s.fault[0].toLowerCase(),cat:"fault",due:addDays(TODAY,rint(0,5)),who:null,slot:null,state:"unscheduled"}); }
  for(let k=0;k<18;k++){ const s=pick(systems); jobs.push({id:"JOB-"+jid++,sys:s.id,kind:pick(["Annual clean and check","Commercial service + report","Battery firmware update"]),cat:"annual",due:addDays(TODAY,-rint(3,60)),who:pick(["josh","reece","hemi","sam","wash"]),slot:null,state:"done"}); }
  jobs.sort((a,b)=>a.due-b.due); jobs.forEach(j=>{if(j.state==="done")j.slot=j.due});
  // stock
  const stock = [
    {part:"Fronius Primo 5.0 (swap unit)",qty:1,min:1},{part:"Huawei SUN2000-5KTL (swap unit)",qty:0,min:1},
    {part:"Enphase IQ8+ microinverters",qty:14,min:10},{part:"SolarEdge P505 optimisers",qty:6,min:12},
    {part:"DC isolators 1200V",qty:9,min:6},{part:"MC4 connector pairs",qty:120,min:50},
    {part:"Huawei Smart Dongle 4G",qty:2,min:4},{part:"Panel cleaning kit (deionised)",qty:3,min:2},
    {part:"4mm² PV cable (100 m roll)",qty:4,min:3},{part:"Fox ESS CT clamps",qty:1,min:4}
  ];
  const claims = systems.filter(s=>s.status==="Fault").slice(0,6).map((s,i)=>({id:"WC-"+(301+i),sys:s.id,item:s.brand+" "+s.model,serial:s.serial,lodged:addDays(TODAY,-rint(2,40)),state:pick(["Lodged","Awaiting RMA","Replacement shipped","Lodged"])}));
  const conns = [
    ...BRANDS.map(([b])=>({name:b,kind:"Inverter portal",count:systems.filter(s=>s.brand===b).length,state:b==="Fox ESS"?"Reconnect needed":"Connected",synced:b==="Fox ESS"?"3 days ago":rint(2,14)+" min ago"})),
    {name:"Xero",kind:"Plan invoicing",count:null,state:"Connected",synced:"1 hr ago"},
    {name:"Fergus",kind:"Job management",count:null,state:"Connected",synced:"6 min ago"},
    {name:"Simpro",kind:"Job management",count:null,state:"Not connected",synced:"—"},
    {name:"ServiceM8",kind:"Job management",count:null,state:"Not connected",synced:"—"}
  ];
  return {systems,weather,alerts,jobs,stock,claims};
}

export const SAMPLE_TEAM=[
  {id:"josh",name:"Josh M",kind:"team",role:"Lead tech",cal:"Google Calendar",email:"josh@kowhaisolar.example"},
  {id:"reece",name:"Reece T",kind:"team",role:"Electrician",cal:"Google Calendar",email:"reece@kowhaisolar.example"},
  {id:"hemi",name:"Hemi P",kind:"team",role:"Electrician",cal:"Outlook",email:"hemi@kowhaisolar.example"},
  {id:"sam",name:"Sam W",kind:"team",role:"Apprentice",cal:"Outlook",email:"sam@kowhaisolar.example"},
  {id:"wash",name:"Brightwash Panel Cleaning",short:"Brightwash",kind:"contractor",role:"Cleaning contractor",email:"bookings@brightwash.example"},
  {id:"ridge",name:"Ridgeline Electrical",short:"Ridgeline",kind:"contractor",role:"Subcontractor, Coromandel",email:"jobs@ridgeline.example"}
];
