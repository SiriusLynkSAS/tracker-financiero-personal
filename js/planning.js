import {sum,todayISO,isoFromParts} from "./utils.js";

export function monthStart(month){ return `${month}-01`; }

export function monthEnd(month){
  const [y,m]=String(month).split("-").map(Number);
  const last=new Date(Date.UTC(y,m,0)).getUTCDate();
  return isoFromParts(y,m,last);
}

export function shiftMonth(month,delta){
  const [y,m]=String(month).split("-").map(Number);
  const d=new Date(Date.UTC(y,m-1+Number(delta),1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}

export function appliesToMonth(item,month){
  const first=monthStart(month),last=monthEnd(month);
  const start=String(item?.startDate||"").trim();
  const end=String(item?.endDate||"").trim();
  return (!start || start<=last) && (!end || end>=first);
}

export function dueDateForDay(month,day){
  const [y,m]=String(month).split("-").map(Number);
  const last=new Date(Date.UTC(y,m,0)).getUTCDate();
  return isoFromParts(y,m,Math.min(Math.max(1,Number(day||1)),last));
}

export function inMonth(date,month){
  return String(date||"").slice(0,7)===month;
}

export function normalizeText(value){
  return String(value??"")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9ñü ]/g," ")
    .replace(/\s+/g," ");
}

export function pendingReceivable(row){
  return Math.max(0,Number(row?.amount||0)-Number(row?.paidAmount||0));
}

function contractLabel(contracts,id){
  return contracts.find(x=>x.id===id)?.name||"Cuenta por cobrar";
}

export function monthlyCommitments({
  recurring=[],
  insurance=[],
  receivables=[],
  contracts=[],
  debts=[],
  cardPlans=[],
  month,
  today=todayISO()
}){
  const rows=[];
  const lastClosed=shiftMonth(String(today).slice(0,7),-1);

  for(const r of recurring){
    if(r.active===false || !appliesToMonth(r,month)) continue;
    const amount=Number(r.amount||0);
    if(!(amount>0)) continue;
    const type=String(r.type||"").toLowerCase();
    if(!["income","expense"].includes(type)) continue;

    rows.push({
      key:`recurring:${r.id}`,
      kind:type,
      source:"recurring",
      label:r.name||"Recurrente",
      detail:[r.category,r.subcategory].filter(Boolean).join(" · ") ||
        `Día ${Number(r.dayOfMonth||1)}`,
      amount,
      day:Number(r.dayOfMonth||1),
      dueDate:dueDateForDay(month,r.dayOfMonth)
    });
  }

  for(const p of insurance){
    if(p.active===false || !appliesToMonth(p,month)) continue;
    const amount=Number(p.monthlyPremium||0);
    if(!(amount>0)) continue;
    rows.push({
      key:`insurance:${p.id}`,
      kind:"expense",
      source:"insurance",
      label:p.name||p.provider||"Seguro",
      detail:[p.provider,`Día ${Number(p.paymentDay||1)}`].filter(Boolean).join(" · "),
      amount,
      day:Number(p.paymentDay||1),
      dueDate:dueDateForDay(month,p.paymentDay)
    });
  }

  for(const r of receivables){
    const pending=pendingReceivable(r);
    if(r.active===false || pending<=0.009) continue;
    if(String(r.workPeriod||"")>lastClosed) continue;
    if(!inMonth(r.dueDate,month)) continue;

    rows.push({
      key:`receivable:${r.id}`,
      kind:"income",
      source:"receivable",
      label:contractLabel(contracts,r.contractId),
      detail:`Por cobrar · período ${r.workPeriod}`,
      amount:pending,
      day:Number(String(r.dueDate||"").slice(8,10)||99),
      dueDate:r.dueDate||""
    });
  }

  for(const debt of debts){
    const liabilityType=debt.liabilityType||"loan";
    if(debt.active===false || liabilityType!=="loan" || debt.status==="paid_off") continue;
    for(const row of debt.schedule||[]){
      if(row.status==="paid" || !inMonth(row.dueDate,month)) continue;
      rows.push({
        key:`liability:${debt.id}:installment:${row.n}`,
        kind:"expense",
        source:"loan",
        label:debt.creditor||debt.concept||"Préstamo",
        detail:`Cuota ${row.n} · ${row.dueDate}`,
        amount:Number(row.payment||0),
        day:Number(String(row.dueDate||"").slice(8,10)||99),
        dueDate:row.dueDate||""
      });
    }
  }

  for(const plan of cardPlans){
    if(plan.active===false || plan.status==="paid_off") continue;
    for(const row of plan.schedule||[]){
      if(row.status==="paid" || !inMonth(row.dueDate,month)) continue;
      rows.push({
        key:`financingPlan:${plan.id}:installment:${row.n}`,
        kind:"expense",
        source:"card",
        label:plan.description||"Plan de tarjeta",
        detail:`Cuota ${row.n} · ${row.dueDate}`,
        amount:Number(row.payment||0),
        day:Number(String(row.dueDate||"").slice(8,10)||99),
        dueDate:row.dueDate||""
      });
    }
  }

  return rows.sort((a,b)=>
    Number(a.day||99)-Number(b.day||99) ||
    (a.kind==="income"?0:1)-(b.kind==="income"?0:1) ||
    a.label.localeCompare(b.label,"es",{sensitivity:"base"})
  );
}

