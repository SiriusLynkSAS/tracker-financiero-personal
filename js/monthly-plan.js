import {requireUser} from "./guard.js";
import {
  listRecurring,listBudgets,listTransactions,listLiabilities,listFinancingPlans,
  listInsurance,listGoals,listAccounts,calculateBalances,listContracts,
  listInvoicesOptional,syncReceivablesClosed
} from "./data-service.js";
import {money,escapeHtml,todayISO,sum} from "./utils.js";
import {toast} from "./ui.js";
import {analyticTransactions} from "./transaction-analytics.js";
import {
  monthlyCommitments,goalSavingsSources,budgetsForMonth,budgetMetricsForMonth,shiftMonth,inMonth
} from "./planning.js";

let recurring=[],budgets=[],txs=[],debts=[],cardPlans=[],insurance=[],goals=[],accounts=[],contracts=[],receivables=[],invoices=[],balances={};
let selectedMonth="";
const monthInput=document.querySelector("#monthly-plan-month");
const monthDialog=document.querySelector("#monthly-plan-month-dialog");
let pickerYear=new Date().getFullYear();

function currentMonth(){ return todayISO().slice(0,7); }
function monthLabel(value){
  const [year,month]=String(value).split("-").map(Number);
  if(!year||!month)return value;
  const label=new Intl.DateTimeFormat("es-EC",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(year,month-1,1)));
  return label.charAt(0).toUpperCase()+label.slice(1);
}
function monthShort(month){
  return new Intl.DateTimeFormat("es-EC",{month:"short",timeZone:"UTC"}).format(new Date(Date.UTC(2026,month-1,1))).replace(".","");
}
function renderMonthPicker(){
  document.querySelector("#monthly-plan-picker-year").textContent=String(pickerYear);
  document.querySelector("#monthly-plan-month-grid").innerHTML=Array.from({length:12},(_,i)=>{
    const value=`${pickerYear}-${String(i+1).padStart(2,"0")}`;
    return `<button type="button" class="tf-budget-month-option ${value===selectedMonth?"is-selected":""}" data-mp-month="${value}">${monthShort(i+1)}</button>`;
  }).join("");
}
function openMonthPicker(){pickerYear=Number(selectedMonth.slice(0,4))||new Date().getFullYear();renderMonthPicker();monthDialog.showModal();}
function selectMonth(value){monthDialog.close();selectedMonth=value;monthInput.value=value;render();}

function sourceOrigin(source){
  return ({recurring:"Recurrente",insurance:"Seguro",receivable:"Contrato",loan:"Préstamo",card:"Tarjeta",invoice:"Factura",goal:"Meta",budget:"Presupuesto",vat:"IVA"})[source]||"Automático";
}
function sourceDate(row){
  if(row.dueDate)return row.dueDate;
  const match=String(row.detail||"").match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0]||"—";
}
function invoicePeriod(invoice){ return String(invoice.taxPeriod||invoice.issueDate||invoice.dueDate||"").slice(0,7); }
function pendingVat(invoice){ return (invoice.taxPaymentId||invoice.vatStatus==="paid")?0:Math.max(0,Number(invoice.vatAmount||0)); }
function pendingBase(invoice){ return Math.max(0,Number(invoice.baseAmount||0)-Number(invoice.paidBaseAmount||0)); }
function pendingTotal(invoice){ return Math.max(0,Number(invoice.totalAmount||0)-Number(invoice.paidAmount||0)); }

