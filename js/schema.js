// Modelo canónico y compatibilidad legacy — V1.0.50
// Principio: leer tolerante, escribir canónico. Este módulo NO migra Firestore por sí solo.

export const SCHEMA_VERSION=2;

const has=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const text=v=>v===null||v===undefined?"":String(v).trim();
const finite=(v,fallback=0)=>{const n=Number(v);return Number.isFinite(n)?n:fallback};
const nonNegative=(v,fallback=0)=>Math.max(0,finite(v,fallback));
const integer=(v,fallback=0)=>Math.trunc(finite(v,fallback));
const nullableText=v=>{const s=text(v);return s||null};
const isoDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(text(v));
const yearMonth=v=>/^\d{4}-\d{2}$/.test(text(v));
const isoDateTime=v=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text(v));

export const TRANSACTION_TYPES=new Set([
  "income","expense","transfer","investment_out","investment_return",
  "work_expense","work_reimbursement","work_advance","work_advance_return"
]);

export function normalizeAccount(raw={}){
  return {
    ...raw,
    schemaVersion:integer(raw.schemaVersion,0),
    bank:text(raw.bank),
    alias:text(raw.alias),
    accountType:text(raw.accountType)||"savings",
    openingBalance:finite(raw.openingBalance,0),
    openingBalanceAsOf:text(raw.openingBalanceAsOf||raw.ledgerStartDate),
    legacyOpeningBalanceAsOfMissing:!text(raw.openingBalanceAsOf||raw.ledgerStartDate),
    creditLimit:nonNegative(raw.creditLimit,0),
    active:raw.active!==false
  };
}

export function sanitizeAccountWrite(raw={}){
  const accountType=text(raw.accountType)||"savings";
  if(!["savings","checking","credit_card","cash"].includes(accountType)) throw new Error("Tipo de cuenta no válido.");
  if(!text(raw.bank)) throw new Error("Ingresa la institución o banco.");
  if(!text(raw.alias)) throw new Error("Ingresa el nombre de la cuenta.");
  const openingBalance=finite(raw.openingBalance,NaN);
  if(!Number.isFinite(openingBalance)) throw new Error("Saldo inicial no válido.");
  return {
    ...raw,
    schemaVersion:SCHEMA_VERSION,
    bank:text(raw.bank),alias:text(raw.alias),accountType,openingBalance,
    openingBalanceAsOf:text(raw.openingBalanceAsOf||raw.ledgerStartDate),
    creditLimit:nonNegative(raw.creditLimit,0),
    active:raw.active!==false
  };
}

export function legacyVatAmbiguous(raw={}){
  if(has(raw,"hasInvoice")) return false;
  const vat=nonNegative(raw.vat,0),amount=nonNegative(raw.amount,0);
  return vat>0 && amount>0 && Math.abs(vat-amount)<=0.009;
}

export function normalizeTransaction(raw={}){
  const amount=nonNegative(raw.amount,0);
  const rawVat=nonNegative(raw.vat,0);
  const ambiguousVat=legacyVatAmbiguous(raw);
  const vat=ambiguousVat?0:rawVat;
  const explicitInvoice=has(raw,"hasInvoice")?raw.hasInvoice===true:null;
  const invoice=ambiguousVat?false:(explicitInvoice===null?vat>0:explicitInvoice);
  const feeAmount=nonNegative(raw.feeAmount,0);
  const taxAmount=nonNegative(raw.taxAmount,0);
  const otherChargeAmount=nonNegative(raw.otherChargeAmount,0);
  const grossStored=nonNegative(raw.grossDebitAmount,0);
  const dt=text(raw.transactionDateTime);
  const date=text(raw.date);
  return {
    ...raw,
    schemaVersion:integer(raw.schemaVersion,0),
    type:TRANSACTION_TYPES.has(text(raw.type))?text(raw.type):"expense",
    date,
    transactionDateTime:dt||(date?`${date}T00:00`:""),
    dateTimeInferred:!dt,
    description:text(raw.description),receipt:text(raw.receipt),
    amount,vat,
    legacyVatRaw:ambiguousVat?rawVat:0,
    legacyVatAmbiguous:ambiguousVat,
    hasInvoice:invoice,
    invoiceNumber:invoice?text(raw.invoiceNumber||raw.receipt):"",
    invoiceBase:invoice?nonNegative(raw.invoiceBase,Math.max(0,amount-vat)):0,
    taxPeriod:invoice?text(raw.taxPeriod||(date?date.slice(0,7):"")):"",
    taxPaymentId:text(raw.taxPaymentId),
    vatStatus:ambiguousVat?"legacy_unknown":(invoice?text(raw.vatStatus)||(raw.taxPaymentId?"paid":"pending"):"none"),
    accountId:text(raw.accountId),fromAccountId:text(raw.fromAccountId),toAccountId:text(raw.toAccountId),
    category:text(raw.category),subcategory:text(raw.subcategory),
    financingPlanId:text(raw.financingPlanId),
    businessTripId:text(raw.businessTripId),tripExpenseId:text(raw.tripExpenseId),tripSettlementId:text(raw.tripSettlementId),
    reconciliationId:text(raw.reconciliationId),liabilityId:text(raw.liabilityId),debtPaymentId:text(raw.debtPaymentId),
    recurringId:text(raw.recurringId),recurringOccurrence:text(raw.recurringOccurrence),recurringScheduledDate:text(raw.recurringScheduledDate),
    investmentId:text(raw.investmentId),contractPaymentId:text(raw.contractPaymentId),settlementId:text(raw.settlementId),
    feeAmount,taxAmount,otherChargeAmount,
    grossDebitAmount:grossStored>0?grossStored:amount+feeAmount+taxAmount+otherChargeAmount,
    splits:Array.isArray(raw.splits)?raw.splits:[]
  };
}

