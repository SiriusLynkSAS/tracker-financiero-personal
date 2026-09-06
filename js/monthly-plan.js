import {requireUser} from "./guard.js";
import {
  listMonthlyPlans,saveMonthlyPlan,
  listRecurring,listBudgets,listTransactions,listLiabilities,listFinancingPlans,
  listInsurance,listGoals,listAccounts,calculateBalances,listContracts,
  syncReceivablesClosed
} from "./data-service.js";
import {money,escapeHtml,todayISO,sum} from "./utils.js";
import {confirmAction,toast} from "./ui.js";
import {
  monthlyCommitments,goalSavingsSources,budgetReserveSources,shiftMonth,inMonth
} from "./planning.js";

let plans=[],recurring=[],budgets=[],txs=[],debts=[],cardPlans=[],insurance=[],goals=[],accounts=[],contracts=[],receivables=[],balances={};
let selectedMonth="";
let excludedSources=new Set();
let adjustments=[];
let manualSavings=null;
let notes="";
let dirty=false;

const monthInput=document.querySelector("#monthly-plan-month");

function currentMonth(){ return todayISO().slice(0,7); }

function oldItemToAdjustment(x){
  const map={income:"income",fixed:"commitment",variable:"reserve",saving:"savings",savings:"savings"};
  return {
    id:x.id||`legacy-${Math.random().toString(36).slice(2)}`,
    label:x.label||"Ajuste",
    bucket:map[x.type]||x.bucket||"commitment",
    amount:Math.max(0,Number(x.amount||0))
  };
}

function planConfig(row){
  if(!row){
    return {excludedSources:new Set(),adjustments:[],manualSavings:null,notes:""};
  }

  const excluded=
    row.excludedSources ??
    row.exclusions ??
    row.excludedSourceKeys ??
    [];

  const rawAdjustments=
    row.adjustments ??
    row.manualAdjustments ??
    row.manualItems ??
    [];

  let manual=null;
  if(row.savingsMode==="automatic") manual=null;
  else if(row.savingsMode==="manual") manual=Number(row.manualSavings||0);
  else if(row.manualSavings!==undefined && row.manualSavings!==null) manual=Number(row.manualSavings||0);
  else if(row.savingMode==="manual") manual=Number(row.savingAmount||0);

  return {
    excludedSources:new Set(Array.isArray(excluded)?excluded:[]),
    adjustments:(Array.isArray(rawAdjustments)?rawAdjustments:[]).map(oldItemToAdjustment),
    manualSavings:manual,
    notes:String(row.notes??row.note??"")
  };
}

function commitments(){
  return monthlyCommitments({
    recurring,insurance,receivables,contracts,debts,cardPlans,
    month:selectedMonth,today:todayISO()
  });
}

function sources(){
  const base=commitments().map(x=>({
    key:x.key,
    bucket:x.kind==="income"?"income":"commitment",
    label:x.label,
    detail:x.detail,
    amount:Number(x.amount||0)
  }));

  return [
    ...base,
    ...goalSavingsSources({goals,accounts,balances,month:selectedMonth}),
    ...budgetReserveSources({budgets,transactions:txs,month:selectedMonth})
  ];
}

function calc(){
  const src=sources().map(x=>({...x,excluded:excludedSources.has(x.key)}));
  const sourceTotal=bucket=>sum(src.filter(x=>x.bucket===bucket&&!x.excluded),x=>x.amount);
  const adjustmentTotal=bucket=>sum(adjustments.filter(x=>x.bucket===bucket),x=>x.amount);

  const income=Math.max(0,sourceTotal("income")+adjustmentTotal("income"));
  const commitments=Math.max(0,sourceTotal("commitment")+adjustmentTotal("commitment"));
  const automaticSavings=Math.max(0,sourceTotal("savings")+adjustmentTotal("savings"));
  const savings=Math.max(0,manualSavings===null?automaticSavings:Number(manualSavings||0));
  const reserves=Math.max(0,sourceTotal("reserve")+adjustmentTotal("reserve"));
  const available=income-commitments-savings-reserves;

  return {src,income,commitments,automaticSavings,savings,reserves,available};
}

function sourceRow(x){
  return `
    <label class="tf-plan-source-row">
      <input type="checkbox" data-source-toggle="${escapeHtml(x.key)}" ${x.excluded?"":"checked"}>
      <span class="tf-plan-source-main">
        <strong>${escapeHtml(x.label)}</strong>
        <span>${escapeHtml(x.detail||"")}</span>
      </span>
      <strong class="tf-plan-source-amount">${money(x.amount)}</strong>
    </label>
  `;
}

function empty(text){ return `<div class="tf-empty tf-plan-source-empty">${escapeHtml(text)}</div>`; }

