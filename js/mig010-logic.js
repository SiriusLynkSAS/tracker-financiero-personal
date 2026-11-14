export const MIG010_IDS=["FdlrVuBdJL6rKU1zOrU5","ai2H2yT5roUKoPowLubv"];
export const MIG010_EXPECTED={
  FdlrVuBdJL6rKU1zOrU5:{type:"expense",date:"2026-10-29",transactionDateTime:"2026-10-29T08:42",amount:0.45,description:"BDE - Casa",accountId:"EI0cx2IULsr6RooTzrJF",category:"Transporte",subcategory:"Metro"},
  ai2H2yT5roUKoPowLubv:{type:"expense",date:"2026-10-29",transactionDateTime:"2026-10-29T19:00",amount:0.45,description:"BDE - Casa",accountId:"EI0cx2IULsr6RooTzrJF",category:"Transporte",subcategory:"Metro"}
};
const txt=v=>String(v??"").trim();
const money=v=>Math.round(Number(v||0)*100)/100;
export function isMig010AuditedCandidate(row){return MIG010_IDS.includes(String(row?.id||""));}
export function mig010FingerprintMatches(row){
  const id=String(row?.id||"");const e=MIG010_EXPECTED[id];if(!e)return false;
  return txt(row.type)===e.type&&txt(row.date)===e.date&&txt(row.transactionDateTime)===e.transactionDateTime&&
    money(row.amount)===money(e.amount)&&txt(row.description)===e.description&&txt(row.accountId)===e.accountId&&
    txt(row.category)===e.category&&txt(row.subcategory)===e.subcategory;
}
export function inspectMig010(rows=[]){
  const byId=new Map(rows.map(r=>[String(r?.id||""),r]));
  const present=MIG010_IDS.filter(id=>byId.has(id));
  const blockers=[];
  for(const id of present){
    const r=byId.get(id);
    if(!mig010FingerprintMatches(r)) blockers.push(`el movimiento ${id} ya no coincide con la huella auditada`);
    const resolution=txt(r?.mig010Resolution);
    if(resolution&&!['distinct_confirmed','duplicate_resolved'].includes(resolution)) blockers.push(`resolución MIG-010 desconocida en ${id}`);
  }
  if(present.length===2){
    const a=txt(byId.get(MIG010_IDS[0])?.mig010Resolution),b=txt(byId.get(MIG010_IDS[1])?.mig010Resolution);
    if(a==='distinct_confirmed'&&b==='distinct_confirmed') return {safe:blockers.length===0,resolved:blockers.length===0,resolution:'distinct',blockers,present,rows:present.map(id=>byId.get(id))};
    if(a||b) blockers.push('la marca de revisión no es consistente entre ambos movimientos');
    return {safe:blockers.length===0,resolved:false,resolution:'pending',blockers,present,rows:present.map(id=>byId.get(id))};
  }
  if(present.length===1){
    const survivor=byId.get(present[0]);
    if(txt(survivor?.mig010Resolution)==='duplicate_resolved') return {safe:blockers.length===0,resolved:blockers.length===0,resolution:'duplicate',blockers,present,rows:[survivor]};
    blockers.push('falta uno de los dos movimientos auditados sin una resolución MIG-010 registrada');
    return {safe:false,resolved:false,resolution:'blocked',blockers,present,rows:[survivor]};
  }
  blockers.push('faltan ambos movimientos auditados');
  return {safe:false,resolved:false,resolution:'blocked',blockers,present,rows:[]};
}