export function sanitizeTransactionWrite(raw={}){
  const row=normalizeTransaction(raw);
  if(!TRANSACTION_TYPES.has(row.type)) throw new Error("Tipo de movimiento no válido.");
  if(!isoDate(row.date)) throw new Error("Fecha de movimiento no válida.");
  if(!(row.amount>0)) throw new Error("El monto debe ser mayor que cero.");
  if(!Number.isFinite(Number(raw.amount))) throw new Error("Monto no válido.");

  if(row.type==="transfer"){
    if(!row.fromAccountId||!row.toAccountId) throw new Error("Selecciona las cuentas origen y destino.");
    if(row.fromAccountId===row.toAccountId) throw new Error("La cuenta origen y destino deben ser diferentes.");
    row.accountId="";
  }else{
    if(!row.accountId) throw new Error("Selecciona una cuenta.");
    row.fromAccountId="";row.toAccountId="";
  }

  const dt=text(raw.transactionDateTime)||(row.date?`${row.date}T00:00`:"");
  if(dt && !isoDateTime(dt)) throw new Error("Fecha y hora del movimiento no válidas.");

  const out={
    ...raw,
    schemaVersion:SCHEMA_VERSION,
    type:row.type,date:row.date,transactionDateTime:dt,
    description:row.description,receipt:row.receipt,amount:row.amount,vat:row.vat,
    accountId:nullableText(row.accountId),fromAccountId:nullableText(row.fromAccountId),toAccountId:nullableText(row.toAccountId),
    category:row.category,subcategory:row.subcategory,
    financingPlanId:nullableText(row.financingPlanId),
    installmentNumber:raw.installmentNumber??null,
    hasInvoice:row.hasInvoice,invoiceNumber:row.invoiceNumber,invoiceBase:row.invoiceBase,taxPeriod:row.taxPeriod,
    taxPaymentId:nullableText(row.taxPaymentId),vatStatus:row.vatStatus==="legacy_unknown"?"none":row.vatStatus,
    splits:row.splits,
    businessTripId:nullableText(row.businessTripId),tripExpenseId:nullableText(row.tripExpenseId),tripSettlementId:nullableText(row.tripSettlementId),
    reconciliationAdjustment:raw.reconciliationAdjustment===true,classificationStatus:text(raw.classificationStatus),
    recoveryStart:text(raw.recoveryStart),recoveryEnd:text(raw.recoveryEnd),reconciliationId:nullableText(row.reconciliationId),
    liabilityId:nullableText(row.liabilityId),debtPaymentId:nullableText(row.debtPaymentId),
    feeAmount:row.feeAmount,taxAmount:row.taxAmount,otherChargeAmount:row.otherChargeAmount,grossDebitAmount:row.grossDebitAmount,
    recurringId:nullableText(row.recurringId),recurringOccurrence:nullableText(row.recurringOccurrence),recurringScheduledDate:nullableText(row.recurringScheduledDate),
    investmentId:nullableText(row.investmentId),contractPaymentId:nullableText(row.contractPaymentId),settlementId:nullableText(row.settlementId)
  };
  delete out.legacyVatRaw;delete out.legacyVatAmbiguous;delete out.dateTimeInferred;
  return out;
}

