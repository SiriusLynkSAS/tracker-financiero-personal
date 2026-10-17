import {requireUser} from "./guard.js";
import {
  listAccounts,listTransactions,calculateBalanceAtDate,listReconciliations,listCategories,
  createReconciliation,recoverLostPeriod,resolveReconciliation,editReconciliation,
  reopenReconciliation,voidReconciliation,recalculateReconciliation,
  classifyReconciliationAdjustment,resetReconciliationClassification
} from "./data-service.js";
import {money,escapeHtml,todayISO} from "./utils.js";
import {categoriesForType,subcategoriesFor} from "./category-catalog.js";
import {confirmAction,toast} from "./ui.js";

let accounts=[],txs=[],rows=[],categories=[];
let editingId="",classifyingId="";
const tbody=document.querySelector("#recn-body");

const statusLabel={
  review:"Pendiente de revisión",
  reopened:"Reabierta",
  needs_review:"Requiere revisión",
  reconciled:"Conciliada",
  reconciled_with_adjustment:"Conciliada con ajuste",
  voided:"Eliminada / revertida"
};
const classificationLabel={
  none:"—",
  unclassified:"Sin clasificar",
  partial:"Parcial",
  classified:"Completa"
};

function name(id){
  const a=accounts.find(x=>x.id===id);
  return a?`${a.bank} · ${a.alias}`:"—";
}
function options(){
  return accounts.map(a=>`<option value="${a.id}">${escapeHtml(name(a.id))}</option>`).join("");
}
function adjustmentFor(row){
  return row?.adjustmentTransactionId
    ? txs.find(t=>t.id===row.adjustmentTransactionId)
    : null;
}
function pendingClassification(tx){
  if(!tx) return 0;
  const splits=Array.isArray(tx.splits)?tx.splits:[];
  if(!splits.length){
    return tx.category==="Por clasificar"?Number(tx.amount||0):0;
  }
  return splits.filter(x=>x.category==="Por clasificar").reduce((a,x)=>a+Number(x.amount||0),0);
}
function signedAdjustment(row){
  if(!row.adjustmentTransactionId) return 0;
  const tx=adjustmentFor(row);
  if(tx) return tx.type==="expense"?-Number(tx.amount||0):Number(tx.amount||0);
  return Number(row.differenceBefore||0);
}
function statusClass(row){
  if(row.status==="voided") return "tf-pill";
  if(["reconciled","reconciled_with_adjustment"].includes(row.status)) return "tf-pill tf-pill-ok";
  if(row.status==="needs_review") return "tf-pill tf-pill-warn";
  return "tf-pill tf-pill-danger";
}
function classificationStatus(row){
  const tx=adjustmentFor(row);
  return tx?.classificationStatus || row.classificationStatus || (row.adjustmentTransactionId?"unclassified":"none");
}
function actionButtons(row){
  if(row.active===false || row.status==="voided"){
    return `<span class="tf-muted">Revertida</span>`;
  }
  const reviewish=["review","reopened","needs_review"].includes(row.status);
  const reconciled=["reconciled","reconciled_with_adjustment"].includes(row.status);
  return `
    <div class="tf-actions tf-actions-wrap">
      <button class="tf-btn tf-btn-secondary" data-edit-recn="${row.id}">Editar</button>
      <button class="tf-btn tf-btn-secondary" data-recalc-recn="${row.id}">Recalcular</button>
      ${reviewish?`<button class="tf-btn tf-btn-primary" data-resolve-recn="${row.id}">Ajustar diferencia</button>`:""}
      ${reconciled?`<button class="tf-btn tf-btn-secondary" data-reopen-recn="${row.id}">Reabrir</button>`:""}
      ${row.adjustmentTransactionId&&classificationStatus(row)!=="unclassified"?`<button class="tf-btn tf-btn-secondary" data-reset-classification="${row.id}">Reiniciar clasificación</button>`:""}
      <button class="tf-btn tf-btn-danger" data-void-recn="${row.id}">Eliminar y revertir</button>
    </div>`;
}
function renderHistory(){
  tbody.innerHTML=rows.map(r=>{
    const cls=classificationStatus(r);
    return `
      <tr class="${r.active===false?"is-muted":""}">
        <td>
          ${escapeHtml(r.date)}
          <div class="tf-muted">${r.mode==="recovery"?"Recuperación":"Normal"}</div>
        </td>
        <td>${escapeHtml(name(r.accountId))}</td>
        <td>${money(r.trackerBalanceBefore)}</td>
        <td>${money(r.bankBalance)}</td>
        <td class="${signedAdjustment(r)<-.009?"tf-negative":""}">${r.adjustmentTransactionId?money(signedAdjustment(r)):"—"}</td>
        <td>${money(r.trackerBalanceAfter)}</td>
        <td>
          <span class="${statusClass(r)}">${escapeHtml(statusLabel[r.status]||r.status)}</span>
          ${r.reviewReason?`<div class="tf-muted">${escapeHtml(r.reviewReason)}</div>`:""}
        </td>
        <td><span class="tf-pill">${escapeHtml(classificationLabel[cls]||cls)}</span></td>
        <td>${actionButtons(r)}</td>
      </tr>`;
  }).join("")||`<tr><td colspan="9" class="tf-empty">Sin conciliaciones.</td></tr>`;
}
function renderAdjustments(){
  const unresolved=rows
    .filter(r=>r.active!==false && r.adjustmentTransactionId)
    .map(r=>({r,tx:adjustmentFor(r)}))
    .filter(x=>x.tx && pendingClassification(x.tx)>.009);

  document.querySelector("#recover-adjustments").innerHTML=unresolved.map(({r,tx})=>{
    const pending=pendingClassification(tx);
    const classified=Math.max(0,Number(tx.amount||0)-pending);
    return `
      <div class="tf-summary-row tf-reconciliation-adjustment">
        <span>
          <strong>${escapeHtml(name(r.accountId))} · ${escapeHtml(r.date)}</strong><br>
          <small class="tf-muted">
            ${tx.type==="expense"?"Salida":"Entrada"} ${money(tx.amount)} · clasificado ${money(classified)} · pendiente ${money(pending)}
          </small>
        </span>
        <span class="tf-actions">
          <button class="tf-btn tf-btn-primary" data-classify-recn="${r.id}">Reclasificar</button>
        </span>
      </div>`;
  }).join("")||`<div class="tf-empty">No hay ajustes pendientes de clasificar.</div>`;
}
function render(){
  renderHistory();
  renderAdjustments();
}
async function refresh(){
  [accounts,txs,rows,categories]=await Promise.all([
    listAccounts({includeArchived:false}),listTransactions(),listReconciliations(),listCategories()
  ]);
  const opts=options();
  document.querySelector("#recn-account").innerHTML=opts;
  document.querySelector("#recover-account").innerHTML=opts;
  render();
}

