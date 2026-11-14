import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,normalizeAccount,normalizeTransaction,normalizeBudget,normalizeLiability,normalizeInvoice,
  sanitizeAccountWrite,sanitizeTransactionWrite,sanitizeBudgetWrite,sanitizeInvoiceWrite
} from '../js/schema.js';

const raw=JSON.parse(fs.readFileSync(process.argv[2]||'/mnt/data/tracker-financiero-auditoria-2026-11-06.json','utf8'));
const c=raw.collections;
const accounts=c.accounts.documents.map(d=>({id:d.id,...d.data}));
const tx=c.transactions.documents.map(d=>({id:d.id,...d.data}));
const budgets=c.budgets.documents.map(d=>({id:d.id,...d.data}));
const debts=c.liabilities.documents.map(d=>({id:d.id,...d.data}));

const normalizedAccounts=accounts.map(normalizeAccount);
const expectedLegacyAccountDates=accounts.filter(x=>!String(x.openingBalanceAsOf||x.ledgerStartDate||'').trim()).length;
assert.equal(normalizedAccounts.filter(x=>x.legacyOpeningBalanceAsOfMissing).length,expectedLegacyAccountDates,'cuentas legacy sin fecha base');
const sampleAccount=sanitizeAccountWrite({bank:'Banco',alias:'Ahorros',accountType:'savings',openingBalance:100,openingBalanceAsOf:'2026-08-31'});
assert.equal(sampleAccount.openingBalanceAsOf,'2026-08-31');
assert.equal(sampleAccount.ledgerStartDate,'2026-08-31');
assert.throws(()=>sanitizeAccountWrite({bank:'Banco',alias:'Ahorros',accountType:'savings',openingBalance:100,openingBalanceAsOf:'31/08/2026'}),/Fecha base/);

const normalizedTx=tx.map(normalizeTransaction);
assert.equal(normalizedTx.filter(x=>x.legacyVatAmbiguous).length,23,'IVA legacy ambiguo');
assert.equal(normalizedTx.filter(x=>x.legacyVatAmbiguous && x.vat!==0).length,0,'IVA legacy efectivo debe quedar en 0 en memoria');

const legacyWithoutDateTime=tx.filter(x=>!String(x.transactionDateTime||'').trim());
assert.equal(normalizedTx.filter(x=>x.dateTimeInferred).length,legacyWithoutDateTime.length,'movimientos legacy sin hora');
assert.equal(normalizedTx.filter(x=>x.dateTimeInferred && x.transactionDateTime).length,0,'no inventar 00:00 para legacy');
const legacyNoTimeWrite=sanitizeTransactionWrite({type:'expense',date:'2026-11-06',amount:10,vat:0,accountId:'A'});
assert.equal(Object.prototype.hasOwnProperty.call(legacyNoTimeWrite,'transactionDateTime'),false,'escritura sin hora no debe inventar transactionDateTime');
const exactTimeWrite=sanitizeTransactionWrite({type:'expense',date:'2026-11-06',transactionDateTime:'2026-11-06T14:35',amount:10,vat:0,accountId:'A'});
assert.equal(exactTimeWrite.transactionDateTime,'2026-11-06T14:35');
assert.throws(()=>sanitizeTransactionWrite({type:'expense',date:'2026-11-06',transactionDateTime:'2026-11-07T14:35',amount:10,vat:0,accountId:'A'}),/no coinciden/);

const expectedLegacyBudgets=budgets.filter(x=>!String(x.month||'').trim()).length;
assert.equal(budgets.map(normalizeBudget).filter(x=>x.legacyPeriodMissing).length,expectedLegacyBudgets,'budgets legacy sin mes');
assert.equal(debts.map(normalizeLiability).filter(x=>x.legacyStatusConflict).length,1,'deuda active/status inconsistente');

const transfer=sanitizeTransactionWrite({type:'transfer',date:'2026-11-06',amount:10,vat:0,accountId:'SHOULD_CLEAR',fromAccountId:'A',toAccountId:'B'});
assert.equal(transfer.schemaVersion,SCHEMA_VERSION);
assert.equal(transfer.accountId,null);
assert.equal(transfer.fromAccountId,'A');
assert.equal(transfer.toAccountId,'B');

const expense=sanitizeTransactionWrite({type:'expense',date:'2026-11-06',amount:10,vat:0,accountId:'A',fromAccountId:'OLD',toAccountId:'OLD'});
assert.equal(expense.fromAccountId,null);
assert.equal(expense.toAccountId,null);


const invoice=sanitizeInvoiceWrite({
  invoiceNumber:'001-001-000000001',customerName:'Cliente',concept:'Consultoría',
  issueDate:'2026-11-14',dueDate:'2026-12-14',calculationMode:'base_plus_vat',vatRate:13,
  baseAmount:100,vatAmount:13,totalAmount:113,paidAmount:0,paidBaseAmount:0,paidVatAmount:0,
  status:'pending',active:true,taxPeriod:'2026-11',vatStatus:'pending'
});
assert.equal(invoice.schemaVersion,SCHEMA_VERSION);
assert.equal(invoice.totalAmount,113);
assert.equal(normalizeInvoice({...invoice,paidAmount:56.5,paidBaseAmount:50,paidVatAmount:6.5}).status,'partial');
assert.throws(()=>sanitizeInvoiceWrite({...invoice,totalAmount:114}),/Base \+ IVA/);
const invoicePaymentTx=sanitizeTransactionWrite({
  type:'income',date:'2026-11-14',transactionDateTime:'2026-11-14T10:30',amount:113,vat:13,accountId:'A',
  hasInvoice:true,invoiceNumber:invoice.invoiceNumber,invoiceBase:100,invoiceId:'INV1',invoicePaymentId:'PAY1',economicAmount:100,invoiceVatComponent:13
});
assert.equal(invoicePaymentTx.invoiceId,'INV1');
assert.equal(invoicePaymentTx.economicAmount,100);
assert.equal(invoicePaymentTx.invoiceVatComponent,13);

assert.throws(()=>sanitizeBudgetWrite({category:'Casa',subcategory:'Internet',limit:30,month:'',rollover:false}),/mes válido/);
const budget=sanitizeBudgetWrite({category:'Casa',subcategory:'Internet',limit:30,month:'2026-11',rollover:false});
assert.equal(budget.schemaVersion,SCHEMA_VERSION);

console.log('schema.test.mjs OK');
console.log(JSON.stringify({accounts:accounts.length,accountsLegacyDate:expectedLegacyAccountDates,transactions:tx.length,legacyDateTime:legacyWithoutDateTime.length,legacyVatAmbiguous:23,budgetsLegacy:expectedLegacyBudgets,liabilityStatusConflict:1,schemaVersion:SCHEMA_VERSION},null,2));
