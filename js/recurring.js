import { requireUser } from "./guard.js";
import {
  listRecurring,
  saveRecurring,
  archiveRecurring,
  listAccounts,
  listCategories,
  saveTransaction
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

function render() {
  list.innerHTML = rows
    .filter(r => r.active !== false)
    .map(r => `
      <div class="tf-card">
        <strong>${escapeHtml(r.name)}</strong>
        <div class="tf-muted">
          ${r.type === "expense" ? "Egreso" : "Ingreso"}
          · ${money(r.amount)}
          · día ${r.dayOfMonth}
        </div>
        <div style="margin:.6rem 0">
          ${escapeHtml(r.category || "—")}
          ${r.subcategory ? ` > ${escapeHtml(r.subcategory)}` : ""}
          <br>
          Próximo: <strong>${nextDue(r)}</strong>
          <br>
          ${escapeHtml(accountLabel(r.accountId))}
        </div>
        <div class="tf-actions">
          <button class="tf-btn tf-btn-primary" data-post="${r.id}">
            Registrar ahora
          </button>
          <button class="tf-btn tf-btn-secondary" data-archive="${r.id}">
            Archivar
          </button>
        </div>
      </div>
    `).join("") || `
      <div class="tf-card tf-empty">Sin recurrentes activos.</div>
    `;
}

async function refresh() {
  [rows, accounts, categories] = await Promise.all([
    listRecurring(),
    listAccounts({ includeArchived: false }),
    listCategories()
  ]);

  categories = sortCategoryRows(categories);

  document.querySelector("#rec-account").innerHTML = accounts
    .map(a =>
      `<option value="${a.id}">${escapeHtml(accountLabel(a.id))}</option>`
    ).join("");

  fillCategoryCatalog();
  render();
}

typeSelect.addEventListener("change", () => fillCategoryCatalog());
categorySelect.addEventListener("change", () => fillSubcategories());

document.querySelector("#rec-start").value = todayISO();

document.querySelector("#rec-form").addEventListener("submit", async e => {
  e.preventDefault();

  if (!categorySelect.value || !subcategorySelect.value) {
    return alert(
      "Configura primero una categoría y subcategoría para este tipo de movimiento."
    );
  }

  await saveRecurring({
    name: document.querySelector("#rec-name").value.trim(),
    type: typeSelect.value,
    amount: Number(document.querySelector("#rec-amount").value),
    accountId: document.querySelector("#rec-account").value,
    category: categorySelect.value,
    subcategory: subcategorySelect.value,
    dayOfMonth: Number(document.querySelector("#rec-day").value),
    reminderDaysBefore: Number(
      document.querySelector("#rec-reminder").value
    ),
    startDate: document.querySelector("#rec-start").value,
    endDate: document.querySelector("#rec-end").value || null,
    active: true
  });

  e.target.reset();
  document.querySelector("#rec-start").value = todayISO();
  fillCategoryCatalog();
  toast("Recurrente guardado.");
  await refresh();
});

list.addEventListener("click", async e => {
  const postButton = e.target.closest("[data-post]");
  const archiveButton = e.target.closest("[data-archive]");

  if (postButton) {
    const recurring = rows.find(x => x.id === postButton.dataset.post);

    if (await confirmAction({
      title: "Registrar recurrente",
      message: `${recurring.name} · ${money(recurring.amount)}`,
      impact: ["Creará una transacción real."]
    })) {
      await saveTransaction({
        type: recurring.type,
        date: todayISO(),
        amount: recurring.amount,
        vat: 0,
        receipt: "",
        description: recurring.name,
        category: recurring.category,
        subcategory: recurring.subcategory,
        accountId: recurring.accountId,
        fromAccountId: null,
        toAccountId: null,
        splits: [],
        recurringId: recurring.id
      });

      toast("Movimiento registrado.");
    }
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
