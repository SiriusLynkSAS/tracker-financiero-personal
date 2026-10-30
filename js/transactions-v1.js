import { requireUser } from "./guard.js";
import {
  listAccounts,
  listTransactions,
  listCategories,
  saveTransaction,
  removeTransaction,
  listReconciliations,
  listRecurring,
  saveRecurringTransaction
} from "./data-service.js";
import {
  todayISO,
  money,
  escapeHtml,
  txLabel,
  sum
} from "./utils.js";
import {
  sortCategoryRows,
  categoriesForType,
  subcategoriesFor,
  setCategorySelect,
  setSubcategorySelect
} from "./category-catalog.js";
import { confirmAction, toast } from "./ui.js";

let accounts = [];
let transactions = [];
let categories = [];
let reconciliations = [];
let recurringRows = [];
let recurringContext = null;
let editingId = null;
let ledgerSnapshots = new Map();

const form = document.querySelector("#tx-form");
const tbody = document.querySelector("#tx-body");
const type = document.querySelector("#tx-type");
const filter = document.querySelector("#filter-account");
const filterSearch = document.querySelector("#filter-search");
const filterType = document.querySelector("#filter-type");
const filterPeriod = document.querySelector("#filter-period");
const filterSort = document.querySelector("#filter-sort");
const filterCategory = document.querySelector("#filter-category");
const filterSubcategory = document.querySelector("#filter-subcategory");
const moreDetails = document.querySelector("#tx-more-details");
const categoryDialog = document.querySelector("#tx-category-dialog");
const categoryDialogBody = document.querySelector("#tx-category-dialog-body");
const detailDialog = document.querySelector("#tx-detail-dialog");
const detailDialogTitle = document.querySelector("#tx-detail-title");
const detailDialogMeta = document.querySelector("#tx-detail-meta");
const detailDialogBody = document.querySelector("#tx-detail-body");
const LAST_ACCOUNT_KEY = "tracker.lastTransactionAccountId";

function activeAccounts() {
  return accounts.filter(a => a.active !== false);
}

function accountLabel(a) {
  return `${a.bank} · ${a.alias} · •${a.last4 || "----"}`;
}

function accountName(id) {
  const a = accounts.find(x => x.id === id);
  return a ? accountLabel(a) : "Cuenta archivada";
}

function parseDecimalInput(value){
  const normalized=String(value??"").trim().replace(",",".");
  const n=Number(normalized);
  return Number.isFinite(n)?n:0;
}
function nowTime(){ return new Date().toTimeString().slice(0,5); }
function transactionDateTime(row){ return String(row?.transactionDateTime||`${row?.date||""}T00:00`); }
function chargeTotal(row){ return Number(row?.feeAmount||0)+Number(row?.taxAmount||0)+Number(row?.otherChargeAmount||0); }

function transactionEffects(tx){
  const amount=Number(tx?.amount||0);
  const charges=chargeTotal(tx);
  const out=[];
  const push=(accountId,change,role)=>{
    if(accountId) out.push({accountId,change:Number(change||0),role});
  };
  if(["income","work_reimbursement","work_advance"].includes(tx.type)) push(tx.accountId,amount,"Cuenta");
  else if(["expense","work_expense","work_advance_return"].includes(tx.type)) push(tx.accountId,-(amount+charges),"Cuenta");
  else if(tx.type==="transfer"){
    push(tx.fromAccountId,-(amount+charges),"Origen");
    push(tx.toAccountId,amount,"Destino");
  }else if(tx.type==="investment_out") push(tx.accountId,-amount,"Cuenta");
  else if(tx.type==="investment_return") push(tx.accountId,amount,"Cuenta");
  return out;
}

function buildLedgerSnapshots(){
  const balances=Object.fromEntries(accounts.map(a=>[a.id,Number(a.openingBalance||0)]));
  const rows=[...transactions].sort((a,b)=>{
    const da=transactionDateTime(a),db=transactionDateTime(b);
    return da.localeCompare(db)||String(a.id||"").localeCompare(String(b.id||""));
  });
  const map=new Map();
  for(const tx of rows){
    const lines=transactionEffects(tx).map(effect=>{
      const before=Number(balances[effect.accountId]||0);
      const after=before+effect.change;
      balances[effect.accountId]=after;
      return {...effect,before,after};
    });
    map.set(tx.id,lines);
  }
  ledgerSnapshots=map;
}

function signedMoney(value){
  const n=Number(value||0);
  return `${n>=0?"+":"−"}${money(Math.abs(n))}`;
}

function finalBalanceCell(tx){
  const lines=ledgerSnapshots.get(tx.id)||[];
  if(!lines.length) return `<span class="tf-muted">—</span>`;
  if(lines.length===1){
    return `<strong>${money(lines[0].after)}</strong>`;
  }
  return lines.map(line=>`
    <div class="tf-tx-final-balance-line">
      <span class="tf-muted">${escapeHtml(line.role)}</span>
      <strong>${money(line.after)}</strong>
    </div>
  `).join("");
}