function sources(){
  const base=monthlyCommitments({recurring,insurance,receivables,contracts,debts,cardPlans,month:selectedMonth,today:todayISO()})
    .map(x=>({...x,bucket:x.kind==="income"?"income":"commitment"}));

  const rows=[...base];
  const consumedInvoices=new Set();

  for(const invoice of invoices){
    if(invoice.active===false||invoice.status==="void")continue;
    const vat=pendingVat(invoice);
    const invoiceLabel=invoice.invoiceNumber?`Factura ${invoice.invoiceNumber}`:(invoice.customerName||"Factura");
    if(invoice.receivableId){
      const idx=rows.findIndex(x=>x.key===`receivable:${invoice.receivableId}`);
      if(idx>=0){
        const basePending=pendingBase(invoice);
        const totalPending=pendingTotal(invoice);
        if(totalPending>0.009){
          rows[idx]={...rows[idx],amount:totalPending,source:"invoice",detail:`${rows[idx].detail||""}${rows[idx].detail?" · ":""}${invoiceLabel}`,invoiceBase:basePending};
        }
        if(vat>0.009){
          rows.push({key:`vat:${invoice.id}`,bucket:"reserve",source:"vat",label:`IVA · ${invoiceLabel}`,detail:`Período ${invoicePeriod(invoice)||selectedMonth}`,amount:vat,base:basePending,dueDate:invoice.dueDate||invoice.issueDate||""});
        }
        consumedInvoices.add(invoice.id);
      }
    }
  }

  for(const invoice of invoices){
    if(consumedInvoices.has(invoice.id)||invoice.active===false||invoice.status==="void"||invoice.receivableId)continue;
    const period=String(invoice.dueDate||invoice.issueDate||"").slice(0,7);
    if(period!==selectedMonth)continue;
    const total=pendingTotal(invoice),vat=pendingVat(invoice),basePending=pendingBase(invoice);
    if(total>0.009){
      rows.push({key:`invoice:${invoice.id}`,bucket:"income",source:"invoice",label:invoice.invoiceNumber?`Factura ${invoice.invoiceNumber}`:(invoice.customerName||"Factura"),detail:invoice.customerName||invoice.concept||"Facturación",amount:total,dueDate:invoice.dueDate||invoice.issueDate||""});
    }
    if(vat>0.009){
      rows.push({key:`vat:${invoice.id}`,bucket:"reserve",source:"vat",label:`IVA · ${invoice.invoiceNumber||invoice.customerName||"Factura"}`,detail:`Período ${invoicePeriod(invoice)||selectedMonth}`,amount:vat,base:basePending,dueDate:invoice.dueDate||invoice.issueDate||""});
    }
  }

  rows.push(...goalSavingsSources({goals,accounts,balances,month:selectedMonth}).map(x=>({...x,source:"goal"})));
  for(const budget of budgetsForMonth({budgets,month:selectedMonth})){
    if(Number(budget.limit||0)<=0)continue;
    const m=budgetMetricsForMonth({budget,budgets,transactions:txs,month:selectedMonth});
    rows.push({
      key:`budget:${budget.id}`,bucket:"reserve",source:"budget",
      label:[budget.category,budget.subcategory].filter(Boolean).join(" · ")||"Presupuesto",
      detail:budget.rollover&&m.carry>0?`Base ${money(m.base)} + rollover ${money(m.carry)}`:`Base ${money(m.base)}`,
      amount:m.available,base:m.base
    });
  }
  return rows;
}

function calc(){
  const src=sources();
  const total=bucket=>sum(src.filter(x=>x.bucket===bucket),x=>x.amount);
  const income=Math.max(0,total("income"));
  const commitments=Math.max(0,total("commitment"));
  const objectives=Math.max(0,total("savings"));
  const reserves=Math.max(0,total("reserve"));
  return {src,income,commitments,objectives,reserves,available:income-commitments-objectives-reserves};
}

function unlinkedDebtPaidInMonth(row,month){
  const payments=Array.isArray(row?.payments)?row.payments:[];
  if(payments.length)return payments.filter(x=>!x.transactionId&&inMonth(x.date,month)).reduce((total,x)=>total+Number(x.amount||0),0);
  if(row?.status!=="paid"||!inMonth(row?.paidDate,month))return 0;
  return Number(row?.paidAmount||0)>0?Number(row.paidAmount):Number(row?.payment||0);
}
function execution(){
  const types=new Map(accounts.map(a=>[a.id,a.accountType]));
  const monthTx=analyticTransactions(txs.filter(t=>inMonth(t.date,selectedMonth)));
  const realIncome=sum(monthTx.filter(t=>t.type==="income"),t=>t.amount);
  const cashExpenses=sum(monthTx.filter(t=>t.type==="expense"&&types.get(t.accountId)!=="credit_card"),t=>t.amount);
  const cardPayments=sum(monthTx.filter(t=>t.type==="transfer"&&types.get(t.toAccountId)==="credit_card"),t=>t.amount);
  const loanPayments=sum(debts.flatMap(d=>d.schedule||[]),r=>unlinkedDebtPaidInMonth(r,selectedMonth));
  return {realIncome,cashExpenses,cardPayments,loanPayments,registeredFlow:realIncome-cashExpenses-cardPayments-loanPayments};
}

function tableRow(row,bucket){
  if(bucket==="income"||bucket==="commitment"){
    return `<tr><td><strong>${escapeHtml(row.label||"—")}</strong><div class="tf-muted">${escapeHtml(row.detail||"")}</div></td><td>${escapeHtml(sourceOrigin(row.source))}</td><td>${escapeHtml(sourceDate(row))}</td><td class="tf-num"><strong>${money(row.amount)}</strong></td><td><span class="tf-pill">${bucket==="income"?"Previsto":"Pendiente"}</span></td></tr>`;
  }
  if(bucket==="savings"){
    return `<tr><td><strong>${escapeHtml(row.label||"—")}</strong></td><td>${escapeHtml(sourceOrigin(row.source))}</td><td>${escapeHtml(row.detail||"—")}</td><td class="tf-num"><strong>${money(row.amount)}</strong></td></tr>`;
  }
  return `<tr><td><strong>${escapeHtml(row.label||"—")}</strong><div class="tf-muted">${escapeHtml(row.detail||"")}</div></td><td>${escapeHtml(sourceOrigin(row.source))}</td><td class="tf-num">${money(Number(row.base ?? row.amount ?? 0))}</td><td class="tf-num"><strong>${money(row.amount)}</strong></td><td>${escapeHtml(sourceDate(row))}</td></tr>`;
}
function renderTable(id,emptyId,rows,bucket){
  document.querySelector(`#${id}`).innerHTML=rows.map(r=>tableRow(r,bucket)).join("");
  document.querySelector(`#${emptyId}`).hidden=rows.length>0;
}

