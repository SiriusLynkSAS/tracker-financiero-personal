import assert from 'node:assert/strict';
import {inspectMig009,MIG009_REDUNDANT_IDS,MIG009_CANONICAL_ID} from '../js/mig009-logic.js';
import {sanitizeReceivableWrite} from '../js/schema.js';
const base=[
 ...MIG009_REDUNDANT_IDS.map((id,i)=>({id,hasStoredId:true,storedId:id,workPeriod:`2026-0${i+6}`})),
 {id:MIG009_CANONICAL_ID,hasStoredId:false,storedId:null,workPeriod:'2026-10'}
];
let r=inspectMig009(base);
assert.equal(r.safe,true);assert.equal(r.pending.length,4);assert.equal(r.resolved,false);
r=inspectMig009(base.map(x=>({...x,hasStoredId:false,storedId:null})));
assert.equal(r.safe,true);assert.equal(r.resolved,true);
r=inspectMig009([...base,{id:'unexpected',hasStoredId:true,storedId:'unexpected'}]);
assert.equal(r.safe,false);
r=inspectMig009(base.map(x=>x.id===MIG009_REDUNDANT_IDS[0]?{...x,storedId:'WRONG'}:x));
assert.equal(r.safe,false);
console.log('MIG-009 tests OK');

const sanitized=sanitizeReceivableWrite({id:'legacy',contractId:'c',workPeriod:'2026-01',amount:10,paidAmount:0,dueDate:'2026-02-01'});
assert.equal(Object.prototype.hasOwnProperty.call(sanitized,'id'),false);
