import {requireUser} from "./guard.js";
import {
  getEntity,listAccounts,listTransactions,listReconciliations,calculateBalances,atomicWrite
} from "./data-service.js?v=1.0.76";
import {money,escapeHtml} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

const REC_ID="u2XzlnZaKRqXHrucSaRi";
const TX_ID="recurring_u2XzlnZaKRqXHrucSaRi_2026-10";
const OCCURRENCE="2026-10";
const AUDITED_TEMPLATE={
  name:"Quincena 2",type:"income",amount:1298.88,accountId:"eWgNuoKui4Jo57JEjJSS",category:"Sueldo",subcategory:"BDE",dayOfMonth:29
};
const AUDITED_OCCURRENCE={
  type:"income",amount:1298.88,date:"2026-10-30",recurringId:REC_ID,recurringOccurrence:OCCURRENCE,
  accountId:"OQk5cWYP6pXP1HEC6Z9Z",category:"Chauchas",subcategory:"Hidrología - Gring Construc SAS",description:"Quincena 2"
};

const panel=document.querySelector("#mig006-panel");
const body=document.querySelector("#mig006-body");
const statusBox=document.querySelector("#mig006-status");
const keepButton=document.querySelector("#mig006-keep");
const alignButton=document.querySelector("#mig006-align");
let template=null,occurrence=null,accounts=[],transactions=[],reconciliations=[];

const eq=(a,b)=>String(a??"")===String(b??"");
const moneyEq=(a,b)=>Math.abs(Number(a||0)-Number(b||0))<=0.005;
function accountLabel(id){
  const a=accounts.find(x=>x.id===id);
  return a?[a.bank,a.alias].filter(Boolean).join(" · "):(id||"—");
}
function templateSignatureOk(r){
  return !!r && eq(r.name,AUDITED_TEMPLATE.name) && eq(r.type,AUDITED_TEMPLATE.type) && moneyEq(r.amount,AUDITED_TEMPLATE.amount)
    && eq(r.accountId,AUDITED_TEMPLATE.accountId) && eq(r.category,AUDITED_TEMPLATE.category)
    && eq(r.subcategory,AUDITED_TEMPLATE.subcategory) && Number(r.dayOfMonth||0)===AUDITED_TEMPLATE.dayOfMonth;
}
function occurrenceCoreOk(t){
  return !!t && eq(t.id,TX_ID) && eq(t.type,AUDITED_OCCURRENCE.type) && moneyEq(t.amount,AUDITED_OCCURRENCE.amount)
    && eq(t.date,AUDITED_OCCURRENCE.date) && eq(t.recurringId,REC_ID)
    && eq(t.recurringOccurrence,OCCURRENCE) && eq(t.description,AUDITED_OCCURRENCE.description);
}
function isHistoricalAudited(t){
  return occurrenceCoreOk(t) && eq(t.accountId,AUDITED_OCCURRENCE.accountId)
    && eq(t.category,AUDITED_OCCURRENCE.category) && eq(t.subcategory,AUDITED_OCCURRENCE.subcategory);
}
function isAligned(t,r){
  return occurrenceCoreOk(t) && !!r && eq(t.accountId,r.accountId) && eq(t.category,r.category) && eq(t.subcategory,r.subcategory);
}
function resolvedLabel(){
  if(occurrence?.mig006Resolution==="keep_historical")return"Histórico confirmado";
  if(occurrence?.mig006Resolution==="aligned_to_template"||isAligned(occurrence,template))return"Alineada con plantilla";
  return"";
}
function alignedTransactions(){
  return transactions.map(t=>t.id===TX_ID?{...t,accountId:template.accountId,category:template.category,subcategory:template.subcategory}:t);
}
function affectedReconciliations(){
  if(!occurrence||!template)return[];
  const ids=new Set([occurrence.accountId,template.accountId]);
  return reconciliations.filter(r=>r.active!==false && ids.has(r.accountId)
    && ["reconciled","reconciled_with_adjustment"].includes(String(r.status||""))
    && String(r.date||"")>=String(occurrence.date||""));
}
function balanceImpact(){
  const before=calculateBalances(accounts,transactions);
  const after=calculateBalances(accounts,alignedTransactions());
  return [...new Set([occurrence?.accountId,template?.accountId].filter(Boolean))].map(id=>({
    id,before:Number(before[id]||0),after:Number(after[id]||0),delta:Number(after[id]||0)-Number(before[id]||0)
  })).filter(x=>Math.abs(x.delta)>.005);
}
function render(){
  if(!panel)return;
  panel.hidden=false;
  const resolved=resolvedLabel();
  if(resolved){
    body.innerHTML=`<tr><td colspan="4"><strong>${escapeHtml(resolved)}</strong><div class="tf-muted">MIG-006 ya tiene una decisión explícita registrada.</div></td></tr>`;
    statusBox.className="tf-alert tf-alert-success is-visible";
    statusBox.textContent=`MIG-006 resuelta: ${resolved}.`;
    keepButton.hidden=true;alignButton.hidden=true;
    return;
  }
  const safe=templateSignatureOk(template)&&occurrenceCoreOk(occurrence)&&isHistoricalAudited(occurrence);
  const impact=safe?balanceImpact():[];
  const recs=safe?affectedReconciliations():[];
  body.innerHTML=`
    <tr><th>Plantilla actual</th><td>${escapeHtml(accountLabel(template?.accountId))}</td><td>${escapeHtml([template?.category,template?.subcategory].filter(Boolean).join(" · "))}</td><td>${money(template?.amount)}</td></tr>
    <tr><th>Ocurrencia 2026-10</th><td>${escapeHtml(accountLabel(occurrence?.accountId))}</td><td>${escapeHtml([occurrence?.category,occurrence?.subcategory].filter(Boolean).join(" · "))}</td><td>${money(occurrence?.amount)}</td></tr>`;
  keepButton.hidden=false;alignButton.hidden=false;
  keepButton.disabled=!safe;alignButton.disabled=!safe;
  statusBox.className=`tf-alert ${safe?"tf-alert-info":"tf-alert-error"} is-visible`;
  if(!safe){
    statusBox.textContent="MIG-006 bloqueada: la plantilla o la ocurrencia ya no coinciden con el snapshot auditado. No se realizará ninguna corrección automática; requiere reauditoría.";
  }else{
    const impactText=impact.map(x=>`${accountLabel(x.id)} ${x.delta>=0?"+":""}${money(x.delta)}`).join(" · ");
    statusBox.textContent=`Caso auditado confirmado. Conservar histórico no cambia saldos. Alinear con plantilla moverá el ingreso entre cuentas (${impactText||"sin diferencia"})${recs.length?` y marcará ${recs.length} conciliación(es) posterior(es) para revisión.`:"."}`;
  }
}
async function refresh(){
  [template,occurrence,accounts,transactions,reconciliations]=await Promise.all([
    getEntity("recurring",REC_ID),getEntity("transactions",TX_ID),listAccounts(),listTransactions(),listReconciliations()
  ]);
  render();
}

