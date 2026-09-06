import {requireUser} from "./guard.js";
import {listContracts,saveContract,listReceivables,listAssets,listAccounts,atomicWrite,syncReceivablesClosed} from "./data-service.js";
import {escapeHtml,money,todayISO,addMonthsISO,sum} from "./utils.js";
import {confirmAction,toast} from "./ui.js";
let contracts=[],receivables=[],assets=[],accounts=[];const list=document.querySelector("#contract-list"),tbody=document.querySelector("#recv-body");

function assetName(id){return assets.find(x=>x.id===id)?.name||"—"}
function tariffFor(c,period){const ts=[...(c.tariffPeriods||[])].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));let amount=Number(c.initialMonthlyRate||0);for(const t of ts)if(t.effectiveFrom.slice(0,7)<=period)amount=Number(t.amount);return amount}
function monthSeq(start,end){const out=[];let cur=start.slice(0,7)+"-01",stop=end.slice(0,7);while(cur.slice(0,7)<=stop){out.push(cur.slice(0,7));cur=addMonthsISO(cur,1)}return out}
function statusOf(r){const pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0));return pending<=.009?"paid":Number(r.paidAmount)>0?"partial":r.dueDate<todayISO()?"overdue":"pending"}
async function sync(){
  receivables=await syncReceivablesClosed();
}
function render(){
  document.querySelector("#tariff-contract").innerHTML=contracts.filter(x=>x.active!==false).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  document.querySelector("#payment-account").innerHTML=accounts.filter(a=>a.active!==false&&a.accountType!=="credit_card").map(a=>`<option value="${a.id}">${escapeHtml(a.bank+" · "+a.alias)}</option>`).join("");
  list.innerHTML=contracts.filter(x=>x.active!==false).map(c=>{
    const rr=receivables.filter(r=>r.contractId===c.id),gen=sum(rr,r=>r.amount),paid=sum(rr,r=>r.paidAmount),transport=Number(c.monthlyTransportEstimate||0)*rr.length;
    return`<div class="tf-card"><strong>${escapeHtml(c.name)}</strong><div class="tf-muted">${escapeHtml(assetName(c.assetId))} · desde ${c.startDate} · fin ${c.endDate||"indefinido"}</div><div class="tf-detail-grid" style="margin-top:.8rem"><div class="tf-metric"><span class="tf-metric-label">Generado</span><strong>${money(gen)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Cobrado</span><strong>${money(paid)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Por cobrar</span><strong>${money(gen-paid)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Transporte estimado</span><strong>${money(transport)}</strong></div></div><div class="tf-actions"><button class="tf-btn tf-btn-secondary" data-finish="${c.id}">Finalizar</button></div></div>`;
  }).join("")||`<div class="tf-card tf-empty">Sin contratos.</div>`;
  tbody.innerHTML=receivables.sort((a,b)=>a.workPeriod.localeCompare(b.workPeriod)).map(r=>{
    const c=contracts.find(x=>x.id===r.contractId),pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0)),st=statusOf(r);
    return`<tr><td><input type="checkbox" data-recv="${r.id}" ${pending<=.009?"disabled":""}></td><td>${escapeHtml(c?.name||"—")}</td><td>${r.workPeriod}</td><td>${money(r.amount)}</td><td>${money(r.paidAmount)}</td><td>${money(pending)}</td><td>${r.dueDate}</td><td><span class="tf-pill ${st==="paid"?"tf-pill-ok":st==="overdue"?"tf-pill-danger":"tf-pill-warn"}">${st}</span></td></tr>`;
  }).join("")||`<tr><td colspan="8" class="tf-empty">Sin cuentas por cobrar.</td></tr>`;
}
async function refresh(){
  [contracts,receivables,assets,accounts]=await Promise.all([listContracts(),listReceivables(),listAssets(),listAccounts()]);
  document.querySelector("#contract-asset").innerHTML=`<option value="">Sin activo</option>`+assets.filter(a=>a.active!==false).map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  await sync();render();
}
document.querySelector("#contract-start").value=todayISO();document.querySelector("#tariff-from").value=todayISO();

