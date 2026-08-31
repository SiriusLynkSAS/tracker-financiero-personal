import {requireUser} from "./guard.js";
import {
  listMonthlyPlans,saveMonthlyPlan,
  listRecurring,listBudgets,listTransactions,listLiabilities,listFinancingPlans,
  listInsurance,listGoals,listAccounts,calculateBalances
} from "./data-service.js";
import {
  money,escapeHtml,todayISO,isoFromParts,addMonthsISO,sum
} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

let plans=[];
let recurring=[];
let budgets=[];
let txs=[];
let debts=[];
let cardPlans=[];
let insurance=[];
let goals=[];
let accounts=[];
let balances={};

let selectedMonth="";
let manualItems=[];
let excludedSourceKeys=new Set();
let savingMode="auto";
let savingAmount=0;
let note="";
let dirty=false;

const monthInput=document.querySelector("#monthly-plan-month");

function currentMonthKey(){
  return todayISO().slice(0,7);
}

function monthStart(month){
  return `${month}-01`;
}

function monthEnd(month){
  const [y,m]=month.split("-").map(Number);
  const last=new Date(Date.UTC(y,m,0)).getUTCDate();
  return isoFromParts(y,m,last);
}

function shiftMonth(month,delta){
  return addMonthsISO(`${month}-01`,delta).slice(0,7);
}

function monthDiff(fromMonth,toDate){
  const [fy,fm]=fromMonth.split("-").map(Number);
  const [ty,tm]=String(toDate).slice(0,7).split("-").map(Number);
  return (ty-fy)*12+(tm-fm);
}

function overlapsMonth(item,month){
  const start=monthStart(month);
  const end=monthEnd(month);
  const itemStart=item.startDate||"0000-01-01";
  const itemEnd=item.endDate||"9999-12-31";
  return itemStart<=end && itemEnd>=start;
}

function dueDateForDay(month,day){
  const [y,m]=month.split("-").map(Number);
  const last=new Date(Date.UTC(y,m,0)).getUTCDate();
  return isoFromParts(y,m,Math.min(Math.max(1,Number(day||1)),last));
}

function inMonth(date,month){
  return String(date||"").slice(0,7)===month;
}

function sourceItem({key,kind,label,amount,date="",source="",detail=""}){
  return {
    key,kind,label,
    amount:Math.max(0,Number(amount||0)),
    date,source,detail
  };
}

function recurringItems(){
  return recurring
    .filter(r=>r.active!==false && overlapsMonth(r,selectedMonth))
    .map(r=>sourceItem({
      key:`recurring:${r.id}`,
      kind:r.type==="income"?"income":"fixed",
      label:r.name||"Recurrente",
      amount:r.amount,
      date:dueDateForDay(selectedMonth,r.dayOfMonth),
      source:"Recurrente",
      detail:[r.category,r.subcategory].filter(Boolean).join(" › ")
    }));
}

function debtItems(){
  const out=[];

  for(const debt of debts.filter(x=>x.active!==false)){
    for(const row of debt.schedule||[]){
      if(!inMonth(row.dueDate,selectedMonth)) continue;

      out.push(sourceItem({
        key:`debt:${debt.id}:${row.n}`,
        kind:"fixed",
        label:`${debt.creditor||"Acreedor"} · ${debt.concept||"Préstamo"}`,
        amount:row.payment,
        date:row.dueDate,
        source:"Préstamo",
        detail:`Cuota ${row.n}${row.status==="paid"?" · pagada":""}`
      }));
    }
  }

  return out;
}

function cardItems(){
  const out=[];

  for(const plan of cardPlans.filter(x=>x.active!==false)){
    for(const row of plan.schedule||[]){
      if(!inMonth(row.dueDate,selectedMonth)) continue;

      out.push(sourceItem({
        key:`card:${plan.id}:${row.n}`,
        kind:"fixed",
        label:plan.description||"Plan de tarjeta",
        amount:row.payment,
        date:row.dueDate,
        source:"Tarjeta",
        detail:`Cuota ${row.n}${row.status==="paid"?" · pagada":""}`
      }));
    }
  }

  return out;
}

