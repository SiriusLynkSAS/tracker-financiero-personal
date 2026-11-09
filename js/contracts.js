import {requireUser} from "./guard.js";
import {listContracts,saveContract,listReceivables,listContractPayments,listAssets,listAccounts,atomicWrite,syncReceivablesClosed,recordContractPayment,repairReceivableFromStructuredPayments} from "./data-service.js";
import {escapeHtml,money,todayISO,sum} from "./utils.js";
import {contractPeriodCalculation,proratedMonthlyEstimate} from "./contract-math.js";
import {contractAllocations} from "./asset-math.js";
import {confirmAction,toast} from "./ui.js";
import {auth} from "./firebase.js";
import {firebaseConfig} from "./firebase-config.js";
let contracts=[],receivables=[],contractPayments=[],assets=[],accounts=[],finishId="",dateEditId="",paymentContext=null;
let contractPaymentsAvailable=true;
const contractEditor=document.querySelector("#contract-editor"),tariffEditor=document.querySelector("#tariff-editor");
const BASE_LOAD_TIMEOUT_MS=4500;

function withTimeout(promise,ms,label){
  let timer=null;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(`${label} no respondió en ${Math.round(ms/1000)} s.`)),ms);
  });
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

function decodeFirestoreValue(value={}){
  if("nullValue" in value) return null;
  if("stringValue" in value) return value.stringValue;
  if("booleanValue" in value) return !!value.booleanValue;
  if("integerValue" in value) return Number(value.integerValue);
  if("doubleValue" in value) return Number(value.doubleValue);
  if("timestampValue" in value) return value.timestampValue;
  if("referenceValue" in value) return value.referenceValue;
  if("geoPointValue" in value) return value.geoPointValue;
  if("arrayValue" in value) return (value.arrayValue?.values||[]).map(decodeFirestoreValue);
  if("mapValue" in value){
    const out={};
    for(const [k,v] of Object.entries(value.mapValue?.fields||{})) out[k]=decodeFirestoreValue(v);
    return out;
  }
  return null;
}
function decodeFirestoreDocument(doc={}){
  const out={};
  for(const [k,v] of Object.entries(doc.fields||{})) out[k]=decodeFirestoreValue(v);
  return {id:String(doc.name||"").split("/").pop(),...out};
}
async function restListUserCollection(collectionName){
  const user=auth.currentUser;
  if(!user) throw new Error("Usuario no autenticado para lectura de respaldo.");
  const token=await withTimeout(user.getIdToken(),3500,"Token Firebase");
  const base=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents/users/${encodeURIComponent(user.uid)}/${encodeURIComponent(collectionName)}`;
  const rows=[];
  let pageToken="";
  do{
    const url=new URL(base);
    url.searchParams.set("pageSize","500");
    if(pageToken) url.searchParams.set("pageToken",pageToken);
    const res=await withTimeout(fetch(url.toString(),{
      method:"GET",
      headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},
      cache:"no-store"
    }),6500,`REST ${collectionName}`);
    if(!res.ok){
      const detail=await res.text().catch(()=>"");
      throw new Error(`REST ${collectionName}: ${res.status} ${detail.slice(0,160)}`);
    }
    const data=await res.json();
    rows.push(...(data.documents||[]).map(decodeFirestoreDocument));
    pageToken=data.nextPageToken||"";
  }while(pageToken);
  return rows;
}
async function resilientBaseLoad(label,sdkLoader,collectionName,fallback=[]){
  try{
    const rows=await withTimeout(Promise.resolve().then(()=>sdkLoader()),BASE_LOAD_TIMEOUT_MS,`SDK ${label}`);
    return Array.isArray(rows)?rows:[];
  }catch(sdkErr){
    console.warn(`[Contratos] SDK sin respuesta para ${label}; se intenta REST autenticado.`,sdkErr);
    try{
      const rows=await restListUserCollection(collectionName);
      console.info(`[Contratos] ${label} recuperado por REST (${rows.length}).`);
      return rows;
    }catch(restErr){
      console.error(`[Contratos] También falló el respaldo REST de ${label}.`,restErr);
      return Array.isArray(fallback)?fallback:[];
    }
  }
}
const contractNew=document.querySelector("#contract-new"),tariffNew=document.querySelector("#tariff-new");
const list=document.querySelector("#contract-list"),tbody=document.querySelector("#recv-body");

function assetName(id){return assets.find(x=>x.id===id)?.name||"Activo"}
function allocationLabel(c){const rows=contractAllocations(c);return rows.length?rows.map(x=>`${escapeHtml(assetName(x.assetId))} ${Number(x.percent||0).toFixed(0)}%`).join(" · "):"Sin activo"}
function statusOf(r){const pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0));return pending<=.009?"paid":Number(r.paidAmount)>0?"partial":r.dueDate<todayISO()?"overdue":"pending"}
function structuredPaidForReceivable(receivableId){
  return contractPayments
    .filter(p=>String(p.status||"active")!=="reversed")
    .reduce((total,p)=>total+(Array.isArray(p.allocations)?p.allocations:[])
      .filter(a=>String(a.receivableId||"")===String(receivableId))
      .reduce((s,a)=>s+Number(a.amount||0),0),0);
}
function hasUnmatchedPaid(r){
  if(!contractPaymentsAvailable) return false;
  return Number(r.paidAmount||0)>structuredPaidForReceivable(r.id)+.009;
}
async function safeLoad(label,loader,fallback=[]){
  try{return await withTimeout(Promise.resolve().then(()=>loader()),BASE_LOAD_TIMEOUT_MS,`SDK ${label}`);}
  catch(err){console.warn(`[Contratos] No se pudo cargar ${label}.`,err);return fallback;}
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
  tbody.innerHTML=visibleReceivables.sort((a,b)=>a.workPeriod.localeCompare(b.workPeriod)).map(r=>{const c=contracts.find(x=>x.id===r.contractId),pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0)),st=statusOf(r),statusLabel={paid:"Pagado",partial:"Parcial",overdue:"Vencido",pending:"Pendiente"}[st]||st,periodDetail=r.prorated?`<div class="tf-muted tf-contract-proration">${Number(r.workedDays||0)}/${Number(r.monthDays||0)} días · ${escapeHtml(r.serviceStart||"")} a ${escapeHtml(r.serviceEnd||"")}</div>`:"";return `<tr><td><input type="checkbox" data-recv="${r.id}" ${pending<=.009?"disabled":""}></td><td>${escapeHtml(c?.name||"—")}</td><td>${r.workPeriod}${periodDetail}</td><td>${money(r.amount)}</td><td>${money(r.paidAmount)}</td><td>${money(pending)}</td><td>${r.dueDate}</td><td><span class="tf-pill ${st==="paid"?"tf-pill-ok":st==="overdue"?"tf-pill-danger":"tf-pill-warn"}">${statusLabel}</span></td><td><div class="tf-actions tf-actions-compact">${pending>.009?`<button type="button" class="tf-icon-btn" data-recv-pay="${r.id}" title="Registrar cobro" aria-label="Registrar cobro">$</button>`:""}${hasUnmatchedPaid(r)?`<button type="button" class="tf-icon-btn" data-recv-repair="${r.id}" title="Reparar cobro sin movimiento" aria-label="Reparar cobro sin movimiento">↩</button>`:""}</div></td></tr>`}).join("")||`<tr><td colspan="9" class="tf-empty">Sin cuentas por cobrar devengadas.</td></tr>`;
}
async function refresh(){
  // V1.0.56: prioridad absoluta a la cartera base. Contratos y receivables se
  // cargan y renderizan ANTES de cualquier colección auxiliar u operación de sync.
  // Así, un error en assets/accounts/contractPayments nunca puede dejar la página vacía.
  const [nextContracts,nextReceivables]=await Promise.all([
    resilientBaseLoad("contratos",listContracts,"contracts",contracts),
    resilientBaseLoad("cuentas por cobrar",listReceivables,"receivables",receivables)
  ]);
  contracts=Array.isArray(nextContracts)?nextContracts:[];
  receivables=Array.isArray(nextReceivables)?nextReceivables:[];

  try{render();}catch(err){
    console.error("[Contratos] Error al renderizar cartera base.",err);
    if(list) list.innerHTML=`<div class="tf-empty tf-error-state">No se pudo dibujar la cartera. Recarga la página y revisa la consola.</div>`;
    if(tbody) tbody.innerHTML=`<tr><td colspan="9" class="tf-empty">No se pudieron dibujar las cuentas por cobrar.</td></tr>`;
  }

  // Auxiliares: se cargan después y de forma totalmente independiente.
  assets=await safeLoad("activos",listAssets,assets);
  accounts=await safeLoad("cuentas",listAccounts,accounts);
  try{contractPayments=await withTimeout(listContractPayments(),BASE_LOAD_TIMEOUT_MS,"contractPayments");contractPaymentsAvailable=true;}
  catch(err){contractPaymentsAvailable=false;contractPayments=[];console.warn("[Contratos] contractPayments no disponible; se conserva la cartera visible.",err);}
  try{render();ensureAllocationRow();}catch(err){console.warn("[Contratos] Render auxiliar omitido.",err);}

  // La sincronización de devengados es secundaria y nunca bloquea la UI.
  // Se intenta en segundo plano con límite de tiempo; si el canal SDK queda
  // esperando, la cartera REST/base ya visible permanece intacta.
  void (async()=>{
    try{
      await withTimeout(sync(),6500,"Sincronización de contratos");
      const updated=await resilientBaseLoad("cuentas por cobrar actualizadas",listReceivables,"receivables",receivables);
      if(Array.isArray(updated)) receivables=updated;
      try{contractPayments=await withTimeout(listContractPayments(),BASE_LOAD_TIMEOUT_MS,"contractPayments");contractPaymentsAvailable=true;}
      catch(err){contractPaymentsAvailable=false;contractPayments=[];console.warn("[Contratos] contractPayments continúa no disponible.",err);}
      render();
    }catch(err){
      console.warn("[Contratos] No se pudo sincronizar devengados; se mantiene la última cartera legible.",err);
    }
  })();
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
  document.querySelector("#contract-payment-dialog").showModal();
}
async function applyContractPayment(rows,amount,accountId,date,description){
  const selected=rows.filter(Boolean).filter(r=>Math.max(0,Number(r.amount)-Number(r.paidAmount||0))>.009).sort((a,b)=>a.workPeriod.localeCompare(b.workPeriod));
  const totalPending=sum(selected,r=>Math.max(0,Number(r.amount)-Number(r.paidAmount||0)));
  if(!(amount>0)||!selected.length){toast("Selecciona un período e ingresa un monto.");return false}
  if(amount>totalPending+.009){toast(`El pago excede lo seleccionado por ${money(amount-totalPending)}.`);return false}
  await recordContractPayment({
    receivableIds:selected.map(r=>r.id),
    amount,
    accountId,
    date:date||todayISO(),
    description:description||"Cobro de contrato"
  });
  return true;
}

document.querySelector("#allocate-payment").addEventListener("click",async()=>{const amount=Number(document.querySelector("#payment-amount").value||0),selected=[...document.querySelectorAll("[data-recv]:checked")].map(x=>receivables.find(r=>r.id===x.dataset.recv)).filter(Boolean),totalPending=sum(selected,r=>Math.max(0,Number(r.amount)-Number(r.paidAmount||0)));if(!(amount>0)||!selected.length){toast("Selecciona períodos e ingresa un monto.");return}if(!await confirmAction({title:"Aplicar cobro",message:`Recibido ${money(amount)} sobre ${money(totalPending)} pendiente`,impact:["Se asignará por orden de período.","El ingreso bancario será exactamente el valor aplicado."]}))return;const names=[...new Set(selected.map(r=>contracts.find(c=>c.id===r.contractId)?.name).filter(Boolean))];const periods=selected.map(r=>r.workPeriod).join(", ");if(await applyContractPayment(selected,amount,document.querySelector("#payment-account").value,todayISO(),`Cobro · ${names.join(" / ")||"Contrato"} · ${periods}`)){toast("Cobro aplicado.");document.querySelector("#payment-amount").value="";await refresh();}});

function finishPreview(){const c=contracts.find(x=>x.id===finishId),date=document.querySelector("#contract-finish-date").value,box=document.querySelector("#contract-finish-preview");if(!c||!date){box.innerHTML="";return}if(date<c.startDate){box.innerHTML=`<div class="tf-alert tf-alert-danger is-visible">La fecha no puede ser anterior al inicio ${escapeHtml(c.startDate)}.</div>`;return}const calc=contractPeriodCalculation({...c,endDate:date},date.slice(0,7));const later=receivables.filter(r=>r.contractId===c.id&&r.workPeriod>date.slice(0,7)&&Number(r.paidAmount||0)>.009),same=receivables.find(r=>r.contractId===c.id&&r.workPeriod===date.slice(0,7)&&Number(r.paidAmount||0)>.009);const future=date>todayISO();box.innerHTML=`<div class="tf-subtle"><strong>${future?"Fin programado":"Cierre efectivo"}: ${escapeHtml(date)}</strong>${calc?`<div style="margin-top:.45rem">Período ${escapeHtml(calc.period)} · ${calc.workedDays}/${calc.monthDays} días · tarifa ${money(calc.monthlyTariff)} · <strong>proporcional ${money(calc.amount)}</strong></div>`:""}${later.length?`<div class="tf-alert tf-alert-danger is-visible" style="margin-top:.55rem">Hay ${later.length} período(s) posteriores con cobros aplicados. No se modificarán automáticamente.</div>`:""}${same&&calc&&Math.abs(Number(same.amount)-calc.amount)>.009?`<div class="tf-alert tf-alert-danger is-visible" style="margin-top:.55rem">El período final ya tiene pagos y su monto histórico difiere del nuevo proporcional. Requiere revisión manual.</div>`:""}</div>`;}
function renderContractDetail(contractId,ensureOpen=true){
  const c=contracts.find(x=>x.id===contractId);
  if(!c)return;
  const rr=receivables.filter(r=>r.contractId===c.id).sort((a,b)=>a.workPeriod.localeCompare(b.workPeriod));
  const gen=sum(rr,r=>r.amount),paid=sum(rr,r=>Math.min(Number(r.paidAmount||0),Number(r.amount||0)));
  document.querySelector("#contract-detail-title").textContent=c.name||"Contrato";
  document.querySelector("#contract-detail-body").innerHTML=`<div class="tf-detail-grid"><div class="tf-metric"><span class="tf-metric-label">Estado</span><strong>${c.active!==false?"Activo":"Finalizado"}</strong></div><div class="tf-metric"><span class="tf-metric-label">Inicio</span><strong>${escapeHtml(c.startDate||"—")}</strong></div><div class="tf-metric"><span class="tf-metric-label">Fin</span><strong>${escapeHtml(c.endDate||"Indefinido")}</strong></div><div class="tf-metric"><span class="tf-metric-label">Generado</span><strong>${money(gen)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Cobrado</span><strong>${money(paid)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Pendiente</span><strong>${money(gen-paid)}</strong></div></div><h3 style="margin-top:1rem">Cronograma de cobros</h3><div class="tf-table-wrap"><table class="tf-table"><thead><tr><th>Período</th><th>Generado</th><th>Pagado</th><th>Pendiente</th><th>Vence</th><th>Estado</th><th></th></tr></thead><tbody>${rr.map(r=>{const pending=Math.max(0,Number(r.amount)-Number(r.paidAmount||0)),st=statusOf(r),label={paid:"Pagado",partial:"Parcial",overdue:"Vencido",pending:"Pendiente"}[st]||st;return `<tr><td>${escapeHtml(r.workPeriod)}</td><td>${money(r.amount)}</td><td>${money(r.paidAmount||0)}</td><td>${money(pending)}</td><td>${escapeHtml(r.dueDate||"—")}</td><td>${escapeHtml(label)}</td><td><div class="tf-actions tf-actions-compact">${pending>.009?`<button type="button" class="tf-icon-btn" data-detail-pay="${r.id}" title="Registrar cobro" aria-label="Registrar cobro">$</button>`:""}${hasUnmatchedPaid(r)?`<button type="button" class="tf-icon-btn" data-detail-repair="${r.id}" title="Reparar cobro sin movimiento" aria-label="Reparar cobro sin movimiento">↩</button>`:""}</div></td></tr>`}).join("")||`<tr><td colspan="7" class="tf-empty">Sin períodos devengados.</td></tr>`}</tbody></table></div><div class="tf-actions" style="margin-top:1rem"><button class="tf-btn tf-btn-secondary" type="button" data-detail-dates="${c.id}">Editar fechas</button>${c.active!==false?`<button class="tf-btn tf-btn-secondary" type="button" data-detail-finish="${c.id}">${c.endDate?"Cambiar fecha fin":"Finalizar contrato"}</button>`:""}</div>${c.active===false?`<div class="tf-muted" style="margin-top:.55rem">Contrato finalizado. Las fechas pueden corregirse de forma controlada; los períodos con pagos no se sobrescriben.</div>`:""}`;
  const dialog=document.querySelector("#contract-detail-dialog");
  if(ensureOpen && !dialog.open) dialog.showModal();
}
list.addEventListener("click",e=>{
  const detailButton=e.target.closest("[data-contract-detail]");
  if(detailButton){renderContractDetail(detailButton.dataset.contractDetail,true);return;}
  const b=e.target.closest("[data-finish]");if(!b)return;finishId=b.dataset.finish;const c=contracts.find(x=>x.id===finishId);document.querySelector("#contract-finish-date").value=c?.endDate||todayISO();finishPreview();document.querySelector("#contract-finish-dialog").showModal();
});

tbody.addEventListener("click",async e=>{
  const b=e.target.closest("[data-recv-pay]");if(b){openContractPayment(b.dataset.recvPay);return;}
  const repair=e.target.closest("[data-recv-repair]");
  if(repair){
    const r=receivables.find(x=>x.id===repair.dataset.recvRepair);if(!r)return;
    if(!await confirmAction({title:"Reparar cobro sin movimiento",message:`Período ${r.workPeriod}`,impact:["El importe pagado sin movimiento vinculado volverá a pendiente.","Los cobros estructurados se conservarán."],confirmText:"Reparar"}))return;
    try{await repairReceivableFromStructuredPayments(r.id);await refresh();toast("Cobro reparado.");}catch(err){toast(err?.message||"No se pudo reparar el cobro.");}
  }
});

document.querySelector("#contract-detail-body").addEventListener("click",async e=>{
  const pay=e.target.closest("[data-detail-pay]");
  if(pay){openContractPayment(pay.dataset.detailPay);return;}
  const repair=e.target.closest("[data-detail-repair]");
  if(repair){
    const r=receivables.find(x=>x.id===repair.dataset.detailRepair); if(!r)return;
    if(!await confirmAction({title:"Reparar cobro sin movimiento",message:`Período ${r.workPeriod} · pagado ${money(r.paidAmount||0)}`,impact:["Se conservarán los cobros estructurados que sí tengan movimiento.","El excedente sin movimiento volverá a pendiente."],confirmText:"Reparar"}))return;
    try{await repairReceivableFromStructuredPayments(r.id);await refresh();renderContractDetail(r.contractId,false);toast("Cobro sin movimiento reparado.");}catch(err){toast(err?.message||"No se pudo reparar el cobro.");}
    return;
  }
  const dates=e.target.closest("[data-detail-dates]");
  if(dates){
    const c=contracts.find(x=>x.id===dates.dataset.detailDates); if(!c)return;
    dateEditId=c.id;
    document.querySelector("#contract-dates-start").value=c.startDate||todayISO();
    document.querySelector("#contract-dates-end").value=c.endDate||"";
    document.querySelector("#contract-dates-dialog").showModal();
    return;
  }
  const b=e.target.closest("[data-detail-finish]");
  if(!b)return;
  const c=contracts.find(x=>x.id===b.dataset.detailFinish);
  if(!c)return;
  finishId=c.id;
  document.querySelector("#contract-finish-date").value=c.endDate||todayISO();
  finishPreview();
  document.querySelector("#contract-finish-dialog").showModal();
});
document.querySelector("#contract-payment-close").addEventListener("click",()=>document.querySelector("#contract-payment-dialog").close());
document.querySelector("#contract-payment-save").addEventListener("click",async()=>{
  const ctx=paymentContext?{...paymentContext}:null;
  const r=ctx?receivables.find(x=>x.id===ctx.receivableId):null; if(!r)return;
  const amount=Number(document.querySelector("#contract-payment-amount").value||0);
  const accountId=document.querySelector("#contract-payment-account").value;
  const date=document.querySelector("#contract-payment-date").value||todayISO();
  const description=document.querySelector("#contract-payment-description").value.trim()||"Cobro de contrato";
  if(!await confirmAction({title:"Registrar cobro",message:`${description} · ${money(amount)}`,impact:["Actualiza la cuenta por cobrar.","Registra un ingreso vinculado al contrato.","Si luego eliminas ese movimiento, el cobro se revertirá automáticamente."]}))return;
  document.querySelector("#contract-payment-dialog").close();
  try{
    if(await applyContractPayment([r],amount,accountId,date,description)){
      paymentContext=null;
      await refresh();
      if(ctx?.contractId) renderContractDetail(ctx.contractId,false);
      toast("Cobro aplicado.");
    }
  }catch(err){
    paymentContext=ctx;
    openContractPayment(r.id);
    toast(err?.message||"No se pudo registrar el cobro.");
  }
});
document.querySelector("#contract-detail-close").addEventListener("click",()=>document.querySelector("#contract-detail-dialog").close());
document.querySelector("#contract-finish-date").addEventListener("change",finishPreview);
document.querySelector("#contract-finish-confirm").addEventListener("click",async()=>{const c=contracts.find(x=>x.id===finishId),date=document.querySelector("#contract-finish-date").value;if(!c||!date||date<c.startDate){toast("Revisa la fecha de finalización.");return}const future=date>todayISO();if(!await confirmAction({title:future?"Programar finalización":"Finalizar contrato",message:`Fecha efectiva ${date}`,impact:[future?"El contrato permanecerá activo hasta esa fecha.":"El período final se recalculará proporcionalmente si aún no tiene pagos.","Los períodos posteriores no pagados se anularán.","Los períodos con pagos quedan congelados y se señalarán para revisión."],confirmText:future?"Programar":"Finalizar"}))return;await saveContract({...c,endDate:date,active:future},c.id);document.querySelector("#contract-finish-dialog").close();await refresh();toast(future?"Fecha de finalización programada.":"Contrato finalizado.");});

document.querySelector("#contract-dates-close").addEventListener("click",()=>document.querySelector("#contract-dates-dialog").close());
document.querySelector("#contract-dates-save").addEventListener("click",async()=>{
  const c=contracts.find(x=>x.id===dateEditId);
  const start=document.querySelector("#contract-dates-start").value;
  const end=document.querySelector("#contract-dates-end").value||null;
  if(!c||!start||!^\d{4}-\d{2}-\d{2}$/.test(start)|| (end&&!/^\d{4}-\d{2}-\d{2}$/.test(end)) || (end&&end<start)){toast("Revisa las fechas del contrato.");return}
  const paidAffected=receivables.filter(r=>r.contractId===c.id&&Number(r.paidAmount||0)>.009).length;
  if(!await confirmAction({title:"Actualizar fechas contractuales",message:`${start} → ${end||"sin fecha fin"}`,impact:["Los períodos pendientes se recalcularán o anularán según el nuevo intervalo.",paidAffected?`${paidAffected} período(s) con cobros quedan congelados y no se sobrescriben.`:"No existen períodos pagados que congelar.","El cambio quedará en auditoría."],confirmText:"Actualizar"}))return;
  const active=!end||end>todayISO();
  await saveContract({...c,startDate:start,endDate:end,active},c.id);
  document.querySelector("#contract-dates-dialog").close();
  await refresh();
  renderContractDetail(c.id,false);
  toast("Fechas contractuales actualizadas.");
});

requireUser(()=>refresh().catch(err=>{
  console.error("[Contratos] Fallo de carga principal.",err);
  if(list) list.innerHTML=`<div class="tf-empty tf-error-state">No se pudieron cargar los contratos. Usa Ctrl+F5 y vuelve a intentar.</div>`;
  if(tbody) tbody.innerHTML=`<tr><td colspan="9" class="tf-empty">No se pudieron cargar las cuentas por cobrar.</td></tr>`;
}));
