import {requireUser} from "./guard.js";
import {listTransactions,listTaxPayments,listAccounts,listInvoicesOptional,saveTaxPayment,atomicWrite} from "./data-service.js?v=1.0.75";
import {money,escapeHtml,todayISO,sum} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

let txs=[],payments=[],accounts=[],issuedInvoices=[],pending=[];
const mig004Panel=document.querySelector("#mig004-panel"),mig004Body=document.querySelector("#mig004-body"),mig004Count=document.querySelector("#mig004-count"),mig004Apply=document.querySelector("#mig004-apply");

function accountLabel(id){
  const a=accounts.find(x=>x.id===id);
  return a?[a.bank,a.alias].filter(Boolean).join(" · "):"—";
}


function txTypeLabel(type){return ({income:"Ingreso",expense:"Egreso",transfer:"Transferencia",investment_out:"Salida a inversión",investment_return:"Retorno de inversión",work_expense:"Gasto de trabajo",work_reimbursement:"Reembolso",work_advance:"Anticipo",work_advance_return:"Devolución de anticipo"})[type]||type||"Movimiento";}
function legacyVatRows(){return txs.filter(t=>t.legacyVatAmbiguous===true);}
function renderMig004(){
  const rows=legacyVatRows();
  if(!mig004Panel)return;
  mig004Panel.hidden=!rows.length;
  if(!rows.length)return;
  mig004Count.textContent=String(rows.length);
  mig004Body.innerHTML=rows.sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))).map(t=>`<tr><td>${escapeHtml(t.date||"—")}</td><td>${escapeHtml(txTypeLabel(t.type))}</td><td>${escapeHtml(t.description||"Sin descripción")}</td><td>${money(t.amount)}</td><td>${money(t.legacyVatRaw)}</td><td><span class="tf-pill tf-pill-warn">Limpiar IVA · conservar trazabilidad</span></td></tr>`).join("");
}

function refreshPending(){
  const legacy=txs.filter(t=>
    t.type==="income" && Number(t.vat||0)>0 && !t.taxPaymentId && t.vatStatus!=="paid" && !t.invoiceId
  ).map(t=>({
    key:`tx:${t.id}`,sourceType:"transaction",sourceId:t.id,
    invoiceNumber:t.invoiceNumber||t.receipt||t.description||"Factura legacy",
    taxPeriod:String(t.taxPeriod||t.date||"").slice(0,7),date:t.date,
    baseAmount:Number(t.invoiceBase??Math.max(0,Number(t.amount)-Number(t.vat))),vatAmount:Number(t.vat||0)
  }));
  const emitted=issuedInvoices.filter(i=>
    i.active!==false && i.status!=="void" && Number(i.vatAmount||0)>0 && !i.taxPaymentId && i.vatStatus!=="paid"
  ).map(i=>({
    key:`invoice:${i.id}`,sourceType:"invoice",sourceId:i.id,
    invoiceNumber:i.invoiceNumber||"Factura",taxPeriod:String(i.taxPeriod||i.issueDate||"").slice(0,7),date:i.issueDate,
    baseAmount:Number(i.baseAmount||0),vatAmount:Number(i.vatAmount||0),customerName:i.customerName||""
  }));
  pending=[...emitted,...legacy];
}

function periods(){
  return [...new Set(pending.map(t=>String(t.taxPeriod||"").slice(0,7)).filter(Boolean))]
    .sort().reverse();
}

function selectedInvoices(){
  return [...document.querySelectorAll("[data-tax-invoice]:checked")]
    .map(x=>pending.find(t=>t.key===x.dataset.taxInvoice))
    .filter(Boolean);
}

