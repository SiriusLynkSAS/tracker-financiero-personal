import { onAuthStateChanged,signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { auth } from "./firebase.js";

export function requireUser(callback){
  let refreshTimer=null;
  let bound=false;
  let currentUser=null;
  let queuedRefresh=false;

  const refreshBlocked=()=>{
    try{
      if(typeof window.__tfRefreshBlocked==="function" && window.__tfRefreshBlocked()) return true;
    }catch{}
    if(document.querySelector("dialog[open]")) return true;
    const visibleEditor=[...document.querySelectorAll('[id$="-editor"],[id$="-panel"]')]
      .some(el=>!el.hidden && el.getClientRects().length>0);
    if(visibleEditor) return true;
    return !!document.querySelector('form[data-tf-dirty="true"]');
  };

  const rerender=()=>{
    if(!currentUser||!callback)return;
    if(refreshBlocked()){
      queuedRefresh=true;
      return;
    }
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>callback(currentUser),300);
  };

  window.__tfReleaseRefresh=()=>{
    if(!queuedRefresh||refreshBlocked()) return;
    queuedRefresh=false;
    rerender();
  };

  return onAuthStateChanged(auth,user=>{
    if(!user){
      window.location.replace("index.html");
      return;
    }
    currentUser=user;
    document.querySelectorAll("[data-user-email]").forEach(el=>el.textContent=user.email||"Usuario");
    callback?.(user);

    // Las consultas cache-first muestran la UI de inmediato. Cuando la
    // revalidación remota termina, se vuelve a renderizar una sola vez
    // reutilizando el cache de memoria actualizado, sin una nueva cascada remota.
    if(!bound){
      window.addEventListener("tf-data-refreshed",rerender);
      bound=true;
    }
  });
}

document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-logout]");
  if(!b)return;
  b.disabled=true;
  try{
    await signOut(auth);
    window.location.replace("index.html");
  }finally{
    b.disabled=false;
  }
});

if(!window.__tfDirtyTrackingBound){
  const mark=e=>{
    const form=e.target?.closest?.("form");
    if(form) form.dataset.tfDirty="true";
  };
  document.addEventListener("input",mark,true);
  document.addEventListener("change",mark,true);
  document.addEventListener("reset",e=>{
    const form=e.target;
    if(form?.matches?.("form")){
      delete form.dataset.tfDirty;
      setTimeout(()=>window.__tfReleaseRefresh?.(),0);
    }
  },true);
  window.__tfDirtyTrackingBound=true;
}