export function normalizeBudget(raw={}){
  const month=text(raw.month);
  return {...raw,schemaVersion:integer(raw.schemaVersion,0),category:text(raw.category),subcategory:text(raw.subcategory),limit:nonNegative(raw.limit,0),month,rollover:raw.rollover===true,legacyPeriodMissing:!yearMonth(month)};
}
export function sanitizeBudgetWrite(raw={}){
  const month=text(raw.month);
  if(!text(raw.category)||!text(raw.subcategory)) throw new Error("Selecciona categoría y subcategoría.");
  if(!yearMonth(month)) throw new Error("Usa un mes válido YYYY-MM.");
  const limit=finite(raw.limit,NaN);if(!Number.isFinite(limit)||limit<0) throw new Error("Límite de presupuesto no válido.");
  return {...raw,schemaVersion:SCHEMA_VERSION,category:text(raw.category),subcategory:text(raw.subcategory),limit,month,rollover:raw.rollover===true};
}

export function normalizeRecurring(raw={}){
  const type=({ingreso:"income",income:"income",egreso:"expense",expense:"expense"})[text(raw.type).toLowerCase()]||"expense";
  return {...raw,schemaVersion:integer(raw.schemaVersion,0),name:text(raw.name),type,amount:nonNegative(raw.amount,0),accountId:text(raw.accountId),category:text(raw.category),subcategory:text(raw.subcategory),dayOfMonth:Math.min(31,Math.max(1,integer(raw.dayOfMonth,1))),reminderDaysBefore:Math.min(90,Math.max(0,integer(raw.reminderDaysBefore,3))),startDate:text(raw.startDate),endDate:text(raw.endDate),active:raw.active!==false};
}
export function sanitizeRecurringWrite(raw={}){
  const row=normalizeRecurring(raw);
  if(!row.name) throw new Error("Ingresa el nombre del recurrente.");
  if(!(row.amount>0)) throw new Error("El monto debe ser mayor que cero.");
  if(!row.accountId) throw new Error("Selecciona una cuenta.");
  if(row.startDate&&!isoDate(row.startDate)) throw new Error("Fecha inicial no válida.");
  if(row.endDate&&!isoDate(row.endDate)) throw new Error("Fecha final no válida.");
  return {...raw,...row,schemaVersion:SCHEMA_VERSION};
}

function lifecycleStatus(rawStatus,active,inactiveFallback="archived"){
  const status=text(rawStatus)||"active";
  return !active&&status==="active"?inactiveFallback:status;
}
export function normalizeLiability(raw={}){
  const active=raw.active!==false;
  const rawStatus=text(raw.status)||"active";
  return {...raw,schemaVersion:integer(raw.schemaVersion,0),status:lifecycleStatus(rawStatus,active,"archived"),active,legacyStatusConflict:!active&&rawStatus==="active"};
}
export function sanitizeLiabilityWrite(raw={}){
  const active=raw.active!==false;
  const allowed=new Set(["active","paid_off","cancelled","archived"]);
  let status=text(raw.status)||"active";
  if(!active&&status==="active") status="archived";
  if(!allowed.has(status)) throw new Error("Estado de deuda no válido.");
  return {...raw,schemaVersion:SCHEMA_VERSION,status,active};
}
export function normalizeFinancingPlan(raw={}){
  const active=raw.active!==false;const rawStatus=text(raw.status)||"active";
  return {...raw,schemaVersion:integer(raw.schemaVersion,0),status:lifecycleStatus(rawStatus,active,"archived"),active,legacyStatusConflict:!active&&rawStatus==="active"};
}
export function sanitizeFinancingPlanWrite(raw={}){
  const active=raw.active!==false;let status=text(raw.status)||"active";
  if(!active&&status==="active") status="archived";
  if(!["active","paid_off","cancelled","archived"].includes(status)) throw new Error("Estado de plan no válido.");
  return {...raw,schemaVersion:SCHEMA_VERSION,status,active};
}

