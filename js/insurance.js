import {requireUser} from "./guard.js";
import {
  listInsurance,saveInsurance,archiveInsurance,reactivateInsurance,listAccounts,listTransactions,
  registerInsuranceCoverage,registerInsurancePremium,correctInsurancePremiumPayment
} from "./data-service.js?v=1.0.90";
import {money,escapeHtml,todayISO} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

let rows=[],accounts=[],transactions=[],showArchived=false;
const list=document.querySelector("#ins-list");
const coverageList=document.querySelector("#coverage-list");
const editor=document.querySelector("#ins-editor");
const coverageEditor=document.querySelector("#coverage-editor");
const premiumEditor=document.querySelector("#premium-editor");
const newButton=document.querySelector("#ins-new");
const coverageButton=document.querySelector("#coverage-new");
const archivedToggle=document.querySelector("#ins-archived-toggle");

function typeLabel(v){return ({health:"Salud",vehicle:"Vehículo",equipment:"Equipo",other:"Otro"})[v]||v||"—"}
function accountLabel(a){
  const base=[a?.bank,a?.alias].filter(Boolean).join(" · ")||"Cuenta";
  return a?.accountType==="credit_card"?`${base} · Tarjeta de crédito`:base;
}
function accountById(id){return accounts.find(a=>a.id===id)}
function allUsages(){
  return rows.flatMap(p=>(p.usageEvents||[]).map(u=>({...u,policyId:p.id,policyName:p.name,policyProvider:p.provider})))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function premiumPayments(policy){
  return transactions.filter(t=>
    t.type==="expense" && !t.insuranceUsageId && t.recurringId &&
    (t.insurancePolicyId===policy.id || (policy.premiumRecurringId && t.recurringId===policy.premiumRecurringId))
  ).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
}
function accountOptions(selectedId=""){
  return `<option value="">Selecciona una cuenta</option>`+accounts
    .filter(a=>a.active!==false||a.id===selectedId)
    .map(a=>`<option value="${a.id}">${escapeHtml(accountLabel(a))}${a.active===false?" · Archivada":""}</option>`).join("");
}
function fillAccountSelect(selector,selectedId=""){
  const el=document.querySelector(selector);
  el.innerHTML=accountOptions(selectedId);
  el.value=selectedId||"";
}

function render(){
  const active=rows.filter(x=>x.active!==false),archived=rows.filter(x=>x.active===false),visible=showArchived?archived:active;
  archivedToggle.hidden=!archived.length;
  archivedToggle.textContent=showArchived?"Ver activos":`Archivados (${archived.length})`;
  newButton.hidden=showArchived;
  coverageButton.hidden=showArchived||!active.length;
  document.querySelector("#coverage-policy").innerHTML=active.map(x=>`<option value="${x.id}">${escapeHtml(x.provider)} · ${escapeHtml(x.name)}</option>`).join("");
  fillAccountSelect("#coverage-account");
  fillAccountSelect("#ins-premium-account");
  fillAccountSelect("#premium-account");
  list.innerHTML=visible.map(p=>`<tr><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.provider)}</td><td>${escapeHtml(typeLabel(p.type))}</td><td>${escapeHtml(p.startDate||"—")}</td><td class="tf-num">${money(p.monthlyPremium||0)}</td><td>${escapeHtml(accountLabel(accountById(p.premiumAccountId)||{})||"—")}</td><td><span class="tf-pill ${p.active===false?"":"tf-pill-ok"}">${p.active===false?"Archivado":"Activo"}</span></td><td><button class="tf-icon-btn" data-ins-info="${p.id}" title="Información">ⓘ</button></td></tr>`).join("")||`<tr><td colspan="8" class="tf-empty">${showArchived?"Sin seguros archivados.":"Sin seguros activos."}</td></tr>`;
  const usages=allUsages();
  coverageList.innerHTML=usages.map(u=>`<tr><td>${escapeHtml(u.date||"—")}</td><td>${escapeHtml(u.policyProvider)} · ${escapeHtml(u.policyName)}</td><td>${escapeHtml(u.description||"Uso")}</td><td class="tf-num">${money(Number(u.serviceCost||Number(u.paidAmount||u.copayAmount||0)+Number(u.coveredAmount||0)))}</td><td class="tf-num">${money(u.coveredAmount||0)}</td><td class="tf-num">${money(u.paidAmount??u.copayAmount??0)}</td><td>${u.transactionId?`<a class="tf-icon-btn" href="movimientos.html?transaction=${encodeURIComponent(u.transactionId)}" title="Abrir movimiento">↗</a>`:`<span class="tf-muted">Sin movimiento</span>`}</td><td><button class="tf-icon-btn" data-coverage-info="${escapeHtml(u.id||"")}" data-policy-id="${escapeHtml(u.policyId)}" title="Información">ⓘ</button></td></tr>`).join("")||`<tr><td colspan="8" class="tf-empty">Sin coberturas registradas.</td></tr>`;
}

async function refresh(){
  [rows,accounts,transactions]=await Promise.all([listInsurance(),listAccounts(),listTransactions()]);
  render();
}

function openPolicy(p=null){
  document.querySelector("#ins-form").reset();
  document.querySelector("#ins-id").value=p?.id||"";
  document.querySelector("#ins-editor-title").textContent=p?"Editar seguro":"Nuevo seguro";
  document.querySelector("#ins-type").value=p?.type||"health";
  document.querySelector("#ins-provider").value=p?.provider||"";
  document.querySelector("#ins-name").value=p?.name||"";
  document.querySelector("#ins-premium").value=Number(p?.monthlyPremium||0);
  fillAccountSelect("#ins-premium-account",p?.premiumAccountId||"");
  document.querySelector("#ins-payment-day").value=Number(p?.paymentDay||1);
  document.querySelector("#ins-reminder").value=Number(p?.reminderDaysBefore||3);
  document.querySelector("#ins-start").value=p?.startDate||todayISO();
  document.querySelector("#ins-end").value=p?.endDate||"";
  editor.showModal();
}

function syncCoverage(){
  const paid=Math.max(0,Number(document.querySelector("#coverage-paid").value||0));
  const covered=Math.max(0,Number(document.querySelector("#coverage-covered").value||0));
  document.querySelector("#coverage-total").value=money(paid+covered);
  const wrap=document.querySelector("#coverage-account-wrap"),select=document.querySelector("#coverage-account");
  wrap.classList.toggle("is-disabled",paid<=0);
  select.disabled=paid<=0;
  if(paid<=0)select.value="";
  document.querySelector("#coverage-invoice-fields").hidden=!document.querySelector("#coverage-has-invoice").checked;
}
function openCoverage(policyId=""){
  document.querySelector("#coverage-form").reset();
  document.querySelector("#coverage-date").value=todayISO();
  document.querySelector("#coverage-policy").value=policyId||rows.find(x=>x.active!==false)?.id||"";
  fillAccountSelect("#coverage-account");
  syncCoverage();
  coverageEditor.showModal();
}

function openPremium(policyId,tx=null){
  const p=rows.find(x=>x.id===policyId);
  if(!p||!(Number(p.monthlyPremium||0)>0))return toast("Este seguro no tiene prima mensual configurada.");
  document.querySelector("#premium-form").reset();
  document.querySelector("#premium-policy").value=p.id;
  document.querySelector("#premium-transaction-id").value=tx?.id||"";
  document.querySelector("#premium-title").textContent=tx?`Corregir prima · ${p.name}`:`Registrar prima · ${p.name}`;
  document.querySelector("#premium-date").value=tx?.date||todayISO();
  const amountInput=document.querySelector("#premium-amount");
  amountInput.value=Number(tx?.amount??p.monthlyPremium).toFixed(2);
  amountInput.readOnly=!tx;
  fillAccountSelect("#premium-account",tx?.accountId||p.premiumAccountId||"");
  const hasInvoice=tx?.hasInvoice===true;
  document.querySelector("#premium-has-invoice").checked=hasInvoice;
  document.querySelector("#premium-invoice-number").value=hasInvoice?tx?.invoiceNumber||"":"";
  document.querySelector("#premium-vat").value=hasInvoice?Number(tx?.vat||0):0;
  document.querySelector("#premium-invoice-fields").hidden=!hasInvoice;
  document.querySelector("#premium-mode-note").textContent=tx
    ?"La corrección modifica solo este pago histórico. No cambia la prima mensual ni la cuenta predeterminada de la póliza."
    :"Cada mes puede registrarse una sola prima. El pago queda vinculado al recurrente del seguro y a la cuenta seleccionada.";
  document.querySelector("#premium-save").textContent=tx?"Guardar corrección":"Registrar prima";
  premiumEditor.showModal();
}

newButton.addEventListener("click",()=>openPolicy());
coverageButton.addEventListener("click",()=>openCoverage());
archivedToggle.addEventListener("click",()=>{showArchived=!showArchived;render()});
document.querySelector("#ins-editor-close").addEventListener("click",()=>editor.close());
document.querySelector("#ins-cancel").addEventListener("click",()=>editor.close());
document.querySelector("#coverage-close").addEventListener("click",()=>coverageEditor.close());
document.querySelector("#coverage-cancel").addEventListener("click",()=>coverageEditor.close());
document.querySelector("#premium-close").addEventListener("click",()=>premiumEditor.close());
document.querySelector("#premium-cancel").addEventListener("click",()=>premiumEditor.close());
document.querySelector("#coverage-paid").addEventListener("input",syncCoverage);
document.querySelector("#coverage-covered").addEventListener("input",syncCoverage);
document.querySelector("#coverage-has-invoice").addEventListener("change",syncCoverage);
document.querySelector("#premium-has-invoice").addEventListener("change",()=>document.querySelector("#premium-invoice-fields").hidden=!document.querySelector("#premium-has-invoice").checked);

document.querySelector("#ins-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const id=document.querySelector("#ins-id").value||null,old=id?rows.find(x=>x.id===id):null;
  const premium=Number(document.querySelector("#ins-premium").value||0),premiumAccountId=document.querySelector("#ins-premium-account").value;
  if(premium>0&&!premiumAccountId)return toast("Selecciona la cuenta para pagar la prima mensual.");
  await saveInsurance({
    type:document.querySelector("#ins-type").value,provider:document.querySelector("#ins-provider").value.trim(),name:document.querySelector("#ins-name").value.trim(),
    monthlyPremium:premium,premiumAccountId,paymentDay:Number(document.querySelector("#ins-payment-day").value||1),reminderDaysBefore:Number(document.querySelector("#ins-reminder").value||0),
    startDate:document.querySelector("#ins-start").value,endDate:document.querySelector("#ins-end").value||null,usageEvents:old?.usageEvents||[],active:old?.active!==false
  },id);
  editor.close();toast(id?"Seguro y prima recurrente actualizados.":"Seguro y prima recurrente guardados.");await refresh();
});