function execution(){
  const types=new Map(accounts.map(a=>[a.id,a.accountType]));
  const monthTx=txs.filter(t=>inMonth(t.date,selectedMonth));
  const realIncome=sum(monthTx.filter(t=>t.type==="income"),t=>t.amount);
  const cashExpenses=sum(
    monthTx.filter(t=>t.type==="expense"&&types.get(t.accountId)!=="credit_card"),
    t=>t.amount
  );
  const cardPayments=sum(
    monthTx.filter(t=>t.type==="transfer"&&types.get(t.toAccountId)==="credit_card"),
    t=>t.amount
  );
  const loanPayments=sum(
    debts.flatMap(d=>d.schedule||[]).filter(r=>r.status==="paid"&&inMonth(r.paidDate,selectedMonth)),
    r=>Number(r.paidAmount||0)>0?r.paidAmount:r.payment
  );
  return {
    realIncome,cashExpenses,cardPayments,loanPayments,
    registeredFlow:realIncome-cashExpenses-cardPayments-loanPayments
  };
}

function renderAdjustments(){
  const label={
    income:"Ingreso adicional",
    commitment:"Compromiso adicional",
    savings:"Ahorro adicional",
    reserve:"Reserva adicional"
  };
  document.querySelector("#mp-manual-list").innerHTML=
    adjustments.map(a=>`
      <div class="tf-plan-manual-row">
        <div><strong>${escapeHtml(a.label)}</strong><span>${label[a.bucket]||a.bucket}</span></div>
        <strong>${money(a.amount)}</strong>
        <button type="button" class="tf-btn tf-btn-secondary" data-adjustment-delete="${escapeHtml(a.id)}">Quitar</button>
      </div>
    `).join("")||`<div class="tf-empty">Sin ajustes manuales.</div>`;
}

function render(){
  const c=calc();
  const buckets={
    income:c.src.filter(x=>x.bucket==="income"),
    commitment:c.src.filter(x=>x.bucket==="commitment"),
    savings:c.src.filter(x=>x.bucket==="savings"),
    reserve:c.src.filter(x=>x.bucket==="reserve")
  };

  document.querySelector("#mp-income-list").innerHTML=buckets.income.map(sourceRow).join("")||empty("Sin ingresos automáticos para este mes.");
  document.querySelector("#mp-fixed-list").innerHTML=buckets.commitment.map(sourceRow).join("")||empty("Sin compromisos automáticos para este mes.");
  document.querySelector("#mp-goal-list").innerHTML=buckets.savings.map(sourceRow).join("")||empty("No hay metas con aporte mensual sugerido.");
  document.querySelector("#mp-variable-list").innerHTML=buckets.reserve.map(sourceRow).join("")||empty("Sin presupuestos aplicables a este mes.");

  for(const [id,v] of [
    ["mp-kpi-income",c.income],["mp-income-total",c.income],
    ["mp-kpi-fixed",c.commitments],["mp-fixed-total",c.commitments],
    ["mp-kpi-saving",c.savings],["mp-saving-total",c.savings],
    ["mp-kpi-variable",c.reserves],["mp-variable-total",c.reserves],
    ["mp-kpi-free",c.available],["mp-free-hero",c.available]
  ]){
    document.querySelector(`#${id}`).textContent=money(v);
  }

  const saving=document.querySelector("#mp-saving-amount");
  saving.value=Number(manualSavings===null?c.automaticSavings:manualSavings).toFixed(2);
  document.querySelector("#mp-saving-help").textContent=
    manualSavings===null
      ? `Ahorro automático sugerido por metas: ${money(c.automaticSavings)}.`
      : `Ahorro manual. Sugerencia automática actual: ${money(c.automaticSavings)}.`;

  const warn=document.querySelector("#monthly-plan-warning");
  warn.classList.toggle("is-visible",c.available<0);
  warn.textContent=c.available<0
    ? `El plan tiene un déficit de ${money(Math.abs(c.available))}.`
    : "";

  const ex=execution();
  document.querySelector("#mp-real-income").textContent=money(ex.realIncome);
  document.querySelector("#mp-real-expense").textContent=money(ex.cashExpenses);
  document.querySelector("#mp-real-card").textContent=money(ex.cardPayments);
  document.querySelector("#mp-real-loan").textContent=money(ex.loanPayments);
  document.querySelector("#mp-real-net").textContent=money(ex.registeredFlow);
  document.querySelector("#mp-real-net").classList.toggle("tf-negative",ex.registeredFlow<0);

  document.querySelector("#mp-note").value=notes;
  document.querySelector("#monthly-plan-save-state").textContent=dirty?"Cambios sin guardar":"Plan cargado";
  document.querySelector("#monthly-plan-save-state").classList.toggle("is-dirty",dirty);
  renderAdjustments();
}

