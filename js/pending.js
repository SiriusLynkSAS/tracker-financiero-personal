import {requireUser} from "./guard.js";
import {listRecurring,listTransactions,listLiabilities,listFinancingPlans,listAccounts} from "./data-service.js";
import {buildPendingItems} from "./pending-engine.js";
import {money,escapeHtml} from "./utils.js";
let items=[],filter="all";
const list=document.querySelector("#pending-list");
const dialog=document.querySelector("#pending-detail-dialog");
function statusLabel(x){return x==="overdue"?"Vencido":x==="today"?"Vence hoy":"Próximo";}
function render(){
  const rows=items.filter(x=>filter==="all"||x.status===filter);
  list.innerHTML=rows.map(x=>`<button type="button" class="tf-card tf-pending-card-button" data-pending-key="${escapeHtml(x.key)}"><div class="tf-section-heading"><div><div class="tf-section-kicker">${statusLabel(x.status)}</div><h3>${escapeHtml(x.title)}</h3></div><strong>${money(x.amount)}</strong></div><div class="tf-muted">${escapeHtml(x.subtitle)} · ${x.dueDate}</div><div class="tf-pending-open-hint">Ver detalle ›</div></button>`).join("")||`<div class="tf-card tf-empty">No hay pendientes en este filtro.</div>`;
}
function openPending(item){
  if(!item||!dialog)return;
  document.querySelector("#pending-detail-status").textContent=statusLabel(item.status);
  document.querySelector("#pending-detail-title").textContent=item.title;
  document.querySelector("#pending-detail-body").innerHTML=`<div class="tf-detail-grid"><div class="tf-metric"><span class="tf-metric-label">Monto</span><strong>${money(item.amount)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Vence</span><strong>${escapeHtml(item.dueDate)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Detalle</span><strong>${escapeHtml(item.subtitle||"—")}</strong></div></div>`;
  const action=document.querySelector("#pending-detail-action");
  action.href=item.url;action.textContent=item.actionLabel||"Abrir acción";
  dialog.showModal();
}
async function load(){const [recurring,transactions,liabilities,plans,accounts]=await Promise.all([listRecurring(),listTransactions(),listLiabilities(),listFinancingPlans(),listAccounts({includeArchived:false})]);items=buildPendingItems({recurring,transactions,liabilities,plans,accounts});render();}
document.querySelectorAll("[data-pending-filter]").forEach(b=>b.addEventListener("click",()=>{filter=b.dataset.pendingFilter;document.querySelectorAll("[data-pending-filter]").forEach(x=>x.classList.toggle("is-selected",x===b));render();}));
list?.addEventListener("click",e=>{const b=e.target.closest("[data-pending-key]");if(!b)return;openPending(items.find(x=>x.key===b.dataset.pendingKey));});
document.querySelector("#pending-detail-close")?.addEventListener("click",()=>dialog?.close());
requireUser(()=>load().catch(console.error));
