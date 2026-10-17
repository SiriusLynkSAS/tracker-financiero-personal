import {requireUser} from "./guard.js";
import {
  listBusinessTrips,saveBusinessTrip,listTripExpenses,listTripSettlements,
  createTripExpense,updateTripExpenseRecognition,voidTripExpense,createTripSettlement,
  listAccounts
} from "./data-service.js";
import {money,escapeHtml,todayISO,sum} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

let trips=[],expenses=[],settlements=[],accounts=[],selectedTripId="";

const categoryLabel={
  food:"Alimentación",lodging:"Hospedaje",transport:"Transporte",
  fuel:"Combustible",tolls:"Peajes",other:"Otros"
};
const settlementLabel={
  reimbursement:"Reembolso",advance:"Anticipo",advance_return:"Devolución de anticipo"
};

function expenseAccounts(){return accounts.filter(a=>a.active!==false)}
function settlementAccounts(){return accounts.filter(a=>a.active!==false&&a.accountType!=="credit_card")}
function accountLabel(id){
  const a=accounts.find(x=>x.id===id);
  return a?[a.bank,a.alias].filter(Boolean).join(" · "):"—";
}
function selectedTrip(){return trips.find(x=>x.id===selectedTripId)||null}

function metrics(){
  const es=expenses.filter(x=>x.tripId===selectedTripId&&x.active!==false);
  const ss=settlements.filter(x=>x.tripId===selectedTripId&&x.active!==false);
  const spent=sum(es,x=>x.amountPaid);
  const invoiced=sum(es,x=>x.invoiceAmount);
  const recognized=sum(es,x=>x.recognizedAmount);
  const advances=sum(ss.filter(x=>x.kind==="advance"),x=>x.amount);
  const reimbursements=sum(ss.filter(x=>x.kind==="reimbursement"),x=>x.amount);
  const returns=sum(ss.filter(x=>x.kind==="advance_return"),x=>x.amount);
  const netEmployerFunds=advances+reimbursements-returns;
  return {
    spent,invoiced,recognized,advances,reimbursements,returns,netEmployerFunds,
    pending:Math.max(0,recognized-netEmployerFunds),
    personalExpected:Math.max(0,spent-recognized),
    outOfPocket:spent+returns-advances-reimbursements,
    advanceToReturn:Math.max(0,advances-returns-recognized)
  };
}

function renderTripOptions(){
  const current=selectedTripId;
  document.querySelector("#trip-select").innerHTML=trips
    .filter(x=>x.active!==false)
    .map(t=>`<option value="${t.id}">${escapeHtml(t.name)} · ${escapeHtml(t.startDate||"")}</option>`)
    .join("")||`<option value="">Sin comisiones</option>`;
  if(current&&trips.some(x=>x.id===current&&x.active!==false))document.querySelector("#trip-select").value=current;
  selectedTripId=document.querySelector("#trip-select").value||"";
}