function amountMatches(tx,expectedAmount){
  const comparable=
    tx.type==="income" && Number(tx.vat||0)>0
      ? Math.max(0,Number(tx.amount||0)-Number(tx.vat||0))
      : Number(tx.amount||0);
  return Math.abs(comparable-Number(expectedAmount||0))<=
    Math.max(0.01,Number(expectedAmount||0)*0.02);
}

function textMatches(tx,expected){
  const txText=normalizeText([tx.description,tx.category,tx.subcategory].join(" "));
  const label=normalizeText(expected.label);
  const category=normalizeText(expected.category);
  const subcategory=normalizeText(expected.subcategory);

  return (
    (label && txText.includes(label)) ||
    (category && txText.includes(category) && (!subcategory || txText.includes(subcategory))) ||
    (!label && !category && !subcategory)
  );
}

function projectionExpected(row){
  const detail=String(row.detail||"");
  return {
    label:row.label||"",
    category:row.source==="recurring" ? detail.split(" · ")[0]||"" : row.label||"",
    subcategory:row.source==="recurring" && detail.includes(" · ")
      ? detail.split(" · ").slice(1).join(" · ")
      : "",
    amount:Number(row.amount||0)
  };
}

function unmatchedExpected(expected,actual){
  const used=new Set();
  return expected.filter(item=>{
    const candidates=actual
      .map((tx,index)=>({tx,index}))
      .filter(({tx,index})=>!used.has(index)&&amountMatches(tx,item.amount));

    const textMatch=candidates.find(({tx})=>textMatches(tx,item));
    const match=textMatch || (candidates.length===1?candidates[0]:null);

    if(match){
      used.add(match.index);
      return false;
    }
    return true;
  });
}

