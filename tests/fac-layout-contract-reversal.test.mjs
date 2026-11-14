import fs from 'node:fs';
import assert from 'node:assert/strict';
import {normalizeTransaction,sanitizeTransactionWrite} from '../js/schema.js';

const normalized=normalizeTransaction({
  type:'income',date:'2026-11-14',amount:750,accountId:'A',contractPaymentId:'PAY',
  contractId:'C',contractAllocations:[{receivableId:'R',contractId:'C',workPeriod:'2026-06',amount:750}]
});
assert.equal(normalized.contractId,'C');
assert.equal(normalized.contractAllocations.length,1);
assert.equal(normalized.contractAllocations[0].receivableId,'R');
assert.equal(normalized.contractAllocations[0].amount,750);

const written=sanitizeTransactionWrite({
  type:'income',date:'2026-11-14',amount:750,accountId:'A',contractPaymentId:'PAY',
  contractId:'C',contractAllocations:[{receivableId:'R',contractId:'C',workPeriod:'2026-06',amount:750}]
});
assert.equal(written.contractAllocations.length,1);
assert.equal(written.contractAllocations[0].workPeriod,'2026-06');

const rmd=fs.readFileSync(new URL('../facturacion.Rmd',import.meta.url),'utf8');
for(const required of [
  'tf-invoice-static-pane','data-invoice-mode="base_plus_vat"','>Más IVA<','>Incluye IVA<',
  'tf-invoice-details-scroll','tf-invoice-save-bar','id="invoice-editor-close-x"','>Cerrar<',
  'id="invoice-editor-close"','>Cancelar<','id="invoice-editor-save"','>Guardar factura<'
]) assert.ok(rmd.includes(required),`Falta estructura UI: ${required}`);

const service=fs.readFileSync(new URL('../js/data-service.js',import.meta.url),'utf8');
assert.ok(service.includes('await getDoc(ref("transactions",id))'),'La reversión debe releer el movimiento crudo');
assert.ok(service.includes('No se eliminó ningún dato'),'La reversión debe fallar de forma segura');

console.log('fac-layout-contract-reversal.test.mjs OK');
