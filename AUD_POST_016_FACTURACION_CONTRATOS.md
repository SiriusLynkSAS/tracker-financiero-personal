# AUD-POST-016 · Facturación ↔ Contratos + corrección estructurada

Base final: Web V1.0.89.

- Seleccionar una cuenta por cobrar contractual no reinicia el modo IVA ni borra monto, cliente o concepto ya escritos; solo completa campos vacíos.
- `Más IVA`: la base debe coincidir con el pendiente contractual.
- `Incluye IVA`: el total debe coincidir con el pendiente contractual. Ejemplo: contrato USD 750 con IVA incluido → total contractual USD 750; la base se deriva internamente.
- Cada factura vinculada conserva `contractualAmount`; cada cobro conserva `contractReceivableComponent` para imputar al contrato solo la porción contractual correcta.
- Contratos ya no crea cobros directos nuevos: abre el mismo flujo de Facturación dentro de la pantalla. Se admite factura fiscal o comprobante interno (`EXTRA-001`, etc.).
- Cobros directos históricos permanecen solo para trazabilidad/reversión.
- `Corregir cobro` actualiza la misma factura/cuenta por cobrar y el MISMO movimiento vinculado; no crea un segundo movimiento y marca conciliaciones de cuenta/fecha para revisión cuando corresponde.
- Los pagos de Deudas y planes financiados preasignan el ID del movimiento y guardan exactamente ese mismo ID en el cronograma.
- Desde Cronograma, `Corregir` modifica el mismo pago/transferencia y recalcula saldo, cuota y conciliaciones sin duplicar el ledger.
- Los cronogramas Web usan un modal ancho con scroll interno para mostrar todas las columnas; pendientes primero y pagadas al final.
- No cambia Firebase config, reglas ni índices.