export function monthlyProjection({
  accounts=[],
  transactions=[],
  recurring=[],
  insurance=[],
  receivables=[],
  contracts=[],
  debts=[],
  cardPlans=[],
  month=String(todayISO()).slice(0,7),
  today=todayISO()
}){
  const commitments=monthlyCommitments({
    recurring,insurance,receivables,contracts,debts,cardPlans,month,today
  });

  const monthTx=transactions.filter(t=>inMonth(t.date,month));
  const monthIncome=monthTx.filter(t=>t.type==="income");
  const monthExpenseActivity=monthTx.filter(t=>["expense","investment_out"].includes(t.type));

  const receivablePendingIncome=sum(
    commitments.filter(x=>x.kind==="income"&&x.source==="receivable"),
    x=>x.amount
  );

  const expectedIncome=commitments
    .filter(x=>x.kind==="income"&&x.source!=="receivable")
    .map(projectionExpected);

  const transactionMatchedExpenses=commitments.filter(x=>
    x.kind==="expense" && ["recurring","insurance"].includes(x.source)
  );

  const scheduleControlledExpenses=commitments.filter(x=>
    x.kind==="expense" && ["loan","card"].includes(x.source)
  );

  const pendingIncome=unmatchedExpected(expectedIncome,monthIncome);
  const pendingTransactionExpenses=unmatchedExpected(
    transactionMatchedExpenses.map(projectionExpected),
    monthExpenseActivity
  );

  const projectedIncomeGross=
    sum(monthIncome,x=>x.amount)+
    sum(pendingIncome,x=>x.amount)+
    receivablePendingIncome;

  const projectedIncomeNet=
    sum(monthIncome,x=>Math.max(0,Number(x.amount||0)-Number(x.vat||0)))+
    sum(pendingIncome,x=>x.amount)+
    receivablePendingIncome;

  const accountTypes=new Map(accounts.map(a=>[a.id,a.accountType]));

  const cashExpenses=sum(
    monthTx.filter(t=>
      ["expense","investment_out"].includes(t.type) &&
      accountTypes.get(t.accountId)!=="credit_card"
    ),
    t=>t.amount
  );

  const cardPayments=sum(
    monthTx.filter(t=>
      t.type==="transfer" &&
      accountTypes.get(t.toAccountId)==="credit_card"
    ),
    t=>t.amount
  );

  const loanPayments=sum(
    debts.flatMap(d=>d.schedule||[]).filter(row=>
      row.status==="paid" && inMonth(row.paidDate,month)
    ),
    row=>Number(row.paidAmount||0)>0?row.paidAmount:row.payment
  );

  const registeredExpenses=cashExpenses+cardPayments+loanPayments;

  const pendingExpenses=
    sum(pendingTransactionExpenses,x=>x.amount)+
    sum(scheduleControlledExpenses,x=>x.amount);

  const reservedVat=sum(
    transactions.filter(t=>
      t.type==="income" &&
      Number(t.vat||0)>0 &&
      !t.taxPaymentId &&
      t.vatStatus!=="paid"
    ),
    t=>t.vat
  );

  const recommendedSavings=Math.max(0,projectedIncomeNet*0.10);
  const availableProjected=
    projectedIncomeGross-
    registeredExpenses-
    pendingExpenses-
    recommendedSavings-
    reservedVat;

  return {
    month,
    commitments,
    projectedIncomeGross,
    projectedIncomeNet,
    receivedIncomeGross:sum(monthIncome,x=>x.amount),
    pendingIncomeGross:sum(pendingIncome,x=>x.amount)+receivablePendingIncome,
    registeredExpenses,
    pendingExpenses,
    recommendedSavings,
    reservedVat,
    availableProjected
  };
}

export function goalSavingsSources({goals=[],accounts=[],balances={},month}){
  return goals
    .filter(g=>g.active!==false && Number(g.target||0)>0)
    .map(g=>{
      const saved=g.accountId
        ? Math.max(0,Number(balances[g.accountId]||0))
        : Math.max(0,Number(g.savedManual||0));
      const remaining=Math.max(0,Number(g.target||0)-saved);
      const targetDate=String(g.targetDate||"").trim();
      let monthly=0;

      if(remaining>0 && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)){
        const [fy,fm]=String(month).split("-").map(Number);
        const [ty,tm]=targetDate.slice(0,7).split("-").map(Number);
        const months=Math.max(1,(ty-fy)*12+(tm-fm)+1);
        monthly=remaining/months;
      }

      return {
        key:`goal:${g.id}`,
        bucket:"savings",
        label:g.name||"Meta de ahorro",
        detail:targetDate?`Objetivo ${targetDate}`:"Sin fecha objetivo",
        amount:monthly
      };
    })
    .filter(x=>x.amount>0);
}

