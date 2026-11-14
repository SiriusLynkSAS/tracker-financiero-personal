# AUD-POST-006 / AUD-POST-007 · V1.0.80

## AUD-POST-006
La compra de parlantes Logitech permanece pagada hasta la cuota 2 por decisión validada del usuario. Este parche NO modifica el plan ni reconstruye movimientos históricos. Evita nuevas inconsistencias bloqueando edición/eliminación directa de movimientos con `financingPlanId` tanto en Web como en Android.

## AUD-POST-007
La reversión Web de `contractPayments` ya no persiste el `id` de UI dentro del documento. El caso auditado `lkX7XLbnKSPrmFV187ul` se corrige desde un panel explícito en Contratos, eliminando solo `data.id`.
