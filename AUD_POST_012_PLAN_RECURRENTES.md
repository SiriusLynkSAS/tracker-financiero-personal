# AUD-POST-012 · Plan mensual, Recurrentes y tabla compacta Android

Base: Web V1.0.84 / Android V0.2.36.5.22  
Resultado: Web V1.0.85 / Android V0.2.36.5.23

## Presupuestos Android
- La tabla principal deja de desplazarse horizontalmente.
- Columnas: Nombre | Usado | Disponible | Información.
- El detalle conserva base, rollover, disponible total, gastado, saldo y edición.

## Recurrentes
### Web
- Se eliminan las tarjetas como lista principal.
- Tabla: Nombre | Tipo | Cantidad | Fecha | Estado | Registrar | Información.
- Registrar pago/ingreso abre un editor de Movimiento dentro de Recurrentes, sin navegación a otra página.
- El movimiento se precarga desde la plantilla y se persiste con `saveRecurringTransaction`, conservando la protección de ocurrencia mensual única.
- Información concentra editar, archivar/reactivar y registrar.

### Android
- Lista compacta en tabla: Nombre | Cantidad | Fecha | Información.
- Registrar pago/ingreso se ejecuta desde Información mediante `TransactionEditorDialog` precargado.
- Se conservan edición, archivo/reactivación y vínculo a la ocurrencia mensual.

## Plan mensual
- Se eliminan las pestañas Plan / Ejecución / Ajustes.
- Se eliminan del flujo operativo: ajustes manuales, ahorro manual, notas, restablecimiento y Guardar plan.
- El plan pasa a ser consolidado automático de fuentes estructuradas.
- Web muestra Plan del mes y Ejecución real en paralelo.
- Debajo se presentan tablas separadas: Ingresos previstos, Compromisos, Objetivos y Reservas del mes.
- Reservas incluye Presupuestos + IVA pendiente de liquidación.
- Para facturas vinculadas a cuentas por cobrar, el ingreso previsto se expresa bruto y el IVA se reserva aparte, evitando doble conteo del disponible.
- Android aplica la misma lógica financiera y la presenta sin pestañas.

## Persistencia
- No se eliminan documentos legacy `monthlyPlans`; simplemente dejan de gobernar el consolidado operativo.
- No se modifican reglas Firestore, índices ni configuración Firebase.
