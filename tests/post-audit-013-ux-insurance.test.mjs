import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

const plan=read('plan_mensual.Rmd');
assert.match(plan,/tf-plan-dual-summary/);
assert.match(plan,/grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/,'Plan/Ejecución deben quedar en dos columnas en escritorio');

const emergency=read('fondo_emergencia.Rmd');
assert.match(emergency,/id="ef-accounts-open"/);
assert.match(emergency,/id="ef-accounts-dialog"/);
assert.match(emergency,/id="ef-essential-open"/);
assert.match(emergency,/id="ef-essential-dialog"/);

const goals=read('metas.Rmd');
assert.match(goals,/<table class="tf-table tf-goal-table">/,'Metas debe usar tabla');
assert.match(goals,/id="goal-detail-dialog"/);

const debts=read('deudas.Rmd');
assert.match(debts,/id="card-debt-list"/);
assert.match(debts,/Planes financiados/);
assert.match(debts,/id="debt-detail-dialog"/);

const insurance=read('seguros.Rmd');
assert.match(insurance,/Registrar cobertura/);
assert.match(insurance,/id="coverage-list"/);
assert.match(insurance,/id="coverage-paid"/);
assert.match(insurance,/id="coverage-covered"/);
assert.match(insurance,/id="coverage-total"/);

const schema=read('js/schema.js');
assert.match(schema,/insuranceUsageId/);
assert.match(schema,/insurancePolicyId/);
const service=read('js/data-service.js');
assert.match(service,/registerInsuranceCoverage/);
assert.match(service,/writeBatch\(db\)/);
assert.match(service,/insuranceUsageId/);
const tx=read('js/transactions-v1.js');
assert.match(tx,/seguros\.html/);
assert.match(tx,/insuranceUsageId/);
console.log('AUD-POST-013 web structure OK');
