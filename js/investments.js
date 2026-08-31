import {requireUser} from "./guard.js";
import {listInvestments,listAccounts,atomicWrite} from "./data-service.js";
import {investmentProjection} from "./finance.js";
import {money,escapeHtml,todayISO} from "./utils.js";
import {confirmAction,toast} from "./ui.js";
let rows=[],accounts=[],projection=null;const list=document.querySelector("#inv-list");

function calc(){
  projection=investmentProjection({
    principal:Number(document.querySelector("#inv-principal").value),
    annualRate:Number(document.querySelector("#inv-rate").value),
    rateType:document.querySelector("#inv-rate-type").value,
    startDate:document.querySelector("#inv-start").value||todayISO(),
    termValue:Number(document.querySelector("#inv-term").value),
    termUnit:document.querySelector("#inv-unit").value,
    calculation:document.querySelector("#inv-calc").value,
    capitalization:document.querySelector("#inv-cap").value,
    withholding:Number(document.querySelector("#inv-withholding").value||0),
    fees:Number(document.querySelector("#inv-fees").value||0)
  });
  document.querySelector("#inv-preview-box").innerHTML=`Vence <strong>${projection.maturityDate}</strong> · interés bruto <strong>${money(projection.grossInterest)}</strong> · neto <strong>${money(projection.netInterest)}</strong> · valor esperado <strong>${money(projection.maturityValue)}</strong>`;
}
function render(){
  const active=rows.filter(x=>x.active!==false&&x.status==="active");
  list.innerHTML=active.map(i=>`<div class="tf-card"><strong>${escapeHtml(i.bank)} · ${escapeHtml(i.name)}</strong><div class="tf-account-balance">${money(i.principal)}</div><div class="tf-muted">${i.annualRate}% ${i.rateType==="effective"?"efectiva":"nominal"} · vence ${i.maturityDate}</div><div style="margin:.6rem 0">Rendimiento neto esperado: <strong>${money(i.expectedNetInterest)}</strong></div></div>`).join("")||`<div class="tf-card tf-empty">Sin inversiones activas.</div>`;
  document.querySelector("#settle-investment").innerHTML=active.map(i=>`<option value="${i.id}">${escapeHtml(i.bank+" · "+i.name)}</option>`).join("");
  fillSettlementDefaults();
}
function fillSettlementDefaults(){
  const i=rows.find(x=>x.id===document.querySelector("#settle-investment").value);
  if(!i)return;
  document.querySelector("#settle-principal").value=Number(i.principal||0).toFixed(2);
  document.querySelector("#settle-interest").value=Number(i.expectedNetInterest||0).toFixed(2);
}
async function refresh(){
  [rows,accounts]=await Promise.all([listInvestments(),listAccounts({includeArchived:false})]);
  const bankOptions=accounts.filter(a=>a.accountType!=="credit_card").map(a=>`<option value="${a.id}">${escapeHtml(a.bank+" · "+a.alias)}</option>`).join("");
  document.querySelector("#inv-account").innerHTML=`<option value="">Seleccionar cuenta...</option>`+bankOptions;
  document.querySelector("#settle-account").innerHTML=bankOptions;
  render();
}
document.querySelector("#inv-start").value=todayISO();
document.querySelector("#settle-date").value=todayISO();
document.querySelector("#inv-preview").addEventListener("click",calc);
document.querySelector("#settle-investment").addEventListener("change",fillSettlementDefaults);

document.querySelector("#inv-form").addEventListener("submit",async e=>{
  e.preventDefault();calc();
  const principal=Number(document.querySelector("#inv-principal").value),accountId=document.querySelector("#inv-account").value||null,alreadyMoved=document.querySelector("#inv-already-moved").checked;
  if(!accountId&&!alreadyMoved){toast("Selecciona una cuenta origen o confirma que la salida de capital ya fue registrada.");return}
  const data={
    bank:document.querySelector("#inv-bank").value.trim(),name:document.querySelector("#inv-name").value.trim(),principal,
    annualRate:Number(document.querySelector("#inv-rate").value),rateType:document.querySelector("#inv-rate-type").value,
    calculation:document.querySelector("#inv-calc").value,capitalization:document.querySelector("#inv-cap").value,
    startDate:document.querySelector("#inv-start").value,termValue:Number(document.querySelector("#inv-term").value),
    termUnit:document.querySelector("#inv-unit").value,withholding:Number(document.querySelector("#inv-withholding").value||0),
    fees:Number(document.querySelector("#inv-fees").value||0),maturityDate:projection.maturityDate,
    expectedGrossInterest:projection.grossInterest,expectedNetInterest:projection.netInterest,
    expectedMaturityValue:projection.maturityValue,sourceAccountId:accountId,
    capitalMovementMode:alreadyMoved?"already_registered":"automatic",
    reminderDaysBefore:Number(document.querySelector("#inv-reminder").value||0),status:"active",active:true
  };
  if(!await confirmAction({title:"Crear inversión",message:`Capital ${money(principal)} hasta ${projection.maturityDate}`,impact:[alreadyMoved?"No se creará movimiento: confirmas que ya existe.":"Se registrará salida de capital, no gasto."]}))return;
  const ops=[{collection:"investments",action:"create",auditType:"investment",data}];
  if(!alreadyMoved)ops.push({collection:"transactions",action:"create",auditType:"transaction",data:{type:"investment_out",date:data.startDate,amount:principal,vat:0,receipt:"",description:`Capital invertido: ${data.name}`,category:"",subcategory:"",accountId,fromAccountId:null,toAccountId:null,splits:[]}});
  await atomicWrite(ops);
  e.target.reset();document.querySelector("#inv-start").value=todayISO();toast("Inversión guardada.");await refresh();
});

document.querySelector("#inv-settle-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const i=rows.find(x=>x.id===document.querySelector("#settle-investment").value),accountId=document.querySelector("#settle-account").value;
  if(!i||!accountId)return;
  const date=document.querySelector("#settle-date").value,capital=Number(document.querySelector("#settle-principal").value||0),interest=Number(document.querySelector("#settle-interest").value||0);
  if(!await confirmAction({title:"Liquidar inversión",message:`Retorno ${money(capital)} + rendimiento ${money(interest)}`,impact:["El capital vuelve al banco sin contarse como ingreso.","Solo el rendimiento neto se registra como ingreso financiero.","La inversión quedará liquidada."]}))return;
  const ops=[
    {collection:"investments",id:i.id,action:"update",auditType:"investment",data:{...i,status:"liquidated",active:false,liquidatedAt:date,actualReturnedPrincipal:capital,actualNetInterest:interest,destinationAccountId:accountId}},
    {collection:"transactions",action:"create",auditType:"transaction",data:{type:"investment_return",date,amount:capital,vat:0,receipt:"",description:`Retorno de capital: ${i.name}`,category:"",subcategory:"",accountId,fromAccountId:null,toAccountId:null,splits:[],investmentId:i.id}}
  ];
  if(interest>0)ops.push({collection:"transactions",action:"create",auditType:"transaction",data:{type:"income",date,amount:interest,vat:0,receipt:"",description:`Rendimiento inversión: ${i.name}`,category:"Inversiones",subcategory:"Rendimientos",accountId,fromAccountId:null,toAccountId:null,splits:[],investmentId:i.id}});
  await atomicWrite(ops);toast("Inversión liquidada.");await refresh();
});
requireUser(()=>refresh().catch(console.error));
