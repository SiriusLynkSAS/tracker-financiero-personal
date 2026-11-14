export const MIG005_EXPECTED = Object.freeze({
  J8B3UDn5JhehP6yOYDZY: Object.freeze({
    id: "J8B3UDn5JhehP6yOYDZY",
    type: "expense",
    date: "2026-08-31",
    amount: 2.75,
    accountId: "9Myfxt1u4DExteuwwEgx",
    fromAccountId: "47Jq3VJAYxIZ84HWgIkc",
    toAccountId: "OQk5cWYP6pXP1HEC6Z9Z",
    category: "Alimentación",
    subcategory: "Almuerzos",
    description: "segundo"
  }),
  fjcmdUz3Dqt1DnJTGUDD: Object.freeze({
    id: "fjcmdUz3Dqt1DnJTGUDD",
    type: "expense",
    date: "2026-08-31",
    amount: 0.45,
    accountId: "EI0cx2IULsr6RooTzrJF",
    fromAccountId: "47Jq3VJAYxIZ84HWgIkc",
    toAccountId: "OQk5cWYP6pXP1HEC6Z9Z",
    category: "Transporte",
    subcategory: "Metro",
    description: "casa - Ejido"
  })
});

const text = value => String(value ?? "").trim();
const amountEqual = (a,b) => Math.abs(Number(a||0)-Number(b||0)) <= 0.005;

export function hasResidualTransferAccountRefs(tx={}){
  return text(tx.type)==="expense" && (!!text(tx.fromAccountId) || !!text(tx.toAccountId));
}

export function validateMig005Signature(tx={}){
  const expected=MIG005_EXPECTED[text(tx.id)];
  if(!expected) return {ok:false,issues:["ID no auditado"],expected:null};

  const issues=[];
  if(text(tx.type)!==expected.type) issues.push("tipo");
  if(text(tx.date)!==expected.date) issues.push("fecha");
  if(!amountEqual(tx.amount,expected.amount)) issues.push("monto");
  if(text(tx.accountId)!==expected.accountId) issues.push("cuenta principal");
  if(text(tx.category)!==expected.category) issues.push("categoría");
  if(text(tx.subcategory)!==expected.subcategory) issues.push("subcategoría");
  if(text(tx.description)!==expected.description) issues.push("descripción");

  const from=text(tx.fromAccountId),to=text(tx.toAccountId);
  if(from && from!==expected.fromAccountId) issues.push("fromAccountId");
  if(to && to!==expected.toAccountId) issues.push("toAccountId");
  if(!from && !to) issues.push("sin referencias residuales");

  return {ok:issues.length===0,issues,expected};
}

export function isAuditedMig005Candidate(tx={}){
  return hasResidualTransferAccountRefs(tx) && validateMig005Signature(tx).ok;
}

export function classifyMig005Rows(transactions=[]){
  const residual=(transactions||[]).filter(hasResidualTransferAccountRefs);
  const candidates=[],mismatched=[],unexpected=[];
  for(const tx of residual){
    const expected=MIG005_EXPECTED[text(tx.id)];
    if(!expected){unexpected.push(tx);continue;}
    const validation=validateMig005Signature(tx);
    if(validation.ok)candidates.push(tx);
    else mismatched.push({...tx,mig005Issues:validation.issues});
  }
  return {
    residual,candidates,mismatched,unexpected,
    safe:candidates.length>0 && mismatched.length===0 && unexpected.length===0
  };
}
