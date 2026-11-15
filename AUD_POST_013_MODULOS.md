# AUD-POST-013 — Consolidación visual e integridad de módulos

Base: Web V1.0.85 → V1.0.86.

## Alcance

- Plan mensual: `Plan del mes` a la izquierda y `Ejecución real` a la derecha en escritorio; las fuentes se mantienen como consolidado automático.
- Fondo de emergencia: las cuentas incluidas y los componentes del gasto esencial se administran desde diálogos. En Web la selección usa checkboxes.
- Metas: vista principal en tabla; el detalle y las acciones están en `Información`.
- Deudas: tabla con información financiera, `Cronograma` e `Información`.
- Tarjetas de crédito: separación explícita entre `Deuda total` y `Planes financiados`, ambas en tabla.
- Seguros: tabla de pólizas + tabla de usos/coberturas y flujo `Registrar cobertura`.

## Integridad de Seguros ↔ Movimientos

`insurance usage` y `transaction` son entidades distintas y nunca comparten el mismo ID documental.

Cuando `pago personal > 0`:

- se genera `usageId` para el uso del seguro;
- se genera un ID distinto para el movimiento;
- el uso almacena `transactionId`;
- el movimiento almacena `insuranceUsageId` e `insurancePolicyId`;
- ambos se crean en el mismo batch Firestore;
- el movimiento representa únicamente el pago personal;
- el IVA/factura se registra sobre ese pago personal.

Cuando `pago personal = 0`:

- la cuenta de pago permanece deshabilitada;
- se registra el uso/cobertura;
- no se crea movimiento;
- `transactionId` queda vacío/nulo según la plataforma.

Los movimientos vinculados a una cobertura quedan protegidos contra edición y eliminación directa desde Movimientos. La gestión debe realizarse desde Seguros.

## Persistencia

No se modificaron:

- `js/firebase-config.js`
- `firebase/firestore.rules`
- `firebase/firestore.indexes.json`

No se requiere republicar reglas o índices para este bloque.
