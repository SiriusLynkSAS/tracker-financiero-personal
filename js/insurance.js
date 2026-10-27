import {requireUser} from "./guard.js";
import {listInsurance,saveInsurance,archiveInsurance,reactivateInsurance} from "./data-service.js";
import {money,escapeHtml,todayISO,sum} from "./utils.js";
import {confirmAction,toast} from "./ui.js";

let rows=[],showArchived=false;
const list=document.querySelector("#ins-list");
const editor=document.querySelector("#ins-editor"),useEditor=document.querySelector("#use-editor");
const newButton=document.querySelector("#ins-new"),archivedToggle=document.querySelector("#ins-archived-toggle");

function render(){
  const active=rows.filter(x=>x.active!==false), archived=rows.filter(x=>x.active===false);
  archivedToggle.hidden=!archived.length;
  archivedToggle.textContent=showArchived?"Ver activas":`Archivadas (${archived.length})`;
  newButton.hidden=showArchived;
  document.querySelector("#use-policy").innerHTML=active.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("");
  const visible=showArchived?archived:active;
  list.innerHTML=visible.map(x=>{
    const uses=x.usageEvents||[],covered=sum(uses,u=>u.coveredAmount),copay=sum(uses,u=>u.copay);
    return`<div class="tf-card">
      <strong>${escapeHtml(x.name)}</strong>
      <div class="tf-muted">${escapeHtml(x.provider)} · prima ${money(x.monthlyPremium)}/mes</div>
      <div class="tf-detail-grid" style="margin-top:.7rem"><div class="tf-metric"><span class="tf-metric-label">Cubierto</span><strong>${money(covered)}</strong></div><div class="tf-metric"><span class="tf-metric-label">Copagos</span><strong>${money(copay)}</strong></div></div>
      <div class="tf-actions" style="margin-top:.7rem">
        ${showArchived
          ? `<button class="tf-btn tf-btn-primary" data-reactivate="${x.id}">Reactivar</button>`
          : `<button class="tf-btn tf-btn-secondary" data-use="${x.id}">Registrar uso</button><button class="tf-btn tf-btn-secondary" data-archive="${x.id}">Archivar</button>`}
      </div>
    </div>`;
  }).join("")||`<div class="tf-card tf-empty">${showArchived?"Sin seguros archivados.":"Sin seguros activos."}</div>`;
}

async function refresh(){rows=await listInsurance();render()}

document.querySelector("#ins-start").value=todayISO();
document.querySelector("#use-date").value=todayISO();

newButton.addEventListener("click",()=>{document.querySelector("#ins-form").reset();document.querySelector("#ins-start").value=todayISO();editor.hidden=false;useEditor.hidden=true});
archivedToggle.addEventListener("click",()=>{showArchived=!showArchived;editor.hidden=true;useEditor.hidden=true;render()});
document.querySelector("#ins-cancel").addEventListener("click",()=>{editor.hidden=true});
document.querySelector("#use-cancel").addEventListener("click",()=>{useEditor.hidden=true});

document.querySelector("#ins-form").addEventListener("submit",async e=>{
  e.preventDefault();
  await saveInsurance({
    type:document.querySelector("#ins-type").value,
    provider:document.querySelector("#ins-provider").value.trim(),
    name:document.querySelector("#ins-name").value.trim(),
    monthlyPremium:Number(document.querySelector("#ins-premium").value||0),
    paymentDay:Number(document.querySelector("#ins-payment-day").value||1),
    reminderDaysBefore:Number(document.querySelector("#ins-reminder").value||0),
    startDate:document.querySelector("#ins-start").value,
    endDate:document.querySelector("#ins-end").value||null,
    usageEvents:[],active:true
  });
  e.target.reset();editor.hidden=true;toast("Póliza guardada.");await refresh();
});

document.querySelector("#use-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const p=rows.find(x=>x.id===document.querySelector("#use-policy").value);if(!p)return;
  const ev={
    date:document.querySelector("#use-date").value,
    provider:document.querySelector("#use-provider").value.trim(),
    serviceCost:Number(document.querySelector("#use-cost").value||0),
    coveredAmount:Number(document.querySelector("#use-covered").value||0),
    copay:Number(document.querySelector("#use-copay").value||0),
    reimbursementPending:Number(document.querySelector("#use-reimbursement").value||0)
  };
  if(!await confirmAction({title:"Registrar uso del seguro",message:`Costo ${money(ev.serviceCost)} · cubierto ${money(ev.coveredAmount)}`,impact:["Solo se almacena información económica."]}))return;
  await saveInsurance({...p,usageEvents:[...(p.usageEvents||[]),ev]},p.id);
  e.target.reset();document.querySelector("#use-date").value=todayISO();useEditor.hidden=true;toast("Uso registrado.");await refresh();
});

list.addEventListener("click",async e=>{
  const ar=e.target.closest("[data-archive]"),re=e.target.closest("[data-reactivate]"),use=e.target.closest("[data-use]");
  if(use){document.querySelector("#use-policy").value=use.dataset.use;useEditor.hidden=false;editor.hidden=true;return}
  if(re){await reactivateInsurance(re.dataset.reactivate);await refresh();return}
  if(ar&&await confirmAction({title:"Archivar póliza",message:"Se conserva historial.",confirmText:"Archivar"})){await archiveInsurance(ar.dataset.archive);await refresh()}
});
requireUser(()=>refresh().catch(console.error));
