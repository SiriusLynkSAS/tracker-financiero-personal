import {requireUser} from "./guard.js";
import {listTransactions,listTaxPayments,listAccounts,listInvoicesOptional,saveTaxPayment} from "./data-service.js?v=1.0.87";
import {money,escapeHtml,todayISO,sum} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

let txs=[],payments=[],accounts=[],issuedInvoices=[],pending=[];
const dialog=document.querySelector("#tax-payment-dialog");

function accountLabel(id){
  const a=accounts.find(x=>x.id===id);
  return a?[a.bank,a.alias].filter(Boolean).join(" · "):"—";
}
function isInputVatTx(t){return ["expense","work_expense"].includes(t.type)&&Number(t.vat||0)>0&&t.hasInvoice===true;}
function isOutputVatTx(t){return t.type==="income"&&Number(t.vat||0)>0&&!t.invoiceId;}
function vatRoleLabel(role){return role==="credit"?"IVA a favor":"IVA generado";}

function refreshPending(){
  const movements=txs.filter(t=>
    (isOutputVatTx(t)||isInputVatTx(t)) && !t.taxPaymentId && t.vatStatus!=="paid"
  ).map(t=>({
    key:`tx:${t.id}`,sourceType:"transaction",sourceId:t.id,
    role:isInputVatTx(t)?"credit":"generated",
    invoiceNumber:t.invoiceNumber||t.receipt||t.description||"Movimiento con IVA",
    taxPeriod:String(t.taxPeriod||t.date||"").slice(0,7),date:t.date,
    baseAmount:Number(t.invoiceBase??Math.max(0,Number(t.amount)-Number(t.vat))),vatAmount:Number(t.vat||0),
    description:t.description||""
  }));
  const emitted=issuedInvoices.filter(i=>
    i.active!==false && i.status!=="void" && Number(i.vatAmount||0)>0 && !i.taxPaymentId && i.vatStatus!=="paid"
  ).map(i=>({
    key:`invoice:${i.id}`,sourceType:"invoice",sourceId:i.id,role:"generated",
    invoiceNumber:i.invoiceNumber||"Factura",taxPeriod:String(i.taxPeriod||i.issueDate||"").slice(0,7),date:i.issueDate,
    baseAmount:Number(i.baseAmount||0),vatAmount:Number(i.vatAmount||0),customerName:i.customerName||""
  }));
  pending=[...emitted,...movements].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
}

function periods(){
  return [...new Set(pending.map(t=>String(t.taxPeriod||"").slice(0,7)).filter(Boolean))].sort().reverse();
}
function rowsForPeriod(period){return pending.filter(t=>String(t.taxPeriod||"").slice(0,7)===period);}
function totals(rows){
  const generated=sum(rows.filter(x=>x.role==="generated"),x=>x.vatAmount);
  const credit=sum(rows.filter(x=>x.role==="credit"),x=>x.vatAmount);
  return {generated,credit,netDue:Math.max(0,generated-credit),creditBalance:Math.max(0,credit-generated)};
}
function selectedRows(){
  return [...document.querySelectorAll("[data-tax-source]:checked")]
    .map(x=>pending.find(t=>t.key===x.dataset.taxSource)).filter(Boolean);
}

function renderPeriodSummary(){
  const grouped=periods().map(period=>({period,rows:rowsForPeriod(period)}));
  document.querySelector("#tax-period-summary").innerHTML=grouped.map(g=>{
    const t=totals(g.rows);
    return `<tr><td>${escapeHtml(g.period)}</td><td>${money(t.generated)}</td><td>${money(t.credit)}</td><td><strong>${money(t.netDue)}</strong></td><td>${money(t.creditBalance)}</td><td>${g.rows.length}</td></tr>`;
  }).join("")||`<tr><td colspan="6" class="tf-empty">No hay IVA pendiente.</td></tr>`;
}

function renderSelector(){
  const period=document.querySelector("#tax-period").value;
  const rows=rowsForPeriod(period);
  document.querySelector("#tax-invoices").innerHTML=rows.map(t=>`
    <label class="tf-plan-source-row">
      <input type="checkbox" data-tax-source="${t.key}" checked>
      <span class="tf-plan-source-main">
        <strong>${escapeHtml(t.invoiceNumber||"Comprobante")}</strong>
        <span>${escapeHtml(t.date||"")} · Base ${money(t.baseAmount)} · ${escapeHtml(vatRoleLabel(t.role))}${t.sourceType==="invoice"?" · Facturación":" · Movimiento"}</span>
      </span>
      <strong class="tf-plan-source-amount">${t.role==="credit"?"−":"+"}${money(t.vatAmount)}</strong>
    </label>`).join("")||`<div class="tf-empty">No hay IVA pendiente en este período.</div>`;
  updateExpected();
}