function render(){
  renderTripOptions();
  const trip=selectedTrip();
  const m=metrics();

  document.querySelector("#trip-selected-meta").innerHTML=trip
    ? `${escapeHtml(trip.destination||"Sin destino")} · ${escapeHtml(trip.reimburser||"Sin entidad")} · ${trip.fundingMode==="advance"?"Anticipo":"Fondos propios"} · <strong>${escapeHtml(trip.status||"in_progress")}</strong>`
    :"Crea una comisión para comenzar.";

  for(const [id,v] of [
    ["trip-spent",m.spent],["trip-invoiced",m.invoiced],["trip-recognized",m.recognized],
    ["trip-received",m.netEmployerFunds],["trip-pending",m.pending],["trip-personal",m.personalExpected]
  ]) document.querySelector(`#${id}`).textContent=money(v);

  document.querySelector("#trip-mark-submitted").disabled=!trip;
  document.querySelector("#trip-close").disabled=!trip;

  const es=expenses.filter(x=>x.tripId===selectedTripId&&x.active!==false);
  document.querySelector("#trip-expense-body").innerHTML=es.map(x=>`
    <tr>
      <td>${escapeHtml(x.date)}</td>
      <td>${escapeHtml(categoryLabel[x.category]||x.category)}</td>
      <td>${escapeHtml(x.description||"—")}${x.hasInvoice?`<div class="tf-muted">Factura ${escapeHtml(x.invoiceNumber||"—")}</div>`:""}</td>
      <td>${money(x.amountPaid)}</td>
      <td>${money(x.invoiceAmount)}</td>
      <td>${money(x.recognizedAmount)}</td>
      <td><div class="tf-actions">
        <button class="tf-btn tf-btn-secondary" data-recognize="${x.id}">Editar reconocido</button>
        <button class="tf-btn tf-btn-danger" data-void-expense="${x.id}">Anular</button>
      </div></td>
    </tr>
  `).join("")||`<tr><td colspan="7" class="tf-empty">Sin gastos en esta comisión.</td></tr>`;

  const ss=settlements.filter(x=>x.tripId===selectedTripId&&x.active!==false);
  document.querySelector("#trip-settlement-list").innerHTML=ss.map(x=>`
    <div class="tf-summary-row"><span><strong>${escapeHtml(settlementLabel[x.kind]||x.kind)}</strong><br><small class="tf-muted">${escapeHtml(x.date)} · ${escapeHtml(accountLabel(x.accountId))}${x.notes?` · ${escapeHtml(x.notes)}`:""}</small></span><strong>${money(x.amount)}</strong></div>
  `).join("")||`<div class="tf-empty">Sin reembolsos o anticipos.</div>`;
}

async function refresh(){
  [trips,expenses,settlements,accounts]=await Promise.all([
    listBusinessTrips(),listTripExpenses(),listTripSettlements(),listAccounts()
  ]);
  if(!selectedTripId)selectedTripId=trips.find(x=>x.active!==false)?.id||"";
  document.querySelector("#trip-expense-account").innerHTML=expenseAccounts()
    .map(a=>`<option value="${a.id}">${escapeHtml(accountLabel(a.id))}</option>`).join("");
  document.querySelector("#trip-settlement-account").innerHTML=settlementAccounts()
    .map(a=>`<option value="${a.id}">${escapeHtml(accountLabel(a.id))}</option>`).join("");
  render();
}

document.querySelector("#trip-start").value=todayISO();
document.querySelector("#trip-expense-date").value=todayISO();
document.querySelector("#trip-settlement-date").value=todayISO();

document.querySelector("#trip-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const start=document.querySelector("#trip-start").value;
  const end=document.querySelector("#trip-end").value||null;
  if(end&&end<start){toast("La fecha final no puede ser anterior al inicio.");return}
  const id=await saveBusinessTrip({
    name:document.querySelector("#trip-name").value.trim(),
    destination:document.querySelector("#trip-destination").value.trim(),
    startDate:start,endDate:end,
    reimburser:document.querySelector("#trip-reimburser").value.trim(),
    fundingMode:document.querySelector("#trip-funding").value,
    status:"in_progress",
    notes:document.querySelector("#trip-notes").value.trim(),
    active:true
  });
  selectedTripId=id;
  e.target.reset();
  document.querySelector("#trip-start").value=todayISO();
  toast("Comisión creada.");await refresh();
});

document.querySelector("#trip-select").addEventListener("change",e=>{selectedTripId=e.target.value;render()});

document.querySelector("#trip-expense-form").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!selectedTripId){toast("Primero crea o selecciona una comisión.");return}
  const hasInvoice=document.querySelector("#trip-expense-invoice").checked;
  const paid=Number(document.querySelector("#trip-expense-paid").value||0);
  const invoiceAmount=hasInvoice?Number(document.querySelector("#trip-expense-invoiced").value||0):0;
  const recognized=Number(document.querySelector("#trip-expense-recognized").value||0);
  await createTripExpense({
    tripId:selectedTripId,
    date:document.querySelector("#trip-expense-date").value,
    category:document.querySelector("#trip-expense-category").value,
    description:document.querySelector("#trip-expense-description").value.trim(),
    amountPaid:paid,
    hasInvoice,
    invoiceNumber:document.querySelector("#trip-expense-invoice-number").value.trim(),
    invoiceAmount,
    recognizedAmount:recognized,
    accountId:document.querySelector("#trip-expense-account").value,
    notes:document.querySelector("#trip-expense-notes").value.trim()
  });
  e.target.reset();
  document.querySelector("#trip-expense-date").value=todayISO();
  toast("Gasto de comisión registrado.");await refresh();
});

