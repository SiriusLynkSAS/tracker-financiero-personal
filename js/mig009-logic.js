export const MIG009_REDUNDANT_IDS=[
  "65WQSFVhn535VFEjuR6W",
  "GZOUqWC0KAaOef96JP0H",
  "oY4mdP1CGguYCupwqyAU",
  "yFqyYseDTUe7bkXey34Q"
];
export const MIG009_CANONICAL_ID="jsi7tqeDwG74ox98R7n4";
export const MIG009_AUDITED_IDS=[...MIG009_REDUNDANT_IDS,MIG009_CANONICAL_ID];

export function inspectMig009(rows=[]){
  const byId=new Map(rows.map(r=>[String(r?.id||""),r]));
  const blockers=[];
  for(const id of MIG009_AUDITED_IDS){
    if(!byId.has(id)) blockers.push(`falta el receivable auditado ${id}`);
  }
  for(const row of rows){
    const id=String(row?.id||"");
    if(row?.hasStoredId){
      if(!MIG009_REDUNDANT_IDS.includes(id)) blockers.push(`campo id redundante inesperado en ${id||"documento sin id"}`);
      if(String(row?.storedId??"")!==id) blockers.push(`id interno distinto del document ID en ${id}`);
    }
  }
  const canonical=byId.get(MIG009_CANONICAL_ID);
  if(canonical?.hasStoredId) blockers.push(`el caso canónico ${MIG009_CANONICAL_ID} ahora contiene id interno`);
  const pending=MIG009_REDUNDANT_IDS.filter(id=>byId.get(id)?.hasStoredId===true);
  const alreadyClean=MIG009_REDUNDANT_IDS.filter(id=>byId.get(id)?.hasStoredId===false);
  return {
    safe:blockers.length===0,
    blockers,
    pending,
    alreadyClean,
    resolved:blockers.length===0&&pending.length===0,
    totalRows:rows.length
  };
}
