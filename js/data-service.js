import {
  collection, doc, addDoc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import {contractPeriodCalculation,contractDesiredStopMonth} from "./contract-math.js";

function uid(){
  const v=auth.currentUser?.uid;
  if(!v) throw new Error("Usuario no autenticado.");
  return v;
}
function col(n){return collection(db,"users",uid(),n)}
function ref(n,id){return doc(db,"users",uid(),n,id)}
function compactSnapshot(o){
  if(!o || typeof o!=="object") return o;
  const out={};
  for(const [k,v] of Object.entries(o)){
    if(["createdAt","updatedAt"].includes(k)) continue;
    if(["schedule","events","usageEvents"].includes(k) && Array.isArray(v)){
      out[k]={itemCount:v.length};
      continue;
    }
    if(k==="tariffPeriods" && Array.isArray(v)){
      out[k]=v.slice(-12);
      continue;
    }
    out[k]=v;
  }
  return out;
}
function auditPayload(entityType,entityId,action,before=null,after=null,note=""){
  return {
    entityType,entityId,action,
    before:compactSnapshot(before),
    after:compactSnapshot(after),
    note,
    userEmail:auth.currentUser?.email||"",
    createdAt:serverTimestamp()
  };
}
export async function ensureUserProfile(){
  const r=doc(db,"users",uid()),s=await getDoc(r);
  if(!s.exists()) await setDoc(r,{email:auth.currentUser?.email||"",role:"owner",createdAt:serverTimestamp()});
}
export async function listEntities(n,order=null){
  const q=order?query(col(n),orderBy(order)):col(n),s=await getDocs(q);
  return s.docs.map(d=>({id:d.id,...d.data()}));
}
export async function getEntity(n,id){
  const s=await getDoc(ref(n,id));
  return s.exists()?{id:s.id,...s.data()}:null;
}
export async function appendAudit(entityType,entityId,action,before=null,after=null,note=""){
  await addDoc(col("auditLog"),auditPayload(entityType,entityId,action,before,after,note));
}
export async function saveEntity(n,data,id=null,{auditType=n,note=""}={}){
  const batch=writeBatch(db);
  const entityRef=id?ref(n,id):doc(col(n));
  const entityId=entityRef.id;
  let old=null;
  if(id) old=await getEntity(n,id);
  const payload={...data,updatedAt:serverTimestamp()};
  if(id) batch.update(entityRef,payload);
  else batch.set(entityRef,{...payload,createdAt:serverTimestamp()});
  const auditRef=doc(col("auditLog"));
  batch.set(auditRef,auditPayload(auditType,entityId,id?"UPDATE":"CREATE",old,data,note));
  await batch.commit();
  return entityId;
}
export async function upsertEntity(n,id,data,{auditType=n,note=""}={}){
  const old=await getEntity(n,id);
  const batch=writeBatch(db);
  const entityRef=ref(n,id);
  const payload={...data,updatedAt:serverTimestamp()};
  if(old){
    batch.set(entityRef,payload,{merge:true});
  }else{
    batch.set(entityRef,{...payload,createdAt:serverTimestamp()});
  }
  batch.set(
    doc(col("auditLog")),
    auditPayload(auditType,id,old?"UPDATE":"CREATE",old,data,note)
  );
  await batch.commit();
  return id;
}

export async function archiveEntity(n,id,{auditType=n}={}){
  const old=await getEntity(n,id);
  const batch=writeBatch(db);
  batch.update(ref(n,id),{active:false,archivedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload(auditType,id,"ARCHIVE",old,{...old,active:false}));
  await batch.commit();
}
export async function reactivateEntity(n,id,{auditType=n}={}){
  const old=await getEntity(n,id);
  const batch=writeBatch(db);
  batch.update(ref(n,id),{active:true,updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload(auditType,id,"REACTIVATE",old,{...old,active:true}));
  await batch.commit();
}
export async function deleteEntity(n,id,{auditType=n}={}){
  const old=await getEntity(n,id);
  const batch=writeBatch(db);
  batch.delete(ref(n,id));
  batch.set(doc(col("auditLog")),auditPayload(auditType,id,"DELETE",old,null));
  await batch.commit();
}
export async function atomicWrite(ops=[]){
  if(!ops.length) return [];
  if(ops.length>220) throw new Error("Demasiadas operaciones para un único lote seguro.");
  const enriched=[];
  for(const op of ops){
    const entityRef=op.id?ref(op.collection,op.id):doc(col(op.collection));
    const old=op.id && op.action!=="create" ? await getEntity(op.collection,op.id) : null;
    enriched.push({...op,entityRef,entityId:entityRef.id,old});
  }
  const batch=writeBatch(db);
  for(const op of enriched){
    const auditType=op.auditType||op.collection;
    if(op.action==="delete"){
      batch.delete(op.entityRef);
    }else if(op.action==="update"){
      batch.update(op.entityRef,{...op.data,updatedAt:serverTimestamp()});
    }else{
      batch.set(op.entityRef,{...op.data,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    }
    batch.set(
      doc(col("auditLog")),
      auditPayload(
        auditType,
        op.entityId,
        op.action.toUpperCase(),
        op.old,
        op.action==="delete"?null:op.data,
        op.note||""
      )
    );
  }
  await batch.commit();
  return enriched.map(x=>x.entityId);
}

export const listAccounts=(o={includeArchived:true})=>listEntities("accounts","bank").then(r=>o.includeArchived?r:r.filter(x=>x.active!==false));
export const saveAccount=(d,id=null)=>saveEntity("accounts",d,id,{auditType:"account"});
export const archiveAccount=id=>archiveEntity("accounts",id,{auditType:"account"});
export const reactivateAccount=id=>reactivateEntity("accounts",id,{auditType:"account"});

function inferredReconciliationAdjustment(row){
  const description=String(row?.description||"").trim().toLowerCase()
    .normalize("NFD").replace(/\p{M}+/gu,"");
  return row?.reconciliationAdjustment===true ||
    String(row?.reconciliationId||"").trim()!=="" ||
    description.startsWith("ajuste de conciliacion");
}
function transactionSortKey(row){
  const dt=String(row?.transactionDateTime||"").trim();
  if(dt) return dt;
  const date=String(row?.date||"");
  const created=row?.createdAt?.toMillis?.() ?? row?.createdAt?.seconds*1000 ?? 0;
  return `${date}T${String(created).padStart(16,"0")}`;
}
export const listTransactions=()=>listEntities("transactions","date")
  .then(r=>r.map(row=>({
    ...row,
    transactionDateTime:String(row.transactionDateTime||"").trim() || (row.date?`${row.date}T00:00`:""),
    feeAmount:Math.max(0,Number(row.feeAmount||0)),
    taxAmount:Math.max(0,Number(row.taxAmount||0)),
    otherChargeAmount:Math.max(0,Number(row.otherChargeAmount||0)),
    grossDebitAmount:Math.max(0,Number(row.grossDebitAmount||0)),
    recurringId:String(row.recurringId||""),
    recurringOccurrence:String(row.recurringOccurrence||""),
    reconciliationAdjustment:inferredReconciliationAdjustment(row)
  })))
  .then(r=>r.sort((a,b)=>transactionSortKey(b).localeCompare(transactionSortKey(a))));
export async function saveTransaction(d,id=null){
  const old=id?await getEntity("transactions",id):null;
  const vat=Math.max(0,Number(d.vat||0));
  const invoice=!!d.hasInvoice || vat>0;
  const feeAmount=Math.max(0,Number(d.feeAmount||0));
  const taxAmount=Math.max(0,Number(d.taxAmount||0));
  const otherChargeAmount=Math.max(0,Number(d.otherChargeAmount||0));
  const grossDebitAmount=Math.max(0,Number(d.grossDebitAmount || (Number(d.amount||0)+feeAmount+taxAmount+otherChargeAmount)));
  const normalized={
    ...d,
    transactionDateTime:String(d.transactionDateTime||`${d.date||""}T00:00`),
    feeAmount,taxAmount,otherChargeAmount,grossDebitAmount,
    recurringId:String(d.recurringId||""),
    recurringOccurrence:String(d.recurringOccurrence||""),
    vat,
    hasInvoice:invoice,
    invoiceNumber:invoice?String(d.invoiceNumber||d.receipt||""):"",
    invoiceBase:invoice?Math.max(0,Number(d.amount||0)-vat):0,
    taxPeriod:invoice?String(d.taxPeriod||d.date||"").slice(0,7):"",
    taxPaymentId:String(d.taxPaymentId||""),
    vatStatus:invoice
      ? (d.taxPaymentId?"paid":String(d.vatStatus||"pending"))
      : "none"
  };
  const entityId=await saveEntity("transactions",normalized,id,{auditType:"transaction"});

  if(!normalized.reconciliationAdjustment){
    const accountIds=[...new Set([
      old?.accountId,old?.fromAccountId,old?.toAccountId,
      normalized.accountId,normalized.fromAccountId,normalized.toAccountId
    ].filter(Boolean))];
    const impactDate=old?.date && String(old.date)<String(normalized.date) ? old.date : normalized.date;
    if(accountIds.length && impactDate){
      await markReconciliationsNeedsReview(accountIds,impactDate,{
        excludeId:String(normalized.reconciliationId||""),
        reason:id?"movement_edited":"movement_created"
      });
    }
  }
  return entityId;
}
export async function removeTransaction(id){
  const row=await getEntity("transactions",id);
  if(row?.taxPaymentId){
    throw new Error("Este movimiento está vinculado a una liquidación de IVA y no puede eliminarse.");
  }
  if(row?.tripExpenseId || row?.tripSettlementId){
    throw new Error("Este movimiento está vinculado a una comisión de trabajo. Anúlalo desde Comisiones / Viáticos.");
  }
  if(row?.reconciliationAdjustment){
    throw new Error("Este movimiento pertenece a una conciliación. Modifícalo o reviértelo desde Conciliación.");
  }
  if(row?.debtPaymentId || row?.liabilityId){
    throw new Error("Este movimiento está vinculado a un pago de deuda. Modifícalo desde Deudas y tarjetas.");
  }
  await deleteEntity("transactions",id,{auditType:"transaction"});
  const accountIds=[...new Set([row?.accountId,row?.fromAccountId,row?.toAccountId].filter(Boolean))];
  if(accountIds.length && row?.date){
    await markReconciliationsNeedsReview(accountIds,row.date,{reason:"movement_deleted"});
  }
}

export const listCategories=()=>listEntities("categories");
export const saveCategory=(d,id=null)=>saveEntity("categories",d,id,{auditType:"category"});
export const removeCategory=id=>deleteEntity("categories",id,{auditType:"category"});
export const listBudgets=()=>listEntities("budgets");
export const saveBudget=(d,id=null)=>saveEntity("budgets",d,id,{auditType:"budget"});
export const removeBudget=id=>deleteEntity("budgets",id,{auditType:"budget"});
export const listMonthlyPlans=()=>listEntities("monthlyPlans");
export const saveMonthlyPlan=(d,id)=>upsertEntity("monthlyPlans",id||d.month,d,{auditType:"monthlyPlan"});
export const removeMonthlyPlan=id=>deleteEntity("monthlyPlans",id,{auditType:"monthlyPlan"});
export const listRecurring=()=>listEntities("recurring");
export const saveRecurring=(d,id=null)=>saveEntity("recurring",d,id,{auditType:"recurring"});
export const archiveRecurring=id=>archiveEntity("recurring",id,{auditType:"recurring"});
export function recurringOccurrenceId(recurringId,occurrence){
  return `recurring_${String(recurringId).replace(/[^A-Za-z0-9_-]/g,"_")}_${String(occurrence).replace(/[^0-9-]/g,"")}`;
}
export async function saveRecurringTransaction(recurring,occurrence,data){
  if(!recurring?.id) throw new Error("Recurrente no válido.");
  if(!/^\d{4}-\d{2}$/.test(String(occurrence||""))) throw new Error("Ocurrencia mensual no válida.");
  const id=recurringOccurrenceId(recurring.id,occurrence);
  const existing=await getEntity("transactions",id);
  if(existing) throw new Error("Este recurrente ya fue registrado para este mes.");
  const [year,month]=String(occurrence).split("-").map(Number);
  const maxDay=new Date(year,month,0).getDate();
  const scheduledDay=Math.min(Math.max(1,Number(recurring.dayOfMonth||1)),maxDay);
  const recurringScheduledDate=
    String(data.recurringScheduledDate||"") ||
    `${occurrence}-${String(scheduledDay).padStart(2,"0")}`;
  const payload={
    ...data,
    recurringId:recurring.id,
    recurringOccurrence:occurrence,
    recurringScheduledDate,
  };
  return upsertEntity("transactions",id,payload,{auditType:"transaction",note:`Ejecución recurrente ${occurrence}`});
}

export const listGoals=()=>listEntities("goals");
export const saveGoal=(d,id=null)=>saveEntity("goals",d,id,{auditType:"goal"});
export const archiveGoal=id=>archiveEntity("goals",id,{auditType:"goal"});
export const listLiabilities=()=>listEntities("liabilities");
export const saveLiability=(d,id=null)=>saveEntity("liabilities",d,id,{auditType:"liability"});
export const archiveLiability=id=>archiveEntity("liabilities",id,{auditType:"liability"});
export const reactivateLiability=id=>reactivateEntity("liabilities",id,{auditType:"liability"});
export const listFinancingPlans=()=>listEntities("financingPlans");
export const saveFinancingPlan=(d,id=null)=>saveEntity("financingPlans",d,id,{auditType:"financingPlan"});
export const archiveFinancingPlan=id=>archiveEntity("financingPlans",id,{auditType:"financingPlan"});
export const listInsurance=()=>listEntities("insurance");
export const saveInsurance=(d,id=null)=>saveEntity("insurance",d,id,{auditType:"insurance"});
export const archiveInsurance=id=>archiveEntity("insurance",id,{auditType:"insurance"});
export const listAssets=()=>listEntities("assets");
export const saveAsset=(d,id=null)=>saveEntity("assets",d,id,{auditType:"asset"});
export const archiveAsset=id=>archiveEntity("assets",id,{auditType:"asset"});
export const listContracts=()=>listEntities("contracts");
export const saveContract=(d,id=null)=>saveEntity("contracts",d,id,{auditType:"contract"});
export const archiveContract=id=>archiveEntity("contracts",id,{auditType:"contract"});
export const listReceivables=()=>listEntities("receivables");
export const saveReceivable=(d,id=null)=>saveEntity("receivables",d,id,{auditType:"receivable"});
export const listInvestments=()=>listEntities("investments");
export const saveInvestment=(d,id=null)=>saveEntity("investments",d,id,{auditType:"investment"});
export const archiveInvestment=id=>archiveEntity("investments",id,{auditType:"investment"});
export const listBusinessTrips=()=>listEntities("businessTrips","startDate")
  .then(r=>r.sort((a,b)=>String(b.startDate).localeCompare(String(a.startDate))));
export const saveBusinessTrip=(d,id=null)=>saveEntity("businessTrips",d,id,{auditType:"businessTrip"});
export const archiveBusinessTrip=id=>archiveEntity("businessTrips",id,{auditType:"businessTrip"});

export const listTripExpenses=()=>listEntities("tripExpenses","date")
  .then(r=>r.sort((a,b)=>String(b.date).localeCompare(String(a.date))));
export const listTripSettlements=()=>listEntities("tripSettlements","date")
  .then(r=>r.sort((a,b)=>String(b.date).localeCompare(String(a.date))));

function tripTxBase({type,date,amount,description,accountId,tripId,tripExpenseId="",tripSettlementId=""}){
  return {
    type,date,amount:Number(amount||0),vat:0,receipt:"",
    description,
    category:"Trabajo",
    subcategory:"Comisión / viáticos",
    accountId,
    fromAccountId:null,
    toAccountId:null,
    splits:[],
    hasInvoice:false,
    invoiceNumber:"",
    invoiceBase:0,
    taxPeriod:"",
    taxPaymentId:"",
    vatStatus:"none",
    businessTripId:tripId,
    tripExpenseId,
    tripSettlementId
  };
}

export async function createTripExpense(data){
  const amountPaid=Math.max(0,Number(data.amountPaid||0));
  const invoiceAmount=Math.max(0,Number(data.invoiceAmount||0));
  const recognizedAmount=Math.max(0,Number(data.recognizedAmount||0));
  if(!data.tripId) throw new Error("Selecciona una comisión.");
  if(!data.date) throw new Error("Indica la fecha.");
  if(!(amountPaid>0)) throw new Error("El gasto real debe ser mayor que cero.");
  if(!data.accountId) throw new Error("Selecciona la cuenta desde la que pagaste.");

  const expenseRef=doc(col("tripExpenses"));
  const txRef=doc(col("transactions"));
  const expense={
    tripId:data.tripId,
    date:data.date,
    category:String(data.category||"other"),
    description:String(data.description||"").trim(),
    amountPaid,
    hasInvoice:!!data.hasInvoice,
    invoiceNumber:data.hasInvoice?String(data.invoiceNumber||"").trim():"",
    invoiceAmount:data.hasInvoice?invoiceAmount:0,
    recognizedAmount,
    accountId:data.accountId,
    transactionId:txRef.id,
    notes:String(data.notes||"").trim(),
    active:true
  };
  const tx=tripTxBase({
    type:"work_expense",
    date:data.date,
    amount:amountPaid,
    description:`Comisión · ${expense.description||expense.category}`,
    accountId:data.accountId,
    tripId:data.tripId,
    tripExpenseId:expenseRef.id
  });

  const batch=writeBatch(db);
  batch.set(expenseRef,{...expense,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(txRef,{...tx,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("tripExpense",expenseRef.id,"CREATE",null,expense));
  batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,"Gasto temporal por comisión de trabajo"));
  await batch.commit();
  return expenseRef.id;
}

export async function updateTripExpenseRecognition(id,recognizedAmount,invoiceAmount=null){
  const old=await getEntity("tripExpenses",id);
  if(!old) throw new Error("Gasto de comisión no encontrado.");
  const recognized=Math.max(0,Number(recognizedAmount||0));
  const changes={recognizedAmount:recognized};
  if(invoiceAmount!==null) changes.invoiceAmount=Math.max(0,Number(invoiceAmount||0));
  const batch=writeBatch(db);
  batch.update(ref("tripExpenses",id),{...changes,updatedAt:serverTimestamp()});
  batch.set(
    doc(col("auditLog")),
    auditPayload("tripExpense",id,"UPDATE",old,{...old,...changes},"Actualización de valor reconocido/facturado")
  );
  await batch.commit();
}

export async function voidTripExpense(id){
  const old=await getEntity("tripExpenses",id);
  if(!old || old.active===false) return;
  const tx=old.transactionId?await getEntity("transactions",old.transactionId):null;
  const batch=writeBatch(db);
  batch.update(ref("tripExpenses",id),{active:false,voidedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  if(tx){
    batch.delete(ref("transactions",old.transactionId));
    batch.set(doc(col("auditLog")),auditPayload("transaction",old.transactionId,"DELETE",tx,null,"Anulación de gasto de comisión"));
  }
  batch.set(doc(col("auditLog")),auditPayload("tripExpense",id,"VOID",old,{...old,active:false},"Anulación de gasto"));
  await batch.commit();
}

export async function createTripSettlement(data){
  const amount=Math.max(0,Number(data.amount||0));
  const kind=String(data.kind||"reimbursement");
  if(!["reimbursement","advance","advance_return"].includes(kind)) throw new Error("Tipo de movimiento de comisión no válido.");
  if(!data.tripId) throw new Error("Selecciona una comisión.");
  if(!data.date) throw new Error("Indica la fecha.");
  if(!(amount>0)) throw new Error("El monto debe ser mayor que cero.");
  if(!data.accountId) throw new Error("Selecciona una cuenta.");

  const settlementRef=doc(col("tripSettlements"));
  const txRef=doc(col("transactions"));
  const type={
    reimbursement:"work_reimbursement",
    advance:"work_advance",
    advance_return:"work_advance_return"
  }[kind];
  const label={
    reimbursement:"Reembolso comisión",
    advance:"Anticipo de viáticos",
    advance_return:"Devolución de anticipo"
  }[kind];

  const settlement={
    tripId:data.tripId,
    date:data.date,
    kind,
    amount,
    accountId:data.accountId,
    notes:String(data.notes||"").trim(),
    transactionId:txRef.id,
    active:true
  };
  const tx=tripTxBase({
    type,date:data.date,amount,
    description:`${label}${settlement.notes?` · ${settlement.notes}`:""}`,
    accountId:data.accountId,
    tripId:data.tripId,
    tripSettlementId:settlementRef.id
  });

  const batch=writeBatch(db);
  batch.set(settlementRef,{...settlement,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(txRef,{...tx,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("tripSettlement",settlementRef.id,"CREATE",null,settlement));
  batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,label));
  await batch.commit();
  return settlementRef.id;
}

function moneyRound(value){
  return Math.round((Number(value||0)+Number.EPSILON)*100)/100;
}

function normalizeReconciliationRow(row){
  const bank=Number(row?.bankBalance||0);
  const before=Number(row?.trackerBalanceBefore ?? row?.trackerBalance ?? 0);
  const after=Number(row?.trackerBalanceAfter ?? row?.trackerBalance ?? before);
  const diffBefore=Number(row?.differenceBefore ?? row?.difference ?? (bank-before));
  const diffAfter=Number(row?.differenceAfter ?? row?.difference ?? (bank-after));
  const rawStatus=String(row?.status||"review");
  const status=rawStatus==="invalidated"?"needs_review":rawStatus;
  const mode=String(row?.mode||((row?.recoveryStart||row?.recoveryEnd)?"recovery":"normal"));
  const active=row?.active!==false && status!=="voided";
  return {
    ...row,
    mode,
    trackerBalanceBefore:before,
    bankBalance:bank,
    differenceBefore:diffBefore,
    trackerBalanceAfter:after,
    differenceAfter:diffAfter,
    trackerBalance:after,
    difference:diffAfter,
    status,
    classificationStatus:String(row?.classificationStatus||(
      row?.adjustmentTransactionId?"unclassified":"none"
    )),
    adjustmentTransactionId:String(row?.adjustmentTransactionId||""),
    adjustmentAmount:Number(row?.adjustmentAmount ?? (Math.abs(diffBefore)||0)),
    active
  };
}

function reconciliationPayload(row){
  const normalized=normalizeReconciliationRow(row);
  return {
    accountId:normalized.accountId,
    date:normalized.date,
    mode:normalized.mode,
    recoveryStart:String(normalized.recoveryStart||""),
    recoveryEnd:String(normalized.recoveryEnd||""),
    trackerBalanceBefore:moneyRound(normalized.trackerBalanceBefore),
    bankBalance:moneyRound(normalized.bankBalance),
    differenceBefore:moneyRound(normalized.differenceBefore),
    adjustmentTransactionId:String(normalized.adjustmentTransactionId||""),
    adjustmentAmount:moneyRound(normalized.adjustmentAmount||0),
    trackerBalanceAfter:moneyRound(normalized.trackerBalanceAfter),
    differenceAfter:moneyRound(normalized.differenceAfter),
    status:normalized.status,
    classificationStatus:normalized.classificationStatus,
    reviewReason:String(normalized.reviewReason||""),
    note:String(normalized.note||"").trim(),
    active:normalized.active!==false,
    // Alias históricos para versiones anteriores.
    trackerBalance:moneyRound(normalized.trackerBalanceAfter),
    difference:moneyRound(normalized.differenceAfter)
  };
}

function adjustmentClassification(tx){
  if(!tx?.reconciliationAdjustment) return "none";
  const total=Math.max(0,Number(tx.amount||0));
  const splits=Array.isArray(tx.splits)?tx.splits:[];
  if(!splits.length){
    return String(tx.category||"")==="Por clasificar"?"unclassified":"classified";
  }
  const unclassified=splits
    .filter(x=>String(x.category||"")==="Por clasificar")
    .reduce((a,x)=>a+Number(x.amount||0),0);
  if(unclassified<=0.009) return "classified";
  if(unclassified>=total-0.009) return "unclassified";
  return "partial";
}

function adjustmentDescription(rec){
  if(rec.mode==="recovery"){
    const start=String(rec.recoveryStart||"");
    const end=String(rec.recoveryEnd||rec.date||"");
    return `Ajuste de conciliación · ${start||"período"} a ${end}`;
  }
  return `Ajuste de conciliación · ${rec.date}`;
}

function adjustmentData(rec,difference,oldTx=null,{preserveClassification=false}={}){
  const type=difference<0?"expense":"income";
  const amount=moneyRound(Math.abs(difference));
  const keep=preserveClassification && oldTx &&
    oldTx.type===type &&
    Math.abs(Number(oldTx.amount||0)-amount)<=0.009;

  return {
    type,
    date:rec.date,
    amount,
    vat:0,
    receipt:"",
    description:adjustmentDescription(rec),
    category:keep?String(oldTx.category||"Por clasificar"):"Por clasificar",
    subcategory:keep?String(oldTx.subcategory||"Período perdido"):"Período perdido",
    accountId:rec.accountId,
    fromAccountId:null,
    toAccountId:null,
    splits:keep&&Array.isArray(oldTx.splits)?oldTx.splits:[],
    hasInvoice:false,
    invoiceNumber:"",
    invoiceBase:0,
    taxPeriod:"",
    taxPaymentId:"",
    vatStatus:"none",
    reconciliationAdjustment:true,
    classificationStatus:keep?adjustmentClassification(oldTx):"unclassified",
    recoveryStart:String(rec.recoveryStart||""),
    recoveryEnd:String(rec.recoveryEnd||""),
    reconciliationId:rec.id
  };
}

export const listReconciliations=()=>listEntities("reconciliations","date")
  .then(r=>r.map(normalizeReconciliationRow)
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))));

export async function markReconciliationsNeedsReview(accountIds,sinceDate,{excludeId="",reason="ledger_changed"}={}){
  const ids=[...new Set(accountIds||[])].filter(Boolean);
  if(!ids.length || !sinceDate) return 0;
  const rows=await listReconciliations();
  const affected=rows.filter(r=>
    r.id!==excludeId &&
    r.active!==false &&
    ids.includes(r.accountId) &&
    String(r.date)>=String(sinceDate) &&
    ["reconciled","reconciled_with_adjustment"].includes(r.status)
  );
  if(!affected.length) return 0;

  const batch=writeBatch(db);
  for(const row of affected){
    const changes={
      status:"needs_review",
      reviewReason:reason,
      updatedAt:serverTimestamp()
    };
    batch.update(ref("reconciliations",row.id),changes);
    batch.set(
      doc(col("auditLog")),
      auditPayload(
        "reconciliation",row.id,"UPDATE",
        row,{...row,...changes},
        "Conciliación posterior marcada para revisión por cambio histórico."
      )
    );
  }
  await batch.commit();
  return affected.length;
}

export async function createReconciliation({accountId,date,bankBalance,note=""}){
  const [accounts,transactions]=await Promise.all([listAccounts(),listTransactions()]);
  const account=accounts.find(x=>x.id===accountId);
  if(!account) throw new Error("Cuenta no encontrada.");
  if(!date) throw new Error("Selecciona la fecha de conciliación.");
  const bank=Number(bankBalance);
  if(!Number.isFinite(bank)) throw new Error("Ingresa un saldo bancario válido.");

  const before=moneyRound(calculateBalanceAtDate(account,transactions,date));
  const diff=moneyRound(bank-before);
  const recRef=doc(col("reconciliations"));
  const rec={
    id:recRef.id,
    accountId,date,mode:"normal",
    recoveryStart:"",recoveryEnd:"",
    trackerBalanceBefore:before,
    bankBalance:bank,
    differenceBefore:diff,
    adjustmentTransactionId:"",
    adjustmentAmount:0,
    trackerBalanceAfter:before,
    differenceAfter:diff,
    status:Math.abs(diff)<0.01?"reconciled":"review",
    classificationStatus:"none",
    reviewReason:"",
    note:String(note||"").trim(),
    active:true
  };
  const payload=reconciliationPayload(rec);
  const batch=writeBatch(db);
  batch.set(recRef,{...payload,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("reconciliation",recRef.id,"CREATE",null,payload,"Conciliación normal"));
  await batch.commit();
  return normalizeReconciliationRow({id:recRef.id,...payload});
}

export async function recoverLostPeriod({accountId,startDate,endDate,bankBalance,note=""}){
  const [accounts,transactions]=await Promise.all([listAccounts(),listTransactions()]);
  const account=accounts.find(x=>x.id===accountId);
  if(!account) throw new Error("Cuenta no encontrada.");
  if(!startDate || !endDate || startDate>endDate) throw new Error("Revisa el período a recuperar.");

  const bank=Number(bankBalance);
  if(!Number.isFinite(bank)) throw new Error("Ingresa un saldo real válido.");
  const before=moneyRound(calculateBalanceAtDate(account,transactions,endDate));
  const diff=moneyRound(bank-before);

  const recRef=doc(col("reconciliations"));
  let adjustmentTransactionId="";
  let adjustmentAmount=0;
  let classificationStatus="none";
  const batch=writeBatch(db);

  if(Math.abs(diff)>=0.01){
    const txRef=doc(col("transactions"));
    adjustmentTransactionId=txRef.id;
    adjustmentAmount=Math.abs(diff);
    classificationStatus="unclassified";
    const recShell={
      id:recRef.id,accountId,date:endDate,mode:"recovery",
      recoveryStart:startDate,recoveryEnd:endDate
    };
    const tx=adjustmentData(recShell,diff);
    batch.set(txRef,{...tx,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,"Ajuste para recuperar período perdido"));
  }

  const rec={
    id:recRef.id,
    accountId,
    date:endDate,
    mode:"recovery",
    recoveryStart:startDate,
    recoveryEnd:endDate,
    trackerBalanceBefore:before,
    bankBalance:bank,
    differenceBefore:diff,
    adjustmentTransactionId,
    adjustmentAmount,
    trackerBalanceAfter:bank,
    differenceAfter:0,
    status:adjustmentTransactionId?"reconciled_with_adjustment":"reconciled",
    classificationStatus,
    reviewReason:"",
    note:String(note||"").trim(),
    active:true
  };
  const payload=reconciliationPayload(rec);
  batch.set(recRef,{...payload,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("reconciliation",recRef.id,"CREATE",null,payload,"Recuperación de período"));
  await batch.commit();

  if(adjustmentTransactionId){
    await markReconciliationsNeedsReview([accountId],endDate,{
      excludeId:recRef.id,
      reason:"recovery_adjustment_created"
    });
  }

  return {
    reconciliationId:recRef.id,
    adjustmentTransactionId,
    trackerBefore:before,
    bankBalance:bank,
    differenceBefore:diff
  };
}

export async function resolveReconciliation(id){
  const [old,accounts,transactions]=await Promise.all([
    getEntity("reconciliations",id),listAccounts(),listTransactions()
  ]);
  if(!old) throw new Error("Conciliación no encontrada.");
  const rec=normalizeReconciliationRow(old);
  if(rec.active===false) throw new Error("La conciliación fue eliminada.");
  const account=accounts.find(x=>x.id===rec.accountId);
  if(!account) throw new Error("Cuenta no encontrada.");

  const oldTx=rec.adjustmentTransactionId
    ? transactions.find(x=>x.id===rec.adjustmentTransactionId)
    : null;
  const withoutOwn=transactions.filter(x=>x.id!==rec.adjustmentTransactionId);
  const before=moneyRound(calculateBalanceAtDate(account,withoutOwn,rec.date));
  const diff=moneyRound(rec.bankBalance-before);

  const batch=writeBatch(db);
  let adjustmentId=rec.adjustmentTransactionId;
  let adjustmentAmount=0;
  let classificationStatus="none";

  if(Math.abs(diff)<0.01){
    if(oldTx){
      batch.delete(ref("transactions",oldTx.id));
      batch.set(doc(col("auditLog")),auditPayload("transaction",oldTx.id,"DELETE",oldTx,null,"Ajuste de conciliación ya no requerido"));
    }
    adjustmentId="";
  }else{
    let txRef;
    if(oldTx){
      txRef=ref("transactions",oldTx.id);
      const tx=adjustmentData({...rec,id},diff,oldTx,{preserveClassification:true});
      classificationStatus=tx.classificationStatus;
      adjustmentAmount=tx.amount;
      batch.set(txRef,{...tx,updatedAt:serverTimestamp()},{merge:true});
      batch.set(doc(col("auditLog")),auditPayload("transaction",oldTx.id,"UPDATE",oldTx,tx,"Ajuste de conciliación recalculado"));
    }else{
      txRef=doc(col("transactions"));
      adjustmentId=txRef.id;
      const tx=adjustmentData({...rec,id},diff);
      classificationStatus=tx.classificationStatus;
      adjustmentAmount=tx.amount;
      batch.set(txRef,{...tx,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,"Diferencia conciliada con ajuste por clasificar"));
    }
  }

  const after=Math.abs(diff)<0.01?before:rec.bankBalance;
  const updated={
    ...rec,
    trackerBalanceBefore:before,
    differenceBefore:diff,
    adjustmentTransactionId:adjustmentId,
    adjustmentAmount,
    trackerBalanceAfter:after,
    differenceAfter:moneyRound(rec.bankBalance-after),
    status:adjustmentId?"reconciled_with_adjustment":"reconciled",
    classificationStatus,
    reviewReason:"",
    active:true
  };
  const payload=reconciliationPayload(updated);
  batch.set(ref("reconciliations",id),{...payload,updatedAt:serverTimestamp()},{merge:true});
  batch.set(doc(col("auditLog")),auditPayload("reconciliation",id,"UPDATE",rec,payload,"Diferencia resuelta"));
  await batch.commit();

  await markReconciliationsNeedsReview([rec.accountId],rec.date,{
    excludeId:id,reason:"reconciliation_adjustment_changed"
  });
  return normalizeReconciliationRow({id,...payload});
}

export async function editReconciliation(id,{date,bankBalance,note="",recoveryStart=null}){
  const [old,accounts,transactions]=await Promise.all([
    getEntity("reconciliations",id),listAccounts(),listTransactions()
  ]);
  if(!old) throw new Error("Conciliación no encontrada.");
  const rec=normalizeReconciliationRow(old);
  if(rec.active===false) throw new Error("La conciliación fue eliminada.");
  const account=accounts.find(x=>x.id===rec.accountId);
  if(!account) throw new Error("Cuenta no encontrada.");
  if(!date) throw new Error("Selecciona una fecha.");
  const bank=Number(bankBalance);
  if(!Number.isFinite(bank)) throw new Error("Ingresa un saldo bancario válido.");

  const oldTx=rec.adjustmentTransactionId
    ? transactions.find(x=>x.id===rec.adjustmentTransactionId)
    : null;
  const withoutOwn=transactions.filter(x=>x.id!==rec.adjustmentTransactionId);
  const before=moneyRound(calculateBalanceAtDate(account,withoutOwn,date));
  const diff=moneyRound(bank-before);
  const mode=rec.mode;
  const start=mode==="recovery"
    ? String((recoveryStart ?? rec.recoveryStart) || "")
    : "";
  if(mode==="recovery" && (!start || start>date)){
    throw new Error("Revisa la fecha inicial del período recuperado.");
  }

  const batch=writeBatch(db);
  let adjustmentId=rec.adjustmentTransactionId;
  let adjustmentAmount=0;
  let classificationStatus="none";
  const mustKeepResolved=mode==="recovery" || !!oldTx;

  if(mustKeepResolved){
    if(Math.abs(diff)<0.01){
      if(oldTx){
        batch.delete(ref("transactions",oldTx.id));
        batch.set(doc(col("auditLog")),auditPayload("transaction",oldTx.id,"DELETE",oldTx,null,"Edición de conciliación dejó el ajuste en cero"));
      }
      adjustmentId="";
    }else{
      const shell={...rec,id,date,bankBalance:bank,recoveryStart:start,recoveryEnd:mode==="recovery"?date:""};
      const preserve=!!oldTx &&
        oldTx.type===(diff<0?"expense":"income") &&
        Math.abs(Number(oldTx.amount||0)-Math.abs(diff))<=0.009;
      const tx=adjustmentData(shell,diff,oldTx,{preserveClassification:preserve});
      adjustmentAmount=tx.amount;
      classificationStatus=tx.classificationStatus;
      if(oldTx){
        batch.set(ref("transactions",oldTx.id),{...tx,updatedAt:serverTimestamp()},{merge:true});
        batch.set(doc(col("auditLog")),auditPayload(
          "transaction",oldTx.id,"UPDATE",oldTx,tx,
          preserve?"Conciliación editada; clasificación conservada.":"Conciliación editada; clasificación reiniciada."
        ));
      }else{
        const txRef=doc(col("transactions"));
        adjustmentId=txRef.id;
        tx.reconciliationId=id;
        batch.set(txRef,{...tx,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,"Ajuste creado al editar conciliación"));
      }
    }
  }

  const resolved=mustKeepResolved || Math.abs(diff)<0.01;
  const after=resolved ? bank : before;
  const updated={
    ...rec,
    date,
    bankBalance:bank,
    recoveryStart:start,
    recoveryEnd:mode==="recovery"?date:"",
    trackerBalanceBefore:before,
    differenceBefore:diff,
    adjustmentTransactionId:resolved?adjustmentId:"",
    adjustmentAmount:resolved?adjustmentAmount:0,
    trackerBalanceAfter:after,
    differenceAfter:resolved?0:diff,
    status:resolved
      ? (adjustmentId?"reconciled_with_adjustment":"reconciled")
      : "review",
    classificationStatus:resolved?classificationStatus:"none",
    reviewReason:"",
    note:String(note||"").trim(),
    active:true
  };
  const payload=reconciliationPayload(updated);
  batch.set(ref("reconciliations",id),{...payload,updatedAt:serverTimestamp()},{merge:true});
  batch.set(doc(col("auditLog")),auditPayload("reconciliation",id,"UPDATE",rec,payload,"Conciliación editada"));
  await batch.commit();

  const since=String(date)<String(rec.date)?date:rec.date;
  const ledgerChanged=String(date)!==String(rec.date) ||
    Math.abs(bank-Number(rec.bankBalance||0))>0.009 ||
    String(adjustmentId)!==String(rec.adjustmentTransactionId||"") ||
    Math.abs(Number(adjustmentAmount||0)-Number(rec.adjustmentAmount||0))>0.009;
  if(ledgerChanged){
    await markReconciliationsNeedsReview([rec.accountId],since,{
      excludeId:id,reason:"reconciliation_edited"
    });
  }
  return normalizeReconciliationRow({id,...payload});
}

export async function reopenReconciliation(id){
  const old=await getEntity("reconciliations",id);
  if(!old) throw new Error("Conciliación no encontrada.");
  const rec=normalizeReconciliationRow(old);
  if(rec.active===false) throw new Error("La conciliación fue eliminada.");
  const changes={
    status:"reopened",
    reviewReason:"manual_reopen",
    updatedAt:serverTimestamp()
  };
  const batch=writeBatch(db);
  batch.set(ref("reconciliations",id),changes,{merge:true});
  batch.set(doc(col("auditLog")),auditPayload("reconciliation",id,"UPDATE",rec,{...rec,...changes},"Conciliación reabierta"));
  await batch.commit();
  await markReconciliationsNeedsReview([rec.accountId],rec.date,{
    excludeId:id,reason:"previous_reconciliation_reopened"
  });
}

export async function voidReconciliation(id){
  const [old,transactions]=await Promise.all([
    getEntity("reconciliations",id),listTransactions()
  ]);
  if(!old) throw new Error("Conciliación no encontrada.");
  const rec=normalizeReconciliationRow(old);
  if(rec.active===false) return;
  const adjustment=rec.adjustmentTransactionId
    ? transactions.find(x=>x.id===rec.adjustmentTransactionId)
    : null;

  const batch=writeBatch(db);
  if(adjustment){
    batch.delete(ref("transactions",adjustment.id));
    batch.set(doc(col("auditLog")),auditPayload(
      "transaction",adjustment.id,"DELETE",adjustment,null,
      "Reversión por eliminación de conciliación"
    ));
  }
  const changes={
    active:false,
    status:"voided",
    reviewReason:"manual_void",
    voidedAt:serverTimestamp(),
    updatedAt:serverTimestamp()
  };
  batch.set(ref("reconciliations",id),changes,{merge:true});
  batch.set(doc(col("auditLog")),auditPayload(
    "reconciliation",id,"VOID",rec,{...rec,active:false,status:"voided",reviewReason:"manual_void"},
    "Conciliación eliminada y ajuste revertido"
  ));
  await batch.commit();

  await markReconciliationsNeedsReview([rec.accountId],rec.date,{
    excludeId:id,reason:"previous_reconciliation_voided"
  });
}

export async function recalculateReconciliation(id){
  const [old,accounts,transactions]=await Promise.all([
    getEntity("reconciliations",id),listAccounts(),listTransactions()
  ]);
  if(!old) throw new Error("Conciliación no encontrada.");
  const rec=normalizeReconciliationRow(old);
  if(rec.active===false) throw new Error("La conciliación fue eliminada.");
  const account=accounts.find(x=>x.id===rec.accountId);
  if(!account) throw new Error("Cuenta no encontrada.");

  const withoutOwn=transactions.filter(x=>x.id!==rec.adjustmentTransactionId);
  const before=moneyRound(calculateBalanceAtDate(account,withoutOwn,rec.date));
  const after=moneyRound(calculateBalanceAtDate(account,transactions,rec.date));
  const diffBefore=moneyRound(rec.bankBalance-before);
  const diffAfter=moneyRound(rec.bankBalance-after);
  const adjustment=rec.adjustmentTransactionId
    ? transactions.find(x=>x.id===rec.adjustmentTransactionId)
    : null;
  const classificationStatus=adjustment?adjustmentClassification(adjustment):"none";
  const status=Math.abs(diffAfter)<0.01
    ? (adjustment?"reconciled_with_adjustment":"reconciled")
    : "review";
  const updated={
    ...rec,
    trackerBalanceBefore:before,
    differenceBefore:diffBefore,
    adjustmentAmount:adjustment?Number(adjustment.amount||0):0,
    trackerBalanceAfter:after,
    differenceAfter:diffAfter,
    status,
    classificationStatus,
    reviewReason:status==="review"?"recalculation_difference":"",
    active:true
  };
  const payload=reconciliationPayload(updated);
  const batch=writeBatch(db);
  batch.set(ref("reconciliations",id),{...payload,updatedAt:serverTimestamp()},{merge:true});
  batch.set(doc(col("auditLog")),auditPayload("reconciliation",id,"UPDATE",rec,payload,"Conciliación recalculada"));
  await batch.commit();
  return normalizeReconciliationRow({id,...payload});
}

export async function classifyReconciliationAdjustment(id,{category,subcategory,amount}){
  const [old,transactions]=await Promise.all([
    getEntity("reconciliations",id),listTransactions()
  ]);
  if(!old) throw new Error("Conciliación no encontrada.");
  const rec=normalizeReconciliationRow(old);
  if(rec.active===false) throw new Error("La conciliación fue eliminada.");
  const tx=transactions.find(x=>x.id===rec.adjustmentTransactionId);
  if(!tx) throw new Error("La conciliación no tiene un ajuste para clasificar.");

  const cat=String(category||"").trim();
  const sub=String(subcategory||"").trim();
  const requested=moneyRound(amount);
  if(!cat || !sub) throw new Error("Selecciona categoría y subcategoría.");
  if(cat==="Por clasificar") throw new Error("Selecciona una categoría definitiva.");
  if(!(requested>0)) throw new Error("El monto a clasificar debe ser mayor que cero.");

  let splits=Array.isArray(tx.splits)&&tx.splits.length
    ? tx.splits.map(x=>({...x,amount:Number(x.amount||0)}))
    : [{category:"Por clasificar",subcategory:"Período perdido",amount:Number(tx.amount||0)}];

  const unclassified=splits
    .filter(x=>String(x.category||"")==="Por clasificar")
    .reduce((a,x)=>a+Number(x.amount||0),0);
  if(requested>unclassified+0.009){
    throw new Error("El monto supera el valor pendiente por clasificar.");
  }

  let remaining=requested;
  for(const split of splits){
    if(remaining<=0.009) break;
    if(String(split.category||"")!=="Por clasificar") continue;
    const take=Math.min(Number(split.amount||0),remaining);
    split.amount=moneyRound(Number(split.amount||0)-take);
    remaining=moneyRound(remaining-take);
  }
  splits=splits.filter(x=>Number(x.amount||0)>0.009);

  const same=splits.find(x=>x.category===cat && x.subcategory===sub);
  if(same) same.amount=moneyRound(Number(same.amount||0)+requested);
  else splits.push({category:cat,subcategory:sub,amount:requested});

  const pending=splits
    .filter(x=>String(x.category||"")==="Por clasificar")
    .reduce((a,x)=>a+Number(x.amount||0),0);
  const classificationStatus=pending<=0.009
    ? "classified"
    : pending>=Number(tx.amount||0)-0.009
      ? "unclassified"
      : "partial";

  const txChanges={
    splits,
    classificationStatus,
    updatedAt:serverTimestamp()
  };
  const recChanges={
    classificationStatus,
    updatedAt:serverTimestamp()
  };

  const batch=writeBatch(db);
  batch.set(ref("transactions",tx.id),txChanges,{merge:true});
  batch.set(ref("reconciliations",id),recChanges,{merge:true});
  batch.set(doc(col("auditLog")),auditPayload(
    "transaction",tx.id,"UPDATE",tx,{...tx,...txChanges},
    "Reclasificación de ajuste de conciliación"
  ));
  batch.set(doc(col("auditLog")),auditPayload(
    "reconciliation",id,"UPDATE",rec,{...rec,...recChanges},
    `Clasificación: ${classificationStatus}`
  ));
  await batch.commit();
  return classificationStatus;
}

export async function resetReconciliationClassification(id){
  const [old,transactions]=await Promise.all([
    getEntity("reconciliations",id),listTransactions()
  ]);
  if(!old) throw new Error("Conciliación no encontrada.");
  const rec=normalizeReconciliationRow(old);
  if(rec.active===false) throw new Error("La conciliación fue eliminada.");
  const tx=transactions.find(x=>x.id===rec.adjustmentTransactionId);
  if(!tx) throw new Error("La conciliación no tiene un ajuste.");

  const txChanges={
    category:"Por clasificar",
    subcategory:"Período perdido",
    splits:[],
    classificationStatus:"unclassified",
    updatedAt:serverTimestamp()
  };
  const recChanges={
    classificationStatus:"unclassified",
    updatedAt:serverTimestamp()
  };
  const batch=writeBatch(db);
  batch.set(ref("transactions",tx.id),txChanges,{merge:true});
  batch.set(ref("reconciliations",id),recChanges,{merge:true});
  batch.set(doc(col("auditLog")),auditPayload(
    "transaction",tx.id,"UPDATE",tx,{...tx,...txChanges},
    "Clasificación del ajuste reiniciada"
  ));
  batch.set(doc(col("auditLog")),auditPayload(
    "reconciliation",id,"UPDATE",rec,{...rec,classificationStatus:"unclassified"},
    "Clasificación reiniciada"
  ));
  await batch.commit();
}

export const saveReconciliation=(d,id=null)=>{
  const payload=reconciliationPayload({
    ...d,
    id:id||d.id||"",
    active:d.active!==false
  });
  return saveEntity("reconciliations",payload,id,{auditType:"reconciliation"});
};

export const getEmergencyFund=()=>getEntity("emergencyFund","main");
export const listEmergencyFund=()=>listEntities("emergencyFund");
export const saveEmergencyFund=d=>upsertEntity("emergencyFund","main",d,{auditType:"emergencyFund"});

export const listTaxPayments=()=>listEntities("taxPayments","paymentDate")
  .then(r=>r.sort((a,b)=>String(b.paymentDate).localeCompare(String(a.paymentDate))));

export async function saveTaxPayment(payment,invoiceIds=[]){
  const ids=[...new Set(invoiceIds)].filter(Boolean);
  if(!payment.period) throw new Error("Selecciona el período tributario.");
  if(!ids.length) throw new Error("Selecciona al menos una factura.");
  if(Number(payment.paidVat||0)<0) throw new Error("El valor pagado no puede ser negativo.");
  if(Number(payment.paidVat||0)>0 && !payment.accountId) throw new Error("Selecciona la cuenta desde la que se pagó el IVA.");

  const invoices=[];
  for(const id of ids){
    const row=await getEntity("transactions",id);
    if(!row) throw new Error("Una de las facturas ya no existe.");
    if(row.type!=="income" || Number(row.vat||0)<=0 || row.taxPaymentId || row.vatStatus==="paid"){
      throw new Error("Solo pueden liquidarse facturas de ingreso con IVA pendientes.");
    }
    const period=String(row.taxPeriod||row.date||"").slice(0,7);
    if(period!==payment.period) throw new Error("Todas las facturas deben pertenecer al mismo período.");
    invoices.push(row);
  }

  const expectedVat=invoices.reduce((s,x)=>s+Number(x.vat||0),0);
  const paymentRef=doc(col("taxPayments"));
  const paymentId=paymentRef.id;
  const batch=writeBatch(db);

  const data={
    period:payment.period,
    invoiceIds:ids,
    expectedVat,
    paidVat:Number(payment.paidVat||0),
    accountId:payment.accountId||"",
    paymentDate:payment.paymentDate,
    notes:String(payment.notes||""),
    status:"paid"
  };

  batch.set(paymentRef,{...data,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(
    doc(col("auditLog")),
    auditPayload("taxPayment",paymentId,"CREATE",null,data,`Liquidación de IVA ${payment.period}`)
  );

  for(const invoice of invoices){
    const changes={
      taxPaymentId:paymentId,
      vatStatus:"paid",
      updatedAt:serverTimestamp()
    };
    batch.update(ref("transactions",invoice.id),changes);
    batch.set(
      doc(col("auditLog")),
      auditPayload(
        "transaction",
        invoice.id,
        "UPDATE",
        invoice,
        {...invoice,taxPaymentId:paymentId,vatStatus:"paid"},
        `Factura incluida en pago IVA ${payment.period}`
      )
    );
  }

  if(Number(payment.paidVat||0)>0){
    const txRef=doc(col("transactions"));
    const txData={
      type:"expense",
      date:payment.paymentDate,
      amount:Number(payment.paidVat||0),
      vat:0,
      receipt:"",
      description:`Pago IVA · ${payment.period}`,
      category:"Impuestos",
      subcategory:"IVA",
      accountId:payment.accountId,
      fromAccountId:null,
      toAccountId:null,
      splits:[],
      hasInvoice:false,
      invoiceNumber:"",
      invoiceBase:0,
      taxPeriod:"",
      taxPaymentId:paymentId,
      vatStatus:"none"
    };
    batch.set(txRef,{...txData,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(
      doc(col("auditLog")),
      auditPayload("transaction",txRef.id,"CREATE",null,txData,"Pago real de IVA")
    );
  }

  await batch.commit();
  return paymentId;
}

function ymShift(month,delta){
  const [y,m]=String(month).split("-").map(Number);
  const d=new Date(Date.UTC(y,m-1+Number(delta),1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}

function localDateISO(value){
  if(typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d=value instanceof Date ? value : new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function dueDateForContractPeriod(period,lagMonths,paymentDay){
  const dueMonth=ymShift(period,Math.max(0,Number(lagMonths||0)));
  const [y,m]=dueMonth.split("-").map(Number);
  const last=new Date(Date.UTC(y,m,0)).getUTCDate();
  const day=Math.min(Math.max(1,Number(paymentDay||1)),last);
  return `${dueMonth}-${String(day).padStart(2,"0")}`;
}

function receivableNeedsSync(oldRow,expected){
  if(oldRow.active===false) return true;
  if(String(oldRow.status||"")==="void") return true;
  if(Math.abs(Number(oldRow.amount||0)-Number(expected.amount||0))>.009) return true;
  if(String(oldRow.dueDate||"")!==String(expected.dueDate||"")) return true;
  if(String(oldRow.serviceStart||"")!==String(expected.serviceStart||"")) return true;
  if(String(oldRow.serviceEnd||"")!==String(expected.serviceEnd||"")) return true;
  if(Number(oldRow.workedDays||0)!==Number(expected.workedDays||0)) return true;
  if(Number(oldRow.monthDays||0)!==Number(expected.monthDays||0)) return true;
  if(!!oldRow.prorated!==!!expected.prorated) return true;
  if(String(oldRow.earnedAt||"")!==String(expected.earnedAt||"")) return true;
  return false;
}

export async function syncReceivablesClosed(today=new Date()){
  const todayIso=localDateISO(today);
  const [contracts,existing]=await Promise.all([listContracts(),listReceivables()]);
  const byKey=new Map(existing.map(r=>[`${r.contractId}|${r.workPeriod}`,r]));
  const scheduledToClose=[];

  for(const c of contracts){
    const startMonth=String(c.startDate||"").slice(0,7);
    if(!/^\d{4}-\d{2}$/.test(startMonth)) continue;

    const stop=contractDesiredStopMonth(c,todayIso);
    if(!stop) continue;

    const desired=new Set();

    if(startMonth<=stop){
      let cursor=startMonth;
      let guard=0;

      while(cursor<=stop && guard<600){
        const calc=contractPeriodCalculation(c,cursor);
        if(calc){
          const key=`${c.id}|${cursor}`;
          desired.add(key);

          const expected={
            contractId:c.id,
            workPeriod:cursor,
            amount:calc.amount,
            paidAmount:0,
            dueDate:dueDateForContractPeriod(cursor,c.paymentLagMonths,c.paymentDay),
            status:"pending",
            active:true,
            serviceStart:calc.serviceStart,
            serviceEnd:calc.serviceEnd,
            workedDays:calc.workedDays,
            monthDays:calc.monthDays,
            prorated:calc.prorated,
            earnedAt:calc.earnedAt,
            voidReason:""
          };

          const old=byKey.get(key);

          if(!old){
            const id=await saveReceivable(expected);
            byKey.set(key,{id,...expected});
          }else if(Number(old.paidAmount||0)<=.009 && receivableNeedsSync(old,expected)){
            const updated={
              ...old,
              ...expected,
              paidAmount:Number(old.paidAmount||0)
            };
            await saveReceivable(
              updated,
              old.id
            );
            byKey.set(key,updated);
          }
        }

        cursor=ymShift(cursor,1);
        guard++;
      }
    }

    if(c.active!==false && c.endDate && String(c.endDate)<=todayIso){
      scheduledToClose.push(c);
    }

    // Repara períodos abiertos/futuros generados por versiones anteriores.
    for(const old of [...byKey.values()].filter(r=>r.contractId===c.id)){
      const key=`${old.contractId}|${old.workPeriod}`;
      if(
        old.active!==false &&
        Number(old.paidAmount||0)<=.009 &&
        !desired.has(key)
      ){
        const archived={
          ...old,
          active:false,
          status:"void",
          voidReason:"unearned_period"
        };
        await saveReceivable(archived,old.id);
        byKey.set(key,archived);
      }
    }
  }

  for(const c of scheduledToClose){
    await saveContract({...c,active:false},c.id);
  }
  return listReceivables();
}

export const listAudit=()=>listEntities("auditLog");

export function calculateBalances(accounts,transactions){
  const b=Object.fromEntries(accounts.map(a=>[a.id,Number(a.openingBalance||0)]));
  for(const t of transactions){
    const m=Number(t.amount||0);
    if(["income","work_reimbursement","work_advance"].includes(t.type)&&t.accountId in b)b[t.accountId]+=m;
    const charges=Math.max(0,Number(t.feeAmount||0))+Math.max(0,Number(t.taxAmount||0))+Math.max(0,Number(t.otherChargeAmount||0));
    if(["expense","work_expense","work_advance_return"].includes(t.type)&&t.accountId in b)b[t.accountId]-=(m+charges);
    if(t.type==="transfer"){
      if(t.fromAccountId in b)b[t.fromAccountId]-=(m+charges);
      if(t.toAccountId in b)b[t.toAccountId]+=m;
    }
    if(t.type==="investment_out"&&t.accountId in b)b[t.accountId]-=m;
    if(t.type==="investment_return"&&t.accountId in b)b[t.accountId]+=m;
  }
  return b;
}
export function calculateBalanceAtDate(account,transactions,date){
  let balance=Number(account?.openingBalance||0);
  for(const t of transactions){
    if(String(t.date)>String(date)) continue;
    const m=Number(t.amount||0);
    if(["income","work_reimbursement","work_advance"].includes(t.type)&&t.accountId===account.id) balance+=m;
    const charges=Math.max(0,Number(t.feeAmount||0))+Math.max(0,Number(t.taxAmount||0))+Math.max(0,Number(t.otherChargeAmount||0));
    if(["expense","work_expense","work_advance_return"].includes(t.type)&&t.accountId===account.id) balance-=(m+charges);
    if(t.type==="transfer"){
      if(t.fromAccountId===account.id) balance-=(m+charges);
      if(t.toAccountId===account.id) balance+=m;
    }
    if(t.type==="investment_out"&&t.accountId===account.id) balance-=m;
    if(t.type==="investment_return"&&t.accountId===account.id) balance+=m;
  }
  return balance;
}
