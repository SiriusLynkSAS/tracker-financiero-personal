import {requireUser} from "./guard.js";
import {listAssets,saveAsset,archiveAsset,reactivateAsset,listContracts,listReceivables} from "./data-service.js";
import {money,escapeHtml,todayISO} from "./utils.js";
import {assetRecoverySummary,assetInitialCost} from "./asset-math.js";
import {confirmAction,toast} from "./ui.js";

let rows=[],contracts=[],receivables=[],showArchived=false;
const list=document.querySelector("#asset-list");
const editor=document.querySelector("#asset-editor"),eventEditor=document.querySelector("#asset-event-editor");
const newButton=document.querySelector("#asset-new"),archivedToggle=document.querySelector("#asset-archived-toggle");

const eventLabels={operating_cost:"Costo operativo",cost:"Costo operativo",capital_improvement:"Mejora capitalizable",revenue:"Ingreso directo"};
const conceptLabels={transport:"Transporte",maintenance:"Mantenimiento",calibration:"Calibración / certificación",certification:"Calibración / certificación",repair:"Reparación",insurance:"Seguro",improvement:"Mejora / ampliación",rental:"Arriendo / uso productivo",other:"Otro"};

function marketValue(a,book){
  if(a.marketValueProvided===true)return Number(a.marketValue??0);
  if(a.marketValue!==undefined&&a.marketValue!==null&&String(a.marketValue)!==""&&Number(a.marketValue)!==0)return Number(a.marketValue);
  return book;
}
function contractNames(a){
  const linked=contracts.filter(c=>{
    const allocs=Array.isArray(c.assetAllocations)&&c.assetAllocations.length?c.assetAllocations:(c.assetId?[{assetId:c.assetId,percent:100}]:[]);
    return allocs.some(x=>x.assetId===a.id&&Number(x.percent||0)>0);
  });
  return linked.map(c=>escapeHtml(c.name)).join(", ")||"Sin contratos vinculados";
}
function render(){
  const archivedCount=rows.filter(a=>a.active===false).length;
  archivedToggle.hidden=!archivedCount;
  archivedToggle.textContent=showArchived?"Ver activos":`Archivados (${archivedCount})`;
  newButton.hidden=showArchived;
  document.querySelector("#event-asset").innerHTML=rows.filter(x=>x.active!==false).map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");

  list.innerHTML=rows.filter(a=>showArchived?a.active===false:a.active!==false).map(a=>{
    const s=assetRecoverySummary(a,contracts,receivables);
    const market=marketValue(a,s.bookValue);
    const events=[...(a.events||[])].sort((x,y)=>String(y.date||"").localeCompare(String(x.date||""))).slice(0,6);
    return `<section class="tf-card tf-asset-recovery-card">
      <div class="tf-asset-head"><div><h2>${escapeHtml(a.name)}</h2><div class="tf-muted">${escapeHtml(a.type||"equipment")} · compra ${escapeHtml(a.purchaseDate||"—")} · servicio ${escapeHtml(a.commissioningDate||a.purchaseDate||"—")}</div></div>${showArchived?`<button class="tf-btn tf-btn-primary" data-reactivate="${a.id}">Reactivar</button>`:`<button class="tf-btn tf-btn-secondary" data-archive="${a.id}">Archivar</button>`}</div>
      <div class="tf-asset-block"><h3>Adquisición y puesta en operación</h3><div class="tf-detail-grid">
        <div class="tf-metric"><span class="tf-metric-label">Costo inicial</span><strong>${money(s.initialCost)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Mejoras capitalizadas</span><strong>${money(s.improvements)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Costo capitalizado</span><strong>${money(s.capitalizedCost)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Costo financiero</span><strong>${money(s.financingCost)}</strong></div>
      </div></div>
      <div class="tf-asset-block"><h3>Depreciación</h3><div class="tf-detail-grid">
        <div class="tf-metric"><span class="tf-metric-label">Depreciación anual</span><strong>${money(s.annual)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Depreciación acumulada</span><strong>${money(s.accumulated)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Valor contable</span><strong>${money(s.bookValue)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Valor patrimonial</span><strong>${money(market)}</strong></div>
      </div></div>
      <div class="tf-asset-block"><h3>Recuperación por contratos</h3><div class="tf-muted">${contractNames(a)}</div><div class="tf-detail-grid" style="margin-top:.7rem">
        <div class="tf-metric"><span class="tf-metric-label">Contribución devengada</span><strong>${money(s.recoveredAccrued)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Contribución cobrada</span><strong>${money(s.recoveredCollected)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Pendiente capital</span><strong>${money(s.pendingCapital)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Recuperación inversión</span><strong>${s.recoveryPct.toFixed(1)}%</strong></div>
      </div><div class="tf-progress" style="margin-top:.55rem"><span style="width:${Math.min(100,Math.max(0,s.recoveryPct))}%"></span></div>
      <div class="tf-muted" style="margin-top:.55rem">Ingresos contractuales atribuidos cobrados ${money(s.collectedRevenue)} menos costos directos atribuidos ${money(s.directCostCollected)}.</div></div>
      <div class="tf-asset-block"><h3>Resultado económico</h3><div class="tf-detail-grid">
        <div class="tf-metric"><span class="tf-metric-label">Costos operativos</span><strong>${money(s.operatingCosts)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Costo económico total</span><strong>${money(s.economicCost)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Resultado acumulado</span><strong class="${s.economicResult>=0?"tf-positive":"tf-negative"}">${money(s.economicResult)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">ROI</span><strong class="${s.roi>=0?"tf-positive":"tf-negative"}">${s.roi.toFixed(1)}%</strong></div>
      </div></div>
      <div class="tf-asset-block"><h3>Últimos movimientos</h3>${events.length?events.map(e=>`<div class="tf-summary-row"><span>${escapeHtml(e.date||"—")} · ${escapeHtml(eventLabels[e.kind]||e.kind)} · ${escapeHtml(conceptLabels[e.concept]||e.concept)}${e.note?`<br><small class="tf-muted">${escapeHtml(e.note)}</small>`:""}</span><strong>${money(e.amount)}</strong></div>`).join(""):`<div class="tf-empty">Sin movimientos adicionales.</div>`}</div>
      <div class="tf-actions">${showArchived?"":`<button class="tf-btn tf-btn-secondary" data-event="${a.id}">Registrar movimiento</button>`}<a class="tf-btn tf-btn-secondary" href="contratos.html?asset=${a.id}">Ver contratos</a></div>
    </section>`;
  }).join("")||`<div class="tf-card tf-empty">${showArchived?"Sin activos archivados.":"Sin activos activos."}</div>`;
}

