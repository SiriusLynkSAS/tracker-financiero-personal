import {requireUser} from "./guard.js";
import {listAccounts,atomicWrite} from "./data-service.js?v=1.0.82";
import {confirmAction,toast} from "./ui.js";
import {escapeHtml,money} from "./utils.js";
import {inspectMig011,MIG011_CASES,MIG011_TARGET} from "./mig011-logic.js?v=1.0.82";

const panel=document.querySelector("#mig011-panel"),statusBox=document.querySelector("#mig011-status"),body=document.querySelector("#mig011-body"),apply=document.querySelector("#mig011-apply");
let accounts=[];
function render(){
  if(!panel||!statusBox||!body||!apply)return;
  panel.hidden=false;const result=inspectMig011(accounts),byId=new Map(accounts.map(a=>[a.id,a]));
  body.innerHTML=MIG011_CASES.map(c=>{const a=byId.get(c.id);return `<tr><td><code>${escapeHtml(c.id)}</code></td><td>${escapeHtml(a?.bank||"—")}</td><td>${escapeHtml(a?.alias||"—")}</td><td>${a?.active===false?"Archivada":"Activa"}</td><td>${money(a?.openingBalance||0)}</td><td>${escapeHtml(a?.institutionId||"Pendiente")}</td><td>${escapeHtml(a?.institutionDisplayName||"—")}</td></tr>`;}).join("");
  if(result.resolved){statusBox.className="tf-alert tf-alert-success is-visible";statusBox.textContent="MIG-011 resuelta: ambas cuentas conservan IDs separados y comparten la identidad institucional canónica DeUna.";apply.disabled=true;}
  else if(!result.safe){statusBox.className="tf-alert tf-alert-error is-visible";statusBox.textContent=`MIG-011 bloqueada: ${result.blockers.join("; ")}. Requiere reauditoría antes de modificar Firebase.`;apply.disabled=true;}
  else{statusBox.className="tf-alert tf-alert-warn is-visible";statusBox.textContent=`MIG-011 pendiente: ${result.pending.length} cuenta(s) deben recibir institutionId=${MIG011_TARGET.institutionId}. No se fusionarán cuentas ni se modificarán saldos.`;apply.disabled=false;}
}
async function refresh(){accounts=await listAccounts();render();}
apply?.addEventListener("click",async()=>{
  const result=inspectMig011(accounts);if(!result.safe||result.resolved)return;
  const ok=await confirmAction({title:"Aplicar MIG-011 · identidad institucional",message:"Asignar la identidad canónica DeUna a las dos cuentas auditadas.",impact:["No fusiona cuentas ni cambia sus document ID.","No modifica saldos iniciales, movimientos, conciliaciones ni estado activo/archivado.","El texto legacy bank se conserva como evidencia; institutionId será la clave canónica para agrupación futura."],confirmText:"Aplicar MIG-011"});if(!ok)return;
  apply.disabled=true;
  try{
    await atomicWrite(result.pending.map(a=>({collection:"accounts",id:a.id,action:"update",auditType:"account",data:{institutionId:MIG011_TARGET.institutionId,institutionDisplayName:MIG011_TARGET.displayName,institutionIdentitySource:"mig011_reviewed"},note:"MIG-011 · identidad institucional canónica DeUna; sin fusión de cuentas"})));
    await refresh();window.dispatchEvent(new CustomEvent("tf-mig011-applied"));toast("MIG-011 aplicada. Las cuentas siguen separadas y comparten institutionId=deuna.");
  }catch(e){console.error(e);toast(e?.message||"No se pudo aplicar MIG-011.");await refresh();}
});
requireUser(()=>refresh().catch(e=>{console.error(e);if(panel)panel.hidden=false;if(statusBox){statusBox.className="tf-alert tf-alert-error is-visible";statusBox.textContent="No se pudo verificar MIG-011 contra Firebase.";}if(apply)apply.disabled=true;}));