function loadConfig(month){
  selectedMonth=month;
  monthInput.value=month;
  const row=plans.find(p=>p.id===month||p.month===month);
  const c=planConfig(row);
  excludedSources=c.excludedSources;
  adjustments=c.adjustments;
  manualSavings=c.manualSavings;
  notes=c.notes;
  dirty=false;
  render();
}

function markDirty(){ dirty=true; }

async function refresh(){
  receivables=await syncReceivablesClosed();
  [plans,recurring,budgets,txs,debts,cardPlans,insurance,goals,accounts,contracts]=await Promise.all([
    listMonthlyPlans(),listRecurring(),listBudgets(),listTransactions(),listLiabilities(),
    listFinancingPlans(),listInsurance(),listGoals(),listAccounts({includeArchived:false}),listContracts()
  ]);
  balances=calculateBalances(accounts,txs);
  loadConfig(selectedMonth||currentMonth());
}

monthInput.addEventListener("change",()=>{if(monthInput.value)loadConfig(monthInput.value)});
document.querySelector("#monthly-plan-prev").addEventListener("click",()=>loadConfig(shiftMonth(selectedMonth,-1)));
document.querySelector("#monthly-plan-next").addEventListener("click",()=>loadConfig(shiftMonth(selectedMonth,1)));
document.querySelector("#monthly-plan-today").addEventListener("click",()=>loadConfig(currentMonth()));

document.addEventListener("change",e=>{
  const box=e.target.closest("[data-source-toggle]");
  if(!box)return;
  if(box.checked)excludedSources.delete(box.dataset.sourceToggle);
  else excludedSources.add(box.dataset.sourceToggle);
  markDirty();render();
});

document.querySelector("#mp-saving-amount").addEventListener("input",e=>{
  manualSavings=Math.max(0,Number(e.target.value||0));
  markDirty();render();
});
document.querySelector("#mp-use-auto-saving").addEventListener("click",()=>{
  manualSavings=null;markDirty();render();
});

document.querySelector("#mp-manual-form").addEventListener("submit",e=>{
  e.preventDefault();
  const bucket=document.querySelector("#mp-manual-type").value;
  const label=document.querySelector("#mp-manual-label").value.trim();
  const amount=Number(document.querySelector("#mp-manual-amount").value||0);
  if(!label||!(amount>0)){toast("Indica concepto y monto mayor que cero.");return}
  adjustments.push({
    id:`manual-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    label,bucket,amount
  });
  e.target.reset();markDirty();render();
});

document.querySelector("#mp-manual-list").addEventListener("click",e=>{
  const b=e.target.closest("[data-adjustment-delete]");
  if(!b)return;
  adjustments=adjustments.filter(x=>x.id!==b.dataset.adjustmentDelete);
  markDirty();render();
});

document.querySelector("#mp-note").addEventListener("input",e=>{notes=e.target.value;markDirty()});

document.querySelector("#mp-reset-auto").addEventListener("click",async()=>{
  if(!await confirmAction({
    title:"Restablecer plan automático",
    message:selectedMonth,
    impact:["Se quitarán exclusiones y ajustes.","El ahorro volverá al cálculo automático.","No se modifican movimientos reales."],
    confirmText:"Restablecer"
  }))return;
  excludedSources.clear();adjustments=[];manualSavings=null;notes="";markDirty();render();
});

document.querySelector("#mp-save").addEventListener("click",async()=>{
  const c=calc(),ex=execution();
  const data={
    month:selectedMonth,
    excludedSources:[...excludedSources].sort(),
    exclusions:[...excludedSources].sort(),
    adjustments,
    manualAdjustments:adjustments,
    savingsMode:manualSavings===null?"automatic":"manual",
    manualSavings,
    notes,
    lastCalculation:{
      plannedIncome:c.income,
      commitments:c.commitments,
      automaticSavings:c.automaticSavings,
      savings:c.savings,
      variableReserves:c.reserves,
      available:c.available,
      realIncome:ex.realIncome,
      cashExpenses:ex.cashExpenses,
      cardPayments:ex.cardPayments,
      loanPayments:ex.loanPayments,
      registeredFlow:ex.registeredFlow
    }
  };

  if(!await confirmAction({
    title:"Guardar plan mensual",
    message:selectedMonth,
    impact:[`Disponible: ${money(c.available)}.`,"La configuración quedará compartida con Android.","No se crean movimientos."],
    confirmText:"Guardar plan"
  }))return;

  await saveMonthlyPlan(data,selectedMonth);
  const idx=plans.findIndex(p=>p.id===selectedMonth||p.month===selectedMonth);
  if(idx>=0)plans[idx]={...plans[idx],...data,id:selectedMonth};else plans.push({...data,id:selectedMonth});
  dirty=false;render();toast("Plan mensual guardado.");
});

selectedMonth=currentMonth();
requireUser(()=>refresh().catch(err=>{console.error(err);toast("No se pudo cargar el plan mensual.");}));
