import { requireUser } from "./guard.js";
import {
  listRecurring,
  saveRecurring,
  archiveRecurring,
  listAccounts,
  listCategories,
  listTransactions
} from "./data-service.js";
import {
  money,
  escapeHtml,
  todayISO,
  isoFromParts
} from "./utils.js";
import {
  sortCategoryRows,
  setCategorySelect,
  setSubcategorySelect
} from "./category-catalog.js";
import { confirmAction, toast } from "./ui.js";

let rows = [];
let accounts = [];
let categories = [];
let transactions = [];
let editingId = null;

const list = document.querySelector("#rec-list");
const typeSelect = document.querySelector("#rec-type");
const categorySelect = document.querySelector("#rec-category");
const subcategorySelect = document.querySelector("#rec-subcategory");

function accountLabel(id) {
  const a = accounts.find(x => x.id === id);
  return a ? `${a.bank} · ${a.alias}` : "—";
}

function fillCategoryCatalog(
  preferredCategory = "",
  preferredSubcategory = ""
) {
  const type = typeSelect.value;

  const category = setCategorySelect(
    categorySelect,
    categories,
    type,
    preferredCategory
  );

  setSubcategorySelect(
    subcategorySelect,
    categories,
    type,
    category,
    preferredSubcategory
  );
}

function fillSubcategories(preferred = "") {
  setSubcategorySelect(
    subcategorySelect,
    categories,
    typeSelect.value,
    categorySelect.value,
    preferred
  );
}

function nextDue(r) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  let day = Math.min(
    Number(r.dayOfMonth || 1),
    new Date(y, m, 0).getDate()
  );

  let iso = isoFromParts(y, m, day);

  if (iso < todayISO()) {
    const next = new Date(y, m, 1);

    day = Math.min(
      Number(r.dayOfMonth || 1),
      new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
    );

    iso = isoFromParts(
      next.getFullYear(),
      next.getMonth() + 1,
      day
    );
  }

  return iso;
}

function currentOccurrence(r){
  const today=todayISO();
  const ym=today.slice(0,7);
  const [y,m]=ym.split("-").map(Number);
  const day=Math.min(Number(r.dayOfMonth||1),new Date(y,m,0).getDate());
  return {month:ym,dueDate:isoFromParts(y,m,day)};
}
function executionFor(r,occurrence){
  return transactions.find(t=>t.recurringId===r.id && ((t.recurringOccurrence||String(t.date||"").slice(0,7))===occurrence));
}

function render() {
  list.innerHTML = rows.filter(r=>r.active!==false).map(r=>{
    const occ=currentOccurrence(r);
    const tx=executionFor(r,occ.month);
    const verb=r.type==="expense"?"pago":"ingreso";
    return `<div class="tf-card">
      <div class="tf-section-heading"><div><strong>${escapeHtml(r.name)}</strong><div class="tf-muted">${r.type==="expense"?"Egreso":"Ingreso"} recurrente · ${money(r.amount)}</div></div><span class="tf-pill ${tx?"tf-pill-ok":"tf-pill-warn"}">${tx?(r.type==="expense"?"Pagado":"Recibido"):"Pendiente"}</span></div>
      <div style="margin:.6rem 0">${escapeHtml(r.category||"—")}${r.subcategory?` · ${escapeHtml(r.subcategory)}`:""}<br>Ocurrencia: <strong>${occ.month}</strong> · vence ${occ.dueDate}${r.accountId?`<br>Cuenta habitual: ${escapeHtml(accountLabel(r.accountId))}`:""}</div>
      ${tx?`<div class="tf-alert tf-alert-info">Registrado ${escapeHtml(tx.date||"")} · ${money(tx.amount)} · ${escapeHtml(accountLabel(tx.accountId))}</div>`:""}
      <div class="tf-actions">
        ${tx?`<a class="tf-btn tf-btn-secondary" href="movimientos.html?focus=${tx.id}">Ver movimiento</a>`:`<a class="tf-btn tf-btn-primary" href="movimientos.html?recurring=${encodeURIComponent(r.id)}&occurrence=${occ.month}">${r.type==="expense"?"Registrar pago":"Registrar ingreso"}</a>`}
        <button class="tf-btn tf-btn-secondary" data-edit="${r.id}">Editar</button>
        <button class="tf-btn tf-btn-secondary" data-archive="${r.id}">Archivar</button>
      </div>
    </div>`;
  }).join("") || `<div class="tf-card tf-empty">Sin recurrentes activos.</div>`;
}
async function refresh() {
  [rows, accounts, categories, transactions] = await Promise.all([
    listRecurring(), listAccounts({ includeArchived: false }), listCategories(), listTransactions()
  ]);

  categories = sortCategoryRows(categories);

  document.querySelector("#rec-account").innerHTML = `<option value="">Sin cuenta habitual</option>` + accounts
    .map(a => `<option value="${a.id}">${escapeHtml(accountLabel(a.id))}</option>`).join("");

  fillCategoryCatalog();
  render();
}

