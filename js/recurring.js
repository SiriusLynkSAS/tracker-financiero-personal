import {requireUser} from "./guard.js";
import {listRecurring,saveRecurring,archiveRecurring,reactivateRecurring,listAccounts,listCategories,listTransactions,saveRecurringTransaction} from "./data-service.js";
import {money,escapeHtml,todayISO,isoFromParts} from "./utils.js";
import {sortCategoryRows,setCategorySelect,setSubcategorySelect} from "./category-catalog.js";
import {confirmAction,toast} from "./ui.js";

let rows=[],accounts=[],categories=[],transactions=[],editingId=null,showArchived=false,registering=null,detailId=null;
const editor=document.querySelector("#rec-editor"),registerDialog=document.querySelector("#rec-register-dialog"),detailDialog=document.querySelector("#rec-detail-dialog"),categoryDialog=document.querySelector("#rec-register-category-dialog");
const list=document.querySelector("#rec-list"),empty=document.querySelector("#rec-empty"),newButton=document.querySelector("#rec-new"),archivedToggle=document.querySelector("#rec-archived-toggle");
const typeSelect=document.querySelector("#rec-type"),categorySelect=document.querySelector("#rec-category"),subcategorySelect=document.querySelector("#rec-subcategory");

function accountLabel(id){const a=accounts.find(x=>x.id===id);return a?[a.bank,a.alias].filter(Boolean).join(" · "):"—";}
function cleanDecimal(value){return String(value||"").replace(/[^0-9.,]/g,"").replace(",",".");}
function nowTime(){const d=new Date();return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;}
function fillCategoryCatalog(preferredCategory="",preferredSubcategory=""){
  const category=setCategorySelect(categorySelect,categories,typeSelect.value,preferredCategory);
  setSubcategorySelect(subcategorySelect,categories,typeSelect.value,category,preferredSubcategory);
}
function fillSubcategories(preferred=""){setSubcategorySelect(subcategorySelect,categories,typeSelect.value,categorySelect.value,preferred);}
function currentOccurrence(r){
  const ym=todayISO().slice(0,7),[y,m]=ym.split("-").map(Number),day=Math.min(Number(r.dayOfMonth||1),new Date(y,m,0).getDate());
  return {month:ym,dueDate:isoFromParts(y,m,day)};
}
function executionFor(r,occurrence){return transactions.find(t=>t.recurringId===r.id&&((t.recurringOccurrence||String(t.date||"").slice(0,7))===occurrence));}
function statusFor(r,tx){if(r.active===false)return "Archivado";if(tx)return r.type==="income"?"Recibido":"Pagado";return "Pendiente";}