async function refresh(){
  [rows,contracts,receivables]=await Promise.all([listAssets(),listContracts(),listReceivables()]);
  render();
}

document.querySelector("#asset-date").value=todayISO();
document.querySelector("#asset-commissioning").value=todayISO();
document.querySelector("#event-date").value=todayISO();

document.querySelector("#asset-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const marketInput=document.querySelector("#asset-market").value;
  const purchaseDate=document.querySelector("#asset-date").value;
  const commissioningDate=document.querySelector("#asset-commissioning").value||purchaseDate;
  const asset={
    name:document.querySelector("#asset-name").value.trim(),
    type:document.querySelector("#asset-type").value,
    purchasePrice:Number(document.querySelector("#asset-purchase").value||0),
    purchaseTaxes:Number(document.querySelector("#asset-taxes").value||0),
    purchaseTransport:Number(document.querySelector("#asset-purchase-transport").value||0),
    purchaseInsurance:Number(document.querySelector("#asset-purchase-insurance").value||0),
    initialAccessories:Number(document.querySelector("#asset-accessories").value||0),
    initialCertification:Number(document.querySelector("#asset-certification").value||0),
    initialSetup:Number(document.querySelector("#asset-setup").value||0),
    otherInitial:Number(document.querySelector("#asset-other-initial").value||0),
    purchaseDate,commissioningDate,
    residualValue:Number(document.querySelector("#asset-residual").value||0),
    usefulLifeYears:Number(document.querySelector("#asset-life").value||5),
    financingCost:Number(document.querySelector("#asset-financing").value||0),
    depreciationMethod:"straight_line",
    marketValue:marketInput===""?null:Number(marketInput),
    marketValueProvided:marketInput!=="",
    events:[],active:true
  };
  const nonNegative=[asset.purchasePrice,asset.purchaseTaxes,asset.purchaseTransport,asset.purchaseInsurance,asset.initialAccessories,asset.initialCertification,asset.initialSetup,asset.otherInitial,asset.residualValue,asset.financingCost];
  if(!asset.name||!purchaseDate||!commissioningDate||asset.usefulLifeYears<=0||nonNegative.some(v=>!Number.isFinite(v)||v<0)){toast("Revisa nombre, fechas, costos y vida útil.");return}
  if(commissioningDate<purchaseDate){toast("La puesta en servicio no puede ser anterior a la compra.");return}
  if(asset.residualValue>assetInitialCost(asset)){toast("El valor residual no puede superar el costo inicial.");return}
  await saveAsset(asset);
  e.target.reset();document.querySelector("#asset-date").value=todayISO();document.querySelector("#asset-commissioning").value=todayISO();
  toast("Activo guardado.");editor.hidden=true;await refresh();
});

