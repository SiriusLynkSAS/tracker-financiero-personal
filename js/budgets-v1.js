import {requireUser} from "./guard.js";
import {listBudgets,listTransactions,listCategories,saveBudget,removeBudget} from "./data-service.js?v=1.0.83";
import {money,escapeHtml,todayISO} from "./utils.js";
import {sortCategoryRows,categoriesForType,subcategoriesFor} from "./category-catalog.js";
import {confirmAction,toast} from "./ui.js";
import {budgetsForMonth,budgetMetricsForMonth,shiftMonth,normalizeText} from "./planning.js";
import {budgetAlertForMetrics} from "./budget-alerts.js";

let budgets=[],txs=[],cats=[],editingId=null,detailId=null;
let viewMonth=new URLSearchParams(location.search).get("month")||todayISO().slice(0,7);
if(!/^\d{4}-\d{2}$/.test(viewMonth)) viewMonth=todayISO().slice(0,7);
let editorMonth=viewMonth;
let pickerTarget="view";
let pickerYear=Number(viewMonth.slice(0,4));

const $=id=>document.getElementById(id);
const editor=$("budget-editor"),form=$("budget-form"),list=$("budget-list"),detailDialog=$("budget-detail-dialog");
const categoryDialog=$("budget-category-dialog"),categoryDialogBody=$("budget-category-dialog-body"),monthDialog=$("budget-month-dialog");

function parseDecimal(value){
  const n=Number(String(value??"").trim().replace(",","."));
  return Number.isFinite(n)?n:NaN;
}
function cleanDecimalInput(input){
  const raw=String(input.value||"").replace(/[^0-9.,]/g,"");
  const first=raw.search(/[.,]/);
  input.value=first<0?raw:raw.slice(0,first+1)+raw.slice(first+1).replace(/[.,]/g,"");
}
function monthLabel(value){
  const [year,month]=String(value).split("-").map(Number);
  if(!year||!month)return value;
  const label=new Intl.DateTimeFormat("es-EC",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(year,month-1,1)));
  return label.charAt(0).toUpperCase()+label.slice(1);
}
function monthShort(month){
  return new Intl.DateTimeFormat("es-EC",{month:"short",timeZone:"UTC"}).format(new Date(Date.UTC(2026,month-1,1))).replace(".","");
}
function activeForView(){return budgetsForMonth({budgets,month:viewMonth});}
function samePair(a,b){return normalizeText(a.category)===normalizeText(b.category)&&normalizeText(a.subcategory)===normalizeText(b.subcategory);}
function pct(spent,available){return available>0?Math.max(0,spent/available*100):(spent>0?100:0);}
function alertClass(alert){return alert?.severity==="over"?"is-over":alert?.severity==="critical"?"is-critical":alert?.severity==="warning"?"is-warning":"";}
function alertLabel(alert){return alert?.severity==="over"?"Sobrepasado":alert?.severity==="critical"?"10% restante":alert?.severity==="warning"?"30% restante":"";}

