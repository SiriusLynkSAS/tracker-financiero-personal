import { requireUser } from "./guard.js";
import {
  listBudgets,
  listTransactions,
  listCategories,
  saveBudget,
  removeBudget
} from "./data-service.js";
import { money, monthBounds, escapeHtml } from "./utils.js";
import {
  sortCategoryRows,
  setCategorySelect,
  setSubcategorySelect
} from "./category-catalog.js";
import { confirmAction, toast } from "./ui.js";

let budgets = [];
let txs = [];
let cats = [];
let editingId = null;

const form = document.querySelector("#budget-form");
const tbody = document.querySelector("#budget-body");
const categorySelect = document.querySelector("#budget-category");
const subcategorySelect = document.querySelector("#budget-subcategory");

function fillCatalog(preferredCategory = "", preferredSubcategory = "") {
  const category = setCategorySelect(
    categorySelect,
    cats,
    "expense",
    preferredCategory
  );

  setSubcategorySelect(
    subcategorySelect,
    cats,
    "expense",
    category,
    preferredSubcategory
  );
}

function fillSubs(preferred = "") {
  setSubcategorySelect(
    subcategorySelect,
    cats,
    "expense",
    categorySelect.value,
    preferred
  );
}

function spent(cat, sub, start, end) {
  return txs
    .filter(t =>
      t.type === "expense" &&
      t.date >= start &&
      t.date <= end
    )
    .reduce((total, t) => {
      if (t.splits?.length) {
        return total + t.splits
          .filter(x => x.category === cat && x.subcategory === sub)
          .reduce((s, x) => s + Number(x.amount || 0), 0);
      }

      return total + (
        t.category === cat && t.subcategory === sub
          ? Number(t.amount || 0)
          : 0
      );
    }, 0);
}

function metrics(budget) {
  const now = new Date();
  const current = monthBounds(now);
  const previous = monthBounds(
    new Date(now.getFullYear(), now.getMonth() - 1, 1)
  );

  const currentSpent = spent(
    budget.category,
    budget.subcategory,
    current.start,
    current.end
  );

  const previousSpent = spent(
    budget.category,
    budget.subcategory,
    previous.start,
    previous.end
  );

  const carry = budget.rollover
    ? Math.max(0, Number(budget.limit) - previousSpent)
    : 0;

  const available = Number(budget.limit) + carry;

  return {
    carry,
    available,
    currentSpent,
    remaining: available - currentSpent
  };
}

function render() {
  const sortedBudgets = [...budgets].sort((a, b) =>
    a.category.localeCompare(b.category, "es", { sensitivity: "base" }) ||
    a.subcategory.localeCompare(b.subcategory, "es", { sensitivity: "base" })
  );

  tbody.innerHTML = sortedBudgets.map(b => {
    const m = metrics(b);

    return `
      <tr>
        <td>${escapeHtml(b.category)}</td>
        <td>${escapeHtml(b.subcategory)}</td>
        <td>${money(b.limit)}</td>
        <td>${b.rollover ? money(m.carry) : "No"}</td>
        <td>${money(m.available)}</td>
        <td>${money(m.currentSpent)}</td>
        <td class="${m.remaining < 0 ? "tf-negative" : ""}">
          ${money(m.remaining)}
        </td>
        <td>
          <div class="tf-actions">
            <button class="tf-btn tf-btn-secondary" data-edit="${b.id}">
              Editar
            </button>
            <button class="tf-btn tf-btn-danger" data-delete="${b.id}">
              Eliminar
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("") || `
    <tr>
      <td colspan="8" class="tf-empty">Sin presupuestos.</td>
    </tr>
  `;
}

async function refresh() {
  [budgets, txs, cats] = await Promise.all([
    listBudgets(),
    listTransactions(),
    listCategories()
  ]);

  cats = sortCategoryRows(cats);
  fillCatalog();
  render();
}

function reset() {
  editingId = null;
  form.reset();
  document.querySelector("#budget-cancel").hidden = true;
  fillCatalog();
}

categorySelect.addEventListener("change", () => fillSubs());
document.querySelector("#budget-cancel").addEventListener("click", reset);

form.addEventListener("submit", async e => {
  e.preventDefault();

  if (!categorySelect.value || !subcategorySelect.value) {
    return alert("Configura primero una categoría y subcategoría de egreso.");
  }

  const data = {
    category: categorySelect.value,
    subcategory: subcategorySelect.value,
    limit: Number(document.querySelector("#budget-limit").value),
    rollover: document.querySelector("#budget-rollover").checked,
    active: true
  };

  if (editingId && !await confirmAction({
    title: "Actualizar presupuesto",
    message: `Nuevo límite ${money(data.limit)}`,
    impact: ["No modifica movimientos históricos."]
  })) return;

  await saveBudget(data, editingId);
  toast("Presupuesto guardado.");
  reset();
  await refresh();
});

tbody.addEventListener("click", async e => {
  const editButton = e.target.closest("[data-edit]");
  const deleteButton = e.target.closest("[data-delete]");

  if (editButton) {
    const budget = budgets.find(x => x.id === editButton.dataset.edit);
    editingId = budget.id;

    fillCatalog(budget.category, budget.subcategory);
    document.querySelector("#budget-limit").value = budget.limit;
    document.querySelector("#budget-rollover").checked = !!budget.rollover;
    document.querySelector("#budget-cancel").hidden = false;
  }

  if (deleteButton && await confirmAction({
    title: "Eliminar presupuesto",
    message: "No se borrarán movimientos.",
    danger: true,
    confirmText: "Eliminar"
  })) {
    await removeBudget(deleteButton.dataset.delete);
    await refresh();
  }
});

requireUser(() => refresh().catch(console.error));
