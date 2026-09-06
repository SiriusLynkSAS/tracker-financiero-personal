import {requireUser} from "./guard.js";
import {
  getEmergencyFund,saveEmergencyFund,listAccounts,listTransactions,listRecurring,
  listInsurance,listLiabilities,listFinancingPlans,calculateBalances,saveTransaction,
  listContracts,syncReceivablesClosed
} from "./data-service.js";
import {money,escapeHtml,todayISO} from "./utils.js";
import {confirmAction,toast} from "./ui.js";
import {
  defaultEmergencyFundConfig,emergencyFundSummary,monthlyProjection
} from "./planning.js";

let config=defaultEmergencyFundConfig();
let accounts=[],txs=[],recurring=[],insurance=[],debts=[],cardPlans=[],contracts=[],receivables=[],balances={},summary=null;
let transferMode=null;

function accountLabel(a){ return [a.bank,a.alias].filter(Boolean).join(" · ")||"Cuenta"; }

function eligibleAccounts(){
  return accounts.filter(a=>a.active!==false&&a.accountType!=="credit_card");
}

function projection(){
  return monthlyProjection({
    accounts,transactions:txs,recurring,insurance,receivables,contracts,debts,cardPlans,
    month:todayISO().slice(0,7),today:todayISO()
  });
}

function calculate(){
  summary=emergencyFundSummary({
    config,accounts,transactions:txs,recurring,insurance,debts,cardPlans,balances,
    projection:projection(),today:todayISO()
  });
}

function renderAccounts(){
  const list=document.querySelector("#ef-account-list");
  const rows=eligibleAccounts();
  list.innerHTML=rows.map(a=>{
    const selected=config.linkedAccountIds.includes(a.id);
    return `
      <label class="tf-plan-source-row">
        <input type="checkbox" data-ef-account="${a.id}" ${selected?"checked":""}>
        <span class="tf-plan-source-main"><strong>${escapeHtml(accountLabel(a))}</strong><span>${escapeHtml(a.accountType)}</span></span>
        <strong class="tf-plan-source-amount">${money(Math.max(0,Number(balances[a.id]||0)))}</strong>
      </label>
    `;
  }).join("")||`<div class="tf-empty">No hay cuentas elegibles.</div>`;
}

function renderComponents(){
  document.querySelector("#ef-components").innerHTML=
    summary.components.map(c=>`
      <label class="tf-plan-source-row">
        ${c.source==="baseline"
          ? `<span class="tf-emergency-minimum">Mínimo</span>`
          : `<input type="checkbox" data-ef-component="${escapeHtml(c.key)}" ${c.counted?"checked":""}>`
        }
        <span class="tf-plan-source-main"><strong>${escapeHtml(c.label)}</strong><span>${escapeHtml(c.detail)}</span></span>
        <strong class="tf-plan-source-amount">${money(c.amount)}</strong>
      </label>
    `).join("");
}

function renderTransfers(){
  const rows=txs
    .filter(t=>t.type==="transfer"&&String(t.description||"").toLocaleLowerCase("es").includes("fondo de emergencia"))
    .slice(0,8);
  document.querySelector("#ef-transfers").innerHTML=rows.map(t=>`
    <div class="tf-summary-row">
      <span><strong>${escapeHtml(t.description)}</strong><br><small class="tf-muted">${escapeHtml(t.date)}</small></span>
      <strong>${money(t.amount)}</strong>
    </div>
  `).join("")||`<div class="tf-empty">Todavía no hay aportes o retiros registrados desde este módulo.</div>`;
}

