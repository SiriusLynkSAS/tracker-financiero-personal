function normalize(value){
  return String(value??"").trim().toLowerCase().normalize("NFD").replace(/\p{M}+/gu,"");
}

export function isUnclassifiedSplit(split){
  return normalize(split?.category)==="por clasificar";
}

/**
 * Reconoce ajustes de conciliación actuales y heredados.
 * La bandera booleana es la señal principal, pero versiones/datos antiguos
 * pueden conservar únicamente reconciliationId o la descripción canónica.
 */
export function isReconciliationAdjustment(tx){
  const explicit=tx?.reconciliationAdjustment===true;
  const linked=String(tx?.reconciliationId??"").trim()!=="";
  const description=normalize(tx?.description);
  const canonicalDescription=description.startsWith("ajuste de conciliacion");
  return explicit || linked || canonicalDescription;
}

// Un ajuste de conciliación corrige el saldo, pero nunca representa una
// operación económica nueva. No entra en ingresos, gastos ni proyecciones,
// independientemente de si está pendiente, aprobado o clasificado.
export function analyticSplits(tx){
  if(isReconciliationAdjustment(tx)) return [];
  return Array.isArray(tx?.splits)?tx.splits:[];
}

export function analyticAmount(tx){
  if(isReconciliationAdjustment(tx)) return 0;
  return Number(tx?.amount||0);
}

export function analyticTransaction(tx){
  if(isReconciliationAdjustment(tx)) return null;
  const amount=analyticAmount(tx);
  if(amount<=0.009) return null;
  return tx;
}

export function analyticTransactions(rows=[]){
  return rows.map(analyticTransaction).filter(Boolean);
}