function updateExpected(){
  const t=totals(selectedRows());
  document.querySelector("#tax-selected-generated").textContent=money(t.generated);
  document.querySelector("#tax-selected-credit").textContent=money(t.credit);
  document.querySelector("#tax-expected-input").textContent=money(t.netDue);
  const paid=document.querySelector("#tax-paid-input");
  if(!paid.dataset.touched)paid.value=t.netDue.toFixed(2);
  const paidValue=Number(paid.value||0);
  const diff=t.netDue-paidValue;
  document.querySelector("#tax-difference").textContent=t.creditBalance>.005
    ?`Saldo a favor estimado: ${money(t.creditBalance)}.`
    : diff>.005?`Diferencia entre estimado y pago real: ${money(diff)}.`
    : diff<-.005?`Pago real superior al estimado en ${money(-diff)}.`
    :"El pago real coincide con el estimado.";
  document.querySelector("#tax-account").disabled=!(paidValue>0);
}

function renderPayments(){
  document.querySelector("#tax-payment-list").innerHTML=payments.map(p=>`<tr>
    <td>${escapeHtml(p.period||"")}</td><td>${money(p.generatedVat??p.expectedVat)}</td><td>${money(p.creditVat||0)}</td>
    <td>${money(p.expectedVat)}</td><td>${money(p.paidVat)}</td><td>${escapeHtml(p.paymentDate||"")}</td><td>${escapeHtml(accountLabel(p.accountId))}</td>
  </tr>`).join("")||`<tr><td colspan="7" class="tf-empty">Todavía no hay liquidaciones de IVA registradas.</td></tr>`;
}

function render(){
  refreshPending();
  const all=totals(pending);
  document.querySelector("#tax-generated").textContent=money(all.generated);
  document.querySelector("#tax-credit").textContent=money(all.credit);
  document.querySelector("#tax-net-due").textContent=money(all.netDue);
  document.querySelector("#tax-credit-balance").textContent=money(all.creditBalance);
  document.querySelector("#tax-paid").textContent=money(sum(payments,x=>x.paidVat));
  renderPeriodSummary();renderPayments();
  const ps=periods();
  const sel=document.querySelector("#tax-period");
  const current=sel.value;
  sel.innerHTML=ps.map(p=>`<option value="${p}">${p}</option>`).join("");
  if(current&&ps.includes(current))sel.value=current;
  document.querySelector("#tax-account").innerHTML=`<option value="">Selecciona una cuenta</option>`+accounts.filter(a=>a.active!==false&&a.accountType!=="credit_card").map(a=>`<option value="${a.id}">${escapeHtml([a.bank,a.alias].filter(Boolean).join(" · "))}</option>`).join("");
  renderSelector();
}

async function refresh(){
  [txs,payments,accounts,issuedInvoices]=await Promise.all([listTransactions(),listTaxPayments(),listAccounts(),listInvoicesOptional()]);
  render();
}

function openPayment(){
  if(!pending.length){toast("No hay IVA pendiente para liquidar.");return;}
  document.querySelector("#tax-date").value=todayISO();
  document.querySelector("#tax-paid-input").dataset.touched="";
  renderSelector();dialog.showModal();
}
document.querySelector("#tax-open-payment")?.addEventListener("click",openPayment);
for(const id of ["#tax-payment-close","#tax-payment-cancel"])document.querySelector(id)?.addEventListener("click",()=>dialog.close());
document.querySelector("#tax-period")?.addEventListener("change",()=>{document.querySelector("#tax-paid-input").dataset.touched="";renderSelector();});
document.querySelector("#tax-invoices")?.addEventListener("change",()=>{document.querySelector("#tax-paid-input").dataset.touched="";updateExpected();});
document.querySelector("#tax-paid-input")?.addEventListener("input",e=>{e.target.dataset.touched="1";updateExpected();});

document.querySelector("#tax-form")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const selected=selectedRows();
  const period=document.querySelector("#tax-period").value;
  const calc=totals(selected);
  const paidVat=Number(document.querySelector("#tax-paid-input").value||0);
  const accountId=document.querySelector("#tax-account").value;
  const paymentDate=document.querySelector("#tax-date").value;
  const notes=document.querySelector("#tax-notes").value.trim();
  if(!selected.length){toast("Selecciona al menos un comprobante.");return;}
  if(paidVat<0){toast("El IVA pagado no puede ser negativo.");return;}
  if(paidVat>0&&!accountId){toast("Selecciona la cuenta de pago.");return;}
  if(!paymentDate){toast("Indica la fecha de pago.");return;}
  if(!await confirmAction({title:"Registrar liquidación de IVA",message:`${period} · generado ${money(calc.generated)} · a favor ${money(calc.credit)} · estimado ${money(calc.netDue)} · pagado ${money(paidVat)}`,impact:["Los comprobantes seleccionados quedarán asociados a esta liquidación.",paidVat>0?"Se creará un egreso real por el valor efectivamente pagado.":"No se creará movimiento porque el pago real es $0.","La compra/venta no se duplica: este módulo solo consolida IVA."],confirmText:"Registrar"}))return;
  const txIds=selected.filter(x=>x.sourceType==="transaction").map(x=>x.sourceId);
  const invoiceIds=selected.filter(x=>x.sourceType==="invoice").map(x=>x.sourceId);
  await saveTaxPayment({period,paidVat,accountId,paymentDate,notes},txIds,invoiceIds);
  dialog.close();toast("Liquidación de IVA registrada.");await refresh();
});

requireUser(()=>refresh().catch(err=>{console.error(err);toast("No se pudo cargar IVA / Impuestos.");}));