function budgetPairKey(b){
  return `${normalizeText(b?.category)}|${normalizeText(b?.subcategory)}`;
}

function budgetTimestamp(b){
  return Number(b?.updatedAt?.seconds ?? b?.createdAt?.seconds ?? 0);
}

export function budgetsForMonth({budgets=[],month,currentMonth=String(todayISO()).slice(0,7)}){
  const grouped=new Map();
  for(const b of budgets.filter(x=>Number(x.limit||0)>=0)){
    const key=budgetPairKey(b);
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(b);
  }

  const selected=[];
  for(const rows of grouped.values()){
    const exact=rows.filter(b=>String(b.month||"")===month);
    const legacy=month===currentMonth?rows.filter(b=>!String(b.month||"").trim()):[];
    const candidates=exact.length?exact:legacy;
    if(!candidates.length)continue;
    selected.push([...candidates].sort((a,b)=>budgetTimestamp(b)-budgetTimestamp(a)||String(b.id).localeCompare(String(a.id)))[0]);
  }
  return selected;
}

export function budgetSpentForMonth({transactions=[],category,subcategory,month}){
  return transactions
    .filter(t=>t.type==="expense"&&inMonth(t.date,month))
    .reduce((total,t)=>{
      if(Array.isArray(t.splits)&&t.splits.length){
        return total+t.splits
          .filter(x=>normalizeText(x.category)===normalizeText(category)&&normalizeText(x.subcategory)===normalizeText(subcategory))
          .reduce((s,x)=>s+Number(x.amount||0),0);
      }
      return total+(
        normalizeText(t.category)===normalizeText(category)&&normalizeText(t.subcategory)===normalizeText(subcategory)
          ? Number(t.amount||0)
          : 0
      );
    },0);
}

export function budgetMetricsForMonth({budget,budgets=[],transactions=[],month,currentMonth=String(todayISO()).slice(0,7),seen=new Set()}){
  if(!budget)return {base:0,carry:0,available:0,spent:0,remaining:0};
  const key=`${budget.id||budgetPairKey(budget)}@${month}`;
  if(seen.has(key)||seen.size>120){
    const base=Math.max(0,Number(budget.limit||0));
    const spent=budgetSpentForMonth({transactions,category:budget.category,subcategory:budget.subcategory,month});
    return {base,carry:0,available:base,spent,remaining:base-spent};
  }
  const nextSeen=new Set(seen);nextSeen.add(key);
  const base=Math.max(0,Number(budget.limit||0));
  let carry=0;
  if(budget.rollover){
    const previousMonth=shiftMonth(month,-1);
    const previous=budgetsForMonth({budgets,month:previousMonth,currentMonth})
      .find(x=>budgetPairKey(x)===budgetPairKey(budget));
    if(previous){
      const prev=budgetMetricsForMonth({budget:previous,budgets,transactions,month:previousMonth,currentMonth,seen:nextSeen});
      carry=Math.max(0,prev.remaining);
    }
  }
  const available=base+carry;
  const spent=budgetSpentForMonth({transactions,category:budget.category,subcategory:budget.subcategory,month});
  return {base,carry,available,spent,remaining:available-spent};
}

export function budgetReserveSources({budgets=[],transactions=[],month,currentMonth=String(todayISO()).slice(0,7)}){
  return budgetsForMonth({budgets,month,currentMonth})
    .filter(b=>Number(b.limit||0)>0)
    .map(b=>{
      const m=budgetMetricsForMonth({budget:b,budgets,transactions,month,currentMonth});
      return {
        key:`budget:${b.id}`,
        bucket:"reserve",
        label:b.subcategory||b.category||"Presupuesto",
        detail:b.rollover&&m.carry>0
          ? `${b.category||""} · base ${new Intl.NumberFormat("es-EC",{style:"currency",currency:"USD"}).format(m.base)} + rollover ${new Intl.NumberFormat("es-EC",{style:"currency",currency:"USD"}).format(m.carry)}`
          : b.category||"",
        amount:m.available
      };
    });
}

