import { onAuthStateChanged,signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { auth } from "./firebase.js";
export function requireUser(callback){return onAuthStateChanged(auth,user=>{if(!user){window.location.replace("index.html");return}document.querySelectorAll("[data-user-email]").forEach(el=>el.textContent=user.email||"Usuario");callback?.(user)})}
document.addEventListener("click",async e=>{const b=e.target.closest("[data-logout]");if(!b)return;b.disabled=true;try{await signOut(auth);window.location.replace("index.html")}finally{b.disabled=false}})
