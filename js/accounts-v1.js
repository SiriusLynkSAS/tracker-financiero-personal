import {requireUser} from "./guard.js";import {listAccounts,listTransactions,listReconciliations,calculateBalances,calculateBalanceAtDate,saveAccount,archiveAccount,reactivateAccount,atomicWrite} from "./data-service.js";import {money,escapeHtml,accountTypeLabel,todayISO} from "./utils.js";import {confirmAction,toast} from "./ui.js";import {institutionDisplay,normalizeInstitutionKey} from "./institutions.js";
let accounts=[],transactions=[],reconciliations=[],balances={},editingId=null,showArchived=false;
const form=document.querySelector("#account-form"),root=document.querySelector("#accounts-root"),type=document.querySelector("#account-type");
const editor=document.querySelector("#account-editor"),newButton=document.querySelector("#account-new"),archivedToggle=document.querySelector("#account-archived-toggle");
const mig002Panel=document.querySelector("#mig002-panel"),mig002Body=document.querySelector("#mig002-body"),mig002Apply=document.querySelector("#mig002-apply"),mig002Warning=document.querySelector("#mig002-warning");
function toggle(){const card=type.value==="credit_card";document.querySelector("#credit-fields").hidden=!card;document.querySelector("#opening-label").textContent=card?"Deuda inicial ($)":"Saldo inicial ($)"}
function closeEditor(){editor.hidden=true;editingId=null}
function reset(){editingId=null;form.reset();type.value="savings";document.querySelector("#opening-balance").value=0;document.querySelector("#opening-balance-as-of").value=todayISO();document.querySelector("#account-cancel").hidden=true;document.querySelector("#account-submit").textContent="Guardar cuenta";document.querySelector("#account-editor-title").textContent="Nueva cuenta";toggle()}
function openNew(){reset();editor.hidden=false;document.querySelector("#bank").focus()}

function dateFromTimestamp(value){
  if(!value)return "";
  if(typeof value.toDate==="function")return value.toDate().toISOString().slice(0,10);
  if(Number.isFinite(Number(value.seconds)))return new Date(Number(value.seconds)*1000).toISOString().slice(0,10);
  const s=String(value);return /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):"";
}
function touchesAccount(tx,id){return tx.accountId===id||tx.fromAccountId===id||tx.toAccountId===id}
function firstTransactionDate(id){return transactions.filter(t=>touchesAccount(t,id)&&/^\d{4}-\d{2}-\d{2}$/.test(String(t.date||""))).map(t=>String(t.date)).sort()[0]||""}
function suggestedLedgerDate(a){
  const dates=[dateFromTimestamp(a.createdAt),firstTransactionDate(a.id)].filter(Boolean).sort();
  return dates[0]||todayISO();
}
function renderMig002(){
  const legacy=accounts.filter(a=>a.legacyOpeningBalanceAsOfMissing);
  mig002Panel.hidden=!legacy.length;
  if(!legacy.length)return;
  const prior=legacy.filter(a=>{const created=dateFromTimestamp(a.createdAt),first=firstTransactionDate(a.id);return created&&first&&first<created});
  mig002Warning.hidden=!prior.length;
  if(prior.length)mig002Warning.textContent=`${prior.length} cuenta(s) tienen movimientos anteriores a su fecha de creación. La propuesta usa la fecha más antigua para no excluir movimientos históricos.`;
  mig002Body.innerHTML=legacy.map(a=>{
    const created=dateFromTimestamp(a.createdAt)||"—",first=firstTransactionDate(a.id)||"—",suggested=suggestedLedgerDate(a);
    const note=first!=="—"&&created!=="—"&&first<created?`<div class="tf-muted">Movimiento anterior a creación</div>`:"";
    return `<tr><td>${escapeHtml(a.bank)} · ${escapeHtml(a.alias)}${note}</td><td>${money(a.openingBalance)}</td><td>${escapeHtml(created)}</td><td>${escapeHtml(first)}</td><td><input type="date" data-mig002-date="${a.id}" value="${escapeHtml(suggested)}"></td></tr>`;
  }).join("");
}

