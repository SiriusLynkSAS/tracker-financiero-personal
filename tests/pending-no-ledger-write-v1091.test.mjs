import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../js/data-service.js',import.meta.url),'utf8');
for(const name of ['closeRecurringOccurrenceHistorical','closeLiabilityInstallmentHistorical','closeFinancingPlanInstallmentHistorical']){
  const start=src.indexOf(`export async function ${name}`);
  assert.ok(start>=0,`${name} debe existir`);
  const next=src.indexOf('\nexport ',start+1);
  const block=src.slice(start,next<0?src.length:next);
  assert.doesNotMatch(block,/ref\("transactions"|col\("transactions"|collection\("transactions"/,`${name} no debe escribir Movimientos`);
}
console.log('pending-no-ledger-write-v1091: ok');