document.querySelector("#recn-date").value=todayISO();
document.querySelector("#recover-end").value=todayISO();

document.querySelector("#recn-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const accountId=document.querySelector("#recn-account").value;
  const date=document.querySelector("#recn-date").value;
  const bankBalance=Number(document.querySelector("#recn-bank-balance").value);
  const note=document.querySelector("#recn-note").value.trim();
  const account=accounts.find(a=>a.id===accountId);
  const tracker=calculateBalanceAtDate(account,txs,date);
  const diff=bankBalance-tracker;
  document.querySelector("#recn-result").innerHTML=
    `Antes: <strong>${money(tracker)}</strong> · banco: <strong>${money(bankBalance)}</strong> · diferencia: <strong>${money(diff)}</strong>`;

  if(!await confirmAction({
    title:"Registrar conciliación",
    message:`${name(accountId)} · ${date}`,
    impact:[
      Math.abs(diff)<.01
        ?"La cuenta quedará conciliada sin ajuste."
        :"La diferencia quedará pendiente hasta que revises movimientos o crees un ajuste por clasificar."
    ]
  })) return;

  await createReconciliation({accountId,date,bankBalance,note});
  e.target.reset();
  document.querySelector("#recn-date").value=todayISO();
  toast("Conciliación registrada.");
  await refresh();
});

