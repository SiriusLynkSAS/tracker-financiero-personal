
import {requireUser} from "./guard.js";
import {listAssets,saveAsset,archiveAsset,listContracts,listReceivables} from "./data-service.js";
import {straightLineDepreciation} from "./finance.js";
import {money,escapeHtml,todayISO,sum,daysBetween} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

let rows=[],contracts=[],receivables=[];
const list=document.querySelector("#asset-list");

function initial(a){
  return Number(a.purchasePrice||0)+Number(a.purchaseTransport||0)+Number(a.initialAccessories||0)+Number(a.initialCertification||0)+Number(a.otherInitial||0);
}
function bookValue(a){
  const age=Math.max(0,daysBetween(a.purchaseDate||todayISO(),todayISO())/365.25);
  return straightLineDepreciation({
    cost:initial(a),
    residual:a.residualValue,
    usefulLifeYears:a.usefulLifeYears,
    ageYears:age
  }).bookValue;
}
function currentMarketValue(a){
  // V1.0.7+: marketValueProvided distinguishes a real 0 from "not informed".
  if(a.marketValueProvided===true)return Number(a.marketValue??0);
  // Legacy V1.0.6 stored blank fields as 0, so legacy zero is treated as missing.
  if(a.marketValue!==undefined && a.marketValue!==null && Number(a.marketValue)!==0)return Number(a.marketValue);
  return bookValue(a);
}
function contractMetrics(assetId){
  const linked=contracts.filter(c=>c.assetId===assetId);
  const ids=new Set(linked.map(c=>c.id));
  const rr=receivables.filter(r=>ids.has(r.contractId));
  const collected=sum(rr,r=>r.paidAmount||0);
  const transport=sum(rr,r=>{
    const c=linked.find(x=>x.id===r.contractId);
    return Number(c?.monthlyTransportEstimate||0);
  });
  return {collected,transport};
}
function render(){
  document.querySelector("#event-asset").innerHTML=rows.filter(x=>x.active!==false).map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");

  list.innerHTML=rows.filter(a=>a.active!==false).map(a=>{
    const ownCosts=sum(a.events||[],e=>e.kind==="cost"?e.amount:0);
    const ownRevenue=sum(a.events||[],e=>e.kind==="revenue"?e.amount:0);
    const cm=contractMetrics(a.id);
    const costs=ownCosts+cm.transport;
    const rev=ownRevenue+cm.collected;
    const inv=initial(a)+costs;
    const depBook=bookValue(a);
    const market=currentMarketValue(a);
    const recovery=inv>0?rev/inv*100:0;

    return`<div class="tf-card">
      <strong>${escapeHtml(a.name)}</strong>
      <div class="tf-muted">Inversión inicial ${money(initial(a))}</div>
      <div class="tf-detail-grid" style="margin-top:.7rem">
        <div class="tf-metric"><span class="tf-metric-label">Costos operativos</span><strong>${money(costs)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Ingresos cobrados</span><strong>${money(rev)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Valor contable</span><strong>${money(depBook)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Valor patrimonial</span><strong>${money(market)}</strong></div>
      </div>
      ${cm.transport>0?`<div class="tf-muted" style="margin-top:.55rem">Incluye ${money(cm.transport)} de transporte estimado asociado a contratos.</div>`:""}
      ${cm.collected>0?`<div class="tf-muted">Incluye ${money(cm.collected)} efectivamente cobrado en contratos vinculados.</div>`:""}
      <div style="margin-top:.7rem">Recuperación ${recovery.toFixed(1)}%<div class="tf-progress"><span style="width:${Math.min(100,recovery)}%"></span></div></div>
      <div class="tf-actions" style="margin-top:.7rem">
        <a class="tf-btn tf-btn-secondary" href="contratos.html?asset=${a.id}">Contratos</a>
        <button class="tf-btn tf-btn-secondary" data-archive="${a.id}">Archivar</button>
      </div>
    </div>`;
  }).join("")||`<div class="tf-card tf-empty">Sin activos.</div>`;
}

async function refresh(){
  [rows,contracts,receivables]=await Promise.all([listAssets(),listContracts(),listReceivables()]);
  render();
}

document.querySelector("#asset-date").value=todayISO();
document.querySelector("#event-date").value=todayISO();

document.querySelector("#asset-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const marketInput=document.querySelector("#asset-market").value;
  await saveAsset({
    name:document.querySelector("#asset-name").value.trim(),
    type:document.querySelector("#asset-type").value,
    purchasePrice:Number(document.querySelector("#asset-purchase").value),
    purchaseTransport:Number(document.querySelector("#asset-purchase-transport").value||0),
    initialAccessories:Number(document.querySelector("#asset-accessories").value||0),
    initialCertification:Number(document.querySelector("#asset-certification").value||0),
    otherInitial:Number(document.querySelector("#asset-other-initial").value||0),
    purchaseDate:document.querySelector("#asset-date").value,
    residualValue:Number(document.querySelector("#asset-residual").value||0),
    usefulLifeYears:Number(document.querySelector("#asset-life").value||5),
    marketValue:marketInput===""?null:Number(marketInput),
    marketValueProvided:marketInput!=="",
    events:[],
    active:true
  });
  e.target.reset();toast("Activo guardado.");await refresh();
});

document.querySelector("#asset-event-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const a=rows.find(x=>x.id===document.querySelector("#event-asset").value);
  const ev={
    kind:document.querySelector("#event-kind").value,
    concept:document.querySelector("#event-concept").value,
    date:document.querySelector("#event-date").value,
    amount:Number(document.querySelector("#event-amount").value),
    note:document.querySelector("#event-note").value.trim()
  };
  if(!await confirmAction({
    title:"Registrar evento",
    message:`${ev.kind==="cost"?"Costo":"Ingreso"} ${money(ev.amount)}`,
    impact:["Actualizará rentabilidad y recuperación.","Este evento aún es registro económico del activo; no crea automáticamente un movimiento bancario."]
  }))return;
  await saveAsset({...a,events:[...(a.events||[]),ev]},a.id);
  e.target.reset();document.querySelector("#event-date").value=todayISO();toast("Evento registrado.");await refresh();
});

list.addEventListener("click",async e=>{
  const b=e.target.closest("[data-archive]");
  if(b&&await confirmAction({title:"Archivar activo",message:"Se conserva compra, costos e ingresos.",confirmText:"Archivar"})){
    await archiveAsset(b.dataset.archive);await refresh();
  }
});
requireUser(()=>refresh().catch(console.error));
