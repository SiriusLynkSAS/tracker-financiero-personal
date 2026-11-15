import {
  collection, doc, addDoc, getDocs, getDocsFromCache, getDoc, getDocFromCache,
  setDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, writeBatch, runTransaction, deleteField
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import {contractPeriodCalculation,contractDesiredPeriodKeys,contractBillingCycleMode} from "./contract-math.js";
import {
  SCHEMA_VERSION,canonicalStamp,
  normalizeAccount,sanitizeAccountWrite,
  normalizeTransaction,sanitizeTransactionWrite,
  normalizeBudget,sanitizeBudgetWrite,
  normalizeRecurring,sanitizeRecurringWrite,
  normalizeLiability,sanitizeLiabilityWrite,
  normalizeFinancingPlan,sanitizeFinancingPlanWrite,
  normalizeContract,sanitizeContractWrite,
  normalizeReceivable,sanitizeReceivableWrite,
  normalizeInvestment,sanitizeInvestmentWrite,
  normalizeInvoice,sanitizeInvoiceWrite
} from "./schema.js?v=1.0.89";
import {AUD_POST_007_TARGET,inspectAudPost007Raw,sanitizeContractPaymentWrite} from "./post-audit-logic.js?v=1.0.82";

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
const entityMemory=new Map();
const entityInflight=new Map();
const MEMORY_TTL_MS=5000;

function entityKey(n,order=null){return `${n}|${order||""}`;}
function rowsFromSnapshot(snapshot){return snapshot.docs.map(d=>({...d.data(),id:d.id}));}
function rememberRows(key,rows){entityMemory.set(key,{at:Date.now(),rows});return rows;}
function invalidateCollection(n){
  for(const key of [...entityMemory.keys()]){
    if(key.startsWith(`${n}|`)) entityMemory.delete(key);
  }
  if(typeof window!=="undefined") window.dispatchEvent(new CustomEvent("tf-data-changed",{detail:{collection:n}}));
}
function remoteRows(key,q){
  if(entityInflight.has(key)) return entityInflight.get(key);
  const request=getDocs(q)
    .then(snapshot=>rememberRows(key,rowsFromSnapshot(snapshot)))
    .finally(()=>entityInflight.delete(key));
  entityInflight.set(key,request);
  return request;
}
function refreshInBackground(key,q){
  if(typeof navigator!=="undefined" && navigator.onLine===false) return;
  remoteRows(key,q).then(()=>{
    window.dispatchEvent(new CustomEvent("tf-data-refreshed",{detail:{key}}));
  }).catch(()=>{});
}

export async function ensureUserProfile(){
  const r=doc(db,"users",uid());
  let cached=null;
  try{cached=await getDocFromCache(r)}catch{}
  if(cached?.exists()) return;
  const remote=await getDoc(r);
  if(!remote.exists()) await setDoc(r,{email:auth.currentUser?.email||"",role:"owner",createdAt:serverTimestamp()});
}

export async function listEntities(n,order=null){
  const key=entityKey(n,order);
  const memory=entityMemory.get(key);
  if(memory && Date.now()-memory.at<MEMORY_TTL_MS) return memory.rows;

  const q=order?query(col(n),orderBy(order)):col(n);
  try{
    const cached=await getDocsFromCache(q);
    if(!cached.empty){
      const rows=rememberRows(key,rowsFromSnapshot(cached));
      refreshInBackground(key,q);
      return rows;
    }
  }catch{}

  return remoteRows(key,q);
}

export async function getEntity(n,id){
  const r=ref(n,id);
  try{
    const cached=await getDocFromCache(r);
    if(cached.exists()){
      if(typeof navigator==="undefined" || navigator.onLine!==false){
        getDoc(r).catch(()=>{});
      }
      return {...cached.data(),id:cached.id};
    }
  }catch{}
  const remote=await getDoc(r);
  return remote.exists()?{...remote.data(),id:remote.id}:null;
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
  const payload={...canonicalStamp(data),updatedAt:serverTimestamp()};
  if(id) batch.update(entityRef,payload);
  else batch.set(entityRef,{...payload,createdAt:serverTimestamp()});
  const auditRef=doc(col("auditLog"));
  batch.set(auditRef,auditPayload(auditType,entityId,id?"UPDATE":"CREATE",old,data,note));
  await batch.commit();
  invalidateCollection(n);
  return entityId;
}
export async function upsertEntity(n,id,data,{auditType=n,note=""}={}){
  const old=await getEntity(n,id);
  const batch=writeBatch(db);
  const entityRef=ref(n,id);
  const payload={...canonicalStamp(data),updatedAt:serverTimestamp()};
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
  invalidateCollection(n);
  return id;
}

export async function archiveEntity(n,id,{auditType=n}={}){
  const old=await getEntity(n,id);
  const batch=writeBatch(db);
  batch.update(ref(n,id),{active:false,archivedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload(auditType,id,"ARCHIVE",old,{...old,active:false}));
  await batch.commit();
  invalidateCollection(n);
}
export async function reactivateEntity(n,id,{auditType=n}={}){
  const old=await getEntity(n,id);
  const batch=writeBatch(db);
  batch.update(ref(n,id),{active:true,updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload(auditType,id,"REACTIVATE",old,{...old,active:true}));
  await batch.commit();
  invalidateCollection(n);
}
async function setLifecycleState(n,id,{active,status,auditType=n,action}){
  const old=await getEntity(n,id);
  if(!old) throw new Error("Registro no encontrado.");
  const changes={active,status,schemaVersion:SCHEMA_VERSION,updatedAt:serverTimestamp()};
  if(!active) changes.archivedAt=serverTimestamp();
  const batch=writeBatch(db);
  batch.update(ref(n,id),changes);
  batch.set(doc(col("auditLog")),auditPayload(auditType,id,action,old,{...old,active,status}));
  await batch.commit();
  invalidateCollection(n);
}
export async function deleteEntity(n,id,{auditType=n}={}){
  const old=await getEntity(n,id);
  const batch=writeBatch(db);
  batch.delete(ref(n,id));
  batch.set(doc(col("auditLog")),auditPayload(auditType,id,"DELETE",old,null));
  await batch.commit();
  invalidateCollection(n);
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
    const writeData=op.collection==="receivables"
      ? sanitizeReceivableWrite(op.data)
      : op.collection==="contractPayments"
        ? sanitizeContractPaymentWrite(op.data)
        : op.data;
    if(op.action==="delete"){
      batch.delete(op.entityRef);
    }else if(op.action==="update"){
      batch.update(op.entityRef,{...canonicalStamp(writeData),updatedAt:serverTimestamp()});
    }else{
      batch.set(op.entityRef,{...canonicalStamp(writeData),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    }
    batch.set(
      doc(col("auditLog")),
      auditPayload(
        auditType,
        op.entityId,
        op.action.toUpperCase(),
        op.old,
        op.action==="delete"?null:writeData,
        op.note||""
      )
    );
  }
  await batch.commit();
  for(const name of new Set(enriched.map(x=>x.collection))) invalidateCollection(name);
  return enriched.map(x=>x.entityId);
}

export const listAccounts=(o={includeArchived:true})=>listEntities("accounts","bank")
  .then(r=>r.map(normalizeAccount))
  .then(r=>o.includeArchived?r:r.filter(x=>x.active!==false));
export const saveAccount=(d,id=null)=>saveEntity("accounts",sanitizeAccountWrite(d),id,{auditType:"account"});
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
function residualTransferRefsOnExpense(row){
  return String(row?.type||"").trim()==="expense" && (String(row?.fromAccountId||"").trim()!=="" || String(row?.toAccountId||"").trim()!=="");
}
export const listTransactions=()=>listEntities("transactions","date")
  .then(r=>r.map(row=>{
    const normalized=normalizeTransaction(row);
    return {...normalized,reconciliationAdjustment:inferredReconciliationAdjustment(normalized)};
  }))
  .then(r=>r.sort((a,b)=>transactionSortKey(b).localeCompare(transactionSortKey(a))));
export async function saveTransaction(d,id=null){
  const old=id?await getEntity("transactions",id):null;
  if(old){
    if(residualTransferRefsOnExpense(old)) throw new Error("Este movimiento conserva referencias de cuenta inconsistentes. Requiere revisión antes de editarlo.");
    if(old.taxPaymentId) throw new Error("Este movimiento está vinculado a una liquidación de IVA. Modifícalo desde IVA / Impuestos.");
    if(old.tripExpenseId || old.tripSettlementId) throw new Error("Este movimiento está vinculado a una comisión. Modifícalo desde Comisiones / Viáticos.");
    if(old.reconciliationAdjustment) throw new Error("Este movimiento pertenece a una conciliación. Modifícalo desde Conciliación.");
    if(old.debtPaymentId || old.liabilityId) throw new Error("Este movimiento está vinculado a un pago de deuda. Modifícalo desde Deudas y tarjetas.");
    if(old.insurancePolicyId && old.recurringId) throw new Error("Este movimiento corresponde a una prima de seguro. Modifícalo desde Seguros.");
    if(old.recurringId) throw new Error("Este movimiento ejecuta un recurrente. Reviértelo desde Recurrentes antes de volver a registrarlo.");
    if(old.investmentId) throw new Error("Este movimiento está vinculado a una inversión. Modifícalo desde Inversiones.");
    if(old.assetId) throw new Error("Este movimiento está vinculado a un activo. Modifícalo desde Activos.");
    if(old.financingPlanId) throw new Error("Este movimiento está vinculado a un plan de cuotas de tarjeta. Revísalo desde Deudas y tarjetas; no puede editarse directamente.");
    if(old.contractPaymentId) throw new Error("Este movimiento está vinculado a un cobro contractual. Modifícalo desde Contratos.");
    if(old.insuranceUsageId) throw new Error("Este movimiento está vinculado a una cobertura de seguro. Revísalo desde Seguros.");
    if(old.invoicePaymentId || old.invoiceId) throw new Error("Este movimiento está vinculado a una factura. Modifícalo desde Facturación.");
    if(old.settlementId) throw new Error("Este movimiento forma parte de una liquidación estructurada y no puede editarse directamente.");
  }
  const normalized=sanitizeTransactionWrite(d);
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
  if(residualTransferRefsOnExpense(row)) throw new Error("Este movimiento conserva referencias de cuenta inconsistentes. Requiere revisión antes de eliminarlo.");
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
  if(row?.insurancePolicyId && row?.recurringId){
    throw new Error("Este movimiento corresponde a una prima de seguro. Corrígelo desde Seguros; no puede eliminarse directamente.");
  }
  if(row?.recurringId){
    throw new Error("Este movimiento ejecuta un recurrente. Reviértelo desde Recurrentes para volver a habilitar esa ocurrencia.");
  }
  if(row?.investmentId){
    throw new Error("Este movimiento está vinculado a una inversión y no puede eliminarse directamente.");
  }
  if(row?.assetId){
    throw new Error("Este movimiento está vinculado a un activo y no puede eliminarse directamente. Revísalo desde Activos.");
  }
  if(row?.financingPlanId){
    throw new Error("Este movimiento está vinculado a un plan de cuotas de tarjeta. Revísalo desde Deudas y tarjetas; no puede eliminarse directamente.");
  }
  if(row?.insuranceUsageId){
    throw new Error("Este movimiento está vinculado a una cobertura de seguro. Revísalo desde Seguros; no puede eliminarse directamente.");
  }
  if(row?.invoicePaymentId && row?.invoiceId){
    const invoice=normalizeInvoice(await getEntity("invoices",row.invoiceId)||{});
    if(!invoice.id) throw new Error("La factura vinculada ya no existe.");
    const amount=Number(row.amount||0),baseComponent=Math.max(0,Number(row.economicAmount||row.invoiceBase||0)),vatComponent=Math.max(0,Number(row.invoiceVatComponent||row.vat||0)),contractComponent=Math.max(0,Number(row.contractReceivableComponent||baseComponent));
    const paidAmount=Math.max(0,roundMoney(invoice.paidAmount-amount));
    const paidBaseAmount=Math.max(0,roundMoney(Number(invoice.paidBaseAmount||0)-baseComponent));
    const paidVatAmount=Math.max(0,roundMoney(Number(invoice.paidVatAmount||0)-vatComponent));
    const status=invoiceStatus(invoice.totalAmount,paidAmount,invoice.dueDate);
    const batch=writeBatch(db);
    const after={...invoice,paidAmount,paidBaseAmount,paidVatAmount,status};
    batch.update(ref("invoices",invoice.id),{paidAmount,paidBaseAmount,paidVatAmount,status,updatedAt:serverTimestamp()});
    batch.set(doc(col("auditLog")),auditPayload("invoice",invoice.id,"UPDATE",invoice,after,"Reversión automática al eliminar cobro de factura"));
    if(invoice.receivableId&&contractComponent>.009){
      const r=await getEntity("receivables",invoice.receivableId);
      if(r){
        const newPaid=Math.max(0,Number(r.paidAmount||0)-contractComponent),recStatus=newPaid>=Number(r.amount||0)-.009?"paid":newPaid>.009?"partial":"pending";
        batch.update(ref("receivables",r.id),{paidAmount:newPaid,status:recStatus,updatedAt:serverTimestamp()});
        batch.set(doc(col("auditLog")),auditPayload("receivable",r.id,"UPDATE",r,{...r,paidAmount:newPaid,status:recStatus},"Reversión de cobro de factura vinculada"));
      }
    }
    batch.delete(ref("transactions",id));
    batch.set(doc(col("auditLog")),auditPayload("transaction",id,"DELETE",row,null,"Eliminación de cobro de factura con reversión estructurada"));
    await batch.commit();invalidateCollection("transactions");invalidateCollection("invoices");invalidateCollection("receivables");
    const accountIds=[...new Set([row?.accountId].filter(Boolean))];if(accountIds.length&&row?.date)await markReconciliationsNeedsReview(accountIds,row.date,{reason:"invoice_payment_deleted"});
    return;
  }
  if(row?.contractPaymentId){
    const normalizeAllocations=value=>Array.isArray(value)?value
      .map(a=>({
        receivableId:String(a?.receivableId||""),
        contractId:String(a?.contractId||""),
        workPeriod:String(a?.workPeriod||""),
        amount:Math.max(0,Number(a?.amount||0))
      }))
      .filter(a=>a.receivableId&&a.amount>0):[];

    // Los cobros Web legacy guardaban contractAllocations dentro del documento
    // transaction. normalizeTransaction los descartaba, por eso la reversión
    // quedaba bloqueada aun cuando Firestore conservaba el detalle.
    let sourceRow=row;
    let allocations=normalizeAllocations(row.contractAllocations);
    if(!allocations.length){
      try{
        const fresh=await getDoc(ref("transactions",id));
        if(fresh.exists()){
          sourceRow={id:fresh.id,...fresh.data()};
          allocations=normalizeAllocations(sourceRow.contractAllocations);
        }
      }catch(err){console.warn("No se pudo releer el movimiento contractual crudo.",err);}
    }

    // Android usa contractPayments como registro estructurado. Si el movimiento
    // no contiene las asignaciones, se acepta esa fuente únicamente por ID.
    let paymentRecord=null;
    if(!allocations.length){
      try{
        paymentRecord=await getEntity("contractPayments",row.contractPaymentId);
        allocations=normalizeAllocations(paymentRecord?.allocations);
      }catch(err){console.warn("No se pudo leer contractPayments para la reversión.",err);}
    }

    if(!allocations.length){
      throw new Error("Este cobro contractual no contiene asignaciones verificables. No se eliminó ningún dato.");
    }
    const allocationTotal=roundMoney(allocations.reduce((s,a)=>s+a.amount,0));
    if(Math.abs(allocationTotal-Number(sourceRow.amount||row.amount||0))>.02){
      throw new Error("Las asignaciones del cobro contractual no coinciden con el monto del movimiento. No se eliminó ningún dato.");
    }

    const rows=[];
    for(const allocation of allocations){
      const receivable=await getEntity("receivables",allocation.receivableId);
      if(!receivable) throw new Error(`No se encontró la cuenta por cobrar ${allocation.receivableId}. No se eliminó ningún dato.`);
      rows.push({allocation,receivable});
    }

    const batch=writeBatch(db);
    for(const {allocation,receivable} of rows){
      const newPaid=Math.max(0,roundMoney(Number(receivable.paidAmount||0)-allocation.amount));
      const amount=Number(receivable.amount||0);
      const status=newPaid>=amount-.009?"paid":newPaid>.009?"partial":"pending";
      const after={...receivable,paidAmount:newPaid,status};
      batch.update(ref("receivables",receivable.id),{paidAmount:newPaid,status,updatedAt:serverTimestamp()});
      batch.set(doc(col("auditLog")),auditPayload("receivable",receivable.id,"UPDATE",receivable,after,"Reversión automática al eliminar movimiento de cobro contractual"));
    }

    if(paymentRecord?.id){
      const paymentAfter=sanitizeContractPaymentWrite({...paymentRecord,status:"reversed",reversedReason:"movement_deleted",schemaVersion:SCHEMA_VERSION});
      batch.set(
        ref("contractPayments",paymentRecord.id),
        {...paymentAfter,id:deleteField(),reversedAt:serverTimestamp(),updatedAt:serverTimestamp()},
        {merge:true}
      );
      batch.set(doc(col("auditLog")),auditPayload("contractPayment",paymentRecord.id,"REVERSE",paymentRecord,paymentAfter,"Reversión desde Movimientos Web · identidad documental canónica"));
    }

    batch.delete(ref("transactions",id));
    batch.set(doc(col("auditLog")),auditPayload("transaction",id,"DELETE",sourceRow,null,"Eliminación de ingreso contractual con reversión de cuenta por cobrar"));
    await batch.commit();
    invalidateCollection("transactions");
    invalidateCollection("receivables");
    invalidateCollection("contractPayments");
    const accountIds=[...new Set([sourceRow?.accountId,sourceRow?.fromAccountId,sourceRow?.toAccountId].filter(Boolean))];
    if(accountIds.length&&sourceRow?.date)await markReconciliationsNeedsReview(accountIds,sourceRow.date,{reason:"contract_payment_deleted"});
    return;
  }
  if(row?.settlementId){
    throw new Error("Este movimiento forma parte de una liquidación estructurada y no puede eliminarse directamente.");
  }
  await deleteEntity("transactions",id,{auditType:"transaction"});
  const accountIds=[...new Set([row?.accountId,row?.fromAccountId,row?.toAccountId].filter(Boolean))];
  if(accountIds.length && row?.date){
    await markReconciliationsNeedsReview(accountIds,row.date,{reason:"movement_deleted"});
  }
}


export async function inspectAudPost007ContractPayment(){
  const target=AUD_POST_007_TARGET;
  const snap=await getDoc(ref("contractPayments",target.id));
  if(!snap.exists()) return {state:"missing",id:target.id};
  return {id:target.id,...inspectAudPost007Raw(snap.id,snap.data())};
}

export async function repairAudPost007ContractPayment(){
  const target=AUD_POST_007_TARGET;
  const snap=await getDoc(ref("contractPayments",target.id));
  if(!snap.exists()) return {state:"missing",id:target.id};
  const before=snap.data();
  const inspected=inspectAudPost007Raw(snap.id,before);
  if(inspected.state==="resolved") return {state:"resolved",id:target.id};
  if(inspected.state!=="pending") throw new Error(inspected.blocker||"AUD-POST-007 bloqueado por huella inesperada.");
  const after=sanitizeContractPaymentWrite(before);
  const batch=writeBatch(db);
  batch.update(ref("contractPayments",target.id),{id:deleteField(),updatedAt:serverTimestamp()});
  batch.set(
    doc(col("auditLog")),
    auditPayload("contractPayment",target.id,"UPDATE",before,after,"AUD-POST-007 · eliminación de id interno redundante; Document ID permanece canónico")
  );
  await batch.commit();
  invalidateCollection("contractPayments");
  return {state:"resolved",id:target.id};
}


export async function inspectMig010Transactions(){
  const ids=["FdlrVuBdJL6rKU1zOrU5","ai2H2yT5roUKoPowLubv"];
  const out=[];
  for(const id of ids){
    const snap=await getDoc(ref("transactions",id));
    if(snap.exists()) out.push(normalizeTransaction({id:snap.id,...snap.data()}));
  }
  return out;
}
function assertMig010Fingerprint(row){
  const expected={
    FdlrVuBdJL6rKU1zOrU5:{type:"expense",date:"2026-10-29",transactionDateTime:"2026-10-29T08:42",amount:0.45,description:"BDE - Casa",accountId:"EI0cx2IULsr6RooTzrJF",category:"Transporte",subcategory:"Metro"},
    ai2H2yT5roUKoPowLubv:{type:"expense",date:"2026-10-29",transactionDateTime:"2026-10-29T19:00",amount:0.45,description:"BDE - Casa",accountId:"EI0cx2IULsr6RooTzrJF",category:"Transporte",subcategory:"Metro"}
  }[String(row?.id||"")];
  if(!expected) throw new Error("MIG-010: movimiento fuera del par auditado.");
  const ok=String(row.type||"")===expected.type&&String(row.date||"")===expected.date&&String(row.transactionDateTime||"")===expected.transactionDateTime&&
    Math.abs(Number(row.amount||0)-expected.amount)<.001&&String(row.description||"")===expected.description&&String(row.accountId||"")===expected.accountId&&
    String(row.category||"")===expected.category&&String(row.subcategory||"")===expected.subcategory;
  if(!ok) throw new Error(`MIG-010: ${row.id} ya no coincide con la huella auditada.`);
}
export async function resolveMig010({resolution,deleteId=""}={}){
  if(!["keep_both","delete_duplicate"].includes(resolution)) throw new Error("MIG-010: resolución no válida.");
  const ids=["FdlrVuBdJL6rKU1zOrU5","ai2H2yT5roUKoPowLubv"];
  const snaps=[];
  for(const id of ids){const snap=await getDoc(ref("transactions",id));if(snap.exists())snaps.push(snap);}
  const rows=snaps.map(s=>normalizeTransaction({id:s.id,...s.data()}));
  if(resolution==="keep_both") {
    if(rows.length!==2) throw new Error("MIG-010: deben existir ambos movimientos para confirmar que son distintos.");
    rows.forEach(assertMig010Fingerprint);
    if(rows.every(r=>r.mig010Resolution==="distinct_confirmed")) return {resolution:"distinct",changed:0};
    if(rows.some(r=>r.mig010Resolution)) throw new Error("MIG-010: existe una resolución parcial o inesperada; requiere reauditoría.");
    const batch=writeBatch(db);
    for(const row of rows){
      const after={...row,mig010Resolution:"distinct_confirmed"};
      batch.update(ref("transactions",row.id),{mig010Resolution:"distinct_confirmed",schemaVersion:SCHEMA_VERSION,updatedAt:serverTimestamp()});
      batch.set(doc(col("auditLog")),auditPayload("transaction",row.id,"UPDATE",row,after,"MIG-010 · revisión manual: ambos movimientos son gastos reales distintos"));
    }
    await batch.commit();invalidateCollection("transactions");
    return {resolution:"distinct",changed:2};
  }
  if(!ids.includes(deleteId)) throw new Error("MIG-010: selecciona cuál movimiento duplicado eliminar.");
  if(rows.length!==2) {
    const survivor=rows[0];
    if(rows.length===1&&survivor?.mig010Resolution==="duplicate_resolved") return {resolution:"duplicate",changed:0};
    throw new Error("MIG-010: el par auditado ya no está íntegro; requiere reauditoría.");
  }
  rows.forEach(assertMig010Fingerprint);
  if(rows.some(r=>r.mig010Resolution)) throw new Error("MIG-010: el par ya tiene una resolución registrada.");
  const victim=rows.find(r=>r.id===deleteId),survivor=rows.find(r=>r.id!==deleteId);
  const batch=writeBatch(db);
  batch.delete(ref("transactions",victim.id));
  batch.set(doc(col("auditLog")),auditPayload("transaction",victim.id,"DELETE",victim,null,"MIG-010 · duplicado confirmado manualmente y eliminado"));
  const survivorAfter={...survivor,mig010Resolution:"duplicate_resolved"};
  batch.update(ref("transactions",survivor.id),{mig010Resolution:"duplicate_resolved",schemaVersion:SCHEMA_VERSION,updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("transaction",survivor.id,"UPDATE",survivor,survivorAfter,`MIG-010 · duplicado resuelto; eliminado ${victim.id}`));
  await batch.commit();invalidateCollection("transactions");
  if(victim.accountId&&victim.date) await markReconciliationsNeedsReview([victim.accountId],victim.date,{reason:"mig010_duplicate_deleted"});
  return {resolution:"duplicate",changed:2,deletedId:victim.id,survivorId:survivor.id};
}

export const listCategories=()=>listEntities("categories");
export const saveCategory=(d,id=null)=>saveEntity("categories",d,id,{auditType:"category"});
export const removeCategory=id=>deleteEntity("categories",id,{auditType:"category"});
export const listBudgets=()=>listEntities("budgets").then(r=>r.map(normalizeBudget));
export const saveBudget=(d,id=null)=>saveEntity("budgets",sanitizeBudgetWrite(d),id,{auditType:"budget"});
export const removeBudget=id=>deleteEntity("budgets",id,{auditType:"budget"});
export const listMonthlyPlans=()=>listEntities("monthlyPlans");
export const saveMonthlyPlan=(d,id)=>upsertEntity("monthlyPlans",id||d.month,d,{auditType:"monthlyPlan"});
export const removeMonthlyPlan=id=>deleteEntity("monthlyPlans",id,{auditType:"monthlyPlan"});
export const listRecurring=()=>listEntities("recurring").then(r=>r.map(normalizeRecurring));
export const saveRecurring=(d,id=null)=>saveEntity("recurring",sanitizeRecurringWrite(d),id,{auditType:"recurring"});
export const archiveRecurring=id=>archiveEntity("recurring",id,{auditType:"recurring"});
export const reactivateRecurring=id=>reactivateEntity("recurring",id,{auditType:"recurring"});
export function recurringOccurrenceId(recurringId,occurrence){
  return `recurring_${String(recurringId).replace(/[^A-Za-z0-9_-]/g,"_")}_${String(occurrence).replace(/[^0-9-]/g,"")}`;
}
export async function saveRecurringTransaction(recurring,occurrence,data){
  if(!recurring?.id) throw new Error("Recurrente no válido.");
  if(!/^\d{4}-\d{2}$/.test(String(occurrence||""))) throw new Error("Ocurrencia mensual no válida.");
  if(typeof navigator!=="undefined" && navigator.onLine===false){
    throw new Error("Para registrar un recurrente se requiere conexión. Así se evita registrar la misma ocurrencia desde dos dispositivos.");
  }

  const id=recurringOccurrenceId(recurring.id,occurrence);
  const entityRef=ref("transactions",id);
  const auditRef=doc(col("auditLog"));
  const [year,month]=String(occurrence).split("-").map(Number);
  const maxDay=new Date(year,month,0).getDate();
  const scheduledDay=Math.min(Math.max(1,Number(recurring.dayOfMonth||1)),maxDay);
  const recurringScheduledDate=
    String(data.recurringScheduledDate||"") ||
    `${occurrence}-${String(scheduledDay).padStart(2,"0")}`;

  const payload=sanitizeTransactionWrite({
    ...data,
    recurringId:recurring.id,
    recurringOccurrence:occurrence,
    recurringScheduledDate,
    insurancePolicyId:String(data.insurancePolicyId||recurring.insurancePolicyId||""),
    insurancePremiumPayment:data.insurancePremiumPayment===true||recurring.sourceKind==="insurance_premium",
  });

  try{
    await runTransaction(db,async trx=>{
      const existing=await trx.get(entityRef);
      if(existing.exists()) throw new Error("Este recurrente ya fue registrado para este mes.");
      trx.set(entityRef,{
        ...payload,
        createdAt:serverTimestamp(),
        updatedAt:serverTimestamp()
      });
      trx.set(
        auditRef,
        auditPayload("transaction",id,"CREATE",null,payload,`Ejecución recurrente ${occurrence}`)
      );
    });
  }catch(err){
    const message=String(err?.message||"");
    if(message.includes("ya fue registrado")) throw err;
    throw new Error("No se pudo registrar de forma segura el recurrente. Verifica la conexión e inténtalo nuevamente.");
  }

  invalidateCollection("transactions");

  const accountIds=[payload.accountId,payload.fromAccountId,payload.toAccountId].filter(Boolean);
  if(accountIds.length && payload.date){
    try{
      await markReconciliationsNeedsReview([...new Set(accountIds)],payload.date,{
        reason:"recurring_movement_created"
      });
    }catch(err){
      console.error("No se pudo marcar conciliaciones posteriores para revisión.",err);
    }
  }
  return id;
}

export const listGoals=()=>listEntities("goals");
export const saveGoal=(d,id=null)=>saveEntity("goals",d,id,{auditType:"goal"});
export const archiveGoal=id=>archiveEntity("goals",id,{auditType:"goal"});
export const reactivateGoal=id=>reactivateEntity("goals",id,{auditType:"goal"});
export const listLiabilities=()=>listEntities("liabilities").then(r=>r.map(normalizeLiability));
export const saveLiability=(d,id=null)=>saveEntity("liabilities",sanitizeLiabilityWrite(d),id,{auditType:"liability"});
export const archiveLiability=id=>setLifecycleState("liabilities",id,{active:false,status:"archived",auditType:"liability",action:"ARCHIVE"});
export const reactivateLiability=id=>setLifecycleState("liabilities",id,{active:true,status:"active",auditType:"liability",action:"REACTIVATE"});
export const listFinancingPlans=()=>listEntities("financingPlans").then(r=>r.map(normalizeFinancingPlan));
export const saveFinancingPlan=(d,id=null)=>saveEntity("financingPlans",sanitizeFinancingPlanWrite(d),id,{auditType:"financingPlan"});
export const archiveFinancingPlan=id=>setLifecycleState("financingPlans",id,{active:false,status:"archived",auditType:"financingPlan",action:"ARCHIVE"});
export const reactivateFinancingPlan=id=>setLifecycleState("financingPlans",id,{active:true,status:"active",auditType:"financingPlan",action:"REACTIVATE"});
export const listInsurance=()=>listEntities("insurance");
function insurancePremiumRecurringId(policyId){return `insurance_premium_${String(policyId).replace(/[^A-Za-z0-9_-]/g,"_")}`;}
function insurancePremiumCategory(type){
  if(type==="health") return {category:"Salud",subcategory:"Seguro"};
  if(type==="vehicle") return {category:"Transporte",subcategory:"Seguro"};
  return {category:"Personal",subcategory:"Seguro"};
}
export async function saveInsurance(d,id=null){
  const monthlyPremium=Math.max(0,Number(d?.monthlyPremium||0));
  const premiumAccountId=String(d?.premiumAccountId||"").trim();
  if(monthlyPremium>0&&!premiumAccountId) throw new Error("Selecciona la cuenta desde la que se paga la prima mensual.");
  const policyRef=id?ref("insurance",id):doc(col("insurance"));
  const policyId=policyRef.id;
  const old=id?await getEntity("insurance",id):null;
  const recurringId=insurancePremiumRecurringId(policyId);
  const recurringRef=ref("recurring",recurringId);
  const oldRecurring=await getEntity("recurring",recurringId);
  const cat=insurancePremiumCategory(String(d?.type||"other"));
  const policy={...d,premiumAccountId:premiumAccountId||null,premiumRecurringId:monthlyPremium>0?recurringId:null};
  delete policy.id;
  const batch=writeBatch(db);
  batch.set(policyRef,{...canonicalStamp(policy),createdAt:old?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
  batch.set(doc(col("auditLog")),auditPayload("insurance",policyId,id?"UPDATE":"CREATE",old,policy,"Póliza y prima recurrente vinculadas"));
  if(monthlyPremium>0){
    const recurring=sanitizeRecurringWrite({
      ...(oldRecurring||{}),name:`Seguro · ${String(d?.name||d?.provider||"Póliza").trim()}`,type:"expense",amount:monthlyPremium,
      accountId:premiumAccountId,category:cat.category,subcategory:cat.subcategory,dayOfMonth:Math.min(31,Math.max(1,Number(d?.paymentDay||1))),
      reminderDaysBefore:Math.min(30,Math.max(0,Number(d?.reminderDaysBefore||3))),startDate:String(d?.startDate||""),endDate:String(d?.endDate||"")||null,
      active:d?.active!==false,insurancePolicyId:policyId,sourceKind:"insurance_premium"
    });
    delete recurring.id;
    batch.set(recurringRef,{...canonicalStamp(recurring),createdAt:oldRecurring?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    batch.set(doc(col("auditLog")),auditPayload("recurring",recurringId,oldRecurring?"UPDATE":"CREATE",oldRecurring,recurring,"Prima mensual del seguro"));
  }else if(oldRecurring){
    batch.set(recurringRef,{active:false,updatedAt:serverTimestamp()},{merge:true});
    batch.set(doc(col("auditLog")),auditPayload("recurring",recurringId,"ARCHIVE",oldRecurring,{...oldRecurring,active:false},"Seguro sin prima mensual"));
  }
  await batch.commit();invalidateCollection("insurance");invalidateCollection("recurring");return policyId;
}
export async function archiveInsurance(id){
  const policy=await getEntity("insurance",id);if(!policy) throw new Error("Seguro no encontrado.");
  const recurringId=String(policy.premiumRecurringId||insurancePremiumRecurringId(id));
  const recurring=await getEntity("recurring",recurringId);
  const batch=writeBatch(db);batch.set(ref("insurance",id),{active:false,archivedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
  batch.set(doc(col("auditLog")),auditPayload("insurance",id,"ARCHIVE",policy,{...policy,active:false}));
  if(recurring){batch.set(ref("recurring",recurringId),{active:false,updatedAt:serverTimestamp()},{merge:true});batch.set(doc(col("auditLog")),auditPayload("recurring",recurringId,"ARCHIVE",recurring,{...recurring,active:false},"Póliza archivada"));}
  await batch.commit();invalidateCollection("insurance");invalidateCollection("recurring");
}
export async function reactivateInsurance(id){
  const policy=await getEntity("insurance",id);if(!policy) throw new Error("Seguro no encontrado.");
  const recurringId=String(policy.premiumRecurringId||insurancePremiumRecurringId(id));
  const recurring=await getEntity("recurring",recurringId);
  const batch=writeBatch(db);batch.set(ref("insurance",id),{active:true,updatedAt:serverTimestamp()},{merge:true});
  batch.set(doc(col("auditLog")),auditPayload("insurance",id,"REACTIVATE",policy,{...policy,active:true}));
  if(recurring&&Number(policy.monthlyPremium||0)>0){batch.set(ref("recurring",recurringId),{active:true,updatedAt:serverTimestamp()},{merge:true});batch.set(doc(col("auditLog")),auditPayload("recurring",recurringId,"REACTIVATE",recurring,{...recurring,active:true},"Póliza reactivada"));}
  await batch.commit();invalidateCollection("insurance");invalidateCollection("recurring");
}
export async function registerInsurancePremium(policyId,{date,accountId,hasInvoice=false,invoiceNumber="",vat=0}={}){
  const policy=await getEntity("insurance",policyId);if(!policy) throw new Error("Seguro no encontrado.");
  const premium=Math.max(0,Number(policy.monthlyPremium||0));if(!(premium>0)) throw new Error("Este seguro no tiene prima mensual configurada.");
  const recurringId=String(policy.premiumRecurringId||insurancePremiumRecurringId(policyId));
  const usedAccount=String(accountId||policy.premiumAccountId||"");if(!usedAccount) throw new Error("Selecciona la cuenta de pago de la prima.");
  let recurringRaw=await getEntity("recurring",recurringId);
  if(!recurringRaw || String(policy.premiumAccountId||"")!==usedAccount || !policy.premiumRecurringId){
    await saveInsurance({...policy,premiumAccountId:usedAccount,monthlyPremium:premium,active:policy.active!==false},policyId);
    recurringRaw=await getEntity("recurring",recurringId);
  }
  const recurring=normalizeRecurring(recurringRaw||{id:recurringId,name:`Seguro · ${policy.name||policy.provider}`,type:"expense",amount:premium,accountId:usedAccount,dayOfMonth:policy.paymentDay||1,reminderDaysBefore:policy.reminderDaysBefore||3,startDate:policy.startDate,active:true,insurancePolicyId:policyId,sourceKind:"insurance_premium"});
  recurring.id=recurringId;
  const cat=insurancePremiumCategory(policy.type);
  return saveRecurringTransaction(recurring,String(date||"").slice(0,7),{type:"expense",date,amount:premium,vat:Math.max(0,Number(vat||0)),receipt:"",description:`Prima seguro · ${policy.name||policy.provider}`,hasInvoice:!!hasInvoice,invoiceNumber:hasInvoice?String(invoiceNumber||"").trim():"",invoiceBase:hasInvoice?Math.max(0,premium-Number(vat||0)):0,taxPeriod:hasInvoice&&Number(vat||0)>0?String(date).slice(0,7):"",taxPaymentId:"",vatStatus:hasInvoice&&Number(vat||0)>0?"pending":"none",category:cat.category,subcategory:cat.subcategory,accountId:usedAccount,fromAccountId:null,toAccountId:null,splits:[],insurancePolicyId:policyId,insurancePremiumPayment:true});
}

export async function correctInsurancePremiumPayment(transactionId,{date,amount,accountId,hasInvoice=false,invoiceNumber="",vat=0}={}){
  const oldRaw=await getEntity("transactions",transactionId);
  const oldTx=normalizeTransaction(oldRaw||{});
  if(!oldTx.id || !oldTx.insurancePolicyId || !oldTx.recurringId || oldTx.insuranceUsageId){
    throw new Error("Pago de prima de seguro no encontrado.");
  }
  if(oldTx.taxPaymentId) throw new Error("Este pago ya está vinculado a una liquidación de IVA y no puede corregirse.");
  const policy=await getEntity("insurance",oldTx.insurancePolicyId);
  if(!policy) throw new Error("Seguro vinculado no encontrado.");
  const correctedAmount=Math.max(0,Number(amount||0));
  const correctedVat=Math.max(0,Number(vat||0));
  const correctedDate=String(date||"").slice(0,10);
  const usedAccount=String(accountId||"").trim();
  if(!(correctedAmount>0)) throw new Error("El monto del pago debe ser mayor que cero.");
  if(!usedAccount) throw new Error("Selecciona la cuenta de pago.");
  if(correctedVat>correctedAmount+.009) throw new Error("El IVA no puede superar el monto pagado.");
  const occurrence=correctedDate.slice(0,7);
  if(!/^\d{4}-\d{2}$/.test(occurrence)) throw new Error("Fecha de pago no válida.");
  const recurringId=String(oldTx.recurringId||policy.premiumRecurringId||insurancePremiumRecurringId(policy.id));
  const targetId=recurringOccurrenceId(recurringId,occurrence);
  if(targetId!==oldTx.id){
    const existing=await getEntity("transactions",targetId);
    if(existing) throw new Error("Ya existe una prima registrada para el mes seleccionado.");
  }
  const recurring=await getEntity("recurring",recurringId);
  const [year,month]=occurrence.split("-").map(Number);
  const maxDay=new Date(year,month,0).getDate();
  const scheduledDay=Math.min(Math.max(1,Number(recurring?.dayOfMonth||policy.paymentDay||1)),maxDay);
  const scheduledDate=`${occurrence}-${String(scheduledDay).padStart(2,"0")}`;
  const oldDateTime=String(oldRaw?.transactionDateTime||"");
  const timePart=oldDateTime.includes("T")?oldDateTime.split("T")[1]:"";
  const cat=insurancePremiumCategory(policy.type);
  const txAfter=sanitizeTransactionWrite({
    ...oldRaw,
    id:undefined,
    type:"expense",date:correctedDate,transactionDateTime:timePart?`${correctedDate}T${timePart}`:"",
    amount:correctedAmount,vat:hasInvoice?correctedVat:0,
    accountId:usedAccount,fromAccountId:null,toAccountId:null,
    description:String(oldTx.description||`Prima seguro · ${policy.name||policy.provider}`).trim(),
    receipt:"",hasInvoice:!!hasInvoice,invoiceNumber:hasInvoice?String(invoiceNumber||"").trim():"",
    invoiceBase:hasInvoice?Math.max(0,correctedAmount-correctedVat):0,
    taxPeriod:hasInvoice&&correctedVat>0?occurrence:"",taxPaymentId:"",vatStatus:hasInvoice&&correctedVat>0?"pending":"none",
    category:oldTx.category||cat.category,subcategory:oldTx.subcategory||cat.subcategory,
    recurringId,recurringOccurrence:occurrence,recurringScheduledDate:scheduledDate,
    insurancePolicyId:policy.id,insurancePremiumPayment:true,
    grossDebitAmount:correctedAmount+Math.max(0,Number(oldTx.feeAmount||0))+Math.max(0,Number(oldTx.taxAmount||0))+Math.max(0,Number(oldTx.otherChargeAmount||0))
  });
  delete txAfter.id;
  if(!txAfter.transactionDateTime) delete txAfter.transactionDateTime;
  const batch=writeBatch(db);
  if(targetId===oldTx.id){
    batch.set(ref("transactions",oldTx.id),{...txAfter,updatedAt:serverTimestamp()},{merge:true});
    batch.set(doc(col("auditLog")),auditPayload("transaction",oldTx.id,"UPDATE",oldRaw,txAfter,"Corrección de pago de prima de seguro"));
  }else{
    batch.set(ref("transactions",targetId),{...txAfter,createdAt:oldRaw?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()});
    batch.delete(ref("transactions",oldTx.id));
    batch.set(doc(col("auditLog")),auditPayload("transaction",oldTx.id,"DELETE",oldRaw,null,`Corrección de prima: ocurrencia trasladada a ${occurrence}`));
    batch.set(doc(col("auditLog")),auditPayload("transaction",targetId,"CREATE",null,txAfter,"Corrección de pago de prima de seguro"));
  }
  await batch.commit();
  invalidateCollection("transactions");
  const affected=[oldTx.accountId,usedAccount].filter(Boolean);
  const since=[oldTx.date,correctedDate].filter(Boolean).sort()[0]||correctedDate;
  if(affected.length&&since) await markReconciliationsNeedsReview([...new Set(affected)],since,{reason:"insurance_premium_corrected"});
  return targetId;
}

export async function registerInsuranceCoverage(policyId,usage,transactionData=null){
  const policy=await getEntity("insurance",policyId);
  if(!policy) throw new Error("Seguro no encontrado.");
  const payment=Math.max(0,Number(usage?.paidAmount||0));
  const covered=Math.max(0,Number(usage?.coveredAmount||0));
  if(payment<=0 && covered<=0) throw new Error("Ingresa pago personal o cobertura.");
  const usageId=String(usage?.id||globalThis.crypto?.randomUUID?.()||`insurance-${Date.now()}`);
  const txRef=payment>0?doc(col("transactions")):null;
  const transactionId=txRef?.id||null;
  const event={
    id:usageId,date:String(usage?.date||""),description:String(usage?.description||"").trim(),
    paidAmount:payment,copayAmount:payment,coveredAmount:covered,serviceCost:payment+covered,
    transactionId,hasInvoice:usage?.hasInvoice===true,invoiceNumber:String(usage?.invoiceNumber||""),
    vat:Math.max(0,Number(usage?.vat||0))
  };
  const nextPolicy={...policy,usageEvents:[...(policy.usageEvents||[]),event]};
  delete nextPolicy.id;
  const batch=writeBatch(db);
  batch.set(ref("insurance",policyId),{...nextPolicy,updatedAt:serverTimestamp()},{merge:true});
  batch.set(doc(col("auditLog")),auditPayload("insurance",policyId,"UPDATE",policy,nextPolicy,"Registro de cobertura de seguro"));
  if(txRef){
    const tx=sanitizeTransactionWrite({
      ...(transactionData||{}),type:"expense",date:event.date,amount:payment,
      description:String(transactionData?.description||`Seguro · ${event.description||policy.name||policy.provider}`).trim(),
      category:String(transactionData?.category||"Salud"),subcategory:String(transactionData?.subcategory||"Seguro"),
      insuranceUsageId:usageId,insurancePolicyId:policyId
    });
    batch.set(txRef,{...canonicalStamp(tx),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,"Cobertura de seguro"));
  }
  await batch.commit();
  if(txRef) await markReconciliationsNeedsReview([String(transactionData?.accountId||"")].filter(Boolean),event.date,{reason:"insurance_coverage_created"});
  invalidateCollection("insurance");invalidateCollection("transactions");
  return {usageId,transactionId};
}

export const listAssets=()=>listEntities("assets");
export const saveAsset=(d,id=null)=>saveEntity("assets",d,id,{auditType:"asset"});
function assetInitialCost(row={}){
  return ["purchasePrice","purchaseTaxes","purchaseTransport","purchaseInsurance","initialAccessories","initialCertification","initialSetup","otherInitial"]
    .reduce((sum,key)=>sum+Math.max(0,Number(row?.[key]||0)),0);
}
export async function createAssetWithPurchase(data,{accountId="",historical=false}={}){
  const assetRef=doc(col("assets"));
  const total=assetInitialCost(data);
  if(!historical && total>0 && !accountId) throw new Error("Selecciona la cuenta desde la que se pagó el activo.");
  const txRef=!historical && total>0 ? doc(col("transactions")) : null;
  const clean={...data,purchaseAccountId:accountId||null,purchaseTransactionId:txRef?.id||null,purchaseMovementMode:txRef?"automatic":"historical"};
  const batch=writeBatch(db);
  batch.set(assetRef,{...canonicalStamp(clean),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("asset",assetRef.id,"CREATE",null,clean,"Creación de activo"));
  if(txRef){
    const tx=sanitizeTransactionWrite({type:"expense",date:String(data.purchaseDate||""),amount:total,vat:0,receipt:"",description:`Compra de activo: ${String(data.name||"").trim()}`,category:"Activos",subcategory:"Compra de activo",accountId,fromAccountId:null,toAccountId:null,splits:[],assetId:assetRef.id,economicAmount:total});
    batch.set(txRef,{...canonicalStamp(tx),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,"Compra de activo vinculada"));
  }
  await batch.commit();
  if(txRef) await markReconciliationsNeedsReview([accountId],String(data.purchaseDate||""),{reason:"asset_purchase_created"});
  invalidateCollection("assets");invalidateCollection("transactions");
  return assetRef.id;
}
export async function addAssetEventWithMovement(assetId,event,{accountId="",hasInvoice=false,invoiceNumber="",vat=0}={}){
  const asset=await getEntity("assets",assetId);if(!asset) throw new Error("Activo no encontrado.");
  const amount=Math.max(0,Number(event?.amount||0));if(!(amount>0)) throw new Error("El monto debe ser mayor que cero.");
  if(!accountId) throw new Error("Selecciona la cuenta del movimiento.");
  const tax=Math.max(0,Number(vat||0));if(tax>amount+.009) throw new Error("El IVA no puede superar el monto total.");
  if(hasInvoice && !String(invoiceNumber||"").trim()) throw new Error("Ingresa el número de factura.");
  const eventId=String(event?.id||globalThis.crypto?.randomUUID?.()||`asset-event-${Date.now()}`);
  const txRef=doc(col("transactions"));
  const linked={...event,id:eventId,accountId,transactionId:txRef.id,hasInvoice:hasInvoice===true,invoiceNumber:hasInvoice?String(invoiceNumber||"").trim():"",vat:hasInvoice?tax:0};
  const after={...asset,events:[...(Array.isArray(asset.events)?asset.events:[]),linked]};
  delete after.id;
  const kind=String(event?.kind||"operating_cost");
  const type=kind==="revenue"?"income":"expense";
  const concept=String(event?.concept||"other");
  const subcategory=({maintenance:"Mantenimiento",calibration:"Calibración / certificación",repair:"Reparación",insurance:"Seguro",improvement:"Mejora / ampliación",rental:"Arriendo / uso productivo",other:"Otro"})[concept]||"Otro";
  const tx=sanitizeTransactionWrite({type,date:String(event?.date||""),amount,vat:hasInvoice?tax:0,receipt:hasInvoice?String(invoiceNumber||"").trim():"",description:String(event?.note||"").trim()||`${subcategory}: ${String(asset.name||"")}`,category:"Activos",subcategory,accountId,fromAccountId:null,toAccountId:null,splits:[],assetId,hasInvoice:hasInvoice===true,invoiceNumber:hasInvoice?String(invoiceNumber||"").trim():"",invoiceBase:hasInvoice?Math.max(0,amount-tax):0,taxPeriod:hasInvoice?String(event?.date||"").slice(0,7):"",vatStatus:hasInvoice&&tax>0?"pending":"none",economicAmount:amount});
  const batch=writeBatch(db);
  batch.set(ref("assets",assetId),{...after,updatedAt:serverTimestamp()},{merge:true});
  batch.set(doc(col("auditLog")),auditPayload("asset",assetId,"UPDATE",asset,after,"Evento de activo con movimiento vinculado"));
  batch.set(txRef,{...canonicalStamp(tx),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,"Movimiento generado desde Activos"));
  await batch.commit();
  await markReconciliationsNeedsReview([accountId],String(event?.date||""),{reason:"asset_event_created"});
  invalidateCollection("assets");invalidateCollection("transactions");return txRef.id;
}
export const archiveAsset=id=>archiveEntity("assets",id,{auditType:"asset"});
export const reactivateAsset=id=>reactivateEntity("assets",id,{auditType:"asset"});
export const listContracts=()=>listEntities("contracts").then(r=>r.map(normalizeContract));
export const saveContract=(d,id=null)=>saveEntity("contracts",sanitizeContractWrite(d),id,{auditType:"contract"});
export const archiveContract=id=>archiveEntity("contracts",id,{auditType:"contract"});
export const reactivateContract=id=>reactivateEntity("contracts",id,{auditType:"contract"});
export const listReceivables=()=>listEntities("receivables").then(r=>r.map(normalizeReceivable));
export const saveReceivable=(d,id=null)=>saveEntity("receivables",sanitizeReceivableWrite(d),id,{auditType:"receivable"});
export async function inspectReceivableStoredIds(){
  const snapshot=await getDocs(col("receivables"));
  return snapshot.docs.map(d=>{
    const data=d.data();
    const hasStoredId=Object.prototype.hasOwnProperty.call(data,"id");
    return {
      id:d.id,
      hasStoredId,
      storedId:hasStoredId?String(data.id??""):null,
      contractId:String(data.contractId||""),
      workPeriod:String(data.workPeriod||""),
      amount:Number(data.amount||0),
      paidAmount:Number(data.paidAmount||0),
      status:String(data.status||"pending")
    };
  });
}
export async function removeRedundantReceivableIds(ids=[]){
  const targets=[...new Set(ids.map(x=>String(x||"").trim()).filter(Boolean))];
  if(!targets.length) return 0;
  const snapshot=await getDocs(col("receivables"));
  const byId=new Map(snapshot.docs.map(d=>[d.id,d]));
  const batch=writeBatch(db);
  for(const id of targets){
    const snap=byId.get(id);
    if(!snap) throw new Error(`MIG-009: no existe receivable ${id}.`);
    const before=snap.data();
    if(!Object.prototype.hasOwnProperty.call(before,"id")) continue;
    if(String(before.id??"")!==id) throw new Error(`MIG-009: el id interno de ${id} no coincide con el document ID.`);
    const after={...before}; delete after.id;
    batch.update(ref("receivables",id),{id:deleteField(),updatedAt:serverTimestamp()});
    batch.set(doc(col("auditLog")),auditPayload("receivable",id,"UPDATE",before,after,"MIG-009 · eliminar campo id redundante; document ID queda como identificador canónico"));
  }
  await batch.commit();
  invalidateCollection("receivables");
  return targets.length;
}
export const listInvestments=()=>listEntities("investments").then(r=>r.map(normalizeInvestment));
export async function saveInvestment(d,id=null){
  const clean=sanitizeInvestmentWrite(d);
  if(clean.holdingAccountId){
    const duplicate=(await listInvestments()).find(x=>x.id!==id&&x.active!==false&&x.status==="active"&&String(x.holdingAccountId||"")===String(clean.holdingAccountId));
    if(duplicate) throw new Error(`La cuenta seleccionada ya respalda la inversión activa “${duplicate.name||"sin nombre"}”.`);
  }
  return saveEntity("investments",clean,id,{auditType:"investment"});
}
export async function createInvestmentWithCapital(data,{sourceAccountId="",historical=false}={}){
  const invRef=doc(col("investments"));
  const holdingAccountId=String(data?.holdingAccountId||"");
  if(holdingAccountId){
    const duplicate=(await listInvestments()).find(x=>x.active!==false&&x.status==="active"&&String(x.holdingAccountId||"")===holdingAccountId);
    if(duplicate) throw new Error(`La cuenta seleccionada ya respalda la inversión activa “${duplicate.name||"sin nombre"}”.`);
  }
  const txRef=!historical?doc(col("transactions")):null;
  if(!historical&&!sourceAccountId) throw new Error("Selecciona la cuenta origen del capital.");
  if(!historical&&holdingAccountId&&holdingAccountId===sourceAccountId) throw new Error("La cuenta origen y la cuenta que contiene la inversión deben ser diferentes.");
  const clean=sanitizeInvestmentWrite({...data,sourceAccountId:sourceAccountId||data.sourceAccountId,holdingAccountId,capitalMovementMode:historical?"historical":holdingAccountId?"linked_existing":"automatic",currentBalance:Number(data.currentBalance??data.principal),capitalTransactionId:txRef?.id||""});
  const batch=writeBatch(db);
  batch.set(invRef,{...canonicalStamp(clean),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("investment",invRef.id,"CREATE",null,clean,"Creación de inversión"));
  if(txRef){
    const tx=holdingAccountId
      ? sanitizeTransactionWrite({type:"transfer",date:clean.startDate,amount:clean.principal,vat:0,receipt:"",description:`Capital invertido: ${clean.name}`,category:"Inversiones",subcategory:"Aporte de capital",accountId:null,fromAccountId:sourceAccountId,toAccountId:holdingAccountId,splits:[],investmentId:invRef.id})
      : sanitizeTransactionWrite({type:"investment_out",date:clean.startDate,amount:clean.principal,vat:0,receipt:"",description:`Capital invertido: ${clean.name}`,category:"",subcategory:"",accountId:sourceAccountId,fromAccountId:null,toAccountId:null,splits:[],investmentId:invRef.id});
    batch.set(txRef,{...canonicalStamp(tx),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,holdingAccountId?"Transferencia entre cuentas vinculada a inversión":"Transferencia patrimonial a inversión"));
  }
  await batch.commit();
  if(txRef) await markReconciliationsNeedsReview([sourceAccountId,holdingAccountId].filter(Boolean),String(clean.startDate||""),{reason:"investment_capital_created"});
  invalidateCollection("investments");invalidateCollection("transactions");return invRef.id;
}
export async function addInvestmentContribution(investmentId,{date,amount,accountId}={}){
  const inv=normalizeInvestment(await getEntity("investments",investmentId)||{});if(!inv.id) throw new Error("Inversión no encontrada.");
  const value=Math.max(0,Number(amount||0));if(!(value>0)) throw new Error("El aporte debe ser mayor que cero.");if(!accountId) throw new Error("Selecciona la cuenta origen.");
  if(inv.holdingAccountId&&inv.holdingAccountId===accountId) throw new Error("La cuenta origen y la cuenta que contiene la inversión deben ser diferentes.");
  const txRef=doc(col("transactions"));const current=Math.max(0,Number(inv.currentBalance ?? inv.principal ?? 0));
  const {id:_id,...cleanInv}=sanitizeInvestmentWrite({...inv,currentBalance:current+value,sourceAccountId:accountId,lastContributionDate:date});
  const tx=inv.holdingAccountId
    ? sanitizeTransactionWrite({type:"transfer",date,amount:value,vat:0,receipt:"",description:`Aporte a inversión: ${inv.name}`,category:"Inversiones",subcategory:"Aporte de capital",accountId:null,fromAccountId:accountId,toAccountId:inv.holdingAccountId,splits:[],investmentId})
    : sanitizeTransactionWrite({type:"investment_out",date,amount:value,vat:0,receipt:"",description:`Aporte a inversión: ${inv.name}`,category:"",subcategory:"",accountId,fromAccountId:null,toAccountId:null,splits:[],investmentId});
  const batch=writeBatch(db);batch.set(ref("investments",investmentId),{...canonicalStamp(cleanInv),updatedAt:serverTimestamp()},{merge:true});batch.set(doc(col("auditLog")),auditPayload("investment",investmentId,"UPDATE",inv,cleanInv,"Aporte de capital"));
  batch.set(txRef,{...canonicalStamp(tx),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,inv.holdingAccountId?"Transferencia entre cuentas por aporte de inversión":"Aporte patrimonial a inversión"));
  await batch.commit();
  await markReconciliationsNeedsReview([accountId,inv.holdingAccountId].filter(Boolean),String(date||""),{reason:"investment_contribution_created"});
  invalidateCollection("investments");invalidateCollection("transactions");return txRef.id;
}
export async function settleInvestment(investmentId,{date,accountId,returnedPrincipal,netInterest}={}){
  const inv=normalizeInvestment(await getEntity("investments",investmentId)||{});if(!inv.id) throw new Error("Inversión no encontrada.");if(!accountId) throw new Error("Selecciona la cuenta destino.");
  const capital=Math.max(0,Number(returnedPrincipal||0)),interest=Math.max(0,Number(netInterest||0));if(capital+interest<=0) throw new Error("Ingresa el capital retornado o el rendimiento.");
  if(inv.holdingAccountId&&accountId===inv.holdingAccountId&&capital>0) throw new Error("Para liquidar una inversión respaldada por cuenta, selecciona una cuenta destino diferente.");
  const capRef=capital>0?doc(col("transactions")):null;const intRef=interest>0?doc(col("transactions")):null;
  const transferRef=inv.holdingAccountId&&capital+interest>0?doc(col("transactions")):null;
  const {id:_id,...next}=sanitizeInvestmentWrite({...inv,status:"liquidated",active:false,liquidatedAt:date,actualReturnedPrincipal:capital,actualNetInterest:interest,destinationAccountId:accountId,currentBalance:Math.max(0,Number(inv.currentBalance ?? inv.principal ?? 0)-capital),settlementTransactionIds:[capRef?.id,intRef?.id,transferRef?.id].filter(Boolean)});
  const batch=writeBatch(db);batch.set(ref("investments",investmentId),{...canonicalStamp(next),updatedAt:serverTimestamp()},{merge:true});batch.set(doc(col("auditLog")),auditPayload("investment",investmentId,"UPDATE",inv,next,"Liquidación de inversión"));
  if(inv.holdingAccountId){
    // Si la inversión vive en una cuenta real, el rendimiento se registra primero como ingreso en esa cuenta
    // y luego capital + rendimiento se transfieren a la cuenta destino. Así el saldo de ambas cuentas concuerda.
    if(intRef){const tx=sanitizeTransactionWrite({type:"income",date,amount:interest,vat:0,receipt:"",description:`Rendimiento inversión: ${inv.name}`,category:"Inversiones",subcategory:"Rendimientos",accountId:inv.holdingAccountId,fromAccountId:null,toAccountId:null,splits:[],investmentId,economicAmount:interest});batch.set(intRef,{...canonicalStamp(tx),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});batch.set(doc(col("auditLog")),auditPayload("transaction",intRef.id,"CREATE",null,tx,"Rendimiento real de inversión"));}
    if(transferRef){const tx=sanitizeTransactionWrite({type:"transfer",date,amount:capital+interest,vat:0,receipt:"",description:`Liquidación inversión: ${inv.name}`,category:"Inversiones",subcategory:"Liquidación",accountId:null,fromAccountId:inv.holdingAccountId,toAccountId:accountId,splits:[],investmentId});batch.set(transferRef,{...canonicalStamp(tx),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});batch.set(doc(col("auditLog")),auditPayload("transaction",transferRef.id,"CREATE",null,tx,"Transferencia de liquidación entre cuentas"));}
  }else{
    if(capRef){const tx=sanitizeTransactionWrite({type:"investment_return",date,amount:capital,vat:0,receipt:"",description:`Retorno de capital: ${inv.name}`,category:"",subcategory:"",accountId,fromAccountId:null,toAccountId:null,splits:[],investmentId});batch.set(capRef,{...canonicalStamp(tx),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});batch.set(doc(col("auditLog")),auditPayload("transaction",capRef.id,"CREATE",null,tx,"Retorno patrimonial de inversión"));}
    if(intRef){const tx=sanitizeTransactionWrite({type:"income",date,amount:interest,vat:0,receipt:"",description:`Rendimiento inversión: ${inv.name}`,category:"Inversiones",subcategory:"Rendimientos",accountId,fromAccountId:null,toAccountId:null,splits:[],investmentId,economicAmount:interest});batch.set(intRef,{...canonicalStamp(tx),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});batch.set(doc(col("auditLog")),auditPayload("transaction",intRef.id,"CREATE",null,tx,"Rendimiento real de inversión"));}
  }
  await batch.commit();
  await markReconciliationsNeedsReview([accountId,inv.holdingAccountId].filter(Boolean),String(date||""),{reason:"investment_settlement_created"});
  invalidateCollection("investments");invalidateCollection("transactions");return {capitalTransactionId:capRef?.id||transferRef?.id||"",interestTransactionId:intRef?.id||""};
}
export const archiveInvestment=async()=>{throw new Error("Las inversiones no se archivan directamente. Usa Liquidar, Renovar o Cancelar desde Inversiones.");};
export const reactivateInvestment=async()=>{throw new Error("Una inversión histórica no se reactiva directamente. Usa el flujo de corrección de Inversiones.");};
export const listBusinessTrips=()=>listEntities("businessTrips","startDate")
  .then(r=>r.sort((a,b)=>String(b.startDate).localeCompare(String(a.startDate))));
export const saveBusinessTrip=(d,id=null)=>saveEntity("businessTrips",d,id,{auditType:"businessTrip"});
export const archiveBusinessTrip=id=>archiveEntity("businessTrips",id,{auditType:"businessTrip"});
export const reactivateBusinessTrip=id=>reactivateEntity("businessTrips",id,{auditType:"businessTrip"});

export const listTripExpenses=()=>listEntities("tripExpenses","date")
  .then(r=>r.sort((a,b)=>String(b.date).localeCompare(String(a.date))));
export const listTripSettlements=()=>listEntities("tripSettlements","date")
  .then(r=>r.sort((a,b)=>String(b.date).localeCompare(String(a.date))));

function tripTxBase({type,date,amount,description,accountId,tripId,tripExpenseId="",tripSettlementId="",category="Trabajo",subcategory="Comisión / viáticos",hasInvoice=false,invoiceNumber="",invoiceBase=0,vat=0,taxPeriod="",vatStatus="none"}){
  return {
    type,date,amount:Number(amount||0),vat:Number(vat||0),receipt:"",
    description,
    category,
    subcategory,
    accountId,
    fromAccountId:null,
    toAccountId:null,
    splits:[],
    hasInvoice:!!hasInvoice,
    invoiceNumber:hasInvoice?String(invoiceNumber||"").trim():"",
    invoiceBase:hasInvoice?Number(invoiceBase||0):0,
    taxPeriod:hasInvoice&&Number(vat||0)>0?String(taxPeriod||String(date||"").slice(0,7)):"",
    taxPaymentId:"",
    vatStatus:hasInvoice&&Number(vat||0)>0?String(vatStatus||"pending"):"none",
    businessTripId:tripId,
    tripExpenseId,
    tripSettlementId
  };
}

export async function createTripExpense(data){
  const amountPaid=Math.max(0,Number(data.amountPaid||0));
  const invoiceAmount=Math.max(0,Number(data.invoiceAmount||amountPaid));
  const recognizedAmount=Math.max(0,Number(data.recognizedAmount||0));
  const vat=Math.max(0,Number(data.vat||0));
  const invoiceBase=Math.max(0,Number(data.invoiceBase ?? (amountPaid-vat)));
  const invoiceNumber=String(data.invoiceNumber||"").trim();
  const category=String(data.category||"").trim();
  const subcategory=String(data.subcategory||"").trim();
  if(!data.tripId) throw new Error("Selecciona una comisión.");
  if(!data.date) throw new Error("Indica la fecha.");
  if(!(amountPaid>0)) throw new Error("El gasto real debe ser mayor que cero.");
  if(!data.accountId) throw new Error("Selecciona la cuenta desde la que pagaste.");
  if(!invoiceNumber) throw new Error("El número de factura/comprobante es obligatorio para un gasto de viático.");
  if(!category) throw new Error("Selecciona una categoría.");
  if(vat>=amountPaid&&vat>0) throw new Error("El IVA debe ser menor que el total pagado.");
  if(invoiceBase<0||invoiceBase>amountPaid) throw new Error("La base imponible no es válida.");

  const expenseRef=doc(col("tripExpenses"));
  const txRef=doc(col("transactions"));
  const expense={
    tripId:data.tripId,
    date:data.date,
    category,
    subcategory,
    description:String(data.description||"").trim(),
    amountPaid,
    hasInvoice:true,
    invoiceNumber,
    invoiceAmount:invoiceAmount||amountPaid,
    invoiceBase,
    vat,
    taxPeriod:vat>0?String(data.taxPeriod||String(data.date).slice(0,7)):"",
    vatStatus:vat>0?"pending":"none",
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
    description:expense.description||`Viático · ${category}${subcategory?` · ${subcategory}`:""}`,
    accountId:data.accountId,
    tripId:data.tripId,
    tripExpenseId:expenseRef.id,
    category,
    subcategory,
    hasInvoice:true,
    invoiceNumber,
    invoiceBase,
    vat,
    taxPeriod:expense.taxPeriod,
    vatStatus:expense.vatStatus
  });

  const batch=writeBatch(db);
  batch.set(expenseRef,{...expense,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(txRef,{...tx,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("tripExpense",expenseRef.id,"CREATE",null,expense));
  batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,"Gasto de viático vinculado"));
  await batch.commit();
  invalidateCollection("tripExpenses");invalidateCollection("transactions");
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
  invalidateCollection("tripExpenses");
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
  invalidateCollection("tripExpenses");invalidateCollection("transactions");
}

export async function createTripSettlement(data){
  const amount=Math.max(0,Number(data.amount||0));
  const kind=String(data.kind||"reimbursement");
  if(!["reimbursement","advance","advance_return"].includes(kind)) throw new Error("Tipo de movimiento de comisión no válido.");
  if(!data.tripId) throw new Error("Selecciona una comisión.");
  if(!data.date) throw new Error("Indica la fecha.");
  if(!(amount>0)) throw new Error("El monto debe ser mayor que cero.");
  if(!data.accountId) throw new Error("Selecciona una cuenta.");
  const trip=await getEntity("businessTrips",data.tripId);
  if(!trip) throw new Error("Viático no encontrado.");
  if(kind==="reimbursement"&&String(trip.fundingMode||"")!=="own_funds"){
    throw new Error("Registrar reembolso solo aplica a viáticos pagados con fondos propios.");
  }

  const settlementRef=doc(col("tripSettlements"));
  const txRef=doc(col("transactions"));
  const type={
    reimbursement:"work_reimbursement",
    advance:"work_advance",
    advance_return:"work_advance_return"
  }[kind];
  const label={
    reimbursement:"Reembolso de viático",
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
    tripSettlementId:settlementRef.id,
    category:"Viáticos",
    subcategory:kind==="reimbursement"?"Reembolso":kind==="advance"?"Anticipo":"Devolución de anticipo"
  });

  const batch=writeBatch(db);
  batch.set(settlementRef,{...settlement,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(txRef,{...tx,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("tripSettlement",settlementRef.id,"CREATE",null,settlement));
  batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,tx,label));
  await batch.commit();
  invalidateCollection("tripSettlements");invalidateCollection("transactions");
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


function roundMoney(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100;}
function invoiceStatus(total,paid,dueDate){
  const t=Number(total||0),p=Number(paid||0);
  if(p>=t-.009&&t>0)return "paid";
  if(p>.009)return "partial";
  const today=new Date();
  const iso=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  return dueDate&&dueDate<iso?"overdue":"pending";
}
function invoiceContractualValue(invoice){
  if(!invoice?.receivableId)return 0;
  return roundMoney(invoice.calculationMode==="total_includes_vat"?invoice.totalAmount:invoice.baseAmount);
}
function invoiceContractPaidTarget(invoice,paidAmount){
  const contractual=Math.max(0,Number(invoice?.contractualAmount||invoiceContractualValue(invoice)));
  const total=Math.max(0,Number(invoice?.totalAmount||0)),paid=Math.max(0,Number(paidAmount||0));
  if(!(contractual>0)||!(total>0))return 0;
  return paid>=total-.009?roundMoney(contractual):roundMoney(paid*contractual/total);
}

export const listInvoices=()=>listEntities("invoices","issueDate")
  .then(r=>r.map(normalizeInvoice))
  .then(r=>r.sort((a,b)=>String(b.issueDate).localeCompare(String(a.issueDate))||String(b.invoiceNumber).localeCompare(String(a.invoiceNumber))));

export function isPermissionDeniedError(err){
  const code=String(err?.code||"").toLowerCase();
  const msg=String(err?.message||err||"").toLowerCase();
  return code.includes("permission-denied") || msg.includes("missing or insufficient permissions") || msg.includes("permission denied");
}

export async function listInvoicesOptional(){
  try{return await listInvoices();}
  catch(err){
    if(isPermissionDeniedError(err)){
      console.warn("Facturación no disponible: las reglas Firestore de invoices todavía no están publicadas.",err);
      return [];
    }
    throw err;
  }
}

async function assertUniqueInvoiceNumber(invoiceNumber,excludeId=""){
  const code=String(invoiceNumber||"").trim().toLowerCase();
  const dup=(await listInvoices()).find(x=>x.id!==excludeId&&x.active!==false&&String(x.invoiceNumber||"").trim().toLowerCase()===code);
  if(dup)throw new Error("Ya existe una factura con ese código.");
}

export async function saveInvoice(invoice,id=null){
  let payload=sanitizeInvoiceWrite(invoice);
  await assertUniqueInvoiceNumber(payload.invoiceNumber,id||"");
  let oldInvoice=null;
  if(id){
    oldInvoice=await getEntity("invoices",id);
    if(!oldInvoice)throw new Error("Factura no encontrada.");
    if(Number(oldInvoice.paidAmount||0)>.009||oldInvoice.taxPaymentId){
      const protectedFields=["baseAmount","vatAmount","totalAmount","vatRate","calculationMode","contractualAmount","contractId","receivableId","issueDate"];
      if(protectedFields.some(k=>String(oldInvoice[k]??"")!==String(payload[k]??""))) throw new Error(oldInvoice.taxPaymentId?"Una factura incluida en una liquidación de IVA no puede modificar sus valores tributarios, fecha de emisión ni vínculo contractual.":"Una factura con cobros no puede modificar sus valores financieros ni su vínculo contractual.");
    }
  }
  if(payload.receivableId){
    const r=await getEntity("receivables",payload.receivableId);
    if(!r||r.active===false)throw new Error("La cuenta por cobrar contractual ya no está disponible.");
    const pending=roundMoney(Math.max(0,Number(r.amount||0)-Number(r.paidAmount||0)));
    const contractual=invoiceContractualValue(payload);
    if(Math.abs(contractual-pending)>.02){
      const label=payload.calculationMode==="total_includes_vat"?"El total":"La base";
      throw new Error(`${label} de la factura vinculada debe coincidir con el pendiente contractual (${pending.toFixed(2)}).`);
    }
    payload={...payload,contractualAmount:pending};
    if(r.invoiceId&&r.invoiceId!==id)throw new Error("Este período contractual ya está vinculado a otra factura.");
  }else payload={...payload,contractualAmount:0};
  const invoiceId=await saveEntity("invoices",payload,id,{auditType:"invoice"});
  if(oldInvoice?.receivableId&&oldInvoice.receivableId!==payload.receivableId){
    const oldReceivable=await getEntity("receivables",oldInvoice.receivableId);
    if(oldReceivable?.invoiceId===invoiceId){
      await atomicWrite([{collection:"receivables",id:oldReceivable.id,action:"update",auditType:"receivable",data:{...oldReceivable,invoiceId:null},note:"Factura desvinculada del período contractual"}]);
    }
  }
  if(payload.receivableId){
    const r=await getEntity("receivables",payload.receivableId);
    if(r && r.invoiceId!==invoiceId){
      await atomicWrite([{collection:"receivables",id:r.id,action:"update",auditType:"receivable",data:{...r,invoiceId},note:"Vínculo con factura emitida"}]);
    }
  }
  return invoiceId;
}

export async function createInvoice(invoice,payment=null){
  let payload=sanitizeInvoiceWrite({...invoice,paidAmount:0,paidBaseAmount:0,paidVatAmount:0,status:"pending",active:true});
  await assertUniqueInvoiceNumber(payload.invoiceNumber);
  let receivable=null;
  if(payload.receivableId){
    receivable=await getEntity("receivables",payload.receivableId);
    if(!receivable||receivable.active===false)throw new Error("La cuenta por cobrar contractual ya no está disponible.");
    const pending=roundMoney(Math.max(0,Number(receivable.amount||0)-Number(receivable.paidAmount||0)));
    const contractual=invoiceContractualValue(payload);
    if(Math.abs(contractual-pending)>.02){
      const label=payload.calculationMode==="total_includes_vat"?"El total":"La base";
      throw new Error(`${label} debe coincidir con el pendiente contractual (${pending.toFixed(2)}).`);
    }
    payload={...payload,contractualAmount:pending};
    if(receivable.invoiceId)throw new Error("Este período contractual ya está facturado.");
  }else payload={...payload,contractualAmount:0};
  const invoiceRef=doc(col("invoices"));
  const invoiceId=invoiceRef.id;
  const batch=writeBatch(db);
  let finalInvoice={...payload};
  let txId="";
  const pay=payment&&Number(payment.amount||0)>0?payment:null;
  if(pay){
    if(!payment.accountId)throw new Error("Selecciona la cuenta donde se recibió el cobro.");
    const amount=roundMoney(payment.amount);
    if(amount>payload.totalAmount+.009)throw new Error("El cobro no puede superar el total de la factura.");
    const paidAfter=amount;
    const baseTarget=paidAfter>=payload.totalAmount-.009?payload.baseAmount:roundMoney(paidAfter*payload.baseAmount/payload.totalAmount);
    const vatTarget=roundMoney(paidAfter-baseTarget);
    const contractTarget=invoiceContractPaidTarget(payload,paidAfter);
    finalInvoice={...payload,paidAmount:paidAfter,paidBaseAmount:baseTarget,paidVatAmount:vatTarget,status:invoiceStatus(payload.totalAmount,paidAfter,payload.dueDate)};
    const txRef=doc(col("transactions"));txId=txRef.id;
    const dt=String(payment.transactionDateTime||"").trim();
    const txData=sanitizeTransactionWrite({
      type:"income",date:payment.date,transactionDateTime:dt,amount,vat:vatTarget,hasInvoice:true,invoiceNumber:payload.invoiceNumber,invoiceBase:baseTarget,taxPeriod:payload.taxPeriod,vatStatus:"invoice_linked",
      accountId:payment.accountId,category:"Ingresos",subcategory:"Facturación",description:String(payment.description||`Cobro factura ${payload.invoiceNumber}`),receipt:payload.invoiceNumber,splits:[],
      invoiceId,invoicePaymentId:txRef.id,economicAmount:baseTarget,invoiceVatComponent:vatTarget,contractReceivableComponent:contractTarget
    });
    batch.set(txRef,{...txData,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,txData,"Cobro inicial de factura"));
    if(receivable&&contractTarget>.009){
      const newPaid=Math.min(Number(receivable.amount||0),Number(receivable.paidAmount||0)+contractTarget);
      const status=newPaid>=Number(receivable.amount||0)-.009?"paid":"partial";
      batch.update(ref("receivables",receivable.id),{paidAmount:newPaid,status,invoiceId,updatedAt:serverTimestamp()});
      batch.set(doc(col("auditLog")),auditPayload("receivable",receivable.id,"UPDATE",receivable,{...receivable,paidAmount:newPaid,status,invoiceId},"Cobro de factura vinculada"));
    }
  }else if(receivable){
    batch.update(ref("receivables",receivable.id),{invoiceId,updatedAt:serverTimestamp()});
    batch.set(doc(col("auditLog")),auditPayload("receivable",receivable.id,"UPDATE",receivable,{...receivable,invoiceId},"Factura vinculada al período contractual"));
  }
  batch.set(invoiceRef,{...canonicalStamp(finalInvoice),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("invoice",invoiceId,"CREATE",null,finalInvoice,pay?"Factura emitida y cobrada parcialmente/total":"Factura emitida pendiente"));
  await batch.commit();
  invalidateCollection("invoices");invalidateCollection("transactions");invalidateCollection("receivables");
  if(pay?.accountId&&pay?.date)await markReconciliationsNeedsReview([pay.accountId],pay.date,{reason:"invoice_payment_created"});
  return {invoiceId,transactionId:txId};
}

export async function registerInvoicePayment(invoiceId,payment){
  const invoice=normalizeInvoice(await getEntity("invoices",invoiceId)||{});
  if(!invoice.id)throw new Error("Factura no encontrada.");
  if(invoice.active===false||invoice.status==="void")throw new Error("La factura está anulada.");
  const pending=roundMoney(invoice.totalAmount-invoice.paidAmount);
  const amount=roundMoney(payment.amount);
  if(!(amount>0))throw new Error("El cobro debe ser mayor que cero.");
  if(amount>pending+.009)throw new Error("El cobro supera el saldo pendiente de la factura.");
  if(!payment.accountId)throw new Error("Selecciona la cuenta donde se recibió el cobro.");
  const paidAfter=roundMoney(invoice.paidAmount+amount);
  const baseTarget=paidAfter>=invoice.totalAmount-.009?invoice.baseAmount:roundMoney(paidAfter*invoice.baseAmount/invoice.totalAmount);
  const baseComponent=roundMoney(baseTarget-Number(invoice.paidBaseAmount||0));
  const vatComponent=roundMoney(amount-baseComponent);
  const contractBefore=invoiceContractPaidTarget(invoice,invoice.paidAmount);
  const contractAfter=invoiceContractPaidTarget(invoice,paidAfter);
  const contractComponent=roundMoney(Math.max(0,contractAfter-contractBefore));
  const status=invoiceStatus(invoice.totalAmount,paidAfter,invoice.dueDate);
  const txRef=doc(col("transactions"));
  const txData=sanitizeTransactionWrite({
    type:"income",date:payment.date,transactionDateTime:String(payment.transactionDateTime||""),amount,vat:vatComponent,hasInvoice:true,invoiceNumber:invoice.invoiceNumber,invoiceBase:baseComponent,taxPeriod:invoice.taxPeriod,vatStatus:"invoice_linked",
    accountId:payment.accountId,category:"Ingresos",subcategory:"Facturación",description:String(payment.description||`Cobro factura ${invoice.invoiceNumber}`),receipt:invoice.invoiceNumber,splits:[],
    invoiceId:invoice.id,invoicePaymentId:txRef.id,economicAmount:baseComponent,invoiceVatComponent:vatComponent,contractReceivableComponent:contractComponent
  });
  let receivable=invoice.receivableId?await getEntity("receivables",invoice.receivableId):null;
  const batch=writeBatch(db);
  const after={...invoice,paidAmount:paidAfter,paidBaseAmount:baseTarget,paidVatAmount:roundMoney(Number(invoice.paidVatAmount||0)+vatComponent),status};
  batch.update(ref("invoices",invoice.id),{paidAmount:after.paidAmount,paidBaseAmount:after.paidBaseAmount,paidVatAmount:after.paidVatAmount,status,updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("invoice",invoice.id,"UPDATE",invoice,after,"Registro de cobro de factura"));
  batch.set(txRef,{...txData,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,txData,"Cobro de factura"));
  if(receivable&&contractComponent>.009){
    const newPaid=Math.min(Number(receivable.amount||0),Number(receivable.paidAmount||0)+contractComponent);
    const recStatus=newPaid>=Number(receivable.amount||0)-.009?"paid":"partial";
    batch.update(ref("receivables",receivable.id),{paidAmount:newPaid,status:recStatus,invoiceId:invoice.id,updatedAt:serverTimestamp()});
    batch.set(doc(col("auditLog")),auditPayload("receivable",receivable.id,"UPDATE",receivable,{...receivable,paidAmount:newPaid,status:recStatus,invoiceId:invoice.id},"Cobro proporcional de factura vinculada"));
  }
  await batch.commit();
  invalidateCollection("invoices");invalidateCollection("transactions");invalidateCollection("receivables");
  if(payment.accountId&&payment.date)await markReconciliationsNeedsReview([payment.accountId],payment.date,{reason:"invoice_payment_created"});
  return txRef.id;
}


export async function correctInvoicePayment(transactionId,payment){
  const oldTx=normalizeTransaction(await getEntity("transactions",transactionId)||{});
  if(!oldTx.id||!oldTx.invoiceId)throw new Error("Cobro de factura no encontrado.");
  const invoice=normalizeInvoice(await getEntity("invoices",oldTx.invoiceId)||{});
  if(!invoice.id)throw new Error("Factura vinculada no encontrada.");
  if(invoice.active===false||invoice.status==="void")throw new Error("La factura está anulada.");
  const amount=roundMoney(payment.amount);
  if(!(amount>0))throw new Error("El cobro debe ser mayor que cero.");
  if(!payment.accountId)throw new Error("Selecciona la cuenta donde se recibió el cobro.");
  const linked=(await listTransactions()).filter(t=>t.invoiceId===invoice.id&&t.invoicePaymentId&&t.type==="income");
  const others=linked.filter(t=>t.id!==oldTx.id);
  const otherPaid=roundMoney(others.reduce((sum,t)=>sum+Number(t.amount||0),0));
  const paidAfter=roundMoney(otherPaid+amount);
  if(paidAfter>Number(invoice.totalAmount||0)+.009)throw new Error("La corrección haría que los cobros superen el total de la factura.");
  const ratio=Number(invoice.totalAmount||0)>0?amount/Number(invoice.totalAmount):0;
  const baseComponent=roundMoney(amount>=Number(invoice.totalAmount||0)-.009&&others.length===0?invoice.baseAmount:Number(invoice.baseAmount||0)*ratio);
  const vatComponent=roundMoney(amount-baseComponent);
  const contractual=Math.max(0,Number(invoice.contractualAmount||invoiceContractualValue(invoice)));
  const contractComponent=roundMoney(Number(invoice.totalAmount||0)>0?amount*contractual/Number(invoice.totalAmount):0);
  const otherBase=roundMoney(others.reduce((sum,t)=>sum+Number(t.economicAmount||t.invoiceBase||0),0));
  const otherVat=roundMoney(others.reduce((sum,t)=>sum+Number(t.invoiceVatComponent||t.vat||0),0));
  const paidBase=roundMoney(Math.min(Number(invoice.baseAmount||0),otherBase+baseComponent));
  const paidVat=roundMoney(Math.min(Number(invoice.vatAmount||0),otherVat+vatComponent));
  const status=invoiceStatus(invoice.totalAmount,paidAfter,invoice.dueDate);
  const txAfter=sanitizeTransactionWrite({
    ...oldTx,type:"income",date:payment.date,transactionDateTime:String(payment.transactionDateTime||""),amount,
    accountId:payment.accountId,fromAccountId:null,toAccountId:null,description:String(payment.description||oldTx.description||`Cobro factura ${invoice.invoiceNumber}`),
    receipt:invoice.invoiceNumber,hasInvoice:true,invoiceNumber:invoice.invoiceNumber,invoiceBase:baseComponent,vat:vatComponent,
    taxPeriod:invoice.taxPeriod,vatStatus:"invoice_linked",invoiceId:invoice.id,invoicePaymentId:oldTx.id,
    economicAmount:baseComponent,invoiceVatComponent:vatComponent,contractReceivableComponent:contractComponent
  });
  const batch=writeBatch(db);
  batch.set(ref("transactions",oldTx.id),{...txAfter,updatedAt:serverTimestamp()},{merge:true});
  batch.set(doc(col("auditLog")),auditPayload("transaction",oldTx.id,"UPDATE",oldTx,txAfter,"Corrección de cobro de factura"));
  const invoiceAfter={...invoice,paidAmount:paidAfter,paidBaseAmount:paidBase,paidVatAmount:paidVat,status};
  batch.update(ref("invoices",invoice.id),{paidAmount:paidAfter,paidBaseAmount:paidBase,paidVatAmount:paidVat,status,updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("invoice",invoice.id,"UPDATE",invoice,invoiceAfter,"Corrección de cobro vinculado"));
  if(invoice.receivableId){
    const r=await getEntity("receivables",invoice.receivableId);
    if(r){
      const currentLinkedTotal=roundMoney(linked.reduce((sum,t)=>sum+Number(t.contractReceivableComponent||0),0));
      const otherContract=roundMoney(others.reduce((sum,t)=>sum+Number(t.contractReceivableComponent||0),0));
      const baseline=Math.max(0,roundMoney(Number(r.paidAmount||0)-currentLinkedTotal));
      const newPaid=Math.min(Number(r.amount||0),roundMoney(baseline+otherContract+contractComponent));
      const recStatus=newPaid>=Number(r.amount||0)-.009?"paid":newPaid>.009?"partial":"pending";
      batch.update(ref("receivables",r.id),{paidAmount:newPaid,status:recStatus,invoiceId:invoice.id,updatedAt:serverTimestamp()});
      batch.set(doc(col("auditLog")),auditPayload("receivable",r.id,"UPDATE",r,{...r,paidAmount:newPaid,status:recStatus,invoiceId:invoice.id},"Corrección de cobro de factura vinculada"));
    }
  }
  await batch.commit();
  invalidateCollection("transactions");invalidateCollection("invoices");invalidateCollection("receivables");
  const affected=[oldTx.accountId,payment.accountId].filter(Boolean);
  const since=[oldTx.date,payment.date].filter(Boolean).sort()[0]||payment.date;
  if(affected.length&&since)await markReconciliationsNeedsReview(affected,since,{reason:"invoice_payment_corrected"});
  return oldTx.id;
}

export async function voidInvoice(invoiceId){
  const invoice=normalizeInvoice(await getEntity("invoices",invoiceId)||{});
  if(!invoice.id)throw new Error("Factura no encontrada.");
  if(Number(invoice.paidAmount||0)>.009)throw new Error("Primero revierte todos los cobros asociados antes de anular la factura.");
  if(invoice.taxPaymentId)throw new Error("Esta factura ya fue incluida en una liquidación de IVA y no puede anularse.");
  const batch=writeBatch(db);
  batch.update(ref("invoices",invoice.id),{active:false,status:"void",voidedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("invoice",invoice.id,"VOID",invoice,{...invoice,active:false,status:"void"},"Factura anulada"));
  if(invoice.receivableId){
    const r=await getEntity("receivables",invoice.receivableId);
    if(r&&r.invoiceId===invoice.id){
      batch.update(ref("receivables",r.id),{invoiceId:null,updatedAt:serverTimestamp()});
      batch.set(doc(col("auditLog")),auditPayload("receivable",r.id,"UPDATE",r,{...r,invoiceId:""},"Factura anulada; se libera vínculo contractual"));
    }
  }
  await batch.commit();invalidateCollection("invoices");invalidateCollection("receivables");
}

export const listTaxPayments=()=>listEntities("taxPayments","paymentDate")
  .then(r=>r.sort((a,b)=>String(b.paymentDate).localeCompare(String(a.paymentDate))));

export async function saveTaxPayment(payment,transactionInvoiceIds=[],invoiceEntityIds=[]){
  const txIds=[...new Set(transactionInvoiceIds)].filter(Boolean);
  const entityIds=[...new Set(invoiceEntityIds)].filter(Boolean);
  if(!payment.period) throw new Error("Selecciona el período tributario.");
  if(!txIds.length&&!entityIds.length) throw new Error("Selecciona al menos un comprobante.");
  if(Number(payment.paidVat||0)<0) throw new Error("El valor pagado no puede ser negativo.");
  if(Number(payment.paidVat||0)>0 && !payment.accountId) throw new Error("Selecciona la cuenta desde la que se pagó el IVA.");

  const txInvoices=[];
  for(const id of txIds){
    const row=await getEntity("transactions",id);
    if(!row) throw new Error("Uno de los movimientos con IVA ya no existe.");
    const isGenerated=row.type==="income"&&Number(row.vat||0)>0&&!row.invoiceId;
    const isCredit=["expense","work_expense"].includes(row.type)&&Number(row.vat||0)>0&&row.hasInvoice===true;
    if((!isGenerated&&!isCredit)||row.taxPaymentId||row.vatStatus==="paid"){
      throw new Error("Solo pueden liquidarse movimientos pendientes con IVA generado o IVA a favor.");
    }
    const period=String(row.taxPeriod||row.date||"").slice(0,7);
    if(period!==payment.period) throw new Error("Todos los comprobantes deben pertenecer al mismo período.");
    txInvoices.push({...row,_taxRole:isCredit?"credit":"generated"});
  }
  const entityInvoices=[];
  for(const id of entityIds){
    const row=normalizeInvoice(await getEntity("invoices",id)||{});
    if(!row.id) throw new Error("Una de las facturas emitidas ya no existe.");
    if(row.active===false||row.status==="void"||Number(row.vatAmount||0)<=0||row.taxPaymentId||row.vatStatus==="paid"){
      throw new Error("Solo pueden liquidarse facturas emitidas con IVA pendientes.");
    }
    if(String(row.taxPeriod||row.issueDate||"").slice(0,7)!==payment.period) throw new Error("Todos los comprobantes deben pertenecer al mismo período.");
    entityInvoices.push(row);
  }

  const generatedVat=moneyRound(
    txInvoices.filter(x=>x._taxRole==="generated").reduce((s,x)=>s+Number(x.vat||0),0)+
    entityInvoices.reduce((s,x)=>s+Number(x.vatAmount||0),0)
  );
  const creditVat=moneyRound(txInvoices.filter(x=>x._taxRole==="credit").reduce((s,x)=>s+Number(x.vat||0),0));
  const expectedVat=moneyRound(Math.max(0,generatedVat-creditVat));
  const creditBalance=moneyRound(Math.max(0,creditVat-generatedVat));
  const paymentRef=doc(col("taxPayments"));
  const paymentId=paymentRef.id;
  const batch=writeBatch(db);
  const data={
    period:payment.period,invoiceIds:txIds,invoiceEntityIds:entityIds,
    generatedVat,creditVat,expectedVat,creditBalance,paidVat:Number(payment.paidVat||0),accountId:payment.accountId||"",
    paymentDate:payment.paymentDate,notes:String(payment.notes||""),status:"paid"
  };
  batch.set(paymentRef,{...data,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(doc(col("auditLog")),auditPayload("taxPayment",paymentId,"CREATE",null,data,`Liquidación de IVA ${payment.period}`));
  for(const invoice of txInvoices){
    const before={...invoice}; delete before._taxRole;
    const changes={taxPaymentId:paymentId,vatStatus:"paid",updatedAt:serverTimestamp()};
    batch.update(ref("transactions",invoice.id),changes);
    batch.set(doc(col("auditLog")),auditPayload("transaction",invoice.id,"UPDATE",before,{...before,taxPaymentId:paymentId,vatStatus:"paid"},`Comprobante incluido en liquidación IVA ${payment.period}`));
  }
  for(const invoice of entityInvoices){
    const changes={taxPaymentId:paymentId,vatStatus:"paid",updatedAt:serverTimestamp()};
    batch.update(ref("invoices",invoice.id),changes);
    batch.set(doc(col("auditLog")),auditPayload("invoice",invoice.id,"UPDATE",invoice,{...invoice,taxPaymentId:paymentId,vatStatus:"paid"},`Factura incluida en liquidación IVA ${payment.period}`));
  }
  if(Number(payment.paidVat||0)>0){
    const txRef=doc(col("transactions"));
    const txData=sanitizeTransactionWrite({type:"expense",date:payment.paymentDate,amount:Number(payment.paidVat||0),vat:0,receipt:"",description:`Pago IVA · ${payment.period}`,category:"Impuestos",subcategory:"IVA",accountId:payment.accountId,fromAccountId:null,toAccountId:null,splits:[],hasInvoice:false,invoiceNumber:"",invoiceBase:0,taxPeriod:"",taxPaymentId:paymentId,vatStatus:"none"});
    batch.set(txRef,{...txData,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(doc(col("auditLog")),auditPayload("transaction",txRef.id,"CREATE",null,txData,"Pago real de IVA"));
  }
  await batch.commit();
  invalidateCollection("taxPayments");invalidateCollection("transactions");invalidateCollection("invoices");
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
    const periodKeys=contractDesiredPeriodKeys(c,todayIso);
    if(!periodKeys.length && c.active===false && !c.endDate) continue;
    const desired=new Set();
    for(const period of periodKeys){
      const calc=contractPeriodCalculation(c,period);
      if(!calc) continue;
      const key=`${c.id}|${period}`;
      desired.add(key);
      const dueBase=contractBillingCycleMode(c)==="anniversary"?String(calc.earnedAt).slice(0,7):period;
      const expected={
        contractId:c.id,workPeriod:period,amount:calc.amount,paidAmount:0,
        dueDate:dueDateForContractPeriod(dueBase,c.paymentLagMonths,c.paymentDay),
        status:"pending",active:true,serviceStart:calc.serviceStart,serviceEnd:calc.serviceEnd,
        workedDays:calc.workedDays,monthDays:calc.monthDays,prorated:calc.prorated,earnedAt:calc.earnedAt,
        billingCycleMode:contractBillingCycleMode(c),voidReason:""
      };
      const old=byKey.get(key);
      if(!old){
        const id=await saveReceivable(expected);
        byKey.set(key,{id,...expected});
      }else if(Number(old.paidAmount||0)<=.009 && receivableNeedsSync(old,expected)){
        const updated={...old,...expected,paidAmount:Number(old.paidAmount||0)};
        await saveReceivable(updated,old.id);
        byKey.set(key,updated);
      }
    }
    if(c.active!==false && c.endDate && String(c.endDate)<=todayIso) scheduledToClose.push(c);
    for(const old of [...byKey.values()].filter(r=>r.contractId===c.id)){
      const key=`${old.contractId}|${old.workPeriod}`;
      if(old.active!==false && Number(old.paidAmount||0)<=.009 && !desired.has(key)){
        const archived={...old,active:false,status:"void",voidReason:"unearned_period"};
        await saveReceivable(archived,old.id);
        byKey.set(key,archived);
      }
    }
  }

  for(const c of scheduledToClose) await saveContract({...c,active:false},c.id);
  return listReceivables();
}

export const listAudit=()=>listEntities("auditLog");

export function accountLedgerStartDate(account){
  return String(account?.ledgerStartDate||account?.openingBalanceAsOf||"").slice(0,10);
}
export function transactionInAccountLedger(account,transaction){
  const start=accountLedgerStartDate(account);
  const date=String(transaction?.date||"").slice(0,10);
  return !start || !date || date>=start;
}
export function calculateBalances(accounts,transactions){
  const b=Object.fromEntries(accounts.map(a=>[a.id,Number(a.openingBalance||0)]));
  const byId=Object.fromEntries(accounts.map(a=>[a.id,a]));
  for(const t of transactions){
    const m=Number(t.amount||0);
    const charges=Math.max(0,Number(t.feeAmount||0))+Math.max(0,Number(t.taxAmount||0))+Math.max(0,Number(t.otherChargeAmount||0));
    const applies=id=>id in b && transactionInAccountLedger(byId[id],t);
    if(["income","work_reimbursement","work_advance"].includes(t.type)&&applies(t.accountId))b[t.accountId]+=m;
    if(["expense","work_expense","work_advance_return"].includes(t.type)&&applies(t.accountId))b[t.accountId]-=(m+charges);
    if(t.type==="transfer"){
      if(applies(t.fromAccountId))b[t.fromAccountId]-=(m+charges);
      if(applies(t.toAccountId))b[t.toAccountId]+=m;
    }
    if(t.type==="investment_out"&&applies(t.accountId))b[t.accountId]-=m;
    if(t.type==="investment_return"&&applies(t.accountId))b[t.accountId]+=m;
  }
  return b;
}
export function calculateBalanceAtDate(account,transactions,date){
  let balance=Number(account?.openingBalance||0);
  for(const t of transactions){
    if(String(t.date)>String(date)||!transactionInAccountLedger(account,t)) continue;
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
