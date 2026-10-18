
import {requireUser} from "./guard.js";
import {
  listLiabilities,saveLiability,archiveLiability,reactivateLiability,
  listFinancingPlans,archiveFinancingPlan,
  listAccounts,listTransactions,calculateBalances,atomicWrite
} from "./data-service.js";
import {
  germanSchedule,frenchSchedule,fixedInstallmentSchedule,
  scheduleTotals,balanceAfterInstallment
} from "./finance.js";
import {money,escapeHtml,todayISO,addMonthsISO} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

let debts=[];
let plans=[];
let accounts=[];
let transactions=[];
let balances={};
let previewSchedule=[];
let selectedDebtId=null;
let selectedCardPlanId=null;
let editingDebtId=null;
let editingCardPlanId=null;
let planPreviewSchedule=[];
let debtSaving=false;

const debtList=document.querySelector("#debt-list");
const planList=document.querySelector("#plan-list");
const debtScheduleBody=document.querySelector("#debt-schedule-body");
const cardScheduleBody=document.querySelector("#card-schedule-body");

function fmt(v){
  return v===null||v===undefined?"—":money(v);
}

function accountLabel(id){
  const a=accounts.find(x=>x.id===id);
  return a ? `${a.bank} · ${a.alias}` : "Tarjeta no disponible";
}

