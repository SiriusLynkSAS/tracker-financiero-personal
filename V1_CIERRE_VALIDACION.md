# Cierre V1 — Web V1.0.93

Base: Web V1.0.92.

## Validaciones ejecutadas
- 27/27 pruebas `.test.mjs` ejecutables: PASS.
- `schema.test.mjs`: no ejecutado porque depende de un JSON externo no incluido en el paquete base.
- `node --check`: módulos modificados sin errores de sintaxis.
- Firebase sin cambios: `firebase/firestore.rules`, `firebase/firestore.indexes.json` y `js/firebase-config.js` conservan el mismo SHA-256 que la base V1.0.92.

## Cierre de paridad
- Pendientes visible en navegación y alertas de presupuesto integradas.
- Viáticos permite corregir el valor reconocido.
- Categorías y Metas usan ventanas modales.
- Impuestos legacy redirige a Facturación.
- Exportaciones identifican V1.0.93.
