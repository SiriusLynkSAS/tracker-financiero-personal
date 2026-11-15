import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {contractPeriodCalculation,contractDesiredPeriodKeys,contractBillingCycleMode} from '../js/contract-math.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const anniversary={startDate:'2026-05-29',endDate:'',active:true,initialMonthlyRate:750,tariffPeriods:[],billingCycleMode:'anniversary'};
let c=contractPeriodCalculation(anniversary,'2026-05');
assert.equal(c.serviceStart,'2026-05-29');
assert.equal(c.serviceEnd,'2026-06-28');
assert.equal(c.amount,750);
assert.equal(c.prorated,false);
c=contractPeriodCalculation(anniversary,'2026-06');
assert.equal(c.serviceStart,'2026-06-29');
assert.equal(c.serviceEnd,'2026-07-28');
assert.equal(c.amount,750);
assert.deepEqual(contractDesiredPeriodKeys(anniversary,'2026-06-28'),['2026-05']);
assert.deepEqual(contractDesiredPeriodKeys(anniversary,'2026-07-28'),['2026-05','2026-06']);

const endMonth={...anniversary,startDate:'2026-01-31'};
assert.deepEqual(
  ['2026-01','2026-02','2026-03'].map(p=>{
    const x=contractPeriodCalculation(endMonth,p);return [x.serviceStart,x.serviceEnd];
  }),
  [['2026-01-31','2026-02-27'],['2026-02-28','2026-03-30'],['2026-03-31','2026-04-29']],
  'El día ancla debe recuperarse cuando el mes vuelve a soportarlo'
);

const legacy={startDate:'2026-05-29',endDate:'',active:true,initialMonthlyRate:750,tariffPeriods:[]};
assert.equal(contractBillingCycleMode(legacy),'calendar_month');
c=contractPeriodCalculation(legacy,'2026-05');
assert.equal(c.serviceStart,'2026-05-29');
assert.equal(c.serviceEnd,'2026-05-31');
assert.equal(c.prorated,true);

const contracts=read('contratos.Rmd');
const trips=read('comisiones.Rmd');
const movements=read('movimientos.Rmd');
const invoicing=read('facturacion.Rmd');
const debts=read('deudas.Rmd');
const shell=read('js/app-shell.js');
const ds=read('js/data-service.js');

assert.match(contracts,/contract-cycle-mode/);
assert.match(contracts,/Ciclo aniversario/);
assert.doesNotMatch(contracts,/id=["']tariff-contract["']/);
assert.match(trips,/Número de factura \/ comprobante/);
assert.match(trips,/trip-expense-category/);
assert.match(movements,/Movimiento con factura \/ IVA/);
assert.match(invoicing,/id=["']iva["']/);
assert.match(invoicing,/taxes\.js\?v=1\.0\.87/);
assert.doesNotMatch(shell,/href:\s*["']impuestos\.html["']/);
assert.match(debts,/id=["']debt-schedule-card["']/);
assert.match(debts,/id=["']card-schedule-card["']/);
assert.match(ds,/insuranceUsageId/);
assert.match(ds,/tripExpenseId/);
assert.match(ds,/generatedVat/);
assert.match(ds,/creditVat/);

console.log('AUD-POST-014 OK: contratos anniversary/calendar + viáticos + IVA + cronogramas');
