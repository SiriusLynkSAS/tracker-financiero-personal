import {requireUser} from "./guard.js";
import {listRecurring,listTransactions,listLiabilities,listFinancingPlans,listAccounts,listInvoicesOptional} from "./data-service.js?v=1.0.71";
import {buildPendingItems} from "./pending-engine.js";
import {money,escapeHtml} from "./utils.js";

function labelStatus(s){return s==="overdue"?"Vencido":s==="today"?"Vence hoy":"Próximo";}

let started=false;

function renderHosts(items){
  const hosts=[...document.querySelectorAll("[data-pending-host]")];
  for(const host of hosts){
    const badge=host.querySelector("[data-pending-count]");
    if(badge){
      badge.textContent=String(items.length);
      badge.hidden=!items.length;
    }
    const panel=host.querySelector("[data-pending-panel]");
    if(!panel) continue;
    panel.innerHTML=`<div class="tf-notification-head"><strong>Pendientes</strong><a href="pendientes.html">Ver todos</a></div>`+
      (items.slice(0,6).map(x=>`<a class="tf-notification-item" href="${x.url}"><span class="tf-notification-status is-${x.status}">${labelStatus(x.status)}</span><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.dueDate)} · ${money(x.amount)}</span></a>`).join("")||`<div class="tf-empty">No tienes pagos o ingresos pendientes.</div>`);

    if(host.dataset.pendingBound!=="true"){
      host.dataset.pendingBound="true";
      host.querySelector("[data-pending-toggle]")?.addEventListener("click",e=>{
        e.preventDefault();
        e.stopPropagation();
        panel.toggleAttribute("hidden");
      });
      document.addEventListener("click",e=>{
        if(!host.contains(e.target)) panel.hidden=true;
      });
    }
  }
}

async function refreshPendingMenu(){
  const hosts=[...document.querySelectorAll("[data-pending-host]")];
  if(!hosts.length) return;
  const [recurring,transactions,liabilities,plans,accounts,invoices]=await Promise.all([
    listRecurring(),listTransactions(),listLiabilities(),listFinancingPlans(),listAccounts({includeArchived:false}),listInvoicesOptional()
  ]);
  renderHosts(buildPendingItems({recurring,transactions,liabilities,plans,accounts,invoices}));
}

export function setupPendingMenu(){
  if(started) return;
  started=true;
  requireUser(()=>refreshPendingMenu().catch(err=>{
    console.error("No se pudo cargar Pendientes.",err);
    renderHosts([]);
  }));
}