keepButton?.addEventListener("click",async()=>{
  await refresh();
  if(!templateSignatureOk(template)||!isHistoricalAudited(occurrence)){toast("MIG-006 ya no coincide con el caso auditado. Requiere reauditoría.");return;}
  if(!await confirmAction({
    title:"MIG-006 · conservar histórico",
    message:"Quincena 2 · ocurrencia 2026-10",
    impact:[
      `Se conserva la cuenta registrada: ${accountLabel(occurrence.accountId)}.`,
      `Se conserva la clasificación registrada: ${occurrence.category} · ${occurrence.subcategory}.`,
      "No cambia ningún saldo, monto, fecha ni movimiento; solo se registra que la diferencia frente a la plantilla fue confirmada como intencional.",
      "Las ocurrencias futuras siguen usando la plantilla actual salvo que se modifiquen explícitamente al registrarlas."
    ],
    confirmText:"Conservar histórico"
  }))return;
  keepButton.disabled=true;alignButton.disabled=true;
  try{
    await atomicWrite([{
      collection:"transactions",id:TX_ID,action:"update",auditType:"transaction",
      data:{mig006Resolution:"keep_historical"},
      note:"MIG-006 · diferencia recurrente confirmada manualmente; conservar histórico sin alterar datos financieros"
    }]);
    await refresh();toast("MIG-006 resuelta: se conserva el histórico registrado.");
  }catch(err){toast(err?.message||"No se pudo registrar la decisión MIG-006.");await refresh();}
});

alignButton?.addEventListener("click",async()=>{
  await refresh();
  if(!templateSignatureOk(template)||!isHistoricalAudited(occurrence)){toast("MIG-006 ya no coincide con el caso auditado. Requiere reauditoría.");return;}
  const impact=balanceImpact();
  const recs=affectedReconciliations();
  const impactLines=impact.map(x=>`${accountLabel(x.id)}: ${money(x.before)} → ${money(x.after)} (${x.delta>=0?"+":""}${money(x.delta)})`);
  if(!await confirmAction({
    title:"MIG-006 · alinear con plantilla",
    message:"Quincena 2 · ocurrencia 2026-10",
    impact:[
      `Cuenta: ${accountLabel(occurrence.accountId)} → ${accountLabel(template.accountId)}.`,
      `Clasificación: ${occurrence.category} · ${occurrence.subcategory} → ${template.category} · ${template.subcategory}.`,
      ...impactLines,
      recs.length?`${recs.length} conciliación(es) posterior(es) de las cuentas afectadas quedarán en revisión.`:"No se detectaron conciliaciones cerradas posteriores en las cuentas afectadas.",
      "No se modifica monto, fecha, hora, descripción ni vínculo recurringId."
    ],
    danger:true,
    confirmText:"Alinear con plantilla"
  }))return;
  keepButton.disabled=true;alignButton.disabled=true;
  try{
    const ops=[{
      collection:"transactions",id:TX_ID,action:"update",auditType:"transaction",
      data:{accountId:template.accountId,category:template.category,subcategory:template.subcategory,mig006Resolution:"aligned_to_template"},
      note:"MIG-006 · ocurrencia Quincena 2 alineada manualmente con plantilla auditada"
    },...recs.map(r=>({
      collection:"reconciliations",id:r.id,action:"update",auditType:"reconciliation",
      data:{status:"review",reviewReason:"MIG-006 · cambio histórico de cuenta en recurrente Quincena 2"},
      note:"MIG-006 · conciliación marcada para revisión por cambio histórico de cuenta"
    }))];
    await atomicWrite(ops);
    await refresh();toast("MIG-006 resuelta: la ocurrencia quedó alineada con la plantilla.");
  }catch(err){toast(err?.message||"No se pudo aplicar MIG-006.");await refresh();}
});

requireUser(()=>refresh().catch(err=>{
  console.error(err);
  if(panel)panel.hidden=false;
  if(statusBox){statusBox.className="tf-alert tf-alert-error is-visible";statusBox.textContent="No se pudo verificar MIG-006 contra Firebase.";}
  if(keepButton)keepButton.disabled=true;
  if(alignButton)alignButton.disabled=true;
}));
