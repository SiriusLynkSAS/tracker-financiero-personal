import { addMonthsISO, addDaysISO, daysBetween } from "./utils.js";

export function monthlyRate(annualRate,rateType="nominal"){
  const a=Number(annualRate||0)/100;
  return rateType==="effective" ? Math.pow(1+a,1/12)-1 : a/12;
}
export function germanSchedule({principal,annualRate,termMonths,rateType="nominal",firstDueDate}){
  const P=Number(principal),n=Math.max(1,Number(termMonths)),r=monthlyRate(annualRate,rateType),amort=P/n;
  let bal=P;const out=[];
  for(let k=1;k<=n;k++){
    const interest=bal*r,payment=amort+interest,close=Math.max(0,bal-amort);
    out.push({n:k,dueDate:addMonthsISO(firstDueDate,k-1),openingBalance:bal,principal:amort,interest,payment,closingBalance:close,status:"pending",paidAmount:0});
    bal=close;
  }
  return out;
}
export function frenchSchedule({principal,annualRate,termMonths,rateType="nominal",firstDueDate}){
  const P=Number(principal),n=Math.max(1,Number(termMonths)),r=monthlyRate(annualRate,rateType);
  const payment=r===0?P/n:P*(r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1);
  let bal=P;const out=[];
  for(let k=1;k<=n;k++){
    const interest=bal*r,principalPart=Math.min(bal,payment-interest),close=Math.max(0,bal-principalPart);
    out.push({n:k,dueDate:addMonthsISO(firstDueDate,k-1),openingBalance:bal,principal:principalPart,interest,payment:principalPart+interest,closingBalance:close,status:"pending",paidAmount:0});
    bal=close;
  }
  return out;
}
export function fixedInstallmentSchedule({principal,installmentCount,installmentAmount,firstDueDate}){
  const P=Number(principal),n=Math.max(1,Number(installmentCount)),pay=Number(installmentAmount);
  const out=[];
  for(let k=1;k<=n;k++){
    out.push({
      n:k,
      dueDate:addMonthsISO(firstDueDate,k-1),
      openingBalance:null,
      principal:null,
      interest:null,
      payment:pay,
      closingBalance:null,
      status:"pending",
      paidAmount:0,
      bankReported:true
    });
  }
  return out;
}
export function scheduleTotals(s=[]){
  return{
    principal:s.reduce((q,x)=>q+Number(x.principal||0),0),
    interest:s.reduce((q,x)=>q+Number(x.interest||0),0),
    payment:s.reduce((q,x)=>q+Number(x.payment||0),0)
  };
}
export function balanceAfterInstallment(schedule=[], currentInstallment=0, fallback=0){
  const current=Math.max(0,Number(currentInstallment||0));
  if(!schedule.length) return Number(fallback||0);
  if(current<=0) return Number(schedule[0]?.openingBalance ?? fallback ?? 0);
  const paid=schedule[Math.min(current,schedule.length)-1];
  return Number(paid?.closingBalance ?? fallback ?? 0);
}
export function investmentProjection({
  principal,annualRate,rateType="nominal",startDate,termValue,termUnit="days",
  calculation="simple",capitalization="monthly",withholding=0,fees=0
}){
  const P=Number(principal),a=Number(annualRate||0)/100;
  let maturityDate=startDate;
  if(termUnit==="months") maturityDate=addMonthsISO(startDate,Number(termValue));
  else if(termUnit==="years") maturityDate=addMonthsISO(startDate,Number(termValue)*12);
  else maturityDate=addDaysISO(startDate,Number(termValue));
  const days=Math.max(0,daysBetween(startDate,maturityDate));
  const years=days/365;
  let grossInterest=0;

  if(calculation==="simple"){
    grossInterest=P*a*years;
  }else if(rateType==="effective"){
    grossInterest=P*(Math.pow(1+a,years)-1);
  }else{
    const m=({monthly:12,quarterly:4,semiannual:2,annual:1})[capitalization]||12;
    grossInterest=P*(Math.pow(1+a/m,m*years)-1);
  }

  const netInterest=Math.max(0,grossInterest-Number(withholding||0)-Number(fees||0));
  return{days,grossInterest,netInterest,maturityValue:P+netInterest,maturityDate};
}
export function straightLineDepreciation({cost,residual,usefulLifeYears,ageYears}){
  const C=Number(cost),R=Number(residual||0),n=Math.max(.01,Number(usefulLifeYears||1)),
    annual=Math.max(0,(C-R)/n);
  return{annual,bookValue:Math.max(R,C-annual*Math.max(0,Number(ageYears||0)))};
}