function syncPeriodUi(){
  $("budget-period-label").textContent=monthLabel(viewMonth);
  $("budget-current").hidden=viewMonth===todayISO().slice(0,7);
  $("budget-list-title").textContent=`Presupuestos · ${monthLabel(viewMonth)}`;
}
function render(){
  syncPeriodUi();
  const rows=activeForView().sort((a,b)=>a.category.localeCompare(b.category,"es",{sensitivity:"base"})||a.subcategory.localeCompare(b.subcategory,"es",{sensitivity:"base"}));
  let totalAvailable=0,totalSpent=0;
  const html=rows.map(b=>{
    const m=budgetMetricsForMonth({budget:b,budgets,transactions:txs,month:viewMonth});
    totalAvailable+=m.available;totalSpent+=m.spent;
    const usage=pct(m.spent,m.available),alert=budgetAlertForMetrics({budget:b,metrics:m,month:viewMonth});
    const carry=b.rollover&&m.carry>0?`<span class="tf-budget-rollover">↻ +${money(m.carry)}</span>`:"";
    const warning=alert?`<span class="tf-budget-alert-pill ${alertClass(alert)}">${alertLabel(alert)}</span>`:"";
    return `<div class="tf-budget-row ${alertClass(alert)}" data-budget-row="${escapeHtml(b.id)}">
      <div class="tf-budget-row-main">
        <div class="tf-budget-row-title"><strong>${escapeHtml(b.category)} · ${escapeHtml(b.subcategory)}</strong>${warning}</div>
        <div class="tf-budget-row-values">
          <span><small>Límite</small><strong>${money(m.base)}</strong>${carry}</span>
          <span><small>Gastado</small><strong>${money(m.spent)}</strong></span>
          <span><small>Disponible</small><strong class="${m.remaining<0?"tf-negative":""}">${money(m.remaining)}</strong></span>
        </div>
        <div class="tf-budget-row-progress"><span style="width:${Math.min(100,usage)}%"></span></div>
        <div class="tf-muted">${Math.round(usage)}% utilizado${m.available>0?` de ${money(m.available)}`:""}</div>
      </div>
      <button class="tf-icon-button" type="button" data-budget-info="${escapeHtml(b.id)}" aria-label="Información de ${escapeHtml(b.category)} ${escapeHtml(b.subcategory)}">ⓘ</button>
    </div>`;
  }).join("");
  list.innerHTML=html||`<div class="tf-empty">No hay presupuestos para ${escapeHtml(monthLabel(viewMonth))}. Usa “Nuevo presupuesto” para crear el primero.</div>`;
  const remaining=totalAvailable-totalSpent,usage=pct(totalSpent,totalAvailable);
  $("budget-summary-available").textContent=money(totalAvailable);
  $("budget-summary-spent").textContent=money(totalSpent);
  $("budget-summary-remaining").textContent=money(remaining);
  $("budget-summary-remaining").classList.toggle("tf-negative",remaining<0);
  $("budget-summary-use").textContent=`${Math.round(usage)}%`;
  $("budget-summary-progress").style.width=`${Math.min(100,usage)}%`;
}

async function refresh(){
  [budgets,txs,cats]=await Promise.all([listBudgets(),listTransactions(),listCategories()]);
  cats=sortCategoryRows(cats);
  render();
  const requested=new URLSearchParams(location.search).get("budget");
  if(requested&&budgets.some(b=>b.id===requested&&String(b.month||"")===viewMonth)){
    openDetail(requested);
    history.replaceState({},"",`presupuestos.html?month=${encodeURIComponent(viewMonth)}`);
  }
}

