import {todayISO,addDaysISO,isoFromParts} from "./utils.js";
function monthParts(ym){const [y,m]=String(ym).split("-").map(Number);return {y,m};}
function dueForMonth(day,ym){const {y,m}=monthParts(ym);const d=Math.min(Number(day||1),new Date(y,m,0).getDate());return isoFromParts(y,m,d);}
function monthAdd(ym,delta){const {y,m}=monthParts(ym);const d=new Date(y,m-1+delta,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;}
function statusFor(due,today){if(due<today)return "overdue";if(due===today)return "today";return "upcoming";}
export function buildPendingItems({recurring=[],transactions=[],liabilities=[],plans=[],accounts=[],today=todayISO()}){
  const items=[]; const current=today.slice(0,7); const next=monthAdd(current,1);
  for(const r of recurring.filter(x=>x.active!==false)){
    for(const occ of [current,next]){
      const due=dueForMonth(r.dayOfMonth,occ); const remind=Number(r.reminderDaysBefore??3);
      if(r.startDate && due<r.startDate) continue; if(r.endDate && due>r.endDate) continue;
      const done=transactions.some(t=>t.recurringId===r.id && ((t.recurringOccurrence||String(t.date||"").slice(0,7))===occ));
      if(done) continue;
      if(due>addDaysISO(today,remind)) continue;
      items.push({key:`recurring:${r.id}:${occ}`,kind:"recurring",entityId:r.id,occurrence:occ,title:r.name||"Recurrente",subtitle:r.type==="income"?"Ingreso previsto":"Pago recurrente",amount:Number(r.amount||0),dueDate:due,status:statusFor(due,today),actionLabel:r.type==="income"?"Registrar ingreso":"Registrar pago",url:`movimientos.html?recurring=${encodeURIComponent(r.id)}&occurrence=${occ}`});
    }
  }
  for(const d of liabilities.filter(x=>x.active!==false&&x.status!=="paid_off")){
    const row=(d.schedule||[]).find(x=>x.status!=="paid"); if(!row?.dueDate) continue;
    const remind=Number(d.reminderDaysBefore??3); if(row.dueDate>addDaysISO(today,remind)) continue;
    const pending=Math.max(0,Number(row.payment||0)-Number(row.paidAmount||0));
    items.push({key:`debt:${d.id}:${row.n}`,kind:"debt",entityId:d.id,installmentNumber:Number(row.n),title:`${d.creditor||"Deuda"} · cuota ${row.n}`,subtitle:row.status==="partial"?"Pago parcial":"Cuota de deuda",amount:pending||Number(row.payment||0),dueDate:row.dueDate,status:statusFor(row.dueDate,today),actionLabel:row.status==="partial"?"Completar pago":"Registrar pago",url:`deudas.html?liability=${encodeURIComponent(d.id)}&installment=${row.n}`});
  }
  for(const p of plans.filter(x=>x.active!==false&&x.status!=="paid_off")){
    const row=(p.schedule||[]).find(x=>x.status!=="paid"); if(!row?.dueDate) continue;
    const remind=Number(p.reminderDaysBefore??3); if(row.dueDate>addDaysISO(today,remind)) continue;
    const card=accounts.find(a=>a.id===p.parentId); const pending=Math.max(0,Number(row.payment||0)-Number(row.paidAmount||0));
    items.push({key:`card:${p.id}:${row.n}`,kind:"card",entityId:p.id,installmentNumber:Number(row.n),title:`${card?.bank||"Tarjeta"} · cuota ${row.n}`,subtitle:p.description||"Pago de tarjeta",amount:pending||Number(row.payment||0),dueDate:row.dueDate,status:statusFor(row.dueDate,today),actionLabel:"Registrar pago",url:`deudas.html?plan=${encodeURIComponent(p.id)}&installment=${row.n}`});
  }
  const rank={overdue:0,today:1,upcoming:2};
  return items.sort((a,b)=>(rank[a.status]-rank[b.status])||a.dueDate.localeCompare(b.dueDate));
}
