import {requireUser} from "./guard.js";
import {listRecurring,listLiabilities,listFinancingPlans,listInsurance,listInvestments,listReceivables} from "./data-service.js";
import {todayISO,addDaysISO,addMonthsISO,isoFromParts,money,escapeHtml} from "./utils.js";
let sets={};const tbody=document.querySelector("#cal-body");

function monthlyDates(day,start,end){
  const out=[];let cur=start.slice(0,7)+"-01";
  while(cur<=end){
    const [y,m]=cur.split("-").map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate();
    const date=isoFromParts(y,m,Math.min(Number(day||1),last));
    if(date>=start&&date<=end)out.push(date);
    cur=addMonthsISO(cur,1);
  }
  return out;
}
function render(){
  const start=todayISO(),end=addDaysISO(start,Number(document.querySelector("#cal-horizon").value)),ev=[];
  for(const r of sets.recurring.filter(x=>x.active!==false))for(const date of monthlyDates(r.dayOfMonth,start,end))ev.push({date,type:"Recurrente",name:r.name,amount:r.amount,status:addDaysISO(date,-Number(r.reminderDaysBefore||0))<=start?"recordatorio":"programado"});
  for(const d of sets.debts.filter(x=>x.active!==false))for(const s of (d.schedule||[]).filter(x=>x.status!=="paid"&&x.dueDate>=start&&x.dueDate<=end))ev.push({date:s.dueDate,type:"Deuda",name:d.concept,amount:s.payment,status:addDaysISO(s.dueDate,-Number(d.reminderDaysBefore||0))<=start?"recordatorio":s.status});
  for(const p of sets.plans.filter(x=>x.active!==false))for(const s of (p.schedule||[]).filter(x=>x.status!=="paid"&&x.dueDate>=start&&x.dueDate<=end))ev.push({date:s.dueDate,type:"Tarjeta",name:p.description,amount:s.payment,status:s.status});
  for(const i of sets.ins.filter(x=>x.active!==false))for(const date of monthlyDates(i.paymentDay,start,end))ev.push({date,type:"Seguro",name:i.name,amount:i.monthlyPremium,status:addDaysISO(date,-Number(i.reminderDaysBefore||0))<=start?"recordatorio":"programado"});
  for(const i of sets.inv.filter(x=>x.active!==false&&x.status==="active"))if(i.maturityDate>=start&&i.maturityDate<=end)ev.push({date:i.maturityDate,type:"Inversión",name:i.name,amount:i.expectedMaturityValue,status:addDaysISO(i.maturityDate,-Number(i.reminderDaysBefore||0))<=start?"recordatorio":"vencimiento"});
  for(const r of sets.recv.filter(x=>Number(r.paidAmount||0)<Number(r.amount||0)&&r.dueDate>=start&&r.dueDate<=end))ev.push({date:r.dueDate,type:"Por cobrar",name:r.workPeriod,amount:Number(r.amount)-Number(r.paidAmount||0),status:r.dueDate<start?"vencido":"pendiente"});
  ev.sort((a,b)=>a.date.localeCompare(b.date));
  tbody.innerHTML=ev.map(x=>`<tr><td>${x.date}</td><td>${escapeHtml(x.type)}</td><td>${escapeHtml(x.name)}</td><td>${money(x.amount)}</td><td><span class="tf-pill ${x.status==="recordatorio"?"tf-pill-warn":""}">${escapeHtml(x.status)}</span></td></tr>`).join("")||`<tr><td colspan="5" class="tf-empty">Sin eventos.</td></tr>`;
}
async function refresh(){const[recurring,debts,plans,ins,inv,recv]=await Promise.all([listRecurring(),listLiabilities(),listFinancingPlans(),listInsurance(),listInvestments(),listReceivables()]);sets={recurring,debts,plans,ins,inv,recv};render()}
document.querySelector("#cal-horizon").addEventListener("change",render);
requireUser(()=>refresh().catch(console.error));
