import {requireUser} from "./guard.js";
import {listContracts,saveContract,listReceivables,listAssets,listAccounts,listTransactions,listInvoices,createInvoice,registerInvoicePayment,correctInvoicePayment,atomicWrite,syncReceivablesClosed,removeTransaction,inspectAudPost007ContractPayment,repairAudPost007ContractPayment} from "./data-service.js?v=1.0.89";
import {escapeHtml,money,todayISO,addDaysISO,sum} from "./utils.js";
import {contractPeriodCalculation,proratedMonthlyEstimate} from "./contract-math.js";
import {contractAllocations} from "./asset-math.js";
import {confirmAction,toast} from "./ui.js";
let contracts=[],receivables=[],assets=[],accounts=[],transactions=[],invoices=[],transactionsLoaded=false,finishId="",dateEditId="",tariffTargetId="",contractInvoiceReceivableId="",contractInvoicePaymentId="",contractInvoicePaymentTxId="";
const contractEditor=document.querySelector("#contract-editor"),tariffEditor=document.querySelector("#tariff-editor"),assetDialog=document.querySelector("#contract-asset-dialog");
const audPost007Panel=document.querySelector("#aud-post-007-panel");
const audPost007Status=document.querySelector("#aud-post-007-status");
const audPost007Apply=document.querySelector("#aud-post-007-apply");
async function refreshAudPost007(){
  if(!audPost007Panel||!audPost007Status||!audPost007Apply) return;
  try{
    const state=await inspectAudPost007ContractPayment();
    if(state.state==="resolved"||state.state==="missing"){
      audPost007Panel.hidden=true;
      return;
    }
    audPost007Panel.hidden=false;
    if(state.state==="pending"){
      audPost007Status.className="tf-alert tf-alert-warn is-visible";
      audPost007Status.textContent="Se detectó 1 contractPayment revertido con id interno redundante. La limpieza no altera ningún valor financiero.";
      audPost007Apply.hidden=false;
      audPost007Apply.disabled=false;
    }else{
      audPost007Status.className="tf-alert tf-alert-danger is-visible";
      audPost007Status.textContent=state.blocker||"AUD-POST-007 requiere revisión manual.";
      audPost007Apply.hidden=true;
    }
  }catch(err){
    audPost007Panel.hidden=false;
    audPost007Status.className="tf-alert tf-alert-danger is-visible";
    audPost007Status.textContent=err?.message||"No se pudo verificar AUD-POST-007.";
    audPost007Apply.hidden=true;
  }
}
if(audPost007Apply) audPost007Apply.addEventListener("click",async()=>{
  if(!await confirmAction({
    title:"Limpiar id redundante",
    message:"AUD-POST-007 · contractPayment lkX7XLbnKSPrmFV187ul",
    impact:["Se eliminará únicamente data.id.","El Document ID, monto, movimiento, contrato, asignaciones y estado permanecen intactos."],
    confirmText:"Limpiar"
  })) return;
  audPost007Apply.disabled=true;
  try{
    await repairAudPost007ContractPayment();
    toast("AUD-POST-007 corregido.");
    await refreshAudPost007();
  }catch(err){
    toast(err?.message||"No se pudo corregir AUD-POST-007.");
    await refreshAudPost007();
  }finally{
    audPost007Apply.disabled=false;
  }
});
const contractNew=document.querySelector("#contract-new");
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
  const div=document.createElement("div");div.className="tf-plan-source-row tf-allocation-row";
  div.dataset.assetId=String(data.assetId||"");div.dataset.percent=String(Number(data.percent||0));
  div.innerHTML=`<span class="tf-plan-source-main"><strong>${escapeHtml(assetName(data.assetId))}</strong><span>${Number(data.percent||0).toFixed(1)}% del contrato</span></span><button type="button" class="tf-icon-btn" data-remove-allocation title="Quitar activo">×</button>`;
  return div;
}
function updateAllocationTotal(){const rows=[...document.querySelectorAll(".tf-allocation-row")],total=rows.reduce((s,x)=>s+Number(x.dataset.percent||0),0);document.querySelector("#allocation-total").textContent=rows.length?`Asignado ${total.toFixed(1)}%`:`Sin activos vinculados`;}
function collectAllocations(){return [...document.querySelectorAll(".tf-allocation-row")].map(r=>({assetId:r.dataset.assetId,percent:Number(r.dataset.percent||0)})).filter(x=>x.assetId&&x.percent>0);}
function resetAllocations(){document.querySelector("#contract-allocations").innerHTML="";updateAllocationTotal();}
function openAssetDialog(){
  const used=new Set(collectAllocations().map(x=>x.assetId));
  const available=assets.filter(a=>a.active!==false&&!used.has(a.id));
  if(!available.length){toast("No hay activos disponibles para vincular.");return;}
  document.querySelector("#contract-asset-select").innerHTML=available.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  document.querySelector("#contract-asset-percent").value=collectAllocations().length?"0":"100";
  assetDialog.showModal();
}

