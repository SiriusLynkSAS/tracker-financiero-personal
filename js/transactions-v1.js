import { requireUser } from "./guard.js";
import {
  listAccounts,
  listTransactions,
  listCategories,
  saveTransaction,
  removeTransaction,
  listReconciliations,
  saveReconciliation
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
let editingId = null;

const form = document.querySelector("#tx-form");
const tbody = document.querySelector("#tx-body");
const type = document.querySelector("#tx-type");
const filter = document.querySelector("#filter-account");

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

function fillAccounts() {
  const options = activeAccounts().map(a =>
    `<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`
  ).join("");

  ["tx-account", "tx-from", "tx-to"].forEach(id => {
    document.querySelector(`#${id}`).innerHTML = options;
  });

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
}

function toggleType() {
  const isTransfer = type.value === "transfer";

  document.querySelector("#single-account-fields").hidden = isTransfer;
  document.querySelector("#transfer-fields").hidden = !isTransfer;
  document.querySelector("#category-fields").hidden = isTransfer;
  document.querySelector("#split-toggle-wrap").hidden = isTransfer;

  if (isTransfer) {
    document.querySelector("#tx-split-enabled").checked = false;
    toggleSplit();
  } else {
    fillCategories();
    refreshSplitCatalogs();
  }
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
        value="${Number(data.amount || 0)}"
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
    `${money(document.querySelector("#tx-amount").value)}`;
}

function collectSplits() {
  return [...document.querySelectorAll(".tf-split-row")]
    .map(row => ({
      category: row.querySelector("[data-split-cat]").value,
      subcategory: row.querySelector("[data-split-sub]").value,
      amount: Number(row.querySelector("[data-split-amount]").value || 0)
    }))
    .filter(x => x.amount > 0);
}

function reset() {
  editingId = null;
  form.reset();

  document.querySelector("#tx-date").value = todayISO();
  type.value = "expense";
  document.querySelector("#tx-amount").value = 0;
  document.querySelector("#tx-vat").value = 0;
  document.querySelector("#split-rows").innerHTML = "";
  document.querySelector("#tx-cancel").hidden = true;
  document.querySelector("#tx-submit").textContent = "Guardar movimiento";

  toggleType();
  toggleSplit();
}

function visibleTransactions() {
  if (filter.value === "all") return transactions;

  return transactions.filter(t =>
    t.accountId === filter.value ||
    t.fromAccountId === filter.value ||
    t.toAccountId === filter.value
  );
}

function render() {
  tbody.innerHTML = visibleTransactions().map(tx => `
    <tr>
      <td>${escapeHtml(tx.date)}</td>
      <td><span class="tf-pill">${escapeHtml(txLabel(tx.type))}</span></td>
      <td>${escapeHtml(
        tx.type === "transfer"
          ? `${accountName(tx.fromAccountId)} → ${accountName(tx.toAccountId)}`
          : accountName(tx.accountId)
      )}</td>
      <td>${escapeHtml(
        tx.splits?.length
          ? `${tx.splits.length} divisiones`
          : tx.category || "—"
      )}</td>
      <td>${escapeHtml(tx.description || "—")}</td>
      <td>${money(tx.amount)}</td>
      <td>
        <div class="tf-actions">
          <button class="tf-btn tf-btn-secondary" data-edit="${tx.id}">
            Editar
          </button>
          <button class="tf-btn tf-btn-danger" data-delete="${tx.id}">
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  `).join("") || `
    <tr><td colspan="7" class="tf-empty">No hay movimientos.</td></tr>
  `;
}

async function invalidate(accountIds, date) {
  const affected = reconciliations.filter(r =>
    accountIds.includes(r.accountId) &&
    r.status === "reconciled" &&
    String(r.date) >= String(date)
  );

  for (const r of affected) {
    await saveReconciliation({ ...r, status: "invalidated" }, r.id);
  }

  return affected.length;
}

async function refresh() {
  [accounts, transactions, categories, reconciliations] = await Promise.all([
    listAccounts(),
    listTransactions(),
    listCategories(),
    listReconciliations()
  ]);

  categories = sortCategoryRows(categories);
  fillAccounts();
  fillCategories();
  refreshSplitCatalogs();
  render();
}

type.addEventListener("change", toggleType);
document.querySelector("#tx-category").addEventListener("change", () => fillSubs());
filter.addEventListener("change", render);
document.querySelector("#tx-split-enabled").addEventListener("change", toggleSplit);
document.querySelector("#tx-amount").addEventListener("input", updateSplitTotal);

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

document.querySelector("#tx-cancel").addEventListener("click", reset);

form.addEventListener("submit", async e => {
  e.preventDefault();

  const amount = Number(document.querySelector("#tx-amount").value);
  const vat = Number(document.querySelector("#tx-vat").value || 0);

  if (!(amount > 0)) return alert("El monto debe ser mayor que cero.");
  if (vat < 0 || vat > amount) return alert("IVA inválido.");

  const data = {
    type: type.value,
    date: document.querySelector("#tx-date").value,
    amount,
    vat,
    receipt: document.querySelector("#tx-receipt").value.trim(),
    description: document.querySelector("#tx-description").value.trim(),
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

    const affected = reconciliations.filter(r =>
      accountIds.includes(r.accountId) &&
      r.status === "reconciled" &&
      String(r.date) >= String(old.date)
    );

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
    const impactDate = String(data.date) < String(old.date) ? data.date : old.date;
    await invalidate([...new Set(accountIds)], impactDate);
    toast("Movimiento actualizado.");
  } else {
    await saveTransaction(data);
    toast("Movimiento registrado.");
  }

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
    document.querySelector("#tx-amount").value = tx.amount;
    document.querySelector("#tx-vat").value = tx.vat || 0;
    document.querySelector("#tx-receipt").value = tx.receipt || "";
    document.querySelector("#tx-description").value = tx.description || "";

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
    document.querySelector("#tx-submit").textContent = "Actualizar movimiento";
    scrollTo({ top: 0, behavior: "smooth" });
  }

  if (deleteButton) {
    const tx = transactions.find(x => x.id === deleteButton.dataset.delete);
    const accountIds = [
      tx.accountId,
      tx.fromAccountId,
      tx.toAccountId
    ].filter(Boolean);

    const affected = reconciliations.filter(r =>
      accountIds.includes(r.accountId) &&
      r.status === "reconciled" &&
      String(r.date) >= String(tx.date)
    );

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
      await removeTransaction(tx.id);
      await invalidate(accountIds, tx.date);
      toast("Movimiento eliminado.");
      await refresh();
    }
  }
});

document.querySelector("#tx-date").value = todayISO();
toggleType();
requireUser(() => refresh().catch(console.error));
