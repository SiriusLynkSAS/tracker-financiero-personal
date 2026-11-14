import {requireUser} from "./guard.js";
import {getEntity,atomicWrite} from "./data-service.js?v=1.0.76";
import {money,escapeHtml} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

const LIABILITY_ID="qAUdnLmyNy7KEZUC3Jdi";
const AUDITED={
  creditor:"Juan Tobaldo Villarreal Veloz",concept:"Préstamo terreno",mode:"manual",
  originalPrincipal:8000,currentManualBalance:8000,active:false,status:"active"
};
const panel=document.querySelector("#mig007-panel");
const statusBox=document.querySelector("#mig007-status");
const detail=document.querySelector("#mig007-detail");
const apply=document.querySelector("#mig007-apply");
let row=null;
const text=v=>String(v??"");
const moneyEq=(a,b)=>Math.abs(Number(a||0)-Number(b||0))<=0.005;
function auditedConflict(r){
  return !!r && text(r.creditor)===AUDITED.creditor && text(r.concept)===AUDITED.concept && text(r.mode)===AUDITED.mode
    && moneyEq(r.originalPrincipal,AUDITED.originalPrincipal) && moneyEq(r.currentManualBalance,AUDITED.currentManualBalance)
    && r.active===false && text(r.status)==="active";
}
function resolved(r){return !!r && r.active===false && text(r.status)==="archived";}
function render(){
  if(!panel)return; panel.hidden=false;
  if(resolved(row)){
    statusBox.className="tf-alert tf-alert-success is-visible";
    statusBox.textContent="MIG-007 resuelta: el documento real ya usa active=false y status=archived.";
    detail.innerHTML=`<strong>${escapeHtml(row.creditor||AUDITED.creditor)}</strong> · ${escapeHtml(row.concept||AUDITED.concept)} · saldo histórico ${money(row.currentManualBalance??row.originalPrincipal??0)}.`;
    apply.hidden=true; return;
  }
  const safe=auditedConflict(row);
  statusBox.className=`tf-alert ${safe?"tf-alert-info":"tf-alert-error"} is-visible`;
  statusBox.textContent=safe
    ? "Caso auditado confirmado. La deuda ya está archivada; solo falta corregir status=active a status=archived en Firebase."
    : "MIG-007 bloqueada: el registro ya no coincide con el caso auditado. No se realizará una modificación automática.";
  detail.innerHTML=row?`<strong>${escapeHtml(row.creditor||"")}</strong> · ${escapeHtml(row.concept||"")} · principal ${money(row.originalPrincipal)} · saldo histórico ${money(row.currentManualBalance??0)} · active=${escapeHtml(String(row.active))} · status=${escapeHtml(String(row.status||""))}.`:"Registro auditado no encontrado.";
  apply.hidden=false; apply.disabled=!safe;
}
async function refresh(){row=await getEntity("liabilities",LIABILITY_ID);render();}
apply?.addEventListener("click",async()=>{
  await refresh();
  if(!auditedConflict(row)){toast("MIG-007 ya no coincide con el caso auditado. Requiere reauditoría.");return;}
  if(!await confirmAction({
    title:"MIG-007 · normalizar deuda archivada",
    message:`${row.creditor} · ${row.concept}`,
    impact:[
      "Se mantiene active=false: la deuda NO se reactiva.",
      "status cambia de active a archived para reflejar el ARCHIVE histórico ya registrado.",
      `El principal y saldo histórico permanecen en ${money(row.currentManualBalance??row.originalPrincipal??0)}.`,
      "Se conserva archivedAt y no se crean movimientos, pagos ni cambios de saldos bancarios."
    ],
    confirmText:"Normalizar estado"
  }))return;
  apply.disabled=true;
  try{
    await atomicWrite([{collection:"liabilities",id:LIABILITY_ID,action:"update",auditType:"liability",data:{active:false,status:"archived"},note:"MIG-007 · normalización de estado legacy active=false/status=active a archived sin reactivación"}]);
    await refresh(); toast("MIG-007 aplicada correctamente.");
  }catch(err){toast(err?.message||"No se pudo aplicar MIG-007.");await refresh();}
});
requireUser(()=>refresh().catch(err=>{console.error(err);if(panel)panel.hidden=false;if(statusBox){statusBox.className="tf-alert tf-alert-error is-visible";statusBox.textContent="No se pudo verificar MIG-007 contra Firebase.";}if(apply)apply.disabled=true;}));