document.querySelector("#trip-expense-invoice").addEventListener("change",e=>{
  document.querySelector("#trip-expense-invoice-number").disabled=!e.target.checked;
  document.querySelector("#trip-expense-invoiced").disabled=!e.target.checked;
  if(!e.target.checked)document.querySelector("#trip-expense-invoiced").value=0;
});
document.querySelector("#trip-expense-paid").addEventListener("change",e=>{
  const v=Number(e.target.value||0);
  if(document.querySelector("#trip-expense-invoice").checked&&Number(document.querySelector("#trip-expense-invoiced").value||0)===0){
    document.querySelector("#trip-expense-invoiced").value=v.toFixed(2);
  }
});

document.querySelector("#trip-settlement-form").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!selectedTripId){toast("Primero selecciona una comisión.");return}
  await createTripSettlement({
    tripId:selectedTripId,
    kind:document.querySelector("#trip-settlement-kind").value,
    date:document.querySelector("#trip-settlement-date").value,
    amount:Number(document.querySelector("#trip-settlement-amount").value||0),
    accountId:document.querySelector("#trip-settlement-account").value,
    notes:document.querySelector("#trip-settlement-notes").value.trim()
  });
  e.target.reset();
  document.querySelector("#trip-settlement-date").value=todayISO();
  toast("Movimiento de comisión registrado.");await refresh();
});

document.querySelector("#trip-expense-body").addEventListener("click",async e=>{
  const recognize=e.target.closest("[data-recognize]");
  const voidBtn=e.target.closest("[data-void-expense]");
  if(recognize){
    const row=expenses.find(x=>x.id===recognize.dataset.recognize);if(!row)return;
    const value=prompt("Valor reconocido por la entidad ($):",Number(row.recognizedAmount||0).toFixed(2));
    if(value===null)return;
    const amount=Number(value);
    if(!Number.isFinite(amount)||amount<0){toast("Monto inválido.");return}
    await updateTripExpenseRecognition(row.id,amount);
    toast("Valor reconocido actualizado.");await refresh();
  }
  if(voidBtn){
    const row=expenses.find(x=>x.id===voidBtn.dataset.voidExpense);if(!row)return;
    if(!await confirmAction({title:"Anular gasto de comisión",message:money(row.amountPaid),impact:["Se eliminará también la salida vinculada de la cuenta.","La auditoría conservará trazabilidad."],confirmText:"Anular"}))return;
    await voidTripExpense(row.id);toast("Gasto anulado.");await refresh();
  }
});

document.querySelector("#trip-mark-submitted").addEventListener("click",async()=>{
  const trip=selectedTrip();if(!trip)return;
  await saveBusinessTrip({...trip,status:"submitted"},trip.id);
  toast("Comisión marcada como presentada.");await refresh();
});
document.querySelector("#trip-close").addEventListener("click",async()=>{
  const trip=selectedTrip();if(!trip)return;
  const m=metrics();
  if(!await confirmAction({
    title:"Cerrar comisión",
    message:`Por recuperar ${money(m.pending)} · costo personal esperado ${money(m.personalExpected)}`,
    impact:[m.pending>0.009?"Todavía existe un valor reconocido pendiente de reembolso.":"No quedan valores reconocidos pendientes."],
    confirmText:"Cerrar"
  }))return;
  await saveBusinessTrip({...trip,status:m.pending>0.009?"partial":"closed"},trip.id);
  toast("Estado de comisión actualizado.");await refresh();
});

requireUser(()=>refresh().catch(err=>{console.error(err);toast("No se pudo cargar Comisiones / Viáticos.");}));
