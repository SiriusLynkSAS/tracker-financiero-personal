import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,normalizeTransaction,normalizeBudget,normalizeLiability,
  sanitizeTransactionWrite,sanitizeBudgetWrite
} from '../js/schema.js';

const raw=JSON.parse(fs.readFileSync(process.argv[2]||'/mnt/data/tracker-financiero-auditoria-2026-11-06.json','utf8'));
const c=raw.collections;
const tx=c.transactions.documents.map(d=>({id:d.id,...d.data}));
const budgets=c.budgets.documents.map(d=>({id:d.id,...d.data}));
const debts=c.liabilities.documents.map(d=>({id:d.id,...d.data}));

const normalizedTx=tx.map(normalizeTransaction);
assert.equal(normalizedTx.filter(x=>x.legacyVatAmbiguous).length,23,'IVA legacy ambiguo');
assert.equal(normalizedTx.filter(x=>x.legacyVatAmbiguous && x.vat!==0).length,0,'IVA legacy efectivo debe quedar en 0 en memoria');
assert.equal(budgets.map(normalizeBudget).filter(x=>x.legacyPeriodMissing).length,2,'budgets legacy sin mes');
assert.equal(debts.map(normalizeLiability).filter(x=>x.legacyStatusConflict).length,1,'deuda active/status inconsistente');

const transfer=sanitizeTransactionWrite({type:'transfer',date:'2026-11-06',amount:10,vat:0,accountId:'SHOULD_CLEAR',fromAccountId:'A',toAccountId:'B'});
assert.equal(transfer.schemaVersion,SCHEMA_VERSION);
assert.equal(transfer.accountId,null);
assert.equal(transfer.fromAccountId,'A');
assert.equal(transfer.toAccountId,'B');

const expense=sanitizeTransactionWrite({type:'expense',date:'2026-11-06',amount:10,vat:0,accountId:'A',fromAccountId:'OLD',toAccountId:'OLD'});
assert.equal(expense.fromAccountId,null);
assert.equal(expense.toAccountId,null);

assert.throws(()=>sanitizeBudgetWrite({category:'Casa',subcategory:'Internet',limit:30,month:'',rollover:false}),/mes válido/);
const budget=sanitizeBudgetWrite({category:'Casa',subcategory:'Internet',limit:30,month:'2026-11',rollover:false});
assert.equal(budget.schemaVersion,SCHEMA_VERSION);

console.log('schema.test.mjs OK');
console.log(JSON.stringify({transactions:tx.length,legacyVatAmbiguous:23,budgetsLegacy:2,liabilityStatusConflict:1,schemaVersion:SCHEMA_VERSION},null,2));
