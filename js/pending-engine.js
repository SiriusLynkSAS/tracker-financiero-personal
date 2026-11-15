import {todayISO,addDaysISO,isoFromParts} from "./utils.js";

function monthParts(ym){const [y,m]=String(ym).split("-").map(Number);return {y,m};}
function dueForMonth(day,ym){const {y,m}=monthParts(ym);const d=Math.min(Number(day||1),new Date(y,m,0).getDate());return isoFromParts(y,m,d);}
function monthAdd(ym,delta){const {y,m}=monthParts(ym);const d=new Date(y,m-1+delta,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;}
function statusFor(due,today){if(due<today)return "overdue";if(due===today)return "today";return "upcoming";}

export function pendingPaidThrough(entity={}){
  const explicit=Number(entity.paidThroughInstallment);
  if(Number.isFinite(explicit)&&explicit>=0)return Math.floor(explicit);
  const schedule=Array.isArray(entity.schedule)?entity.schedule:[];
  const explicitPaid=schedule.filter(x=>x.status==="paid").map(x=>Number(x.n)).filter(Number.isFinite).sort((a,b)=>b-a)[0];
  if(explicitPaid!==undefined)return explicitPaid;
  const storedNext=Math.max(1,Number(entity.currentInstallment||1));
  return Math.max(0,storedNext-1);
}

function lastPaymentDate(row={}){
  const dates=(Array.isArray(row.payments)?row.payments:[]).map(p=>String(p?.date||"")).filter(Boolean).sort();
  return dates.at(-1)||row.paidDate||null;
}

export function effectivePendingSchedule(entity={}){
  const schedule=Array.isArray(entity.schedule)?entity.schedule:[];
  const limit=pendingPaidThrough(entity);
  return schedule.map(row=>{
    const payments=Array.isArray(row.payments)?row.payments:[];
    const actualPaid=payments.reduce((sum,p)=>sum+Number(p?.amount||0),0);
    if(Number(row.n)<=limit){
      return {
        ...row,
        status:"paid",
        paidAmount:actualPaid>0?actualPaid:Number(row.paidAmount||row.payment||0),
        paidDate:lastPaymentDate(row),
        historicalPayment:row.historicalPayment===true?true:(payments.length?false:(row.paidDate?false:true)),
        payments
      };
    }
    if(actualPaid>0){
      return {...row,status:"partial",paidAmount:actualPaid,paidDate:lastPaymentDate(row),historicalPayment:false,payments};
    }
    return {...row,status:"pending",paidAmount:0,paidDate:null,historicalPayment:false,payments};
  });
}

function contiguousPaidThrough(schedule=[]){
  let n=0;
  for(const row of [...schedule].sort((a,b)=>Number(a.n)-Number(b.n))){
    if(row.status!=="paid")break;
    n=Number(row.n||n);
  }
  return n;
}

export function closeHistoricalInstallment(entity={},installmentNumber,paidDate){
  const target=Number(installmentNumber||0);
  if(!(target>0))throw new Error("Cuota histórica no válida.");
  const base=effectivePendingSchedule(entity);
  if(!base.some(row=>Number(row.n)===target))throw new Error("Cuota no encontrada.");
  const schedule=base.map(row=>Number(row.n)===target?{
    ...row,
    status:"paid",
    paidAmount:Number(row.payment||0),
    paidDate:String(paidDate||row.dueDate||""),
    historicalPayment:true
  }:row);
  const paidThroughInstallment=contiguousPaidThrough(schedule);
  const next=[...schedule].sort((a,b)=>Number(a.n)-Number(b.n)).find(row=>row.status!=="paid")||null;
  const calculatedPending=schedule.reduce((total,row)=>total+Math.max(0,Number(row.payment||0)-Number(row.paidAmount||0)),0);
  return {schedule,paidThroughInstallment,next,calculatedPending};
}

export function buildPendingItems({recurring=[],transactions=[],liabilities=[],plans=[],accounts=[],invoices=[],today=todayISO()}){
  const items=[]; const current=today.slice(0,7); const next=monthAdd(current,1);
  for(const r of recurring.filter(x=>x.active!==false)){
    const doneOccurrences=new Set([
      ...transactions
        .filter(t=>t.recurringId===r.id)
        .map(t=>t.recurringOccurrence||String(t.date||"").slice(0,7))
        .filter(x=>/^\d{4}-\d{2}$/.test(x)),
      ...(Array.isArray(r.historicalResolvedOccurrences)?r.historicalResolvedOccurrences:[])
        .filter(x=>/^\d{4}-\d{2}$/.test(String(x)))
    ]);
    const startMonth=/^\d{4}-\d{2}/.test(String(r.startDate||""))
      ? String(r.startDate).slice(0,7)
      : current;
    const endMonth=/^\d{4}-\d{2}/.test(String(r.endDate||""))
      ? String(r.endDate).slice(0,7)
      : next;

    // Mantiene visible la ocurrencia vencida más antigua sin inundar la lista
    // con todos los meses atrasados de un mismo recurrente.
    let cursor=startMonth;
    let guard=0;
    while(cursor<current && cursor<=endMonth && guard<600){
      const due=dueForMonth(r.dayOfMonth,cursor);
      const validStart=!r.startDate || due>=r.startDate;
      const validEnd=!r.endDate || due<=r.endDate;
      if(validStart && validEnd && due<today && !doneOccurrences.has(cursor)){
        items.push({
          key:`recurring:${r.id}:${cursor}`,kind:"recurring",entityId:r.id,occurrence:cursor,
          title:r.name||"Recurrente",subtitle:`${r.type==="income"?"Ingreso previsto vencido":"Pago recurrente vencido"} · período ${cursor}`,
          amount:Number(r.amount||0),dueDate:due,status:"overdue",
          actionLabel:r.type==="income"?"Registrar ingreso":"Registrar pago",
          url:`movimientos.html?recurring=${encodeURIComponent(r.id)}&occurrence=${cursor}`
        });
        break;
      }
      cursor=monthAdd(cursor,1);
      guard++;
    }

    for(const occ of [current,next]){
      if(occ<startMonth || occ>endMonth) continue;
      const due=dueForMonth(r.dayOfMonth,occ); const remind=Number(r.reminderDaysBefore??3);
      if(r.startDate && due<r.startDate) continue; if(r.endDate && due>r.endDate) continue;
      if(doneOccurrences.has(occ)) continue;
      if(due>addDaysISO(today,remind)) continue;
      items.push({key:`recurring:${r.id}:${occ}`,kind:"recurring",entityId:r.id,occurrence:occ,title:r.name||"Recurrente",subtitle:`${r.type==="income"?"Ingreso previsto":"Pago recurrente"} · período ${occ}`,amount:Number(r.amount||0),dueDate:due,status:statusFor(due,today),actionLabel:r.type==="income"?"Registrar ingreso":"Registrar pago",url:`movimientos.html?recurring=${encodeURIComponent(r.id)}&occurrence=${occ}`});
    }
  }
  for(const d of liabilities.filter(x=>x.active!==false&&x.status!=="paid_off")){
    const schedule=effectivePendingSchedule(d);
    const row=schedule.find(x=>x.status!=="paid"); if(!row?.dueDate) continue;
    const remind=Number(d.reminderDaysBefore??3); if(row.dueDate>addDaysISO(today,remind)) continue;
    const pending=Math.max(0,Number(row.payment||0)-Number(row.paidAmount||0));
    items.push({key:`debt:${d.id}:${row.n}`,kind:"debt",entityId:d.id,installmentNumber:Number(row.n),title:`${d.creditor||"Deuda"} · cuota ${row.n}`,subtitle:row.status==="partial"?"Pago parcial":"Cuota de deuda",amount:pending||Number(row.payment||0),dueDate:row.dueDate,status:statusFor(row.dueDate,today),actionLabel:row.status==="partial"?"Completar pago":"Registrar pago",url:`deudas.html?liability=${encodeURIComponent(d.id)}&installment=${row.n}`});
  }
  for(const p of plans.filter(x=>x.active!==false&&x.status!=="paid_off")){
    const schedule=effectivePendingSchedule(p);
    const row=schedule.find(x=>x.status!=="paid"); if(!row?.dueDate) continue;
    const remind=Number(p.reminderDaysBefore??3); if(row.dueDate>addDaysISO(today,remind)) continue;
    const card=accounts.find(a=>a.id===p.parentId); const pending=Math.max(0,Number(row.payment||0)-Number(row.paidAmount||0));
    items.push({key:`card:${p.id}:${row.n}`,kind:"card",entityId:p.id,installmentNumber:Number(row.n),title:`${card?.bank||"Tarjeta"} · cuota ${row.n}`,subtitle:p.description||"Pago de tarjeta",amount:pending||Number(row.payment||0),dueDate:row.dueDate,status:statusFor(row.dueDate,today),actionLabel:"Registrar pago",url:`deudas.html?plan=${encodeURIComponent(p.id)}&installment=${row.n}`});
  }

  for(const invoice of invoices.filter(x=>x.active!==false&&x.status!=="void")){
    const pending=Math.max(0,Number(invoice.totalAmount||0)-Number(invoice.paidAmount||0));
    if(pending<=.009) continue;
    const due=String(invoice.dueDate||invoice.issueDate||today);
    items.push({
      key:`invoice:${invoice.id}`,kind:"invoice",entityId:invoice.id,
      title:`Factura ${invoice.invoiceNumber||""}`.trim(),subtitle:`Ingreso por cobrar · ${invoice.customerName||"Cliente"}`,
      amount:pending,dueDate:due,status:statusFor(due,today),actionLabel:"Registrar cobro",
      url:`facturacion.html?invoice=${encodeURIComponent(invoice.id)}`
    });
  }
  const rank={overdue:0,today:1,upcoming:2};
  return items.sort((a,b)=>(rank[a.status]-rank[b.status])||a.dueDate.localeCompare(b.dueDate));
}
