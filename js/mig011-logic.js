export const MIG011_TARGET={institutionId:"deuna",displayName:"DeUna"};
export const MIG011_CASES=[
  {id:"8LgBdKZrGzF7IscEoyFI",bank:"DeUna",alias:"DeUna",accountType:"savings",active:false},
  {id:"C9moyXtN0wp62rLm2h0H",bank:"Deuna!",alias:"De Una",accountType:"savings",active:true}
];

const text=v=>String(v??"").trim();
export function inspectMig011(accounts=[]){
  const byId=new Map(accounts.map(a=>[a.id,a]));
  const blockers=[];const pending=[];const resolved=[];
  for(const expected of MIG011_CASES){
    const row=byId.get(expected.id);
    if(!row){blockers.push(`${expected.id}: cuenta no encontrada`);continue;}
    for(const key of ["bank","alias","accountType"]){
      if(text(row[key])!==text(expected[key]))blockers.push(`${expected.id}: ${key} cambió respecto del snapshot auditado`);
    }
    if((row.active!==false)!==(expected.active!==false))blockers.push(`${expected.id}: estado activo/archivado cambió respecto del snapshot auditado`);
    const iid=text(row.institutionId),display=text(row.institutionDisplayName);
    if(iid&&iid!==MIG011_TARGET.institutionId)blockers.push(`${expected.id}: institutionId inesperado (${iid})`);
    if(iid===MIG011_TARGET.institutionId){
      if(display&&display!==MIG011_TARGET.displayName)blockers.push(`${expected.id}: institutionDisplayName inesperado (${display})`);
      else resolved.push(row);
    }else pending.push(row);
  }
  return {safe:blockers.length===0,resolved:resolved.length===MIG011_CASES.length,pending,resolvedRows:resolved,blockers};
}
