import {requireUser} from "./guard.js";
import {listAccounts,listTransactions,calculateBalances,atomicWrite} from "./data-service.js?v=1.0.82";
import {money,escapeHtml} from "./utils.js";
import {confirmAction,toast} from "./ui.js";
import {classifyMig005Rows,validateMig005Signature} from "./mig005-logic.js?v=1.0.82";

let accounts=[],transactions=[];
const panel=document.querySelector("#mig005-panel");
const body=document.querySelector("#mig005-body");
const count=document.querySelector("#mig005-count");
const statusBox=document.querySelector("#mig005-status");
const applyButton=document.querySelector("#mig005-apply");

function accountLabel(id){
  const row=accounts.find(x=>x.id===id);
  return row?[row.bank,row.alias].filter(Boolean).join(" · "):(id||"—");
}
function balancesMatch(before,after){
  const ids=new Set([...Object.keys(before||{}),...Object.keys(after||{})]);
  return [...ids].every(id=>Math.abs(Number(before?.[id]||0)-Number(after?.[id]||0))<=0.005);
}
function simulatedAfter(rows){
  const ids=new Set(rows.map(x=>x.id));
  return transactions.map(t=>ids.has(t.id)?{...t,fromAccountId:null,toAccountId:null}:t);
}
function rowStatus(tx,classification){
  if(classification.unexpected.some(x=>x.id===tx.id)) return `<span class="tf-pill tf-pill-danger">Bloqueado · no auditado</span>`;
  const mismatch=classification.mismatched.find(x=>x.id===tx.id);
  if(mismatch) return `<span class="tf-pill tf-pill-danger" title="${escapeHtml((mismatch.mig005Issues||[]).join(", "))}">Bloqueado · firma cambió</span>`;
  return `<span class="tf-pill tf-pill-warn">Auditado · limpiar referencias</span>`;
}
function render(){
  if(!panel)return;
  const classification=classifyMig005Rows(transactions);
  panel.hidden=!classification.residual.length;
  if(!classification.residual.length)return;

  count.textContent=`${classification.candidates.length} auditado(s) · ${classification.residual.length} residual(es)`;
  body.innerHTML=[...classification.residual]
    .sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))||String(a.id).localeCompare(String(b.id)))
    .map(t=>`<tr>
      <td><code>${escapeHtml(t.id)}</code></td>
      <td>${escapeHtml(t.date||"—")}</td>
      <td><strong>${escapeHtml(t.description||"Sin descripción")}</strong><div class="tf-muted">${escapeHtml([t.category,t.subcategory].filter(Boolean).join(" · "))}</div></td>
      <td>${money(t.amount)}</td>
      <td>${escapeHtml(accountLabel(t.accountId))}</td>
      <td><div><strong>from:</strong> ${escapeHtml(accountLabel(t.fromAccountId))}</div><div><strong>to:</strong> ${escapeHtml(accountLabel(t.toAccountId))}</div></td>
      <td>${rowStatus(t,classification)}</td>
    </tr>`).join("");

  const before=calculateBalances(accounts,transactions);
  const after=calculateBalances(accounts,simulatedAfter(classification.candidates));
  const ledgerOk=balancesMatch(before,after);
  const blocked=!classification.safe || !ledgerOk;
  applyButton.disabled=blocked;
  statusBox.className=`tf-alert ${blocked?"tf-alert-error":"tf-alert-info"} is-visible`;
  if(classification.unexpected.length || classification.mismatched.length){
    statusBox.textContent=`MIG-005 bloqueada: se detectaron ${classification.unexpected.length} referencia(s) no auditada(s) y ${classification.mismatched.length} registro(s) cuya firma difiere del snapshot. No se hará ninguna escritura automática.`;
  }else if(!ledgerOk){
    statusBox.textContent="MIG-005 bloqueada: la simulación previa alteraría al menos un saldo. Requiere reauditoría antes de escribir.";
  }else{
    statusBox.textContent="Validación previa correcta: los casos coinciden con el snapshot auditado y la simulación confirma saldos idénticos antes/después.";
  }
}

async function refresh(){
  [accounts,transactions]=await Promise.all([listAccounts(),listTransactions()]);
  render();
}

applyButton?.addEventListener("click",async()=>{
  await refresh();
  const classification=classifyMig005Rows(transactions);
  if(!classification.safe){toast("MIG-005 no puede ejecutarse: la evidencia actual no coincide íntegramente con la auditoría.");return;}

  const before=calculateBalances(accounts,transactions);
  const after=calculateBalances(accounts,simulatedAfter(classification.candidates));
  if(!balancesMatch(before,after)){toast("MIG-005 bloqueada porque la simulación modifica saldos.");return;}

  for(const row of classification.candidates){
    const validation=validateMig005Signature(row);
    if(!validation.ok){toast(`MIG-005 bloqueada para ${row.id}: ${validation.issues.join(", ")}.`);return;}
  }

  if(!await confirmAction({
    title:"Aplicar MIG-005",
    message:`${classification.candidates.length} movimiento(s) expense auditado(s)`,
    impact:[
      "Los únicos campos funcionales que se limpian son fromAccountId y toAccountId, dejándolos en null en los registros auditados.",
      "No se modifican monto, fecha, accountId, categoría, subcategoría ni descripción; el writer actualiza únicamente metadatos técnicos de versión/actualización.",
      "La simulación previa confirma que los saldos de todas las cuentas permanecen idénticos.",
      "Cada actualización quedará registrada en auditLog."
    ],
    confirmText:"Aplicar MIG-005"
  }))return;

  applyButton.disabled=true;
  try{
    await atomicWrite(classification.candidates.map(t=>({
      collection:"transactions",id:t.id,action:"update",auditType:"transaction",
      data:{fromAccountId:null,toAccountId:null},
      note:"MIG-005 · limpieza de referencias fromAccountId/toAccountId residuales en expense auditado"
    })));
    await refresh();
    toast("MIG-005 aplicada: referencias legacy limpiadas sin alterar saldos.");
    window.dispatchEvent(new CustomEvent("tf-mig005-applied"));
  }catch(err){
    applyButton.disabled=false;
    toast(err?.message||"No se pudo aplicar MIG-005.");
  }
});

requireUser(()=>refresh().catch(err=>{
  console.error(err);
  if(statusBox){statusBox.className="tf-alert tf-alert-error is-visible";statusBox.textContent="No se pudo verificar MIG-005 contra Firebase.";}
}));
