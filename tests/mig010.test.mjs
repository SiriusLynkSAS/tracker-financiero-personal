import assert from "node:assert/strict";
import {inspectMig010,MIG010_IDS} from "../js/mig010-logic.js";
import {normalizeTransaction,sanitizeTransactionWrite} from "../js/schema.js";
const base=[
{id:MIG010_IDS[0],type:"expense",date:"2026-10-29",transactionDateTime:"2026-10-29T08:42",amount:.45,description:"BDE - Casa",accountId:"EI0cx2IULsr6RooTzrJF",category:"Transporte",subcategory:"Metro",mig010Resolution:""},
{id:MIG010_IDS[1],type:"expense",date:"2026-10-29",transactionDateTime:"2026-10-29T19:00",amount:.45,description:"BDE - Casa",accountId:"EI0cx2IULsr6RooTzrJF",category:"Transporte",subcategory:"Metro",mig010Resolution:""}
];
let r=inspectMig010(base);assert.equal(r.safe,true);assert.equal(r.resolved,false);assert.equal(r.resolution,"pending");
r=inspectMig010(base.map(x=>({...x,mig010Resolution:"distinct_confirmed"})));assert.equal(r.resolved,true);assert.equal(r.resolution,"distinct");
r=inspectMig010([{...base[0],mig010Resolution:"duplicate_resolved"}]);assert.equal(r.resolved,true);assert.equal(r.resolution,"duplicate");
r=inspectMig010([{...base[0],amount:.50},base[1]]);assert.equal(r.safe,false);assert.match(r.blockers.join(" "),/huella auditada/);
r=inspectMig010([base[0]]);assert.equal(r.safe,false);
const reviewed={...base[0],mig010Resolution:"distinct_confirmed"};
assert.equal(normalizeTransaction(reviewed).mig010Resolution,"distinct_confirmed");
assert.equal(sanitizeTransactionWrite(reviewed).mig010Resolution,"distinct_confirmed");
console.log("MIG-010 tests OK");