function insuranceItems(){
  return insurance
    .filter(p=>p.active!==false && overlapsMonth(p,selectedMonth))
    .filter(p=>Number(p.monthlyPremium||0)>0)
    .map(p=>sourceItem({
      key:`insurance:${p.id}`,
      kind:"fixed",
      label:p.name||p.provider||"Seguro",
      amount:p.monthlyPremium,
      date:dueDateForDay(selectedMonth,p.paymentDay),
      source:"Seguro",
      detail:p.provider||"Prima mensual"
    }));
}

function spentForBudget(budget,start,end){
  return txs
    .filter(t=>t.type==="expense" && t.date>=start && t.date<=end)
    .reduce((total,t)=>{
      if(t.splits?.length){
        return total+t.splits
          .filter(x=>
            x.category===budget.category &&
            x.subcategory===budget.subcategory
          )
          .reduce((s,x)=>s+Number(x.amount||0),0);
      }

      return total+(
        t.category===budget.category &&
        t.subcategory===budget.subcategory
          ? Number(t.amount||0)
          : 0
      );
    },0);
}

function variableItems(){
  const prevMonth=shiftMonth(selectedMonth,-1);
  const prevStart=monthStart(prevMonth);
  const prevEnd=monthEnd(prevMonth);

  return budgets
    .filter(b=>b.active!==false)
    .map(b=>{
      const previousSpent=spentForBudget(b,prevStart,prevEnd);
      const carry=b.rollover
        ? Math.max(0,Number(b.limit||0)-previousSpent)
        : 0;
      const available=Number(b.limit||0)+carry;

      return sourceItem({
        key:`budget:${b.id}`,
        kind:"variable",
        label:`${b.category} › ${b.subcategory}`,
        amount:available,
        source:"Presupuesto",
        detail:b.rollover
          ? `Base ${money(b.limit)} + rollover ${money(carry)}`
          : `Límite mensual ${money(b.limit)}`
      });
    });
}

function goalSuggestedItems(){
  return goals
    .filter(g=>g.active!==false)
    .map(g=>{
      const saved=g.accountId
        ? Math.max(0,Number(balances[g.accountId]||0))
        : Math.max(0,Number(g.savedManual||0));

      const remaining=Math.max(0,Number(g.target||0)-saved);
      let suggested=0;
      let detail="Sin fecha objetivo";

      if(remaining>0 && g.targetDate){
        const diff=monthDiff(selectedMonth,g.targetDate);
        const months=Math.max(1,diff+1);
        suggested=remaining/months;
        detail=`Faltan ${money(remaining)} · ${months} mes(es)`;
      }else if(remaining<=0){
        detail="Meta cubierta";
      }

      return sourceItem({
        key:`goal:${g.id}`,
        kind:"saving",
        label:g.name||"Meta de ahorro",
        amount:suggested,
        date:g.targetDate||"",
        source:"Meta",
        detail
      });
    })
    .filter(x=>x.amount>0);
}

function automaticItems(){
  return [
    ...recurringItems(),
    ...debtItems(),
    ...cardItems(),
    ...insuranceItems(),
    ...variableItems(),
    ...goalSuggestedItems()
  ];
}

function isIncluded(item){
  return !excludedSourceKeys.has(item.key);
}

function included(items,kind){
  return items.filter(x=>x.kind===kind && isIncluded(x));
}

function manualByType(type){
  return manualItems.filter(x=>x.type===type);
}

function totals(){
  const items=automaticItems();

  const income=
    sum(included(items,"income"),x=>x.amount)+
    sum(manualByType("income"),x=>x.amount);

  const fixed=
    sum(included(items,"fixed"),x=>x.amount)+
    sum(manualByType("fixed"),x=>x.amount);

  const autoSaving=sum(included(items,"saving"),x=>x.amount);

  const savings=savingMode==="auto"
    ? autoSaving
    : Math.max(0,Number(savingAmount||0));

  const variable=
    sum(included(items,"variable"),x=>x.amount)+
    sum(manualByType("variable"),x=>x.amount);

  return {
    items,
    income,
    fixed,
    autoSaving,
    savings,
    variable,
    free:income-fixed-savings-variable
  };
}

