import {requireUser} from "./guard.js";
import {listAccounts,listTransactions,listReconciliations,calculateBalances,calculateBalanceAtDate,saveAccount,archiveAccount,reactivateAccount} from "./data-service.js?v=1.0.82";
import {money,escapeHtml,accountTypeLabel,todayISO} from "./utils.js";
import {confirmAction,toast} from "./ui.js";
import {institutionDisplay,normalizeInstitutionKey} from "./institutions.js";

let accounts=[];
let transactions=[];
let reconciliations=[];
let balances={};
let editingId=null;
let detailId=null;
let showArchived=false;

const root=document.querySelector("#accounts-root");
const form=document.querySelector("#account-form");
const type=document.querySelector("#account-type");
const editor=document.querySelector("#account-editor");
const detail=document.querySelector("#account-detail");
const newButton=document.querySelector("#account-new");
const archivedToggle=document.querySelector("#account-archived-toggle");

const $=id=>document.querySelector(`#${id}`);
function parseDecimal(value){
  const normalized=String(value??"").trim().replace(/\s+/g,"").replace(",",".");
  if(!normalized)return 0;
  const n=Number(normalized);
  return Number.isFinite(n)?n:NaN;
}
function decimalText(value){
  const n=Number(value||0);
  return Number.isFinite(n)?String(Math.round((n+Number.EPSILON)*100)/100):"0";
}
function sanitizeDecimalInput(input,{allowNegative=true}={}){
  let v=input.value.replace(/,/g,".").replace(/[^0-9.\-]/g,"");
  if(!allowNegative)v=v.replace(/-/g,"");
  else v=v.replace(/(?!^)-/g,"");
  const dot=v.indexOf(".");
  if(dot>=0)v=v.slice(0,dot+1)+v.slice(dot+1).replace(/\./g,"");
  input.value=v;
}
function sanitizeIntegerInput(input,maxLength=2){input.value=input.value.replace(/\D/g,"").slice(0,maxLength)}
function accountKey(a){return a.institutionId?`id:${a.institutionId}`:`legacy:${normalizeInstitutionKey(a.bank)||a.bank}`}
function accountName(a){return `${institutionDisplay(a)} · ${a.alias}`}
function showDialog(node){if(!node)return; if(typeof node.showModal==="function"&&!node.open)node.showModal()}
function closeDialog(node){if(node?.open)node.close()}
function setType(next){type.value=next;toggleType()}
function toggleType(){
  const card=type.value==="credit_card";
  $("credit-fields").hidden=!card;
  $("opening-label").textContent=card?"Deuda inicial":"Saldo inicial";
  document.querySelectorAll("[data-account-type]").forEach(btn=>btn.classList.toggle("is-active",btn.dataset.accountType===type.value));
}
function resetEditor(){
  editingId=null;
  form.reset();
  setType("savings");
  $("opening-balance").value="0";
  $("opening-balance-as-of").value=todayISO();
  $("credit-limit").value="0";
  $("closing-day").value="18";
  $("payment-day").value="5";
  $("card-reminder").value="3";
  $("statement-balance").value="0";
  $("minimum-payment").value="0";
  $("account-editor-title").textContent="Nueva cuenta";
  $("account-submit").textContent="Guardar cuenta";
}
function openNew(){resetEditor();showDialog(editor);$("bank").focus()}
function openEdit(a){
  if(!a)return;
  editingId=a.id;
  $("account-editor-title").textContent="Editar cuenta";
  $("account-submit").textContent="Guardar cambios";
  $("bank").value=a.bank||"";
  $("alias").value=a.alias||"";
  $("last4").value=String(a.last4||"").replace(/\D/g,"").slice(-4);
  setType(a.accountType||"savings");
  $("opening-balance").value=decimalText(a.accountType==="credit_card"?Math.abs(Number(a.openingBalance||0)):a.openingBalance||0);
  $("opening-balance-as-of").value=a.ledgerStartDate||a.openingBalanceAsOf||todayISO();
  $("credit-limit").value=decimalText(a.creditLimit||0);
  $("closing-day").value=String(a.closingDay||18);
  $("payment-day").value=String(a.paymentDay||5);
  $("card-reminder").value=String(a.reminderDaysBefore??3);
  $("statement-balance").value=decimalText(a.statementBalance||0);
  $("minimum-payment").value=decimalText(a.minimumPayment||0);
  closeDialog(detail);
  showDialog(editor);
}

