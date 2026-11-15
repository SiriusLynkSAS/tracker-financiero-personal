import assert from 'node:assert/strict';
import {buildPendingItems,effectivePendingSchedule,closeHistoricalInstallment} from '../js/pending-engine.js';

const debt={
  id:'d1',active:true,status:'active',creditor:'Banco',reminderDaysBefore:3,
  paidThroughInstallment:2,currentInstallment:3,termMonths:4,
  schedule:[1,2,3,4].map(n=>({n,dueDate:`2026-0${n}-10`,payment:100,paidAmount:0,status:'pending',payments:[]}))
};
const effective=effectivePendingSchedule(debt);
assert.equal(effective[0].status,'paid');
assert.equal(effective[1].status,'paid');
assert.equal(effective[2].status,'pending');

const pending=buildPendingItems({liabilities:[debt],today:'2026-04-20'});
assert.equal(pending.length,1);
assert.equal(pending[0].kind,'debt');
assert.equal(pending[0].installmentNumber,3,'Pendientes debe respetar paidThroughInstallment y no reabrir cuotas 1/2.');

const closed=closeHistoricalInstallment(debt,3,'2026-03-15');
assert.equal(closed.schedule.find(x=>x.n===3).status,'paid');
assert.equal(closed.schedule.find(x=>x.n===3).historicalPayment,true);
assert.equal(closed.paidThroughInstallment,3);
assert.equal(closed.next.n,4);
assert.equal(closed.calculatedPending,100);

const recurring={id:'r1',active:true,name:'Seguro',type:'expense',amount:20,dayOfMonth:5,reminderDaysBefore:3,startDate:'2026-01-01',historicalResolvedOccurrences:['2026-01']};
const recItems=buildPendingItems({recurring:[recurring],today:'2026-04-20'});
assert.equal(recItems[0].occurrence,'2026-02');
assert.match(recItems[0].subtitle,/período 2026-02/);

console.log('pending-history-v1091: ok');
