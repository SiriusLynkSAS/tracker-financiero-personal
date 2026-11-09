import {requireUser} from "./guard.js";
import {listContracts,saveContract,listReceivables,listAssets,listAccounts,listTransactions,atomicWrite,syncReceivablesClosed,removeTransaction} from "./data-service.js";
import {escapeHtml,money,todayISO,sum} from "./utils.js";
import {contractPeriodCalculation,proratedMonthlyEstimate} from "./contract-math.js";
import {contractAllocations} from "./asset-math.js";
import {confirmAction,toast} from "./ui.js";
let contracts=[],receivables=[],assets=[],accounts=[],transactions=[],transactionsLoaded=false,finishId="",paymentContext=null,dateEditId="";
const contractEditor=document.querySelector("#contract-editor"),tariffEditor=document.querySelector("#tariff-editor");
const contractNew=document.querySelector("#contract-new"),tariffNew=document.querySelector("#tariff-new");
const list=document.querySelector("#contract-list"),tbody=document.querySelector("#recv-body");

function assetName(id){return assets.find(x=>x.id===id)?.name||"Activo"}
function allocationLabel(c){const rows=contractAllocations(c);return rows.length?rows.map(x=>`${escapeHtml(assetName(x.assetId))} ${Number(x.percent||0).toFixed(0)}%`).join(" · "):"Sin activo"}
function statusOf(r){const pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0));return pending<=.009?"paid":Number(r.paidAmount)>0?"partial":r.dueDate<todayISO()?"overdue":"pending"}
function linkedContractAmount(receivableId){
  if(!transactionsLoaded) return null;
  return transactions.reduce((total,t)=>{
    if(!t.contractPaymentId||!Array.isArray(t.contractAllocations)) return total;
    return total+t.contractAllocations.filter(a=>String(a.receivableId||"")===String(receivableId)).reduce((s,a)=>s+Math.max(0,Number(a.amount||0)),0);
  },0);
}
function orphanPaidAmount(r){
  const linked=linkedContractAmount(r.id);
  if(linked===null) return 0;
  return Math.max(0,Number(r.paidAmount||0)-linked);
}
function linkedContractTransactions(receivableId){
  if(!transactionsLoaded) return [];
  return transactions.filter(t=>t.contractPaymentId&&Array.isArray(t.contractAllocations)&&t.contractAllocations.some(a=>String(a?.receivableId||"")===String(receivableId)));
}
function transactionOrderKey(t){
  return String(t.transactionDateTime||`${t.date||""}T00:00`||t.createdAt||"");
}
function latestLinkedContractTransaction(receivableId){
  return linkedContractTransactions(receivableId).sort((a,b)=>transactionOrderKey(b).localeCompare(transactionOrderKey(a))||String(b.id||"").localeCompare(String(a.id||"")))[0]||null;
}
function contractPaymentId(){
  if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `contract_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
}
function allocationRow(data={}){
  const div=document.createElement("div");div.className="tf-allocation-row";
  const options=`<option value="">Seleccionar activo</option>`+assets.filter(a=>a.active!==false).map(a=>`<option value="${a.id}" ${a.id===data.assetId?"selected":""}>${escapeHtml(a.name)}</option>`).join("");
  div.innerHTML=`<select data-alloc-asset>${options}</select><input data-alloc-percent type="number" min="0" max="100" step="0.1" value="${Number(data.percent??100)}"><span>%</span><button type="button" class="tf-btn tf-btn-secondary" data-remove-allocation>Quitar</button>`;
  div.querySelector("[data-alloc-percent]").addEventListener("input",updateAllocationTotal);return div;
}
function updateAllocationTotal(){const total=[...document.querySelectorAll("[data-alloc-percent]")].reduce((s,x)=>s+Number(x.value||0),0);document.querySelector("#allocation-total").textContent=`Asignado ${total.toFixed(1)}%`;}
function collectAllocations(){return [...document.querySelectorAll(".tf-allocation-row")].map(r=>({assetId:r.querySelector("[data-alloc-asset]").value,percent:Number(r.querySelector("[data-alloc-percent]").value||0)})).filter(x=>x.assetId&&x.percent>0);}
function ensureAllocationRow(){const host=document.querySelector("#contract-allocations");if(!host.children.length)host.appendChild(allocationRow({percent:100}));updateAllocationTotal();}

async function sync(){receivables=await syncReceivablesClosed();contracts=await listContracts();}
function render(){
  document.querySelector("#tariff-contract").innerHTML=contracts.filter(x=>x.active!==false).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  document.querySelector("#payment-account").innerHTML=accounts.filter(a=>a.active!==false&&a.accountType!=="credit_card").map(a=>`<option value="${a.id}">${escapeHtml(a.bank+" · "+a.alias)}</option>`).join("");
  const visibleReceivables=receivables.filter(r=>r.active!==false);
  const visibleContracts=[...contracts].sort((a,b)=>Number(b.active!==false)-Number(a.active!==false)||String(b.startDate||"").localeCompare(String(a.startDate||"")));
  list.innerHTML=visibleContracts.map(c=>{
    const rr=visibleReceivables.filter(r=>r.contractId===c.id),gen=sum(rr,r=>r.amount),paid=sum(rr,r=>Math.min(Number(r.paidAmount||0),Number(r.amount||0)));
    const pending=Math.max(0,gen-paid);
    const state=c.active!==false?"Activo":pending>0.009?"Finalizado · cobro pendiente":"Finalizado";
    const stateClass=c.active!==false?"tf-pill-ok":pending>0.009?"tf-pill-warn":"";
    return `<button type="button" class="tf-contract-list-row" data-contract-detail="${c.id}">
      <span class="tf-contract-list-main"><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(allocationLabel(c))} · ${escapeHtml(c.startDate||"—")} → ${escapeHtml(c.endDate||"indefinido")}</small></span>
      <span class="tf-contract-list-money"><small>Por cobrar</small><strong>${money(pending)}</strong></span>
      <span class="tf-pill ${stateClass}">${escapeHtml(state)}</span>
      <span class="tf-contract-list-chevron" aria-hidden="true">›</span>
    </button>`;
  }).join("")||`<div class="tf-empty">Sin contratos registrados.</div>`;
  tbody.innerHTML=visibleReceivables.sort((a,b)=>a.workPeriod.localeCompare(b.workPeriod)).map(r=>{const c=contracts.find(x=>x.id===r.contractId),pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0)),st=statusOf(r),statusLabel={paid:"Pagado",partial:"Parcial",overdue:"Vencido",pending:"Pendiente"}[st]||st,periodDetail=r.prorated?`<div class="tf-muted tf-contract-proration">${Number(r.workedDays||0)}/${Number(r.monthDays||0)} días · ${escapeHtml(r.serviceStart||"")} a ${escapeHtml(r.serviceEnd||"")}</div>`:"",orphan=orphanPaidAmount(r),linkedTx=latestLinkedContractTransaction(r.id);return `<tr><td><input type="checkbox" data-recv="${r.id}" ${pending<=.009?"disabled":""}></td><td>${escapeHtml(c?.name||"—")}</td><td>${r.workPeriod}${periodDetail}</td><td>${money(r.amount)}</td><td>${money(r.paidAmount)}</td><td>${money(pending)}</td><td>${r.dueDate}</td><td><span class="tf-pill ${st==="paid"?"tf-pill-ok":st==="overdue"?"tf-pill-danger":"tf-pill-warn"}">${statusLabel}</span></td><td><div class="tf-actions tf-actions-compact">${pending>.009?`<button type="button" class="tf-icon-btn" data-recv-pay="${r.id}" title="Registrar cobro" aria-label="Registrar cobro">$</button>`:""}${linkedTx?`<button type="button" class="tf-icon-btn" data-recv-revert-tx="${linkedTx.id}" data-receivable-id="${r.id}" title="Revertir último cobro registrado" aria-label="Revertir último cobro registrado">↩</button>`:""}${!linkedTx&&orphan>.009?`<button type="button" class="tf-icon-btn" data-recv-repair="${r.id}" title="Revertir cobro sin movimiento (${money(orphan)})" aria-label="Revertir cobro sin movimiento">↩</button>`:""}</div></td></tr>`}).join("")||`<tr><td colspan="9" class="tf-empty">Sin cuentas por cobrar devengadas.</td></tr>`;
}
async function refresh(){
  [contracts,receivables,assets,accounts]=await Promise.all([listContracts(),listReceivables(),listAssets(),listAccounts()]);
  await sync();
  render();
  ensureAllocationRow();
  try{
    transactions=await listTransactions();
    transactionsLoaded=true;
    render();
  }catch(err){
    console.warn("No se pudo cargar la metadata de cobros contractuales; la cartera principal sigue disponible.",err);
    transactions=[];transactionsLoaded=false;
  }
}
document.querySelector("#contract-start").value=todayISO();document.querySelector("#tariff-from").value=todayISO();
contractNew.addEventListener("click",()=>{contractEditor.hidden=false;tariffEditor.hidden=true;contractEditor.scrollIntoView({behavior:"smooth"})});
tariffNew.addEventListener("click",()=>{tariffEditor.hidden=false;contractEditor.hidden=true;tariffEditor.scrollIntoView({behavior:"smooth"})});
document.querySelector("#contract-cancel").addEventListener("click",()=>{contractEditor.hidden=true});
document.querySelector("#tariff-cancel").addEventListener("click",()=>{tariffEditor.hidden=true});
document.querySelector("#add-contract-allocation").addEventListener("click",()=>{document.querySelector("#contract-allocations").appendChild(allocationRow({percent:0}));updateAllocationTotal();});
document.querySelector("#contract-allocations").addEventListener("click",e=>{const b=e.target.closest("[data-remove-allocation]");if(b){b.closest(".tf-allocation-row").remove();ensureAllocationRow();}});

document.querySelector("#contract-form").addEventListener("submit",async e=>{e.preventDefault();const start=document.querySelector("#contract-start").value,end=document.querySelector("#contract-end").value||null,allocations=collectAllocations(),total=sum(allocations,x=>x.percent),rate=Number(document.querySelector("#contract-rate").value),transport=Number(document.querySelector("#contract-transport").value||0),otherCost=Number(document.querySelector("#contract-other-cost").value||0);if(!start){toast("Ingresa la fecha de inicio.");return}if(end&&end<start){toast("La fecha de fin no puede ser anterior al inicio.");return}if([rate,transport,otherCost].some(v=>!Number.isFinite(v)||v<0)){toast("Tarifa y costos directos deben ser valores no negativos.");return}if(total>100.001){toast("La asignación entre activos no puede superar 100%.");return}if(new Set(allocations.map(x=>x.assetId)).size!==allocations.length){toast("No repitas el mismo activo en el contrato.");return}await saveContract({name:document.querySelector("#contract-name").value.trim(),assetId:allocations[0]?.assetId||null,assetAllocations:allocations,startDate:start,endDate:end,paymentLagMonths:Number(document.querySelector("#contract-lag").value||0),paymentDay:Number(document.querySelector("#contract-pay-day").value||1),initialMonthlyRate:rate,monthlyTransportEstimate:transport,monthlyOtherDirectCostEstimate:otherCost,tariffPeriods:[],active:!end||end>todayISO()});e.target.reset();document.querySelector("#contract-start").value=todayISO();document.querySelector("#contract-allocations").innerHTML="";ensureAllocationRow();toast("Contrato guardado.");contractEditor.hidden=true;await refresh();});

document.querySelector("#tariff-form").addEventListener("submit",async e=>{e.preventDefault();const c=contracts.find(x=>x.id===document.querySelector("#tariff-contract").value),t={effectiveFrom:document.querySelector("#tariff-from").value,amount:Number(document.querySelector("#tariff-amount").value)};const affected=receivables.filter(r=>r.contractId===c.id&&r.workPeriod>=t.effectiveFrom.slice(0,7)&&Number(r.paidAmount||0)<=.009&&statusOf(r)!=="paid");if(!await confirmAction({title:"Agregar nueva tarifa",message:`Desde ${t.effectiveFrom}: ${money(t.amount)}`,impact:[`Se recalcularán ${affected.length} período(s) todavía no pagados.`,`Los períodos pagados o parciales quedan congelados.`]}))return;const updatedContract={...c,tariffPeriods:[...(c.tariffPeriods||[]),t]};const ops=[{collection:"contracts",id:c.id,action:"update",auditType:"contract",data:updatedContract}];for(const r of affected){const calc=contractPeriodCalculation(updatedContract,r.workPeriod);ops.push({collection:"receivables",id:r.id,action:"update",auditType:"receivable",data:{...r,amount:calc?.amount??r.amount,serviceStart:calc?.serviceStart??r.serviceStart,serviceEnd:calc?.serviceEnd??r.serviceEnd,workedDays:calc?.workedDays??r.workedDays,monthDays:calc?.monthDays??r.monthDays,prorated:calc?.prorated??r.prorated,earnedAt:calc?.earnedAt??r.earnedAt,status:"pending"}})}await atomicWrite(ops);toast("Tarifa y períodos futuros actualizados.");tariffEditor.hidden=true;await refresh();});

function paymentAccountsOptions(){return accounts.filter(a=>a.active!==false&&a.accountType!=="credit_card").map(a=>`<option value="${a.id}">${escapeHtml(a.bank+" · "+a.alias)}</option>`).join("");}
let contractDetailDemotedForPayment=false;

function demoteContractDetailForPayment(){
  const detail=document.querySelector("#contract-detail-dialog");
  if(!detail?.open)return;
  detail.close();
  detail.show();
  contractDetailDemotedForPayment=true;
}

function restoreContractDetailAfterPayment(){
  if(!contractDetailDemotedForPayment)return;
  const detail=document.querySelector("#contract-detail-dialog");
  contractDetailDemotedForPayment=false;
  if(!detail)return;
  if(detail.open)detail.close();
  detail.showModal();
}

function openContractPayment(receivableId){
  const r=receivables.find(x=>x.id===receivableId); if(!r)return;
  const c=contracts.find(x=>x.id===r.contractId);
  const pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0)); if(pending<=.009)return;
  paymentContext={receivableId:r.id,contractId:r.contractId};
  document.querySelector("#contract-payment-title").textContent="Registrar cobro";
  document.querySelector("#contract-payment-meta").textContent=`${c?.name||"Contrato"} · período ${r.workPeriod} · pendiente ${money(pending)}`;
  document.querySelector("#contract-payment-account").innerHTML=paymentAccountsOptions();
  document.querySelector("#contract-payment-account").value=document.querySelector("#payment-account")?.value||accounts.find(a=>a.active!==false&&a.accountType!=="credit_card")?.id||"";
  document.querySelector("#contract-payment-amount").value=pending.toFixed(2);
  document.querySelector("#contract-payment-date").value=todayISO();
  document.querySelector("#contract-payment-description").value=`Cobro · ${c?.name||"Contrato"} · ${r.workPeriod}`;
  demoteContractDetailForPayment();
  document.querySelector("#contract-payment-dialog").showModal();
}
async function applyContractPayment(rows,amount,accountId,date,description){
  const selected=rows.filter(Boolean).filter(r=>Math.max(0,Number(r.amount)-Number(r.paidAmount||0))>.009).sort((a,b)=>a.workPeriod.localeCompare(b.workPeriod));
  const totalPending=sum(selected,r=>Math.max(0,Number(r.amount)-Number(r.paidAmount||0)));
  if(!(amount>0)||!selected.length){toast("Selecciona un período e ingresa un monto.");return false}
  if(!accountId){toast("Selecciona una cuenta destino.");return false}
  if(amount>totalPending+.009){toast(`El pago excede lo seleccionado por ${money(amount-totalPending)}.`);return false}
  let left=amount; const ops=[]; const allocations=[];
  for(const r of selected){
    if(left<=.009)break;
    const pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0));
    const applied=Math.min(pending,left);
    const newPaid=Number(r.paidAmount||0)+applied;
    allocations.push({receivableId:r.id,contractId:r.contractId,workPeriod:r.workPeriod,amount:Math.round((applied+Number.EPSILON)*100)/100});
    ops.push({collection:"receivables",id:r.id,action:"update",auditType:"receivable",data:{...r,paidAmount:newPaid,status:newPaid>=Number(r.amount)-.009?"paid":"partial"}});
    left-=applied;
  }
  const paymentId=contractPaymentId();
  ops.push({collection:"transactions",action:"create",auditType:"transaction",data:{
    type:"income",date:date||todayISO(),amount,vat:0,receipt:"",description:description||"Cobro de contrato",category:"Ingresos",subcategory:"Contratos",accountId,fromAccountId:null,toAccountId:null,splits:[],
    contractPaymentId:paymentId,contractAllocations:allocations,contractId:allocations.length===1?allocations[0].contractId:null
  }});
  await atomicWrite(ops);
  return true;
}

document.querySelector("#allocate-payment").addEventListener("click",async()=>{const amount=Number(document.querySelector("#payment-amount").value||0),selected=[...document.querySelectorAll("[data-recv]:checked")].map(x=>receivables.find(r=>r.id===x.dataset.recv)).filter(Boolean),totalPending=sum(selected,r=>Math.max(0,Number(r.amount)-Number(r.paidAmount||0)));if(!(amount>0)||!selected.length){toast("Selecciona períodos e ingresa un monto.");return}if(!await confirmAction({title:"Aplicar cobro",message:`Recibido ${money(amount)} sobre ${money(totalPending)} pendiente`,impact:["Se asignará por orden de período.","El ingreso bancario será exactamente el valor aplicado."]}))return;const names=[...new Set(selected.map(r=>contracts.find(c=>c.id===r.contractId)?.name).filter(Boolean))];const periods=selected.map(r=>r.workPeriod).join(", ");if(await applyContractPayment(selected,amount,document.querySelector("#payment-account").value,todayISO(),`Cobro · ${names.join(" / ")||"Contrato"} · ${periods}`)){toast("Cobro aplicado.");document.querySelector("#payment-amount").value="";await refresh();}});

function finishPreview(){const c=contracts.find(x=>x.id===finishId),date=document.querySelector("#contract-finish-date").value,box=document.querySelector("#contract-finish-preview");if(!c||!date){box.innerHTML="";return}if(date<c.startDate){box.innerHTML=`<div class="tf-alert tf-alert-danger is-visible">La fecha no puede ser anterior al inicio ${escapeHtml(c.startDate)}.</div>`;return}const calc=contractPeriodCalculation({...c,endDate:date},date.slice(0,7));const later=receivables.filter(r=>r.contractId===c.id&&r.workPeriod>date.slice(0,7)&&Number(r.paidAmount||0)>.009),same=receivables.find(r=>r.contractId===c.id&&r.workPeriod===date.slice(0,7)&&Number(r.paidAmount||0)>.009);const future=date>todayISO();box.innerHTML=`<div class="tf-subtle"><strong>${future?"Fin programado":"Cierre efectivo"}: ${escapeHtml(date)}</strong>${calc?`<div style="margin-top:.45rem">Período ${escapeHtml(calc.period)} · ${calc.workedDays}/${calc.monthDays} días · tarifa ${money(calc.monthlyTariff)} · <strong>proporcional ${money(calc.amount)}</strong></div>`:""}${later.length?`<div class="tf-alert tf-alert-danger is-visible" style="margin-top:.55rem">Hay ${later.length} período(s) posteriores con cobros aplicados. No se modificarán automáticamente.</div>`:""}${same&&calc&&Math.abs(Number(same.amount)-calc.amount)>.009?`<div class="tf-alert tf-alert-danger is-visible" style="margin-top:.55rem">El período final ya tiene pagos y su monto histórico difiere del nuevo proporcional. Requiere revisión manual.</div>`:""}</div>`;}
function renderContractDetail(contractId,ensureOpen=true){
  const c=contracts.find(x=>x.id===contractId);
  if(!c)return;
  const rr=receivables.filter(r=>r.contractId===c.id&&r.active!==false).sort((a,b)=>a.workPeriod.localeCompare(b.workPeriod));
  const gen=sum(rr,r=>r.amount),paid=sum(rr,r=>Math.min(Number(r.paidAmount||0),Number(r.amount||0)));
  document.querySelector("#contract-detail-title").textContent=c.name||"Contrato";
  document.querySelector("#contract-detail-body").innerHTML=`<div class="tf-detail-grid"><div class="tf-metric"><span class="tf-metric-label">Estado</span><strong>${c.active!==false?"Activo":"Finalizado"}</strong></div><div class="tf-metric"><span class="tf-metric-label">Inicio</span><strong>${escapeHtml(c.startDate||"—")}</strong></div><div class="tf-metric"><span class="tf-metric-label">Fin</span><strong>${escapeHtml(c.endDate||"Indefinido")}</strong></div><div class="tf-metric"><span class="tf-metric-label">Generado</span><strong>${money(gen)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Cobrado</span><strong>${money(paid)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Pendiente</span><strong>${money(gen-paid)}</strong></div></div><h3 style="margin-top:1rem">Cronograma de cobros</h3><div class="tf-table-wrap"><table class="tf-table"><thead><tr><th>Período</th><th>Generado</th><th>Pagado</th><th>Pendiente</th><th>Vence</th><th>Estado</th><th></th></tr></thead><tbody>${rr.map(r=>{const pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0)),st=statusOf(r),label={paid:"Pagado",partial:"Parcial",overdue:"Vencido",pending:"Pendiente"}[st]||st,orphan=orphanPaidAmount(r),linkedTx=latestLinkedContractTransaction(r.id);return `<tr><td>${escapeHtml(r.workPeriod)}</td><td>${money(r.amount)}</td><td>${money(r.paidAmount||0)}</td><td>${money(pending)}</td><td>${escapeHtml(r.dueDate||"—")}</td><td>${escapeHtml(label)}</td><td><div class="tf-actions tf-actions-compact">${pending>.009?`<button type="button" class="tf-icon-btn" data-detail-pay="${r.id}" title="Registrar cobro" aria-label="Registrar cobro">$</button>`:""}${linkedTx?`<button type="button" class="tf-icon-btn" data-detail-revert-tx="${linkedTx.id}" data-receivable-id="${r.id}" title="Revertir último cobro registrado" aria-label="Revertir último cobro registrado">↩</button>`:""}${!linkedTx&&orphan>.009?`<button type="button" class="tf-icon-btn" data-detail-repair="${r.id}" title="Revertir cobro sin movimiento (${money(orphan)})" aria-label="Revertir cobro sin movimiento">↩</button>`:""}</div></td></tr>`}).join("")||`<tr><td colspan="7" class="tf-empty">Sin períodos devengados.</td></tr>`}</tbody></table></div><div class="tf-actions" style="margin-top:1rem"><button class="tf-btn tf-btn-secondary" type="button" data-detail-dates="${c.id}">Editar fechas</button>${c.active!==false?`<button class="tf-btn tf-btn-secondary" type="button" data-detail-finish="${c.id}">${c.endDate?"Cambiar fecha fin":"Finalizar contrato"}</button>`:""}</div>${c.active===false?`<div class="tf-muted" style="margin-top:.6rem">Contrato finalizado. Puedes corregir las fechas; los períodos pagados o parciales se preservan y solo se recalculan los pendientes.</div>`:""}`;
  const dialog=document.querySelector("#contract-detail-dialog");
  if(ensureOpen && !dialog.open) dialog.showModal();
}
list.addEventListener("click",e=>{
  const detailButton=e.target.closest("[data-contract-detail]");
  if(detailButton){renderContractDetail(detailButton.dataset.contractDetail,true);return;}
  const b=e.target.closest("[data-finish]");if(!b)return;finishId=b.dataset.finish;const c=contracts.find(x=>x.id===finishId);document.querySelector("#contract-finish-date").value=c?.endDate||todayISO();finishPreview();document.querySelector("#contract-finish-dialog").showModal();
});

function describeImpactPeriodsFromTx(tx){
  const allocations=Array.isArray(tx?.contractAllocations)?tx.contractAllocations:[];
  return allocations.map(a=>receivables.find(row=>row.id===a.receivableId)?.workPeriod||a.receivableId).filter(Boolean);
}

async function revertLinkedContractTransaction(txId,receivableId,{fromDetail=false}={}){
  const tx=transactions.find(x=>x.id===txId);
  const r=receivables.find(x=>x.id===receivableId);
  if(!tx||!r){toast("No se encontró el movimiento contractual a revertir.");return;}
  const impactPeriods=describeImpactPeriodsFromTx(tx);
  if(fromDetail) demoteContractDetailForPayment();
  try{
    if(!await confirmAction({title:"Revertir cobro",message:`${tx.date||""} · ${money(tx.amount||0)}`,impact:["Se eliminará el ingreso contractual asociado y se revertirá su efecto en la cuenta destino.",`Se actualizará el contrato${impactPeriods.length?` en: ${impactPeriods.join(", ")}`:""}.`],danger:true,confirmText:"Revertir"})) return;
    await removeTransaction(tx.id);
    const contractId=r.contractId;
    await refresh();
    if(fromDetail) renderContractDetail(contractId,false);
    toast("Cobro revertido.");
  }catch(err){
    toast(err?.message||"No se pudo revertir el cobro.");
  }finally{
    if(fromDetail) restoreContractDetailAfterPayment();
  }
}

async function repairOrphanContractPayment(receivableId,{fromDetail=false}={}){
  const r=receivables.find(x=>x.id===receivableId);
  if(!r)return;
  const orphan=orphanPaidAmount(r);
  if(!(orphan>.009)){toast("No hay un cobro sin movimiento que reparar.");return;}
  if(fromDetail) demoteContractDetailForPayment();
  try{
    if(!await confirmAction({title:"Revertir cobro sin movimiento",message:`${r.workPeriod} · ${money(orphan)}`,impact:["Reduce únicamente el valor pagado del período.","No crea ni elimina movimientos y no modifica saldos bancarios."],confirmText:"Revertir"})) return;
    const newPaid=Math.max(0,Number(r.paidAmount||0)-orphan);
    await atomicWrite([{collection:"receivables",id:r.id,action:"update",auditType:"receivable",data:{...r,paidAmount:newPaid,status:newPaid>=Number(r.amount)-.009?"paid":newPaid>.009?"partial":"pending"},note:"Reparación de cobro contractual sin movimiento asociado"}]);
    const contractId=r.contractId;
    await refresh();
    if(fromDetail) renderContractDetail(contractId,false);
    toast("Cobro sin movimiento revertido.");
  }finally{
    if(fromDetail) restoreContractDetailAfterPayment();
  }
}

tbody.addEventListener("click",async e=>{const pay=e.target.closest("[data-recv-pay]");if(pay){openContractPayment(pay.dataset.recvPay);return;}const revert=e.target.closest("[data-recv-revert-tx]");if(revert){await revertLinkedContractTransaction(revert.dataset.recvRevertTx,revert.dataset.receivableId);return;}const repair=e.target.closest("[data-recv-repair]");if(repair){await repairOrphanContractPayment(repair.dataset.recvRepair);return;}});

document.querySelector("#contract-detail-body").addEventListener("click",async e=>{
  const pay=e.target.closest("[data-detail-pay]");
  if(pay){openContractPayment(pay.dataset.detailPay);return;}
  const revert=e.target.closest("[data-detail-revert-tx]");
  if(revert){
    await revertLinkedContractTransaction(revert.dataset.detailRevertTx,revert.dataset.receivableId,{fromDetail:true});
    return;
  }
  const repair=e.target.closest("[data-detail-repair]");
  if(repair){
    await repairOrphanContractPayment(repair.dataset.detailRepair,{fromDetail:true});
    return;
  }
  const dates=e.target.closest("[data-detail-dates]");
  if(dates){
    const c=contracts.find(x=>x.id===dates.dataset.detailDates);if(!c)return;
    dateEditId=c.id;
    document.querySelector("#contract-dates-start").value=c.startDate||"";
    document.querySelector("#contract-dates-end").value=c.endDate||"";
    document.querySelector("#contract-dates-meta").textContent=c.active!==false?"Contrato activo":"Contrato finalizado";
    document.querySelector("#contract-dates-dialog").showModal();
    return;
  }
  const b=e.target.closest("[data-detail-finish]");
  if(!b)return;
  const c=contracts.find(x=>x.id===b.dataset.detailFinish);
  if(!c)return;
  document.querySelector("#contract-detail-dialog").close();
  finishId=c.id;
  document.querySelector("#contract-finish-date").value=c.endDate||todayISO();
  finishPreview();
  document.querySelector("#contract-finish-dialog").showModal();
});
document.querySelector("#contract-payment-close").addEventListener("click",()=>{
  document.querySelector("#contract-payment-dialog").close();
  restoreContractDetailAfterPayment();
});
document.querySelector("#contract-payment-save").addEventListener("click",async()=>{
  const context=paymentContext?{...paymentContext}:null;
  const r=context?receivables.find(x=>x.id===context.receivableId):null;if(!r)return;
  const amount=Number(document.querySelector("#contract-payment-amount").value||0);
  const accountId=document.querySelector("#contract-payment-account").value;
  const date=document.querySelector("#contract-payment-date").value||todayISO();
  const description=document.querySelector("#contract-payment-description").value.trim()||"Cobro de contrato";
  if(!(amount>0)){toast("Ingresa un monto mayor que cero.");return;}
  if(!accountId){toast("Selecciona una cuenta destino.");return;}
  const dialog=document.querySelector("#contract-payment-dialog");
  const button=document.querySelector("#contract-payment-save");
  button.disabled=true;
  dialog.close();
  restoreContractDetailAfterPayment();
  try{
    if(await applyContractPayment([r],amount,accountId,date,description)){
      await refresh();
      const c=contracts.find(x=>x.id===context?.contractId);
      if(c)renderContractDetail(c.id,false);
      toast("Cobro aplicado.");
    }
  }catch(err){
    console.error(err);
    toast(err?.message||"No se pudo registrar el cobro.");
    demoteContractDetailForPayment();
    if(!dialog.open)dialog.showModal();
  }finally{button.disabled=false;}
});
document.querySelector("#contract-detail-close").addEventListener("click",()=>document.querySelector("#contract-detail-dialog").close());
document.querySelector("#contract-dates-close").addEventListener("click",()=>document.querySelector("#contract-dates-dialog").close());
document.querySelector("#contract-dates-save").addEventListener("click",async()=>{
  const c=contracts.find(x=>x.id===dateEditId);if(!c)return;
  const start=document.querySelector("#contract-dates-start").value;
  const end=document.querySelector("#contract-dates-end").value||null;
  if(!start){toast("Ingresa la fecha de inicio.");return;}
  if(end&&end<start){toast("La fecha de fin no puede ser anterior al inicio.");return;}
  const affectedPending=receivables.filter(r=>r.contractId===c.id&&Number(r.paidAmount||0)<=.009).length;
  const preserved=receivables.filter(r=>r.contractId===c.id&&Number(r.paidAmount||0)>.009).length;
  if(!await confirmAction({title:"Actualizar fechas del contrato",message:`${start} → ${end||"sin fecha fin"}`,impact:[`Se recalcularán ${affectedPending} período(s) sin pagos.`,`${preserved} período(s) pagado(s) o parcial(es) se preservarán como histórico.`,`Los períodos fuera del nuevo rango y sin pagos se anularán automáticamente.`],confirmText:"Guardar fechas"}))return;
  const active=c.active===false?false:(!end||end>todayISO());
  await saveContract({...c,startDate:start,endDate:end,active},c.id);
  document.querySelector("#contract-dates-dialog").close();
  await refresh();
  renderContractDetail(c.id,false);
  toast("Fechas actualizadas y haberes pendientes recalculados.");
});
document.querySelector("#contract-finish-date").addEventListener("change",finishPreview);
document.querySelector("#contract-finish-confirm").addEventListener("click",async()=>{const c=contracts.find(x=>x.id===finishId),date=document.querySelector("#contract-finish-date").value;if(!c||!date||date<c.startDate){toast("Revisa la fecha de finalización.");return}const future=date>todayISO();if(!await confirmAction({title:future?"Programar finalización":"Finalizar contrato",message:`Fecha efectiva ${date}`,impact:[future?"El contrato permanecerá activo hasta esa fecha.":"El período final se recalculará proporcionalmente si aún no tiene pagos.","Los períodos posteriores no pagados se anularán.","Los períodos con pagos quedan congelados y se señalarán para revisión."],confirmText:future?"Programar":"Finalizar"}))return;await saveContract({...c,endDate:date,active:future},c.id);document.querySelector("#contract-finish-dialog").close();await refresh();toast(future?"Fecha de finalización programada.":"Contrato finalizado.");});
requireUser(()=>refresh().catch(console.error));
