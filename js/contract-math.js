function validDate(v){
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v||""));
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
function monthShift(period,delta){
  const [y,m]=String(period).split("-").map(Number);
  const d=new Date(Date.UTC(y,m-1+Number(delta),1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}
function monthDiff(a,b){
  const [ay,am]=String(a).split("-").map(Number),[by,bm]=String(b).split("-").map(Number);
  return (by-ay)*12+(bm-am);
}
function addDays(date,days){
  const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
function anchoredDate(startDate,offset){
  if(!validDate(startDate)) return "";
  const [y,m,d]=startDate.split("-").map(Number);
  const first=new Date(Date.UTC(y,m-1+offset,1));
  const yy=first.getUTCFullYear(),mm=first.getUTCMonth()+1,last=new Date(Date.UTC(yy,mm,0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2,"0")}-${String(Math.min(d,last)).padStart(2,"0")}`;
}
function inclusiveDays(a,b){
  if(!validDate(a)||!validDate(b)||a>b) return 0;
  return Math.floor((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000)+1;
}
function roundMoney(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100;}
export function contractBillingCycleMode(contract){
  return contract?.billingCycleMode==="anniversary"?"anniversary":"calendar_month";
}
export function contractTariffForDate(contract,date){
  let amount=Number(contract?.initialMonthlyRate||0);
  for(const t of [...(contract?.tariffPeriods||[])].sort((a,b)=>String(a.effectiveFrom||"").localeCompare(String(b.effectiveFrom||"")))){
    if(String(t.effectiveFrom||"")<=date) amount=Number(t.amount||0);
  }
  return Math.max(0,amount);
}
export function contractTariffForPeriod(contract,period){
  return contractTariffForDate(contract,`${period}-01`);
}
function calendarPeriodCalculation(contract,period){
  const first=`${period}-01`,last=periodEnd(period);
  if(!validDate(first)||!validDate(last)||!validDate(contract?.startDate)) return null;
  const contractStart=String(contract.startDate),contractEnd=validDate(contract?.endDate)?String(contract.endDate):last;
  const serviceStart=contractStart>first?contractStart:first,serviceEnd=contractEnd<last?contractEnd:last;
  if(serviceStart>serviceEnd)return null;
  const monthDays=daysInMonth(period),workedDays=inclusiveDays(serviceStart,serviceEnd);
  if(!(monthDays>0)||!(workedDays>0))return null;
  const monthlyTariff=contractTariffForDate(contract,serviceStart),amount=roundMoney(monthlyTariff*workedDays/monthDays);
  return {period,monthlyTariff,amount,serviceStart,serviceEnd,workedDays,monthDays,prorated:workedDays<monthDays,earnedAt:serviceEnd,billingCycleMode:"calendar_month"};
}
function anniversaryPeriodCalculation(contract,period){
  if(!validDate(contract?.startDate)||!/^\d{4}-\d{2}$/.test(String(period||"")))return null;
  const start=String(contract.startDate),startMonth=start.slice(0,7),offset=monthDiff(startMonth,period);
  if(offset<0)return null;
  const cycleStart=anchoredDate(start,offset),nextStart=anchoredDate(start,offset+1);
  if(!cycleStart||!nextStart||cycleStart.slice(0,7)!==period)return null;
  const cycleEnd=addDays(nextStart,-1),contractEnd=validDate(contract?.endDate)?String(contract.endDate):cycleEnd;
  if(contractEnd<cycleStart)return null;
  const serviceStart=cycleStart,serviceEnd=contractEnd<cycleEnd?contractEnd:cycleEnd;
  const cycleDays=inclusiveDays(cycleStart,cycleEnd),workedDays=inclusiveDays(serviceStart,serviceEnd);
  if(!(cycleDays>0)||!(workedDays>0))return null;
  const monthlyTariff=contractTariffForDate(contract,cycleStart),amount=roundMoney(monthlyTariff*workedDays/cycleDays);
  return {period,monthlyTariff,amount,serviceStart,serviceEnd,workedDays,monthDays:cycleDays,prorated:workedDays<cycleDays,earnedAt:serviceEnd,billingCycleMode:"anniversary"};
}
export function contractPeriodCalculation(contract,period){
  return contractBillingCycleMode(contract)==="anniversary"?anniversaryPeriodCalculation(contract,period):calendarPeriodCalculation(contract,period);
}
export function contractDesiredStopMonth(contract,todayIso){
  if(!validDate(contract?.startDate)||!validDate(todayIso))return null;
  if(contractBillingCycleMode(contract)==="anniversary"){
    const keys=contractDesiredPeriodKeys(contract,todayIso);return keys.length?keys[keys.length-1]:null;
  }
  const todayMonth=todayIso.slice(0,7),closedThrough=previousMonth(todayMonth),end=validDate(contract?.endDate)?String(contract.endDate):"";
  if(contract?.active===false&&!end)return null;
  if(end&&end<=todayIso)return end.slice(0,7);
  if(end)return end.slice(0,7)<closedThrough?end.slice(0,7):closedThrough;
  return closedThrough;
}
export function contractDesiredPeriodKeys(contract,todayIso){
  if(!validDate(contract?.startDate)||!validDate(todayIso))return [];
  if(contractBillingCycleMode(contract)==="calendar_month"){
    const start=String(contract.startDate).slice(0,7),stop=contractDesiredStopMonth(contract,todayIso);if(!stop||start>stop)return [];
    const out=[];let cur=start,guard=0;while(cur<=stop&&guard<600){out.push(cur);cur=monthShift(cur,1);guard++;}return out;
  }
  const out=[],startMonth=String(contract.startDate).slice(0,7),end=validDate(contract?.endDate)?String(contract.endDate):"";
  for(let i=0;i<600;i++){
    const period=monthShift(startMonth,i),calc=anniversaryPeriodCalculation(contract,period);if(!calc)break;
    if(end&&calc.serviceStart>end)break;
    if(calc.earnedAt<=todayIso)out.push(period);else break;
    if(end&&calc.serviceEnd>=end)break;
  }
  return out;
}
export function receivableIsEarned(row,contract,todayIso){
  if(row?.active===false)return false;
  if(validDate(row?.earnedAt))return String(row.earnedAt)<=todayIso;
  const workPeriod=String(row?.workPeriod||"");if(!/^\d{4}-\d{2}$/.test(workPeriod))return false;
  if(contractBillingCycleMode(contract)==="anniversary"){
    const calc=contractPeriodCalculation(contract,workPeriod);return !!calc&&calc.earnedAt<=todayIso;
  }
  const closedThrough=previousMonth(todayIso.slice(0,7));if(workPeriod<=closedThrough)return true;
  const end=validDate(contract?.endDate)?String(contract.endDate):"";return !!end&&end<=todayIso&&end.slice(0,7)===workPeriod;
}
export function proratedMonthlyEstimate(monthlyAmount,row){
  const monthDays=Number(row?.monthDays||0),workedDays=Number(row?.workedDays||0);
  if(monthDays>0&&workedDays>0&&workedDays<monthDays)return roundMoney(Number(monthlyAmount||0)*workedDays/monthDays);
  return Number(monthlyAmount||0);
}
