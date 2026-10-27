import {requireUser} from "./guard.js";
import {listRecurring,listTransactions,listLiabilities,listFinancingPlans,listAccounts} from "./data-service.js";
import {buildPendingItems} from "./pending-engine.js";
import {money,escapeHtml} from "./utils.js";
function labelStatus(s){return s==="overdue"?"Vencido":s==="today"?"Vence hoy":"Próximo";}
export async function setupPendingMenu(){
  const hosts=[...document.querySelectorAll("[data-pending-host]")]; if(!hosts.length)return;
  const [recurring,transactions,liabilities,plans,accounts]=await Promise.all([listRecurring(),listTransactions(),listLiabilities(),listFinancingPlans(),listAccounts({includeArchived:false})]);
  const items=buildPendingItems({recurring,transactions,liabilities,plans,accounts});
  for(const host of hosts){
    const badge=host.querySelector("[data-pending-count]"); if(badge){badge.textContent=String(items.length);badge.hidden=!items.length;}
    const panel=host.querySelector("[data-pending-panel]");
    panel.innerHTML=`<div class="tf-notification-head"><strong>Pendientes</strong><a href="pendientes.html">Ver todos</a></div>`+(items.slice(0,6).map(x=>`<a class="tf-notification-item" href="${x.url}"><span class="tf-notification-status is-${x.status}">${labelStatus(x.status)}</span><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.dueDate)} · ${money(x.amount)}</span></a>`).join("")||`<div class="tf-empty">No tienes pagos o ingresos pendientes.</div>`);
    host.querySelector("[data-pending-toggle]")?.addEventListener("click",()=>panel.toggleAttribute("hidden"));
    document.addEventListener("click",e=>{if(!host.contains(e.target))panel.hidden=true;});
  }
}
