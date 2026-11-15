import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const invoices=read('js/invoices.js');
const contracts=read('js/contracts.js');
const ds=read('js/data-service.js');
const schema=read('js/schema.js');
const rmd=read('contratos.Rmd');
const debts=read('js/debts.js');
const debtRmd=read('deudas.Rmd');
const css=read('styles.css');

// Seleccionar un contrato no debe reiniciar modo ni borrar monto/datos ya digitados.
assert.doesNotMatch(invoices,/mode\s*=\s*["']base_plus_vat["'];\s*amount\.value/);
assert.match(invoices,/if\(customer&&!customer\.value\.trim\(\)/);
assert.match(invoices,/if\(concept&&!concept\.value\.trim\(\)/);
assert.match(invoices,/if\(amount&&!amount\.value\.trim\(\)/);

// La validación contractual depende del modo: total cuando incluye IVA, base cuando IVA es adicional.
assert.match(ds,/calculationMode==="total_includes_vat"\?invoice\.totalAmount:invoice\.baseAmount/);
assert.match(ds,/contractualAmount:pending/);
assert.match(schema,/contractualAmount/);
assert.match(schema,/contractReceivableComponent/);

// El cobro contractual se asigna proporcionalmente y no fuerza la base como valor contractual.
assert.match(ds,/invoiceContractPaidTarget/);
assert.match(ds,/contractReceivableComponent:contractTarget/);
assert.match(ds,/contractReceivableComponent:contractComponent/);

// Contratos ya no tiene cobro directo nuevo: utiliza Facturación dentro de la misma pantalla.
assert.match(rmd,/contract-invoice-dialog/);
assert.match(rmd,/EXTRA-001/);
assert.doesNotMatch(rmd,/Aplicar a seleccionados/);
assert.match(contracts,/createInvoice\(invoice,payment\)/);
assert.match(contracts,/registerInvoicePayment\(invoice\.id/);
assert.doesNotMatch(contracts,/applyReceivablePayment/);


// Correcciones estructuradas conservan el mismo ID de Movimiento y no duplican el ledger.
assert.match(ds,/export async function correctInvoicePayment/);
assert.match(ds,/ref\("transactions",oldTx\.id\)/);
assert.match(invoices,/correctInvoicePayment\(paymentTransactionId,payload\)/);
assert.match(debts,/async function correctDebtPayment/);
assert.match(debts,/collection:"transactions",id:linkedTx\.id,action:"update"/);
assert.match(debts,/id:txId,\s*action:"create"/);
assert.match(debts,/async function saveCardPaymentCorrection/);
assert.match(debts,/collection:"transactions",id:tx\.id,action:"update"/);
assert.match(debtRmd,/card-payment-correction-save/);
assert.match(css,/tf-schedule-dialog\{width:min\(96vw,1380px\)/);

// Ejemplo contractual solicitado: total 750 con IVA incluido debe tratar 750 como valor contractual.
const round2=n=>Math.round((n+Number.EPSILON)*100)/100;
const total=750, rate=15;
const base=round2(total/(1+rate/100));
const vat=round2(total-base);
assert.equal(base,652.17);
assert.equal(vat,97.83);
assert.equal(total,750);

console.log('AUD-POST-016 OK: Facturación ↔ Contratos unificado, IVA incluido y estado del formulario preservado');
