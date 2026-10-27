import {requireUser} from "./guard.js";
import {listRecurring,listTransactions,listLiabilities,listFinancingPlans,listAccounts} from "./data-service.js";
import {buildPendingItems} from "./pending-engine.js";
import {money,escapeHtml} from "./utils.js";
let items=[],filter="all";const list=document.querySelector("#pending-list");
function statusLabel(x){return x==="overdue"?"Vencido":x==="today"?"Vence hoy":"Próximo";}
function render(){const rows=items.filter(x=>filter==="all"||x.status===filter);list.innerHTML=rows.map(x=>`<article class="tf-card"><div class="tf-section-heading"><div><div class="tf-section-kicker">${statusLabel(x.status)}</div><h3>${escapeHtml(x.title)}</h3></div><strong>${money(x.amount)}</strong></div><div class="tf-muted">${escapeHtml(x.subtitle)} · ${x.dueDate}</div><div class="tf-actions" style="margin-top:.8rem"><a class="tf-btn tf-btn-primary" href="${x.url}">${escapeHtml(x.actionLabel)}</a></div></article>`).join("")||`<div class="tf-card tf-empty">No hay pendientes en este filtro.</div>`;}
async function load(){const [recurring,transactions,liabilities,plans,accounts]=await Promise.all([listRecurring(),listTransactions(),listLiabilities(),listFinancingPlans(),listAccounts({includeArchived:false})]);items=buildPendingItems({recurring,transactions,liabilities,plans,accounts});render();}
document.querySelectorAll("[data-pending-filter]").forEach(b=>b.addEventListener("click",()=>{filter=b.dataset.pendingFilter;document.querySelectorAll("[data-pending-filter]").forEach(x=>x.classList.toggle("is-selected",x===b));render();}));
requireUser(()=>load().catch(console.error));