document.querySelector("#recover-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const accountId=document.querySelector("#recover-account").value;
  const startDate=document.querySelector("#recover-start").value;
  const endDate=document.querySelector("#recover-end").value;
  const bankBalance=Number(document.querySelector("#recover-bank-balance").value);
  const note=document.querySelector("#recover-note").value.trim();
  if(!startDate||!endDate||startDate>endDate){toast("Revisa las fechas del período.");return}
  const account=accounts.find(x=>x.id===accountId);
  const tracker=calculateBalanceAtDate(account,txs,endDate);
  const diff=bankBalance-tracker;
  document.querySelector("#recover-preview").innerHTML=
    `Antes: <strong>${money(tracker)}</strong> · saldo real: <strong>${money(bankBalance)}</strong> · ajuste necesario: <strong>${money(diff)}</strong>`;

  if(!await confirmAction({
    title:"Recuperar período perdido",
    message:`${startDate} a ${endDate} · diferencia ${money(diff)}`,
    impact:[
      Math.abs(diff)<.01?"No hace falta crear ajuste.":"Se creará un solo movimiento Por clasificar por la diferencia.",
      "No se inventarán gastos individuales.",
      "El saldo después de conciliar coincidirá con el saldo real."
    ],
    confirmText:"Recuperar"
  }))return;

  const result=await recoverLostPeriod({accountId,startDate,endDate,bankBalance,note});
  toast(result.adjustmentTransactionId?"Período recuperado con ajuste por clasificar.":"La cuenta ya coincidía.");
  e.target.reset();
  document.querySelector("#recover-end").value=todayISO();
  await refresh();
});

function openEdit(row){
  editingId=row.id;
  document.querySelector("#recn-edit-title").textContent=`${name(row.accountId)} · ${row.date}`;
  document.querySelector("#recn-edit-account").value=name(row.accountId);
  document.querySelector("#recn-edit-date").value=row.date;
  document.querySelector("#recn-edit-bank").value=Number(row.bankBalance||0);
  document.querySelector("#recn-edit-note").value=row.note||"";
  const wrap=document.querySelector("#recn-edit-recovery-wrap");
  wrap.hidden=row.mode!=="recovery";
  document.querySelector("#recn-edit-recovery-start").value=row.recoveryStart||"";
  document.querySelector("#recn-edit-dialog").showModal();
}
function closeEdit(){editingId="";document.querySelector("#recn-edit-dialog").close()}
document.querySelectorAll("[data-close-edit]").forEach(b=>b.addEventListener("click",closeEdit));
document.querySelector("#recn-edit-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const row=rows.find(x=>x.id===editingId);if(!row)return;
  const date=document.querySelector("#recn-edit-date").value;
  const bankBalance=Number(document.querySelector("#recn-edit-bank").value);
  const note=document.querySelector("#recn-edit-note").value.trim();
  const recoveryStart=document.querySelector("#recn-edit-recovery-start").value||null;

  if(!await confirmAction({
    title:"Editar conciliación",
    message:`${name(row.accountId)} · ${row.date} → ${date}`,
    impact:[
      "El ajuste vinculado se recalculará sin tocar otros movimientos reales.",
      "Si cambia el monto del ajuste, se reiniciará su clasificación.",
      "Las conciliaciones posteriores afectadas quedarán marcadas para revisión."
    ]
  }))return;

  try{
    await editReconciliation(row.id,{date,bankBalance,note,recoveryStart});
    closeEdit();toast("Conciliación actualizada.");await refresh();
  }catch(err){toast(err?.message||"No se pudo editar la conciliación.")}
});

function fillClassifySubs(){
  const row=rows.find(x=>x.id===classifyingId);
  const tx=adjustmentFor(row);
  if(!tx)return;
  const cat=document.querySelector("#recn-classify-category").value;
  const subs=subcategoriesFor(categories,tx.type==="income"?"income":"expense",cat);
  document.querySelector("#recn-classify-subcategory").innerHTML=subs.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
}
function openClassify(row){
  const tx=adjustmentFor(row);if(!tx)return;
  classifyingId=row.id;
  const pending=pendingClassification(tx);
  document.querySelector("#recn-classify-title").textContent=`${name(row.accountId)} · ${row.date}`;
  document.querySelector("#recn-classify-summary").innerHTML=
    `Ajuste total <strong>${money(tx.amount)}</strong> · pendiente por clasificar <strong>${money(pending)}</strong>`;
  const type=tx.type==="income"?"income":"expense";
  const cats=categoriesForType(categories,type).filter(v=>v!=="Por clasificar");
  document.querySelector("#recn-classify-category").innerHTML=cats.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  fillClassifySubs();
  const input=document.querySelector("#recn-classify-amount");
  input.value=pending.toFixed(2);
  input.max=pending.toFixed(2);
  document.querySelector("#recn-classify-dialog").showModal();
}
function closeClassify(){classifyingId="";document.querySelector("#recn-classify-dialog").close()}
document.querySelectorAll("[data-close-classify]").forEach(b=>b.addEventListener("click",closeClassify));
document.querySelector("#recn-classify-category").addEventListener("change",fillClassifySubs);
document.querySelector("#recn-classify-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const category=document.querySelector("#recn-classify-category").value;
  const subcategory=document.querySelector("#recn-classify-subcategory").value;
  const amount=Number(document.querySelector("#recn-classify-amount").value);
  try{
    await classifyReconciliationAdjustment(classifyingId,{category,subcategory,amount});
    closeClassify();toast("Ajuste reclasificado sin cambiar el saldo.");await refresh();
  }catch(err){toast(err?.message||"No se pudo reclasificar.")}
});

