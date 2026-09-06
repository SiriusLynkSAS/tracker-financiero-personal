import { requireUser } from "./guard.js";
import {
  listAccounts,listTransactions,calculateBalances,listLiabilities,listFinancingPlans,
  listInvestments,listAssets,listReceivables,listRecurring,listInsurance,listCategories,
  listContracts,getEmergencyFund,syncReceivablesClosed
} from "./data-service.js";
import { money,sum,escapeHtml,todayISO,addDaysISO,isoFromParts,daysBetween } from "./utils.js";
import { straightLineDepreciation } from "./finance.js";
import { categoryStyle } from "./category-catalog.js";
import { categoryBadge } from "./category-icons.js";
import {monthlyProjection,emergencyFundSummary,defaultEmergencyFundConfig} from "./planning.js";

let state={},assetChart=null,expenseChart=null;

function themeColors(){
  const dark=document.documentElement.getAttribute("data-theme")==="dark";
  return{
    text:dark?"#dbe5f5":"#41516a",
    border:dark?"#111a2b":"#ffffff",
    assets:[dark?"#75a7ff":"#3f7fdd",dark?"#a694ef":"#7863c9",dark?"#59cabb":"#1b9a89"],
    fallback:[dark?"#ed8a80":"#d95d52",dark?"#e8b85a":"#d79018",dark?"#78b8df":"#3f8fc7",dark?"#a694ef":"#7c63d6",dark?"#59cabb":"#0f9f8f",dark?"#b6c2d4":"#7a8798"]
  };
}
function cssColorToken(token){
  const styles=getComputedStyle(document.documentElement);
  const map={blue:"--tf-blue",sky:"--tf-sky",teal:"--tf-teal",green:"--tf-positive",amber:"--tf-amber",coral:"--tf-coral",violet:"--tf-violet",slate:"--tf-muted"};
  return styles.getPropertyValue(map[token]||"--tf-blue").trim()||"#64748b";
}
function nextMonthly(day){
  const now=new Date(),y=now.getFullYear(),m=now.getMonth()+1;
  let d=Math.min(Number(day||1),new Date(y,m,0).getDate()),iso=isoFromParts(y,m,d);
  if(iso<todayISO()){const next=new Date(y,m,1);d=Math.min(Number(day||1),new Date(next.getFullYear(),next.getMonth()+1,0).getDate());iso=isoFromParts(next.getFullYear(),next.getMonth()+1,d)}
  return iso;
}
function periodBounds(mode){
  const now=new Date(),y=now.getFullYear(),m=now.getMonth()+1;
  if(mode==="month"){const last=new Date(Date.UTC(y,m,0)).getUTCDate();return{start:isoFromParts(y,m,1),end:isoFromParts(y,m,last),label:now.toLocaleDateString("es-EC",{month:"long",year:"numeric"})}}
  if(mode==="year")return{start:`${y}-01-01`,end:`${y}-12-31`,label:`Año ${y}`};
  return{start:"0000-01-01",end:"9999-12-31",label:"Todo el historial"};
}
function getPeriodTransactions(){
  const bounds=periodBounds(document.querySelector("#summary-period").value);
  document.querySelector("#summary-period-label").textContent=bounds.label;
  return state.txs.filter(t=>t.date>=bounds.start&&t.date<=bounds.end);
}
function renderPeriodMetrics(){
  const txs=getPeriodTransactions();
  const income=sum(txs.filter(t=>t.type==="income"),t=>t.amount);
  const expense=sum(txs.filter(t=>t.type==="expense"),t=>t.amount);
  const flow=income-expense;
  document.querySelector("#kpi-income").textContent=money(income);
  document.querySelector("#kpi-expense").textContent=money(expense);
  document.querySelector("#kpi-flow").textContent=money(flow);
  const flowEl=document.querySelector("#kpi-flow");
  flowEl.classList.toggle("tf-positive",flow>=0);flowEl.classList.toggle("tf-negative",flow<0);
  renderExpenseChart(txs);
}
function renderAssetChart(){
  const values=[state.liquidity,state.invested,state.assetValue],labels=["Liquidez","Inversiones","Activos productivos"],total=sum(values);
  const canvas=document.querySelector("#asset-pie-chart"),empty=document.querySelector("#asset-pie-empty");
  assetChart?.destroy();assetChart=null;
  if(total<=0){canvas.hidden=true;empty.hidden=false;return}
  canvas.hidden=false;empty.hidden=true;
  assetChart=new Chart(canvas,{type:"doughnut",data:{labels,datasets:[{data:values,backgroundColor:themeColors().assets,borderColor:themeColors().border,borderWidth:3,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:"66%",plugins:{legend:{position:"bottom",labels:{usePointStyle:true,boxWidth:10,padding:16,color:themeColors().text}},tooltip:{callbacks:{label(c){const v=Number(c.raw||0),pct=total?100*v/total:0;return`${c.label}: ${money(v)} · ${pct.toFixed(1)}%`}}}}}});
}
function categoryExpenseTotals(txs){
  const totals={};
  for(const tx of txs.filter(t=>t.type==="expense")){
    if(tx.splits?.length){for(const s of tx.splits){const k=s.category||"Sin categoría";totals[k]=(totals[k]||0)+Number(s.amount||0)}}
    else{const k=tx.category||"Sin categoría";totals[k]=(totals[k]||0)+Number(tx.amount||0)}
  }
  return Object.entries(totals).sort((a,b)=>b[1]-a[1]);
}
function displayExpenseRows(txs){
  const rows=categoryExpenseTotals(txs),total=sum(rows,x=>x[1]);
  if(rows.length<=6)return rows.map(([name,value])=>({name,value,style:categoryStyle(state.categories,"expense",name)}));
  const major=[],minor=[];
  rows.forEach(r=>((r[1]/Math.max(1,total))>=.04&&major.length<5?major:minor).push(r));
  const result=major.map(([name,value])=>({name,value,style:categoryStyle(state.categories,"expense",name)}));
  if(minor.length)result.push({name:"Otros",value:sum(minor,x=>x[1]),style:{icon:"wallet",color:"slate"}});
  return result;
}
function renderExpenseChart(txs){
  const rows=displayExpenseRows(txs),canvas=document.querySelector("#expense-pie-chart"),empty=document.querySelector("#expense-pie-empty"),legend=document.querySelector("#expense-pie-legend");
  expenseChart?.destroy();expenseChart=null;
  if(!rows.length){canvas.hidden=true;legend.innerHTML="";empty.hidden=false;return}
  canvas.hidden=false;empty.hidden=true;
  const total=sum(rows,r=>r.value),colors=rows.map(r=>cssColorToken(r.style.color));
  expenseChart=new Chart(canvas,{type:"doughnut",data:{labels:rows.map(r=>r.name),datasets:[{data:rows.map(r=>r.value),backgroundColor:colors,borderColor:themeColors().border,borderWidth:3,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:"64%",plugins:{legend:{display:false},tooltip:{callbacks:{label(c){const v=Number(c.raw||0);return`${c.label}: ${money(v)} · ${(100*v/total).toFixed(1)}%`}}}}}});
  legend.innerHTML=rows.map(r=>{
    const pct=total?100*r.value/total:0;
    return `<div class="tf-category-legend-row">
      ${categoryBadge({icon:r.style.icon,color:r.style.color,label:r.name})}
      <div class="tf-category-legend-name"><strong>${escapeHtml(r.name)}</strong><span>${money(r.value)}</span></div>
      <div class="tf-category-legend-pct">${pct.toFixed(1)}%</div>
    </div>`;
  }).join("");
}
function renderBanks(){
  const banks={};
  state.active.filter(a=>a.accountType!=="credit_card").forEach(a=>{banks[a.bank]=(banks[a.bank]||0)+Number(state.balances[a.id]||0)});
  document.querySelector("#bank-summary").innerHTML=Object.entries(banks).sort((a,b)=>a[0].localeCompare(b[0],"es",{sensitivity:"base"})).map(([bank,v])=>`<div class="tf-summary-row"><span>${escapeHtml(bank)}</span><strong>${money(v)}</strong></div>`).join("")||`<div class="tf-empty">Sin cuentas.</div>`;
}
function renderUpcoming(){
  const events=[];
  for(const r of state.recur.filter(x=>x.active!==false))events.push({date:nextMonthly(r.dayOfMonth),name:r.name,amount:r.amount,rem:r.reminderDaysBefore||0});
  for(const i of state.ins.filter(x=>x.active!==false))events.push({date:nextMonthly(i.paymentDay),name:i.name,amount:i.monthlyPremium,rem:i.reminderDaysBefore||0});
  for(const d of state.debts.filter(x=>x.active!==false)){const s=(d.schedule||[]).find(x=>x.status!=="paid"&&x.dueDate>=todayISO());if(s)events.push({date:s.dueDate,name:d.concept,amount:s.payment,rem:d.reminderDaysBefore||0})}
  for(const p of state.plans.filter(x=>x.active!==false)){const s=(p.schedule||[]).find(x=>x.status!=="paid"&&x.dueDate>=todayISO());if(s)events.push({date:s.dueDate,name:p.description,amount:s.payment,rem:p.reminderDaysBefore||0})}
  const today=todayISO();
  document.querySelector("#upcoming").innerHTML=events.filter(x=>x.date<=addDaysISO(today,30)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,10).map(x=>{
    const reminder=addDaysISO(x.date,-Number(x.rem||0))<=today?`<span class="tf-pill tf-pill-warn">Recordatorio activo</span>`:"";
    return `<div class="tf-summary-row"><span>${x.date} · ${escapeHtml(x.name)} ${reminder}</span><strong>${money(x.amount)}</strong></div>`;
  }).join("")||`<div class="tf-empty">Sin compromisos próximos.</div>`;
}
function renderRecent(){
  document.querySelector("#recent-body").innerHTML=state.txs.slice(0,12).map(t=>`<tr><td>${t.date}</td><td>${escapeHtml(t.type)}</td><td>${escapeHtml(t.description||"—")}</td><td>${money(t.amount)}</td></tr>`).join("")||`<tr><td colspan="4" class="tf-empty">Sin movimientos.</td></tr>`;
}
function assetCurrentValue(a){
  const initial=Number(a.purchasePrice||0)+Number(a.purchaseTransport||0)+Number(a.initialAccessories||0)+Number(a.initialCertification||0)+Number(a.otherInitial||0);
  const age=Math.max(0,daysBetween(a.purchaseDate||todayISO(),todayISO())/365.25);
  const book=straightLineDepreciation({cost:initial,residual:a.residualValue,usefulLifeYears:a.usefulLifeYears,ageYears:age}).bookValue;
  if(a.marketValueProvided===true)return Number(a.marketValue??0);
  if(a.marketValue!==undefined&&a.marketValue!==null&&Number(a.marketValue)!==0)return Number(a.marketValue);
  return book;
}
function renderPlanning(){
  const month=todayISO().slice(0,7);
  const p=monthlyProjection({
    accounts:state.accounts,
    transactions:state.txs,
    recurring:state.recur,
    insurance:state.ins,
    receivables:state.recv,
    contracts:state.contracts,
    debts:state.debts,
    cardPlans:state.plans,
    month,
    today:todayISO()
  });

  document.querySelector("#dash-projection-month").textContent=p.month;
  document.querySelector("#dash-proj-income").textContent=money(p.projectedIncomeGross);
  document.querySelector("#dash-proj-registered").textContent=money(p.registeredExpenses);
  document.querySelector("#dash-proj-pending").textContent=money(p.pendingExpenses);
  document.querySelector("#dash-proj-saving").textContent=money(p.recommendedSavings);
  document.querySelector("#dash-proj-vat").textContent=money(p.reservedVat);
  document.querySelector("#dash-proj-available").textContent=money(p.availableProjected);
  document.querySelector("#dash-proj-available").classList.toggle("tf-negative",p.availableProjected<0);
  document.querySelector("#dash-proj-detail").textContent=
    `Recibido ${money(p.receivedIncomeGross)} · Pendiente ${money(p.pendingIncomeGross)} · el ahorro se calcula sobre ingresos sin IVA.`;

  const cfg={...defaultEmergencyFundConfig(),...(state.emergencyConfig||{})};
  const f=emergencyFundSummary({
    config:cfg,accounts:state.accounts,transactions:state.txs,recurring:state.recur,
    insurance:state.ins,debts:state.debts,cardPlans:state.plans,balances:state.balances,
    projection:p,today:todayISO()
  });
  document.querySelector("#dash-ef-current").textContent=money(f.currentAmount);
  document.querySelector("#dash-ef-target").textContent=money(f.targetAmount);
  document.querySelector("#dash-ef-coverage").textContent=`Cobertura ${f.coverageMonths.toFixed(1)} de ${f.config.targetMonths} meses`;
  document.querySelector("#dash-ef-progress").style.width=`${Math.min(100,Math.max(0,f.progress*100))}%`;
}

async function init(){
  const syncedReceivables=await syncReceivablesClosed();
  const [accounts,txs,debts,plans,investments,assets,recur,ins,categories,contracts,emergencyConfig]=await Promise.all([
    listAccounts(),listTransactions(),listLiabilities(),listFinancingPlans(),listInvestments(),listAssets(),
    listRecurring(),listInsurance(),listCategories(),listContracts(),getEmergencyFund()
  ]);
  const recv=syncedReceivables;
  const balances=calculateBalances(accounts,txs),active=accounts.filter(a=>a.active!==false);
  const liquidity=sum(active.filter(a=>a.accountType!=="credit_card"),a=>Math.max(0,balances[a.id]||0));
  const cardDebt=sum(active.filter(a=>a.accountType==="credit_card"),a=>Math.max(0,-Number(balances[a.id]||0)));
  const loanDebt=sum(
    debts.filter(d=>d.active!==false),
    d=>Number(
      d.mode==="calculated"
        ? (d.calculatedBalance ?? d.originalPrincipal ?? 0)
        : (d.currentManualBalance ?? d.bankReportedBalance ?? d.originalPrincipal ?? 0)
    )
  );
  const invested=sum(investments.filter(i=>i.active!==false&&i.status==="active"),i=>i.principal);
  const assetValue=sum(assets.filter(a=>a.active!==false),assetCurrentValue);
  const totalDebt=cardDebt+loanDebt,netWorth=liquidity+invested+assetValue-totalDebt;
  state={accounts,txs,debts,plans,investments,assets,recv,recur,ins,categories,contracts,emergencyConfig,balances,active,liquidity,cardDebt,loanDebt,totalDebt,invested,assetValue,netWorth};
  document.querySelector("#kpi-liquidity").textContent=money(liquidity);
  document.querySelector("#kpi-investments").textContent=money(invested);
  document.querySelector("#kpi-assets").textContent=money(assetValue);
  document.querySelector("#kpi-debt").textContent=money(totalDebt);
  document.querySelector("#kpi-networth").textContent=money(netWorth);
  document.querySelector("#kpi-receivable").textContent=money(sum(recv,r=>Math.max(0,Number(r.amount)-Number(r.paidAmount||0))));
  renderPeriodMetrics();renderAssetChart();renderBanks();renderUpcoming();renderRecent();renderPlanning();
}
document.querySelector("#summary-period").addEventListener("change",renderPeriodMetrics);
window.addEventListener("tf-theme-change",()=>{if(!state.txs)return;renderAssetChart();renderPeriodMetrics()});
requireUser(()=>init().catch(console.error));