document.querySelector("#asset-event-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const a=rows.find(x=>x.id===document.querySelector("#event-asset").value);if(!a)return;
  const ev={
    id:`ev-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    kind:document.querySelector("#event-kind").value,
    concept:document.querySelector("#event-concept").value,
    date:document.querySelector("#event-date").value,
    amount:Number(document.querySelector("#event-amount").value||0),
    note:document.querySelector("#event-note").value.trim()
  };
  if(!(ev.amount>0)||!ev.date){toast("Ingresa fecha y monto válido.");return}
  if(!await confirmAction({title:"Registrar movimiento del activo",message:`${eventLabels[ev.kind]} ${money(ev.amount)}`,impact:[ev.kind==="capital_improvement"?"Aumentará el costo capitalizado y la base de depreciación.":ev.kind==="operating_cost"?"Aumentará el costo económico operativo, no la base contable.":"Se sumará a la recuperación económica directa del activo.","No crea automáticamente un movimiento bancario."]}))return;
  await saveAsset({...a,events:[...(a.events||[]),ev]},a.id);
  e.target.reset();document.querySelector("#event-date").value=todayISO();toast("Movimiento registrado.");eventEditor.hidden=true;await refresh();
});

newButton.addEventListener("click",()=>{document.querySelector("#asset-form").reset();document.querySelector("#asset-date").value=todayISO();document.querySelector("#asset-commissioning").value=todayISO();editor.hidden=false;editor.scrollIntoView({behavior:"smooth"})});
archivedToggle.addEventListener("click",()=>{showArchived=!showArchived;editor.hidden=true;eventEditor.hidden=true;render()});
document.querySelector("#asset-cancel")?.addEventListener("click",()=>{editor.hidden=true});
document.querySelector("#asset-event-cancel")?.addEventListener("click",()=>{eventEditor.hidden=true});
list.addEventListener("click",async e=>{
  const b=e.target.closest("[data-archive]"),re=e.target.closest("[data-reactivate]"),ev=e.target.closest("[data-event]");
  if(ev){document.querySelector("#event-asset").value=ev.dataset.event;eventEditor.hidden=false;eventEditor.scrollIntoView({behavior:"smooth"});return}
  if(re){await reactivateAsset(re.dataset.reactivate);await refresh();return}
  if(b&&await confirmAction({title:"Archivar activo",message:"Se conserva todo el historial económico y contractual.",confirmText:"Archivar"})){
    await archiveAsset(b.dataset.archive);await refresh();
  }
});
requireUser(()=>refresh().catch(console.error));