function render(){
  calculate();

  document.querySelector("#ef-current").textContent=money(summary.currentAmount);
  document.querySelector("#ef-target").textContent=money(summary.targetAmount);
  document.querySelector("#ef-coverage").textContent=`${summary.coverageMonths.toFixed(1)} meses`;
  document.querySelector("#ef-objective").textContent=`${summary.config.targetMonths} meses`;
  document.querySelector("#ef-missing").textContent=money(Math.max(0,summary.targetAmount-summary.currentAmount));
  document.querySelector("#ef-progress").style.width=`${Math.max(0,Math.min(100,summary.progress*100))}%`;
  document.querySelector("#ef-recommended").textContent=money(summary.recommendedSavings);
  document.querySelector("#ef-suggested").textContent=money(summary.suggestedContribution);
  document.querySelector("#ef-essential-total").textContent=money(summary.essentialMonthly);
  document.querySelector("#ef-food").value=Number(config.foodDailyMinimum||0);
  document.querySelector("#ef-transport").value=Number(config.transportDailyMinimum||0);

  document.querySelector("#ef-saving-rule").textContent=
    summary.coverageMonths<3
      ?"Prioridad alta: se sugiere destinar 80% del ahorro recomendado hasta alcanzar 3 meses."
      : summary.coverageMonths<summary.config.targetMonths
        ?"Protección básica: se sugiere destinar 60% del ahorro recomendado hasta completar el objetivo."
        :"Objetivo alcanzado: el ahorro recomendado puede dirigirse a otras metas.";

  document.querySelector("#ef-history-note").textContent=
    summary.usingHistoricalVariableAverage
      ?"Hay al menos 90 días de historial: alimentación y transporte usan el mayor entre el mínimo y el promedio real de los últimos 90 días."
      :`Con ${summary.historyDays} día(s) de historial, se usan mínimos de ${money(config.foodDailyMinimum)}/día en alimentación y ${money(config.transportDailyMinimum)}/día en transporte, más gastos fijos y cuotas obligatorias.`;

  document.querySelectorAll("[data-ef-months]").forEach(b=>{
    b.classList.toggle("tf-btn-primary",Number(b.dataset.efMonths)===Number(config.targetMonths));
    b.classList.toggle("tf-btn-secondary",Number(b.dataset.efMonths)!==Number(config.targetMonths));
  });

  const hasFund=config.linkedAccountIds.length>0;
  document.querySelector("#ef-contribute").disabled=!hasFund;
  document.querySelector("#ef-withdraw").disabled=!hasFund;

  renderAccounts();
  renderComponents();
  renderTransfers();
}

async function saveConfig(next,note=""){
  config={
    ...defaultEmergencyFundConfig(),
    ...next,
    targetMonths:Math.min(24,Math.max(1,Math.round(Number(next.targetMonths||6)))),
    foodDailyMinimum:Math.max(0,Number(next.foodDailyMinimum||0)),
    transportDailyMinimum:Math.max(0,Number(next.transportDailyMinimum||0)),
    linkedAccountIds:[...new Set(next.linkedAccountIds||[])],
    essentialOverrides:next.essentialOverrides||{}
  };
  await saveEmergencyFund(config);
  render();
  if(note)toast(note);
}

async function refresh(){
  receivables=await syncReceivablesClosed();
  const [saved,a,t,r,i,d,p,c]=await Promise.all([
    getEmergencyFund(),listAccounts(),listTransactions(),listRecurring(),listInsurance(),
    listLiabilities(),listFinancingPlans(),listContracts()
  ]);
  accounts=a;txs=t;recurring=r;insurance=i;debts=d;cardPlans=p;contracts=c;
  balances=calculateBalances(accounts,txs);
  config={...defaultEmergencyFundConfig(),...(saved||{})};
  if(!Array.isArray(config.linkedAccountIds))config.linkedAccountIds=[];
  if(!config.essentialOverrides||typeof config.essentialOverrides!=="object")config.essentialOverrides={};
  render();
}

document.querySelector("#ef-month-options").addEventListener("click",async e=>{
  const b=e.target.closest("[data-ef-months]");if(!b)return;
  await saveConfig({...config,targetMonths:Number(b.dataset.efMonths)},"Objetivo actualizado.");
});

document.querySelector("#ef-save-parameters").addEventListener("click",async()=>{
  await saveConfig({
    ...config,
    foodDailyMinimum:Number(document.querySelector("#ef-food").value||0),
    transportDailyMinimum:Number(document.querySelector("#ef-transport").value||0)
  },"Parámetros guardados.");
});

