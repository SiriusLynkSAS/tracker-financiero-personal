import assert from 'node:assert/strict';
import {
  MIG005_EXPECTED,
  hasResidualTransferAccountRefs,
  validateMig005Signature,
  isAuditedMig005Candidate,
  classifyMig005Rows
} from '../js/mig005-logic.js';

const first={...MIG005_EXPECTED.J8B3UDn5JhehP6yOYDZY};
const second={...MIG005_EXPECTED.fjcmdUz3Dqt1DnJTGUDD};

assert.equal(hasResidualTransferAccountRefs(first),true);
assert.equal(hasResidualTransferAccountRefs(second),true);
assert.equal(validateMig005Signature(first).ok,true);
assert.equal(validateMig005Signature(second).ok,true);
assert.equal(isAuditedMig005Candidate(first),true);
assert.equal(isAuditedMig005Candidate(second),true);

const classification=classifyMig005Rows([first,second]);
assert.equal(classification.safe,true);
assert.equal(classification.candidates.length,2);
assert.equal(classification.unexpected.length,0);
assert.equal(classification.mismatched.length,0);

const alreadyClean={...first,fromAccountId:null,toAccountId:null};
assert.equal(hasResidualTransferAccountRefs(alreadyClean),false);
assert.equal(classifyMig005Rows([alreadyClean,second]).candidates.length,1,'un caso ya limpio no debe bloquear al caso todavía pendiente');

const partiallyClean={...first,fromAccountId:null};
assert.equal(validateMig005Signature(partiallyClean).ok,true,'una limpieza parcial de una referencia puede completar la otra sin reinterpretar datos');

const changedAccount={...first,accountId:'OTRA'};
const changed=classifyMig005Rows([changedAccount,second]);
assert.equal(changed.safe,false);
assert.equal(changed.mismatched.length,1);
assert.ok(changed.mismatched[0].mig005Issues.includes('cuenta principal'));

const unexpected={...second,id:'NO-AUDITADO'};
const unexpectedClassification=classifyMig005Rows([first,unexpected]);
assert.equal(unexpectedClassification.safe,false);
assert.equal(unexpectedClassification.unexpected.length,1);

const transfer={...first,type:'transfer'};
assert.equal(hasResidualTransferAccountRefs(transfer),false,'MIG-005 no debe tocar transferencias válidas');

console.log('mig005.test.mjs OK');