document.querySelector("#premium-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const policyId=document.querySelector("#premium-policy").value;
  const transactionId=document.querySelector("#premium-transaction-id").value;
  const date=document.querySelector("#premium-date").value,amount=Number(document.querySelector("#premium-amount").value||0),accountId=document.querySelector("#premium-account").value;
  const hasInvoice=document.querySelector("#premium-has-invoice").checked,invoiceNumber=hasInvoice?document.querySelector("#premium-invoice-number").value.trim():"",vat=hasInvoice?Number(document.querySelector("#premium-vat").value||0):0;
  const p=rows.find(x=>x.id===policyId);
  if(!accountId)return toast("Selecciona la cuenta de pago.");
  if(!(amount>0))return toast("El monto debe ser mayor que cero.");
  if(vat>amount)return toast("El IVA no puede superar el monto pagado.");
  if(transactionId){
    await correctInsurancePremiumPayment(transactionId,{date,amount,accountId,hasInvoice,invoiceNumber,vat});
    premiumEditor.close();toast("Pago de prima corregido.");await refresh();return;
  }
  if(vat>Number(p?.monthlyPremium||0))return toast("El IVA no puede superar la prima.");
  await registerInsurancePremium(policyId,{date,accountId,hasInvoice,invoiceNumber,vat});
  premiumEditor.close();toast("Prima registrada en Movimientos sin duplicar el recurrente.");await refresh();
});

