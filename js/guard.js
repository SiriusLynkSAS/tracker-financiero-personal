import { onAuthStateChanged,signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { auth } from "./firebase.js";

export function requireUser(callback){
  let refreshTimer=null;
  let bound=false;
  let currentUser=null;

  const rerender=()=>{
    if(!currentUser||!callback)return;
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>callback(currentUser),300);
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