async function sync(){receivables=await syncReceivablesClosed();contracts=await listContracts();}
function render(){
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
  tbody.innerHTML=visibleReceivables.sort((a,b)=>a.workPeriod.localeCompare(b.workPeriod)).map(r=>{const c=contracts.find(x=>x.id===r.contractId),pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0)),st=statusOf(r),statusLabel={paid:"Pagado",partial:"Parcial",overdue:"Vencido",pending:"Pendiente"}[st]||st,periodDetail=r.prorated?`<div class="tf-muted tf-contract-proration">${Number(r.workedDays||0)}/${Number(r.monthDays||0)} días · ${escapeHtml(r.serviceStart||"")} a ${escapeHtml(r.serviceEnd||"")}</div>`:"",orphan=orphanPaidAmount(r),linkedTx=latestLinkedContractTransaction(r.id),invoice=invoices.find(i=>i.id===r.invoiceId),invoicePending=invoice?Math.max(0,Number(invoice.totalAmount||0)-Number(invoice.paidAmount||0)):0;return `<tr><td>${escapeHtml(c?.name||"—")}</td><td>${r.workPeriod}${periodDetail}${invoice?`<div class="tf-muted">${escapeHtml(invoice.invoiceNumber||"Facturado")}</div>`:""}</td><td>${money(r.amount)}</td><td>${money(r.paidAmount)}</td><td>${money(pending)}</td><td>${r.dueDate}</td><td><span class="tf-pill ${st==="paid"?"tf-pill-ok":st==="overdue"?"tf-pill-danger":"tf-pill-warn"}">${statusLabel}</span></td><td><div class="tf-actions tf-actions-compact">${pending>.009?`<button type="button" class="tf-icon-btn" data-recv-pay="${r.id}" title="${invoice?"Registrar cobro de factura":"Facturar / registrar cobro"}" aria-label="Registrar cobro">$</button>`:""}${!r.invoiceId&&linkedTx?`<button type="button" class="tf-icon-btn" data-recv-revert-tx="${linkedTx.id}" data-receivable-id="${r.id}" title="Revertir último cobro histórico" aria-label="Revertir último cobro histórico">↩</button>`:""}${!r.invoiceId&&!linkedTx&&orphan>.009?`<button type="button" class="tf-icon-btn" data-recv-repair="${r.id}" title="Revertir cobro sin movimiento (${money(orphan)})" aria-label="Revertir cobro sin movimiento">↩</button>`:""}${invoice&&invoicePending<=.009?`<span class="tf-muted">Cobrado</span>`:""}</div></td></tr>`}).join("")||`<tr><td colspan="8" class="tf-empty">Sin cuentas por cobrar devengadas.</td></tr>`;
}
async function refresh(){
  [contracts,receivables,assets,accounts,invoices]=await Promise.all([listContracts(),listReceivables(),listAssets(),listAccounts(),listInvoices()]);
  await sync();
  render();
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
contractNew.addEventListener("click",()=>{document.querySelector("#contract-form").reset();document.querySelector("#contract-start").value=todayISO();document.querySelector("#contract-cycle-mode").value="calendar_month";document.querySelector("#contract-lag").value="6";document.querySelector("#contract-pay-day").value="1";document.querySelector("#contract-transport").value="0";document.querySelector("#contract-other-cost").value="0";resetAllocations();contractEditor.showModal();});
document.querySelector("#contract-editor-close").addEventListener("click",()=>contractEditor.close());
document.querySelector("#contract-cancel").addEventListener("click",()=>contractEditor.close());
document.querySelector("#tariff-cancel").addEventListener("click",()=>tariffEditor.close());
document.querySelector("#add-contract-allocation").addEventListener("click",openAssetDialog);
document.querySelector("#contract-asset-cancel").addEventListener("click",()=>assetDialog.close());
document.querySelector("#contract-asset-add").addEventListener("click",()=>{const assetId=document.querySelector("#contract-asset-select").value,percent=Number(document.querySelector("#contract-asset-percent").value||0);if(!assetId||!(percent>0)||percent>100){toast("Selecciona un activo y un porcentaje válido.");return;}const total=collectAllocations().reduce((a,x)=>a+x.percent,0)+percent;if(total>100.001){toast("La asignación entre activos no puede superar 100%.");return;}document.querySelector("#contract-allocations").appendChild(allocationRow({assetId,percent}));assetDialog.close();updateAllocationTotal();});
document.querySelector("#contract-allocations").addEventListener("click",e=>{const b=e.target.closest("[data-remove-allocation]");if(b){b.closest(".tf-allocation-row").remove();updateAllocationTotal();}});

document.querySelector("#contract-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const start=document.querySelector("#contract-start").value,end=document.querySelector("#contract-end").value||null;
  const allocations=collectAllocations(),total=sum(allocations,x=>x.percent),rate=Number(document.querySelector("#contract-rate").value),transport=Number(document.querySelector("#contract-transport").value||0),otherCost=Number(document.querySelector("#contract-other-cost").value||0);
  if(!start){toast("Ingresa la fecha de inicio.");return;}
  if(end&&end<start){toast("La fecha de fin no puede ser anterior al inicio.");return;}
  if([rate,transport,otherCost].some(v=>!Number.isFinite(v)||v<0)){toast("Tarifa y costos directos deben ser valores no negativos.");return;}
  if(total>100.001){toast("La asignación entre activos no puede superar 100%.");return;}
  if(new Set(allocations.map(x=>x.assetId)).size!==allocations.length){toast("No repitas el mismo activo en el contrato.");return;}
  await saveContract({name:document.querySelector("#contract-name").value.trim(),assetId:allocations[0]?.assetId||null,assetAllocations:allocations,startDate:start,endDate:end,billingCycleMode:document.querySelector("#contract-cycle-mode").value,paymentLagMonths:Number(document.querySelector("#contract-lag").value||0),paymentDay:Number(document.querySelector("#contract-pay-day").value||1),initialMonthlyRate:rate,monthlyTransportEstimate:transport,monthlyOtherDirectCostEstimate:otherCost,tariffPeriods:[],active:!end||end>todayISO()});
  toast("Contrato guardado.");contractEditor.close();resetAllocations();await refresh();
});


