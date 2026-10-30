import { requireUser } from "./guard.js";
import { listCategories, saveCategory, removeCategory, listTransactions, atomicWrite } from "./data-service.js";
import { escapeHtml } from "./utils.js";
import { compareEs, sortCategoryRows, normalizeText, categoriesForType, categoryStyle } from "./category-catalog.js";
import {
  UNIQUE_CATEGORY_ICONS,
  iconOptionHtml,
  colorOptionsHtml,
  categoryBadge,
  defaultStyleForName
} from "./category-icons.js";
import { confirmAction, toast } from "./ui.js";

let cats=[],txs=[];
const tbody=document.querySelector("#category-body");
const createPanel=document.querySelector("#category-create-panel");
const stylePanel=document.querySelector("#category-style-panel");
const newButton=document.querySelector("#category-new");

function setupPicker(gridId,hiddenId,selected,filter=""){
  const grid=document.querySelector(`#${gridId}`);
  const hidden=document.querySelector(`#${hiddenId}`);
  const q=filter.trim().toLocaleLowerCase("es");

  const items=UNIQUE_CATEGORY_ICONS.filter(([id,label])=>
    !q ||
    id.toLocaleLowerCase("es").includes(q) ||
    label.toLocaleLowerCase("es").includes(q)
  );

  hidden.value=selected||hidden.value||"wallet";

  grid.innerHTML=items
    .map(([id])=>iconOptionHtml(id,hidden.value))
    .join("");

  grid.querySelectorAll("[data-icon-choice]").forEach(b=>{
    b.classList.toggle(
      "is-selected",
      b.dataset.iconChoice===hidden.value
    );

    b.addEventListener("click",()=>{
      hidden.value=b.dataset.iconChoice;

      grid.querySelectorAll("[data-icon-choice]").forEach(x=>
        x.classList.toggle("is-selected",x===b)
      );
    });
  });
}
function setupColors(gridId,hiddenId,selected){
  const grid=document.querySelector(`#${gridId}`),hidden=document.querySelector(`#${hiddenId}`);
  hidden.value=selected||hidden.value||"blue";
  grid.innerHTML=colorOptionsHtml(hidden.value);
  grid.querySelectorAll("[data-color-choice]").forEach(b=>b.addEventListener("click",()=>{
    hidden.value=b.dataset.colorChoice;
    grid.querySelectorAll("[data-color-choice]").forEach(x=>x.classList.toggle("is-selected",x===b));
  }));
}

function findExistingCategory(type,name){
  const normalized=normalizeText(name);
  if(!normalized) return null;
  return cats.find(
    c=>c.type===type && compareEs(c.category,normalized)===0
  ) || null;
}

function syncNewCategoryStyleMode({applyDefault=false}={}){
  const type=document.querySelector("#category-type").value;
  const name=document.querySelector("#category-name").value;
  const existing=findExistingCategory(type,name);

  const iconWrap=document.querySelector("#category-icon-wrap");
  const colorWrap=document.querySelector("#category-color-wrap");
  const inherited=document.querySelector("#category-inherited-style");

  if(existing){
    const st=categoryStyle(cats,type,existing.category);

    // The subcategory cannot define its own category-level style.
    document.querySelector("#category-icon").value=st.icon;
    document.querySelector("#category-color").value=st.color;

    iconWrap.hidden=true;
    colorWrap.hidden=true;
    inherited.hidden=false;
    inherited.innerHTML=`
      <div class="tf-inherited-category-style-icon">
        ${categoryBadge({
          icon:st.icon,
          color:st.color,
          label:existing.category
        })}
      </div>
      <div>
        <strong>Estilo heredado de ${escapeHtml(existing.category)}</strong>
        <div>
          La subcategoría usará automáticamente el mismo icono y color de su categoría.
        </div>
      </div>
    `;
    return existing;
  }

  iconWrap.hidden=false;
  colorWrap.hidden=false;
  inherited.hidden=true;
  inherited.textContent="";

  if(applyDefault){
    const st=defaultStyleForName(name,type);
    setupPicker(
      "category-icon-grid",
      "category-icon",
      st.icon,
      document.querySelector("#category-icon-search").value
    );
    setupColors(
      "category-color-grid",
      "category-color",
      st.color
    );
  }

  return null;
}

