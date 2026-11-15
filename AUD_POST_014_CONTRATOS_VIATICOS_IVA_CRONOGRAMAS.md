# AUD-POST-014 · Contratos, Viáticos, IVA y cronogramas

Base: Web V1.0.87.

## Contratos
- El activo vinculado es opcional.
- La modalidad del período se selecciona por contrato: `calendar_month` o `anniversary`.
- Los contratos legacy sin modalidad explícita conservan `calendar_month`.
- En ciclo aniversario, el período inicia en el día ancla del contrato y termina el día anterior al siguiente aniversario mensual. Ejemplo: 29/05 → 28/06; 29/06 → 28/07.
- En meses cortos se ajusta el día al último día disponible y se recupera el día ancla cuando vuelve a existir.
- Nueva tarifa solo está disponible desde Información de un contrato activo y queda vinculada automáticamente a ese contrato.

## Viáticos
- Alta mediante modal; vista principal tabular.
- Información concentra Registrar gasto y, solo para fondos propios, Registrar reembolso.
- El gasto exige número de factura/comprobante, conserva categoría/subcategoría económica e IVA opcional.
- Gasto/settlement y Movimiento usan IDs distintos y referencias cruzadas.

## IVA / Impuestos
- Se integra en Facturación.
- Movimientos de ingreso pueden aportar IVA generado; egresos con factura pueden aportar IVA a favor.
- El panel consolida IVA generado, crédito tributario, estimado a pagar, saldo a favor y pago real.
- Una transacción ligada a una factura no vuelve a contabilizar el IVA de esa factura.
- Registrar pago IVA es la única acción que crea un nuevo egreso tributario.

## Deudas y tarjetas
- Cronogramas se abren como modales.
- Resumen superior + cuotas pendientes primero + pagadas al final + pie de cierre fijo.
- El mismo patrón se aplica a préstamos y planes financiados de tarjetas.

## Integridad
- IDs técnicos no se muestran.
- No se modifican reglas Firestore, índices ni configuración Firebase.