document.querySelector("#tariff-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const c=contracts.find(x=>x.id===tariffTargetId);if(!c||c.active===false){toast("La nueva tarifa solo está disponible para contratos en operación.");return;}
  const t={effectiveFrom:document.querySelector("#tariff-from").value,amount:Number(document.querySelector("#tariff-amount").value)};
  if(!t.effectiveFrom||!Number.isFinite(t.amount)||t.amount<0){toast("Revisa fecha y tarifa.");return;}
  const affected=receivables.filter(r=>r.contractId===c.id&&String(r.serviceStart||`${r.workPeriod}-01`)>=t.effectiveFrom&&Number(r.paidAmount||0)<=.009&&statusOf(r)!=="paid");
  if(!await confirmAction({title:"Agregar nueva tarifa",message:`${c.name} · desde ${t.effectiveFrom}: ${money(t.amount)}`,impact:[`Se recalcularán ${affected.length} período(s) todavía no pagados.`,`Los períodos pagados o parciales quedan congelados.`]}))return;
  const updatedContract={...c,tariffPeriods:[...(c.tariffPeriods||[]),t].sort((a,b)=>String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)))};
  const ops=[{collection:"contracts",id:c.id,action:"update",auditType:"contract",data:updatedContract}];
  for(const r of affected){const calc=contractPeriodCalculation(updatedContract,r.workPeriod);ops.push({collection:"receivables",id:r.id,action:"update",auditType:"receivable",data:{...r,amount:calc?.amount??r.amount,serviceStart:calc?.serviceStart??r.serviceStart,serviceEnd:calc?.serviceEnd??r.serviceEnd,workedDays:calc?.workedDays??r.workedDays,monthDays:calc?.monthDays??r.monthDays,prorated:calc?.prorated??r.prorated,earnedAt:calc?.earnedAt??r.earnedAt,status:"pending"}});}
  await atomicWrite(ops);toast("Tarifa y períodos futuros actualizados.");tariffEditor.close();tariffTargetId="";await refresh();renderContractDetail(c.id,false);
});


