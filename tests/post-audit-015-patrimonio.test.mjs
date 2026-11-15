import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

const schema=read('js/schema.js');
const ds=read('js/data-service.js');
const plan=read('js/planning.js');
const dash=read('js/dashboard-v1.js');
const assets=read('activos.Rmd');
const investments=read('inversiones.Rmd');
const insurance=read('seguros.Rmd');
const ef=read('fondo_emergencia.Rmd');
const efjs=read('js/emergency-fund.js');

assert.match(schema,/assetId:text\(raw\.assetId\)/);
assert.match(schema,/assetId:nullableText\(row\.assetId\)/);
assert.match(ds,/createAssetWithPurchase/);
assert.match(ds,/addAssetEventWithMovement/);
assert.match(ds,/assetId:assetRef\.id/);
assert.match(ds,/old\.assetId/);
assert.match(ds,/row\?\.assetId/);
assert.match(assets,/asset-historical/);
assert.match(assets,/asset-account/);
assert.match(assets,/event-account/);

assert.match(ds,/const tx=holdingAccountId/);
assert.match(ds,/sanitizeTransactionWrite\(\{type:"transfer"/);
assert.match(ds,/type:"investment_out"/);
assert.match(ds,/La cuenta seleccionada ya respalda la inversión activa/);
assert.match(plan,/monthTx\.filter\(t=>t\.type==="expense"\)/);
assert.doesNotMatch(plan,/t\.type==="expense"\|\|t\.type==="investment_out"/);
assert.match(dash,/!holdingIds\.has\(String\(a\.id\)\)/);
assert.match(dash,/i\.holdingAccountId\?Math\.max/);
assert.match(investments,/inv-holding-account/);
assert.match(ef,/ef-secondary/);
assert.match(efjs,/balances\[i\.holdingAccountId\]/);

assert.match(ds,/insurance_premium/);
assert.match(ds,/saveRecurringTransaction/);
assert.match(insurance,/ins-premium-account/);
assert.match(insurance,/Registrar prima/);
assert.match(plan,/insuranceWithLinkedEssential/);

console.log('AUD-POST-015 OK: patrimonio sin doble conteo + activos/inversiones/seguros vinculados');
