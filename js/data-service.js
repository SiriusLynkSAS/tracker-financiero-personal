import {
  collection, doc, addDoc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

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
export const saveTransaction=(d,id=null)=>saveEntity("transactions",d,id,{auditType:"transaction"});
export const removeTransaction=id=>deleteEntity("transactions",id,{auditType:"transaction"});

export const listCategories=()=>listEntities("categories");
export const saveCategory=(d,id=null)=>saveEntity("categories",d,id,{auditType:"category"});
export const removeCategory=id=>deleteEntity("categories",id,{auditType:"category"});
export const listBudgets=()=>listEntities("budgets");
export const saveBudget=(d,id=null)=>saveEntity("budgets",d,id,{auditType:"budget"});
export const removeBudget=id=>deleteEntity("budgets",id,{auditType:"budget"});
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
export const listReconciliations=()=>listEntities("reconciliations","date");
export const saveReconciliation=(d,id=null)=>saveEntity("reconciliations",d,id,{auditType:"reconciliation"});
export const listAudit=()=>listEntities("auditLog");

export function calculateBalances(accounts,transactions){
  const b=Object.fromEntries(accounts.map(a=>[a.id,Number(a.openingBalance||0)]));
  for(const t of transactions){
    const m=Number(t.amount||0);
    if(t.type==="income"&&t.accountId in b)b[t.accountId]+=m;
    if(t.type==="expense"&&t.accountId in b)b[t.accountId]-=m;
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
    if(t.type==="income"&&t.accountId===account.id) balance+=m;
    if(t.type==="expense"&&t.accountId===account.id) balance-=m;
    if(t.type==="transfer"){
      if(t.fromAccountId===account.id) balance-=m;
      if(t.toAccountId===account.id) balance+=m;
    }
    if(t.type==="investment_out"&&t.accountId===account.id) balance-=m;
    if(t.type==="investment_return"&&t.accountId===account.id) balance+=m;
  }
  return balance;
}