function automaticEssentialRecurring(row){
  const category=normalizeText(row.category);
  const sub=normalizeText(row.subcategory);
  const name=normalizeText(row.name);

  if(category.includes("ahorro")||category.includes("inversion")||category.includes("prestamo")) return false;
  if(category.includes("alimentacion")||category.includes("transporte")) return false;
  if(category.includes("casa")||category.includes("vivienda")) return true;
  if(category.includes("salud")) return true;
  if(category.includes("personal")&&(sub.includes("celular")||name.includes("celular")||sub.includes("telefono"))) return true;

  return ["arriendo","agua","luz","internet","celular"].includes(sub) ||
    ["arriendo","agua","luz","internet","celular"].includes(name);
}

function variableAverage(transactions,{category,subcategories,start,end}){
  const total=sum(
    transactions.filter(tx=>
      tx.type==="expense" &&
      String(tx.date||"")>=start &&
      String(tx.date||"")<=end &&
      normalizeText(tx.category)===normalizeText(category) &&
      subcategories.some(s=>normalizeText(tx.subcategory)===normalizeText(s))
    ),
    tx=>tx.amount
  );
  return total/3;
}

export function defaultEmergencyFundConfig(){
  return {
    targetMonths:6,
    foodDailyMinimum:5,
    transportDailyMinimum:1,
    linkedAccountIds:[],
    essentialOverrides:{}
  };
}

