import { escapeHtml } from "./utils.js";
let modalHost=null,toastHost=null,lastFocus=null;
function ensureHosts(){
  if(!modalHost){
    modalHost=document.createElement("div");
    modalHost.className="tf-modal-backdrop";
    modalHost.innerHTML=`<div class="tf-modal" role="dialog" aria-modal="true" aria-labelledby="tf-modal-title"><h3 id="tf-modal-title" data-modal-title>Confirmar</h3><div data-modal-message></div><div data-modal-impact></div><div class="tf-actions" style="justify-content:flex-end;margin-top:1rem"><button class="tf-btn tf-btn-secondary" data-modal-cancel>Cancelar</button><button class="tf-btn tf-btn-primary" data-modal-confirm>Confirmar</button></div></div>`;
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
  modalHost.classList.add("is-open");
  setTimeout(()=>cancel.focus(),0);
  return new Promise(resolve=>{
    const focusables=()=>[cancel,ok];
    const onKey=e=>{
      if(e.key==="Escape"){e.preventDefault();close(false)}
      if(e.key==="Tab"){const f=focusables(),i=f.indexOf(document.activeElement),next=e.shiftKey?(i<=0?f.length-1:i-1):(i>=f.length-1?0:i+1);e.preventDefault();f[next].focus()}
    };
    const close=v=>{
      modalHost.classList.remove("is-open");ok.onclick=null;cancel.onclick=null;document.removeEventListener("keydown",onKey);
      if(lastFocus?.focus)lastFocus.focus();resolve(v);
    };
    ok.onclick=()=>close(true);cancel.onclick=()=>close(false);document.addEventListener("keydown",onKey);
  });
}
export function toast(message,ms=2800){
  ensureHosts();const el=document.createElement("div");el.className="tf-toast";el.setAttribute("role","status");el.textContent=message;toastHost.appendChild(el);setTimeout(()=>el.remove(),ms);
}