function reconciliationMeta(accountId){
  const rows=reconciliations.filter(r=>r.accountId===accountId&&r.active!==false&&r.status!=="voided");
  const valid=rows.filter(r=>["reconciled","reconciled_with_adjustment"].includes(r.status)).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
  const attention=rows.filter(r=>["review","reopened","needs_review"].includes(r.status)).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
  const account=accounts.find(a=>a.id===accountId);
  const currentAtCut=valid&&account?calculateBalanceAtDate(account,transactions,valid.date):null;
  const drift=valid&&currentAtCut!==null&&Math.abs(Number(currentAtCut)-Number(valid.bankBalance||0))>=0.01;
  return {valid,attention,drift,currentAtCut};
}
function reconciliationText(a){
  const {valid,attention,drift}=reconciliationMeta(a.id);
  if(drift)return "Revisar conciliación";
  if(attention&&(!valid||String(attention.date)>=String(valid.date)))return `Revisión ${attention.date}`;
  if(valid)return `Conciliada ${valid.date}`;
  return "Sin conciliación";
}
function balanceCell(a){
  const bal=Number(balances[a.id]??a.openingBalance??0);
  if(a.accountType!=="credit_card")return `<strong>${money(bal)}</strong>`;
  const debt=Math.max(0,-bal),available=Math.max(0,Number(a.creditLimit||0)-debt);
  return `<strong class="${debt>0?"tf-negative":""}">Deuda ${money(debt)}</strong><div class="tf-muted">Disponible ${money(available)}</div>`;
}
function render(){
  const archivedCount=accounts.filter(a=>a.active===false).length;
  archivedToggle.hidden=!archivedCount;
  archivedToggle.textContent=showArchived?"Ver activas":`Archivadas (${archivedCount})`;
  newButton.hidden=showArchived;
  const visible=accounts.filter(a=>showArchived?a.active===false:a.active!==false);
  const groups=[...new Set(visible.map(accountKey))].sort((x,y)=>{
    const ax=visible.find(a=>accountKey(a)===x),ay=visible.find(a=>accountKey(a)===y);
    return institutionDisplay(ax).localeCompare(institutionDisplay(ay),"es");
  });
  root.innerHTML=groups.map(group=>{
    const rows=visible.filter(a=>accountKey(a)===group).sort((a,b)=>String(a.alias).localeCompare(String(b.alias),"es"));
    const bank=institutionDisplay(rows[0]);
    return `<section class="tf-bank-list-section">
      <div class="tf-bank-list-heading"><div><div class="tf-section-kicker">Institución</div><h2>${escapeHtml(bank)}</h2></div><span class="tf-pill">${rows.length} ${showArchived?"archivada(s)":"cuenta(s)"}</span></div>
      <div class="tf-table-wrap"><table class="tf-table tf-account-list-table">
        <thead><tr><th>Alias</th><th>Tipo</th><th>Últimos 4</th><th>Saldo actual</th><th>Fecha base</th><th>Conciliación</th><th aria-label="Información"></th></tr></thead>
        <tbody>${rows.map(a=>`<tr>
          <td><strong>${escapeHtml(a.alias)}</strong></td>
          <td>${escapeHtml(accountTypeLabel(a.accountType))}</td>
          <td>${a.last4?`•••• ${escapeHtml(a.last4)}`:"—"}</td>
          <td>${balanceCell(a)}</td>
          <td>${escapeHtml(a.ledgerStartDate||a.openingBalanceAsOf||"—")}</td>
          <td>${escapeHtml(reconciliationText(a))}</td>
          <td class="tf-account-info-cell"><button class="tf-icon-btn" type="button" data-info="${a.id}" aria-label="Ver información de ${escapeHtml(a.alias)}" title="Información">ⓘ</button></td>
        </tr>`).join("")}</tbody>
      </table></div>
    </section>`;
  }).join("")||`<div class="tf-card tf-empty">${showArchived?"Sin cuentas archivadas.":"Registra tu primera cuenta."}</div>`;
}
function renderDetail(a){
  if(!a)return;
  detailId=a.id;
  $("account-detail-title").textContent=accountName(a);
  const bal=Number(balances[a.id]??a.openingBalance??0),card=a.accountType==="credit_card",debt=card?Math.max(0,-bal):0,available=card?Math.max(0,Number(a.creditLimit||0)-debt):null;
  const {valid,attention,drift,currentAtCut}=reconciliationMeta(a.id);
  const attentionIsNewer=attention&&(!valid||String(attention.date)>=String(valid.date));
  const needsAttention=attentionIsNewer||drift;
  $("account-detail-body").innerHTML=`<article class="tf-account-card tf-account-detail-card ${a.active===false?"is-archived":""}">
    <div class="tf-account-name">${escapeHtml(a.alias)}</div>
    <div class="tf-account-meta">${escapeHtml(institutionDisplay(a))} · ${escapeHtml(accountTypeLabel(a.accountType))}${a.last4?` · •${escapeHtml(a.last4)}`:""}</div>
    <div class="tf-account-balance ${card&&debt>0?"tf-negative":""}">${card?`Deuda ${money(debt)}`:money(bal)}</div>
    <div class="tf-account-detail-grid">
      <div><span>Fecha base</span><strong>${escapeHtml(a.ledgerStartDate||a.openingBalanceAsOf||"—")}</strong></div>
      <div><span>Saldo inicial</span><strong>${money(a.accountType==="credit_card"?Math.abs(Number(a.openingBalance||0)):a.openingBalance||0)}</strong></div>
      ${card?`<div><span>Cupo</span><strong>${money(a.creditLimit||0)}</strong></div><div><span>Disponible</span><strong>${money(available)}</strong></div><div><span>Corte</span><strong>${a.closingDay||"—"}</strong></div><div><span>Pago</span><strong>${a.paymentDay||"—"}</strong></div><div><span>Saldo estado</span><strong>${money(a.statementBalance||0)}</strong></div><div><span>Pago mínimo</span><strong>${money(a.minimumPayment||0)}</strong></div>`:""}
    </div>
    <div class="tf-account-reconciliation">
      ${valid?`<div><strong>Última conciliación</strong><br>${escapeHtml(valid.date)} · saldo conciliado ${money(valid.bankBalance)}</div>`:`<div class="tf-muted">Sin conciliaciones válidas.</div>`}
      ${needsAttention?`<div class="tf-account-reconciliation-warning">⚠ ${drift?`El saldo actual al corte es ${money(currentAtCut)}; recalcula la conciliación.`:`Requiere revisión desde ${escapeHtml(attention.date)}`}</div>`:valid?`<div class="tf-account-reconciliation-ok">✓ Conciliada hasta ${escapeHtml(valid.date)}</div>`:""}
    </div>
    <div class="tf-actions" style="margin-top:1rem">
      <a class="tf-btn tf-btn-secondary" href="movimientos.html?account=${a.id}">Movimientos</a>
      ${a.active===false
        ? `<button class="tf-btn tf-btn-primary" data-detail-reactivate="${a.id}" type="button">Reactivar</button>`
        : `<a class="tf-btn tf-btn-secondary" href="conciliacion.html?account=${a.id}">Conciliación</a>${card?`<a class="tf-btn tf-btn-secondary" href="deudas.html?card=${a.id}">Planes</a>`:""}<button class="tf-btn tf-btn-primary" data-detail-edit="${a.id}" type="button">Editar</button><button class="tf-btn tf-btn-secondary" data-detail-archive="${a.id}" type="button">Archivar</button>`}
    </div>
  </article>`;
  showDialog(detail);
}
async function refresh(){
  [accounts,transactions,reconciliations]=await Promise.all([listAccounts(),listTransactions(),listReconciliations()]);
  balances=calculateBalances(accounts,transactions);
  render();
  if(detail.open&&detailId){const current=accounts.find(a=>a.id===detailId);if(current)renderDetail(current);else closeDialog(detail)}
}