export function emergencyFundSummary({
  config=defaultEmergencyFundConfig(),
  accounts=[],
  transactions=[],
  recurring=[],
  insurance=[],
  debts=[],
  cardPlans=[],
  balances={},
  projection=null,
  today=todayISO()
}){
  const cfg={
    ...defaultEmergencyFundConfig(),
    ...(config||{}),
    linkedAccountIds:Array.isArray(config?.linkedAccountIds)?config.linkedAccountIds:[],
    essentialOverrides:config?.essentialOverrides&&typeof config.essentialOverrides==="object"
      ? config.essentialOverrides
      : {}
  };

  const components=[];
  const dates=transactions
    .map(t=>String(t.date||""))
    .filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x))
    .sort();

  let historyDays=0;
  if(dates.length){
    const a=Date.parse(`${dates[0]}T00:00:00Z`);
    const b=Date.parse(`${today}T00:00:00Z`);
    historyDays=Math.max(0,Math.floor((b-a)/86400000));
  }
  const useHistory=historyDays>=89;
  const end=today;
  const d=new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate()-89);
  const start=d.toISOString().slice(0,10);

  const foodMinimum=Math.max(0,Number(cfg.foodDailyMinimum||0))*30;
  const transportMinimum=Math.max(0,Number(cfg.transportDailyMinimum||0))*30;

  const foodHistory=useHistory
    ? variableAverage(transactions,{category:"Alimentación",subcategories:["Despensa"],start,end})
    : 0;

  const transportHistory=useHistory
    ? variableAverage(transactions,{category:"Transporte",subcategories:["Bus","Metro"],start,end})
    : 0;

  components.push({
    key:"baseline:food",
    label:"Alimentación básica",
    detail:useHistory
      ?"Mayor entre mínimo de 30 días y promedio real de 90 días"
      :`${Number(cfg.foodDailyMinimum||0)} USD/día · base de 30 días`,
    source:"baseline",
    amount:Math.max(foodMinimum,foodHistory),
    counted:true
  });

  components.push({
    key:"baseline:transport",
    label:"Transporte mínimo",
    detail:useHistory
      ?"Mayor entre mínimo de 30 días y Bus/Metro promedio real de 90 días"
      :`${Number(cfg.transportDailyMinimum||0)} USD/día · base de 30 días`,
    source:"baseline",
    amount:Math.max(transportMinimum,transportHistory),
    counted:true
  });

  for(const row of recurring){
    if(row.active===false || row.type!=="expense" || !automaticEssentialRecurring(row)) continue;
    const key=`recurring:${row.id}`;
    components.push({
      key,
      label:row.name||row.subcategory||row.category||"Gasto recurrente",
      detail:[row.category,row.subcategory].filter(Boolean).join(" · "),
      source:"recurring",
      amount:Math.max(0,Number(row.amount||0)),
      counted:cfg.essentialOverrides[key]??true
    });
  }

  for(const row of insurance){
    if(row.active===false) continue;
    const amount=Number(row.monthlyPremium||0);
    if(!(amount>0)) continue;
    const text=normalizeText([row.type,row.name,row.provider].join(" "));
    if(!(text.includes("health")||text.includes("salud")||text.includes("medic"))) continue;
    const key=`insurance:${row.id}`;
    components.push({
      key,
      label:row.name||"Seguro de salud",
      detail:row.provider||"",
      source:"insurance",
      amount,
      counted:cfg.essentialOverrides[key]??true
    });
  }

  for(const debt of debts){
    if(debt.active===false || (debt.liabilityType||"loan")!=="loan" || debt.status==="paid_off") continue;
    const row=(debt.schedule||[]).find(x=>x.status!=="paid");
    if(!row) continue;
    const amount=Number(row.payment||row.paidAmount||0);
    if(!(amount>0)) continue;
    const key=`loan:${debt.id}`;
    components.push({
      key,
      label:debt.creditor||debt.concept||"Préstamo",
      detail:`Cuota obligatoria ${row.n}`,
      source:"loan",
      amount,
      counted:cfg.essentialOverrides[key]??true
    });
  }

  for(const plan of cardPlans){
    if(plan.active===false || plan.status==="paid_off") continue;
    const row=(plan.schedule||[]).find(x=>x.status!=="paid");
    if(!row) continue;
    const amount=Number(row.payment||plan.bankInstallment||0);
    if(!(amount>0)) continue;
    const key=`card:${plan.id}`;
    components.push({
      key,
      label:plan.description||"Cuota de tarjeta",
      detail:`Cuota comprometida ${row.n}`,
      source:"card",
      amount,
      counted:cfg.essentialOverrides[key]??true
    });
  }

  const order={baseline:0,recurring:1,insurance:2,loan:3,card:4};
  components.sort((a,b)=>
    (order[a.source]??9)-(order[b.source]??9) ||
    a.label.localeCompare(b.label,"es",{sensitivity:"base"})
  );

  const essentialMonthly=sum(components.filter(x=>x.counted),x=>x.amount);
  const targetAmount=essentialMonthly*Math.max(1,Number(cfg.targetMonths||6));
  const currentAmount=sum(
    cfg.linkedAccountIds,
    id=>Math.max(0,Number(balances[id]||0))
  );
  const coverageMonths=essentialMonthly>0?currentAmount/essentialMonthly:0;
  const progress=targetAmount>0?Math.min(1,Math.max(0,currentAmount/targetAmount)):0;
  const recommendedSavings=Math.max(0,Number(projection?.recommendedSavings||0));
  const remaining=Math.max(0,targetAmount-currentAmount);

  const share=
    remaining<=0 || recommendedSavings<=0 ? 0 :
    coverageMonths<3 ? 0.80 :
    coverageMonths<Math.max(1,Number(cfg.targetMonths||6)) ? 0.60 :
    0;

  const suggestedContribution=Math.min(recommendedSavings*share,remaining);

  return {
    config:cfg,
    components,
    essentialMonthly,
    targetAmount,
    currentAmount,
    coverageMonths,
    progress,
    recommendedSavings,
    suggestedContribution,
    historyDays,
    usingHistoricalVariableAverage:useHistory
  };
}
