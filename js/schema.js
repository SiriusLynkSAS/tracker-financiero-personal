import {resolveInstitutionIdentity} from "./institutions.js";
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
    institutionId:text(raw.institutionId),
    institutionDisplayName:text(raw.institutionDisplayName),
    institutionIdentitySource:text(raw.institutionIdentitySource),
    alias:text(raw.alias),
    accountType:text(raw.accountType)||"savings",
    last4:text(raw.last4).replace(/\D/g,"").slice(-4),
    openingBalance:finite(raw.openingBalance,0),
    openingBalanceAsOf:text(raw.openingBalanceAsOf||raw.ledgerStartDate),
    ledgerStartDate:text(raw.ledgerStartDate||raw.openingBalanceAsOf),
    openingBalanceDateSource:text(raw.openingBalanceDateSource),
    legacyOpeningBalanceAsOfMissing:!text(raw.openingBalanceAsOf||raw.ledgerStartDate),
    creditLimit:nonNegative(raw.creditLimit,0),
    closingDay:raw.closingDay===null||raw.closingDay===undefined?null:Math.min(31,Math.max(1,integer(raw.closingDay,1))),
    paymentDay:raw.paymentDay===null||raw.paymentDay===undefined?null:Math.min(31,Math.max(1,integer(raw.paymentDay,1))),
    reminderDaysBefore:raw.reminderDaysBefore===null||raw.reminderDaysBefore===undefined?null:Math.min(30,Math.max(0,integer(raw.reminderDaysBefore,3))),
    statementBalance:nonNegative(raw.statementBalance,0),
    minimumPayment:nonNegative(raw.minimumPayment,0),
    active:raw.active!==false
  };
}