function render(){
  const archivedCount=rows.filter(r=>r.active===false).length;
  archivedToggle.hidden=!archivedCount;archivedToggle.textContent=showArchived?"Ver activos":`Archivados (${archivedCount})`;newButton.hidden=showArchived;
  document.querySelector("#rec-list-title").textContent=showArchived?"Recurrentes archivados":"Recurrentes activos";
  const visible=rows.filter(r=>showArchived?r.active===false:r.active!==false);
  list.innerHTML=visible.map(r=>{
    const occ=currentOccurrence(r),tx=showArchived?null:executionFor(r,occ.month),status=statusFor(r,tx);
    const registerLabel=tx?(r.type==="income"?"Recibido":"Pagado"):(r.type==="income"?"Registrar ingreso":"Registrar pago");
    return `<tr>
      <td><strong>${escapeHtml(r.name||"Recurrente")}</strong><div class="tf-muted">${escapeHtml([r.category,r.subcategory].filter(Boolean).join(" · ")||"Sin categoría")}</div></td>
      <td>${r.type==="income"?"Ingreso":"Egreso"}</td>
      <td class="tf-num"><strong>${money(r.amount)}</strong></td>
      <td>${showArchived?escapeHtml(r.startDate||"—"):escapeHtml(occ.dueDate)}</td>
      <td><span class="tf-pill ${tx?"tf-pill-ok":showArchived?"":"tf-pill-warn"}">${escapeHtml(status)}</span></td>
      <td>${showArchived?"—":`<button class="tf-btn ${tx?"tf-btn-secondary":"tf-btn-primary"} tf-btn-compact" data-register="${r.id}" ${tx?"disabled":""}>${registerLabel}</button>`}</td>
      <td class="tf-center"><button class="tf-icon-btn" data-info="${r.id}" title="Información" aria-label="Información">ⓘ</button></td>
    </tr>`;
  }).join("");
  empty.hidden=visible.length>0;empty.textContent=showArchived?"Sin recurrentes archivados.":"Sin recurrentes activos.";
}
async function refresh(){
  [rows,accounts,categories,transactions]=await Promise.all([listRecurring(),listAccounts({includeArchived:false}),listCategories(),listTransactions()]);
  categories=sortCategoryRows(categories);
  document.querySelector("#rec-account").innerHTML=`<option value="">Sin cuenta habitual</option>`+accounts.map(a=>`<option value="${a.id}">${escapeHtml(accountLabel(a.id))}</option>`).join("");
  document.querySelector("#rec-register-account").innerHTML=accounts.map(a=>`<option value="${a.id}">${escapeHtml(accountLabel(a.id))}</option>`).join("");
  fillCategoryCatalog();render();
}
function resetForm(){
  editingId=null;document.querySelector("#rec-form").reset();document.querySelector("#rec-start").value=todayISO();document.querySelector("#rec-day").value=1;document.querySelector("#rec-reminder").value=3;
  document.querySelector("#rec-submit").textContent="Guardar recurrente";document.querySelector("#rec-editor-title").textContent="Nuevo recurrente";typeSelect.value="expense";fillCategoryCatalog();
}
function openEditor(row=null){resetForm();if(row){editingId=row.id;document.querySelector("#rec-editor-title").textContent="Editar recurrente";document.querySelector("#rec-name").value=row.name||"";typeSelect.value=row.type||"expense";document.querySelector("#rec-amount").value=Number(row.amount||0).toFixed(2);document.querySelector("#rec-account").value=row.accountId||"";fillCategoryCatalog(row.category||"",row.subcategory||"");document.querySelector("#rec-day").value=Number(row.dayOfMonth||1);document.querySelector("#rec-reminder").value=Number(row.reminderDaysBefore||0);document.querySelector("#rec-start").value=row.startDate||todayISO();document.querySelector("#rec-end").value=row.endDate||"";document.querySelector("#rec-submit").textContent="Actualizar recurrente";}editor.showModal();}
function closeEditor(){editor.close();resetForm();}