document.querySelector("#coverage-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const policyId=document.querySelector("#coverage-policy").value,paid=Math.max(0,Number(document.querySelector("#coverage-paid").value||0)),covered=Math.max(0,Number(document.querySelector("#coverage-covered").value||0));
  const hasInvoice=document.querySelector("#coverage-has-invoice").checked,vat=hasInvoice?Math.max(0,Number(document.querySelector("#coverage-vat").value||0)):0,accountId=document.querySelector("#coverage-account").value;
  if(!policyId||paid+covered<=0){toast("Ingresa seguro, pago o cobertura.");return}
  if(paid>0&&!accountId){toast("Selecciona la cuenta usada para el pago.");return}
  if(vat>paid){toast("El IVA no puede superar el pago personal.");return}
  const description=document.querySelector("#coverage-description").value.trim();
  if(!description){toast("Ingresa el servicio o referencia.");return}
  if(!await confirmAction({title:"Registrar cobertura",message:`Total ${money(paid+covered)} · pagado ${money(paid)} · cobertura ${money(covered)}`,impact:[paid>0?"Se creará un egreso vinculado en Movimientos.":"No se creará movimiento porque el pago personal es $0."]}))return;
  await registerInsuranceCoverage(policyId,{date:document.querySelector("#coverage-date").value,description,paidAmount:paid,coveredAmount:covered,hasInvoice,invoiceNumber:hasInvoice?document.querySelector("#coverage-invoice-number").value.trim():"",vat},{accountId,hasInvoice,invoiceNumber:document.querySelector("#coverage-invoice-number").value.trim(),vat,invoiceBase:Math.max(0,paid-vat),taxPeriod:document.querySelector("#coverage-date").value.slice(0,7),vatStatus:hasInvoice&&vat>0?"pending":"none",category:"Salud",subcategory:"Seguro",receipt:"",splits:[]});
  coverageEditor.close();toast(paid>0?"Cobertura y movimiento registrados.":"Cobertura registrada sin movimiento.");await refresh();
});

