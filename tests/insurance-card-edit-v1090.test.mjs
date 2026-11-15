import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

const insurance=read('js/insurance.js');
assert.doesNotMatch(insurance,/accountType\s*!==\s*["']credit_card["']/,'Seguros no debe excluir tarjetas de crédito');
assert.match(insurance,/correctInsurancePremiumPayment/);
assert.match(insurance,/data-premium-edit/);
assert.match(insurance,/premiumPayments\(policy\)/);
assert.match(insurance,/Tarjeta de crédito/);

const service=read('js/data-service.js');
assert.match(service,/export async function correctInsurancePremiumPayment/);
assert.match(service,/Ya existe una prima registrada para el mes seleccionado/);
assert.match(service,/insurance_premium_corrected/);
assert.match(service,/corresponde a una prima de seguro\. Modifícalo desde Seguros/);

const page=read('seguros.Rmd');
assert.match(page,/id="premium-transaction-id"/);
assert.match(page,/id="premium-amount"[^>]+type="number"/);
assert.match(page,/Cuenta \/ tarjeta de pago/);
assert.match(page,/id="premium-mode-note"/);

const tx=read('js/transactions-v1.js');
assert.match(tx,/tx\.insurancePolicyId&&tx\.recurringId/);
assert.match(tx,/href="seguros\.html"/);
console.log('Insurance cards + premium correction V1.0.90 OK');
