import {straightLineDepreciation} from "./finance.js";
import {daysBetween,todayISO} from "./utils.js";

export function assetInitialCost(a={}){
  return [
    a.purchasePrice,a.purchaseTaxes,a.purchaseTransport,a.purchaseInsurance,
    a.initialAccessories,a.initialCertification,a.initialSetup,a.otherInitial
  ].reduce((s,v)=>s+Number(v||0),0);
}

export function assetCapitalImprovements(a={}){
  return (a.events||[]).filter(e=>e.kind==="capital_improvement").reduce((s,e)=>s+Number(e.amount||0),0);
}

export function assetOperatingCosts(a={}){
  return (a.events||[]).filter(e=>["operating_cost","cost"].includes(e.kind)).reduce((s,e)=>s+Number(e.amount||0),0);
}

export function assetOtherRevenue(a={}){
  return (a.events||[]).filter(e=>e.kind==="revenue").reduce((s,e)=>s+Number(e.amount||0),0);
}

export function assetCapitalizedCost(a={}){
  return assetInitialCost(a)+assetCapitalImprovements(a);
}

export function assetDepreciation(a={},asOf=todayISO()){
  const cost=assetCapitalizedCost(a);
  const start=a.commissioningDate||a.purchaseDate||asOf;
  const age=Math.max(0,daysBetween(start,asOf)/365.25);
  const out=straightLineDepreciation({cost,residual:Number(a.residualValue||0),usefulLifeYears:Number(a.usefulLifeYears||5),ageYears:age});
  return {...out,accumulated:Math.max(0,cost-out.bookValue),ageYears:age};
}

export function contractAllocations(contract={}){
  const rows=Array.isArray(contract.assetAllocations)?contract.assetAllocations
    .map(x=>({assetId:String(x?.assetId||""),percent:Number(x?.percent||0)}))
    .filter(x=>x.assetId&&x.percent>0):[];
  if(rows.length) return rows;
  return contract.assetId?[{assetId:String(contract.assetId),percent:100}]:[];
}

export function allocationPercent(contract,assetId){
  return contractAllocations(contract).filter(x=>x.assetId===assetId).reduce((s,x)=>s+Number(x.percent||0),0);
}

function periodCost(contract,row){
  const monthly=Number(contract?.monthlyTransportEstimate||0)+Number(contract?.monthlyOtherDirectCostEstimate||0);
  const days=Number(row?.workedDays||0),monthDays=Number(row?.monthDays||0);
  return monthDays>0&&days>0 ? monthly*days/monthDays : monthly;
}

export function assetContractRecovery(assetId,contracts=[],receivables=[]){
  let generatedRevenue=0,collectedRevenue=0,directCostGenerated=0,directCostCollected=0,
      attributedGenerated=0,attributedCollected=0;
  for(const c of contracts){
    const pct=allocationPercent(c,assetId)/100;
    if(!(pct>0)) continue;
    for(const r of receivables.filter(x=>x.contractId===c.id&&x.active!==false)){
      const amount=Math.max(0,Number(r.amount||0));
      const paid=Math.max(0,Math.min(amount,Number(r.paidAmount||0)));
      const cost=Math.max(0,periodCost(c,r));
      const paidRatio=amount>0?Math.min(1,paid/amount):0;
      const paidCost=cost*paidRatio;
      const marginGenerated=Math.max(0,amount-cost);
      const marginCollected=Math.max(0,paid-paidCost);
      generatedRevenue+=amount*pct;
      collectedRevenue+=paid*pct;
      directCostGenerated+=cost*pct;
      directCostCollected+=paidCost*pct;
      attributedGenerated+=marginGenerated*pct;
      attributedCollected+=marginCollected*pct;
    }
  }
  return {generatedRevenue,collectedRevenue,directCostGenerated,directCostCollected,attributedGenerated,attributedCollected};
}

export function assetRecoverySummary(asset,contracts=[],receivables=[],asOf=todayISO()){
  const initialCost=assetInitialCost(asset);
  const improvements=assetCapitalImprovements(asset);
  const capitalizedCost=initialCost+improvements;
  const operatingCosts=assetOperatingCosts(asset);
  const financingCost=Math.max(0,Number(asset.financingCost||0));
  const otherRevenue=assetOtherRevenue(asset);
  const dep=assetDepreciation(asset,asOf);
  const contract=assetContractRecovery(asset.id,contracts,receivables);
  const recoveredAccrued=contract.attributedGenerated+otherRevenue;
  const recoveredCollected=contract.attributedCollected+otherRevenue;
  const economicCost=capitalizedCost+operatingCosts+financingCost;
  const pendingCapital=Math.max(0,capitalizedCost-recoveredCollected);
  const recoveryPct=capitalizedCost>0?recoveredCollected/capitalizedCost*100:0;
  const economicRecoveryPct=economicCost>0?recoveredCollected/economicCost*100:0;
  const economicResult=recoveredCollected-economicCost;
  const roi=economicCost>0?economicResult/economicCost*100:0;
  return {initialCost,improvements,capitalizedCost,operatingCosts,financingCost,otherRevenue,...dep,...contract,recoveredAccrued,recoveredCollected,economicCost,pendingCapital,recoveryPct,economicRecoveryPct,economicResult,roi};
}
