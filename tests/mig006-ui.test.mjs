import fs from 'node:fs';
import assert from 'node:assert/strict';
const js=fs.readFileSync(new URL('../js/mig006.js',import.meta.url),'utf8');
const rmd=fs.readFileSync(new URL('../recurrentes.Rmd',import.meta.url),'utf8');
// La lógica histórica se conserva para trazabilidad, pero la migración cerrada ya no se expone en la UI operativa.
assert.match(js,/u2XzlnZaKRqXHrucSaRi/);
assert.match(js,/keep_historical/);
assert.match(js,/aligned_to_template/);
assert.doesNotMatch(rmd,/Bloque 6 de 11 · MIG-006/);
assert.doesNotMatch(rmd,/id="mig006-panel"/);
assert.doesNotMatch(rmd,/js\/mig006\.js/);
console.log('mig006-ui.test.mjs OK · migración histórica sin superficie operativa');
