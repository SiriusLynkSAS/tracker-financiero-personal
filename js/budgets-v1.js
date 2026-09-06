import {requireUser} from "./guard.js";
import {listBudgets,listTransactions,listCategories,saveBudget,removeBudget} from "./data-service.js";
import {money,escapeHtml,todayISO} from "./utils.js";
import {sortCategoryRows,setCategorySelect,setSubcategorySelect} from "./category-catalog.js";
import {confirmAction,toast} from "./ui.js";
import {budgetsForMonth,budgetMetricsForMonth,shiftMonth,normalizeText} from "./planning.js";

let budgets=[],txs=[],cats=[],editingId=null;
let viewMonth=todayISO().slice(0,7);

const form=document.querySelector("#budget-form");
const tbody=document.querySelector("#budget-body");
const categorySelect=document.querySelector("#budget-category");
const subcategorySelect=document.querySelector("#budget-subcategory");
const viewMonthInput=document.querySelector("#budget-view-month");
const budgetMonthInput=document.querySelector("#budget-month");

function fillCatalog(preferredCategory="",preferredSubcategory=""){
  const category=setCategorySelect(categorySelect,cats,"expense",preferredCategory);
  setSubcategorySelect(subcategorySelect,cats,"expense",category,preferredSubcategory);
}
function fillSubs(preferred=""){
  setSubcategorySelect(subcategorySelect,cats,"expense",categorySelect.value,preferred);
}
function samePair(a,b){
  return normalizeText(a.category)===normalizeText(b.category)&&normalizeText(a.subcategory)===normalizeText(b.subcategory);
}
function activeForView(){
  return budgetsForMonth({budgets,month:viewMonth});
}
function render(){
  viewMonthInput.value=viewMonth;
  document.querySelector("#budget-table-title").textContent=`Presupuestos · ${viewMonth}`;
  const rows=activeForView().sort((a,b)=>
    a.category.localeCompare(b.category,"es",{sensitivity:"base"})||
    a.subcategory.localeCompare(b.subcategory,"es",{sensitivity:"base"})
  );
  let totalAvailable=0;
  tbody.innerHTML=rows.map(b=>{
    const m=budgetMetricsForMonth({budget:b,budgets,transactions:txs,month:viewMonth});
    totalAvailable+=m.available;
    const legacy=!String(b.month||"").trim();
    return `<tr>
      <td>${escapeHtml(b.category)}${legacy?` <span class="tf-pill tf-pill-warn">Legacy</span>`:""}</td>
      <td>${escapeHtml(b.subcategory)}</td>
      <td>${money(m.base)}</td>
      <td>${b.rollover?money(m.carry):"No"}</td>
      <td>${money(m.available)}</td>
      <td>${money(m.spent)}</td>
      <td class="${m.remaining<0?"tf-negative":""}">${money(m.remaining)}</td>
      <td><div class="tf-actions">
        <button class="tf-btn tf-btn-secondary" data-edit="${b.id}">Editar</button>
        <button class="tf-btn tf-btn-danger" data-delete="${b.id}">Eliminar</button>
      </div></td>
    </tr>`;
  }).join("")||`<tr><td colspan="8" class="tf-empty">Sin presupuestos para ${escapeHtml(viewMonth)}.</td></tr>`;
  document.querySelector("#budget-month-total").textContent=money(totalAvailable);
}
async function refresh(){
  [budgets,txs,cats]=await Promise.all([listBudgets(),listTransactions(),listCategories()]);
  cats=sortCategoryRows(cats);fillCatalog();render();
}
function reset(){
  editingId=null;form.reset();budgetMonthInput.value=viewMonth;
  document.querySelector("#budget-cancel").hidden=true;
  document.querySelector("#budget-submit").textContent="Guardar presupuesto";
  fillCatalog();
}
categorySelect.addEventListener("change",()=>fillSubs());
document.querySelector("#budget-cancel").addEventListener("click",reset);
viewMonthInput.addEventListener("change",()=>{if(viewMonthInput.value){viewMonth=viewMonthInput.value;reset();render()}});
document.querySelector("#budget-prev").addEventListener("click",()=>{viewMonth=shiftMonth(viewMonth,-1);reset();render()});
document.querySelector("#budget-current").addEventListener("click",()=>{viewMonth=todayISO().slice(0,7);reset();render()});
document.querySelector("#budget-next").addEventListener("click",()=>{viewMonth=shiftMonth(viewMonth,1);reset();render()});

form.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!categorySelect.value||!subcategorySelect.value)return alert("Configura primero una categoría y subcategoría de egreso.");
  const data={
    category:categorySelect.value,
    subcategory:subcategorySelect.value,
    limit:Number(document.querySelector("#budget-limit").value),
    month:budgetMonthInput.value,
    rollover:document.querySelector("#budget-rollover").checked,
    active:true
  };
  if(!/^\d{4}-\d{2}$/.test(data.month))return alert("Selecciona un mes válido.");
  if(!(data.limit>=0))return alert("El límite no puede ser negativo.");
  const duplicate=budgets.find(b=>b.id!==editingId&&String(b.month||"")===data.month&&samePair(b,data));
  if(duplicate){
    toast("Ya existe un presupuesto para esa categoría, subcategoría y mes. Edítalo en lugar de duplicarlo.");
    return;
  }
  if(editingId&&!await confirmAction({title:"Actualizar presupuesto",message:`${data.month} · ${money(data.limit)}`,impact:["No modifica movimientos históricos.","El rollover se recalculará con los meses anteriores."]}))return;
  await saveBudget(data,editingId);viewMonth=data.month;toast("Presupuesto guardado.");reset();await refresh();
});

tbody.addEventListener("click",async e=>{
  const edit=e.target.closest("[data-edit]");const del=e.target.closest("[data-delete]");
  if(edit){
    const b=budgets.find(x=>x.id===edit.dataset.edit);if(!b)return;
    editingId=b.id;const month=String(b.month||"").trim()||viewMonth;
    budgetMonthInput.value=month;fillCatalog(b.category,b.subcategory);
    document.querySelector("#budget-limit").value=b.limit;
    document.querySelector("#budget-rollover").checked=!!b.rollover;
    document.querySelector("#budget-cancel").hidden=false;
    document.querySelector("#budget-submit").textContent="Actualizar presupuesto";
    scrollTo({top:0,behavior:"smooth"});
  }
  if(del&&await confirmAction({title:"Eliminar presupuesto",message:"No se borrarán movimientos.",danger:true,confirmText:"Eliminar"})){
    await removeBudget(del.dataset.delete);await refresh();
  }
});

viewMonthInput.value=viewMonth;budgetMonthInput.value=viewMonth;
requireUser(()=>refresh().catch(console.error));