newButton.addEventListener("click",openNew);
archivedToggle.addEventListener("click",()=>{showArchived=!showArchived;closeDialog(detail);render()});
$("account-editor-close").addEventListener("click",()=>{closeDialog(editor);resetEditor()});
$("account-cancel").addEventListener("click",()=>{closeDialog(editor);resetEditor()});
$("account-detail-close").addEventListener("click",()=>closeDialog(detail));
document.querySelectorAll("[data-account-type]").forEach(btn=>btn.addEventListener("click",()=>setType(btn.dataset.accountType)));
$("last4").addEventListener("input",e=>sanitizeIntegerInput(e.currentTarget,4));
for(const id of ["closing-day","payment-day","card-reminder"]){$(id).addEventListener("input",e=>sanitizeIntegerInput(e.currentTarget,2))}
for(const id of ["opening-balance","credit-limit","statement-balance","minimum-payment"]){$(id).addEventListener("input",e=>sanitizeDecimalInput(e.currentTarget,{allowNegative:id==="opening-balance"}))}

form.addEventListener("submit",async e=>{
  e.preventDefault();
  const bankValue=$("bank").value.trim(),alias=$("alias").value.trim(),last4=$("last4").value.trim();
  const openingInput=parseDecimal($("opening-balance").value);
  const openingDate=$("opening-balance-as-of").value;
  if(!bankValue||!alias){toast("Completa banco / institución y alias.");return}
  if(last4&&!/^\d{1,4}$/.test(last4)){toast("Los últimos 4 dígitos deben contener solo números.");return}
  if(!Number.isFinite(openingInput)){toast("Ingresa un saldo inicial válido.");return}
  if(!openingDate){toast("Selecciona la fecha base del saldo inicial.");return}
  const old=editingId?accounts.find(x=>x.id===editingId):null;
  const preserveInstitution=old&&normalizeInstitutionKey(bankValue)===normalizeInstitutionKey(old.bank);
  let opening=openingInput;
  if(type.value==="credit_card")opening=-Math.abs(openingInput);
  const creditLimit=parseDecimal($("credit-limit").value),statementBalance=parseDecimal($("statement-balance").value),minimumPayment=parseDecimal($("minimum-payment").value);
  if(type.value==="credit_card"&&![creditLimit,statementBalance,minimumPayment].every(Number.isFinite)){toast("Revisa los valores de la tarjeta.");return}
  const closingRaw=$("closing-day").value.trim(),paymentRaw=$("payment-day").value.trim(),reminderRaw=$("card-reminder").value.trim();
  const closingDay=closingRaw===""?null:Number(closingRaw),paymentDay=paymentRaw===""?null:Number(paymentRaw),reminder=reminderRaw===""?null:Number(reminderRaw);
  if(type.value==="credit_card"&&(!Number.isInteger(closingDay)||closingDay<1||closingDay>31)){toast("El día de corte debe estar entre 1 y 31.");return}
  if(type.value==="credit_card"&&(!Number.isInteger(paymentDay)||paymentDay<1||paymentDay>31)){toast("El día de pago debe estar entre 1 y 31.");return}
  if(type.value==="credit_card"&&(reminder!==null&&(!Number.isInteger(reminder)||reminder<0||reminder>30))){toast("El recordatorio debe estar entre 0 y 30 días.");return}
  const data={
    bank:bankValue,
    institutionId:preserveInstitution?(old.institutionId||null):null,
    institutionDisplayName:preserveInstitution?(old.institutionDisplayName||null):null,
    institutionIdentitySource:preserveInstitution?(old.institutionIdentitySource||""):"",
    alias,accountType:type.value,last4,openingBalance:opening,openingBalanceAsOf:openingDate,ledgerStartDate:openingDate,
    openingBalanceDateSource:old?.openingBalanceDateSource||"user_defined",active:old?.active!==false,
    creditLimit:type.value==="credit_card"?Math.max(0,creditLimit):0,
    closingDay:type.value==="credit_card"?closingDay:null,
    paymentDay:type.value==="credit_card"?paymentDay:null,
    reminderDaysBefore:type.value==="credit_card"?reminder:null,
    statementBalance:type.value==="credit_card"?Math.max(0,statementBalance):0,
    minimumPayment:type.value==="credit_card"?Math.max(0,minimumPayment):0
  };
  if(editingId){
    const impact=[];
    if(Number(old.openingBalance)!==Number(data.openingBalance))impact.push("Recalculará saldo y patrimonio.");
    if(old.accountType!==data.accountType)impact.push("Cambiará la interpretación patrimonial.");
    if((old.ledgerStartDate||old.openingBalanceAsOf||"")!==openingDate)impact.push("Cambiará desde qué fecha los movimientos afectan el saldo.");
    const ok=await confirmAction({title:"Actualizar cuenta",message:accountName(old),impact,confirmText:"Guardar cambios"});
    if(!ok)return;
  }
  await saveAccount(data,editingId);
  toast(editingId?"Cuenta actualizada.":"Cuenta creada.");
  closeDialog(editor);resetEditor();await refresh();
});

root.addEventListener("click",e=>{
  const btn=e.target.closest("[data-info]");
  if(!btn)return;
  renderDetail(accounts.find(a=>a.id===btn.dataset.info));
});
$("account-detail-body").addEventListener("click",async e=>{
  const ed=e.target.closest("[data-detail-edit]"),ar=e.target.closest("[data-detail-archive]"),re=e.target.closest("[data-detail-reactivate]");
  if(ed){openEdit(accounts.find(a=>a.id===ed.dataset.detailEdit));return}
  if(ar){
    const a=accounts.find(x=>x.id===ar.dataset.detailArchive);
    if(a&&await confirmAction({title:"Archivar cuenta",message:accountName(a),impact:["Se conserva todo su historial y sus referencias en otros módulos."],confirmText:"Archivar"})){
      await archiveAccount(a.id);closeDialog(detail);await refresh();toast("Cuenta archivada.");
    }
    return;
  }
  if(re){await reactivateAccount(re.dataset.detailReactivate);closeDialog(detail);await refresh();toast("Cuenta reactivada.")}
});

resetEditor();
requireUser(()=>refresh().catch(err=>{console.error(err);toast("No se pudieron cargar las cuentas.")}));