function openTransactionDetail(tx){
  if(!tx||!detailDialog) return;
  const lines=ledgerSnapshots.get(tx.id)||[];
  const charges=chargeTotal(tx);
  detailDialogTitle.textContent=tx.description||txLabel(tx.type);
  detailDialogMeta.textContent=`${tx.date||"—"} · ${transactionDateTime(tx).slice(11,16)||"—"} · ${tx.reconciliationAdjustment?"Ajuste de conciliación":txLabel(tx.type)}`;

  const balanceHtml=lines.length?lines.map(line=>`
    <section class="tf-subtle" style="margin-top:.75rem">
      <div class="tf-section-heading">
        <div><strong>${escapeHtml(line.role)} · ${escapeHtml(accountName(line.accountId))}</strong></div>
      </div>
      <div class="tf-detail-grid">
        <div class="tf-metric"><span class="tf-metric-label">Saldo anterior</span><strong>${money(line.before)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Cambio</span><strong>${signedMoney(line.change)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Nuevo saldo</span><strong>${money(line.after)}</strong></div>
      </div>
    </section>
  `).join(""):`<div class="tf-empty">Este movimiento no afecta directamente una cuenta del ledger.</div>`;

  const chargeHtml=charges>0.009?`
    <section class="tf-subtle" style="margin-top:.75rem">
      <strong>Desglose de salida</strong>
      <div class="tf-detail-grid" style="margin-top:.55rem">
        <div class="tf-metric"><span class="tf-metric-label">Monto principal</span><strong>${money(tx.amount)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Cargos</span><strong>${money(charges)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Débito total</span><strong>${money(Number(tx.amount||0)+charges)}</strong></div>
      </div>
    </section>`:"";

  detailDialogBody.innerHTML=balanceHtml+chargeHtml+
    (tx.recurringId?`<div class="tf-muted" style="margin-top:.75rem">Vinculado a recurrente.</div>`:"")+
    ((tx.debtPaymentId||tx.liabilityId)?`<div class="tf-muted" style="margin-top:.75rem">Vinculado a pago de deuda.</div>`:"");

  detailDialog.showModal();
}
function updateGrossDebit(){
  const amount=parseDecimalInput(document.querySelector("#tx-amount").value);
  const fee=parseDecimalInput(document.querySelector("#tx-fee")?.value);
  const tax=parseDecimalInput(document.querySelector("#tx-tax")?.value);
  const other=parseDecimalInput(document.querySelector("#tx-other-charge")?.value);
  const gross=amount+fee+tax+other;
  const el=document.querySelector("#tx-gross-debit");
  if(el) el.textContent=`Total que saldrá de la cuenta: ${money(gross)}`;
}

function fillAccounts() {
  const options = activeAccounts().map(a =>
    `<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`
  ).join("");

  ["tx-account", "tx-from", "tx-to"].forEach(id => {
    document.querySelector(`#${id}`).innerHTML = options;
  });

  const remembered = localStorage.getItem(LAST_ACCOUNT_KEY);
  if (!editingId && remembered && activeAccounts().some(a => a.id === remembered)) {
    document.querySelector("#tx-account").value = remembered;
    document.querySelector("#tx-from").value = remembered;
  }

  filter.innerHTML =
    `<option value="all">Todas las cuentas</option>` +
    accounts.map(a =>
      `<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`
    ).join("");

  const requested = new URLSearchParams(location.search).get("account");
  if (requested && accounts.some(a => a.id === requested)) {
    filter.value = requested;
  }
}

function currentCategoryType() {
  return type.value === "income" ? "income" : "expense";
}

function fillCategories(preferredCategory = "", preferredSubcategory = "") {
  const catSelect = document.querySelector("#tx-category");
  const subSelect = document.querySelector("#tx-subcategory");
  const catType = currentCategoryType();

  const category = setCategorySelect(
    catSelect,
    categories,
    catType,
    preferredCategory
  );

  setSubcategorySelect(
    subSelect,
    categories,
    catType,
    category,
    preferredSubcategory
  );
  syncCategoryPickerLabel();
}

function fillSubs(preferred = "") {
  const catType = currentCategoryType();
  const category = document.querySelector("#tx-category").value;

  setSubcategorySelect(
    document.querySelector("#tx-subcategory"),
    categories,
    catType,
    category,
    preferred
  );
  syncCategoryPickerLabel();
}

function syncCategoryPickerLabel(){
  const button=document.querySelector("#tx-category-picker");
  if(!button) return;
  const category=document.querySelector("#tx-category").value;
  const subcategory=document.querySelector("#tx-subcategory").value;
  button.textContent=category
    ? `${category}${subcategory?` · ${subcategory}`:""}`
    : "Seleccionar categoría y subcategoría";
  button.classList.toggle("has-value",!!category&&!!subcategory);
}