document.querySelector("#ef-account-list").addEventListener("change",async e=>{
  const box=e.target.closest("[data-ef-account]");if(!box)return;
  const set=new Set(config.linkedAccountIds||[]);
  if(box.checked)set.add(box.dataset.efAccount);else set.delete(box.dataset.efAccount);
  await saveConfig({...config,linkedAccountIds:[...set]});
});

document.querySelector("#ef-components").addEventListener("change",async e=>{
  const box=e.target.closest("[data-ef-component]");if(!box)return;
  const overrides={...(config.essentialOverrides||{}),[box.dataset.efComponent]:box.checked};
  await saveConfig({...config,essentialOverrides:overrides});
});

function openTransfer(mode){
  transferMode=mode;
  const fund=new Set(config.linkedAccountIds||[]);
  const eligible=eligibleAccounts();
  const from=mode==="contribution"?eligible.filter(a=>!fund.has(a.id)):eligible.filter(a=>fund.has(a.id));
  const to=mode==="contribution"?eligible.filter(a=>fund.has(a.id)):eligible.filter(a=>!fund.has(a.id));
  const modal=document.querySelector("#ef-transfer-modal");
  document.querySelector("#ef-transfer-title").textContent=mode==="contribution"?"Aportar al fondo":"Retirar del fondo";
  document.querySelector("#ef-transfer-note-label").textContent=mode==="contribution"?"Nota":"Motivo de la emergencia";
  document.querySelector("#ef-transfer-from").innerHTML=from.map(a=>`<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`).join("");
  document.querySelector("#ef-transfer-to").innerHTML=to.map(a=>`<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`).join("");
  document.querySelector("#ef-transfer-amount").value=mode==="contribution"&&summary?.suggestedContribution>0?summary.suggestedContribution.toFixed(2):"";
  const warn=document.querySelector("#ef-transfer-warning");
  const invalid=!from.length||!to.length;
  warn.classList.toggle("is-visible",invalid);
  warn.textContent=invalid?"Necesitas al menos una cuenta del fondo y otra cuenta fuera del fondo.":"";
  modal.hidden=false;
}

function closeTransfer(){
  document.querySelector("#ef-transfer-modal").hidden=true;
  document.querySelector("#ef-transfer-form").reset();
  transferMode=null;
}

document.querySelector("#ef-contribute").addEventListener("click",()=>openTransfer("contribution"));
document.querySelector("#ef-withdraw").addEventListener("click",()=>openTransfer("withdrawal"));
document.querySelector("#ef-transfer-close").addEventListener("click",closeTransfer);
document.querySelector("#ef-transfer-cancel").addEventListener("click",closeTransfer);

document.querySelector("#ef-transfer-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const from=document.querySelector("#ef-transfer-from").value;
  const to=document.querySelector("#ef-transfer-to").value;
  const amount=Number(document.querySelector("#ef-transfer-amount").value||0);
  const note=document.querySelector("#ef-transfer-note").value.trim();
  if(!from||!to||!(amount>0)){toast("Revisa origen, destino y monto.");return}

  const description=transferMode==="contribution"
    ? `Aporte fondo de emergencia${note?` · ${note}`:""}`
    : `Retiro fondo de emergencia${note?` · ${note}`:""}`;

  if(!await confirmAction({
    title:transferMode==="contribution"?"Aportar al fondo":"Retirar del fondo",
    message:money(amount),
    impact:["Se registrará una transferencia real entre cuentas.","No altera el patrimonio total."],
    confirmText:"Registrar"
  }))return;

  await saveTransaction({
    type:"transfer",date:todayISO(),description,amount,vat:0,
    receipt:"",category:"Ahorro",subcategory:"Fondo de emergencia",
    accountId:null,fromAccountId:from,toAccountId:to,splits:[]
  });
  closeTransfer();toast("Transferencia registrada.");await refresh();
});

requireUser(()=>refresh().catch(err=>{console.error(err);toast("No se pudo calcular el fondo de emergencia.");}));
