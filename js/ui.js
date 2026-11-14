import { escapeHtml } from "./utils.js";
let modalHost=null,toastHost=null,lastFocus=null;
function ensureHosts(){
  if(!modalHost){
    modalHost=document.createElement("dialog");
    modalHost.className="tf-modal-dialog tf-confirm-dialog";
    modalHost.setAttribute("aria-labelledby","tf-modal-title");
    modalHost.innerHTML=`<div class="tf-confirm-content"><h3 id="tf-modal-title" data-modal-title>Confirmar</h3><div data-modal-message></div><div data-modal-impact></div><div class="tf-actions" style="justify-content:flex-end;margin-top:1rem"><button type="button" class="tf-btn tf-btn-secondary" data-modal-cancel>Cancelar</button><button type="button" class="tf-btn tf-btn-primary" data-modal-confirm>Confirmar</button></div></div>`;
    document.body.appendChild(modalHost);
  }
  if(!toastHost){toastHost=document.createElement("div");toastHost.className="tf-toast-host";document.body.appendChild(toastHost)}
}
export function confirmAction({title="Confirmar cambio",message="",impact=[],confirmText="Confirmar",danger=false}={}){
  ensureHosts();lastFocus=document.activeElement;
  modalHost.querySelector("[data-modal-title]").textContent=title;
  modalHost.querySelector("[data-modal-message]").innerHTML=`<p>${escapeHtml(message)}</p>`;
  modalHost.querySelector("[data-modal-impact]").innerHTML=impact.length?`<div class="tf-subtle"><strong>Impacto:</strong><ul>${impact.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`:"";
  const ok=modalHost.querySelector("[data-modal-confirm]"),cancel=modalHost.querySelector("[data-modal-cancel]");
  ok.textContent=confirmText;ok.className=`tf-btn ${danger?"tf-btn-danger":"tf-btn-primary"}`;
  if(!modalHost.open)modalHost.showModal();
  setTimeout(()=>cancel.focus(),0);
  return new Promise(resolve=>{
    let settled=false;
    const close=v=>{
      if(settled)return;settled=true;
      ok.onclick=null;cancel.onclick=null;modalHost.oncancel=null;
      if(modalHost.open)modalHost.close();
      if(lastFocus?.focus)setTimeout(()=>lastFocus.focus(),0);
      resolve(v);
    };
    modalHost.oncancel=e=>{e.preventDefault();close(false)};
    ok.onclick=()=>close(true);
    cancel.onclick=()=>close(false);
  });
}
export function toast(message,ms=2800){
  ensureHosts();const el=document.createElement("div");el.className="tf-toast";el.setAttribute("role","status");el.textContent=message;toastHost.appendChild(el);setTimeout(()=>el.remove(),ms);
}