function renderCategoryDialog(category=null){
  if(!categoryDialogBody) return;
  const catType=currentCategoryType();
  if(!category){
    document.querySelector("#tx-category-dialog-title").textContent="Seleccionar categoría";
    const rows=categoriesForType(categories,catType);
    categoryDialogBody.innerHTML=rows.map(name=>
      `<button type="button" class="tf-tx-category-option" data-category-choice="${escapeHtml(name)}">${escapeHtml(name)}</button>`
    ).join("") || `<div class="tf-empty">No hay categorías configuradas.</div>`;
  }else{
    document.querySelector("#tx-category-dialog-title").textContent=category;
    const rows=subcategoriesFor(categories,catType,category);
    categoryDialogBody.innerHTML=
      `<button type="button" class="tf-tx-category-back" data-category-back>← Categorías</button>`+
      rows.map(name=>
        `<button type="button" class="tf-tx-category-option" data-subcategory-choice="${escapeHtml(name)}">${escapeHtml(name)}</button>`
      ).join("");
  }
}

function openCategoryDialog(){
  blurEditorText();
  renderCategoryDialog();
  if(categoryDialog?.showModal) categoryDialog.showModal();
}

function syncTypeButtons(){
  document.querySelectorAll("[data-tx-type]").forEach(button => {
    const selected = button.dataset.txType === type.value;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function updateSaveButton(){
  const amount = parseDecimalInput(document.querySelector("#tx-amount").value);
  const action = editingId ? "Actualizar" : "Guardar";
  document.querySelector("#tx-submit").textContent = amount > 0
    ? `${action} ${money(amount)}`
    : `${action} movimiento`;
}

function blurEditorText(){
  const active = document.activeElement;
  if (active && ["INPUT","TEXTAREA"].includes(active.tagName)) active.blur();
}

function toggleType() {
  const isTransfer = type.value === "transfer";
  syncTypeButtons();

  document.querySelector("#single-account-fields").hidden = isTransfer;
  document.querySelector("#transfer-fields").hidden = !isTransfer;
  document.querySelector("#category-fields").hidden = isTransfer;
  document.querySelector("#split-toggle-wrap").hidden = isTransfer;
  document.querySelector("#transfer-charge-panel").hidden = !isTransfer;
  const isIncome=type.value==="income";
  document.querySelector("#invoice-toggle-wrap").hidden=!isIncome;
  if(!isIncome){
    document.querySelector("#tx-has-invoice").checked=false;
  }
  toggleInvoice();

  if (isTransfer) {
    document.querySelector("#tx-split-enabled").checked = false;
    toggleSplit();
  } else {
    fillCategories();
    if(!editingId){
      document.querySelector("#tx-category").value="";
      document.querySelector("#tx-subcategory").value="";
      syncCategoryPickerLabel();
    }
    refreshSplitCatalogs();
  }
}

function currentEditingTransaction(){
  return editingId ? transactions.find(x=>x.id===editingId) : null;
}

function toggleInvoice(){
  const isIncome=type.value==="income";
  const checked=isIncome && document.querySelector("#tx-has-invoice").checked;
  const settled=!!currentEditingTransaction()?.taxPaymentId;
  document.querySelector("#invoice-panel").hidden=!checked;
  document.querySelector("#tx-invoice-number").disabled=settled;
  document.querySelector("#tx-vat").disabled=settled;
  document.querySelector("#tx-has-invoice").disabled=settled;

  const lock=document.querySelector("#tx-invoice-lock");
  lock.classList.toggle("is-visible",checked&&settled);
  lock.textContent=checked&&settled
    ?"El IVA de esta factura ya fue liquidado. Sus datos tributarios quedan bloqueados."
    :"";
  updateInvoiceSummary();
}

function updateInvoiceSummary(){
  const amount=parseDecimalInput(document.querySelector("#tx-amount").value);
  const vat=parseDecimalInput(document.querySelector("#tx-vat").value);
  const base=Math.max(0,amount-vat);
  const period=String(document.querySelector("#tx-date").value||"").slice(0,7);
  document.querySelector("#tx-invoice-summary").textContent=
    `Base sin IVA: ${money(base)} · Período: ${period||"—"}`;
}

function splitRow(data = {}) {
  const catType = currentCategoryType();
  const categoryList = categoriesForType(categories, catType);
  const initialCategory =
    data.category && categoryList.includes(data.category)
      ? data.category
      : (categoryList[0] || "");

  const subList = subcategoriesFor(
    categories,
    catType,
    initialCategory
  );

  const initialSubcategory =
    data.subcategory && subList.includes(data.subcategory)
      ? data.subcategory
      : (subList[0] || "");

  const div = document.createElement("div");
  div.className = "tf-split-row";

  div.innerHTML = `
    <div class="tf-field">
      <label>Categoría</label>
      <select data-split-cat>
        ${categoryList.length
          ? categoryList.map(c =>
              `<option value="${escapeHtml(c)}" ${c === initialCategory ? "selected" : ""}>
                ${escapeHtml(c)}
              </option>`
            ).join("")
          : `<option value="">Sin categorías configuradas</option>`
        }
      </select>
    </div>

    <div class="tf-field">
      <label>Subcategoría</label>
      <select data-split-sub>
        ${subList.length
          ? subList.map(s =>
              `<option value="${escapeHtml(s)}" ${s === initialSubcategory ? "selected" : ""}>
                ${escapeHtml(s)}
              </option>`
            ).join("")
          : `<option value="">Sin subcategorías configuradas</option>`
        }
      </select>
    </div>

    <div class="tf-field">
      <label>Monto</label>
      <input
        data-split-amount
        type="number"
        min="0"
        step="0.01"
        value="${data.amount ? Number(data.amount) : ""}"
      >
    </div>

    <button type="button" class="tf-btn tf-btn-danger" data-remove-split>
      Quitar
    </button>
  `;

  const catSelect = div.querySelector("[data-split-cat]");
  const subSelect = div.querySelector("[data-split-sub]");

  catSelect.addEventListener("change", () => {
    setSubcategorySelect(
      subSelect,
      categories,
      currentCategoryType(),
      catSelect.value
    );
  });

  div.querySelector("[data-split-amount]")
    .addEventListener("input", updateSplitTotal);

  return div;
}

function refreshSplitCatalogs() {
  document.querySelectorAll(".tf-split-row").forEach(row => {
    const catSelect = row.querySelector("[data-split-cat]");
    const subSelect = row.querySelector("[data-split-sub]");
    const oldCat = catSelect.value;
    const oldSub = subSelect.value;

    const cat = setCategorySelect(
      catSelect,
      categories,
      currentCategoryType(),
      oldCat
    );

    setSubcategorySelect(
      subSelect,
      categories,
      currentCategoryType(),
      cat,
      oldSub
    );
  });
}

function toggleSplit() {
  const on = document.querySelector("#tx-split-enabled").checked;
  document.querySelector("#split-panel").hidden = !on;

  if (on && !document.querySelector("#split-rows").children.length) {
    document.querySelector("#split-rows").appendChild(splitRow());
  }
}

function updateSplitTotal() {
  const total = sum(
    [...document.querySelectorAll("[data-split-amount]")],
    x => x.value
  );

  document.querySelector("#split-total").textContent =
    `Total dividido: ${money(total)} / movimiento: ` +
    `${money(parseDecimalInput(document.querySelector("#tx-amount").value))}`;
}

function collectSplits() {
  return [...document.querySelectorAll(".tf-split-row")]
    .map(row => ({
      category: row.querySelector("[data-split-cat]").value,
      subcategory: row.querySelector("[data-split-sub]").value,
      amount: parseDecimalInput(row.querySelector("[data-split-amount]").value)
    }))
    .filter(x => x.amount > 0);
}

function reset() {
  editingId = null;
  form.reset();

  document.querySelector("#tx-date").value = todayISO();
  document.querySelector("#tx-time").value = nowTime();
  ["tx-fee","tx-tax","tx-other-charge"].forEach(id=>{const el=document.querySelector(`#${id}`);if(el)el.value="";});
  type.value = "expense";
  document.querySelector("#tx-amount").value = "";
  document.querySelector("#tx-vat").value = "";
  document.querySelector("#tx-has-invoice").checked = false;
  document.querySelector("#tx-invoice-number").value = "";
  document.querySelector("#tx-has-invoice").disabled = false;
  document.querySelector("#tx-vat").disabled = false;
  document.querySelector("#tx-invoice-number").disabled = false;
  document.querySelector("#split-rows").innerHTML = "";
  document.querySelector("#tx-cancel").hidden = true;
  document.querySelector("#tx-editor-title").textContent = "Nuevo movimiento";
  if (moreDetails) moreDetails.open = false;

  toggleType();
  updateSaveButton();
  toggleSplit();
}

function filteredTransactions() {
  let rows=[...transactions];
  const account=filter?.value||"all";
  const q=String(filterSearch?.value||"").trim().toLowerCase();
  const selectedType=filterType?.value||"all";
  const period=filterPeriod?.value||"all";
  const cat=filterCategory?.value||"all";
  const sub=filterSubcategory?.value||"all";
  const now=new Date();
  const ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const year=String(now.getFullYear());
  rows=rows.filter(t=>{
    const accountOk=account==="all" || t.accountId===account || t.fromAccountId===account || t.toAccountId===account;
    const typeOk=selectedType==="all" || t.type===selectedType;
    const periodOk=period==="all" || (period==="month"?String(t.date).startsWith(ym):String(t.date).startsWith(year));
    const catOk=cat==="all" || t.category===cat || (t.splits||[]).some(x=>x.category===cat);
    const subOk=sub==="all" || t.subcategory===sub || (t.splits||[]).some(x=>x.subcategory===sub);
    const hay=[t.description,t.category,t.subcategory,accountName(t.accountId),accountName(t.fromAccountId),accountName(t.toAccountId),t.receipt]
      .join(" ").toLowerCase();
    return accountOk&&typeOk&&periodOk&&catOk&&subOk&&(!q||hay.includes(q));
  });
  const sort=filterSort?.value||"recent";
  rows.sort((a,b)=>{
    if(sort==="oldest") return transactionDateTime(a).localeCompare(transactionDateTime(b));
    if(sort==="amount_desc") return Number(b.amount||0)-Number(a.amount||0);
    if(sort==="amount_asc") return Number(a.amount||0)-Number(b.amount||0);
    if(sort==="category") return String(a.category||"").localeCompare(String(b.category||""));
    return transactionDateTime(b).localeCompare(transactionDateTime(a));
  });
  return rows;
}
function renderFilterCatalog(){
  const cats=[...new Set(categories.map(x=>x.category).filter(Boolean))].sort();
  filterCategory.innerHTML='<option value="all">Todas</option>'+cats.map(x=>`<option>${escapeHtml(x)}</option>`).join("");
  const selected=filterCategory.value;
  const subs=[...new Set(categories.filter(x=>selected==="all"||x.category===selected).map(x=>x.subcategory).filter(Boolean))].sort();
  filterSubcategory.innerHTML='<option value="all">Todas</option>'+subs.map(x=>`<option>${escapeHtml(x)}</option>`).join("");
}
function render() {
  const rows=filteredTransactions();
  let lastDay="";
  tbody.innerHTML = rows.map(tx => {
    const day=String(tx.date||"");
    const group=day!==lastDay?`<tr class="tf-tx-day-row"><td colspan="8"><strong>${escapeHtml(day)}</strong></td></tr>`:"";
    lastDay=day;
    const time=transactionDateTime(tx).slice(11,16);
    const charges=chargeTotal(tx);
    return group+`<tr>
      <td><strong>${escapeHtml(time||"—")}</strong><div class="tf-muted">${escapeHtml(day)}</div></td>
      <td><span class="tf-pill">${escapeHtml(tx.reconciliationAdjustment?"Ajuste de conciliación":txLabel(tx.type))}</span></td>
      <td>${escapeHtml(tx.type === "transfer" ? `${accountName(tx.fromAccountId)} → ${accountName(tx.toAccountId)}` : accountName(tx.accountId))}</td>
      <td>${escapeHtml(tx.splits?.length ? `${tx.splits.length} divisiones` : tx.category || "—")}</td>
      <td>${escapeHtml(tx.description || "—")}${charges>0?`<div class="tf-muted">Cargos ${money(charges)} · débito ${money(Number(tx.amount||0)+charges)}</div>`:""}</td>
      <td>${money(tx.amount)}</td>
      <td><div class="tf-actions">
        <button class="tf-btn tf-btn-secondary" data-detail="${tx.id}">Detalle</button>
        ${tx.reconciliationAdjustment?`<a class="tf-btn tf-btn-secondary" href="conciliacion.html">Ver conciliación</a>`:(tx.debtPaymentId||tx.liabilityId)?`<a class="tf-btn tf-btn-secondary" href="deudas.html">Ver deuda</a>`:(tx.tripExpenseId||tx.tripSettlementId)?`<a class="tf-btn tf-btn-secondary" href="comisiones.html">Ver comisión</a>`:(tx.recurringId?`<a class="tf-btn tf-btn-secondary" href="recurrentes.html">Ver recurrente</a>`:`<button class="tf-btn tf-btn-secondary" data-edit="${tx.id}">Editar</button>`)}
        ${(tx.taxPaymentId||tx.tripExpenseId||tx.tripSettlementId||tx.reconciliationAdjustment||tx.debtPaymentId||tx.liabilityId||tx.recurringId)?`<span class="tf-pill">Vinculado</span>`:`<button class="tf-btn tf-btn-danger" data-delete="${tx.id}">Eliminar</button>`}
      </div></td>
      <td class="tf-tx-final-balance">${finalBalanceCell(tx)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="tf-empty">No hay movimientos para los filtros seleccionados.</td></tr>`;
}

function affectedReconciliations(accountIds,date){
  return reconciliations.filter(r=>
    r.active!==false &&
    accountIds.includes(r.accountId) &&
    ["reconciled","reconciled_with_adjustment"].includes(r.status) &&
    String(r.date)>=String(date)
  );
}

async function refresh() {
  [accounts, transactions, categories, reconciliations, recurringRows] = await Promise.all([
    listAccounts(), listTransactions(), listCategories(), listReconciliations(), listRecurring()
  ]);

  categories = sortCategoryRows(categories);
  buildLedgerSnapshots();
  fillAccounts();
  fillCategories();
  refreshSplitCatalogs();
  renderFilterCatalog();
  render();
  applyRecurringContext();
}

function applyRecurringContext(){
  if(recurringContext) return;
  const params=new URLSearchParams(location.search);
  const id=params.get("recurring");
  const occurrence=params.get("occurrence");
  if(!id||!occurrence) return;
  const recurring=recurringRows.find(x=>x.id===id&&x.active!==false);
  if(!recurring) return;
  const exists=transactions.some(t=>t.recurringId===id && ((t.recurringOccurrence||String(t.date||"").slice(0,7))===occurrence));
  if(exists){ toast("Este recurrente ya fue registrado para ese mes."); return; }
  recurringContext={recurring,occurrence};
  type.value=recurring.type;
  document.querySelector("#tx-amount").value=Number(recurring.amount||0);
  document.querySelector("#tx-description").value=recurring.name||"";
  document.querySelector("#tx-date").value=todayISO();
  document.querySelector("#tx-time").value=nowTime();
  toggleType();
  if(recurring.accountId && activeAccounts().some(a=>a.id===recurring.accountId)) document.querySelector("#tx-account").value=recurring.accountId;
  fillCategories(recurring.category||"",recurring.subcategory||"");
  document.querySelector("#tx-editor-title").textContent=recurring.type==="income"?"Registrar ingreso recurrente":"Registrar pago recurrente";
  updateSaveButton();
}

type.addEventListener("change", toggleType);
document.querySelectorAll("[data-tx-type]").forEach(button => {
  button.addEventListener("click", () => {
    blurEditorText();
    type.value = button.dataset.txType;
    toggleType();
  });
});

["tx-account","tx-from","tx-to","tx-category","tx-subcategory","filter-account"].forEach(id => {
  const el = document.querySelector(`#${id}`);
  el?.addEventListener("pointerdown", blurEditorText);
  el?.addEventListener("focus", blurEditorText);
});

document.querySelector("#tx-category").addEventListener("change", () => fillSubs());
document.querySelector("#tx-subcategory").addEventListener("change", syncCategoryPickerLabel);
document.querySelector("#tx-category-picker")?.addEventListener("click",openCategoryDialog);
document.querySelector("#tx-category-dialog-close")?.addEventListener("click",()=>categoryDialog?.close());
categoryDialogBody?.addEventListener("click",e=>{
  const cat=e.target.closest("[data-category-choice]");
  const sub=e.target.closest("[data-subcategory-choice]");
  const back=e.target.closest("[data-category-back]");
  if(back){ renderCategoryDialog(); return; }
  if(cat){
    const value=cat.dataset.categoryChoice;
    document.querySelector("#tx-category").value=value;
    fillSubs();
    document.querySelector("#tx-subcategory").value="";
    syncCategoryPickerLabel();
    renderCategoryDialog(value);
    return;
  }
  if(sub){
    document.querySelector("#tx-subcategory").value=sub.dataset.subcategoryChoice;
    syncCategoryPickerLabel();
    blurEditorText();
    categoryDialog?.close();
  }
});
[filter,filterType,filterPeriod,filterSort,filterCategory,filterSubcategory].forEach(el=>el?.addEventListener("change",()=>{if(el===filterCategory)renderFilterCatalog();render();}));
filterSearch?.addEventListener("input",render);
document.querySelector("#filter-clear")?.addEventListener("click",()=>{filter.value="all";filterType.value="all";filterPeriod.value="month";filterSort.value="recent";filterSearch.value="";renderFilterCatalog();render();});
document.querySelector("#tx-split-enabled").addEventListener("change", toggleSplit);
document.querySelector("#tx-amount").addEventListener("input",()=>{updateSplitTotal();updateInvoiceSummary();updateSaveButton()});
["tx-amount","tx-vat","tx-fee","tx-tax","tx-other-charge"].forEach(id => {
  const input=document.querySelector(`#${id}`);
  input?.addEventListener("focus", () => requestAnimationFrame(() => input.select()));
  input?.addEventListener("input", () => {
    input.value=input.value.replace(/[^0-9.,]/g,"").replace(/([.,].*)[.,]/g,"$1");
    updateGrossDebit();
  });
});
document.querySelectorAll("[data-date-shortcut]").forEach(button => {
  button.addEventListener("click", () => {
    blurEditorText();
    const date = new Date();
    if (button.dataset.dateShortcut === "yesterday") date.setDate(date.getDate()-1);
    const local = new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);
    document.querySelector("#tx-date").value = local;
    updateInvoiceSummary();
  });
});
document.querySelector("#tx-date").addEventListener("change",updateInvoiceSummary);
document.querySelector("#tx-vat").addEventListener("input",updateInvoiceSummary);
document.querySelector("#tx-has-invoice").addEventListener("change",toggleInvoice);

document.querySelector("#add-split").addEventListener("click", () => {
  document.querySelector("#split-rows").appendChild(splitRow());
  updateSplitTotal();
});

document.querySelector("#split-rows").addEventListener("click", e => {
  const button = e.target.closest("[data-remove-split]");
  if (!button) return;

  button.closest(".tf-split-row").remove();
  updateSplitTotal();
});

tbody.addEventListener("click",e=>{
  const detail=e.target.closest("[data-detail]");
  if(detail){
    openTransactionDetail(transactions.find(tx=>tx.id===detail.dataset.detail));
    return;
  }
});
document.querySelector("#tx-detail-close")?.addEventListener("click",()=>detailDialog?.close());

document.querySelector("#tx-cancel").addEventListener("click", reset);

form.addEventListener("submit", async e => {
  e.preventDefault();

  const amount = parseDecimalInput(document.querySelector("#tx-amount").value);
  const hasInvoice=type.value==="income"&&document.querySelector("#tx-has-invoice").checked;
  const vat = hasInvoice ? parseDecimalInput(document.querySelector("#tx-vat").value) : 0;

  if (!(amount > 0)) return alert("El monto debe ser mayor que cero.");
  if (vat < 0 || (hasInvoice && vat >= amount)) return alert("El IVA debe ser menor que el total recibido.");

  const previous=currentEditingTransaction();
  const data = {
    type: type.value,
    date: document.querySelector("#tx-date").value,
    transactionDateTime:`${document.querySelector("#tx-date").value}T${document.querySelector("#tx-time").value||"00:00"}`,
    amount,
    feeAmount:type.value==="transfer"?parseDecimalInput(document.querySelector("#tx-fee").value):Number(previous?.feeAmount||0),
    taxAmount:type.value==="transfer"?parseDecimalInput(document.querySelector("#tx-tax").value):Number(previous?.taxAmount||0),
    otherChargeAmount:type.value==="transfer"?parseDecimalInput(document.querySelector("#tx-other-charge").value):Number(previous?.otherChargeAmount||0),
    vat,
    receipt: document.querySelector("#tx-receipt").value.trim(),
    description: document.querySelector("#tx-description").value.trim(),
    hasInvoice,
    invoiceNumber:hasInvoice?document.querySelector("#tx-invoice-number").value.trim():"",
    invoiceBase:hasInvoice?Math.max(0,amount-vat):0,
    taxPeriod:hasInvoice?document.querySelector("#tx-date").value.slice(0,7):"",
    taxPaymentId:previous?.taxPaymentId||"",
    vatStatus:hasInvoice?(previous?.taxPaymentId?"paid":"pending"):"none",
    reconciliationAdjustment:previous?.reconciliationAdjustment===true,
    classificationStatus:previous?.reconciliationAdjustment===true
      ? (
          document.querySelector("#tx-split-enabled").checked
            ? (collectSplits().some(x=>x.category==="Por clasificar")?"unclassified":"classified")
            : (document.querySelector("#tx-category").value==="Por clasificar"?"unclassified":"classified")
        )
      : (previous?.classificationStatus||""),
    recoveryStart:previous?.recoveryStart||"",
    recoveryEnd:previous?.recoveryEnd||"",
    reconciliationId:previous?.reconciliationId||"",
    businessTripId:previous?.businessTripId||"",
    tripExpenseId:previous?.tripExpenseId||"",
    tripSettlementId:previous?.tripSettlementId||"",
    liabilityId:previous?.liabilityId||"",
    debtPaymentId:previous?.debtPaymentId||"",
    recurringId:previous?.recurringId||recurringContext?.recurring?.id||"",
    recurringOccurrence:previous?.recurringOccurrence||recurringContext?.occurrence||"",
    recurringScheduledDate:previous?.recurringScheduledDate||"",
    category:
      type.value === "transfer"
        ? ""
        : document.querySelector("#tx-category").value,
    subcategory:
      type.value === "transfer"
        ? ""
        : document.querySelector("#tx-subcategory").value,
    accountId:
      type.value === "transfer"
        ? null
        : document.querySelector("#tx-account").value,
    fromAccountId:
      type.value === "transfer"
        ? document.querySelector("#tx-from").value
        : null,
    toAccountId:
      type.value === "transfer"
        ? document.querySelector("#tx-to").value
        : null,
    splits:
      document.querySelector("#tx-split-enabled").checked
        ? collectSplits()
        : []
  };

  data.grossDebitAmount=Number(data.amount||0)+Number(data.feeAmount||0)+Number(data.taxAmount||0)+Number(data.otherChargeAmount||0);

  if (data.type !== "transfer" && !data.category) {
    return alert("Primero configura al menos una categoría para este tipo de movimiento.");
  }

  if (data.type !== "transfer" && !data.subcategory) {
    return alert("La categoría seleccionada no tiene subcategorías configuradas.");
  }

  if (
    data.type === "transfer" &&
    data.fromAccountId === data.toAccountId
  ) {
    return alert("Origen y destino deben ser diferentes.");
  }

  if (
    data.splits.length &&
    Math.abs(sum(data.splits, x => x.amount) - amount) > 0.009
  ) {
    return alert("La suma de divisiones debe coincidir con el monto.");
  }

  if (data.splits.some(x => !x.category || !x.subcategory)) {
    return alert("Todas las divisiones deben tener categoría y subcategoría.");
  }

  if (editingId) {
    const old = transactions.find(x => x.id === editingId);

    const accountIds = [
      old.accountId,
      old.fromAccountId,
      old.toAccountId,
      data.accountId,
      data.fromAccountId,
      data.toAccountId
    ].filter(Boolean);

    const impactDate = String(data.date) < String(old.date) ? data.date : old.date;
    const affected = affectedReconciliations(accountIds, impactDate);

    const impact = ["Recalculará saldos y reportes."];

    if (affected.length) {
      impact.push(`Invalidará ${affected.length} conciliación(es).`);
    }

    if (!await confirmAction({
      title: "Modificar movimiento",
      message: `${money(old.amount)} → ${money(data.amount)}`,
      impact
    })) return;

    await saveTransaction(data, editingId);
    toast("Movimiento actualizado.");
  } else if(recurringContext){
    await saveRecurringTransaction(recurringContext.recurring,recurringContext.occurrence,data);
    toast(recurringContext.recurring.type==="income"?"Ingreso recurrente registrado.":"Pago recurrente registrado.");
    recurringContext=null;
  } else {
    await saveTransaction(data);
    toast("Movimiento registrado.");
  }

  const rememberedAccount = data.type === "transfer" ? data.fromAccountId : data.accountId;
  if (rememberedAccount) localStorage.setItem(LAST_ACCOUNT_KEY, rememberedAccount);

  reset();
  await refresh();
});

tbody.addEventListener("click", async e => {
  const editButton = e.target.closest("[data-edit]");
  const deleteButton = e.target.closest("[data-delete]");

  if (editButton) {
    const tx = transactions.find(x => x.id === editButton.dataset.edit);
    editingId = tx.id;

    type.value = tx.type;
    toggleType();

    document.querySelector("#tx-date").value = tx.date;
    document.querySelector("#tx-time").value = transactionDateTime(tx).slice(11,16)||"00:00";
    document.querySelector("#tx-amount").value = tx.amount;
    document.querySelector("#tx-fee").value = Number(tx.feeAmount||0)||"";
    document.querySelector("#tx-tax").value = Number(tx.taxAmount||0)||"";
    document.querySelector("#tx-other-charge").value = Number(tx.otherChargeAmount||0)||"";
    document.querySelector("#tx-vat").value = tx.vat || 0;
    document.querySelector("#tx-has-invoice").checked = tx.type==="income" && (tx.hasInvoice===true || Number(tx.vat||0)>0);
    document.querySelector("#tx-invoice-number").value = tx.invoiceNumber || tx.receipt || "";
    document.querySelector("#tx-receipt").value = tx.receipt || "";
    document.querySelector("#tx-description").value = tx.description || "";
    toggleInvoice();

    if (tx.type === "transfer") {
      document.querySelector("#tx-from").value = tx.fromAccountId;
      document.querySelector("#tx-to").value = tx.toAccountId;
    } else {
      document.querySelector("#tx-account").value = tx.accountId;
      fillCategories(tx.category || "", tx.subcategory || "");
    }

    document.querySelector("#tx-split-enabled").checked = !!tx.splits?.length;
    document.querySelector("#split-rows").innerHTML = "";

    (tx.splits || []).forEach(split => {
      document.querySelector("#split-rows").appendChild(splitRow(split));
    });

    toggleSplit();
    updateSplitTotal();

    document.querySelector("#tx-cancel").hidden = false;
    document.querySelector("#tx-editor-title").textContent = "Editar movimiento";
    if (moreDetails) moreDetails.open = !!(tx.receipt || tx.hasInvoice || Number(tx.vat||0)>0 || tx.splits?.length);
    updateSaveButton();
    scrollTo({ top: 0, behavior: "smooth" });
  }

  if (deleteButton) {
    const tx = transactions.find(x => x.id === deleteButton.dataset.delete);
    const accountIds = [
      tx.accountId,
      tx.fromAccountId,
      tx.toAccountId
    ].filter(Boolean);

    const affected = affectedReconciliations(accountIds, tx.date);

    const impact = [
      "El movimiento desaparecerá y los saldos se recalcularán."
    ];

    if (affected.length) {
      impact.push(`Se invalidarán ${affected.length} conciliación(es).`);
    }

    if (await confirmAction({
      title: "Eliminar movimiento",
      message: `${tx.date} · ${money(tx.amount)}`,
      impact,
      danger: true,
      confirmText: "Eliminar"
    })) {
      try{
        await removeTransaction(tx.id);
        toast("Movimiento eliminado.");
        await refresh();
      }catch(err){
        toast(err?.message||"No se pudo eliminar el movimiento.");
      }
    }
  }
});

document.querySelector("#tx-date").value = todayISO();
document.querySelector("#tx-amount").value = "";
toggleType();
updateSaveButton();
requireUser(() => refresh().catch(console.error));