function sourceRow(item){
  const checked=isIncluded(item);

  return `
    <label class="tf-plan-source-row">
      <input
        type="checkbox"
        data-source-toggle="${escapeHtml(item.key)}"
        ${checked?"checked":""}
      >
      <span class="tf-plan-source-main">
        <strong>${escapeHtml(item.label)}</strong>
        <span>
          ${escapeHtml(item.source)}
          ${item.date?` · ${escapeHtml(item.date)}`:""}
          ${item.detail?` · ${escapeHtml(item.detail)}`:""}
        </span>
      </span>
      <strong class="tf-plan-source-amount">${money(item.amount)}</strong>
    </label>
  `;
}

function emptySource(text){
  return `<div class="tf-empty tf-plan-source-empty">${escapeHtml(text)}</div>`;
}

function renderSources(t){
  const incomes=t.items.filter(x=>x.kind==="income");
  const fixed=t.items.filter(x=>x.kind==="fixed");
  const variables=t.items.filter(x=>x.kind==="variable");
  const savings=t.items.filter(x=>x.kind==="saving");

  document.querySelector("#mp-income-list").innerHTML=
    incomes.map(sourceRow).join("")||
    emptySource("Sin ingresos automáticos para este mes.");

  document.querySelector("#mp-fixed-list").innerHTML=
    fixed.map(sourceRow).join("")||
    emptySource("Sin compromisos automáticos para este mes.");

  document.querySelector("#mp-variable-list").innerHTML=
    variables.map(sourceRow).join("")||
    emptySource("Sin presupuestos variables configurados.");

  document.querySelector("#mp-goal-list").innerHTML=
    savings.map(sourceRow).join("")||
    emptySource("No hay metas con un aporte mensual sugerido.");
}

function renderManual(){
  const labels={
    income:"Ingreso adicional",
    fixed:"Compromiso adicional",
    variable:"Reserva adicional"
  };

  document.querySelector("#mp-manual-list").innerHTML=
    manualItems.map(item=>`
      <div class="tf-plan-manual-row">
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <span>${labels[item.type]||escapeHtml(item.type)}</span>
        </div>
        <strong>${money(item.amount)}</strong>
        <button
          type="button"
          class="tf-btn tf-btn-secondary"
          data-manual-delete="${escapeHtml(item.id)}"
        >Quitar</button>
      </div>
    `).join("")||
    `<div class="tf-empty">Sin ajustes manuales.</div>`;
}

function actualExecution(){
  const accountById=new Map(accounts.map(a=>[a.id,a]));

  const monthTx=txs.filter(t=>inMonth(t.date,selectedMonth));

  const realIncome=sum(
    monthTx.filter(t=>t.type==="income"),
    t=>t.amount
  );

  const realExpense=sum(
    monthTx.filter(t=>{
      if(t.type!=="expense") return false;
      const a=accountById.get(t.accountId);
      return a?.accountType!=="credit_card";
    }),
    t=>t.amount
  );

  const cardPayments=sum(
    monthTx.filter(t=>
      t.type==="transfer" &&
      !!t.financingPlanId
    ),
    t=>t.amount
  );

  const loanPayments=sum(
    debts.flatMap(d=>d.schedule||[])
      .filter(row=>row.status==="paid" && inMonth(row.paidDate,selectedMonth)),
    row=>row.paidAmount ?? row.payment
  );

  return {
    realIncome,
    realExpense,
    cardPayments,
    loanPayments,
    net:realIncome-realExpense-cardPayments-loanPayments
  };
}

function renderExecution(){
  const x=actualExecution();

  document.querySelector("#mp-real-income").textContent=money(x.realIncome);
  document.querySelector("#mp-real-expense").textContent=money(x.realExpense);
  document.querySelector("#mp-real-card").textContent=money(x.cardPayments);
  document.querySelector("#mp-real-loan").textContent=money(x.loanPayments);

  const net=document.querySelector("#mp-real-net");
  net.textContent=money(x.net);
  net.classList.toggle("tf-negative",x.net<0);
}

