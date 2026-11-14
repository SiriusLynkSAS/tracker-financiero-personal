import assert from 'node:assert/strict';
import {buildBudgetAlerts,budgetAlertForMetrics} from '../js/budget-alerts.js';

const budget={id:'b1',category:'Alimentación',subcategory:'Almuerzos',limit:100,month:'2026-11',rollover:false};
assert.equal(budgetAlertForMetrics({budget,month:'2026-11',metrics:{available:100,spent:69,remaining:31}}),null);
assert.equal(budgetAlertForMetrics({budget,month:'2026-11',metrics:{available:100,spent:70,remaining:30}}).severity,'warning');
assert.equal(budgetAlertForMetrics({budget,month:'2026-11',metrics:{available:100,spent:90,remaining:10}}).severity,'critical');
assert.equal(budgetAlertForMetrics({budget,month:'2026-11',metrics:{available:100,spent:100,remaining:0}}).severity,'critical');
assert.equal(budgetAlertForMetrics({budget,month:'2026-11',metrics:{available:100,spent:101,remaining:-1}}).severity,'over');

const alerts=buildBudgetAlerts({
  budgets:[budget],
  transactions:[{id:'t1',type:'expense',date:'2026-11-05',amount:92,category:'Alimentación',subcategory:'Almuerzos',splits:[]}],
  month:'2026-11'
});
assert.equal(alerts.length,1);
assert.equal(alerts[0].severity,'critical');
assert.equal(alerts[0].remaining,8);
console.log('budget-alerts-v1083: OK');
