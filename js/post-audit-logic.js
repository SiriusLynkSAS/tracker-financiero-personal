export const AUD_POST_007_TARGET = Object.freeze({
  id: "lkX7XLbnKSPrmFV187ul",
  contractId: "tZjD4ppE82HmE0HMuMaj",
  transactionId: "hpOnEg4zjX5rBVWqg92L",
  amount: 750,
  status: "reversed"
});

export function sanitizeContractPaymentWrite(data={}){
  const out={...(data||{})};
  delete out.id;
  return out;
}

export function inspectAudPost007Raw(documentId,data){
  const id=String(documentId||"");
  if(id!==AUD_POST_007_TARGET.id){
    return {state:"blocked",blocker:"Documento fuera del caso auditado AUD-POST-007."};
  }
  if(!data || typeof data!=="object") return {state:"missing"};
  const internalId=Object.prototype.hasOwnProperty.call(data,"id") ? String(data.id??"") : "";
  if(!internalId) return {state:"resolved"};
  const signatureOk=
    internalId===id &&
    String(data.contractId||"")===AUD_POST_007_TARGET.contractId &&
    String(data.transactionId||"")===AUD_POST_007_TARGET.transactionId &&
    Math.abs(Number(data.amount||0)-AUD_POST_007_TARGET.amount)<0.001 &&
    String(data.status||"")===AUD_POST_007_TARGET.status;
  if(!signatureOk){
    return {state:"blocked",blocker:"El contractPayment ya no coincide con la huella auditada; requiere nueva revisión."};
  }
  return {state:"pending",internalId};
}

export function isFinancingPlanLinkedTransaction(row){
  return String(row?.financingPlanId||"").trim()!=="";
}