function render(){
  const t=totals();

  renderSources(t);
  renderManual();
  renderExecution();

  for(const [id,value] of [
    ["#mp-kpi-income",t.income],
    ["#mp-income-total",t.income],
    ["#mp-kpi-fixed",t.fixed],
    ["#mp-fixed-total",t.fixed],
    ["#mp-kpi-saving",t.savings],
    ["#mp-saving-total",t.savings],
    ["#mp-kpi-variable",t.variable],
    ["#mp-variable-total",t.variable],
    ["#mp-kpi-free",t.free],
    ["#mp-free-hero",t.free]
  ]){
    document.querySelector(id).textContent=money(value);
  }

  document.querySelector("#mp-kpi-free").classList.toggle("tf-negative",t.free<0);
  document.querySelector("#mp-free-hero").classList.toggle("tf-negative",t.free<0);

  const savingInput=document.querySelector("#mp-saving-amount");

  if(savingMode==="auto"){
    savingAmount=t.autoSaving;
    savingInput.value=t.autoSaving.toFixed(2);
    document.querySelector("#mp-saving-help").textContent=
      `Ahorro sugerido por las metas incluidas: ${money(t.autoSaving)}.`;
  }else{
    savingInput.value=Number(savingAmount||0).toFixed(2);
    document.querySelector("#mp-saving-help").textContent=
      `Monto manual para ${selectedMonth}. El sugerido actual es ${money(t.autoSaving)}.`;
  }

  const warning=document.querySelector("#monthly-plan-warning");

  if(t.free<0){
    warning.textContent=
      `El plan tiene un déficit de ${money(Math.abs(t.free))}. Revisa compromisos, ahorro o reservas.`;
    warning.classList.add("is-visible");
  }else{
    warning.classList.remove("is-visible");
    warning.textContent="";
  }

  document.querySelector("#mp-note").value=note||"";
  document.querySelector("#monthly-plan-save-state").textContent=
    dirty ? "Cambios sin guardar" : "Plan cargado";
  document.querySelector("#monthly-plan-save-state").classList.toggle(
    "is-dirty",
    dirty
  );
}

function savedPlanForMonth(month){
  return plans.find(p=>p.id===month || p.month===month)||null;
}

function loadMonthConfig(month){
  selectedMonth=month;
  monthInput.value=month;

  const saved=savedPlanForMonth(month);

  manualItems=Array.isArray(saved?.manualItems)
    ? saved.manualItems.map(x=>({...x}))
    : [];

  excludedSourceKeys=new Set(
    Array.isArray(saved?.excludedSourceKeys)
      ? saved.excludedSourceKeys
      : []
  );

  savingMode=saved?.savingMode==="manual" ? "manual" : "auto";
  savingAmount=Math.max(0,Number(saved?.savingAmount||0));
  note=saved?.note||"";
  dirty=false;

  render();
}

function markDirty(){
  dirty=true;
  document.querySelector("#monthly-plan-save-state").textContent=
    "Cambios sin guardar";
  document.querySelector("#monthly-plan-save-state").classList.add("is-dirty");
}

async function refresh(){
  [
    plans,
    recurring,
    budgets,
    txs,
    debts,
    cardPlans,
    insurance,
    goals,
    accounts
  ]=await Promise.all([
    listMonthlyPlans(),
    listRecurring(),
    listBudgets(),
    listTransactions(),
    listLiabilities(),
    listFinancingPlans(),
    listInsurance(),
    listGoals(),
    listAccounts({includeArchived:false})
  ]);

  balances=calculateBalances(accounts,txs);

  loadMonthConfig(selectedMonth||currentMonthKey());
}

monthInput.addEventListener("change",()=>{
  if(!monthInput.value) return;
  loadMonthConfig(monthInput.value);
});