function normalizeLegacyDebt(row){
  const raw=row||{};
  const text=(...values)=>{
    for(const value of values){
      if(value===null||value===undefined) continue;
      const s=String(value).trim();
      if(s) return s;
    }
    return "";
  };
  const num=(...values)=>{
    for(const value of values){
      if(value===null||value===undefined||value==="") continue;
      const n=Number(value);
      if(Number.isFinite(n)) return n;
    }
    return 0;
  };
  const nullableNum=(...values)=>{
    for(const value of values){
      if(value===null||value===undefined||value==="") continue;
      const n=Number(value);
      if(Number.isFinite(n)) return n;
    }
    return null;
  };
  const safeDate=(value)=>{
    const s=text(value);
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if(/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
    return "";
  };
  const mode=text(raw.mode,raw.balanceMode,"manual");
  const schedule=Array.isArray(raw.schedule)
    ? raw.schedule.map((x,i)=>({
        ...x,
        n:Math.max(1,num(x?.n,x?.number,i+1)),
        dueDate:safeDate(x?.dueDate||x?.date),
        status:text(x?.status,"pending"),
        payment:num(x?.payment,x?.installmentAmount),
        paidAmount:num(x?.paidAmount),
        paidDate:safeDate(x?.paidDate)||null
      }))
    : [];
  const term=Math.max(1,num(raw.termMonths,raw.installmentCount,raw.term,schedule.length,1));
  const reported=nullableNum(
    raw.bankReportedBalance,raw.currentManualBalance,raw.currentBalance,
    raw.pendingBalance,raw.balance,raw.outstandingBalance
  );
  const original=Math.max(0,num(raw.originalPrincipal,raw.principal,raw.originalAmount,raw.amount));
  const paidStored=nullableNum(raw.paidThroughInstallment);
  const currentStored=nullableNum(raw.currentInstallment);

  return {
    ...raw,
    id:text(raw.id),
    creditor:text(raw.creditor,raw.lender,raw.bank,raw.name,"Acreedor sin nombre"),
    concept:text(raw.concept,raw.description,raw.title,"Deuda"),
    liabilityType:text(raw.liabilityType,"loan"),
    mode:["calculated","manual","imported"].includes(mode)?mode:"manual",
    scheduleSource:text(
      raw.scheduleSource,
      mode==="calculated"?"calculated":mode==="imported"?"bank_reported":"manual_tracking"
    ),
    amortizationMethod:text(
      raw.amortizationMethod,
      mode==="calculated"?"french":mode==="imported"?"fixed_installment":"manual_tracking"
    ),
    originalPrincipal:original,
    currentManualBalance:mode==="calculated"?nullableNum(raw.currentManualBalance):reported,
    bankReportedBalance:reported,
    calculatedBalance:nullableNum(raw.calculatedBalance),
    bankInstallment:Math.max(0,num(raw.bankInstallment,raw.installmentAmount,raw.monthlyPayment)),
    annualRate:Math.max(0,num(raw.annualRate,raw.rate)),
    rateType:text(raw.rateType,"nominal"),
    termMonths:term,
    firstPaymentDate:safeDate(raw.firstPaymentDate||raw.firstDueDate||raw.startDate),
    paidThroughInstallment:paidStored!==null
      ? Math.max(0,paidStored)
      : (schedule.length?undefined:Math.max(0,(currentStored??0)-1)),
    currentInstallment:currentStored!==null?Math.max(0,currentStored):undefined,
    reminderDaysBefore:Math.max(0,num(raw.reminderDaysBefore)),
    schedule,
    status:text(raw.status,"active"),
    active:raw.active!==false
  };
}

function creditCardDebtRows(){
  return accounts
    .filter(a=>a.active!==false && a.accountType==="credit_card")
    .map(a=>({
      ...a,
      debt:Math.max(0,-Number(balances[a.id]||0))
    }))
    .filter(a=>a.debt>0.009);
}

function loanPending(d){
  const reported =
    d.bankReportedBalance !== null && d.bankReportedBalance !== undefined
      ? Number(d.bankReportedBalance)
      : (
          d.mode!=="calculated" &&
          d.currentManualBalance !== null &&
          d.currentManualBalance !== undefined
            ? Number(d.currentManualBalance)
            : null
        );

  if(reported!==null && Number.isFinite(reported)){
    return Math.max(0,reported);
  }

  if(d.mode==="calculated"){
    return Math.max(0,Number(
      d.calculatedBalance ??
      calculatedBalanceAfterPaidThrough(
        effectiveDebtSchedule(d),
        paidThroughInstallment(d),
        d.originalPrincipal
      ) ??
      d.originalPrincipal ??
      0
    ));
  }

  return Math.max(0,Number(d.originalPrincipal||0));
}

function loanPaid(d){
  return Math.max(
    0,
    Number(d.originalPrincipal||0) - loanPending(d)
  );
}


function firstPendingInstallment(schedule=[]){
  return [...schedule]
    .sort((a,b)=>Number(a.n)-Number(b.n))
    .find(x=>x.status!=="paid") || null;
}

function lastPaidInstallment(schedule=[]){
  return [...schedule]
    .filter(x=>x.status==="paid")
    .sort((a,b)=>Number(b.n)-Number(a.n))[0] || null;
}

function paidThroughInstallment(debt){
  const schedule=debt.schedule||[];
  if(!schedule.length){
    return Math.max(0,Number(debt.paidThroughInstallment ?? debt.currentInstallment ?? 0));
  }

  if(debt.paidThroughInstallment!==undefined && debt.paidThroughInstallment!==null){
    return Math.max(0,Number(debt.paidThroughInstallment||0));
  }

  // Compatibilidad con versiones previas:
  // currentInstallment representaba la próxima cuota pendiente.
  const storedNext=Math.max(1,Number(debt.currentInstallment||1));
  const explicitPaid=schedule
    .filter(x=>x.status==="paid")
    .map(x=>Number(x.n))
    .sort((a,b)=>b-a)[0];

  if(explicitPaid!==undefined){
    return explicitPaid;
  }

  return Math.max(0,storedNext-1);
}

function markPaidThrough(schedule=[],paidThrough=0,{historical=true}={}){
  const limit=Math.max(0,Number(paidThrough||0));

  return schedule.map(row=>{
    const shouldBePaid=Number(row.n)<=limit;

    if(shouldBePaid){
      return {
        ...row,
        status:"paid",
        paidAmount:Number(row.payment||0),
        paidDate:row.paidDate||null,
        historicalPayment:
          row.paidDate ? !!row.historicalPayment : historical
      };
    }

    return {
      ...row,
      status:"pending",
      paidAmount:0,
      paidDate:null,
      historicalPayment:false
    };
  });
}

function nextInstallmentNumber(debt){
  const schedule=debt.schedule||[];
  if(!schedule.length) return null;

  const paidThrough=paidThroughInstallment(debt);
  const next=schedule.find(
    x=>Number(x.n)>paidThrough && x.status!=="paid"
  );

  return next ? Number(next.n) : null;
}

function calculatedBalanceAfterPaidThrough(schedule=[],paidThrough=0,principal=0){
  const n=Math.max(0,Number(paidThrough||0));
  if(n<=0) return Number(principal||0);

  const row=schedule.find(x=>Number(x.n)===n);
  return Number(row?.closingBalance ?? principal ?? 0);
}

function debtIsFullyPaid(debt){
  const schedule=debt.schedule||[];
  return !!schedule.length && schedule.every(x=>x.status==="paid");
}

function planTotals(p){
  const schedule=p.schedule||[];
  const total=schedule.reduce((s,x)=>s+Number(x.payment||0),0);
  const paid=schedule
    .filter(x=>x.status==="paid")
    .reduce((s,x)=>s+Number(x.paidAmount ?? x.payment ?? 0),0);
  const pending=Math.max(0,total-paid);
  return {total,paid,pending};
}


function planPaidThrough(plan){
  return paidThroughInstallment(plan);
}

function planPendingAmount(plan){
  return planTotals(plan).pending;
}

function actualPaidThrough(schedule=[]){
  const actual=schedule
    .filter(x=>x.status==="paid" && !!x.paidDate)
    .map(x=>Number(x.n))
    .sort((a,b)=>b-a)[0];

  return actual===undefined ? 0 : actual;
}

function preserveActualCardPayments(newSchedule=[],oldSchedule=[]){
  const actualByN=new Map(
    oldSchedule
      .filter(x=>x.status==="paid" && !!x.paidDate)
      .map(x=>[Number(x.n),x])
  );

  return newSchedule.map(row=>{
    const old=actualByN.get(Number(row.n));
    if(!old) return row;

    return {
      ...row,
      status:"paid",
      paidAmount:Number(old.paidAmount ?? old.payment ?? row.payment ?? 0),
      paidDate:old.paidDate,
      historicalPayment:false
    };
  });
}

function renderPlanNextInstallmentSummary(next=null){
  const host=document.querySelector("#plan-next-installment-summary");
  if(!host) return;

  if(!next){
    host.innerHTML=`
      <div class="tf-next-installment-empty">
        No existen cuotas pendientes. El plan está liquidado.
      </div>
    `;
    return;
  }

  host.innerHTML=`
    <div class="tf-next-installment-item tf-next-installment-number">
      <span>N.º de cuota</span>
      <strong>${next.n}</strong>
    </div>
    <div class="tf-next-installment-item">
      <span>Capital</span>
      <strong>${fmt(next.principal)}</strong>
    </div>
    <div class="tf-next-installment-item">
      <span>Interés</span>
      <strong>${fmt(next.interest)}</strong>
    </div>
    <div class="tf-next-installment-item tf-next-installment-total">
      <span>Total cuota</span>
      <strong>${Number(next.payment||0)>0 ? money(next.payment) : "—"}</strong>
    </div>
  `;
}

function planFormValues(){
  return {
    parentType:"credit_card",
    parentId:document.querySelector("#plan-card").value,
    planType:document.querySelector("#plan-type").value,
    description:document.querySelector("#plan-description").value.trim(),
    originalPrincipal:Number(document.querySelector("#plan-principal").value),
    amortizationMethod:document.querySelector("#plan-method").value,
    annualRate:Number(document.querySelector("#plan-rate").value||0),
    rateType:"nominal",
    installmentCount:Number(document.querySelector("#plan-count").value),
    bankInstallment:Number(document.querySelector("#plan-payment").value||0),
    firstPaymentDate:document.querySelector("#plan-first").value,
    initialFee:Number(document.querySelector("#plan-fee").value||0),
    paidThroughInstallment:Math.max(
      0,
      Number(document.querySelector("#plan-paid-through").value||0)
    )
  };
}

function planFinancialChanged(oldPlan,newPlan){
  const keys=[
    "description","amortizationMethod","annualRate",
    "installmentCount","bankInstallment","firstPaymentDate",
    "paidThroughInstallment"
  ];

  return keys.some(
    k=>String(oldPlan?.[k]??"")!==String(newPlan?.[k]??"")
  );
}

function resetPlanForm(){
  editingCardPlanId=null;
  planPreviewSchedule=[];

  const form=document.querySelector("#plan-form");
  form.reset();

  document.querySelector("#plan-first").value=addMonthsISO(todayISO(),1);
  document.querySelector("#plan-paid-through").value=0;
  document.querySelector("#plan-calculated-balance").value="$0,00";
  document.querySelector("#plan-preview-box").textContent="";
  document.querySelector("#plan-next-installment-summary").innerHTML=
    `<div class="tf-next-installment-empty">Pulsa <strong>Calcular</strong> para obtener la siguiente cuota.</div>`;

  document.querySelector("#plan-submit").textContent="Guardar plan";
  document.querySelector("#plan-cancel-edit").hidden=true;
  document.querySelector("#plan-edit-status").hidden=true;
  document.querySelector("#plan-edit-status").textContent="";

  for(const id of ["#plan-card","#plan-type","#plan-principal","#plan-fee"]){
    document.querySelector(id).disabled=false;
  }

  togglePlanType();
  togglePlanMethod();
}

function startPlanEdit(plan){
  editingCardPlanId=plan.id;

  document.querySelector("#plan-card").value=plan.parentId||"";
  document.querySelector("#plan-type").value=plan.planType||"installment_purchase";
  document.querySelector("#plan-description").value=plan.description||"";
  document.querySelector("#plan-principal").value=Number(plan.originalPrincipal||0);
  document.querySelector("#plan-method").value=plan.amortizationMethod||"fixed_installment";
  document.querySelector("#plan-count").value=Number(plan.installmentCount ?? plan.schedule?.length ?? 1);
  document.querySelector("#plan-payment").value=Number(plan.bankInstallment||0);
  document.querySelector("#plan-rate").value=Number(plan.annualRate||0);
  document.querySelector("#plan-first").value=plan.firstPaymentDate||addMonthsISO(todayISO(),1);
  document.querySelector("#plan-fee").value=Number(plan.initialFee||0);
  document.querySelector("#plan-paid-through").value=planPaidThrough(plan);

  document.querySelector("#plan-card").disabled=true;
  document.querySelector("#plan-type").disabled=true;
  document.querySelector("#plan-principal").disabled=true;
  document.querySelector("#plan-fee").disabled=true;

  document.querySelector("#plan-submit").textContent="Actualizar plan";
  document.querySelector("#plan-cancel-edit").hidden=false;

  const status=document.querySelector("#plan-edit-status");
  status.hidden=false;
  status.innerHTML=
    `<strong>Editando:</strong> ${escapeHtml(plan.description)}. `+
    `Tarjeta, tipo, principal y comisión inicial permanecen bloqueados para conservar la integridad del libro.`;

  togglePlanType();
  togglePlanMethod();

  planPreviewSchedule=markPaidThrough(
    [...(plan.schedule||[])],
    planPaidThrough(plan),
    {historical:true}
  );

  const next=planPreviewSchedule.find(x=>x.status!=="paid")||null;
  renderPlanNextInstallmentSummary(next);
  document.querySelector("#plan-calculated-balance").value=
    money(planTotals({...plan,schedule:planPreviewSchedule}).pending);
  document.querySelector("#plan-preview-box").innerHTML=
    `Pagado hasta cuota <strong>${planPaidThrough(plan)}/${plan.installmentCount||planPreviewSchedule.length}</strong> · `+
    `${next ? `próxima cuota <strong>${next.n}</strong>` : "<strong>Plan liquidado</strong>"}`;

  window.scrollTo({top:0,behavior:"smooth"});
}

function previewPlan(){
  const values=planFormValues();

  if(!values.parentId){
    toast("Selecciona una tarjeta.");
    return;
  }

  if(!(values.originalPrincipal>0)){
    toast("El principal debe ser mayor que cero.");
    return;
  }

  if(!(values.installmentCount>=1)){
    toast("El número de cuotas debe ser al menos 1.");
    return;
  }

  if(values.paidThroughInstallment>values.installmentCount){
    toast(
      `La cuota pagada (${values.paidThroughInstallment}) no puede superar `+
      `el número de cuotas (${values.installmentCount}).`
    );
    return;
  }

  if(
    values.amortizationMethod==="fixed_installment" &&
    !(values.bankInstallment>0)
  ){
    toast("Ingresa la cuota informada por el banco.");
    return;
  }

  const baseSchedule=makeSchedule(
    values.amortizationMethod,
    {
      principal:values.originalPrincipal,
      rate:values.annualRate,
      term:values.installmentCount,
      rateType:values.rateType,
      first:values.firstPaymentDate||todayISO(),
      payment:values.bankInstallment
    }
  );

  planPreviewSchedule=markPaidThrough(
    baseSchedule,
    values.paidThroughInstallment,
    {historical:true}
  );

  if(editingCardPlanId){
    const old=plans.find(x=>x.id===editingCardPlanId);
    if(old){
      planPreviewSchedule=preserveActualCardPayments(
        planPreviewSchedule,
        old.schedule||[]
      );
    }
  }

  const previewTotals=planTotals({schedule:planPreviewSchedule});
  const next=planPreviewSchedule.find(x=>x.status!=="paid")||null;

  renderPlanNextInstallmentSummary(next);

  document.querySelector("#plan-calculated-balance").value=
    money(previewTotals.pending);

  document.querySelector("#plan-preview-box").innerHTML=
    `<strong>Saldo pendiente:</strong> ${money(previewTotals.pending)} · `+
    `<strong>Pagado hasta cuota:</strong> ${values.paidThroughInstallment}/${values.installmentCount} · `+
    `${next ? `<strong>Próxima cuota:</strong> ${next.n}` : "<strong>Plan liquidado</strong>"} · `+
    `<strong>Total del plan:</strong> ${money(previewTotals.total)}`;
}

function renderDebtOverview(){
  const loansPending=debts
    .filter(x=>x.active!==false)
    .reduce((s,d)=>s+loanPending(d),0);

  // Misma fuente que Resumen: el saldo real de las cuentas de crédito.
  const cardsPending=creditCardDebtRows()
    .reduce((s,a)=>s+Number(a.debt||0),0);

  document.querySelector("#overview-loans-pending").textContent=money(loansPending);
  document.querySelector("#overview-cards-pending").textContent=money(cardsPending);
  document.querySelector("#overview-total-pending").textContent=money(loansPending+cardsPending);
}

function makeSchedule(method,p){
  if(method==="german"){
    return germanSchedule({
      principal:p.principal,
      annualRate:p.rate,
      termMonths:p.term,
      rateType:p.rateType||"nominal",
      firstDueDate:p.first
    });
  }
  if(method==="french"){
    return frenchSchedule({
      principal:p.principal,
      annualRate:p.rate,
      termMonths:p.term,
      rateType:p.rateType||"nominal",
      firstDueDate:p.first
    });
  }
  if(method==="fixed_installment"){
    return fixedInstallmentSchedule({
      principal:p.principal,
      installmentCount:p.term,
      installmentAmount:p.payment,
      firstDueDate:p.first
    });
  }
  return [];
}


function trackingSchedule({term,first,payment=0}){
  const n=Math.max(1,Number(term||1));
  const amount=Math.max(0,Number(payment||0));
  const start=first||todayISO();

  return Array.from({length:n},(_,i)=>({
    n:i+1,
    dueDate:addMonthsISO(start,i),
    openingBalance:null,
    principal:null,
    interest:null,
    payment:amount,
    closingBalance:null,
    status:"pending",
    paidAmount:0,
    paidDate:null,
    historicalPayment:false,
    bankReported:true,
    trackingOnly:true
  }));
}

function theoreticalLoanPending(d){
  if(d.mode!=="calculated") return null;
  const schedule=effectiveDebtSchedule(d);
  return Math.max(0,Number(
    d.calculatedBalance ??
    calculatedBalanceAfterPaidThrough(
      schedule,
      paidThroughInstallment(d),
      d.originalPrincipal
    ) ??
    d.originalPrincipal ??
    0
  ));
}

function effectiveDebtSchedule(debt){
  try{
    if(Array.isArray(debt?.schedule) && debt.schedule.length){
      return debt.schedule;
    }

    const term=Math.max(0,Number(debt?.termMonths||0));
    if(!term) return [];
    const first=/^\d{4}-\d{2}-\d{2}$/.test(String(debt?.firstPaymentDate||""))
      ? debt.firstPaymentDate
      : todayISO();

    if(debt?.mode==="calculated" && ["german","french"].includes(debt?.amortizationMethod)){
      return makeSchedule(debt.amortizationMethod,{
        principal:Number(debt.originalPrincipal||0),
        rate:Number(debt.annualRate||0),
        term,
        rateType:debt.rateType||"nominal",
        first
      });
    }

    return trackingSchedule({
      term,
      first,
      payment:Number(debt?.bankInstallment||0)
    });
  }catch(error){
    console.warn("No se pudo reconstruir el cronograma legado",debt?.id,error);
    return [];
  }
}

function actualDebtPaidThrough(schedule=[]){
  return schedule
    .filter(x=>x.status==="paid" && !!x.paidDate)
    .reduce((m,x)=>Math.max(m,Number(x.n||0)),0);
}

function preserveActualDebtPayments(newSchedule=[],oldSchedule=[]){
  const actualByN=new Map(
    oldSchedule
      .filter(x=>x.status==="paid" && !!x.paidDate)
      .map(x=>[Number(x.n),x])
  );

  return newSchedule.map(row=>{
    const old=actualByN.get(Number(row.n));
    if(!old) return row;
    return {
      ...row,
      status:"paid",
      paidAmount:Number(old.paidAmount ?? old.payment ?? row.payment ?? 0),
      paidDate:old.paidDate,
      historicalPayment:false
    };
  });
}

function debtModeLabel(mode){
  if(mode==="calculated") return "Calculado por Tracker";
  if(mode==="manual") return "Saldo reportado + seguimiento";
  if(mode==="imported") return "Cronograma reportado";
  return mode||"Deuda";
}

function duplicateDebtCount(debt){
  const key=(v)=>`${String(v.creditor||"").trim().toLowerCase()}|${String(v.concept||"").trim().toLowerCase()}`;
  const target=key(debt);
  return debts.filter(x=>x.active!==false && key(x)===target).length;
}

function syncDebtMode(){
  const mode=document.querySelector("#debt-mode").value;
  const method=document.querySelector("#debt-method");
  const methodWrap=document.querySelector("#debt-method-wrap");
  const calcWrap=document.querySelector("#debt-calculated-balance-wrap");
  const nextWrap=document.querySelector("#debt-next-installment-wrap");
  const reportedWrap=document.querySelector("#debt-reported-balance-wrap");
  const bankPaymentWrap=document.querySelector("#debt-bank-installment-wrap");
  const installment=document.querySelector("#debt-current-installment");
  const installmentLabel=document.querySelector("#debt-installment-label");
  const installmentHelp=document.querySelector("#debt-installment-help");

  const calculated=mode==="calculated";

  methodWrap.hidden=!calculated;
  method.disabled=!calculated;
  if(calculated && !["german","french"].includes(method.value)){
    method.value="french";
  }

  calcWrap.hidden=!calculated;
  nextWrap.hidden=false;
  reportedWrap.hidden=false;
  bankPaymentWrap.hidden=calculated;
  installment.disabled=false;

  installmentLabel.textContent="Pagado hasta la cuota";
  installmentHelp.textContent=calculated
    ? "0 = ninguna pagada. El saldo teórico se calcula después de la cuota seleccionada."
    : "Indica cuántas cuotas históricas ya fueron pagadas. El saldo reportado sigue siendo la referencia del acreedor.";
}

function renderNextInstallmentSummary(next=null){
  const host=document.querySelector("#debt-next-installment-summary");
  if(!host) return;

  if(!next){
    host.innerHTML=`
      <div class="tf-next-installment-empty">
        No existen cuotas pendientes. El préstamo está liquidado.
      </div>
    `;
    return;
  }

  host.innerHTML=`
    <div class="tf-next-installment-item tf-next-installment-number">
      <span>N.º de cuota</span>
      <strong>${next.n}</strong>
    </div>
    <div class="tf-next-installment-item">
      <span>Capital</span>
      <strong>${fmt(next.principal)}</strong>
    </div>
    <div class="tf-next-installment-item">
      <span>Interés</span>
      <strong>${fmt(next.interest)}</strong>
    </div>
    <div class="tf-next-installment-item tf-next-installment-total">
      <span>Total cuota</span>
      <strong>${Number(next.payment||0)>0 ? money(next.payment) : "—"}</strong>
    </div>
  `;
}

function previewDebt(){
  const values=debtFormValues();
  const term=Number(values.termMonths||0);
  const paidThrough=Math.max(0,Number(values.paidThroughInstallment||0));

  if(term<1){
    toast("El plazo original debe ser al menos 1 cuota.");
    return;
  }
  if(paidThrough>term){
    toast(`La cuota pagada (${paidThrough}) no puede superar el plazo (${term}).`);
    return;
  }

  let baseSchedule=[];
  if(values.mode==="calculated"){
    if(!["german","french"].includes(values.amortizationMethod)){
      toast("Selecciona sistema Alemán o Francés.");
      return;
    }
    baseSchedule=makeSchedule(values.amortizationMethod,{
      principal:values.originalPrincipal,
      rate:values.annualRate,
      term,
      rateType:values.rateType,
      first:values.firstPaymentDate||todayISO()
    });
  }else{
    if(values.mode==="imported" && !(values.bankInstallment>0)){
      toast("Para un cronograma reportado ingresa la cuota informada por el acreedor.");
      return;
    }
    baseSchedule=trackingSchedule({
      term,
      first:values.firstPaymentDate||todayISO(),
      payment:values.bankInstallment
    });
  }

  previewSchedule=markPaidThrough(baseSchedule,paidThrough,{historical:true});
  const next=previewSchedule.find(x=>x.status!=="paid")||null;
  renderNextInstallmentSummary(next);

  if(values.mode==="calculated"){
    const theoretical=calculatedBalanceAfterPaidThrough(
      previewSchedule,paidThrough,values.originalPrincipal
    );
    document.querySelector("#debt-calculated-balance").value=money(theoretical);
    const reported=values.bankReportedBalance;
    const comparison=
      reported===null
        ? ""
        : ` · <strong>Saldo acreedor:</strong> ${money(reported)} · `+
          `<strong>Diferencia:</strong> ${money(reported-theoretical)}`;
    const totals=scheduleTotals(previewSchedule);
    document.querySelector("#debt-preview-box").innerHTML=
      `<strong>Saldo teórico:</strong> ${money(theoretical)}${comparison} · `+
      `<strong>Pagado hasta:</strong> ${paidThrough}/${term} · `+
      `${next ? `<strong>Próxima cuota:</strong> ${next.n}` : "<strong>Préstamo liquidado</strong>"} · `+
      `intereses teóricos ${money(totals.interest)}`;
  }else{
    document.querySelector("#debt-calculated-balance").value="—";
    document.querySelector("#debt-preview-box").innerHTML=
      `<strong>Saldo reportado:</strong> ${values.bankReportedBalance===null?"—":money(values.bankReportedBalance)} · `+
      `<strong>Pagado hasta:</strong> ${paidThrough}/${term} · `+
      `${next ? `<strong>Próxima cuota:</strong> ${next.n}` : "<strong>Fin del cronograma</strong>"} · `+
      `<strong>Cuota informada:</strong> ${values.bankInstallment>0?money(values.bankInstallment):"—"}`;
  }
}


function debtFormValues(){
  const mode=document.querySelector("#debt-mode").value;
  const reportedRaw=document.querySelector("#debt-current").value;
  const bankReportedBalance=
    reportedRaw==="" ? null : Number(reportedRaw);

  return {
    creditor:document.querySelector("#debt-creditor").value.trim(),
    concept:document.querySelector("#debt-concept").value.trim(),
    mode,
    scheduleSource:
      mode==="calculated" ? "calculated" :
      mode==="imported" ? "bank_reported" : "manual_tracking",
    amortizationMethod:
      mode==="calculated"
        ? document.querySelector("#debt-method").value
        : (mode==="imported" ? "fixed_installment" : "manual_tracking"),
    originalPrincipal:Number(document.querySelector("#debt-principal").value),
    currentManualBalance:
      mode==="calculated" ? null : bankReportedBalance,
    bankReportedBalance,
    bankInstallment:Math.max(
      0,Number(document.querySelector("#debt-bank-installment").value||0)
    ),
    annualRate:Number(document.querySelector("#debt-rate").value||0),
    rateType:document.querySelector("#debt-rate-type").value,
    termMonths:Number(document.querySelector("#debt-term").value),
    firstPaymentDate:document.querySelector("#debt-first").value,
    paidThroughInstallment:Math.max(
      0,Number(document.querySelector("#debt-current-installment").value||0)
    ),
    reminderDaysBefore:Number(document.querySelector("#debt-reminder").value||0)
  };
}

function financialDebtChanged(oldData,newData){
  const keys=[
    "mode","scheduleSource","amortizationMethod","originalPrincipal",
    "bankReportedBalance","bankInstallment","annualRate","rateType",
    "termMonths","firstPaymentDate","paidThroughInstallment"
  ];
  return keys.some(
    k=>String(oldData?.[k]??"")!==String(newData?.[k]??"")
  );
}

function mergePaidSchedule(oldSchedule=[],newSchedule=[]){
  const paidByNumber=new Map(
    oldSchedule
      .filter(x=>x.status==="paid")
      .map(x=>[Number(x.n),x])
  );

  return newSchedule.map(row=>{
    const paid=paidByNumber.get(Number(row.n));
    return paid ? {...paid} : row;
  });
}

function resetDebtForm(){
  editingDebtId=null;
  debtSaving=false;
  document.querySelector("#debt-form").reset();
  document.querySelector("#debt-first").value=addMonthsISO(todayISO(),1);
  document.querySelector("#debt-current-installment").value=0;
  document.querySelector("#debt-bank-installment").value=0;
  document.querySelector("#debt-current").value="";
  document.querySelector("#debt-calculated-balance").value="$0,00";
  document.querySelector("#debt-next-installment-summary").innerHTML=
    `<div class="tf-next-installment-empty">Pulsa <strong>Calcular</strong> para obtener el cronograma.</div>`;
  const submit=document.querySelector("#debt-submit");
  submit.textContent="Guardar deuda";
  submit.disabled=false;
  document.querySelector("#debt-cancel-edit").hidden=true;
  document.querySelector("#debt-edit-status").hidden=true;
  document.querySelector("#debt-edit-status").textContent="";
  previewSchedule=[];
  document.querySelector("#debt-preview-box").textContent="";
  syncDebtMode();
}

function startDebtEdit(debt){
  editingDebtId=debt.id;

  document.querySelector("#debt-creditor").value=debt.creditor||"";
  document.querySelector("#debt-concept").value=debt.concept||"";
  document.querySelector("#debt-mode").value=debt.mode||"manual";
  document.querySelector("#debt-method").value=
    ["german","french"].includes(debt.amortizationMethod)
      ? debt.amortizationMethod
      : "french";
  document.querySelector("#debt-principal").value=Number(debt.originalPrincipal??0);

  const reported=
    debt.bankReportedBalance ??
    debt.currentManualBalance ??
    null;
  document.querySelector("#debt-current").value=
    reported===null||reported===undefined ? "" : Number(reported);

  document.querySelector("#debt-bank-installment").value=
    Number(debt.bankInstallment||0);

  document.querySelector("#debt-calculated-balance").value=
    debt.mode==="calculated"
      ? money(theoreticalLoanPending(debt)??loanPending(debt))
      : "—";
  document.querySelector("#debt-rate").value=Number(debt.annualRate??0);
  document.querySelector("#debt-rate-type").value=debt.rateType||"nominal";
  document.querySelector("#debt-term").value=
    Number(debt.termMonths ?? effectiveDebtSchedule(debt).length ?? 1);
  document.querySelector("#debt-first").value=
    debt.firstPaymentDate||addMonthsISO(todayISO(),1);
  document.querySelector("#debt-current-installment").value=
    Number(paidThroughInstallment(debt));
  document.querySelector("#debt-reminder").value=
    Number(debt.reminderDaysBefore??0);

  syncDebtMode();

  document.querySelector("#debt-submit").textContent="Actualizar deuda";
  document.querySelector("#debt-cancel-edit").hidden=false;

  const status=document.querySelector("#debt-edit-status");
  status.hidden=false;
  status.innerHTML=
    `<strong>Editando el registro existente:</strong> ${escapeHtml(debt.creditor)} · `+
    `${escapeHtml(debt.concept)}. ID ${escapeHtml(debt.id)}. `+
    `Guardar actualizará este mismo registro; no creará una deuda nueva.`;

  previewSchedule=markPaidThrough(
    [...effectiveDebtSchedule(debt)],
    paidThroughInstallment(debt),
    {historical:true}
  );
  const next=previewSchedule.find(x=>x.status!=="paid")||null;
  renderNextInstallmentSummary(next);

  const theoretical=theoreticalLoanPending(debt);
  const reportedBalance=loanPending(debt);
  document.querySelector("#debt-preview-box").innerHTML=
    `<strong>Saldo usado:</strong> ${money(reportedBalance)} · `+
    `${theoretical!==null ? `<strong>Saldo teórico:</strong> ${money(theoretical)} · ` : ""}`+
    `<strong>Pagado hasta:</strong> ${paidThroughInstallment(debt)}/${debt.termMonths||previewSchedule.length||"—"} · `+
    `${next ? `<strong>Próxima cuota:</strong> ${next.n}` : "<strong>Sin cuotas futuras</strong>"}`;

  window.scrollTo({top:0,behavior:"smooth"});
}


function nextInstallmentForDebt(debt){
  const paidThrough=paidThroughInstallment(debt);
  const schedule=markPaidThrough(
    [...effectiveDebtSchedule(debt)],
    paidThrough,
    {historical:true}
  );
  return schedule.find(x=>x.status!=="paid") || null;
}

function nextInstallmentCardHTML(debt){
  const next=nextInstallmentForDebt(debt);

  if(!next){
    return `
      <div class="tf-next-payment-card tf-next-payment-card-done">
        <div class="tf-next-payment-title-row">
          <span class="tf-next-payment-title">Siguiente cuota</span>
          <span class="tf-next-payment-chip">Liquidado</span>
        </div>
        <div class="tf-next-payment-empty">
          No existen cuotas pendientes para este préstamo.
        </div>
      </div>
    `;
  }

  return `
    <div class="tf-next-payment-card">
      <div class="tf-next-payment-title-row">
        <span class="tf-next-payment-title">Siguiente cuota</span>
        <span class="tf-next-payment-chip">Cuota ${next.n}</span>
      </div>
      <div class="tf-next-payment-grid tf-next-payment-grid-stacked">
        <div class="tf-next-payment-metric">
          <span>Capital</span>
          <strong>${fmt(next.principal)}</strong>
        </div>
        <div class="tf-next-payment-metric">
          <span>Interés</span>
          <strong>${fmt(next.interest)}</strong>
        </div>
        <div class="tf-next-payment-metric tf-next-payment-total tf-next-payment-total-wide">
          <span>Total cuota</span>
          <strong>${Number(next.payment||0)>0 ? money(next.payment) : "—"}</strong>
        </div>
      </div>
    </div>
  `;
}

function debtCardHTML(d,{archived=false}={}){
  try{
    const originalPrincipal=Number(d.originalPrincipal||0);
    const pending=loanPending(d);
    const capitalAmortized=loanPaid(d);
    const theoretical=theoreticalLoanPending(d);
    const reported=d.bankReportedBalance!==null&&d.bankReportedBalance!==undefined
      ? Number(d.bankReportedBalance)
      : (d.currentManualBalance!==null&&d.currentManualBalance!==undefined?Number(d.currentManualBalance):null);
    const duplicates=duplicateDebtCount(d);
    const schedule=effectiveDebtSchedule(d);
    const term=Number(d.termMonths||schedule.length||0);
    const paid=paidThroughInstallment({...d,schedule});
    const next=schedule.length?nextInstallmentCardHTML({...d,schedule}):`<div class="tf-subtle" style="margin-top:.8rem">Cronograma aún no reconstruido. Puedes abrir <strong>Editar</strong> para completar la primera cuota y el plazo.</div>`;

    return `<div class="tf-card tf-loan-card tf-debt-card-shell${archived?' tf-card-muted':''}">
      <div class="tf-card-context tf-card-context-loan">${archived?'Préstamo archivado':'Préstamo'}</div>
      <div class="tf-debt-card-header"><div class="tf-debt-card-title-group">
        <strong class="tf-debt-card-title">${escapeHtml(d.creditor||'Acreedor sin nombre')}</strong>
        <div class="tf-debt-card-subtitle">${escapeHtml(d.concept||'Deuda')}</div>
      </div></div>
      ${duplicates>1&&!archived?`<div class="tf-subtle" style="margin-top:.75rem;border-left:3px solid var(--tf-amber,#d99a00);padding:.65rem .8rem"><strong>Posible duplicado:</strong> existen ${duplicates} registros activos con el mismo acreedor y concepto.</div>`:""}
      <div class="tf-detail-grid tf-loan-summary-grid tf-debt-metrics tf-debt-metrics-dual" style="margin-top:.95rem">
        <div class="tf-metric tf-debt-metric-card tf-debt-metric-loan"><span class="tf-metric-label">Capital original</span><strong class="tf-metric-amount">${money(originalPrincipal)}</strong></div>
        <div class="tf-metric tf-debt-metric-card tf-debt-metric-paid"><span class="tf-metric-label">Capital amortizado</span><strong class="tf-metric-amount">${money(capitalAmortized)}</strong></div>
      </div>
      ${next}
      <div class="tf-debt-hero tf-debt-hero-loan"><span class="tf-debt-hero-label">Saldo pendiente de referencia</span><div class="tf-debt-hero-amount">${money(pending)}</div></div>
      ${theoretical!==null&&reported!==null?`<div class="tf-subtle" style="margin-top:.7rem">Saldo teórico: <strong>${money(theoretical)}</strong> · Saldo informado: <strong>${money(reported)}</strong> · Diferencia: <strong>${money(reported-theoretical)}</strong></div>`:""}
      <div class="tf-debt-inline-meta"><span>${debtModeLabel(d.mode)}</span><span>${Number(d.annualRate||0)}%</span><span>pagado ${paid}/${term||'—'}</span><span>ID ${escapeHtml(d.id||'—')}</span></div>
      <div class="tf-actions tf-debt-card-actions" style="margin-top:.9rem">
        ${archived
          ? `<button class="tf-btn tf-btn-primary" data-debt-reactivate="${escapeHtml(d.id)}">Reactivar</button><button class="tf-btn tf-btn-secondary" data-debt-schedule="${escapeHtml(d.id)}">Ver cronograma</button>`
          : `<button class="tf-btn tf-btn-primary" data-debt-edit="${escapeHtml(d.id)}">Editar</button><button class="tf-btn tf-btn-secondary" data-debt-schedule="${escapeHtml(d.id)}">Ver cronograma</button><button class="tf-btn tf-btn-secondary tf-btn-archive" data-debt-archive="${escapeHtml(d.id)}">Archivar</button>`}
      </div>
    </div>`;
  }catch(error){
    console.error("Error al mostrar deuda",d?.id,error);
    return `<div class="tf-card"><div class="tf-card-context tf-card-context-loan">Registro legado</div><strong>${escapeHtml(d?.creditor||'Deuda existente')}</strong><div class="tf-muted">${escapeHtml(d?.concept||'')}</div><div class="tf-debt-hero tf-debt-hero-loan" style="margin-top:.8rem"><span class="tf-debt-hero-label">Saldo disponible</span><div class="tf-debt-hero-amount">${money(d?.bankReportedBalance??d?.currentManualBalance??d?.calculatedBalance??d?.originalPrincipal??0)}</div></div><div class="tf-subtle">Este registro existe en Firebase pero usa un formato anterior. ID ${escapeHtml(d?.id||'—')}.</div><div class="tf-actions" style="margin-top:.8rem">${d?.active===false?`<button class="tf-btn tf-btn-primary" data-debt-reactivate="${escapeHtml(d?.id||'')}">Reactivar</button>`:`<button class="tf-btn tf-btn-primary" data-debt-edit="${escapeHtml(d?.id||'')}">Editar y actualizar formato</button>`}</div></div>`;
  }
}

function render(){
  const activeDebts=debts.filter(x=>x.active!==false);
  const archivedDebts=debts.filter(x=>x.active===false);
  debtList.innerHTML=
    activeDebts.map(d=>debtCardHTML(d)).join("") ||
    `<div class="tf-card tf-empty">Sin préstamos activos.${archivedDebts.length?` Hay ${archivedDebts.length} registro(s) archivado(s) debajo.`:""}</div>`;

  const archivedWrap=document.querySelector("#archived-debt-section");
  const archivedList=document.querySelector("#archived-debt-list");
  if(archivedWrap&&archivedList){
    archivedWrap.hidden=!archivedDebts.length;
    archivedList.innerHTML=archivedDebts.map(d=>debtCardHTML(d,{archived:true})).join("");
  }
  const loadStatus=document.querySelector("#debt-load-status");
  if(loadStatus){
    loadStatus.textContent=`Firebase: ${debts.length} registro(s) de deuda leídos · ${activeDebts.length} activo(s) · ${archivedDebts.length} archivado(s)`;
  }

  renderDebtOverview();

  const cardAccountCards=creditCardDebtRows().map(a=>{
    const linkedPlans=plans.filter(p=>p.active!==false && p.parentId===a.id);
    const plannedPending=linkedPlans.reduce((s,p)=>s+planTotals(p).pending,0);
    return `
      <div class="tf-card tf-credit-plan-card tf-debt-card-shell">
        <div class="tf-card-context tf-card-context-card">Tarjeta · saldo real</div>
        <div class="tf-debt-card-header">
          <div class="tf-debt-card-title-group">
            <strong class="tf-debt-card-title">${escapeHtml(a.bank)}</strong>
            <div class="tf-debt-card-subtitle">${escapeHtml(a.alias||"Tarjeta de crédito")}</div>
          </div>
        </div>
        <div class="tf-debt-hero tf-debt-hero-card" style="margin-top:.95rem">
          <span class="tf-debt-hero-label">Deuda real de la tarjeta</span>
          <div class="tf-debt-hero-amount">${money(a.debt)}</div>
        </div>
        <div class="tf-subtle" style="margin-top:.7rem">
          ${linkedPlans.length
            ? `${linkedPlans.length} plan(es) registrado(s) · saldo pendiente de planes ${money(plannedPending)}`
            : `No hay planes de financiamiento registrados. El saldo proviene directamente de los movimientos de esta cuenta.`
          }
        </div>
        <div class="tf-debt-inline-meta">
          <span>Saldo de cuenta</span>
          <span>${linkedPlans.length ? "Con planes" : "Sin plan asociado"}</span>
        </div>
      </div>
    `;
  }).join("");

  const financingPlanCards=plans
    .filter(x=>x.active!==false)
    .map(p=>{
      const totals=planTotals(p);
      const paidCount=(p.schedule||[]).filter(x=>x.status==="paid").length;
      const count=(p.schedule||[]).length;

      return `
        <div class="tf-card tf-credit-plan-card tf-debt-card-shell">
          <div class="tf-card-context tf-card-context-card">Tarjeta</div>

          <div class="tf-debt-card-header">
            <div class="tf-debt-card-title-group">
              <strong class="tf-debt-card-title">${escapeHtml(p.description)}</strong>
              <div class="tf-debt-card-subtitle">
                ${escapeHtml(accountLabel(p.parentId))} ·
                ${p.planType==="cash_advance"?"Avance de efectivo":"Compra a plazos"}
              </div>
            </div>
          </div>

          <div class="tf-detail-grid tf-card-plan-summary-grid tf-debt-metrics tf-debt-metrics-dual" style="margin-top:.95rem">
            <div class="tf-metric tf-debt-metric-card tf-debt-metric-loan">
              <span class="tf-metric-label">Plan</span>
              <strong class="tf-metric-amount">${money(totals.total || p.originalPrincipal)}</strong>
            </div>
            <div class="tf-metric tf-debt-metric-card tf-debt-metric-paid">
              <span class="tf-metric-label">Pagado</span>
              <strong class="tf-metric-amount">${money(totals.paid)}</strong>
            </div>
          </div>

          ${nextInstallmentCardHTML(p)}

          <div class="tf-debt-hero tf-debt-hero-card">
            <span class="tf-debt-hero-label">Saldo pendiente</span>
            <div class="tf-debt-hero-amount">${money(totals.pending)}</div>
          </div>

          <div class="tf-debt-inline-meta">
            <span>pagado ${planPaidThrough(p)}/${count}</span>
            <span>${p.amortizationMethod==="fixed_installment" ? "Cuota informada" : "Cronograma calculado"}</span>
          </div>

          <div class="tf-actions tf-debt-card-actions" style="margin-top:.9rem">
            <button class="tf-btn tf-btn-primary" data-plan-edit="${p.id}">
              Editar
            </button>
            <button class="tf-btn tf-btn-secondary" data-plan-schedule="${p.id}">
              Ver / pagar cuotas
            </button>
            <button class="tf-btn tf-btn-secondary tf-btn-archive" data-plan-archive="${p.id}">
              Archivar
            </button>
          </div>
        </div>
      `;
    }).join("");

  planList.innerHTML=
    cardAccountCards +
    financingPlanCards ||
    `<div class="tf-card tf-empty">Sin deuda real en tarjetas ni planes de financiamiento activos.</div>`;
}

/* ---------------- PRÉSTAMOS ---------------- */

function showDebtSchedule(debt){
  if(!debt) return;

  selectedDebtId=debt.id;
  selectedCardPlanId=null;

  document.querySelector("#card-schedule-card").hidden=true;
  document.querySelector("#debt-schedule-card").hidden=false;

  document.querySelector("#debt-schedule-title").textContent=
    `${debt.creditor} · ${debt.concept}`;

  const base=effectiveDebtSchedule(debt);
  const paidThrough=paidThroughInstallment(debt);
  const effectiveSchedule=markPaidThrough(base,paidThrough,{historical:true});
  const nextPending=effectiveSchedule.find(x=>x.status!=="paid")||null;
  const theoretical=theoreticalLoanPending(debt);
  const reported=loanPending(debt);

  document.querySelector("#debt-schedule-meta").textContent=
    `${debtModeLabel(debt.mode)} · `+
    `inicio ${debt.firstPaymentDate||"—"} · `+
    `pagado hasta ${paidThrough}/${debt.termMonths||effectiveSchedule.length||"—"} · `+
    `${nextPending ? `próxima ${nextPending.n}` : "sin cuotas futuras"} · `+
    `saldo referencia ${money(reported)}`+
    `${theoretical!==null ? ` · teórico ${money(theoretical)}` : ""}`;

  debtScheduleBody.innerHTML=effectiveSchedule.length
    ? effectiveSchedule.map(s=>{
        const isPaid=s.status==="paid";
        const isHistorical=!!s.historicalPayment && !s.paidDate;
        const isNext=!isPaid && Number(s.n)===Number(nextPending?.n);
        const statusLabel=isPaid
          ? (isHistorical ? "Pagada (hist.)" : "Pagada")
          : isNext ? "Por pagar" : "Pendiente";
        const payment=Number(s.payment||0)>0 ? money(s.payment) : "—";

        return `
          <tr class="${isPaid?"tf-installment-paid":isNext?"tf-installment-next":""}">
            <td>${s.n}</td>
            <td>${s.dueDate}</td>
            <td>${fmt(s.principal)}</td>
            <td>${fmt(s.interest)}</td>
            <td>${payment}</td>
            <td>${fmt(s.closingBalance)}</td>
            <td>
              <span class="tf-pill ${isPaid?"tf-pill-ok":"tf-pill-warn"}">
                ${statusLabel}
              </span>
            </td>
            <td>
              ${isPaid
                ? `<span class="tf-installment-paid-mark">✓ Pagada</span>`
                : isNext
                  ? `<button class="tf-btn tf-btn-primary" data-pay-debt="${s.n}">
                       Marcar pagada
                     </button>`
                  : `<span class="tf-muted tf-installment-waiting">Después de cuota ${nextPending?.n||"—"}</span>`
              }
            </td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="8" class="tf-empty">Completa plazo y primera cuota para construir el seguimiento histórico.</td></tr>`;

  document.querySelector("#debt-schedule-card")
    .scrollIntoView({behavior:"smooth",block:"start"});
}

async async function payDebtInstallment(n){
  const debt=debts.find(x=>x.id===selectedDebtId);
  if(!debt) return;

  const rawSchedule=effectiveDebtSchedule(debt);
  const currentPaidThrough=paidThroughInstallment(debt);
  const scheduleBefore=markPaidThrough(
    rawSchedule,currentPaidThrough,{historical:true}
  );

  const nextPending=scheduleBefore.find(x=>x.status!=="paid")||null;
  if(!nextPending){
    toast("Todas las cuotas de este préstamo ya están registradas como pagadas.");
    return;
  }

  if(Number(n)!==Number(nextPending.n)){
    toast(`Primero debes registrar la cuota ${nextPending.n}.`);
    return;
  }

  const installment=scheduleBefore.find(x=>Number(x.n)===Number(n));
  if(!installment) return;

  if(!await confirmAction({
    title:"Marcar cuota del préstamo como pagada",
    message:`${debt.creditor} · cuota ${n} · ${Number(installment.payment||0)>0?money(installment.payment):"monto no informado"}`,
    impact:[
      `La cuota ${n} pasará a estado Pagada.`,
      debt.mode==="calculated"
        ? "El saldo teórico se recalculará con el saldo de cierre de la cuota."
        : "El saldo reportado por el acreedor no se modificará automáticamente.",
      "La siguiente cuota avanzará automáticamente.",
      "No se crea una transacción bancaria retroactiva."
    ]
  })) return;

  const schedule=scheduleBefore.map(x=>
    Number(x.n)===Number(n)
      ? {
          ...x,
          status:"paid",
          paidAmount:Number(x.payment||0),
          paidDate:todayISO(),
          historicalPayment:false
        }
      : x
  );

  const newPaidThrough=Number(n);
  const newNextPending=schedule.find(x=>x.status!=="paid")||null;
  const paidRow=schedule.find(x=>Number(x.n)===Number(n));

  const updated={
    ...debt,
    schedule,
    paidThroughInstallment:newPaidThrough,
    currentInstallment:newNextPending
      ? Number(newNextPending.n)
      : Number(debt.termMonths||schedule.length||n),
    calculatedBalance:
      debt.mode==="calculated"
        ? Number(paidRow?.closingBalance ?? debt.calculatedBalance ?? debt.originalPrincipal ?? 0)
        : null,
    currentManualBalance:
      debt.mode==="calculated" ? null : (debt.currentManualBalance ?? debt.bankReportedBalance ?? null),
    bankReportedBalance:debt.bankReportedBalance ?? debt.currentManualBalance ?? null,
    status:
      (!newNextPending && loanPending(debt)<=0.009)
        ? "paid_off"
        : "active",
    paidOffDate:
      (!newNextPending && loanPending(debt)<=0.009)
        ? todayISO()
        : (debt.paidOffDate||null)
  };

  await saveLiability(updated,debt.id);

  toast(
    newNextPending
      ? `Cuota ${n} registrada. Próxima cuota: ${newNextPending.n}.`
      : `Cuota ${n} registrada. No quedan cuotas en el cronograma.`
  );

  await refresh();

  const latest=debts.find(x=>x.id===debt.id);
  if(latest){
    showDebtSchedule(latest);
    if(editingDebtId===latest.id){
      startDebtEdit(latest);
    }
  }
}

/* ---------------- TARJETAS ---------------- */

function showCardSchedule(plan){
  if(!plan) return;

  selectedCardPlanId=plan.id;
  selectedDebtId=null;

  document.querySelector("#debt-schedule-card").hidden=true;
  document.querySelector("#card-schedule-card").hidden=false;

  document.querySelector("#card-schedule-title").textContent=
    plan.description||"Plan de tarjeta";

  const effectiveSchedule=markPaidThrough(
    plan.schedule||[],
    planPaidThrough(plan),
    {historical:true}
  );
  const nextPending=effectiveSchedule.find(x=>x.status!=="paid")||null;

  document.querySelector("#card-schedule-meta").textContent=
    `${accountLabel(plan.parentId)} · `+
    `${plan.planType==="cash_advance"?"Avance de efectivo":"Compra financiada"} · `+
    `${nextPending
      ? `pagado hasta ${planPaidThrough(plan)}/${plan.installmentCount||effectiveSchedule.length} · próxima ${nextPending.n}`
      : "plan liquidado"
    }`;

  cardScheduleBody.innerHTML=effectiveSchedule.length
    ? effectiveSchedule.map(s=>{
        const isPaid=s.status==="paid";
        const isHistorical=!!s.historicalPayment && !s.paidDate;
        const isNext=!isPaid && Number(s.n)===Number(nextPending?.n);
        const statusLabel=isPaid
          ? (isHistorical ? "Pagada (hist.)" : "Pagada")
          : isNext ? "Por pagar" : "Pendiente";

        return `
          <tr class="${isPaid?"tf-installment-paid":isNext?"tf-installment-next":""}">
            <td>${s.n}</td>
            <td>${s.dueDate}</td>
            <td>${fmt(s.principal)}</td>
            <td>${fmt(s.interest)}</td>
            <td>${money(s.payment)}</td>
            <td>${fmt(s.closingBalance)}</td>
            <td>
              <span class="tf-pill ${isPaid?"tf-pill-ok":"tf-pill-warn"}">
                ${statusLabel}
              </span>
            </td>
            <td>
              ${isPaid
                ? `<span class="tf-installment-paid-mark">✓ Pagada</span>`
                : isNext
                  ? `<button class="tf-btn tf-btn-primary" data-pay-card="${s.n}">
                       Pagar cuota
                     </button>`
                  : `<span class="tf-muted tf-installment-waiting">Después de cuota ${nextPending?.n||"—"}</span>`
              }
            </td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="8" class="tf-empty">Sin cuotas.</td></tr>`;

  document.querySelector("#card-schedule-card")
    .scrollIntoView({behavior:"smooth",block:"start"});
}

async function payCardInstallment(n){
  const plan=plans.find(x=>x.id===selectedCardPlanId);
  if(!plan) return;

  const scheduleBefore=markPaidThrough(
    plan.schedule||[],
    planPaidThrough(plan),
    {historical:true}
  );

  const nextPending=scheduleBefore.find(x=>x.status!=="paid")||null;

  if(!nextPending){
    toast("Todas las cuotas de este plan ya están pagadas.");
    return;
  }

  if(Number(n)!==Number(nextPending.n)){
    toast(`Primero debes pagar la cuota ${nextPending.n}.`);
    return;
  }

  const installment=scheduleBefore.find(
    x=>Number(x.n)===Number(n)
  );
  if(!installment) return;

  const bankId=document.querySelector("#schedule-payment-account").value;

  if(!bankId){
    toast("Selecciona la cuenta bancaria desde la que pagarás la tarjeta.");
    return;
  }

  if(!await confirmAction({
    title:"Pagar cuota de tarjeta",
    message:`${accountLabel(plan.parentId)} · cuota ${n} · ${money(installment.payment)}`,
    impact:[
      `La cuota ${n} pasará a estado Pagada.`,
      "El saldo pendiente y la siguiente cuota se actualizarán.",
      "Creará una transferencia desde la cuenta bancaria hacia la tarjeta.",
      "Las cuotas deben pagarse en orden."
    ]
  })) return;

  const schedule=scheduleBefore.map(x=>
    Number(x.n)===Number(n)
      ? {
          ...x,
          status:"paid",
          paidAmount:Number(x.payment||0),
          paidDate:todayISO(),
          historicalPayment:false
        }
      : x
  );

  const newPaidThrough=Number(n);
  const newNext=schedule.find(x=>x.status!=="paid")||null;
  const pending=planTotals({...plan,schedule}).pending;

  const updatedPlan={
    ...plan,
    schedule,
    paidThroughInstallment:newPaidThrough,
    currentInstallment:newNext
      ? Number(newNext.n)
      : Number(plan.installmentCount||schedule.length||n),
    calculatedPending:pending,
    status:newNext ? "active" : "paid_off",
    paidOffDate:newNext ? (plan.paidOffDate||null) : todayISO()
  };

  await atomicWrite([
    {
      collection:"financingPlans",
      id:plan.id,
      action:"update",
      auditType:"financingPlan",
      data:updatedPlan
    },
    {
      collection:"transactions",
      action:"create",
      auditType:"transaction",
      data:{
        type:"transfer",
        date:todayISO(),
        amount:Number(installment.payment),
        vat:0,
        receipt:"",
        description:`Pago cuota ${n}: ${plan.description}`,
        category:"",
        subcategory:"",
        accountId:null,
        fromAccountId:bankId,
        toAccountId:plan.parentId,
        splits:[],
        financingPlanId:plan.id,
        installmentNumber:n
      }
    }
  ]);

  toast(
    newNext
      ? `Cuota ${n} pagada. Próxima cuota: ${newNext.n}.`
      : `Cuota ${n} pagada. Plan liquidado.`
  );

  await refresh();

  const updated=plans.find(x=>x.id===plan.id);
  if(updated){
    showCardSchedule(updated);

    if(editingCardPlanId===updated.id){
      document.querySelector("#plan-paid-through").value=
        planPaidThrough(updated);
      document.querySelector("#plan-calculated-balance").value=
        money(planPendingAmount(updated));
      renderPlanNextInstallmentSummary(
        (updated.schedule||[]).find(x=>x.status!=="paid")||null
      );
    }
  }
}

async function refresh(){
  const rawDebts=await listLiabilities();
  const [loadedPlans,loadedAccounts,loadedTransactions]=await Promise.all([
    listFinancingPlans().catch(error=>{console.warn("Planes no disponibles",error);return [];}),
    listAccounts({includeArchived:false}).catch(error=>{console.warn("Cuentas no disponibles",error);return [];}),
    listTransactions().catch(error=>{console.warn("Movimientos no disponibles",error);return [];})
  ]);

  debts=(rawDebts||[]).map(row=>{
    try{return normalizeLegacyDebt(row);}catch(error){
      console.error("No se pudo normalizar deuda",row?.id,error);
      return {...row,id:String(row?.id||""),creditor:String(row?.creditor||"Deuda existente"),concept:String(row?.concept||"Registro legado"),active:row?.active!==false};
    }
  });
  plans=loadedPlans||[];
  accounts=loadedAccounts||[];
  transactions=loadedTransactions||[];
  balances=calculateBalances(accounts,transactions);

  const cards=accounts.filter(a=>a.accountType==="credit_card");
  const banks=accounts.filter(a=>a.accountType!=="credit_card");

  document.querySelector("#plan-card").innerHTML=
    cards.map(a=>
      `<option value="${a.id}">${escapeHtml(a.bank+" · "+a.alias)}</option>`
    ).join("");

  document.querySelector("#plan-cash-destination").innerHTML=
    banks.map(a=>
      `<option value="${a.id}">${escapeHtml(a.bank+" · "+a.alias)}</option>`
    ).join("");

  document.querySelector("#schedule-payment-account").innerHTML=
    banks.map(a=>
      `<option value="${a.id}">${escapeHtml(a.bank+" · "+a.alias)}</option>`
    ).join("");

  render();
}

function togglePlanType(){
  document.querySelector("#plan-cash-destination-wrap").hidden=
    document.querySelector("#plan-type").value!=="cash_advance";
}

function togglePlanMethod(){
  const method=document.querySelector("#plan-method").value;
  const payment=document.querySelector("#plan-payment");
  const rate=document.querySelector("#plan-rate");

  if(method==="fixed_installment"){
    payment.disabled=false;
    rate.disabled=true;
  }else{
    payment.disabled=true;
    rate.disabled=false;
  }
}

document.querySelector("#debt-first").value=addMonthsISO(todayISO(),1);
document.querySelector("#plan-first").value=addMonthsISO(todayISO(),1);
document.querySelector("#debt-preview").addEventListener("click",previewDebt);
document.querySelector("#debt-mode").addEventListener("change",syncDebtMode);
document.querySelector("#plan-preview").addEventListener("click",previewPlan);
document.querySelector("#plan-type").addEventListener("change",togglePlanType);
document.querySelector("#plan-method").addEventListener("change",togglePlanMethod);

document.querySelector("#debt-schedule-close").addEventListener("click",()=>{
  selectedDebtId=null;
  document.querySelector("#debt-schedule-card").hidden=true;
});

document.querySelector("#card-schedule-close").addEventListener("click",()=>{
  selectedCardPlanId=null;
  document.querySelector("#card-schedule-card").hidden=true;
});

document.querySelector("#debt-cancel-edit").addEventListener("click",()=>{
  resetDebtForm();
  toast("Edición cancelada.");
});

document.querySelector("#plan-cancel-edit").addEventListener("click",()=>{
  resetPlanForm();
  toast("Edición del plan cancelada.");
});

syncDebtMode();
togglePlanType();
togglePlanMethod();


document.querySelector("#debt-form").addEventListener("submit",async e=>{
  e.preventDefault();
  if(debtSaving) return;

  const values=debtFormValues();
  const submit=document.querySelector("#debt-submit");

  if(!values.creditor||!values.concept){
    toast("Acreedor y concepto son obligatorios.");
    return;
  }
  if(!(values.originalPrincipal>=0)){
    toast("El capital original no es válido.");
    return;
  }
  if(!(values.termMonths>=1)){
    toast("El plazo original debe ser al menos 1 cuota.");
    return;
  }
  if(values.paidThroughInstallment>values.termMonths){
    toast(`Pagado hasta (${values.paidThroughInstallment}) no puede superar el plazo (${values.termMonths}).`);
    return;
  }
  if(values.mode!=="calculated" && (values.bankReportedBalance===null || values.bankReportedBalance<0)){
    toast("Ingresa el saldo actual informado por el acreedor.");
    return;
  }
  if(values.mode==="imported" && !(values.bankInstallment>0)){
    toast("Ingresa la cuota informada para el cronograma reportado.");
    return;
  }

  if(!editingDebtId){
    const norm=s=>String(s||"").trim().toLowerCase();
    const duplicate=debts.find(x=>
      x.active!==false &&
      norm(x.creditor)===norm(values.creditor) &&
      norm(x.concept)===norm(values.concept)
    );
    if(duplicate){
      toast("Ya existe una deuda activa con el mismo acreedor y concepto. Usa Editar en ese registro para evitar duplicados.");
      startDebtEdit(duplicate);
      return;
    }
  }

  let baseSchedule=[];
  if(values.mode==="calculated"){
    if(!["german","french"].includes(values.amortizationMethod)){
      toast("Selecciona sistema Alemán o Francés.");
      return;
    }
    baseSchedule=makeSchedule(values.amortizationMethod,{
      principal:values.originalPrincipal,
      rate:values.annualRate,
      term:values.termMonths,
      rateType:values.rateType,
      first:values.firstPaymentDate
    });
  }else{
    baseSchedule=trackingSchedule({
      term:values.termMonths,
      first:values.firstPaymentDate,
      payment:values.bankInstallment
    });
  }

  let schedule=markPaidThrough(
    baseSchedule,
    values.paidThroughInstallment,
    {historical:true}
  );

  const oldDebt=editingDebtId
    ? debts.find(x=>x.id===editingDebtId)
    : null;

  if(oldDebt){
    const actual=actualDebtPaidThrough(oldDebt.schedule||[]);
    if(values.paidThroughInstallment<actual){
      toast(`No puedes reducir "Pagado hasta" por debajo de la cuota ${actual}, porque tiene un pago real registrado.`);
      return;
    }
    schedule=preserveActualDebtPayments(schedule,oldDebt.schedule||[]);
  }

  const nextPending=schedule.find(x=>x.status!=="paid")||null;
  const calculatedBalance=
    values.mode==="calculated"
      ? calculatedBalanceAfterPaidThrough(
          schedule,
          values.paidThroughInstallment,
          values.originalPrincipal
        )
      : null;

  const data={
    ...values,
    currentManualBalance:
      values.mode==="calculated" ? null : values.bankReportedBalance,
    calculatedBalance,
    schedule,
    currentInstallment:
      nextPending
        ? Number(nextPending.n)
        : Number(values.termMonths||schedule.length||0),
    status:
      (!nextPending && (
        values.bankReportedBalance!==null
          ? values.bankReportedBalance<=0.009
          : Number(calculatedBalance||0)<=0.009
      ))
        ? "paid_off"
        : "active",
    active:true,
    liabilityType:"loan"
  };

  if(editingDebtId && !oldDebt){
    toast("No se encontró la deuda que intentas editar.");
    resetDebtForm();
    return;
  }

  if(oldDebt && financialDebtChanged(oldDebt,data)){
    if(!await confirmAction({
      title:"Actualizar el registro existente",
      message:`${oldDebt.creditor} · ${oldDebt.concept}`,
      impact:[
        `Se actualizará el documento existente ${oldDebt.id}.`,
        `Las cuotas 1–${data.paidThroughInstallment||0} quedarán como historial pagado.`,
        "Las cuotas futuras se reconstruirán con los datos actuales.",
        data.mode==="calculated"
          ? "El saldo teórico se recalculará; el saldo informado se conservará como referencia separada."
          : "El saldo informado seguirá siendo la referencia y el cronograma servirá para seguimiento.",
        "No se creará una segunda deuda."
      ],
      confirmText:"Actualizar deuda"
    })) return;
  }

  debtSaving=true;
  submit.disabled=true;
  try{
    if(editingDebtId){
      await saveLiability({...oldDebt,...data},editingDebtId);
      toast("Deuda actualizada en el mismo registro.");
    }else{
      await saveLiability(data);
      toast("Préstamo/deuda guardado.");
    }

    resetDebtForm();
    await refresh();
  }finally{
    debtSaving=false;
    submit.disabled=false;
  }
});

document.querySelector("#plan-form").addEventListener("submit",async e=>{
  e.preventDefault();

  const values=planFormValues();

  if(!values.parentId){
    toast("Registra o selecciona una tarjeta de crédito.");
    return;
  }

  if(!values.description){
    toast("La descripción es obligatoria.");
    return;
  }

  if(!(values.originalPrincipal>0)){
    toast("El principal debe ser mayor que cero.");
    return;
  }

  if(!(values.installmentCount>=1)){
    toast("El número de cuotas debe ser al menos 1.");
    return;
  }

  if(values.paidThroughInstallment>values.installmentCount){
    toast(
      `La cuota pagada (${values.paidThroughInstallment}) no puede superar `+
      `el número de cuotas (${values.installmentCount}).`
    );
    return;
  }

  if(
    values.amortizationMethod==="fixed_installment" &&
    !(values.bankInstallment>0)
  ){
    toast("Ingresa la cuota informada por el banco.");
    return;
  }

  const oldPlan=editingCardPlanId
    ? plans.find(x=>x.id===editingCardPlanId)
    : null;

  if(oldPlan){
    const maxActualPaid=actualPaidThrough(oldPlan.schedule||[]);
    if(values.paidThroughInstallment<maxActualPaid){
      toast(
        `No puedes reducir "Pagado hasta" por debajo de la cuota ${maxActualPaid}, `+
        `porque esa cuota ya tiene un pago bancario registrado.`
      );
      return;
    }
  }

  const baseSchedule=makeSchedule(
    values.amortizationMethod,
    {
      principal:values.originalPrincipal,
      rate:values.annualRate,
      term:values.installmentCount,
      rateType:values.rateType,
      first:values.firstPaymentDate,
      payment:values.bankInstallment
    }
  );

  let schedule=markPaidThrough(
    baseSchedule,
    values.paidThroughInstallment,
    {historical:true}
  );

  if(oldPlan){
    schedule=preserveActualCardPayments(
      schedule,
      oldPlan.schedule||[]
    );
  }

  const nextPending=schedule.find(x=>x.status!=="paid")||null;
  const totals=planTotals({schedule});

  const planData={
    ...(oldPlan||{}),
    ...values,
    schedule,
    currentInstallment:nextPending
      ? Number(nextPending.n)
      : Number(values.installmentCount),
    calculatedPending:totals.pending,
    status:nextPending ? "active" : "paid_off",
    paidOffDate:nextPending ? (oldPlan?.paidOffDate||null) : todayISO(),
    active:true
  };

  if(oldPlan){
    if(!await confirmAction({
      title:"Actualizar plan de tarjeta",
      message:`${planData.description} · ${values.installmentCount} cuotas`,
      impact:[
        `Las cuotas 1–${values.paidThroughInstallment} quedarán marcadas como pagadas.`,
        "Los pagos bancarios reales ya registrados se conservarán.",
        "Las cuotas futuras se recalcularán.",
        "No se modificará la compra/avance original ni la comisión ya registrada."
      ],
      confirmText:"Actualizar plan"
    })) return;

    await atomicWrite([
      {
        collection:"financingPlans",
        id:oldPlan.id,
        action:"update",
        auditType:"financingPlan",
        data:planData
      }
    ]);

    toast("Plan de tarjeta actualizado.");
    resetPlanForm();
    await refresh();
    return;
  }

  const txOps=[];

  if(values.planType==="installment_purchase"){
    txOps.push({
      collection:"transactions",
      action:"create",
      auditType:"transaction",
      data:{
        type:"expense",
        date:todayISO(),
        amount:values.originalPrincipal,
        vat:0,
        receipt:"",
        description:`Compra financiada: ${values.description}`,
        category:"Compras financiadas",
        subcategory:"Plan de tarjeta",
        accountId:values.parentId,
        fromAccountId:null,
        toAccountId:null,
        splits:[]
      }
    });
  }else{
    const destination=document.querySelector("#plan-cash-destination").value;

    if(!destination){
      toast("Selecciona la cuenta que recibe el avance.");
      return;
    }

    txOps.push({
      collection:"transactions",
      action:"create",
      auditType:"transaction",
      data:{
        type:"transfer",
        date:todayISO(),
        amount:values.originalPrincipal,
        vat:0,
        receipt:"",
        description:`Avance de efectivo: ${values.description}`,
        category:"",
        subcategory:"",
        accountId:null,
        fromAccountId:values.parentId,
        toAccountId:destination,
        splits:[]
      }
    });
  }

  if(values.initialFee>0){
    txOps.push({
      collection:"transactions",
      action:"create",
      auditType:"transaction",
      data:{
        type:"expense",
        date:todayISO(),
        amount:values.initialFee,
        vat:0,
        receipt:"",
        description:`Comisión: ${values.description}`,
        category:"Comisiones",
        subcategory:"Tarjeta",
        accountId:values.parentId,
        fromAccountId:null,
        toAccountId:null,
        splits:[]
      }
    });
  }

  if(!await confirmAction({
    title:"Guardar plan de tarjeta",
    message:`${money(values.originalPrincipal)} · ${values.installmentCount} cuotas`,
    impact:[
      `Las cuotas 1–${values.paidThroughInstallment} se guardarán como históricamente pagadas.`,
      "No se crearán transferencias bancarias retroactivas para esas cuotas.",
      "Los pagos futuros sí crearán transferencias banco → tarjeta.",
      "El saldo pendiente y la siguiente cuota quedarán calculados."
    ]
  })) return;

  await atomicWrite([
    {
      collection:"financingPlans",
      action:"create",
      auditType:"financingPlan",
      data:planData
    },
    ...txOps
  ]);

  resetPlanForm();
  toast("Plan de tarjeta registrado.");
  await refresh();
});

document.addEventListener("click",async e=>{
  const pe=e.target.closest("[data-debt-edit]");
  const ce=e.target.closest("[data-plan-edit]");
  const ps=e.target.closest("[data-plan-schedule]");
  const ds=e.target.closest("[data-debt-schedule]");
  const pa=e.target.closest("[data-plan-archive]");
  const da=e.target.closest("[data-debt-archive]");
  const dr=e.target.closest("[data-debt-reactivate]");

  if(pe){
    const debt=debts.find(x=>x.id===pe.dataset.debtEdit);
    if(debt) startDebtEdit(debt);
    return;
  }

  if(ce){
    const plan=plans.find(x=>x.id===ce.dataset.planEdit);
    if(plan) startPlanEdit(plan);
    return;
  }

  if(ps){
    showCardSchedule(
      plans.find(x=>x.id===ps.dataset.planSchedule)
    );
  }

  if(ds){
    showDebtSchedule(
      debts.find(x=>x.id===ds.dataset.debtSchedule)
    );
  }

  if(pa&&await confirmAction({
    title:"Archivar plan de tarjeta",
    message:"Se conserva el historial de cuotas.",
    confirmText:"Archivar"
  })){
    await archiveFinancingPlan(pa.dataset.planArchive);
    document.querySelector("#card-schedule-card").hidden=true;
    selectedCardPlanId=null;
    await refresh();
  }

  if(dr&&await confirmAction({
    title:"Reactivar préstamo/deuda",
    message:"El registro volverá a la lista de deudas activas.",
    confirmText:"Reactivar"
  })){
    await reactivateLiability(dr.dataset.debtReactivate);
    await refresh();
    return;
  }

  if(da&&await confirmAction({
    title:"Archivar préstamo/deuda",
    message:"Se conserva el historial del acreedor y sus cuotas.",
    confirmText:"Archivar"
  })){
    await archiveLiability(da.dataset.debtArchive);
    document.querySelector("#debt-schedule-card").hidden=true;
    selectedDebtId=null;
    await refresh();
  }
});

debtScheduleBody.addEventListener("click",async e=>{
  const b=e.target.closest("[data-pay-debt]");
  if(!b) return;
  await payDebtInstallment(Number(b.dataset.payDebt));
});

cardScheduleBody.addEventListener("click",async e=>{
  const b=e.target.closest("[data-pay-card]");
  if(!b) return;
  await payCardInstallment(Number(b.dataset.payCard));
});

requireUser(()=>refresh().catch(console.error));
