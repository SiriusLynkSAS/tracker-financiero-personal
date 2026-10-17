import {requireUser} from "./guard.js";
import {
  listAccounts,listTransactions,calculateBalanceAtDate,listReconciliations,
  saveReconciliation,recoverLostPeriod
} from "./data-service.js";
import {money,escapeHtml,todayISO} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

let accounts=[],txs=[],rows=[];
const tbody=document.querySelector("#recn-body");

function name(id){
  const a=accounts.find(x=>x.id===id);
  return a?`${a.bank} · ${a.alias}`:"—";
}
function options(){
  return accounts.map(a=>`<option value="${a.id}">${escapeHtml(name(a.id))}</option>`).join("");
}
function render(){
  tbody.innerHTML=rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(r=>`
    <tr>
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(name(r.accountId))}</td>
      <td>${money(r.trackerBalance)}</td>
      <td>${money(r.bankBalance)}</td>
      <td class="${Math.abs(Number(r.differenceBefore??r.difference||0))>.009?"tf-negative":""}">${money(r.differenceBefore??r.difference)}</td>
      <td><span class="tf-pill ${String(r.status).startsWith("reconciled")?"tf-pill-ok":"tf-pill-danger"}">${escapeHtml(r.status)}</span></td>
    </tr>
  `).join("")||`<tr><td colspan="6" class="tf-empty">Sin conciliaciones.</td></tr>`;

  const unresolved=txs.filter(t=>t.reconciliationAdjustment===true&&t.classificationStatus!=="classified");
  document.querySelector("#recover-adjustments").innerHTML=unresolved.map(t=>`
    <div class="tf-summary-row">
      <span><strong>${escapeHtml(t.description||"Ajuste por clasificar")}</strong><br><small class="tf-muted">${escapeHtml(t.date)} · ${escapeHtml(name(t.accountId))} · ${t.type==="expense"?"Salida":"Entrada"}</small></span>
      <span><strong>${money(t.amount)}</strong> <a class="tf-btn tf-btn-secondary" href="movimientos.html?account=${encodeURIComponent(t.accountId)}">Abrir Movimientos</a></span>
    </div>
  `).join("")||`<div class="tf-empty">No hay ajustes pendientes de clasificar.</div>`;
}

async function refresh(){
  [accounts,txs,rows]=await Promise.all([
    listAccounts({includeArchived:false}),listTransactions(),listReconciliations()
  ]);
  const opts=options();
  document.querySelector("#recn-account").innerHTML=opts;
  document.querySelector("#recover-account").innerHTML=opts;
  render();
}

document.querySelector("#recn-date").value=todayISO();
document.querySelector("#recover-end").value=todayISO();

document.querySelector("#recn-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const id=document.querySelector("#recn-account").value;
  const date=document.querySelector("#recn-date").value;
  const account=accounts.find(a=>a.id===id);
  const tracker=calculateBalanceAtDate(account,txs,date);
  const bank=Number(document.querySelector("#recn-bank-balance").value);
  const diff=bank-tracker;
  const status=Math.abs(diff)<.01?"reconciled":"review";
  document.querySelector("#recn-result").innerHTML=
    `Saldo Tracker al ${date}: <strong>${money(tracker)}</strong> · banco <strong>${money(bank)}</strong> · diferencia <strong>${money(diff)}</strong>`;
  if(!await confirmAction({title:"Guardar conciliación",message:`Diferencia ${money(diff)}`,impact:[status==="reconciled"?"La cuenta quedará conciliada.":"Quedará pendiente de revisión."]}))return;
  await saveReconciliation({accountId:id,date,trackerBalance:tracker,bankBalance:bank,difference:diff,status});
  toast("Conciliación guardada.");await refresh();
});

document.querySelector("#recover-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const accountId=document.querySelector("#recover-account").value;
  const startDate=document.querySelector("#recover-start").value;
  const endDate=document.querySelector("#recover-end").value;
  const bankBalance=Number(document.querySelector("#recover-bank-balance").value);
  const note=document.querySelector("#recover-note").value.trim();
  if(!startDate||!endDate||startDate>endDate){toast("Revisa las fechas del período.");return}
  const account=accounts.find(x=>x.id===accountId);
  const tracker=calculateBalanceAtDate(account,txs,endDate);
  const diff=bankBalance-tracker;
  document.querySelector("#recover-preview").innerHTML=
    `Tracker: <strong>${money(tracker)}</strong> · saldo real: <strong>${money(bankBalance)}</strong> · ajuste necesario: <strong>${money(diff)}</strong>`;

  if(!await confirmAction({
    title:"Recuperar período perdido",
    message:`${startDate} a ${endDate} · diferencia ${money(diff)}`,
    impact:[
      Math.abs(diff)<.01?"No hace falta crear ajuste.":"Se creará un solo movimiento Por clasificar por la diferencia.",
      "No se inventarán gastos individuales.",
      "Luego podrás reclasificar el ajuste desde Movimientos."
    ],
    confirmText:"Recuperar"
  }))return;

  const result=await recoverLostPeriod({accountId,startDate,endDate,bankBalance,note});
  toast(result.adjustmentTransactionId?"Período recuperado con ajuste por clasificar.":"La cuenta ya coincidía; conciliación guardada.");
  e.target.reset();
  document.querySelector("#recover-end").value=todayISO();
  await refresh();
});

requireUser(()=>refresh().catch(console.error));