function fillStyleCategory(){
  const type=document.querySelector("#category-type").value;
  const opts=categoriesForType(cats,type);
  const s=document.querySelector("#style-category");
  s.innerHTML=opts.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")||`<option value="">Sin categorías</option>`;
  loadStyle();
}
function loadStyle(){
  const type=document.querySelector("#category-type").value;
  const category=document.querySelector("#style-category").value;
  const st=categoryStyle(cats,type,category);
  setupPicker("style-icon-grid","style-icon",st.icon);
  setupColors("style-color-grid","style-color",st.color);
}
async function refresh(){
  [cats,txs]=await Promise.all([listCategories(),listTransactions()]);
  cats=sortCategoryRows(cats);
  const groups=[...new Map(cats.map(c=>[`${c.type}|${normalizeText(c.category).toLowerCase()}`,[]])).entries()];
  const grouped=new Map();
  cats.forEach(c=>{
    const key=`${c.type}|${normalizeText(c.category).toLowerCase()}`;
    if(!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push(c);
  });
  tbody.innerHTML=[...grouped.values()].map(group=>{
    const first=group[0],st=categoryStyle(cats,first.type,first.category);
    const head=`<tr class="tf-tx-day-row">
      <td>${categoryBadge({icon:st.icon,color:st.color,label:first.category})}</td>
      <td>${first.type==="expense"?"Egreso":"Ingreso"}</td>
      <td><strong>${escapeHtml(first.category)}</strong></td>
      <td>${group.length} subcategoría${group.length===1?"":"s"}</td>
      <td><button class="tf-btn tf-btn-secondary" data-style-id="${first.id}">Editar</button></td>
    </tr>`;
    const subs=group.sort((a,b)=>a.subcategory.localeCompare(b.subcategory,"es")).map(c=>`
      <tr>
        <td></td><td></td><td></td>
        <td>${escapeHtml(c.subcategory)}</td>
        <td><button class="tf-btn tf-btn-danger" data-delete="${c.id}">Eliminar</button></td>
      </tr>`).join("");
    return head+subs;
  }).join("")||`<tr><td colspan="5" class="tf-empty">Sin categorías.</td></tr>`;
  fillStyleCategory();
  syncNewCategoryStyleMode();
}
newButton.addEventListener("click",()=>{
  document.querySelector("#category-form").reset();
  document.querySelector("#category-icon-search").value="";
  setupPicker("category-icon-grid","category-icon","wallet");
  setupColors("category-color-grid","category-color","blue");
  createPanel.hidden=false;
  stylePanel.hidden=true;
  syncNewCategoryStyleMode();
  document.querySelector("#category-name").focus();
});
document.querySelector("#category-create-cancel").addEventListener("click",()=>{createPanel.hidden=true});
document.querySelector("#category-style-cancel").addEventListener("click",()=>{stylePanel.hidden=true});

document.querySelector("#category-icon-search").addEventListener("input",e=>{
  setupPicker("category-icon-grid","category-icon",document.querySelector("#category-icon").value,e.target.value);
});
document.querySelector("#category-name").addEventListener("input",()=>{
  syncNewCategoryStyleMode();
});

document.querySelector("#category-name").addEventListener("blur",()=>{
  syncNewCategoryStyleMode({applyDefault:true});
});

document.querySelector("#category-type").addEventListener("change",()=>{
  fillStyleCategory();
  syncNewCategoryStyleMode({applyDefault:true});
});
document.querySelector("#style-category").addEventListener("change",loadStyle);

document.querySelector("#category-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const type=document.querySelector("#category-type").value;
  const category=normalizeText(document.querySelector("#category-name").value);
  const subcategory=normalizeText(document.querySelector("#subcategory-name").value);
  if(!category||!subcategory)return;
  if(cats.some(c=>c.type===type&&compareEs(c.category,category)===0&&compareEs(c.subcategory,subcategory)===0)){
    toast("Esta categoría y subcategoría ya existen.");
    return;
  }
  const existing=findExistingCategory(type,category);
  const inheritedStyle=existing
    ? categoryStyle(cats,type,existing.category)
    : null;

  await saveCategory({
    type,
    category,
    subcategory,

    // Firestore keeps these fields for compatibility, but when the category
    // already exists they are always copied from the parent category.
    icon:inheritedStyle?.icon || document.querySelector("#category-icon").value || "wallet",
    color:inheritedStyle?.color || document.querySelector("#category-color").value || "blue"
  });

  e.target.reset();
  document.querySelector("#category-icon-search").value="";
  setupPicker("category-icon-grid","category-icon","wallet");
  setupColors("category-color-grid","category-color","blue");
  syncNewCategoryStyleMode();

  createPanel.hidden=true;
  toast(
    existing
      ? "Subcategoría agregada con el estilo de su categoría."
      : "Categoría agregada."
  );
  await refresh();
});

document.querySelector("#category-style-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const type=document.querySelector("#category-type").value;
  const category=document.querySelector("#style-category").value;
  const matching=cats.filter(c=>c.type===type&&compareEs(c.category,category)===0);
  if(!matching.length)return;
  const icon=document.querySelector("#style-icon").value,color=document.querySelector("#style-color").value;
  if(!await confirmAction({title:"Actualizar estilo",message:category,impact:[`Se aplicará a ${matching.length} subcategoría(s).`]}))return;
  await atomicWrite(matching.map(c=>({
    collection:"categories",id:c.id,action:"update",auditType:"category",
    data:{...c,icon,color}
  })));
  stylePanel.hidden=true;
  toast("Estilo actualizado.");
  await refresh();
});

tbody.addEventListener("click",async e=>{
  const styleButton=e.target.closest("[data-style-id]");
  if(styleButton){
    const row=cats.find(x=>x.id===styleButton.dataset.styleId);if(!row)return;
    document.querySelector("#category-type").value=row.type;
    fillStyleCategory();
    document.querySelector("#style-category").value=row.category;
    document.querySelector("#category-style-title").textContent=`Editar ${row.category}`;
    loadStyle();
    createPanel.hidden=true;
    stylePanel.hidden=false;
    stylePanel.scrollIntoView({behavior:"smooth",block:"start"});
    return;
  }
  const b=e.target.closest("[data-delete]");if(!b)return;
  const c=cats.find(x=>x.id===b.dataset.delete);
  const used=txs.some(t=>compareEs(t.category,c.category)===0&&compareEs(t.subcategory,c.subcategory)===0);
  if(await confirmAction({
    title:"Eliminar subcategoría",
    message:`${c.category} > ${c.subcategory}`,
    impact:used?["Los movimientos históricos conservarán el texto y no se modificarán."]:[],
    danger:true,confirmText:"Eliminar"
  })){
    await removeCategory(c.id);toast("Subcategoría eliminada.");await refresh();
  }
});

setupPicker("category-icon-grid","category-icon","wallet");
setupColors("category-color-grid","category-color","blue");
syncNewCategoryStyleMode();
requireUser(()=>refresh().catch(console.error));