document.addEventListener("click",async e=>{
  const info=e.target.closest("[data-ins-info]"),cov=e.target.closest("[data-coverage-info]"),edit=e.target.closest("[data-ins-edit]"),archive=e.target.closest("[data-ins-archive]"),react=e.target.closest("[data-ins-reactivate]"),reg=e.target.closest("[data-ins-register]"),premium=e.target.closest("[data-ins-premium]"),premiumEdit=e.target.closest("[data-premium-edit]");
  if(info){
    const p=rows.find(x=>x.id===info.dataset.insInfo);if(!p)return;
    const payments=premiumPayments(p);
    const paymentRows=payments.map(tx=>`<tr><td>${escapeHtml(tx.date||"—")}</td><td class="tf-num">${money(tx.amount||0)}</td><td>${escapeHtml(accountLabel(accountById(tx.accountId)||{}))}</td><td>${tx.hasInvoice?`${escapeHtml(tx.invoiceNumber||"Factura")} · IVA ${money(tx.vat||0)}`:"Sin factura"}</td><td><a class="tf-icon-btn" href="movimientos.html?transaction=${encodeURIComponent(tx.id)}" title="Abrir movimiento">↗</a>${tx.taxPaymentId?`<span class="tf-pill">IVA liquidado</span>`:`<button class="tf-icon-btn" data-premium-edit="${escapeHtml(tx.id)}" data-policy-id="${escapeHtml(p.id)}" title="Corregir pago">✎</button>`}</td></tr>`).join("")||`<tr><td colspan="5" class="tf-empty">Aún no hay primas registradas.</td></tr>`;
    document.querySelector("#ins-detail-title").textContent=p.name||"Seguro";
    document.querySelector("#ins-detail-body").innerHTML=`<div class="tf-detail-grid"><div class="tf-metric"><span class="tf-metric-label">Aseguradora</span><strong>${escapeHtml(p.provider)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Tipo</span><strong>${escapeHtml(typeLabel(p.type))}</strong></div><div class="tf-metric"><span class="tf-metric-label">Prima mensual</span><strong>${money(p.monthlyPremium)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Cuenta prima</span><strong>${escapeHtml(accountLabel(accountById(p.premiumAccountId)||{})||"—")}</strong></div><div class="tf-metric"><span class="tf-metric-label">Día de pago</span><strong>${Number(p.paymentDay||1)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Inicio</span><strong>${escapeHtml(p.startDate||"—")}</strong></div></div><h3 style="margin-top:1rem">Pagos de prima</h3><div class="tf-table-wrap"><table class="tf-table"><thead><tr><th>Fecha</th><th class="tf-num">Monto</th><th>Cuenta / tarjeta</th><th>Factura</th><th>Acción</th></tr></thead><tbody>${paymentRows}</tbody></table></div><div class="tf-actions" style="margin-top:1rem">${p.active===false?`<button class="tf-btn tf-btn-primary" data-ins-reactivate="${p.id}">Reactivar</button>`:`${Number(p.monthlyPremium||0)>0?`<button class="tf-btn tf-btn-primary" data-ins-premium="${p.id}">Registrar prima</button>`:""}<button class="tf-btn tf-btn-primary" data-ins-register="${p.id}">Registrar cobertura</button><button class="tf-btn tf-btn-secondary" data-ins-edit="${p.id}">Editar</button><button class="tf-btn tf-btn-secondary" data-ins-archive="${p.id}">Archivar</button>`}</div>`;
    document.querySelector("#ins-detail-dialog").showModal();return;
  }
  if(cov){
    const p=rows.find(x=>x.id===cov.dataset.policyId),u=(p?.usageEvents||[]).find(x=>String(x.id||"")===cov.dataset.coverageInfo);if(!u)return;
    document.querySelector("#coverage-detail-title").textContent=u.description||"Cobertura";
    document.querySelector("#coverage-detail-body").innerHTML=`<div class="tf-detail-grid"><div class="tf-metric"><span class="tf-metric-label">Fecha</span><strong>${escapeHtml(u.date||"—")}</strong></div><div class="tf-metric"><span class="tf-metric-label">Costo total</span><strong>${money(u.serviceCost||0)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Cobertura</span><strong>${money(u.coveredAmount||0)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Pagado por mí</span><strong>${money(u.paidAmount??u.copayAmount??0)}</strong></div><div class="tf-metric"><span class="tf-metric-label">IVA</span><strong>${money(u.vat||0)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Movimiento</span><strong>${u.transactionId?"Vinculado":"No aplica"}</strong></div></div>`;
    document.querySelector("#coverage-detail-dialog").showModal();return;
  }
  if(premiumEdit){
    const p=rows.find(x=>x.id===premiumEdit.dataset.policyId),tx=transactions.find(x=>x.id===premiumEdit.dataset.premiumEdit);
    if(!p||!tx)return;
    document.querySelector("#ins-detail-dialog").close();openPremium(p.id,tx);return;
  }
  if(premium){document.querySelector("#ins-detail-dialog").close();openPremium(premium.dataset.insPremium);return}
  if(reg){document.querySelector("#ins-detail-dialog").close();openCoverage(reg.dataset.insRegister);return}
  if(edit){const p=rows.find(x=>x.id===edit.dataset.insEdit);document.querySelector("#ins-detail-dialog").close();if(p)openPolicy(p);return}
  if(react){await reactivateInsurance(react.dataset.insReactivate);document.querySelector("#ins-detail-dialog").close();await refresh();return}
  if(archive&&await confirmAction({title:"Archivar seguro",message:"Se archivará también su prima recurrente; el histórico se conserva.",confirmText:"Archivar"})){
    await archiveInsurance(archive.dataset.insArchive);document.querySelector("#ins-detail-dialog").close();await refresh();
  }
});

document.querySelector("#ins-detail-close").addEventListener("click",()=>document.querySelector("#ins-detail-dialog").close());
document.querySelector("#coverage-detail-close").addEventListener("click",()=>document.querySelector("#coverage-detail-dialog").close());
requireUser(()=>refresh().catch(err=>{console.error(err);toast("No se pudieron cargar los seguros.")}));
