import {requireUser} from "./guard.js";
import {
  listGoals,saveGoal,archiveGoal,listAccounts,listTransactions,calculateBalances,
  getEmergencyFund,listRecurring,listInsurance,listLiabilities,listFinancingPlans,
  listContracts,syncReceivablesClosed
} from "./data-service.js";
import {money,escapeHtml,clamp,todayISO} from "./utils.js";
import {confirmAction,toast} from "./ui.js";
import {defaultEmergencyFundConfig,emergencyFundSummary,monthlyProjection} from "./planning.js";

let goals=[],accounts=[],txs=[],balances={},emergencyConfig=null,recurring=[],insurance=[],debts=[],plans=[],contracts=[],receivables=[];
const list=document.querySelector("#goal-list");

function accountName(id){
  const a=accounts.find(x=>x.id===id);
  return a?[a.bank,a.alias].filter(Boolean).join(" · "):"";
}
function priorityLabel(p){return p==="high"?"Prioridad alta":p==="low"?"Prioridad baja":"Prioridad media"}
function monthlyNeeded(g,saved){
  if(!g.targetDate)return 0;
  const month=todayISO().slice(0,7);
  const target=String(g.targetDate).slice(0,7);
  if(!/^\d{4}-\d{2}$/.test(target))return 0;
  const [fy,fm]=month.split("-").map(Number),[ty,tm]=target.split("-").map(Number);
  const months=Math.max(1,(ty-fy)*12+(tm-fm)+1);
  return Math.max(0,Number(g.target||0)-saved)/months;
}
function render(){
  list.innerHTML=goals.filter(g=>g.active!==false).map(g=>{
    const saved=g.accountId?Math.max(0,Number(balances[g.accountId]||0)):Number(g.savedManual||0);
    const p=clamp(saved/Math.max(1,Number(g.target))*100,0,100);
    const monthly=monthlyNeeded(g,saved);
    return `<div class="tf-card tf-goal-card tf-priority-${escapeHtml(g.priority||"medium")}">
      <div class="tf-section-heading">
        <div><strong>${escapeHtml(g.name)}</strong><div class="tf-muted">${escapeHtml(priorityLabel(g.priority||"medium"))}</div></div>
        <strong>${p.toFixed(0)}%</strong>
      </div>
      <div class="tf-progress" style="margin:.8rem 0"><span style="width:${p}%"></span></div>
      <div class="tf-detail-grid">
        <div class="tf-metric"><span class="tf-metric-label">Acumulado</span><strong>${money(saved)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Objetivo</span><strong>${money(g.target)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Aporte/mes</span><strong>${monthly>0?money(monthly):"—"}</strong></div>
      </div>
      <div class="tf-muted" style="margin-top:.55rem">${g.targetDate?`Objetivo ${escapeHtml(g.targetDate)}`:"Sin fecha objetivo"}${g.accountId?` · ${escapeHtml(accountName(g.accountId))}`:""}</div>
      <div class="tf-actions" style="margin-top:.7rem">
        <button class="tf-btn tf-btn-secondary" data-edit="${g.id}">Editar</button>
        <button class="tf-btn tf-btn-secondary" data-archive="${g.id}">Archivar</button>
      </div>
    </div>`;
  }).join("")||`<div class="tf-card tf-empty">Sin metas activas.</div>`;
}

function resetForm(){
  document.querySelector("#goal-form").reset();
  document.querySelector("#goal-id").value="";
  document.querySelector("#goal-priority").value="medium";
  document.querySelector("#goal-saved").value=0;
  document.querySelector("#goal-account").value="";
  document.querySelector("#goal-submit").textContent="Guardar meta";
  document.querySelector("#goal-cancel").hidden=true;
  document.querySelector("#goal-saved").disabled=false;
}
function toggleManual(){
  const linked=!!document.querySelector("#goal-account").value;
  document.querySelector("#goal-saved").disabled=linked;
  if(linked)document.querySelector("#goal-saved").value=0;
}
function renderEmergency(){
  const card=document.querySelector("#goal-emergency-card");
  if(!emergencyConfig){card.hidden=true;return}
  const projection=monthlyProjection({
    accounts,transactions:txs,recurring,insurance,receivables,contracts,debts,cardPlans:plans,
    month:todayISO().slice(0,7),today:todayISO()
  });
  const fund=emergencyFundSummary({
    config:emergencyConfig,accounts,transactions:txs,recurring,insurance,debts,cardPlans:plans,balances,projection
  });
  card.hidden=false;
  document.querySelector("#goal-emergency-detail").textContent=
    `${money(fund.currentAmount)} / ${money(fund.targetAmount)} · cobertura ${fund.coverageMonths.toFixed(1)} de ${fund.config.targetMonths} meses`;
}

async function refresh(){
  receivables=await syncReceivablesClosed();
  [goals,accounts,txs,emergencyConfig,recurring,insurance,debts,plans,contracts]=await Promise.all([
    listGoals(),listAccounts({includeArchived:false}),listTransactions(),getEmergencyFund(),
    listRecurring(),listInsurance(),listLiabilities(),listFinancingPlans(),listContracts()
  ]);
  balances=calculateBalances(accounts,txs);
  document.querySelector("#goal-account").innerHTML=`<option value="">Sin vincular · usar acumulado manual</option>`+
    accounts.filter(a=>a.accountType!=="credit_card").map(a=>`<option value="${a.id}">${escapeHtml([a.bank,a.alias].filter(Boolean).join(" · "))}</option>`).join("");
  render();renderEmergency();toggleManual();
}

document.querySelector("#goal-account").addEventListener("change",toggleManual);
document.querySelector("#goal-cancel").addEventListener("click",resetForm);

document.querySelector("#goal-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const id=document.querySelector("#goal-id").value||null;
  const data={
    name:document.querySelector("#goal-name").value.trim(),
    category:"general",
    target:Number(document.querySelector("#goal-target").value),
    targetDate:document.querySelector("#goal-date").value||null,
    priority:document.querySelector("#goal-priority").value,
    accountId:document.querySelector("#goal-account").value||null,
    savedManual:Number(document.querySelector("#goal-saved").value||0),
    active:true
  };
  if(!(data.target>0)){toast("El objetivo debe ser mayor que cero.");return}
  if(id){
    if(!await confirmAction({title:"Actualizar meta",message:data.name,impact:["Se recalculará su aporte mensual recomendado."]}))return;
  }
  await saveGoal(data,id);
  resetForm();toast(id?"Meta actualizada.":"Meta guardada.");await refresh();
});

list.addEventListener("click",async e=>{
  const edit=e.target.closest("[data-edit]");
  const archive=e.target.closest("[data-archive]");
  if(edit){
    const g=goals.find(x=>x.id===edit.dataset.edit);if(!g)return;
    document.querySelector("#goal-id").value=g.id;
    document.querySelector("#goal-name").value=g.name||"";
    document.querySelector("#goal-target").value=Number(g.target||0);
    document.querySelector("#goal-date").value=g.targetDate||"";
    document.querySelector("#goal-priority").value=g.priority||"medium";
    document.querySelector("#goal-account").value=g.accountId||"";
    document.querySelector("#goal-saved").value=Number(g.savedManual||0);
    document.querySelector("#goal-submit").textContent="Actualizar meta";
    document.querySelector("#goal-cancel").hidden=false;
    toggleManual();scrollTo({top:0,behavior:"smooth"});
  }
  if(archive&&await confirmAction({title:"Archivar meta",message:"Se conserva su historial.",confirmText:"Archivar"})){
    await archiveGoal(archive.dataset.archive);await refresh();
  }
});

requireUser(()=>refresh().catch(console.error));
