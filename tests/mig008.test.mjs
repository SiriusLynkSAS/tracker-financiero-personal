import assert from 'node:assert/strict';
import {inspectMig008Debt,migrateMig008Schedule,mig008Summary} from '../js/mig008-logic.js';

const make=(id,creditor,concept,principal,historicalMax,linkedN)=>({
  id,creditor,concept,originalPrincipal:principal,
  schedule:Array.from({length:linkedN+2},(_,i)=>{
    const n=i+1;
    if(n<=historicalMax) return {n,status:'paid',paidDate:'2026-08-30',paidAmount:100+n,payment:100+n,historicalPayment:false,payments:[]};
    if(n===linkedN) return {n,status:'paid',paidDate:'2026-10-29',paidAmount:123,payment:123,historicalPayment:false,payments:[{transactionId:'TX-'+n,amount:123,date:'2026-10-29'}]};
    return {n,status:'pending',paidDate:null,paidAmount:0,payment:99,historicalPayment:false,payments:[]};
  })
});
const a=make('79ZDfUwLvFSAvSkOt5my','Amparito Marisol Veloz Chavez','Préstamo',8000,9,10);
const b=make('YY9zu2433CoCjP7nlfVV','COAC Politécnica','Préstamo personal',3000,17,18);
// Caso especial auditado: cuota 17 conserva detalle manual sin transactionId.
b.schedule[16].payments=[{transactionId:'',amount:b.schedule[16].paidAmount,date:'2026-10-20'}];

let s=mig008Summary([a,b]);
assert.equal(s.safe,true);
assert.equal(s.candidateCount,26);
assert.equal(s.resolved,false);
const a2={...a,schedule:migrateMig008Schedule(a)};
const b2={...b,schedule:migrateMig008Schedule(b)};
s=mig008Summary([a2,b2]);
assert.equal(s.safe,true);
assert.equal(s.candidateCount,0);
assert.equal(s.resolved,true);
assert.equal(a2.schedule[9].historicalPayment,false,'cuota 10 con transactionId no debe migrarse');
assert.equal(b2.schedule[17].historicalPayment,false,'cuota 18 con transactionId no debe migrarse');
assert.equal(b2.schedule[16].historicalPayment,true,'detalle manual sin transactionId debe clasificarse histórico');
assert.equal(b2.schedule[16].payments.length,1,'no borrar detalle manual');
const broken=structuredClone(a);broken.schedule[0].payments=[{transactionId:'REAL',amount:101,date:'2026-08-30'}];
assert.equal(inspectMig008Debt(broken).safe,false,'si aparece transactionId inesperado, bloquear');
console.log('mig008.test.mjs OK');
