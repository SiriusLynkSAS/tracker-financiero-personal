import {requireUser} from "./guard.js";
import {listRecurring,listTransactions,listLiabilities,listFinancingPlans,listAccounts,listInvoicesOptional,listBudgets} from "./data-service.js?v=1.0.92";
import {buildPendingItems} from "./pending-engine.js?v=1.0.92";
import {buildBudgetAlerts} from "./budget-alerts.js";
import {money,escapeHtml,todayISO} from "./utils.js";

function labelStatus(s){return s==="overdue"?"Vencido":s==="today"?"Vence hoy":"Próximo";}
function budgetStatus(alert){return alert.severity==="over"?"Sobrepasado":alert.severity==="critical"?"10% restante":"30% restante";}
function budgetClass(alert){return alert.severity==="over"?"is-budget-over":alert.severity==="critical"?"is-budget-critical":"is-budget-warning";}

let started=false;
let refreshing=false;

function renderHosts({pending=[],budgetAlerts=[]}){
  const hosts=[...document.querySelectorAll("[data-pending-host]")];
  const total=pending.length+budgetAlerts.length;
  for(const host of hosts){
    const badge=host.querySelector("[data-pending-count]");
    if(badge){badge.textContent=String(total);badge.hidden=!total;}
    const panel=host.querySelector("[data-pending-panel]");
    if(!panel)continue;

    const budgetHtml=budgetAlerts.length
      ? `<div class="tf-notification-section-title">Presupuestos</div>`+budgetAlerts.slice(0,4).map(x=>
          `<a class="tf-notification-item" href="${x.url}"><span class="tf-notification-status ${budgetClass(x)}">${budgetStatus(x)}</span><strong>${escapeHtml(x.title)}</strong><span>${x.severity==="over"?`Exceso ${money(Math.abs(x.remaining))}`:`Quedan ${money(Math.max(0,x.remaining))}`} · de ${money(x.available)}</span></a>`
        ).join("")
      : "";
    const pendingHtml=pending.length
      ? `<div class="tf-notification-section-title">Pagos e ingresos</div>`+pending.slice(0,5).map(x=>
          `<a class="tf-notification-item" href="pendientes.html?focus=${encodeURIComponent(x.key)}"><span class="tf-notification-status is-${x.status}">${labelStatus(x.status)}</span><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.dueDate)} · ${money(x.amount)}</span></a>`
        ).join("")
      : "";

    panel.innerHTML=`<div class="tf-notification-head"><strong>Notificaciones</strong><a href="pendientes.html">Ver pendientes</a></div>`+
      (budgetHtml+pendingHtml||`<div class="tf-empty">No tienes alertas ni pendientes financieros.</div>`);

    if(host.dataset.pendingBound!=="true"){
      host.dataset.pendingBound="true";
      host.querySelector("[data-pending-toggle]")?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();panel.toggleAttribute("hidden");});
      document.addEventListener("click",e=>{if(!host.contains(e.target))panel.hidden=true;});
    }
  }
}

async function refreshNotificationMenu(){
  const hosts=[...document.querySelectorAll("[data-pending-host]")];
  if(!hosts.length||refreshing)return;
  refreshing=true;
  try{
    const [recurring,transactions,liabilities,plans,accounts,invoices,budgets]=await Promise.all([
      listRecurring(),listTransactions(),listLiabilities(),listFinancingPlans(),listAccounts({includeArchived:false}),listInvoicesOptional(),listBudgets()
    ]);
    renderHosts({
      pending:buildPendingItems({recurring,transactions,liabilities,plans,accounts,invoices}),
      budgetAlerts:buildBudgetAlerts({budgets,transactions,month:todayISO().slice(0,7)})
    });
  }finally{refreshing=false;}
}

export function setupPendingMenu(){
  if(started)return;
  started=true;
  requireUser(()=>refreshNotificationMenu().catch(err=>{console.error("No se pudieron cargar notificaciones.",err);renderHosts({});}));
  window.addEventListener("tf-data-changed",e=>{
    const name=e.detail?.collection;
    if(["transactions","budgets","recurring","liabilities","financingPlans","invoices","accounts"].includes(name)){
      setTimeout(()=>refreshNotificationMenu().catch(()=>{}),120);
    }
  });
  window.addEventListener("focus",()=>refreshNotificationMenu().catch(()=>{}));
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshNotificationMenu().catch(()=>{});});
}
