import {requireUser} from "./guard.js";
import {listTransactions,listTaxPayments,listAccounts,saveTaxPayment} from "./data-service.js";
import {money,escapeHtml,todayISO,sum} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

let txs=[],payments=[],accounts=[],pending=[];

function accountLabel(id){
  const a=accounts.find(x=>x.id===id);
  return a?[a.bank,a.alias].filter(Boolean).join(" · "):"—";
}

function refreshPending(){
  pending=txs.filter(t=>
    t.type==="income" &&
    Number(t.vat||0)>0 &&
    !t.taxPaymentId &&
    t.vatStatus!=="paid"
  );
}

function periods(){
  return [...new Set(pending.map(t=>String(t.taxPeriod||t.date||"").slice(0,7)).filter(Boolean))]
    .sort().reverse();
}

function selectedInvoices(){
  return [...document.querySelectorAll("[data-tax-invoice]:checked")]
    .map(x=>pending.find(t=>t.id===x.dataset.taxInvoice))
    .filter(Boolean);
}

function renderInvoiceSelector(){
  const period=document.querySelector("#tax-period").value;
  const rows=pending.filter(t=>String(t.taxPeriod||t.date||"").slice(0,7)===period);
  document.querySelector("#tax-invoices").innerHTML=rows.map(t=>`
    <label class="tf-plan-source-row">
      <input type="checkbox" data-tax-invoice="${t.id}" checked>
      <span class="tf-plan-source-main">
        <strong>${escapeHtml(t.invoiceNumber||t.receipt||t.description||"Factura")}</strong>
        <span>${escapeHtml(t.date)} · Base ${money(t.invoiceBase??Math.max(0,Number(t.amount)-Number(t.vat)))}</span>
      </span>
      <strong class="tf-plan-source-amount">IVA ${money(t.vat)}</strong>
    </label>
  `).join("")||`<div class="tf-empty">No hay facturas pendientes en este período.</div>`;
  updateExpected();
}

function updateExpected(){
  const expected=sum(selectedInvoices(),x=>x.vat);
  const input=document.querySelector("#tax-expected-input");
  input.value=money(expected);
  const paid=document.querySelector("#tax-paid-input");
  if(!paid.dataset.touched)paid.value=expected.toFixed(2);
  const paidValue=Number(paid.value||0);
  const diff=expected-paidValue;
  document.querySelector("#tax-difference").textContent=
    diff>0.005?`Diferencia a liberar en el disponible: ${money(diff)}`:
    diff<-.005?`Pago adicional sobre lo reservado: ${money(-diff)}`:
    "El pago coincide con la reserva esperada.";
}

