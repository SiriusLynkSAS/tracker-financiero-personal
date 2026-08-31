export function money(v){return new Intl.NumberFormat("es-EC",{style:"currency",currency:"USD",minimumFractionDigits:2}).format(Number(v||0))}
export function escapeHtml(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
export function todayISO(){const d=new Date(),o=d.getTimezoneOffset();return new Date(d.getTime()-o*60000).toISOString().slice(0,10)}
export function isoFromParts(y,m,d){return `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`}
export function addMonthsISO(iso,months,dayOverride=null){const [y,m,d]=iso.split("-").map(Number),dt=new Date(Date.UTC(y,m-1+Number(months),1)),td=dayOverride??d,last=new Date(Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth()+1,0)).getUTCDate();return isoFromParts(dt.getUTCFullYear(),dt.getUTCMonth()+1,Math.min(td,last))}
export function addDaysISO(iso,days){const [y,m,d]=iso.split("-").map(Number),dt=new Date(Date.UTC(y,m-1,d+Number(days)));return isoFromParts(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate())}
export function monthKey(iso){return String(iso).slice(0,7)}
export function monthBounds(date=new Date()){const y=date.getFullYear(),m=date.getMonth()+1,start=isoFromParts(y,m,1),last=new Date(Date.UTC(y,m,0)).getUTCDate();return{start,end:isoFromParts(y,m,last)}}
export function accountTypeLabel(t){return({savings:"Ahorros",checking:"Corriente",credit_card:"Tarjeta de crédito",cash:"Efectivo / billetera"})[t]||t}
export function txLabel(t){return({income:"Ingreso",expense:"Egreso",transfer:"Transferencia",investment_out:"Capital a inversión",investment_return:"Retorno de capital"})[t]||t}
export function sum(a,fn=x=>x){return a.reduce((s,x)=>s+Number(fn(x)||0),0)}
export function clamp(n,min,max){return Math.min(max,Math.max(min,Number(n)))}
export function daysBetween(a,b){return Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000)}
export function downloadText(filename,text,mime="text/plain"){const blob=new Blob([text],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function csvEscape(v){const s=String(v??"");return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
