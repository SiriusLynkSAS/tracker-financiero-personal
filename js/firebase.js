import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth,setPersistence,browserLocalPersistence } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app=initializeApp(firebaseConfig);
export const auth=getAuth(app);

// IndexedDB persistente + coordinación entre pestañas.
// No cambia rutas, colecciones ni campos de Firestore.
export const db=initializeFirestore(app,{
  localCache:persistentLocalCache({
    tabManager:persistentMultipleTabManager()
  })
});

export async function configureAuthPersistence(){
  await setPersistence(auth,browserLocalPersistence);
}
