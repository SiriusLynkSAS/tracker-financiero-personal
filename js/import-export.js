import {requireUser} from "./guard.js";
import {
  listAccounts,listTransactions,listBudgets,listMonthlyPlans,listCategories,listRecurring,listGoals,listLiabilities,
  listFinancingPlans,listInsurance,listAssets,listContracts,listReceivables,listInvestments,
  listReconciliations,listAudit,listTaxPayments,listEmergencyFund,saveTransaction
} from "./data-service.js";
import {escapeHtml,csvEscape,downloadText,isoFromParts} from "./utils.js";
import {confirmAction,toast} from "./ui.js";
let accounts=[],existingTx=[],preview=[];

function excelDateToISO(v){
  if(v instanceof Date&&!isNaN(v))return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,"0")}-${String(v.getDate()).padStart(2,"0")}`;
  if(typeof v==="number"&&Number.isFinite(v)){
    const p=XLSX.SSF.parse_date_code(v);
    if(p)return isoFromParts(p.y,p.m,p.d);
  }
  const s=String(v??"").trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
  const m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if(m)return isoFromParts(Number(m[3]),Number(m[2]),Number(m[1]));
  return "";
}
function norm(row){
  const get=(...names)=>{for(const n of names)if(row[n]!==undefined)return row[n];return""};
  let type=String(get("Tipo","tipo")||"expense").toLowerCase();
  if(type.startsWith("ing"))type="income";else if(type.startsWith("egr")||type.startsWith("gas"))type="expense";
  return{date:excelDateToISO(get("Fecha","fecha")),description:String(get("Descripcion","Descripción","descripcion")||"").trim(),amount:Number(get("Monto","monto")||0),type,category:String(get("Categoria","Categoría","categoria")||"").trim(),subcategory:String(get("Subcategoria","Subcategoría","subcategoria")||"").trim(),vat:Number(get("IVA","iva")||0)};
}
function fingerprint(r,accountId){return [r.date,r.type,Number(r.amount).toFixed(2),String(r.description).trim().toLowerCase(),accountId].join("|")}
async function refresh(){
  [accounts,existingTx]=await Promise.all([listAccounts({includeArchived:false}),listTransactions()]);
  document.querySelector("#import-account").innerHTML=accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.bank+" · "+a.alias)}</option>`).join("");
}
document.querySelector("#import-file").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:"array",cellDates:true}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:"",raw:true});
  preview=rows.map(norm).filter(r=>r.date&&r.amount>0);
  const invalid=rows.length-preview.length;
  document.querySelector("#import-preview").innerHTML=`${invalid?`<div class="tf-alert tf-alert-error is-visible">${invalid} fila(s) fueron descartadas por fecha o monto inválido.</div>`:""}<table class="tf-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Monto</th></tr></thead><tbody>${preview.slice(0,30).map(r=>`<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.description)}</td><td>${r.amount}</td></tr>`).join("")}</tbody></table>`;
  document.querySelector("#import-confirm").disabled=!preview.length;
});
document.querySelector("#import-confirm").addEventListener("click",async()=>{
  if(!preview.length)return;
  const accountId=document.querySelector("#import-account").value;
  const known=new Set(existingTx.map(t=>fingerprint(t,t.accountId)));
  const fresh=preview.filter(r=>!known.has(fingerprint(r,accountId)));
  const dup=preview.length-fresh.length;
  if(!fresh.length){toast("Todos los registros parecen duplicados.");return}
  if(!await confirmAction({title:"Importar movimientos",message:`${fresh.length} nuevos · ${dup} duplicados omitidos`,impact:["Se omitirán coincidencias exactas por fecha, tipo, monto, descripción y cuenta."]}))return;
  for(const r of fresh)await saveTransaction({...r,receipt:"",accountId,fromAccountId:null,toAccountId:null,splits:[]});
  toast(`Importación completada: ${fresh.length} movimientos.`);preview=[];document.querySelector("#import-confirm").disabled=true;await refresh();
});
document.querySelector("#export-json").addEventListener("click",async()=>{
  const names=[
    ["accounts",listAccounts],["transactions",listTransactions],["budgets",listBudgets],["monthlyPlans",listMonthlyPlans],["categories",listCategories],
    ["recurring",listRecurring],["goals",listGoals],["liabilities",listLiabilities],["financingPlans",listFinancingPlans],
    ["insurance",listInsurance],["assets",listAssets],["contracts",listContracts],["receivables",listReceivables],
    ["investments",listInvestments],["reconciliations",listReconciliations],
    ["taxPayments",listTaxPayments],["emergencyFund",listEmergencyFund],["auditLog",listAudit]
  ],out={exportedAt:new Date().toISOString(),version:"1.0.28",kind:"data-export"};
  for(const[n,fn]of names)out[n]=await fn();
  downloadText(`tracker-data-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(out,null,2),"application/json");
});
document.querySelector("#export-csv").addEventListener("click",async()=>{
  const tx=await listTransactions(),cols=["date","type","amount","vat","hasInvoice","invoiceNumber","invoiceBase","taxPeriod","vatStatus","taxPaymentId","category","subcategory","description","receipt","accountId","fromAccountId","toAccountId"];
  const text=[cols.join(","),...tx.map(r=>cols.map(c=>csvEscape(r[c])).join(","))].join("\n");
  downloadText(`movimientos-${new Date().toISOString().slice(0,10)}.csv`,text,"text/csv");
});
requireUser(()=>refresh().catch(console.error));
