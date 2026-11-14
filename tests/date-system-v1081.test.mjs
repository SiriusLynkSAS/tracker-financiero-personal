import fs from "node:fs";
import assert from "node:assert/strict";

const picker=fs.readFileSync(new URL("../js/date-picker.js",import.meta.url),"utf8");
const shell=fs.readFileSync(new URL("../js/app-shell.js",import.meta.url),"utf8");
const ui=fs.readFileSync(new URL("../js/ui.js",import.meta.url),"utf8");
const contracts=fs.readFileSync(new URL("../js/contracts.js",import.meta.url),"utf8");

assert.match(shell,/initDateOnlyPickers\(\)/,"app-shell debe inicializar el selector de fecha global");
assert.match(picker,/input\[type="date"\]/,"el selector debe cubrir inputs date");
assert.match(picker,/showPicker/,"debe usar el mismo picker nativo del editor de Movimientos");
assert.match(picker,/MutationObserver/,"debe cubrir fechas creadas dinámicamente");
assert.match(ui,/document\.createElement\("dialog"\)/,"confirmAction debe usar dialog top-layer");
assert.match(ui,/showModal\(\)/,"confirmAction debe abrirse sobre otros dialogs");
assert.match(contracts,/confirmAction\(\{title:"Actualizar fechas del contrato"/,"la confirmación contractual debe seguir siendo explícita");
console.log("date-system-v1081: OK");
