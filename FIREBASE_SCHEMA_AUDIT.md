# Auditoría de compatibilidad Firebase y regresión

## Base auditada
- Web estable de origen: V1.0.41
- Android estable de origen: V0.2.31
- Nuevas versiones: Web V1.0.42 / Android V0.2.32

## Resultado de contrato de datos
- Proyecto Firebase: `tracker-financiero-personal` en ambas plataformas.
- No se renombró ninguna colección.
- No se renombró, eliminó ni migró ningún campo existente.
- `firestore.rules` permanece idéntico a las versiones estables y entre Web/Android.
- `google-services.json` Android permanece sin cambios.
- `js/firebase-config.js` conserva la misma configuración Web.
- Los documentos históricos sin campo `active` continúan tratándose como activos (`active != false` / `active !== false`).
- El ID mensual de recurrentes se conserva como `recurring_<id>_YYYY-MM` en Web y Android.
- No se añadió ninguna colección `notifications`, `pending` ni una segunda fuente de verdad.

## Campos canónicos preservados en transactions
- `transactionDateTime`
- `feeAmount`
- `taxAmount`
- `otherChargeAmount`
- `grossDebitAmount`
- `recurringId`
- `recurringOccurrence`
- `recurringScheduledDate`
- `financingPlanId`
- `installmentNumber`
- `liabilityId`
- `debtPaymentId`

## Política de archivado
- Vista normal: documentos con `active` ausente o distinto de `false`.
- Vista Archivados: documentos con `active == false`.
- Los archivados siguen cargándose cuando son necesarios para resolver nombres/historial.
- Cuentas, recurrentes, metas, deudas, planes de tarjeta, seguros y activos permiten reactivación explícita.
- Contratos finalizados e inversiones liquidadas se consideran histórico y no se reactivan automáticamente.

## Política de caché
- Web: Firestore IndexedDB persistente + caché en memoria + revalidación remota.
- Android: primera publicación desde `Source.CACHE`; luego `Source.DEFAULT` en segundo plano.
- La caché modifica la estrategia de lectura, no el esquema ni las rutas Firestore.
- Las escrituras mantienen la validación normal de Firebase.

## Modo consulta / edición
- Un registro existente se presenta como información de consulta.
- La edición se abre únicamente mediante una acción explícita `Editar`.
- `Nuevo` abre un formulario de creación.
- `Cancelar` cierra el editor sin alterar el registro.


## Verificación final
- Auditoría estática cruzada: **148/148 comprobaciones satisfactorias**.
- Los 41 módulos JavaScript Web pasan análisis sintáctico como ES modules.
- Se verificaron IDs DOM de los módulos modificados y sus imports desde `data-service.js`.
- Se compararon colecciones literales contra las versiones estables: sin altas ni bajas inesperadas.
- Se verificaron imports `rememberSaveable`, métodos nuevos y balance estructural de los Kotlin modificados.
- No se ejecutó un build Gradle Android completo porque el paquete no incluye Gradle Wrapper y el entorno no dispone del toolchain Android completo.
