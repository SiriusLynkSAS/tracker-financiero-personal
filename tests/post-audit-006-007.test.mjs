import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {AUD_POST_007_TARGET,inspectAudPost007Raw,sanitizeContractPaymentWrite,isFinancingPlanLinkedTransaction} from "../js/post-audit-logic.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");

const dirty={id:AUD_POST_007_TARGET.id,contractId:AUD_POST_007_TARGET.contractId,transactionId:AUD_POST_007_TARGET.transactionId,amount:750,status:"reversed",allocations:[{amount:750}]};
assert.equal(inspectAudPost007Raw(AUD_POST_007_TARGET.id,dirty).state,"pending");
const clean=sanitizeContractPaymentWrite(dirty);
assert.equal(Object.prototype.hasOwnProperty.call(clean,"id"),false);
assert.equal(inspectAudPost007Raw(AUD_POST_007_TARGET.id,clean).state,"resolved");
assert.equal(inspectAudPost007Raw(AUD_POST_007_TARGET.id,{...dirty,transactionId:"unexpected"}).state,"blocked");
assert.equal(isFinancingPlanLinkedTransaction({financingPlanId:"plan-1"}),true);
assert.equal(isFinancingPlanLinkedTransaction({financingPlanId:""}),false);

const data=fs.readFileSync(path.join(root,"js/data-service.js"),"utf8");
assert.match(data,/old\.financingPlanId/);
assert.match(data,/row\?\.financingPlanId/);
assert.match(data,/id:deleteField\(\)/);
const tx=fs.readFileSync(path.join(root,"js/transactions-v1.js"),"utf8");
assert.match(tx,/tx\.financingPlanId/);
const contracts=fs.readFileSync(path.join(root,"js/contracts.js"),"utf8");
assert.match(contracts,/repairAudPost007ContractPayment/);
console.log("AUD-POST-006/007 web tests passed");
