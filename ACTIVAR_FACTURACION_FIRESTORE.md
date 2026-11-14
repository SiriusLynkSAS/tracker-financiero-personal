# Activar F-FAC-001 en Firestore

La colección `invoices` fue incorporada en F-FAC-001. Publicar la web en GitHub Pages **no publica las reglas de Firestore**.

## Opción A · Firebase CLI

Desde la raíz del proyecto, con Firebase CLI autenticado:

```bash
firebase deploy --only firestore:rules --project tracker-financiero-personal
```

El archivo utilizado es `firebase/firestore.rules`.

## Opción B · Consola Firebase

Firestore Database → Reglas → sustituir por el contenido de `firebase/firestore.rules` → Publicar.

Después, recargar la Web. El aviso rojo de Facturación debe desaparecer y el botón **Nueva factura** vuelve a habilitarse.