function render(){
  refreshPending();
  document.querySelector("#tax-reserved").textContent=money(sum(pending,x=>x.vat));
  document.querySelector("#tax-paid").textContent=money(sum(payments,x=>x.paidVat));
  document.querySelector("#tax-expected").textContent=money(sum(payments,x=>x.expectedVat));
  document.querySelector("#tax-pending-count").textContent=String(pending.length);

  document.querySelector("#tax-pending-list").innerHTML=pending.map(t=>`
    <div class="tf-plan-source-row">
      <span class="tf-emergency-minimum">IVA</span>
      <span class="tf-plan-source-main">
        <strong>${escapeHtml(t.invoiceNumber||t.receipt||t.description||"Factura")}</strong>
        <span>${escapeHtml(String(t.taxPeriod||t.date||"").slice(0,7))} · Base ${money(t.invoiceBase??Math.max(0,Number(t.amount)-Number(t.vat)))}</span>
      </span>
      <strong class="tf-plan-source-amount">${money(t.vat)}</strong>
    </div>
  `).join("")||`<div class="tf-empty">No existen facturas con IVA pendientes.</div>`;

  const ps=periods();
  const periodSelect=document.querySelector("#tax-period");
  const current=periodSelect.value;
  periodSelect.innerHTML=ps.map(p=>`<option value="${p}">${p}</option>`).join("");
  if(current&&ps.includes(current))periodSelect.value=current;

  document.querySelector("#tax-account").innerHTML=accounts
    .filter(a=>a.active!==false&&a.accountType!=="credit_card")
    .map(a=>`<option value="${a.id}">${escapeHtml([a.bank,a.alias].filter(Boolean).join(" · "))}</option>`)
    .join("");

  document.querySelector("#tax-payment-list").innerHTML=payments.map(p=>{
    const diff=Number(p.expectedVat||0)-Number(p.paidVat||0);
    const label=diff>.005?`Liberado ${money(diff)}`:diff<-.005?`Adicional ${money(-diff)}`:"Sin diferencia";
    return `<div class="tf-card">
      <div class="tf-section-kicker">IVA · ${escapeHtml(p.period)}</div>
      <strong>${money(p.paidVat)}</strong>
      <div class="tf-muted">${p.invoiceIds?.length||0} factura(s) · ${escapeHtml(p.paymentDate||"")}</div>
      <div class="tf-detail-grid" style="margin-top:.7rem">
        <div class="tf-metric"><span class="tf-metric-label">Esperado</span><strong>${money(p.expectedVat)}</strong></div>
        <div class="tf-metric"><span class="tf-metric-label">Pagado real</span><strong>${money(p.paidVat)}</strong></div>
      </div>
      <div class="tf-muted" style="margin-top:.55rem">${escapeHtml(label)}${p.accountId?` · ${escapeHtml(accountLabel(p.accountId))}`:""}</div>
      ${p.notes?`<div style="margin-top:.45rem">${escapeHtml(p.notes)}</div>`:""}
    </div>`;
  }).join("")||`<div class="tf-empty">Todavía no hay pagos de IVA.</div>`;

  renderInvoiceSelector();
}

async function refresh(){
  [txs,payments,accounts]=await Promise.all([listTransactions(),listTaxPayments(),listAccounts()]);
  render();
}

document.querySelector("#tax-date").value=todayISO();
document.querySelector("#tax-period").addEventListener("change",()=>{
  document.querySelector("#tax-paid-input").dataset.touched="";
  renderInvoiceSelector();
});
document.querySelector("#tax-invoices").addEventListener("change",()=>{
  document.querySelector("#tax-paid-input").dataset.touched="";
  updateExpected();
});
document.querySelector("#tax-paid-input").addEventListener("input",e=>{
  e.target.dataset.touched="1";updateExpected();
});

document.querySelector("#tax-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const selected=selectedInvoices();
  const period=document.querySelector("#tax-period").value;
  const paidVat=Number(document.querySelector("#tax-paid-input").value||0);
  const accountId=document.querySelector("#tax-account").value;
  const paymentDate=document.querySelector("#tax-date").value;
  const notes=document.querySelector("#tax-notes").value.trim();

  if(!selected.length){toast("Selecciona al menos una factura.");return}
  if(paidVat<0){toast("El IVA pagado no puede ser negativo.");return}
  if(paidVat>0&&!accountId){toast("Selecciona la cuenta de pago.");return}

  const expected=sum(selected,x=>x.vat);
  if(!await confirmAction({
    title:"Registrar pago de IVA",
    message:`${period} · esperado ${money(expected)} · pagado ${money(paidVat)}`,
    impact:["Las facturas quedarán marcadas como liquidadas.","Se creará un egreso real por el valor pagado.","La liquidación no puede editarse ni eliminarse."],
    confirmText:"Registrar"
  }))return;

  await saveTaxPayment({period,paidVat,accountId,paymentDate,notes},selected.map(x=>x.id));
  e.target.reset();
  document.querySelector("#tax-date").value=todayISO();
  document.querySelector("#tax-paid-input").dataset.touched="";
  toast("Liquidación de IVA registrada.");
  await refresh();
});

requireUser(()=>refresh().catch(err=>{console.error(err);toast("No se pudo cargar IVA / Impuestos.");}));