function syncCategoryLabel(){
  const cat=$("budget-category").value,sub=$("budget-subcategory").value,button=$("budget-category-picker");
  button.textContent=cat&&sub?`${cat} · ${sub}`:"Seleccionar categoría y subcategoría";
  button.classList.toggle("has-value",!!cat&&!!sub);
}
function renderCategoryDialog(category=null){
  if(!category){
    $("budget-category-dialog-title").textContent="Seleccionar categoría";
    const names=categoriesForType(cats,"expense");
    categoryDialogBody.innerHTML=names.map(name=>`<button type="button" class="tf-tx-category-option" data-budget-category="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")||`<div class="tf-empty">No hay categorías de egreso configuradas.</div>`;
  }else{
    $("budget-category-dialog-title").textContent=category;
    const subs=subcategoriesFor(cats,"expense",category);
    categoryDialogBody.innerHTML=`<button type="button" class="tf-tx-category-back" data-budget-category-back>← Categorías</button>`+subs.map(name=>`<button type="button" class="tf-tx-category-option" data-budget-subcategory="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("");
  }
}
function openCategoryDialog(){renderCategoryDialog();categoryDialog.showModal();}

function syncEditorMonth(){
  $("budget-month").value=editorMonth;
  $("budget-editor-month-label").textContent=monthLabel(editorMonth);
}
function openEditor(row=null){
  editingId=row?.id||null;
  editorMonth=row?.month||viewMonth;
  $("budget-editor-title").textContent=row?"Editar presupuesto":"Nuevo presupuesto";
  $("budget-category").value=row?.category||"";
  $("budget-subcategory").value=row?.subcategory||"";
  $("budget-limit").value=row?String(Number(row.limit||0).toFixed(2)).replace(".",","):"";
  $("budget-rollover").checked=!!row?.rollover;
  syncCategoryLabel();syncEditorMonth();
  editor.showModal();
}
function closeEditor(){editor.close();editingId=null;form.reset();}

function renderMonthPicker(){
  $("budget-picker-year").textContent=String(pickerYear);
  const selected=pickerTarget==="view"?viewMonth:editorMonth;
  $("budget-month-grid").innerHTML=Array.from({length:12},(_,i)=>{
    const value=`${pickerYear}-${String(i+1).padStart(2,"0")}`;
    return `<button type="button" class="tf-budget-month-option ${value===selected?"is-selected":""}" data-budget-month="${value}">${monthShort(i+1)}</button>`;
  }).join("");
}
function openMonthPicker(target){
  pickerTarget=target;
  const current=target==="view"?viewMonth:editorMonth;
  pickerYear=Number(current.slice(0,4))||new Date().getFullYear();
  renderMonthPicker();monthDialog.showModal();
}
function selectMonth(value){
  if(pickerTarget==="view"){
    viewMonth=value;render();
  }else{
    editorMonth=value;syncEditorMonth();
  }
  monthDialog.close();
}

function openDetail(id){
  const b=budgets.find(x=>x.id===id);if(!b)return;
  detailId=id;
  const month=String(b.month||viewMonth),m=budgetMetricsForMonth({budget:b,budgets,transactions:txs,month});
  const alert=budgetAlertForMetrics({budget:b,metrics:m,month});
  $("budget-detail-title").textContent=`${b.category} · ${b.subcategory}`;
  $("budget-detail-body").innerHTML=`
    ${alert?`<div class="tf-alert ${alert.severity==="over"?"tf-alert-danger":"tf-alert-warn"}">${escapeHtml(alert.label)}${alert.severity==="over"?` · exceso ${money(Math.abs(m.remaining))}`:` · quedan ${money(Math.max(0,m.remaining))}`}</div>`:""}
    <div class="tf-detail-grid" style="margin-top:.8rem">
      <div class="tf-metric"><span class="tf-metric-label">Mes</span><strong>${escapeHtml(monthLabel(month))}</strong></div>
      <div class="tf-metric"><span class="tf-metric-label">Base</span><strong>${money(m.base)}</strong></div>
      <div class="tf-metric"><span class="tf-metric-label">Rollover</span><strong>${b.rollover?money(m.carry):"No"}</strong></div>
      <div class="tf-metric"><span class="tf-metric-label">Disponible total</span><strong>${money(m.available)}</strong></div>
      <div class="tf-metric"><span class="tf-metric-label">Gastado</span><strong>${money(m.spent)}</strong></div>
      <div class="tf-metric"><span class="tf-metric-label">Queda</span><strong class="${m.remaining<0?"tf-negative":""}">${money(m.remaining)}</strong></div>
    </div>
    <div class="tf-actions" style="margin-top:1rem">
      <button type="button" class="tf-btn tf-btn-primary" data-budget-edit-detail>Editar</button>
      <button type="button" class="tf-btn tf-btn-danger" data-budget-delete-detail>Eliminar</button>
    </div>`;
  detailDialog.showModal();
}

$("budget-new").addEventListener("click",()=>openEditor());
$("budget-editor-close").addEventListener("click",closeEditor);
$("budget-cancel").addEventListener("click",closeEditor);
$("budget-category-picker").addEventListener("click",openCategoryDialog);
$("budget-category-dialog-close").addEventListener("click",()=>categoryDialog.close());
categoryDialogBody.addEventListener("click",e=>{
  const cat=e.target.closest("[data-budget-category]"),sub=e.target.closest("[data-budget-subcategory]"),back=e.target.closest("[data-budget-category-back]");
  if(back){renderCategoryDialog();return;}
  if(cat){$("budget-category").value=cat.dataset.budgetCategory;$("budget-subcategory").value="";syncCategoryLabel();renderCategoryDialog(cat.dataset.budgetCategory);return;}
  if(sub){$("budget-subcategory").value=sub.dataset.budgetSubcategory;syncCategoryLabel();categoryDialog.close();}
});
$("budget-limit").addEventListener("input",e=>cleanDecimalInput(e.target));
$("budget-prev").addEventListener("click",()=>{viewMonth=shiftMonth(viewMonth,-1);render();});
$("budget-next").addEventListener("click",()=>{viewMonth=shiftMonth(viewMonth,1);render();});
$("budget-current").addEventListener("click",()=>{viewMonth=todayISO().slice(0,7);render();});
$("budget-period-label").addEventListener("click",()=>openMonthPicker("view"));
$("budget-editor-month-button").addEventListener("click",()=>openMonthPicker("editor"));
$("budget-month-dialog-close").addEventListener("click",()=>monthDialog.close());
$("budget-year-prev").addEventListener("click",()=>{pickerYear--;renderMonthPicker();});
$("budget-year-next").addEventListener("click",()=>{pickerYear++;renderMonthPicker();});
$("budget-picker-current").addEventListener("click",()=>selectMonth(todayISO().slice(0,7)));
$("budget-month-grid").addEventListener("click",e=>{const b=e.target.closest("[data-budget-month]");if(b)selectMonth(b.dataset.budgetMonth);});
list.addEventListener("click",e=>{const b=e.target.closest("[data-budget-info]");if(b)openDetail(b.dataset.budgetInfo);});
$("budget-detail-close").addEventListener("click",()=>detailDialog.close());
$("budget-detail-body").addEventListener("click",async e=>{
  if(e.target.closest("[data-budget-edit-detail]")){
    const row=budgets.find(x=>x.id===detailId);detailDialog.close();openEditor(row);return;
  }
  if(e.target.closest("[data-budget-delete-detail]")){
    const row=budgets.find(x=>x.id===detailId);if(!row)return;
    const ok=await confirmAction({title:"Eliminar presupuesto",message:`${row.category} · ${row.subcategory} · ${monthLabel(row.month)}`,impact:["No elimina movimientos históricos.","Dejará de calcularse este límite mensual."],confirmText:"Eliminar"});
    if(!ok)return;
    await removeBudget(row.id);detailDialog.close();toast("Presupuesto eliminado.");await refresh();
  }
});

form.addEventListener("submit",async e=>{
  e.preventDefault();
  const category=$("budget-category").value,subcategory=$("budget-subcategory").value,limit=parseDecimal($("budget-limit").value),month=editorMonth;
  if(!category||!subcategory)return toast("Selecciona categoría y subcategoría.");
  if(!/^\d{4}-\d{2}$/.test(month))return toast("Selecciona un mes válido.");
  if(!Number.isFinite(limit)||limit<0)return toast("Ingresa un límite válido.");
  const data={category,subcategory,limit,month,rollover:$("budget-rollover").checked,active:true};
  const duplicate=budgets.find(b=>b.id!==editingId&&String(b.month||"")===month&&samePair(b,data));
  if(duplicate)return toast("Ya existe un presupuesto para esa categoría, subcategoría y mes. Edítalo en lugar de duplicarlo.");
  if(editingId){
    const ok=await confirmAction({title:"Actualizar presupuesto",message:`${category} · ${subcategory} · ${monthLabel(month)} · ${money(limit)}`,impact:["No modifica movimientos históricos.","El rollover se recalculará con los meses anteriores."]});
    if(!ok)return;
  }
  const wasEditing=!!editingId;
  await saveBudget(data,editingId);viewMonth=month;closeEditor();toast(wasEditing?"Presupuesto actualizado.":"Presupuesto guardado.");await refresh();
});

requireUser(()=>refresh().catch(err=>{console.error(err);toast(err?.message||"No se pudo cargar Presupuestos.");}));
