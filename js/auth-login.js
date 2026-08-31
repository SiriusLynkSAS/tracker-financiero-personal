import { signInWithEmailAndPassword,onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { auth,configureAuthPersistence } from "./firebase.js";
const form=document.querySelector("#login-form"),errorBox=document.querySelector("#login-error"),submit=document.querySelector("#login-submit");
onAuthStateChanged(auth,user=>{if(user)window.location.replace("dashboard.html")});
form?.addEventListener("submit",async e=>{e.preventDefault();errorBox.classList.remove("is-visible");submit.disabled=true;try{await configureAuthPersistence();await signInWithEmailAndPassword(auth,document.querySelector("#email").value.trim(),document.querySelector("#password").value);window.location.replace("dashboard.html")}catch(err){console.error(err);errorBox.textContent="No fue posible iniciar sesión. Verifica correo y contraseña.";errorBox.classList.add("is-visible")}finally{submit.disabled=false}})
