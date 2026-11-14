// Identidad canónica de instituciones — MIG-011.
// No fusiona cuentas. Solo resuelve aliases conocidos y preserva fallback legacy.

export function normalizeInstitutionKey(value=""){
  return String(value??"").trim().toLowerCase()
    .normalize("NFD").replace(/\p{M}+/gu,"")
    .replace(/[^a-z0-9]+/g,"");
}

const CATALOG=new Map([
  ["deuna",{institutionId:"deuna",displayName:"DeUna"}]
]);

export function resolveInstitutionIdentity(bank="",existingId="",existingDisplayName=""){
  const key=normalizeInstitutionKey(bank);
  const known=CATALOG.get(key);
  if(known)return {...known,matched:true};
  const id=String(existingId??"").trim();
  const display=String(existingDisplayName??"").trim();
  // Si una cuenta MIG-011 cambia posteriormente a otra institución, no arrastrar deuna.
  if(id==="deuna")return {institutionId:"",displayName:"",matched:false};
  return {institutionId:id,displayName:display,matched:false};
}

export function institutionDisplay(row={}){
  return String(row.institutionDisplayName||row.bank||"").trim();
}