document.querySelector("#monthly-plan-prev").addEventListener("click",()=>{
  loadMonthConfig(shiftMonth(selectedMonth,-1));
});

document.querySelector("#monthly-plan-next").addEventListener("click",()=>{
  loadMonthConfig(shiftMonth(selectedMonth,1));
});

document.querySelector("#monthly-plan-today").addEventListener("click",()=>{
  loadMonthConfig(currentMonthKey());
});

document.addEventListener("change",e=>{
  const checkbox=e.target.closest("[data-source-toggle]");
  if(!checkbox) return;

  const key=checkbox.dataset.sourceToggle;

  if(checkbox.checked) excludedSourceKeys.delete(key);
  else excludedSourceKeys.add(key);

  markDirty();
  render();
});

document.querySelector("#mp-saving-amount").addEventListener("input",e=>{
  savingMode="manual";
  savingAmount=Math.max(0,Number(e.target.value||0));
  markDirty();
  render();
});

document.querySelector("#mp-use-auto-saving").addEventListener("click",()=>{
  savingMode="auto";
  markDirty();
  render();
});

document.querySelector("#mp-manual-form").addEventListener("submit",e=>{
  e.preventDefault();

  const type=document.querySelector("#mp-manual-type").value;
  const label=document.querySelector("#mp-manual-label").value.trim();
  const amount=Number(document.querySelector("#mp-manual-amount").value);

  if(!label || !(amount>0)){
    toast("Indica un concepto y un monto mayor que cero.");
    return;
  }

  manualItems.push({
    id:`manual-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    type,
    label,
    amount
  });

  e.target.reset();
  markDirty();
  render();
});

document.querySelector("#mp-manual-list").addEventListener("click",e=>{
  const b=e.target.closest("[data-manual-delete]");
  if(!b) return;

  manualItems=manualItems.filter(x=>x.id!==b.dataset.manualDelete);
  markDirty();
  render();
});

document.querySelector("#mp-note").addEventListener("input",e=>{
  note=e.target.value;
  markDirty();
});

document.querySelector("#mp-reset-auto").addEventListener("click",async()=>{
  if(!await confirmAction({
    title:"Restablecer plan automático",
    message:selectedMonth,
    impact:[
      "Se quitarán exclusiones y ajustes manuales de esta vista.",
      "El ahorro volverá al valor sugerido por las metas.",
      "No se borrarán movimientos ni datos de otros módulos."
    ],
    confirmText:"Restablecer"
  })) return;

  manualItems=[];
  excludedSourceKeys.clear();
  savingMode="auto";
  savingAmount=0;
  note="";
  markDirty();
  render();
});

document.querySelector("#mp-save").addEventListener("click",async()=>{
  const t=totals();

  const data={
    month:selectedMonth,
    manualItems,
    excludedSourceKeys:[...excludedSourceKeys],
    savingMode,
    savingAmount:t.savings,
    note,
    lastCalculated:{
      income:t.income,
      fixed:t.fixed,
      savings:t.savings,
      variable:t.variable,
      free:t.free
    }
  };

  if(!await confirmAction({
    title:"Guardar plan mensual",
    message:selectedMonth,
    impact:[
      `Disponible calculado: ${money(t.free)}.`,
      "Se guardará la configuración del mes, no se crearán movimientos.",
      "Los datos automáticos seguirán vinculados a Recurrentes, Deudas, Tarjetas, Seguros, Metas y Presupuestos."
    ],
    confirmText:"Guardar plan"
  })) return;

  await saveMonthlyPlan(data,selectedMonth);

  const idx=plans.findIndex(p=>p.id===selectedMonth || p.month===selectedMonth);
  if(idx>=0) plans[idx]={...plans[idx],...data,id:selectedMonth};
  else plans.push({...data,id:selectedMonth});

  dirty=false;
  render();
  toast("Plan mensual guardado.");
});

selectedMonth=currentMonthKey();
requireUser(()=>refresh().catch(err=>{
  console.error(err);
  toast("No se pudo cargar el plan mensual.");
}));