function render(){
  const c=calc();
  const buckets={
    income:c.src.filter(x=>x.bucket==="income"),
    commitment:c.src.filter(x=>x.bucket==="commitment"),
    savings:c.src.filter(x=>x.bucket==="savings"),
    reserve:c.src.filter(x=>x.bucket==="reserve")
  };
  renderTable("mp-income-list","mp-income-empty",buckets.income,"income");
  renderTable("mp-fixed-list","mp-fixed-empty",buckets.commitment,"commitment");
  renderTable("mp-goal-list","mp-goal-empty",buckets.savings,"savings");
  renderTable("mp-variable-list","mp-variable-empty",buckets.reserve,"reserve");

  for(const [id,v] of [
    ["mp-kpi-income",c.income],["mp-income-total",c.income],
    ["mp-kpi-fixed",c.commitments],["mp-fixed-total",c.commitments],
    ["mp-kpi-saving",c.objectives],["mp-saving-total",c.objectives],
    ["mp-kpi-variable",c.reserves],["mp-variable-total",c.reserves],
    ["mp-kpi-free",c.available]
  ])document.querySelector(`#${id}`).textContent=money(v);

  const warn=document.querySelector("#monthly-plan-warning");
  warn.classList.toggle("is-visible",c.available<0);
  warn.textContent=c.available<0?`El plan tiene un déficit de ${money(Math.abs(c.available))}.`:"";

  const ex=execution();
  document.querySelector("#mp-real-income").textContent=money(ex.realIncome);
  document.querySelector("#mp-real-expense").textContent=money(ex.cashExpenses);
  document.querySelector("#mp-real-card").textContent=money(ex.cardPayments);
  document.querySelector("#mp-real-loan").textContent=money(ex.loanPayments);
  document.querySelector("#mp-real-net").textContent=money(ex.registeredFlow);
  document.querySelector("#mp-real-net").classList.toggle("tf-negative",ex.registeredFlow<0);
  document.querySelector("#monthly-plan-period-label").textContent=monthLabel(selectedMonth);
  document.querySelector("#monthly-plan-today").hidden=selectedMonth===currentMonth();
}

async function refresh(){
  receivables=await syncReceivablesClosed();
  [recurring,budgets,txs,debts,cardPlans,insurance,goals,accounts,contracts,invoices]=await Promise.all([
    listRecurring(),listBudgets(),listTransactions(),listLiabilities(),listFinancingPlans(),listInsurance(),listGoals(),listAccounts({includeArchived:false}),listContracts(),listInvoicesOptional()
  ]);
  balances=calculateBalances(accounts,txs);
  selectedMonth=selectedMonth||currentMonth();monthInput.value=selectedMonth;render();
}

document.querySelector("#monthly-plan-prev").addEventListener("click",()=>{selectedMonth=shiftMonth(selectedMonth,-1);monthInput.value=selectedMonth;render();});
document.querySelector("#monthly-plan-next").addEventListener("click",()=>{selectedMonth=shiftMonth(selectedMonth,1);monthInput.value=selectedMonth;render();});
document.querySelector("#monthly-plan-today").addEventListener("click",()=>{selectedMonth=currentMonth();monthInput.value=selectedMonth;render();});
document.querySelector("#monthly-plan-period-label").addEventListener("click",openMonthPicker);
document.querySelector("#monthly-plan-month-dialog-close").addEventListener("click",()=>monthDialog.close());
document.querySelector("#monthly-plan-year-prev").addEventListener("click",()=>{pickerYear--;renderMonthPicker();});
document.querySelector("#monthly-plan-year-next").addEventListener("click",()=>{pickerYear++;renderMonthPicker();});
document.querySelector("#monthly-plan-picker-current").addEventListener("click",()=>selectMonth(currentMonth()));
document.querySelector("#monthly-plan-month-grid").addEventListener("click",e=>{const b=e.target.closest("[data-mp-month]");if(b)selectMonth(b.dataset.mpMonth);});

requireUser(()=>refresh().catch(err=>{console.error(err);toast(err?.message||"No fue posible cargar el plan mensual.");}));