function reconciliationMeta(accountId){
  const rows=reconciliations.filter(r=>r.accountId===accountId&&r.active!==false&&r.status!=="voided");
  const valid=rows
    .filter(r=>["reconciled","reconciled_with_adjustment"].includes(r.status))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
  const attention=rows
    .filter(r=>["review","reopened","needs_review"].includes(r.status))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
  const account=accounts.find(a=>a.id===accountId);
  const currentAtCut=valid&&account?calculateBalanceAtDate(account,transactions,valid.date):null;
  const drift=valid&&currentAtCut!==null&&Math.abs(Number(currentAtCut)-Number(valid.bankBalance||0))>=0.01;
  return {valid,attention,drift,currentAtCut};
}
function render(){
  const archivedCount=accounts.filter(a=>a.active===false).length;
  archivedToggle.hidden=!archivedCount;
  archivedToggle.textContent=showArchived?`Ver activas`:`Archivadas (${archivedCount})`;
  newButton.hidden=showArchived;

  const visible=accounts.filter(a=>showArchived?a.active===false:a.active!==false);
  const groups=[...new Set(visible.map(a=>a.institutionId?`id:${a.institutionId}`:`legacy:${a.bank}`))].sort((x,y)=>{
    const ax=visible.find(a=>(a.institutionId?`id:${a.institutionId}`:`legacy:${a.bank}`)===x),ay=visible.find(a=>(a.institutionId?`id:${a.institutionId}`:`legacy:${a.bank}`)===y);
    return institutionDisplay(ax).localeCompare(institutionDisplay(ay));
  });
  root.innerHTML=groups.map(group=>{
    const rows=visible.filter(a=>(a.institutionId?`id:${a.institutionId}`:`legacy:${a.bank}`)===group);
    const bank=institutionDisplay(rows[0]);
    return`<section class="tf-bank-group">
      <div class="tf-bank-title"><div><h3>${escapeHtml(bank)}</h3><div class="tf-muted">${showArchived?`${rows.length} archivada(s)`:`${rows.length} activa(s)`}</div></div></div>
      <div class="tf-account-grid">${rows.map(a=>{
        const bal=Number(balances[a.id]||0),card=a.accountType==="credit_card",debt=card?Math.max(0,-bal):0,available=card?Math.max(0,Number(a.creditLimit||0)-debt):null;
        const {valid,attention,drift,currentAtCut}=reconciliationMeta(a.id);
        const attentionIsNewer=attention&&(!valid||String(attention.date)>=String(valid.date));
        const needsAttention=attentionIsNewer||drift;
        return`<article class="tf-account-card ${showArchived?"is-archived":""}">
          <div class="tf-account-name">${escapeHtml(a.alias)}</div>
          <div class="tf-account-meta">${escapeHtml(accountTypeLabel(a.accountType))} · •${escapeHtml(a.last4||"----")}</div>
          <div class="tf-account-balance ${card&&debt>0?"tf-negative":""}">${card?`Deuda ${money(debt)}`:money(bal)}</div>
          ${card?`<div class="tf-muted">Cupo ${money(a.creditLimit)} · Disponible ${money(available)}<br>Corte ${a.closingDay||"—"} · Pago ${a.paymentDay||"—"}</div>`:""}
          <div class="tf-account-reconciliation">
            ${valid?`<div><strong>Última conciliación</strong><br>${escapeHtml(valid.date)} · saldo conciliado ${money(valid.bankBalance)}</div>`:`<div class="tf-muted">Sin conciliaciones válidas.</div>`}
            ${needsAttention?`<div class="tf-account-reconciliation-warning">⚠ ${drift?`El saldo actual al corte es ${money(currentAtCut)}; recalcula la conciliación.`:`Requiere revisión desde ${escapeHtml(attention.date)}`}</div>`:valid?`<div class="tf-account-reconciliation-ok">✓ Conciliada hasta ${escapeHtml(valid.date)}</div>`:""}
          </div>
          <div class="tf-actions" style="margin-top:.8rem">
            <a class="tf-btn tf-btn-secondary" href="movimientos.html?account=${a.id}">Movimientos</a>
            ${showArchived
              ? `<button class="tf-btn tf-btn-primary" data-reactivate="${a.id}">Reactivar</button>`
              : `<a class="tf-btn tf-btn-secondary" href="conciliacion.html">Conciliación</a>${card?`<a class="tf-btn tf-btn-secondary" href="deudas.html?card=${a.id}">Planes</a>`:""}<button class="tf-btn tf-btn-secondary" data-edit="${a.id}">Editar</button><button class="tf-btn tf-btn-secondary" data-archive="${a.id}">Archivar</button>`}
          </div>
        </article>`;
      }).join("")}</div>
    </section>`;
  }).join("")||`<div class="tf-card tf-empty">${showArchived?"Sin cuentas archivadas.":"Registra tu primera cuenta."}</div>`;
  renderMig002();
}
async function refresh(){[accounts,transactions,reconciliations]=await Promise.all([listAccounts(),listTransactions(),listReconciliations()]);balances=calculateBalances(accounts,transactions);render()}
type.addEventListener("change",toggle);document.querySelector("#account-cancel").addEventListener("click",()=>{reset();closeEditor()});
newButton.addEventListener("click",openNew);
archivedToggle.addEventListener("click",()=>{showArchived=!showArchived;closeEditor();render()});
form.addEventListener("submit",async e=>{e.preventDefault();let opening=Number(document.querySelector("#opening-balance").value||0);if(type.value==="credit_card")opening=-Math.abs(opening);const openingDate=document.querySelector("#opening-balance-as-of").value;if(!openingDate){toast("Selecciona la fecha base del saldo inicial.");return;}const old=editingId?accounts.find(x=>x.id===editingId):null;const bankValue=document.querySelector("#bank").value.trim();const preserveInstitution=old&&normalizeInstitutionKey(bankValue)===normalizeInstitutionKey(old.bank);const data={bank:bankValue,institutionId:preserveInstitution?(old.institutionId||null):null,institutionDisplayName:preserveInstitution?(old.institutionDisplayName||null):null,institutionIdentitySource:preserveInstitution?(old.institutionIdentitySource||""):"",alias:document.querySelector("#alias").value.trim(),accountType:type.value,last4:document.querySelector("#last4").value.trim(),openingBalance:opening,openingBalanceAsOf:openingDate,ledgerStartDate:openingDate,openingBalanceDateSource:old?.openingBalanceDateSource||"user_defined",active:old?.active!==false,creditLimit:type.value==="credit_card"?Number(document.querySelector("#credit-limit").value||0):0,closingDay:type.value==="credit_card"?Number(document.querySelector("#closing-day").value||0):null,paymentDay:type.value==="credit_card"?Number(document.querySelector("#payment-day").value||0):null,reminderDaysBefore:type.value==="credit_card"?Number(document.querySelector("#card-reminder").value||0):null,statementBalance:type.value==="credit_card"?Number(document.querySelector("#statement-balance").value||0):0,minimumPayment:type.value==="credit_card"?Number(document.querySelector("#minimum-payment").value||0):0};if(editingId){const impact=[];if(Number(old.openingBalance)!==Number(data.openingBalance))impact.push("Recalculará saldo y patrimonio.");if(old.accountType!==data.accountType)impact.push("Cambiará la interpretación patrimonial.");if((old.ledgerStartDate||old.openingBalanceAsOf||"")!==openingDate)impact.push("Cambiará desde qué fecha los movimientos afectan el saldo.");if(!await confirmAction({title:"Actualizar cuenta",message:`${old.bank} · ${old.alias}`,impact}))return}await saveAccount(data,editingId);toast(editingId?"Cuenta actualizada.":"Cuenta creada.");reset();closeEditor();await refresh()});
root.addEventListener("click",async e=>{const ed=e.target.closest("[data-edit]"),ar=e.target.closest("[data-archive]"),re=e.target.closest("[data-reactivate]");if(ed){const a=accounts.find(x=>x.id===ed.dataset.edit);editingId=a.id;editor.hidden=false;document.querySelector("#account-editor-title").textContent="Editar cuenta";for(const[id,val]of[["bank",a.bank],["alias",a.alias],["last4",a.last4||""],["opening-balance",a.accountType==="credit_card"?Math.abs(a.openingBalance||0):a.openingBalance||0],["opening-balance-as-of",a.ledgerStartDate||a.openingBalanceAsOf||suggestedLedgerDate(a)],["credit-limit",a.creditLimit||0],["closing-day",a.closingDay||18],["payment-day",a.paymentDay||5],["card-reminder",a.reminderDaysBefore||3],["statement-balance",a.statementBalance||0],["minimum-payment",a.minimumPayment||0]])document.querySelector(`#${id}`).value=val;type.value=a.accountType;toggle();document.querySelector("#account-cancel").hidden=false;document.querySelector("#account-submit").textContent="Actualizar cuenta";scrollTo({top:0,behavior:"smooth"})}if(ar&&await confirmAction({title:"Archivar cuenta",message:"Se conserva todo su historial.",impact:["No se eliminarán transacciones."],confirmText:"Archivar"})){await archiveAccount(ar.dataset.archive);await refresh()}if(re){await reactivateAccount(re.dataset.reactivate);await refresh()}});
mig002Apply.addEventListener("click",async()=>{
  const legacy=accounts.filter(a=>a.legacyOpeningBalanceAsOfMissing);
  if(!legacy.length)return;
  const rows=legacy.map(a=>({a,date:document.querySelector(`[data-mig002-date="${a.id}"]`)?.value||"",first:firstTransactionDate(a.id)}));
  if(rows.some(x=>!x.date)){toast("Todas las cuentas requieren una fecha base.");return;}
  const unsafe=rows.filter(x=>x.first&&x.date>x.first);
  if(unsafe.length){toast(`La fecha base no puede ser posterior al primer movimiento en ${unsafe.length} cuenta(s).`);return;}
  if(!await confirmAction({title:"Aplicar MIG-002",message:`Asignar fecha base a ${rows.length} cuenta(s) legacy`,impact:["No modifica saldos iniciales ni movimientos.","Los movimientos existentes continúan incluidos porque ninguna fecha propuesta es posterior al primer movimiento.","A partir de esta migración, movimientos anteriores a la fecha base no afectarán el saldo."],confirmText:"Aplicar MIG-002"}))return;
  const before=calculateBalances(accounts,transactions);
  await atomicWrite(rows.map(({a,date})=>({collection:"accounts",id:a.id,action:"update",auditType:"account",data:{openingBalanceAsOf:date,ledgerStartDate:date,openingBalanceDateSource:"mig002_reviewed"},note:"MIG-002 · fecha base del saldo inicial / inicio del ledger"})));
  await refresh();
  const after=calculateBalances(accounts,transactions);
  const changed=accounts.filter(a=>Math.abs(Number(before[a.id]||0)-Number(after[a.id]||0))>.009);
  if(changed.length)toast(`MIG-002 aplicada, pero ${changed.length} saldo(s) requieren revisión.`);else toast("MIG-002 aplicada. Los saldos permanecen sin cambios.");
});

toggle();requireUser(()=>refresh().catch(console.error));

window.addEventListener("tf-mig011-applied",()=>refresh().catch(console.error));
