# Bloque 6 de 11 · MIG-006

Caso auditado: `Quincena 2`, recurrente `u2XzlnZaKRqXHrucSaRi`, ocurrencia `2026-10`, movimiento `recurring_u2XzlnZaKRqXHrucSaRi_2026-10`.

La migración es deliberadamente manual. Web muestra la plantilla y el movimiento y permite:

1. **Conservar histórico**: no altera datos financieros; registra `mig006Resolution=keep_historical`.
2. **Alinear con plantilla**: cambia únicamente `accountId`, `category` y `subcategory`; conserva monto, fecha/hora, descripción y vínculo recurrente. Antes de confirmar muestra el impacto en saldos y marca conciliaciones cerradas posteriores de las cuentas afectadas como `review`.

Si la firma del caso ya no coincide con el snapshot auditado 2026-11-08, MIG-006 se bloquea y exige reauditoría.