function resetForm(){
  editingId=null;
  document.querySelector("#rec-form").reset();
  document.querySelector("#rec-start").value=todayISO();
  document.querySelector("#rec-day").value=1;
  document.querySelector("#rec-reminder").value=3;
  document.querySelector("#rec-submit").textContent="Guardar recurrente";
  document.querySelector("#rec-cancel").hidden=true;
  typeSelect.value="expense";
  fillCategoryCatalog();
}

typeSelect.addEventListener("change", () => fillCategoryCatalog());
categorySelect.addEventListener("change", () => fillSubcategories());

document.querySelector("#rec-start").value = todayISO();
document.querySelector("#rec-cancel").addEventListener("click", resetForm);

document.querySelector("#rec-form").addEventListener("submit", async e => {
  e.preventDefault();

  if (!categorySelect.value || !subcategorySelect.value) {
    return alert(
      "Configura primero una categoría y subcategoría para este tipo de movimiento."
    );
  }

  const data={
    name:document.querySelector("#rec-name").value.trim(),
    type:typeSelect.value,
    amount:Number(document.querySelector("#rec-amount").value),
    accountId:document.querySelector("#rec-account").value,
    category:categorySelect.value,
    subcategory:subcategorySelect.value,
    dayOfMonth:Number(document.querySelector("#rec-day").value),
    reminderDaysBefore:Number(document.querySelector("#rec-reminder").value),
    startDate:document.querySelector("#rec-start").value,
    endDate:document.querySelector("#rec-end").value||null,
    active:true
  };
  if(!(data.amount>0))return alert("El monto debe ser mayor que cero.");
  if(editingId&&!await confirmAction({title:"Actualizar recurrente",message:`${data.name} · ${money(data.amount)}`,impact:["Los compromisos futuros usarán los nuevos datos.","No modifica movimientos ya registrados."]}))return;
  await saveRecurring(data,editingId);
  const wasEditing=!!editingId;
  resetForm();
  toast(wasEditing?"Recurrente actualizado.":"Recurrente guardado.");
  await refresh();
});

list.addEventListener("click", async e => {
  const editButton = e.target.closest("[data-edit]");
  const archiveButton = e.target.closest("[data-archive]");

  if(editButton){
    const r=rows.find(x=>x.id===editButton.dataset.edit);if(!r)return;
    editingId=r.id;
    document.querySelector("#rec-name").value=r.name||"";
    typeSelect.value=r.type||"expense";
    document.querySelector("#rec-amount").value=Number(r.amount||0);
    document.querySelector("#rec-account").value=r.accountId||"";
    fillCategoryCatalog(r.category||"",r.subcategory||"");
    document.querySelector("#rec-day").value=Number(r.dayOfMonth||1);
    document.querySelector("#rec-reminder").value=Number(r.reminderDaysBefore||0);
    document.querySelector("#rec-start").value=r.startDate||todayISO();
    document.querySelector("#rec-end").value=r.endDate||"";
    document.querySelector("#rec-submit").textContent="Actualizar recurrente";
    document.querySelector("#rec-cancel").hidden=false;
    scrollTo({top:0,behavior:"smooth"});
  }

  if (
    archiveButton &&
    await confirmAction({
      title: "Archivar recurrente",
      message: "Dejará de generar compromisos futuros.",
      confirmText: "Archivar"
    })
  ) {
    await archiveRecurring(archiveButton.dataset.archive);
    await refresh();
  }
});

requireUser(() => refresh().catch(console.error));
