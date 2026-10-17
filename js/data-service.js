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

export const listTransactions=()=>listEntities("transactions","date").then(r=>r.sort((a,b)=>String(b.date).localeCompare(String(a.date))));
export const saveTransaction=(d,id=null)=>{
  const vat=Math.max(0,Number(d.vat||0));
  const invoice=!!d.hasInvoice || vat>0;
  const normalized={
    ...d,
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
  return saveEntity("transactions",normalized,id,{auditType:"transaction"});
};
export async function removeTransaction(id){
  const row=await getEntity("transactions",id);
  if(row?.taxPaymentId){
    throw new Error("Este movimiento está vinculado a una liquidación de IVA y no puede eliminarse.");
  }
  if(row?.tripExpenseId || row?.tripSettlementId){
    throw new Error("Este movimiento está vinculado a una comisión de trabajo. Anúlalo desde Comisiones / Viáticos.");
  }
  return deleteEntity("transactions",id,{auditType:"transaction"});
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
export const listGoals=()=>listEntities("goals");
export const saveGoal=(d,id=null)=>saveEntity("goals",d,id,{auditType:"goal"});
export const archiveGoal=id=>archiveEntity("goals",id,{auditType:"goal"});
export const listLiabilities=()=>listEntities("liabilities");
export const saveLiability=(d,id=null)=>saveEntity("liabilities",d,id,{auditType:"liability"});
export const archiveLiability=id=>archiveEntity("liabilities",id,{auditType:"liability"});
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

export async function recoverLostPeriod({accountId,startDate,endDate,bankBalance,note=""}){
  const [accounts,transactions]=await Promise.all([listAccounts(),listTransactions()]);
  const account=accounts.find(x=>x.id===accountId);
  if(!account) throw new Error("Cuenta no encontrada.");
  if(!startDate || !endDate || startDate>endDate) throw new Error("Revisa el período a recuperar.");

  const trackerBefore=calculateBalanceAtDate(account,transactions,endDate);
  const bank=Number(bankBalance);
  if(!Number.isFinite(bank)) throw new Error("Ingresa un saldo real válido.");
  const differenceBefore=bank-trackerBefore;

  const recRef=doc(col("reconciliations"));
  const batch=writeBatch(db);
  let adjustmentTransactionId="";

  if(Math.abs(differenceBefore)>=0.01){
    const txRef=doc(col("transactions"));
    adjustmentTransactionId=txRef.id;
    const tx={
      type:differenceBefore<0?"expense":"income",
      date:endDate,
      amount:Math.abs(differenceBefore),
      vat:0,
      receipt:"",
      description:`Ajuste de conciliación · ${startDate} a ${endDate}${note?` · ${note}`:""}`,
      category:"Por clasificar",
      subcategory:"Período perdido",
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
      reconciliationAdjustment:true,
      classificationStatus:"unclassified",
      recoveryStart:startDate,
      recoveryEnd:endDate,
      reconciliationId:recRef.id
    };
    batch.set(txRef,{...tx,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,"Ajuste para recuperar período perdido"));
  }

  const reconciliation={
    accountId,
    date:endDate,
    recoveryStart:startDate,
    recoveryEnd:endDate,
    trackerBalance:bank,
    bankBalance:bank,
    difference:0,
    trackerBalanceBefore:trackerBefore,
    differenceBefore,
    status:adjustmentTransactionId?"reconciled_with_adjustment":"reconciled",
    adjustmentTransactionId,
    note:String(note||"").trim()
  };
  batch.set(recRef,{...reconciliation,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("reconciliation",recRef.id,"CREATE",null,reconciliation,"Recuperación de período"));
  await batch.commit();
  return {reconciliationId:recRef.id,adjustmentTransactionId,trackerBefore,bankBalance:bank,differenceBefore};
}

export const listReconciliations=()=>listEntities("reconciliations","date");
export const saveReconciliation=(d,id=null)=>saveEntity("reconciliations",d,id,{auditType:"reconciliation"});

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

  return listReceivables();
}

export const listAudit=()=>listEntities("auditLog");

export function calculateBalances(accounts,transactions){
  const b=Object.fromEntries(accounts.map(a=>[a.id,Number(a.openingBalance||0)]));
  for(const t of transactions){
    const m=Number(t.amount||0);
    if(["income","work_reimbursement","work_advance"].includes(t.type)&&t.accountId in b)b[t.accountId]+=m;
    if(["expense","work_expense","work_advance_return"].includes(t.type)&&t.accountId in b)b[t.accountId]-=m;
    if(t.type==="transfer"){
      if(t.fromAccountId in b)b[t.fromAccountId]-=m;
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
    if(["expense","work_expense","work_advance_return"].includes(t.type)&&t.accountId===account.id) balance-=m;
    if(t.type==="transfer"){
      if(t.fromAccountId===account.id) balance-=m;
      if(t.toAccountId===account.id) balance+=m;
    }
    if(t.type==="investment_out"&&t.accountId===account.id) balance-=m;
    if(t.type==="investment_return"&&t.accountId===account.id) balance+=m;
  }
  return balance;
}