tbody.addEventListener("click",async e=>{
  const edit=e.target.closest("[data-edit-recn]");
  const resolve=e.target.closest("[data-resolve-recn]");
  const reopen=e.target.closest("[data-reopen-recn]");
  const recalc=e.target.closest("[data-recalc-recn]");
  const resetClass=e.target.closest("[data-reset-classification]");
  const voidBtn=e.target.closest("[data-void-recn]");
  if(edit){const row=rows.find(x=>x.id===edit.dataset.editRecn);if(row)openEdit(row);return}
  if(resolve){
    const row=rows.find(x=>x.id===resolve.dataset.resolveRecn);if(!row)return;
    if(await confirmAction({
      title:"Ajustar diferencia",
      message:`Diferencia actual ${money(row.differenceAfter)}`,
      impact:[
        "Se creará o recalculará un único ajuste Por clasificar.",
        "El saldo después de la conciliación coincidirá con el banco.",
        "Las conciliaciones posteriores quedarán para revisión."
      ],
      confirmText:"Ajustar"
    })){
      try{await resolveReconciliation(row.id);toast("Diferencia ajustada.");await refresh()}
      catch(err){toast(err?.message||"No se pudo resolver la diferencia.")}
    }
    return;
  }
  if(reopen){
    const row=rows.find(x=>x.id===reopen.dataset.reopenRecn);if(!row)return;
    if(await confirmAction({
      title:"Reabrir conciliación",
      message:`${name(row.accountId)} · ${row.date}`,
      impact:["El ajuste actual se conservará mientras revisas.","Las conciliaciones posteriores quedarán marcadas para revisión."],
      confirmText:"Reabrir"
    })){
      await reopenReconciliation(row.id);toast("Conciliación reabierta.");await refresh();
    }
    return;
  }
  if(recalc){
    const row=rows.find(x=>x.id===recalc.dataset.recalcRecn);if(!row)return;
    try{await recalculateReconciliation(row.id);toast("Conciliación recalculada.");await refresh()}
    catch(err){toast(err?.message||"No se pudo recalcular.")}
    return;
  }
  if(resetClass){
    const row=rows.find(x=>x.id===resetClass.dataset.resetClassification);if(!row)return;
    if(await confirmAction({
      title:"Reiniciar clasificación",
      message:`${name(row.accountId)} · ${row.date}`,
      impact:["El ajuste completo volverá a Por clasificar.","El saldo de la cuenta no cambiará."],
      confirmText:"Reiniciar"
    })){
      try{await resetReconciliationClassification(row.id);toast("Clasificación reiniciada.");await refresh()}
      catch(err){toast(err?.message||"No se pudo reiniciar la clasificación.")}
    }
    return;
  }
  if(voidBtn){
    const row=rows.find(x=>x.id===voidBtn.dataset.voidRecn);if(!row)return;
    if(await confirmAction({
      title:"Eliminar y revertir conciliación",
      message:`${name(row.accountId)} · ${row.date}`,
      impact:[
        row.adjustmentTransactionId?`Se revertirá el ajuste vinculado de ${money(Math.abs(signedAdjustment(row)))}.`:"No existe ajuste vinculado que revertir.",
        "Los demás movimientos reales no se modificarán.",
        "Las conciliaciones posteriores quedarán marcadas para revisión.",
        "La auditoría conservará el historial de la eliminación."
      ],
      danger:true,
      confirmText:"Eliminar y revertir"
    })){
      try{await voidReconciliation(row.id);toast("Conciliación revertida.");await refresh()}
      catch(err){toast(err?.message||"No se pudo revertir la conciliación.")}
    }
  }
});

document.querySelector("#recover-adjustments").addEventListener("click",e=>{
  const button=e.target.closest("[data-classify-recn]");
  if(!button)return;
  const row=rows.find(x=>x.id===button.dataset.classifyRecn);
  if(row)openClassify(row);
});

requireUser(()=>refresh().catch(err=>{console.error(err);toast("No se pudo cargar Conciliación.");}));
