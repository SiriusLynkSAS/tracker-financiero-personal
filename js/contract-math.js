function validDate(v){
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v||""));
}

function monthKeyFromDate(v){
  return validDate(v) ? String(v).slice(0,7) : "";
}

function daysInMonth(period){
  const [y,m]=String(period).split("-").map(Number);
  if(!y||!m) return 0;
  return new Date(Date.UTC(y,m,0)).getUTCDate();
}

function periodEnd(period){
  const last=daysInMonth(period);
  return last ? `${period}-${String(last).padStart(2,"0")}` : "";
}

function previousMonth(period){
  const [y,m]=String(period).split("-").map(Number);
  const d=new Date(Date.UTC(y,m-2,1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}

function inclusiveDays(a,b){
  if(!validDate(a)||!validDate(b)||a>b) return 0;
  return Math.floor(
    (Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000
  )+1;
}

function roundMoney(v){
  return Math.round((Number(v||0)+Number.EPSILON)*100)/100;
}

export function contractTariffForPeriod(contract,period){
  let amount=Number(contract?.initialMonthlyRate||0);
  for(const t of [...(contract?.tariffPeriods||[])].sort(
    (a,b)=>String(a.effectiveFrom||"").localeCompare(String(b.effectiveFrom||""))
  )){
    if(String(t.effectiveFrom||"").slice(0,7)<=period){
      amount=Number(t.amount||0);
    }
  }
  return Math.max(0,amount);
}

export function contractPeriodCalculation(contract,period){
  const first=`${period}-01`;
  const last=periodEnd(period);
  if(!validDate(first)||!validDate(last)||!validDate(contract?.startDate)) return null;

  const contractStart=String(contract.startDate);
  const contractEnd=validDate(contract?.endDate) ? String(contract.endDate) : last;

  const serviceStart=contractStart>first ? contractStart : first;
  const serviceEnd=contractEnd<last ? contractEnd : last;

  if(serviceStart>serviceEnd) return null;

  const monthDays=daysInMonth(period);
  const workedDays=inclusiveDays(serviceStart,serviceEnd);
  if(!(monthDays>0) || !(workedDays>0)) return null;

  const monthlyTariff=contractTariffForPeriod(contract,period);
  const amount=roundMoney(monthlyTariff*workedDays/monthDays);

  return {
    period,
    monthlyTariff,
    amount,
    serviceStart,
    serviceEnd,
    workedDays,
    monthDays,
    prorated:workedDays<monthDays,
    earnedAt:serviceEnd
  };
}

export function contractDesiredStopMonth(contract,todayIso){
  if(!validDate(contract?.startDate)||!validDate(todayIso)) return null;

  const todayMonth=todayIso.slice(0,7);
  const closedThrough=previousMonth(todayMonth);
  const end=validDate(contract?.endDate) ? String(contract.endDate) : "";

  if(contract?.active===false && !end){
    // Contrato histórico sin fecha de fin: no inventar nuevos períodos.
    return null;
  }

  if(end && end<=todayIso){
    // Si el contrato ya terminó, su mes final queda cerrado aunque sea el mes actual.
    return end.slice(0,7);
  }

  if(end){
    // Si hay fecha futura, nunca superar el mes cerrado ni la fecha prevista.
    return end.slice(0,7)<closedThrough ? end.slice(0,7) : closedThrough;
  }

  return closedThrough;
}

export function receivableIsEarned(row,contract,todayIso){
  if(row?.active===false) return false;

  if(validDate(row?.earnedAt)){
    return String(row.earnedAt)<=todayIso;
  }

  const workPeriod=String(row?.workPeriod||"");
  if(!/^\d{4}-\d{2}$/.test(workPeriod)) return false;

  const closedThrough=previousMonth(todayIso.slice(0,7));
  if(workPeriod<=closedThrough) return true;

  const end=validDate(contract?.endDate) ? String(contract.endDate) : "";
  return !!end && end<=todayIso && end.slice(0,7)===workPeriod;
}

export function proratedMonthlyEstimate(monthlyAmount,row){
  const monthDays=Number(row?.monthDays||0);
  const workedDays=Number(row?.workedDays||0);
  if(monthDays>0 && workedDays>0 && workedDays<monthDays){
    return roundMoney(Number(monthlyAmount||0)*workedDays/monthDays);
  }
  return Number(monthlyAmount||0);
}