export function normalizeContract(raw={}){
  return {...raw,schemaVersion:integer(raw.schemaVersion,0),name:text(raw.name),startDate:text(raw.startDate),endDate:text(raw.endDate),active:raw.active!==false,status:text(raw.status)||(raw.active===false?"completed":"active")};
}
export function sanitizeContractWrite(raw={}){
  return {...raw,schemaVersion:SCHEMA_VERSION,name:text(raw.name),startDate:text(raw.startDate),endDate:text(raw.endDate),active:raw.active!==false};
}
export function normalizeReceivable(raw={}){
  return {...raw,schemaVersion:integer(raw.schemaVersion,0),contractId:text(raw.contractId),workPeriod:text(raw.workPeriod),amount:nonNegative(raw.amount,0),paidAmount:nonNegative(raw.paidAmount,0),dueDate:text(raw.dueDate),status:text(raw.status)||"pending",active:raw.active!==false};
}
export function sanitizeReceivableWrite(raw={}){
  const amount=nonNegative(raw.amount,0),paidAmount=nonNegative(raw.paidAmount,0);
  if(paidAmount>amount+0.009) throw new Error("El valor cobrado no puede superar el valor por cobrar.");
  return {...raw,schemaVersion:SCHEMA_VERSION,contractId:text(raw.contractId),workPeriod:text(raw.workPeriod),amount,paidAmount,dueDate:text(raw.dueDate),status:text(raw.status)||"pending",active:raw.active!==false};
}

export function normalizeInvestment(raw={}){
  const active=raw.active!==false;
  const rawStatus=text(raw.status)||(active?"active":"legacy_inactive");
  const status=!active&&rawStatus==="active"?"legacy_inactive":rawStatus;
  const principal=nonNegative(raw.principal??raw.amount,0);
  const annualRate=nonNegative(raw.annualRate??raw.rate,0);
  return {
    ...raw,schemaVersion:integer(raw.schemaVersion,0),bank:text(raw.bank),name:text(raw.name),principal,annualRate,
    rateType:text(raw.rateType)||"nominal",calculation:text(raw.calculation)||"compound",capitalization:text(raw.capitalization)||"monthly",
    startDate:text(raw.startDate),termValue:nonNegative(raw.termValue,0),termUnit:text(raw.termUnit)||"months",maturityDate:text(raw.maturityDate),
    withholding:nonNegative(raw.withholding,0),fees:nonNegative(raw.fees,0),sourceAccountId:text(raw.sourceAccountId),
    capitalMovementMode:text(raw.capitalMovementMode)||"historical",reminderDaysBefore:Math.min(365,Math.max(0,integer(raw.reminderDaysBefore,0))),
    status,active,legacyStatusConflict:(!active&&rawStatus==="active")||(!has(raw,"status"))
  };
}
export function sanitizeInvestmentWrite(raw={}){
  const row=normalizeInvestment(raw);
  if(!row.bank||!row.name) throw new Error("Completa banco y nombre de la inversión.");
  if(!(row.principal>0)) throw new Error("El capital debe ser mayor que cero.");
  if(!["nominal","effective"].includes(row.rateType)) throw new Error("Tipo de tasa no válido.");
  if(!["simple","compound"].includes(row.calculation)) throw new Error("Tipo de cálculo no válido.");
  if(!["monthly","quarterly","semiannual","annual"].includes(row.capitalization)) throw new Error("Capitalización no válida.");
  if(!isoDate(row.startDate)) throw new Error("Fecha inicial no válida.");
  if(!(row.termValue>0)||!["days","months","years"].includes(row.termUnit)) throw new Error("Plazo no válido.");
  if(row.maturityDate&&!isoDate(row.maturityDate)) throw new Error("Fecha de vencimiento no válida.");
  if(!["automatic","linked_existing","historical","already_registered"].includes(row.capitalMovementMode)) throw new Error("Modo de capital no válido.");
  if(!["active","liquidated","renewed","cancelled","legacy_inactive"].includes(row.status)) throw new Error("Estado de inversión no válido.");
  return {...raw,...row,schemaVersion:SCHEMA_VERSION};
}

export function canonicalStamp(raw={}){
  const out={...raw,schemaVersion:SCHEMA_VERSION};
  delete out.legacyVatRaw;delete out.legacyVatAmbiguous;delete out.dateTimeInferred;
  delete out.legacyStatusConflict;delete out.legacyPeriodMissing;delete out.legacyOpeningBalanceAsOfMissing;
  return out;
}
