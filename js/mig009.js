import {requireUser} from "./guard.js";
import {inspectReceivableStoredIds,removeRedundantReceivableIds} from "./data-service.js?v=1.0.82";
import {confirmAction,toast} from "./ui.js";
import {escapeHtml} from "./utils.js";
import {inspectMig009,MIG009_REDUNDANT_IDS,MIG009_CANONICAL_ID} from "./mig009-logic.js?v=1.0.82";

const panel=document.querySelector("#mig009-panel");
const statusBox=document.querySelector("#mig009-status");
const body=document.querySelector("#mig009-body");
const apply=document.querySelector("#mig009-apply");
let rows=[];

function render(){
  if(!panel||!statusBox||!body||!apply)return;
  panel.hidden=false;
  const result=inspectMig009(rows);
  const byId=new Map(rows.map(r=>[r.id,r]));
  body.innerHTML=[...MIG009_REDUNDANT_IDS,MIG009_CANONICAL_ID].map(id=>{
    const r=byId.get(id);
    const stored=r?.hasStoredId?escapeHtml(String(r.storedId)):"—";
    const state=!r?"No encontrado":r.hasStoredId?"ID redundante":"Canónico";
    return `<tr><td><code>${escapeHtml(id)}</code></td><td>${escapeHtml(r?.workPeriod||"—")}</td><td>${stored}</td><td>${escapeHtml(state)}</td></tr>`;
  }).join("");
  if(result.resolved){
    statusBox.className="tf-alert tf-alert-success is-visible";
    statusBox.textContent="MIG-009 resuelta: los receivables usan únicamente el document ID como identificador persistente.";
    apply.disabled=true;
  }else if(!result.safe){
    statusBox.className="tf-alert tf-alert-error is-visible";
    statusBox.textContent=`MIG-009 bloqueada: ${result.blockers.join("; ")}. Requiere reauditoría.`;
    apply.disabled=true;
  }else{
    statusBox.className="tf-alert tf-alert-warn is-visible";
    statusBox.textContent=`MIG-009 pendiente: ${result.pending.length} de los 4 receivables auditados aún guardan un campo id redundante. No se modifican montos, estados ni vínculos contractuales.`;
    apply.disabled=false;
    apply.textContent=`Eliminar ${result.pending.length} id redundante${result.pending.length===1?"":"s"}`;
  }
}
async function refresh(){rows=await inspectReceivableStoredIds();render();}
apply?.addEventListener("click",async()=>{
  const result=inspectMig009(rows);
  if(!result.safe){toast("MIG-009 no coincide con el snapshot auditado.");return;}
  if(result.resolved){toast("MIG-009 ya está resuelta.");return;}
  const ok=await confirmAction({
    title:"MIG-009 · normalizar IDs de cuentas por cobrar",
    message:`Eliminar el campo id redundante de ${result.pending.length} documento(s).`,
    impact:[
      "El document ID de Firestore permanece sin cambios y pasa a ser la única fuente canónica.",
      "No cambia contrato, período, monto, pagado, vencimiento, estado ni factura vinculada.",
      "No crea movimientos ni modifica saldos bancarios."
    ],
    confirmText:"Aplicar MIG-009"
  });
  if(!ok)return;
  apply.disabled=true;
  try{
    await removeRedundantReceivableIds(result.pending);
    await refresh();
    toast("MIG-009 aplicada correctamente.");
  }catch(err){
    console.error(err);toast(err?.message||"No se pudo aplicar MIG-009.");await refresh();
  }
});
requireUser(()=>refresh().catch(err=>{
  console.error(err);
  if(panel)panel.hidden=false;
  if(statusBox){statusBox.className="tf-alert tf-alert-error is-visible";statusBox.textContent="No se pudo verificar MIG-009 contra Firebase.";}
  if(apply)apply.disabled=true;
}));
