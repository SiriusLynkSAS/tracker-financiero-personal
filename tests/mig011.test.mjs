import assert from 'node:assert/strict';
import {inspectMig011,MIG011_TARGET} from '../js/mig011-logic.js';
import {normalizeInstitutionKey,resolveInstitutionIdentity} from '../js/institutions.js';

const rows=[
  {id:'8LgBdKZrGzF7IscEoyFI',bank:'DeUna',alias:'DeUna',accountType:'savings',active:false,institutionId:'',institutionDisplayName:''},
  {id:'C9moyXtN0wp62rLm2h0H',bank:'Deuna!',alias:'De Una',accountType:'savings',active:true,institutionId:'',institutionDisplayName:''}
];
assert.equal(normalizeInstitutionKey('De Una!'),'deuna');
assert.deepEqual(resolveInstitutionIdentity('Deuna!').institutionId,'deuna');
assert.equal(inspectMig011(rows).safe,true);
assert.equal(inspectMig011(rows).pending.length,2);
const migrated=rows.map(x=>({...x,institutionId:MIG011_TARGET.institutionId,institutionDisplayName:MIG011_TARGET.displayName}));
assert.equal(inspectMig011(migrated).resolved,true);
const bad=rows.map(x=>({...x}));bad[0].institutionId='otra';
assert.equal(inspectMig011(bad).safe,false);
const changed=rows.map(x=>({...x}));changed[1].bank='Otro banco';
assert.equal(inspectMig011(changed).safe,false);
console.log('MIG011 tests OK: audited=2 canonical=deuna no-auto-merge=1');
