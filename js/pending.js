import {requireUser} from "./guard.js";
import {
  listRecurring,listTransactions,listLiabilities,listFinancingPlans,listAccounts,listCategories,
  saveRecurring,saveRecurringTransaction,saveLiability,saveFinancingPlan
} from "./data-service.js";
import {buildPendingItems} from "./pending-engine.js";
import {money,escapeHtml} from "./utils.js";
import {toast} from "./ui.js";

let items=[],filter="all",recurring=[],transactions=[],liabilities=[],plans=[],accounts=[],categories=[];
let selectedItem=null,txTarget=null,historicalTarget=null;
const list=document.querySelector("#pending-list");
const summary=document.querySelector("#pending-summary");
const detailDialog=document.querySelector("#pending-detail-dialog");
const txDialog=document.querySelector("#pending-transaction-dialog");
const historicalDialog=document.querySelector("#pending-historical-dialog");

function statusLabel(x){return x==="overdue"?"Vencido":x==="today"?"Vence hoy":"Próximo";}
function renderSummary(){
  if(!summary)return;
  const overdue=items.filter(x=>x.status==="overdue").length;
  const today=items.filter(x=>x.status==="today").length;
  const upcoming=items.filter(x=>x.status==="upcoming").length;
  summary.innerHTML=`<div class="tf-section-heading"><div><div class="tf-section-kicker">Centro de pendientes</div><h2>${items.length} pendiente(s)</h2><div class="tf-muted">${overdue} vencido(s) · ${today} hoy · ${upcoming} próximo(s)</div></div></div>`;
}
function render(){
  renderSummary();
  const rows=items.filter(x=>filter==="all"||x.status===filter);
  list.innerHTML=rows.map(x=>`<button type="button" class="tf-card tf-pending-card-button" data-pending-key="${escapeHtml(x.key)}"><div class="tf-section-heading"><div><div class="tf-section-kicker">${statusLabel(x.status)}</div><h3>${escapeHtml(x.title)}</h3></div><strong>${money(x.amount)}</strong></div><div class="tf-muted">${escapeHtml(x.subtitle)} · ${escapeHtml(x.dueDate)}</div><div class="tf-pending-open-hint">Ver detalle ›</div></button>`).join("")||`<div class="tf-card tf-empty">No hay pendientes en este filtro.</div>`;
}
function openPending(item){
  if(!item||!detailDialog)return;
  selectedItem=item;
  document.querySelector("#pending-detail-status").textContent=statusLabel(item.status);
  document.querySelector("#pending-detail-title").textContent=item.title;
  document.querySelector("#pending-detail-body").innerHTML=`<div class="tf-detail-grid"><div class="tf-metric"><span class="tf-metric-label">Monto</span><strong>${money(item.amount)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Vence</span><strong>${escapeHtml(item.dueDate)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Detalle</span><strong>${escapeHtml(item.subtitle||"—")}</strong></div></div>`;
  const action=document.querySelector("#pending-detail-action");
  action.textContent=item.actionLabel||"Abrir acción";
  const historical=document.querySelector("#pending-detail-historical");
  const note=document.querySelector("#pending-detail-historical-note");
  const showHistorical=item.status==="overdue";
  historical.hidden=!showHistorical;
  note.hidden=!showHistorical;
  detailDialog.showModal();
}
function categoriesFor(type){
  return categories.filter(x=>x.type===type);
}
function fillCategoryOptions(type,category,subcategory){
  const catSel=document.querySelector("#pending-tx-category");
  const subSel=document.querySelector("#pending-tx-subcategory");
  const rows=categoriesFor(type);
  const cats=[...new Set(rows.map(x=>x.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es"));
  if(category&&!cats.includes(category))cats.unshift(category);
  catSel.innerHTML=cats.map(x=>`<option value="${escapeHtml(x)}" ${x===category?"selected":""}>${escapeHtml(x)}</option>`).join("");
  const chosen=catSel.value||category||cats[0]||"";
  const subs=[...new Set(rows.filter(x=>x.category===chosen).map(x=>x.subcategory).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es"));
  if(subcategory&&!subs.includes(subcategory))subs.unshift(subcategory);
  subSel.innerHTML=subs.map(x=>`<option value="${escapeHtml(x)}" ${x===subcategory?"selected":""}>${escapeHtml(x)}</option>`).join("");
}
function openRecurringEditor(item){
  const r=recurring.find(x=>x.id===item.entityId);
  if(!r){toast("No se encontró el recurrente.");return;}
  txTarget={item,recurring:r};
  document.querySelector("#pending-tx-title").textContent=r.type==="income"?"Registrar ingreso pendiente":"Registrar pago pendiente";
  document.querySelector("#pending-tx-date").value=item.dueDate;
  document.querySelector("#pending-tx-time").value="12:00";
  document.querySelector("#pending-tx-description").value=r.name||"";
  document.querySelector("#pending-tx-amount").value=Number(r.amount||0);
  document.querySelector("#pending-tx-account").innerHTML=accounts.filter(a=>a.active!==false).map(a=>`<option value="${a.id}" ${a.id===r.accountId?"selected":""}>${escapeHtml(`${a.bank||"Cuenta"} · ${a.alias||""}`)}</option>`).join("");
  fillCategoryOptions(r.type,r.category,r.subcategory);
  detailDialog?.close();
  txDialog?.showModal();
}
function openHistorical(item){
  historicalTarget=item;
  document.querySelector("#pending-historical-description").innerHTML=`<strong>${escapeHtml(item.title)}</strong><div class="tf-muted" style="margin-top:.35rem">${escapeHtml(item.subtitle||"")} · ${escapeHtml(item.dueDate)}</div>`;
  const wrap=document.querySelector("#pending-historical-date-wrap");
  const date=document.querySelector("#pending-historical-date");
  const needsDate=item.kind!=="recurring";
  wrap.hidden=!needsDate;
  date.value=item.dueDate;
  detailDialog?.close();
  historicalDialog?.showModal();
}
function contiguousPaidThrough(schedule=[]){
  let n=0;
  for(const row of [...schedule].sort((a,b)=>Number(a.n)-Number(b.n))){
    if(row.status!=="paid")break;
    n=Number(row.n||n);
  }
  return n;
}
async function closeHistorical(item,paidDate){
  if(item.kind==="recurring"){
    const r=recurring.find(x=>x.id===item.entityId); if(!r)throw new Error("Recurrente no encontrado.");
    const history=[...(Array.isArray(r.historicalResolvedOccurrences)?r.historicalResolvedOccurrences:[]),item.occurrence]
      .filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).sort();
    await saveRecurring({...r,historicalResolvedOccurrences:history},r.id);
    return;
  }
  if(item.kind==="debt"){
    const d=liabilities.find(x=>x.id===item.entityId); if(!d)throw new Error("Deuda no encontrada.");
    const n=Number(item.installmentNumber||0);
    const schedule=(Array.isArray(d.schedule)?d.schedule:[]).map(row=>Number(row.n)===n?{...row,status:"paid",paidAmount:Number(row.payment||0),paidDate,historicalPayment:true}:row);
    const paidThrough=contiguousPaidThrough(schedule);
    const next=[...schedule].sort((a,b)=>Number(a.n)-Number(b.n)).find(row=>row.status!=="paid");
    await saveLiability({...d,schedule,paidThroughInstallment:paidThrough,currentInstallment:next?.n||d.termMonths,status:next?"active":"paid_off",paidOffDate:next?d.paidOffDate:paidDate},d.id);
    return;
  }
  if(item.kind==="card"){
    const p=plans.find(x=>x.id===item.entityId); if(!p)throw new Error("Plan no encontrado.");
    const n=Number(item.installmentNumber||0);
    const schedule=(Array.isArray(p.schedule)?p.schedule:[]).map(row=>Number(row.n)===n?{...row,status:"paid",paidAmount:Number(row.payment||0),paidDate,historicalPayment:true}:row);
    const paidThrough=contiguousPaidThrough(schedule);
    const next=[...schedule].sort((a,b)=>Number(a.n)-Number(b.n)).find(row=>row.status!=="paid");
    const calculatedPending=schedule.reduce((total,row)=>total+Math.max(0,Number(row.payment||0)-Number(row.paidAmount||0)),0);
    await saveFinancingPlan({...p,schedule,paidThroughInstallment:paidThrough,currentInstallment:next?.n||p.installmentCount,calculatedPending,status:next?"active":"paid_off",paidOffDate:next?p.paidOffDate:paidDate},p.id);
    return;
  }
  throw new Error("Tipo de pendiente no soportado.");
}
async function load(){
  [recurring,transactions,liabilities,plans,accounts,categories]=await Promise.all([
    listRecurring(),listTransactions(),listLiabilities(),listFinancingPlans(),listAccounts({includeArchived:false}),listCategories()
  ]);
  items=buildPendingItems({recurring,transactions,liabilities,plans,accounts});
  render();
}

document.querySelectorAll("[data-pending-filter]").forEach(b=>b.addEventListener("click",()=>{
  filter=b.dataset.pendingFilter;
  document.querySelectorAll("[data-pending-filter]").forEach(x=>x.classList.toggle("is-selected",x===b));
  render();
}));
list?.addEventListener("click",e=>{
  const b=e.target.closest("[data-pending-key]");if(!b)return;
  openPending(items.find(x=>x.key===b.dataset.pendingKey));
});
document.querySelector("#pending-detail-close")?.addEventListener("click",()=>detailDialog?.close());
document.querySelector("#pending-detail-action")?.addEventListener("click",()=>{
  const item=selectedItem;if(!item)return;
  if(item.kind==="recurring"){openRecurringEditor(item);return;}
  window.location.href=item.url;
});
document.querySelector("#pending-detail-historical")?.addEventListener("click",()=>{
  if(selectedItem?.status==="overdue")openHistorical(selectedItem);
});
document.querySelector("#pending-tx-close")?.addEventListener("click",()=>{txTarget=null;txDialog?.close();});
document.querySelector("#pending-tx-category")?.addEventListener("change",()=>{
  if(!txTarget)return;
  fillCategoryOptions(txTarget.recurring.type,document.querySelector("#pending-tx-category").value,"");
});
document.querySelector("#pending-tx-save")?.addEventListener("click",async()=>{
  if(!txTarget)return;
  const {item,recurring:r}=txTarget;
  const date=document.querySelector("#pending-tx-date").value||item.dueDate;
  const time=document.querySelector("#pending-tx-time").value||"12:00";
  const amount=Number(document.querySelector("#pending-tx-amount").value||0);
  const accountId=document.querySelector("#pending-tx-account").value;
  if(!(amount>0)||!accountId){toast("Revisa monto y cuenta.");return;}
  const button=document.querySelector("#pending-tx-save");button.disabled=true;
  try{
    await saveRecurringTransaction(r,item.occurrence,{
      type:r.type,date,transactionDateTime:`${date}T${time}`,
      description:document.querySelector("#pending-tx-description").value.trim()||r.name,
      amount,accountId,category:document.querySelector("#pending-tx-category").value,
      subcategory:document.querySelector("#pending-tx-subcategory").value,
      vat:0,receipt:"",splits:[],hasInvoice:false,invoiceNumber:"",invoiceBase:0,taxPeriod:"",vatStatus:"none"
    });
    txTarget=null;txDialog?.close();toast(r.type==="income"?"Ingreso pendiente registrado.":"Pago pendiente registrado.");
    await load();
  }catch(err){toast(err?.message||"No se pudo registrar el pendiente.");}
  finally{button.disabled=false;}
});
document.querySelector("#pending-historical-close")?.addEventListener("click",()=>{historicalTarget=null;historicalDialog?.close();});
document.querySelector("#pending-historical-save")?.addEventListener("click",async()=>{
  const item=historicalTarget;if(!item)return;
  const paidDate=document.querySelector("#pending-historical-date").value||item.dueDate;
  const button=document.querySelector("#pending-historical-save");button.disabled=true;
  try{
    await closeHistorical(item,paidDate);
    historicalTarget=null;historicalDialog?.close();toast("Pendiente cerrado como histórico.");
    await load();
  }catch(err){toast(err?.message||"No se pudo cerrar el pendiente histórico.");}
  finally{button.disabled=false;}
});

requireUser(()=>load().catch(err=>{console.error("No se pudieron cargar Pendientes.",err);toast("No se pudieron cargar Pendientes.");}));
