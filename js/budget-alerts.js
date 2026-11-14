import {todayISO} from "./utils.js";
import {budgetsForMonth,budgetMetricsForMonth} from "./planning.js";

const EPS=0.009;

export function budgetAlertForMetrics({budget,metrics,month}){
  const available=Math.max(0,Number(metrics?.available||0));
  const spent=Math.max(0,Number(metrics?.spent||0));
  const remaining=Number(metrics?.remaining??(available-spent));
  if(available<=EPS){
    if(spent<=EPS) return null;
    return {
      key:`budget:${budget.id}:${month}:over`,kind:"budget",severity:"over",rank:3,
      budgetId:budget.id,month,title:`${budget.category} · ${budget.subcategory}`,
      label:"Presupuesto sobrepasado",available,spent,remaining,
      amount:Math.abs(remaining),url:`presupuestos.html?month=${encodeURIComponent(month)}&budget=${encodeURIComponent(budget.id)}`
    };
  }
  if(remaining < -EPS){
    return {
      key:`budget:${budget.id}:${month}:over`,kind:"budget",severity:"over",rank:3,
      budgetId:budget.id,month,title:`${budget.category} · ${budget.subcategory}`,
      label:"Presupuesto sobrepasado",available,spent,remaining,
      amount:Math.abs(remaining),url:`presupuestos.html?month=${encodeURIComponent(month)}&budget=${encodeURIComponent(budget.id)}`
    };
  }
  const remainingRatio=remaining/available;
  if(remainingRatio<=0.10+Number.EPSILON){
    return {
      key:`budget:${budget.id}:${month}:10`,kind:"budget",severity:"critical",rank:2,
      budgetId:budget.id,month,title:`${budget.category} · ${budget.subcategory}`,
      label:"Queda 10% del presupuesto",available,spent,remaining,
      amount:Math.max(0,remaining),url:`presupuestos.html?month=${encodeURIComponent(month)}&budget=${encodeURIComponent(budget.id)}`
    };
  }
  if(remainingRatio<=0.30+Number.EPSILON){
    return {
      key:`budget:${budget.id}:${month}:30`,kind:"budget",severity:"warning",rank:1,
      budgetId:budget.id,month,title:`${budget.category} · ${budget.subcategory}`,
      label:"Queda 30% del presupuesto",available,spent,remaining,
      amount:Math.max(0,remaining),url:`presupuestos.html?month=${encodeURIComponent(month)}&budget=${encodeURIComponent(budget.id)}`
    };
  }
  return null;
}

export function buildBudgetAlerts({budgets=[],transactions=[],month=todayISO().slice(0,7)}){
  return budgetsForMonth({budgets,month}).map(budget=>{
    const metrics=budgetMetricsForMonth({budget,budgets,transactions,month});
    return budgetAlertForMetrics({budget,metrics,month});
  }).filter(Boolean).sort((a,b)=>b.rank-a.rank||a.title.localeCompare(b.title,"es",{sensitivity:"base"}));
}
