import { listCategories } from "./data-service.js";
import { escapeHtml } from "./utils.js";
import { defaultStyleForName } from "./category-icons.js";

export function normalizeText(value) {
  return String(value ?? "").trim();
}
export function compareEs(a, b) {
  return normalizeText(a).localeCompare(normalizeText(b), "es", { sensitivity:"base", numeric:true });
}
export function sortCategoryRows(rows=[]) {
  return [...rows].sort((a,b) =>
    compareEs(a.category,b.category) ||
    compareEs(a.subcategory,b.subcategory) ||
    compareEs(a.type,b.type)
  );
}
export function categoriesForType(rows=[], type="expense") {
  return [...new Set(rows.filter(r=>r.type===type).map(r=>normalizeText(r.category)).filter(Boolean))].sort(compareEs);
}
export function subcategoriesFor(rows=[], type="expense", category="") {
  return [...new Set(rows.filter(r=>r.type===type && normalizeText(r.category)===normalizeText(category)).map(r=>normalizeText(r.subcategory)).filter(Boolean))].sort(compareEs);
}
export function categoryStyle(rows=[], type="expense", category="") {
  const row = rows.find(r => r.type===type && normalizeText(r.category)===normalizeText(category));
  const fallback = defaultStyleForName(category,type);
  return {
    icon: row?.icon || fallback.icon,
    color: row?.color || fallback.color
  };
}
export function setCategorySelect(select, rows, type, preferred="") {
  const categories=categoriesForType(rows,type);
  select.innerHTML=categories.length
    ? categories.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")
    : `<option value="">Sin categorías configuradas</option>`;
  if(preferred && categories.includes(preferred)) select.value=preferred;
  return select.value;
}
export function setSubcategorySelect(select, rows, type, category, preferred="") {
  const subs=subcategoriesFor(rows,type,category);
  select.innerHTML=subs.length
    ? subs.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")
    : `<option value="">Sin subcategorías configuradas</option>`;
  if(preferred && subs.includes(preferred)) select.value=preferred;
  return select.value;
}
export async function loadSortedCategories(){return sortCategoryRows(await listCategories())}
