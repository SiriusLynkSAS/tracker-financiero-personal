import {requireUser} from "./guard.js";
import {listAccounts,listTransactions,calculateBalanceAtDate,listReconciliations,saveReconciliation} from "./data-service.js";
import {money,escapeHtml,todayISO} from "./utils.js";
import {confirmAction,toast} from "./ui.js";
let accounts=[],txs=[],rows=[];const tbody=document.querySelector("#recn-body");
function name(id){const a=accounts.find(x=>x.id===id);return a?`${a.bank} · ${a.alias}`:"—"}
function render(){tbody.innerHTML=rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(r=>`<tr><td>${r.date}</td><td>${escapeHtml(name(r.accountId))}</td><td>${money(r.trackerBalance)}</td><td>${money(r.bankBalance)}</td><td class="${Math.abs(r.difference)>.009?"tf-negative":""}">${money(r.difference)}</td><td><span class="tf-pill ${r.status==="reconciled"?"tf-pill-ok":"tf-pill-danger"}">${r.status}</span></td></tr>`).join("")||`<tr><td colspan="6" class="tf-empty">Sin conciliaciones.</td></tr>`}
async function refresh(){[accounts,txs,rows]=await Promise.all([listAccounts({includeArchived:false}),listTransactions(),listReconciliations()]);document.querySelector("#recn-account").innerHTML=accounts.map(a=>`<option value="${a.id}">${escapeHtml(name(a.id))}</option>`).join("");render()}
document.querySelector("#recn-date").value=todayISO();
document.querySelector("#recn-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const id=document.querySelector("#recn-account").value,date=document.querySelector("#recn-date").value;
  const account=accounts.find(a=>a.id===id),tracker=calculateBalanceAtDate(account,txs,date);
  const bank=Number(document.querySelector("#recn-bank-balance").value),diff=bank-tracker,status=Math.abs(diff)<.01?"reconciled":"review";
  document.querySelector("#recn-result").innerHTML=`Saldo tracker al ${date}: <strong>${money(tracker)}</strong> · banco <strong>${money(bank)}</strong> · diferencia <strong>${money(diff)}</strong>`;
  if(!await confirmAction({title:"Guardar conciliación",message:`Diferencia ${money(diff)}`,impact:[status==="reconciled"?"La cuenta quedará conciliada a esa fecha.":"Quedará pendiente de revisión."]}))return;
  await saveReconciliation({accountId:id,date,trackerBalance:tracker,bankBalance:bank,difference:diff,status});
  toast("Conciliación guardada.");await refresh();
});
requireUser(()=>refresh().catch(console.error));
