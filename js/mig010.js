import {requireUser} from "./guard.js";
import {inspectMig010Transactions,resolveMig010} from "./data-service.js?v=1.0.82";
import {confirmAction,toast} from "./ui.js";
import {escapeHtml,money} from "./utils.js";
import {inspectMig010,MIG010_IDS} from "./mig010-logic.js?v=1.0.82";

const panel=document.querySelector("#mig010-panel"),statusBox=document.querySelector("#mig010-status"),body=document.querySelector("#mig010-body");
const keep=document.querySelector("#mig010-keep"),delMorning=document.querySelector("#mig010-delete-morning"),delEvening=document.querySelector("#mig010-delete-evening");
let rows=[];
function setButtons(disabled){[keep,delMorning,delEvening].forEach(b=>{if(b)b.disabled=disabled;});}
function render(){
  if(!panel||!statusBox||!body)return;panel.hidden=false;
  const result=inspectMig010(rows),byId=new Map(rows.map(r=>[r.id,r]));
  body.innerHTML=MIG010_IDS.map(id=>{const r=byId.get(id);return `<tr><td><code>${escapeHtml(id)}</code></td><td>${escapeHtml(r?.date||"—")}</td><td>${escapeHtml(String(r?.transactionDateTime||"").slice(11,16)||"—")}</td><td>${escapeHtml(r?.description||"—")}</td><td>${money(r?.amount||0)}</td><td>${escapeHtml(r?.category||"—")} · ${escapeHtml(r?.subcategory||"—")}</td><td>${escapeHtml(r?.mig010Resolution||(!r?"No encontrado":"Pendiente"))}</td></tr>`;}).join("");
  if(result.resolved){statusBox.className="tf-alert tf-alert-success is-visible";statusBox.textContent=result.resolution==="distinct"?"MIG-010 resuelta: ambos movimientos fueron confirmados como gastos reales distintos.":"MIG-010 resuelta: un movimiento fue confirmado como duplicado y eliminado con trazabilidad.";setButtons(true);}
  else if(!result.safe){statusBox.className="tf-alert tf-alert-error is-visible";statusBox.textContent=`MIG-010 bloqueada: ${result.blockers.join("; ")}. Requiere reauditoría.`;setButtons(true);}
  else{statusBox.className="tf-alert tf-alert-warn is-visible";statusBox.textContent="MIG-010 pendiente: misma fecha, monto, descripción, cuenta y clasificación, pero horas 08:42 y 19:00. La diferencia horaria impide asumir un duplicado; confirma manualmente la intención.";setButtons(false);}
}
async function refresh(){rows=await inspectMig010Transactions();render();}
async function keepBoth(){
  const ok=await confirmAction({title:"MIG-010 · conservar ambos movimientos",message:"Confirmar que los registros de 08:42 y 19:00 son dos gastos reales distintos.",impact:["No se elimina ningún movimiento.","No cambia ningún saldo.","Ambos quedan marcados como revisados para que no vuelvan a aparecer como duplicado candidato."],confirmText:"Conservar ambos"});if(!ok)return;
  setButtons(true);try{await resolveMig010({resolution:"keep_both"});await refresh();window.dispatchEvent(new CustomEvent("tf-mig010-applied"));toast("MIG-010 resuelta: ambos movimientos se conservan.");}catch(e){console.error(e);toast(e?.message||"No se pudo resolver MIG-010.");await refresh();}
}
async function deleteOne(id){
  const row=rows.find(r=>r.id===id);if(!row)return;
  const ok=await confirmAction({title:"MIG-010 · eliminar duplicado confirmado",message:`Eliminar ${String(row.transactionDateTime||"").slice(11,16)} · ${money(row.amount)} · ${row.description}.`,impact:["Se eliminará únicamente el movimiento seleccionado.","El saldo de su cuenta aumentará en USD 0,45 al retirar ese egreso.","Las conciliaciones posteriores de esa cuenta quedarán para revisión cuando corresponda.","El otro movimiento se conserva y queda marcado como resolución MIG-010."],danger:true,confirmText:"Eliminar duplicado"});if(!ok)return;
  setButtons(true);try{await resolveMig010({resolution:"delete_duplicate",deleteId:id});await refresh();window.dispatchEvent(new CustomEvent("tf-mig010-applied"));toast("MIG-010 resuelta: duplicado eliminado.");}catch(e){console.error(e);toast(e?.message||"No se pudo resolver MIG-010.");await refresh();}
}
keep?.addEventListener("click",keepBoth);
delMorning?.addEventListener("click",()=>deleteOne(MIG010_IDS[0]));
delEvening?.addEventListener("click",()=>deleteOne(MIG010_IDS[1]));
requireUser(()=>refresh().catch(e=>{console.error(e);if(panel)panel.hidden=false;if(statusBox){statusBox.className="tf-alert tf-alert-error is-visible";statusBox.textContent="No se pudo verificar MIG-010 contra Firebase.";}setButtons(true);}));