function registerCategoryLabel(){const c=document.querySelector("#rec-register-category").value,s=document.querySelector("#rec-register-subcategory").value;document.querySelector("#rec-register-category-picker").textContent=c?`${c}${s?` · ${s}`:""}`:"Seleccionar categoría y subcategoría";}
function categoryOptions(type,selected=""){
  return [...new Set(categories.filter(x=>x.type===type).map(x=>x.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"})).map(name=>`<button type="button" class="tf-tx-category-option ${name===selected?"is-selected":""}" data-rec-reg-category="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("");
}
function subcategoryOptions(type,category,selected=""){
  return [...new Set(categories.filter(x=>x.type===type&&x.category===category).map(x=>x.subcategory).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"})).map(name=>`<button type="button" class="tf-tx-category-option ${name===selected?"is-selected":""}" data-rec-reg-subcategory="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("");
}
function renderRegisterCategory(step="category"){
  if(!registering)return;const c=document.querySelector("#rec-register-category").value,s=document.querySelector("#rec-register-subcategory").value;
  document.querySelector("#rec-register-category-title").textContent=step==="category"?"Seleccionar categoría":c;
  document.querySelector("#rec-register-category-body").innerHTML=step==="category"?categoryOptions(registering.type,c):`<button type="button" class="tf-btn tf-btn-secondary tf-btn-compact" data-rec-reg-back>← Categorías</button>${subcategoryOptions(registering.type,c,s)}`;
}
function openRegister(row){
  const occ=currentOccurrence(row);if(executionFor(row,occ.month)){toast("Este recurrente ya fue registrado para este mes.");return;}
  registering={...row,occurrence:occ.month};document.querySelector("#rec-register-title").textContent=row.type==="income"?"Registrar ingreso recurrente":"Registrar pago recurrente";
  document.querySelector("#rec-register-type").textContent=row.type==="income"?"Ingreso":"Gasto";document.querySelector("#rec-register-amount").value=Number(row.amount||0).toFixed(2);
  document.querySelector("#rec-register-account").value=row.accountId||accounts[0]?.id||"";document.querySelector("#rec-register-description").value=row.name||"";document.querySelector("#rec-register-date").value=todayISO();document.querySelector("#rec-register-time").value=nowTime();
  document.querySelector("#rec-register-category").value=row.category||"";document.querySelector("#rec-register-subcategory").value=row.subcategory||"";registerCategoryLabel();registerDialog.showModal();
}
function closeRegister(){registerDialog.close();registering=null;}
function openDetail(row){
  detailId=row.id;const occ=currentOccurrence(row),tx=row.active===false?null:executionFor(row,occ.month);
  document.querySelector("#rec-detail-title").textContent=row.name||"Recurrente";
  document.querySelector("#rec-detail-body").innerHTML=`<div class="tf-detail-grid">
    <div class="tf-metric"><span class="tf-metric-label">Tipo</span><strong>${row.type==="income"?"Ingreso":"Egreso"}</strong></div>
    <div class="tf-metric"><span class="tf-metric-label">Cantidad</span><strong>${money(row.amount)}</strong></div>
    <div class="tf-metric"><span class="tf-metric-label">Día</span><strong>${Number(row.dayOfMonth||1)}</strong></div>
    <div class="tf-metric"><span class="tf-metric-label">Cuenta</span><strong>${escapeHtml(accountLabel(row.accountId))}</strong></div>
  </div><div style="margin-top:.8rem"><strong>${escapeHtml([row.category,row.subcategory].filter(Boolean).join(" · ")||"Sin categoría")}</strong><div class="tf-muted">Desde ${escapeHtml(row.startDate||"—")}${row.endDate?` · hasta ${escapeHtml(row.endDate)}`:""} · recordar ${Number(row.reminderDaysBefore||0)} día(s) antes</div>${tx?`<div class="tf-alert tf-alert-info" style="margin-top:.7rem">${row.type==="income"?"Recibido":"Pagado"} ${escapeHtml(tx.date||"")} · ${money(tx.amount)}</div>`:""}</div>
  <div class="tf-actions" style="margin-top:1rem">${row.active!==false&&!tx?`<button class="tf-btn tf-btn-primary" data-detail-register>${row.type==="income"?"Registrar ingreso":"Registrar pago"}</button>`:""}${row.active===false?`<button class="tf-btn tf-btn-primary" data-detail-reactivate>Reactivar</button>`:`<button class="tf-btn tf-btn-secondary" data-detail-edit>Editar</button><button class="tf-btn tf-btn-secondary" data-detail-archive>Archivar</button>`}</div>`;
  detailDialog.showModal();
}

typeSelect.addEventListener("change",()=>fillCategoryCatalog());categorySelect.addEventListener("change",()=>fillSubcategories());
document.querySelector("#rec-amount").addEventListener("input",e=>{e.target.value=cleanDecimal(e.target.value);});document.querySelector("#rec-register-amount").addEventListener("input",e=>{e.target.value=cleanDecimal(e.target.value);});
newButton.addEventListener("click",()=>openEditor());archivedToggle.addEventListener("click",()=>{showArchived=!showArchived;render();});document.querySelector("#rec-editor-close").addEventListener("click",closeEditor);document.querySelector("#rec-cancel").addEventListener("click",closeEditor);
document.querySelector("#rec-register-close").addEventListener("click",closeRegister);document.querySelector("#rec-register-cancel").addEventListener("click",closeRegister);document.querySelector("#rec-detail-close").addEventListener("click",()=>detailDialog.close());
document.querySelector("#rec-register-category-picker").addEventListener("click",()=>{renderRegisterCategory("category");categoryDialog.showModal();});document.querySelector("#rec-register-category-close").addEventListener("click",()=>categoryDialog.close());
document.querySelector("#rec-register-category-body").addEventListener("click",e=>{const c=e.target.closest("[data-rec-reg-category]"),s=e.target.closest("[data-rec-reg-subcategory]"),back=e.target.closest("[data-rec-reg-back]");if(back){renderRegisterCategory("category");return}if(c){document.querySelector("#rec-register-category").value=c.dataset.recRegCategory;document.querySelector("#rec-register-subcategory").value="";renderRegisterCategory("subcategory");return}if(s){document.querySelector("#rec-register-subcategory").value=s.dataset.recRegSubcategory;registerCategoryLabel();categoryDialog.close();}});

document.querySelector("#rec-form").addEventListener("submit",async e=>{e.preventDefault();if(!categorySelect.value||!subcategorySelect.value)return toast("Selecciona categoría y subcategoría.");const data={name:document.querySelector("#rec-name").value.trim(),type:typeSelect.value,amount:Number(cleanDecimal(document.querySelector("#rec-amount").value)),accountId:document.querySelector("#rec-account").value,category:categorySelect.value,subcategory:subcategorySelect.value,dayOfMonth:Number(document.querySelector("#rec-day").value),reminderDaysBefore:Number(document.querySelector("#rec-reminder").value),startDate:document.querySelector("#rec-start").value,endDate:document.querySelector("#rec-end").value||null,active:true};if(!(data.amount>0))return toast("El monto debe ser mayor que cero.");if(editingId&&!await confirmAction({title:"Actualizar recurrente",message:`${data.name} · ${money(data.amount)}`,impact:["Los compromisos futuros usarán los nuevos datos.","No modifica movimientos ya registrados."]}))return;await saveRecurring(data,editingId);const was=!!editingId;closeEditor();toast(was?"Recurrente actualizado.":"Recurrente guardado.");await refresh();});

document.querySelector("#rec-register-form").addEventListener("submit",async e=>{e.preventDefault();if(!registering)return;const amount=Number(cleanDecimal(document.querySelector("#rec-register-amount").value)),accountId=document.querySelector("#rec-register-account").value,category=document.querySelector("#rec-register-category").value,subcategory=document.querySelector("#rec-register-subcategory").value,date=document.querySelector("#rec-register-date").value,time=document.querySelector("#rec-register-time").value;if(!(amount>0)||!accountId||!category||!subcategory||!date)return toast("Completa monto, cuenta, categoría, subcategoría y fecha.");await saveRecurringTransaction(registering,registering.occurrence,{type:registering.type,date,transactionDateTime:time?`${date}T${time}`:"",amount,vat:0,receipt:"",description:document.querySelector("#rec-register-description").value.trim(),hasInvoice:false,invoiceNumber:"",invoiceBase:0,taxPeriod:"",taxPaymentId:"",vatStatus:"none",category,subcategory,accountId,fromAccountId:null,toAccountId:null,splits:[]});toast(registering.type==="income"?"Ingreso recurrente registrado.":"Pago recurrente registrado.");closeRegister();await refresh();});

list.addEventListener("click",e=>{const reg=e.target.closest("[data-register]"),info=e.target.closest("[data-info]");if(reg&&!reg.disabled){const row=rows.find(x=>x.id===reg.dataset.register);if(row)openRegister(row);}if(info){const row=rows.find(x=>x.id===info.dataset.info);if(row)openDetail(row);}});
document.querySelector("#rec-detail-body").addEventListener("click",async e=>{const row=rows.find(x=>x.id===detailId);if(!row)return;if(e.target.closest("[data-detail-register]")){detailDialog.close();openRegister(row);return}if(e.target.closest("[data-detail-edit]")){detailDialog.close();openEditor(row);return}if(e.target.closest("[data-detail-reactivate]")){await reactivateRecurring(row.id);detailDialog.close();await refresh();return}if(e.target.closest("[data-detail-archive]")&&await confirmAction({title:"Archivar recurrente",message:"Dejará de generar compromisos futuros.",confirmText:"Archivar"})){await archiveRecurring(row.id);detailDialog.close();await refresh();}});

requireUser(()=>refresh().catch(err=>{console.error(err);toast("No se pudo cargar Recurrentes.");}));