document.querySelector("#contract-form").addEventListener("submit",async e=>{
  e.preventDefault();
  await saveContract({name:document.querySelector("#contract-name").value.trim(),assetId:document.querySelector("#contract-asset").value||null,startDate:document.querySelector("#contract-start").value,endDate:document.querySelector("#contract-end").value||null,paymentLagMonths:Number(document.querySelector("#contract-lag").value||0),paymentDay:Number(document.querySelector("#contract-pay-day").value||1),initialMonthlyRate:Number(document.querySelector("#contract-rate").value),monthlyTransportEstimate:Number(document.querySelector("#contract-transport").value||0),tariffPeriods:[],active:true});
  e.target.reset();document.querySelector("#contract-start").value=todayISO();toast("Contrato guardado.");await refresh();
});

document.querySelector("#tariff-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const c=contracts.find(x=>x.id===document.querySelector("#tariff-contract").value),t={effectiveFrom:document.querySelector("#tariff-from").value,amount:Number(document.querySelector("#tariff-amount").value)};
  const affected=receivables.filter(r=>r.contractId===c.id&&r.workPeriod>=t.effectiveFrom.slice(0,7)&&Number(r.paidAmount||0)<=.009&&statusOf(r)!=="paid");
  if(!await confirmAction({title:"Agregar nueva tarifa",message:`Desde ${t.effectiveFrom}: ${money(t.amount)}`,impact:[`Se recalcularán ${affected.length} período(s) todavía no pagados.`,"Los períodos pagados o parciales quedan congelados."]}))return;
  const updatedContract={...c,tariffPeriods:[...(c.tariffPeriods||[]),t]};
  const ops=[{collection:"contracts",id:c.id,action:"update",auditType:"contract",data:updatedContract}];
  for(const r of affected)ops.push({collection:"receivables",id:r.id,action:"update",auditType:"receivable",data:{...r,amount:tariffFor(updatedContract,r.workPeriod),status:"pending"}});
  await atomicWrite(ops);toast("Tarifa y períodos futuros actualizados.");await refresh();
});

document.querySelector("#allocate-payment").addEventListener("click",async()=>{
  const amount=Number(document.querySelector("#payment-amount").value||0);
  const selected=[...document.querySelectorAll("[data-recv]:checked")].map(x=>receivables.find(r=>r.id===x.dataset.recv)).filter(Boolean);
  if(!(amount>0)||!selected.length){toast("Selecciona períodos e ingresa un monto.");return}
  const totalPending=sum(selected,r=>Math.max(0,Number(r.amount)-Number(r.paidAmount||0)));
  if(amount>totalPending+.009){toast(`El pago excede lo seleccionado por ${money(amount-totalPending)}. Reduce el monto o selecciona más períodos.`);return}
  if(!await confirmAction({title:"Aplicar cobro",message:`Recibido ${money(amount)} sobre ${money(totalPending)} pendiente`,impact:["Se asignará por orden de período.","Puede cubrir varios períodos o dejar uno parcial.","El ingreso bancario será exactamente el valor aplicado."]}))return;
  let left=amount;const ops=[];
  for(const r of selected.sort((a,b)=>a.workPeriod.localeCompare(b.workPeriod))){
    if(left<=.009)break;
    const pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0)),applied=Math.min(pending,left),newPaid=Number(r.paidAmount||0)+applied;
    ops.push({collection:"receivables",id:r.id,action:"update",auditType:"receivable",data:{...r,paidAmount:newPaid,status:newPaid>=Number(r.amount)-.009?"paid":"partial"}});
    left-=applied;
  }
  ops.push({collection:"transactions",action:"create",auditType:"transaction",data:{type:"income",date:todayISO(),amount,vat:0,receipt:"",description:"Cobro de contrato",category:"Ingresos",subcategory:"Contratos",accountId:document.querySelector("#payment-account").value,fromAccountId:null,toAccountId:null,splits:[]}});
  await atomicWrite(ops);toast("Cobro aplicado.");document.querySelector("#payment-amount").value="";await refresh();
});

list.addEventListener("click",async e=>{
  const b=e.target.closest("[data-finish]");if(!b)return;
  const c=contracts.find(x=>x.id===b.dataset.finish);
  if(await confirmAction({title:"Finalizar contrato",message:"Los períodos ya generados permanecen por cobrar.",impact:["La fecha de fin se fijará en la fecha efectiva de cierre.","No se generarán períodos posteriores al cierre."],confirmText:"Finalizar"})){const effectiveEnd=todayISO()<String(c.startDate||"")?String(c.startDate):todayISO();await saveContract({...c,endDate:effectiveEnd,active:false},c.id);await refresh()}
});
requireUser(()=>refresh().catch(console.error));