function paymentAccountsOptions(){return accounts.filter(a=>a.active!==false&&a.accountType!=="credit_card").map(a=>`<option value="${a.id}">${escapeHtml(a.bank+" · "+a.alias)}</option>`).join("");}
const round2=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const parseDecimal=v=>{const n=Number(String(v??"").trim().replace(",","."));return Number.isFinite(n)?n:0;};
function currentTimeHHMM(){const d=new Date();return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;}
function contractInvoiceCalc(){const mode=document.querySelector("#contract-invoice-mode").value,rate=Math.max(0,parseDecimal(document.querySelector("#contract-invoice-vat-rate").value)),input=Math.max(0,parseDecimal(document.querySelector("#contract-invoice-amount").value));let base=0,vat=0,total=0;if(mode==="total_includes_vat"){total=round2(input);base=rate>0?round2(total/(1+rate/100)):total;vat=round2(total-base);}else{base=round2(input);vat=round2(base*rate/100);total=round2(base+vat);}return{base,vat,total,rate,mode};}
function contractInvoicePending(){const r=receivables.find(x=>x.id===contractInvoiceReceivableId);return r?round2(Math.max(0,Number(r.amount||0)-Number(r.paidAmount||0))):0;}
function setContractInvoiceError(message=""){const el=document.querySelector("#contract-invoice-error");if(!el)return;el.hidden=!message;el.classList.toggle("is-visible",!!message);el.textContent=message;}
function renderContractInvoiceCalc(){const c=contractInvoiceCalc(),pending=contractInvoicePending();document.querySelectorAll("[data-contract-invoice-mode]").forEach(btn=>btn.classList.toggle("is-selected",btn.dataset.contractInvoiceMode===c.mode));document.querySelector("#contract-invoice-input-label").textContent=c.mode==="total_includes_vat"?"Total incluido IVA":"Valor sin IVA";document.querySelector("#contract-invoice-preview-base").textContent=money(c.base);document.querySelector("#contract-invoice-preview-vat").textContent=money(c.vat);document.querySelector("#contract-invoice-preview-total").textContent=money(c.total);document.querySelector("#contract-invoice-receivable-note").textContent=c.mode==="total_includes_vat"?`Pendiente contractual ${money(pending)}. El TOTAL de la factura/comprobante debe coincidir con este valor.`:`Pendiente contractual ${money(pending)}. La BASE de la factura/comprobante debe coincidir con este valor.`;if(document.querySelector("#contract-invoice-initial-state").value==="pay_now")document.querySelector("#contract-invoice-pay-amount").value=c.total?c.total.toFixed(2):"";}
let contractDetailDemotedForPayment=false;
function demoteContractDetailForPayment(){const detail=document.querySelector("#contract-detail-dialog");if(!detail?.open)return;detail.close();detail.show();contractDetailDemotedForPayment=true;}
function restoreContractDetailAfterPayment(){if(!contractDetailDemotedForPayment)return;const detail=document.querySelector("#contract-detail-dialog");contractDetailDemotedForPayment=false;if(!detail)return;if(detail.open)detail.close();detail.showModal();}
function closeContractInvoice(){const dialog=document.querySelector("#contract-invoice-dialog");if(dialog?.open)dialog.close();contractInvoiceReceivableId="";setContractInvoiceError("");restoreContractDetailAfterPayment();}
function openContractInvoice(receivableId){const r=receivables.find(x=>x.id===receivableId);if(!r)return;const pending=Math.max(0,Number(r.amount||0)-Number(r.paidAmount||0));if(pending<=.009)return;const c=contracts.find(x=>x.id===r.contractId);contractInvoiceReceivableId=r.id;setContractInvoiceError("");document.querySelector("#contract-invoice-title").textContent="Facturar / registrar cobro";document.querySelector("#contract-invoice-contract-meta").textContent=`${c?.name||"Contrato"} · período ${r.workPeriod}`;document.querySelector("#contract-invoice-mode").value="base_plus_vat";document.querySelector("#contract-invoice-vat-rate").value="15";document.querySelector("#contract-invoice-amount").value=round2(pending).toFixed(2);document.querySelector("#contract-invoice-number").value="";document.querySelector("#contract-invoice-customer").value=c?.name||"";document.querySelector("#contract-invoice-customer-id").value="";document.querySelector("#contract-invoice-concept").value=`Servicios contractuales · ${r.workPeriod}`;document.querySelector("#contract-invoice-issue-date").value=todayISO();document.querySelector("#contract-invoice-due-date").value=r.dueDate||addDaysISO(todayISO(),30);document.querySelector("#contract-invoice-initial-state").value="pay_now";document.querySelector("#contract-invoice-pay-now-fields").hidden=false;document.querySelector("#contract-invoice-pay-account").innerHTML=paymentAccountsOptions();document.querySelector("#contract-invoice-pay-account").value=accounts.find(a=>a.active!==false&&a.accountType!=="credit_card")?.id||"";document.querySelector("#contract-invoice-pay-date").value=todayISO();document.querySelector("#contract-invoice-pay-time").value=currentTimeHHMM();document.querySelector("#contract-invoice-notes").value="";renderContractInvoiceCalc();demoteContractDetailForPayment();document.querySelector("#contract-invoice-dialog").showModal();}
function openContractInvoicePayment(invoiceId,transactionId=""){const invoice=invoices.find(i=>i.id===invoiceId);if(!invoice){toast("No se encontró la factura vinculada.");return;}const tx=transactionId?transactions.find(t=>t.id===transactionId):null,pending=Math.max(0,round2(Number(invoice.totalAmount||0)-Number(invoice.paidAmount||0)));if(!tx&&pending<=.009){toast("La factura ya está completamente cobrada.");return;}contractInvoicePaymentId=invoice.id;contractInvoicePaymentTxId=transactionId;document.querySelector("#contract-invoice-payment-meta").textContent=tx?`${invoice.invoiceNumber} · corregir cobro existente`:`${invoice.invoiceNumber} · ${invoice.customerName} · pendiente ${money(pending)}`;document.querySelector("#contract-invoice-payment-account").innerHTML=paymentAccountsOptions();document.querySelector("#contract-invoice-payment-account").value=tx?.accountId||accounts.find(a=>a.active!==false&&a.accountType!=="credit_card")?.id||"";document.querySelector("#contract-invoice-payment-amount").value=(tx?Number(tx.amount||0):pending).toFixed(2);document.querySelector("#contract-invoice-payment-date").value=tx?.date||todayISO();document.querySelector("#contract-invoice-payment-time").value=String(tx?.transactionDateTime||"").includes("T")?String(tx.transactionDateTime).split("T")[1].slice(0,5):currentTimeHHMM();document.querySelector("#contract-invoice-payment-description").value=tx?.description||`Cobro factura ${invoice.invoiceNumber} · ${invoice.customerName}`;document.querySelector("#contract-invoice-payment-save").textContent=tx?"Guardar corrección":"Registrar cobro";demoteContractDetailForPayment();document.querySelector("#contract-invoice-payment-dialog").showModal();}
function openContractPayment(receivableId){const r=receivables.find(x=>x.id===receivableId);if(!r)return;if(r.invoiceId){openContractInvoicePayment(r.invoiceId);return;}openContractInvoice(r.id);}
document.querySelectorAll("[data-contract-invoice-mode]").forEach(btn=>btn.addEventListener("click",()=>{document.querySelector("#contract-invoice-mode").value=btn.dataset.contractInvoiceMode;renderContractInvoiceCalc();document.querySelector("#contract-invoice-amount").focus();}));
document.querySelector("#contract-invoice-vat-rate").addEventListener("input",renderContractInvoiceCalc);
document.querySelector("#contract-invoice-amount").addEventListener("input",e=>{e.target.value=String(e.target.value||"").replace(",",".").replace(/[^0-9.]/g,"");renderContractInvoiceCalc();});
document.querySelector("#contract-invoice-initial-state").addEventListener("change",e=>{document.querySelector("#contract-invoice-pay-now-fields").hidden=e.target.value!=="pay_now";renderContractInvoiceCalc();});
["#contract-invoice-close","#contract-invoice-close-x"].forEach(sel=>document.querySelector(sel).addEventListener("click",closeContractInvoice));
document.querySelector("#contract-invoice-save").addEventListener("click",async()=>{const r=receivables.find(x=>x.id===contractInvoiceReceivableId);if(!r)return;const c=contracts.find(x=>x.id===r.contractId),calc=contractInvoiceCalc(),pending=round2(Math.max(0,Number(r.amount||0)-Number(r.paidAmount||0))),contractValue=calc.mode==="total_includes_vat"?calc.total:calc.base;const number=document.querySelector("#contract-invoice-number").value.trim(),customer=document.querySelector("#contract-invoice-customer").value.trim(),concept=document.querySelector("#contract-invoice-concept").value.trim(),issueDate=document.querySelector("#contract-invoice-issue-date").value,dueDate=document.querySelector("#contract-invoice-due-date").value;if(!number||!customer||!concept){setContractInvoiceError("Completa código/comprobante, cliente y concepto.");return;}if(!issueDate||!dueDate||dueDate<issueDate){setContractInvoiceError("Revisa las fechas de emisión y vencimiento.");return;}if(!(calc.total>0)){setContractInvoiceError("Ingresa un monto mayor que cero.");return;}if(Math.abs(contractValue-pending)>.02){setContractInvoiceError(`${calc.mode==="total_includes_vat"?"El total":"La base"} debe coincidir con el pendiente contractual (${pending.toFixed(2)}).`);return;}const invoice={invoiceNumber:number,customerName:customer,customerId:document.querySelector("#contract-invoice-customer-id").value.trim(),concept,issueDate,dueDate,calculationMode:calc.mode,vatRate:calc.rate,baseAmount:calc.base,vatAmount:calc.vat,totalAmount:calc.total,paidAmount:0,paidBaseAmount:0,paidVatAmount:0,contractualAmount:pending,status:"pending",active:true,contractId:r.contractId,receivableId:r.id,notes:document.querySelector("#contract-invoice-notes").value.trim(),taxPeriod:issueDate.slice(0,7),vatStatus:calc.vat>0?"pending":"none",taxPaymentId:""};let payment=null;if(document.querySelector("#contract-invoice-initial-state").value==="pay_now"){const accountId=document.querySelector("#contract-invoice-pay-account").value,date=document.querySelector("#contract-invoice-pay-date").value,time=document.querySelector("#contract-invoice-pay-time").value,amount=parseDecimal(document.querySelector("#contract-invoice-pay-amount").value);if(!accountId){setContractInvoiceError("Selecciona la cuenta donde se recibió el cobro.");return;}if(!(amount>0)||amount>calc.total+.009){setContractInvoiceError("Revisa el monto recibido.");return;}payment={amount,accountId,date,transactionDateTime:time?`${date}T${time}`:"",description:`Cobro ${number} · ${customer}`};}const button=document.querySelector("#contract-invoice-save");button.disabled=true;try{await createInvoice(invoice,payment);const contractId=r.contractId;document.querySelector("#contract-invoice-dialog").close();contractInvoiceReceivableId="";restoreContractDetailAfterPayment();await refresh();renderContractDetail(contractId,false);toast(payment?"Factura/comprobante y cobro registrados.":"Factura/comprobante registrado; queda pendiente de cobro.");}catch(err){setContractInvoiceError(err?.message||"No se pudo registrar la factura/comprobante.");}finally{button.disabled=false;}});
document.querySelector("#contract-invoice-payment-close").addEventListener("click",()=>{document.querySelector("#contract-invoice-payment-dialog").close();contractInvoicePaymentId="";contractInvoicePaymentTxId="";document.querySelector("#contract-invoice-payment-save").textContent="Registrar cobro";restoreContractDetailAfterPayment();});
document.querySelector("#contract-invoice-payment-save").addEventListener("click",async()=>{const invoice=invoices.find(i=>i.id===contractInvoicePaymentId);if(!invoice)return;const amount=Number(document.querySelector("#contract-invoice-payment-amount").value||0),accountId=document.querySelector("#contract-invoice-payment-account").value,date=document.querySelector("#contract-invoice-payment-date").value,time=document.querySelector("#contract-invoice-payment-time").value;if(!(amount>0)){toast("Ingresa un monto mayor que cero.");return;}if(!accountId){toast("Selecciona una cuenta destino.");return;}const button=document.querySelector("#contract-invoice-payment-save");button.disabled=true;try{const payload={amount,accountId,date,transactionDateTime:time?`${date}T${time}`:"",description:document.querySelector("#contract-invoice-payment-description").value.trim()};if(contractInvoicePaymentTxId){await correctInvoicePayment(contractInvoicePaymentTxId,payload);toast("Cobro corregido sin duplicar el movimiento.");}else{await registerInvoicePayment(invoice.id,payload);toast("Cobro de factura registrado.");}const contractId=invoice.contractId;document.querySelector("#contract-invoice-payment-dialog").close();contractInvoicePaymentId="";contractInvoicePaymentTxId="";button.textContent="Registrar cobro";restoreContractDetailAfterPayment();await refresh();if(contractId)renderContractDetail(contractId,false);}catch(err){toast(err?.message||"No se pudo registrar/corregir el cobro.");}finally{button.disabled=false;}});

