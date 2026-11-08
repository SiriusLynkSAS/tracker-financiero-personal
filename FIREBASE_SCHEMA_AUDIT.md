# Auditoría de integridad — V1.0.49 / V0.2.35

## Alcance
Esta versión corrige únicamente la primera etapa de integridad:
1. refrescos cache-first que podían alterar formularios;
2. duplicidad mensual de recurrentes entre dispositivos;
3. desaparición de ocurrencias recurrentes vencidas al cambiar de mes;
4. edición/eliminación directa de movimientos vinculados a recurrentes.

No incluye todavía la unificación Resumen/Pendientes, alertas de presupuesto,
Libreta ni edición avanzada de categorías.

## Firebase
- Proyecto Firebase: `tracker-financiero-personal`.
- `firebase-config.js`: sin cambios.
- `google-services.json`: sin cambios.
- `firestore.rules`: sin cambios y continúan idénticas entre Web y Android.
- Colecciones: sin altas ni bajas.
- Campos persistentes nuevos: ninguno.

## Recurrentes
- ID determinístico conservado: `recurring_<id>_YYYY-MM`.
- Web usa `runTransaction`.
- Android usa `FirebaseFirestore.runTransaction`.
- Registrar una ocurrencia recurrente requiere conexión para garantizar
  exclusión mutua entre dispositivos.
- La transacción incluye el movimiento y su registro de auditoría.
- Un movimiento recurrente ya no puede editarse/eliminarse mediante el flujo
  genérico de Movimientos.

## Pendientes vencidos
- Se conserva la ocurrencia vencida más antigua aún no registrada.
- También se evalúan la ocurrencia actual y la siguiente según la ventana de aviso.
- Esto evita que un atraso desaparezca al cambiar de mes sin generar una lista
  ilimitada de ocurrencias vencidas del mismo recurrente.

## Web cache-first
- Formularios con cambios, diálogos abiertos y editores visibles bloquean
  re-renderizados automáticos provocados por `tf-data-refreshed`.
- Movimientos conserva cuenta, categoría y subcategoría durante revalidaciones.
- Un recurrente abierto protege de forma explícita su cuenta habitual.

## Android notificaciones
- Se mantienen las ventanas aproximadas 08:00 y 20:00.
- El worker consulta ejecuciones recurrentes por `recurringOccurrence` dentro
  del horizonte requerido y conserva una consulta legacy acotada por fecha.

## Validación
- Auditoría estática de integridad: 79/79 comprobaciones satisfactorias.
- Todos los módulos JavaScript Web pasan análisis sintáctico como ES modules.
- PendingEngine Web fue probado con cambio de mes y atraso persistente.
- El núcleo Kotlin `Models + DebtMath + PendingEngine` compila aisladamente.
- No se realizó build Gradle Android completo: el proyecto no incluye Gradle
  Wrapper y el entorno no dispone del Android SDK/toolchain completo.
