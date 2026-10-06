// Shared date and format helpers.
export const DAY = 864e5;
export const startOfDay = d => { const x=new Date(d); x.setHours(0,0,0,0); return x };
export const addDays = (d,n) => new Date(d.getTime()+n*DAY);
export const addMonths = (d,n) => { const x=new Date(d); x.setMonth(x.getMonth()+n); return x };
export const daysBetween = (a,b) => Math.round((b-a)/DAY);
export function sevRank(s){return s==="critical"?0:s==="warning"?1:s==="info"?2:3}
export function fmtDate(d){return d.toLocaleDateString("en-NZ",{day:"numeric",month:"short",year:"numeric"})}
export function fmtShort(d){return d.toLocaleDateString("en-NZ",{day:"numeric",month:"short"})}
export function money(n){return "$"+Math.round(n).toLocaleString("en-NZ")}
export function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