export function sanitizeAccountWrite(raw={}){
  const accountType=text(raw.accountType)||"savings";
  if(!["savings","checking","credit_card","cash"].includes(accountType)) throw new Error("Tipo de cuenta no válido.");
  if(!text(raw.bank)) throw new Error("Ingresa la institución o banco.");
  if(!text(raw.alias)) throw new Error("Ingresa el nombre de la cuenta.");
  const last4=text(raw.last4);
  if(last4 && !/^\d{1,4}$/.test(last4)) throw new Error("Los últimos 4 dígitos deben contener solo números.");
  const openingBalance=finite(raw.openingBalance,NaN);
  if(!Number.isFinite(openingBalance)) throw new Error("Saldo inicial no válido.");
  const openingBalanceAsOf=text(raw.openingBalanceAsOf||raw.ledgerStartDate);
  if(openingBalanceAsOf && !isoDate(openingBalanceAsOf)) throw new Error("Fecha base del saldo inicial no válida.");
  const institution=resolveInstitutionIdentity(text(raw.bank),text(raw.institutionId),text(raw.institutionDisplayName));
  const card=accountType==="credit_card";
  let closingDay=null,paymentDay=null,reminderDaysBefore=null;
  if(card){
    closingDay=Number(raw.closingDay);
    paymentDay=Number(raw.paymentDay);
    reminderDaysBefore=Number(raw.reminderDaysBefore);
    if(!Number.isInteger(closingDay)||closingDay<1||closingDay>31) throw new Error("El día de corte debe estar entre 1 y 31.");
    if(!Number.isInteger(paymentDay)||paymentDay<1||paymentDay>31) throw new Error("El día de pago debe estar entre 1 y 31.");
    if(!Number.isInteger(reminderDaysBefore)||reminderDaysBefore<0||reminderDaysBefore>30) throw new Error("El recordatorio debe estar entre 0 y 30 días.");
  }
  return {
    ...raw,
    schemaVersion:SCHEMA_VERSION,
    bank:text(raw.bank),institutionId:institution.institutionId||null,institutionDisplayName:institution.displayName||null,institutionIdentitySource:text(raw.institutionIdentitySource)||(institution.matched?"catalog_known_alias":""),alias:text(raw.alias),accountType,last4,openingBalance,
    openingBalanceAsOf,
    ledgerStartDate:openingBalanceAsOf,
    openingBalanceDateSource:text(raw.openingBalanceDateSource),
    creditLimit:card?nonNegative(raw.creditLimit,0):0,
    closingDay,paymentDay,reminderDaysBefore,
    statementBalance:card?nonNegative(raw.statementBalance,0):0,
    minimumPayment:card?nonNegative(raw.minimumPayment,0):0,
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
    transactionDateTime:dt,
    dateTimeInferred:!dt,
    description:text(raw.description),receipt:text(raw.receipt),
    amount,vat,
    legacyVatRaw:nonNegative(raw.legacyVatRaw,ambiguousVat?rawVat:0),
    legacyVatAmbiguous:ambiguousVat,
    legacyVatResolution:text(raw.legacyVatResolution),
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
    mig010Resolution:text(raw.mig010Resolution),
    investmentId:text(raw.investmentId),contractPaymentId:text(raw.contractPaymentId),settlementId:text(raw.settlementId),
    insuranceUsageId:text(raw.insuranceUsageId),insurancePolicyId:text(raw.insurancePolicyId),
    contractId:text(raw.contractId),
    contractAllocations:Array.isArray(raw.contractAllocations)?raw.contractAllocations.map(a=>({
      receivableId:text(a?.receivableId),contractId:text(a?.contractId),workPeriod:text(a?.workPeriod),amount:nonNegative(a?.amount,0)
    })).filter(a=>a.receivableId&&a.amount>0):[],
    invoiceId:text(raw.invoiceId),invoicePaymentId:text(raw.invoicePaymentId),
    economicAmount:nonNegative(raw.economicAmount,0),invoiceVatComponent:nonNegative(raw.invoiceVatComponent,0),
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

  const dt=text(raw.transactionDateTime);
  if(dt && !isoDateTime(dt)) throw new Error("Fecha y hora del movimiento no válidas.");
  if(dt && dt.slice(0,10)!==row.date) throw new Error("La fecha del movimiento y transactionDateTime no coinciden.");

  const out={
    ...raw,
    schemaVersion:SCHEMA_VERSION,
    type:row.type,date:row.date,
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
    mig010Resolution:nullableText(row.mig010Resolution),
    investmentId:nullableText(row.investmentId),contractPaymentId:nullableText(row.contractPaymentId),settlementId:nullableText(row.settlementId),
    insuranceUsageId:nullableText(row.insuranceUsageId),insurancePolicyId:nullableText(row.insurancePolicyId),
    contractId:nullableText(row.contractId),contractAllocations:row.contractAllocations,
    invoiceId:nullableText(row.invoiceId),invoicePaymentId:nullableText(row.invoicePaymentId),
    economicAmount:row.economicAmount>0?row.economicAmount:0,invoiceVatComponent:row.invoiceVatComponent>0?row.invoiceVatComponent:0
  };
  if(dt) out.transactionDateTime=dt; else delete out.transactionDateTime;
  delete out.legacyVatRaw;delete out.legacyVatAmbiguous;delete out.dateTimeInferred;
  return out;
}

export function normalizeInvoice(raw={}){
  const baseAmount=nonNegative(raw.baseAmount,0);
  const vatAmount=nonNegative(raw.vatAmount,0);
  const totalAmount=nonNegative(raw.totalAmount,baseAmount+vatAmount);
  const paidAmount=Math.min(nonNegative(raw.paidAmount,0),totalAmount);
  const paidBaseAmount=Math.min(nonNegative(raw.paidBaseAmount,0),baseAmount);
  const paidVatAmount=Math.min(nonNegative(raw.paidVatAmount,Math.max(0,paidAmount-paidBaseAmount)),vatAmount);
  const dueDate=text(raw.dueDate);
  const today=new Date();
  const todayIso=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  let status=text(raw.status)||"pending";
  if(raw.active===false||status==="void") status="void";
  else if(totalAmount>0&&paidAmount>=totalAmount-.009) status="paid";
  else if(paidAmount>.009) status="partial";
  else if(dueDate&&dueDate<todayIso) status="overdue";
  else status="pending";
  return {
    ...raw,schemaVersion:integer(raw.schemaVersion,0),
    invoiceNumber:text(raw.invoiceNumber),customerName:text(raw.customerName),customerId:text(raw.customerId),
    issueDate:text(raw.issueDate),dueDate,concept:text(raw.concept),notes:text(raw.notes),
    calculationMode:["base_plus_vat","total_includes_vat"].includes(text(raw.calculationMode))?text(raw.calculationMode):"base_plus_vat",
    vatRate:nonNegative(raw.vatRate,13),baseAmount,vatAmount,totalAmount,paidAmount,paidBaseAmount,paidVatAmount,status,active:raw.active!==false,
    contractId:text(raw.contractId),receivableId:text(raw.receivableId),taxPeriod:text(raw.taxPeriod||(text(raw.issueDate).slice(0,7))),
    vatStatus:text(raw.vatStatus)||(vatAmount>0?"pending":"none"),taxPaymentId:text(raw.taxPaymentId)
  };
}

export function sanitizeInvoiceWrite(raw={}){
  const row=normalizeInvoice(raw);
  if(!row.invoiceNumber) throw new Error("Ingresa el código de factura.");
  if(!row.customerName) throw new Error("Ingresa el cliente.");
  if(!row.concept) throw new Error("Ingresa el concepto facturado.");
  if(!isoDate(row.issueDate)) throw new Error("Fecha de emisión no válida.");
  if(!isoDate(row.dueDate)) throw new Error("Fecha de vencimiento no válida.");
  if(row.dueDate<row.issueDate) throw new Error("El vencimiento no puede ser anterior a la emisión.");
  if(!(row.baseAmount>=0)||!(row.vatAmount>=0)||!(row.totalAmount>0)) throw new Error("Valores de factura no válidos.");
  if(Math.abs((row.baseAmount+row.vatAmount)-row.totalAmount)>.02) throw new Error("Base + IVA no coincide con el total.");
  if(row.vatRate<0||row.vatRate>100) throw new Error("Tarifa IVA no válida.");
  if(row.paidAmount<0||row.paidAmount>row.totalAmount+.009) throw new Error("Cobrado no válido.");
  return {
    ...raw,schemaVersion:SCHEMA_VERSION,invoiceNumber:row.invoiceNumber,customerName:row.customerName,customerId:row.customerId,
    issueDate:row.issueDate,dueDate:row.dueDate,concept:row.concept,notes:row.notes,calculationMode:row.calculationMode,
    vatRate:row.vatRate,baseAmount:row.baseAmount,vatAmount:row.vatAmount,totalAmount:row.totalAmount,paidAmount:row.paidAmount,
    paidBaseAmount:row.paidBaseAmount,paidVatAmount:row.paidVatAmount,status:row.status,active:row.active,contractId:nullableText(row.contractId),receivableId:nullableText(row.receivableId),
    taxPeriod:row.taxPeriod,vatStatus:row.vatStatus,taxPaymentId:nullableText(row.taxPaymentId)
  };
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
  const {id:_redundantId,...source}=raw||{};
  const amount=nonNegative(source.amount,0),paidAmount=nonNegative(source.paidAmount,0);
  if(paidAmount>amount+0.009) throw new Error("El valor cobrado no puede superar el valor por cobrar.");
  return {...source,schemaVersion:SCHEMA_VERSION,contractId:text(source.contractId),workPeriod:text(source.workPeriod),amount,paidAmount,dueDate:text(source.dueDate),status:text(source.status)||"pending",active:source.active!==false};
}

export function normalizeInvestment(raw={}){
  const active=raw.active!==false;
  const rawStatus=text(raw.status)||(active?"active":"legacy_inactive");
  const status=!active&&rawStatus==="active"?"legacy_inactive":rawStatus;
  const principal=nonNegative(raw.principal??raw.amount,0);
  const annualRate=nonNegative(raw.annualRate??raw.rate,0);
  return {
    ...raw,schemaVersion:integer(raw.schemaVersion,0),bank:text(raw.bank),institutionId:text(raw.institutionId),institutionDisplayName:text(raw.institutionDisplayName),name:text(raw.name),principal,annualRate,
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
  const institution=resolveInstitutionIdentity(row.bank,row.institutionId,row.institutionDisplayName);
  return {...raw,...row,institutionId:institution.institutionId||null,institutionDisplayName:institution.displayName||null,schemaVersion:SCHEMA_VERSION};
}

export function canonicalStamp(raw={}){
  const out={...raw,schemaVersion:SCHEMA_VERSION};
  delete out.legacyVatRaw;delete out.legacyVatAmbiguous;delete out.dateTimeInferred;
  delete out.legacyStatusConflict;delete out.legacyPeriodMissing;delete out.legacyOpeningBalanceAsOfMissing;
  return out;
}