function finishPreview(){const c=contracts.find(x=>x.id===finishId),date=document.querySelector("#contract-finish-date").value,box=document.querySelector("#contract-finish-preview");if(!c||!date){box.innerHTML="";return}if(date<c.startDate){box.innerHTML=`<div class="tf-alert tf-alert-danger is-visible">La fecha no puede ser anterior al inicio ${escapeHtml(c.startDate)}.</div>`;return}const calc=contractPeriodCalculation({...c,endDate:date},date.slice(0,7));const later=receivables.filter(r=>r.contractId===c.id&&r.workPeriod>date.slice(0,7)&&Number(r.paidAmount||0)>.009),same=receivables.find(r=>r.contractId===c.id&&r.workPeriod===date.slice(0,7)&&Number(r.paidAmount||0)>.009);const future=date>todayISO();box.innerHTML=`<div class="tf-subtle"><strong>${future?"Fin programado":"Cierre efectivo"}: ${escapeHtml(date)}</strong>${calc?`<div style="margin-top:.45rem">Período ${escapeHtml(calc.period)} · ${calc.workedDays}/${calc.monthDays} días · tarifa ${money(calc.monthlyTariff)} · <strong>proporcional ${money(calc.amount)}</strong></div>`:""}${later.length?`<div class="tf-alert tf-alert-danger is-visible" style="margin-top:.55rem">Hay ${later.length} período(s) posteriores con cobros aplicados. No se modificarán automáticamente.</div>`:""}${same&&calc&&Math.abs(Number(same.amount)-calc.amount)>.009?`<div class="tf-alert tf-alert-danger is-visible" style="margin-top:.55rem">El período final ya tiene pagos y su monto histórico difiere del nuevo proporcional. Requiere revisión manual.</div>`:""}</div>`;}
function renderContractDetail(contractId,ensureOpen=true){
  const c=contracts.find(x=>x.id===contractId);
  if(!c)return;
  const rr=receivables.filter(r=>r.contractId===c.id&&r.active!==false).sort((a,b)=>a.workPeriod.localeCompare(b.workPeriod));
  const gen=sum(rr,r=>r.amount),paid=sum(rr,r=>Math.min(Number(r.paidAmount||0),Number(r.amount||0)));
  document.querySelector("#contract-detail-title").textContent=c.name||"Contrato";
  document.querySelector("#contract-detail-body").innerHTML=`<div class="tf-detail-grid"><div class="tf-metric"><span class="tf-metric-label">Estado</span><strong>${c.active!==false?"Activo":"Finalizado"}</strong></div><div class="tf-metric"><span class="tf-metric-label">Inicio</span><strong>${escapeHtml(c.startDate||"—")}</strong></div><div class="tf-metric"><span class="tf-metric-label">Fin</span><strong>${escapeHtml(c.endDate||"Indefinido")}</strong></div><div class="tf-metric"><span class="tf-metric-label">Período</span><strong>${c.billingCycleMode==="anniversary"?"Ciclo aniversario":"Mes calendario"}</strong></div><div class="tf-metric"><span class="tf-metric-label">Generado</span><strong>${money(gen)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Cobrado</span><strong>${money(paid)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Pendiente</span><strong>${money(gen-paid)}</strong></div></div><h3 style="margin-top:1rem">Cronograma de cobros</h3><div class="tf-table-wrap"><table class="tf-table"><thead><tr><th>Período</th><th>Generado</th><th>Pagado</th><th>Pendiente</th><th>Vence</th><th>Estado</th><th></th></tr></thead><tbody>${rr.map(r=>{const pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0)),st=statusOf(r),label={paid:"Pagado",partial:"Parcial",overdue:"Vencido",pending:"Pendiente"}[st]||st,orphan=orphanPaidAmount(r),linkedTx=latestLinkedContractTransaction(r.id);return `<tr><td>${escapeHtml(r.workPeriod)}</td><td>${money(r.amount)}</td><td>${money(r.paidAmount||0)}</td><td>${money(pending)}</td><td>${escapeHtml(r.dueDate||"—")}</td><td>${escapeHtml(label)}</td><td><div class="tf-actions tf-actions-compact">${pending>.009?`<button type="button" class="tf-icon-btn" data-detail-pay="${r.id}" title="${r.invoiceId?"Registrar cobro de factura":"Facturar / registrar cobro"}" aria-label="Registrar cobro">$</button>`:""}${r.invoiceId?(()=>{const tx=transactions.filter(t=>t.invoiceId===r.invoiceId&&t.invoicePaymentId).sort((a,b)=>String(b.transactionDateTime||b.date||"").localeCompare(String(a.transactionDateTime||a.date||"")))[0];return tx?`<button type="button" class="tf-icon-btn" data-detail-correct-invoice="${tx.id}" data-invoice-id="${r.invoiceId}" title="Corregir último cobro facturado">✎</button>`:""})():""}${!r.invoiceId&&linkedTx?`<button type="button" class="tf-icon-btn" data-detail-revert-tx="${linkedTx.id}" data-receivable-id="${r.id}" title="Revertir último cobro histórico" aria-label="Revertir último cobro histórico">↩</button>`:""}${!r.invoiceId&&!linkedTx&&orphan>.009?`<button type="button" class="tf-icon-btn" data-detail-repair="${r.id}" title="Revertir cobro sin movimiento (${money(orphan)})" aria-label="Revertir cobro sin movimiento">↩</button>`:""}</div></td></tr>`}).join("")||`<tr><td colspan="7" class="tf-empty">Sin períodos devengados.</td></tr>`}</tbody></table></div><div class="tf-actions" style="margin-top:1rem"><button class="tf-btn tf-btn-secondary" type="button" data-detail-dates="${c.id}">Editar fechas</button>${c.active!==false?`<button class="tf-btn tf-btn-secondary" type="button" data-detail-tariff="${c.id}">Nueva tarifa</button><button class="tf-btn tf-btn-secondary" type="button" data-detail-finish="${c.id}">${c.endDate?"Cambiar fecha fin":"Finalizar contrato"}</button>`:""}</div>${c.active===false?`<div class="tf-muted" style="margin-top:.6rem">Contrato finalizado. Puedes corregir las fechas; los períodos pagados o parciales se preservan y solo se recalculan los pendientes.</div>`:""}`;
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
  if(r.invoiceId){toast("Un período facturado debe corregirse desde Facturación / Movimientos.");return;}
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
  const correctInvoice=e.target.closest("[data-detail-correct-invoice]");
  if(correctInvoice){openContractInvoicePayment(correctInvoice.dataset.invoiceId,correctInvoice.dataset.detailCorrectInvoice);return;}
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
  const tariff=e.target.closest("[data-detail-tariff]");
  if(tariff){
    const c=contracts.find(x=>x.id===tariff.dataset.detailTariff);if(!c||c.active===false)return;
    tariffTargetId=c.id;document.querySelector("#tariff-title").textContent=`Nueva tarifa · ${c.name}`;document.querySelector("#tariff-from").value=todayISO();document.querySelector("#tariff-amount").value="";tariffEditor.showModal();return;
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
