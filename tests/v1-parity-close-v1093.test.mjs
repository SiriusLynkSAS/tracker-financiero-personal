import fs from "node:fs";
import assert from "node:assert/strict";

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const shell = read("js/app-shell.js");
const pending = read("js/pending.js");
const pendingPage = read("pendientes.Rmd");
const trips = read("js/business-trips.js");
const taxes = read("impuestos.Rmd");
const exportJs = read("js/import-export.js");
const categories = read("categorias.Rmd");
const goals = read("metas.Rmd");

assert.match(shell, /\[\s*["']pendientes["']\s*,\s*["']Pendientes["']/i, "Pendientes debe estar en navegación Web");
assert.match(pending, /buildBudgetAlerts/, "Pendientes Web debe integrar alertas de presupuesto");
assert.match(pendingPage, /data-pending-filter=["']budget["']/, "Debe existir filtro Presupuesto");
assert.match(trips, /updateTripExpenseRecognition/, "Viáticos Web debe permitir corregir valor reconocido");
assert.match(taxes, /facturacion\.html/, "IVA legacy debe redirigir a Facturación");
assert.match(exportJs, /version:["']1\.0\.93["']/, "Backup Web debe registrar la versión V1.0.93");
assert.match(categories, /<dialog id="category-create-panel"/, "Categorías Web debe usar modal de creación");
assert.match(categories, /<dialog id="category-style-panel"/, "Categorías Web debe usar modal de estilo");
assert.match(goals, /<dialog id="goal-editor"/, "Metas Web debe usar modal de edición");
console.log("V1 parity closeout Web OK");