function renderInvoiceSelector(){
  const period=document.querySelector("#tax-period").value;
  const rows=pending.filter(t=>String(t.taxPeriod||"").slice(0,7)===period);
  document.querySelector("#tax-invoices").innerHTML=rows.map(t=>`
    <label class="tf-plan-source-row">
      <input type="checkbox" data-tax-invoice="${t.key}" checked>
      <span class="tf-plan-source-main">
        <strong>${escapeHtml(t.invoiceNumber||"Factura")}</strong>
        <span>${escapeHtml(t.date)} · Base ${money(t.baseAmount)}${t.sourceType==="invoice"?" · Facturación":" · Legacy"}</span>
      </span>
      <strong class="tf-plan-source-amount">IVA ${money(t.vatAmount)}</strong>
    </label>
  `).join("")||`<div class="tf-empty">No hay facturas pendientes en este período.</div>`;
  updateExpected();
}

function updateExpected(){
  const expected=sum(selectedInvoices(),x=>x.vatAmount);
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
  renderMig004();
  document.querySelector("#tax-reserved").textContent=money(sum(pending,x=>x.vatAmount));
  document.querySelector("#tax-paid").textContent=money(sum(payments,x=>x.paidVat));
  document.querySelector("#tax-expected").textContent=money(sum(payments,x=>x.expectedVat));
  document.querySelector("#tax-pending-count").textContent=String(pending.length);

  document.querySelector("#tax-pending-list").innerHTML=pending.map(t=>`
    <div class="tf-plan-source-row">
      <span class="tf-emergency-minimum">IVA</span>
      <span class="tf-plan-source-main">
        <strong>${escapeHtml(t.invoiceNumber||"Factura")}</strong>
        <span>${escapeHtml(String(t.taxPeriod||"").slice(0,7))} · Base ${money(t.baseAmount)}${t.sourceType==="invoice"?` · ${escapeHtml(t.customerName||"")}`:" · Legacy"}</span>
      </span>
      <strong class="tf-plan-source-amount">${money(t.vatAmount)}</strong>
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
  [txs,payments,accounts,issuedInvoices]=await Promise.all([listTransactions(),listTaxPayments(),listAccounts(),listInvoicesOptional()]);
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

  const transactionIds=selected.filter(x=>x.sourceType==="transaction").map(x=>x.sourceId);
  const invoiceEntityIds=selected.filter(x=>x.sourceType==="invoice").map(x=>x.sourceId);
  await saveTaxPayment({period,paidVat,accountId,paymentDate,notes},transactionIds,invoiceEntityIds);
  e.target.reset();
  document.querySelector("#tax-date").value=todayISO();
  document.querySelector("#tax-paid-input").dataset.touched="";
  toast("Liquidación de IVA registrada.");
  await refresh();
});


mig004Apply?.addEventListener("click",async()=>{
  const rows=legacyVatRows();
  if(!rows.length)return;
  const totalRaw=sum(rows,x=>Number(x.legacyVatRaw||0));
  if(!await confirmAction({
    title:"Aplicar MIG-004",
    message:`Normalizar ${rows.length} movimiento(s) con IVA legacy`,
    impact:[`Se limpiará un total histórico de ${money(totalRaw)} del campo IVA; no del monto del movimiento.`,"No cambia montos, cuentas, saldos ni categorías.","El valor original se conserva en legacyVatRaw y el cambio queda registrado en auditLog."],
    confirmText:"Aplicar MIG-004"
  }))return;
  await atomicWrite(rows.map(t=>({
    collection:"transactions",id:t.id,action:"update",auditType:"transaction",
    data:{vat:0,hasInvoice:false,invoiceNumber:"",invoiceBase:0,taxPeriod:"",vatStatus:"none",legacyVatRaw:Number(t.legacyVatRaw||0),legacyVatResolution:"mig004_invalid_equal_amount_cleared"},
    note:"MIG-004 · normalización de IVA legacy vat==amount sin factura explícita"
  })));
  toast("MIG-004 aplicada. El IVA legacy quedó normalizado sin alterar saldos.");
  await refresh();
});

requireUser(()=>refresh().catch(err=>{console.error(err);toast("No se pudo cargar IVA / Impuestos.");}));
