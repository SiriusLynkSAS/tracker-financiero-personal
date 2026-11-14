export const MIG008_TARGETS = Object.freeze({
  "79ZDfUwLvFSAvSkOt5my": Object.freeze({
    creditor:"Amparito Marisol Veloz Chavez",
    concept:"Préstamo",
    originalPrincipal:8000,
    historicalInstallments:Object.freeze([1,2,3,4,5,6,7,8,9]),
    linkedInstallments:Object.freeze([10])
  }),
  "YY9zu2433CoCjP7nlfVV": Object.freeze({
    creditor:"COAC Politécnica",
    concept:"Préstamo personal",
    originalPrincipal:3000,
    historicalInstallments:Object.freeze([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]),
    linkedInstallments:Object.freeze([18])
  })
});

const text=v=>String(v??"").trim();
const num=v=>Number(v||0);
const moneyEq=(a,b)=>Math.abs(num(a)-num(b))<=0.02;
const paymentHasTransaction=row=>(Array.isArray(row?.payments)?row.payments:[]).some(p=>text(p?.transactionId)!=="");

export function inspectMig008Debt(row){
  const target=MIG008_TARGETS[text(row?.id)];
  if(!target) return {known:false,safe:false,resolved:false,candidates:[],blockers:["ID no auditado"]};
  const blockers=[];
  if(text(row?.creditor)!==target.creditor) blockers.push("acreedor distinto al auditado");
  if(text(row?.concept)!==target.concept) blockers.push("concepto distinto al auditado");
  if(!moneyEq(row?.originalPrincipal,target.originalPrincipal)) blockers.push("principal distinto al auditado");
  const schedule=Array.isArray(row?.schedule)?row.schedule:[];
  const byN=new Map(schedule.map(x=>[Number(x?.n),x]));
  const candidates=[];
  const resolved=[];
  for(const n of target.historicalInstallments){
    const item=byN.get(n);
    if(!item){blockers.push(`falta cuota ${n}`);continue;}
    if(text(item.status)!=="paid") blockers.push(`cuota ${n} no está paid`);
    if(!text(item.paidDate)) blockers.push(`cuota ${n} sin paidDate`);
    if(!(num(item.paidAmount)>0)) blockers.push(`cuota ${n} sin paidAmount`);
    if(paymentHasTransaction(item)) blockers.push(`cuota ${n} ya tiene transactionId y no debe migrarse`);
    if(item.historicalPayment===true) resolved.push(n); else candidates.push(n);
  }
  for(const n of target.linkedInstallments){
    const item=byN.get(n);
    if(!item){blockers.push(`falta cuota vinculada ${n}`);continue;}
    if(text(item.status)!=="paid") blockers.push(`cuota vinculada ${n} no está paid`);
    if(!paymentHasTransaction(item)) blockers.push(`cuota vinculada ${n} perdió transactionId`);
    if(item.historicalPayment===true) blockers.push(`cuota vinculada ${n} fue marcada histórica indebidamente`);
  }
  return {
    known:true,
    safe:blockers.length===0,
    resolved:blockers.length===0 && candidates.length===0,
    candidates,
    resolvedInstallments:resolved,
    blockers,
    target,
    schedule
  };
}

export function migrateMig008Schedule(row){
  const inspection=inspectMig008Debt(row);
  if(!inspection.safe) throw new Error(`MIG-008 bloqueada: ${inspection.blockers.join("; ")}`);
  const targetSet=new Set(inspection.target.historicalInstallments);
  return inspection.schedule.map(item=>targetSet.has(Number(item?.n))
    ? {...item,historicalPayment:true}
    : item
  );
}

export function mig008Summary(rows=[]){
  const inspections=rows.map(inspectMig008Debt);
  const blockers=inspections.flatMap((x,i)=>x.blockers.map(b=>`${text(rows[i]?.creditor||rows[i]?.id)}: ${b}`));
  return {
    safe:inspections.length===Object.keys(MIG008_TARGETS).length && blockers.length===0,
    resolved:inspections.length===Object.keys(MIG008_TARGETS).length && blockers.length===0 && inspections.every(x=>x.resolved),
    candidateCount:inspections.reduce((s,x)=>s+x.candidates.length,0),
    resolvedCount:inspections.reduce((s,x)=>s+(x.resolvedInstallments?.length||0),0),
    blockers,
    inspections
  };
}
