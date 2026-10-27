# Auditoría de compatibilidad Firebase — 2026-10-26

## Resultado
**Aprobado para compatibilidad estática Web ↔ Android ↔ Firestore Rules.**

La versión no renombra colecciones ni campos históricos y no ejecuta migraciones destructivas. Los campos nuevos son aditivos y las lecturas legacy conservan sus aliases existentes.

## Colecciones canónicas verificadas
`accounts`, `assets`, `auditLog`, `budgets`, `businessTrips`, `categories`, `contracts`, `emergencyFund`, `financingPlans`, `goals`, `insurance`, `investments`, `liabilities`, `monthlyPlans`, `receivables`, `reconciliations`, `recurring`, `taxPayments`, `transactions`, `tripExpenses`, `tripSettlements`

Las 21 subcolecciones anteriores están contempladas por las reglas compartidas. Web y Android continúan escribiendo bajo `users/{uid}/...`.

## Reglas
- SHA-256 Web: `640232df2f4e0e70cf239a4ee25d6b380c46ee54c27ba821e4bdece229d9f44d`
- SHA-256 Android: `640232df2f4e0e70cf239a4ee25d6b380c46ee54c27ba821e4bdece229d9f44d`
- Resultado: **idénticas**.
- No se requieren cambios de reglas para los campos nuevos porque las reglas actuales validan los campos contractuales mínimos y permiten campos adicionales.

## Campos canónicos auditados

### `transactions`
`type`, `date`, `transactionDateTime`, `amount`, `vat`, `receipt`, `description`, `category`, `subcategory`, `accountId`, `fromAccountId`, `toAccountId`, `splits`, `feeAmount`, `taxAmount`, `otherChargeAmount`, `grossDebitAmount`, `recurringId`, `recurringOccurrence`, `recurringScheduledDate`, `financingPlanId`, `installmentNumber`, `liabilityId`, `debtPaymentId`

Los campos de fecha histórica `date` y los identificadores de cuentas se mantienen. `transactionDateTime`, los cargos bancarios y los vínculos de recurrentes se agregan sin sustituirlos.

### `recurring`
`name`, `type`, `amount`, `accountId`, `category`, `subcategory`, `dayOfMonth`, `reminderDaysBefore`, `startDate`, `endDate`, `active`

`accountId` permanece como cuenta habitual opcional. La ejecución real se registra en `transactions`.

### `liabilities`
`creditor`, `concept`, `mode`, `scheduleSource`, `amortizationMethod`, `originalPrincipal`, `currentManualBalance`, `bankReportedBalance`, `annualRate`, `termMonths`, `firstPaymentDate`, `paidThroughInstallment`, `currentInstallment`, `reminderDaysBefore`, `schedule`, `status`, `paidOffDate`, `active`, `liabilityType`

Se conserva `schedule` y su estructura histórica. No se reemplaza `bankReportedBalance`, `currentManualBalance` ni `paidThroughInstallment`.

### `financingPlans`
`parentType`, `parentId`, `planType`, `description`, `originalPrincipal`, `amortizationMethod`, `annualRate`, `installmentCount`, `bankInstallment`, `firstPaymentDate`, `initialFee`, `paidThroughInstallment`, `currentInstallment`, `reminderDaysBefore`, `calculatedPending`, `schedule`, `status`, `paidOffDate`, `active`

### Pago anidado dentro de `schedule[].payments[]`
`id`, `date`, `amount`, `capital`, `interest`, `fees`, `reportedBalanceAfter`, `accountId`, `transactionId`, `note`, `closesInstallment`, `bankFeeAmount`, `bankTaxAmount`, `bankOtherChargeAmount`, `destinationBank`, `reference`

Los cargos contractuales del préstamo continúan en `fees`. Los cargos del banco desde donde se realiza el pago usan `bankFeeAmount`, `bankTaxAmount` y `bankOtherChargeAmount`, para no mezclar conceptos.

## Identificador mensual de recurrentes
Se detectó durante la auditoría una incompatibilidad antes de la entrega:
- Web construía `recurring_<id>_YYYY-MM`.
- Android construía `recurring_<id>_YYYYMM`.

Se corrigió Android para usar exactamente **`recurring_<id>_YYYY-MM`**, igual que Web. Esto impide que una misma ocurrencia mensual pueda terminar representada por dos documentos distintos según la plataforma.

Campos de vínculo:
- `recurringId`
- `recurringOccurrence`
- `recurringScheduledDate`

## Pendientes y notificaciones
No se creó una colección `notifications` ni `pending`. Los pendientes se derivan de:
- `recurring`
- `liabilities`
- `financingPlans`
- `transactions`

Esto evita una segunda fuente de verdad que pueda quedar desincronizada.

## Cargos e impuestos
El estándar compartido dentro de `transactions` es:
- `feeAmount`
- `taxAmount`
- `otherChargeAmount`
- `grossDebitAmount`

El monto principal continúa en `amount`. En transferencias y pagos de tarjeta, la cuenta destino recibe el principal; la cuenta origen descuenta principal + cargos.

## Compatibilidad histórica
- Los documentos antiguos sin `transactionDateTime` usan `date` como respaldo.
- Los movimientos antiguos sin cargos interpretan esos valores como cero.
- Los recurrentes antiguos sin `recurringOccurrence` pueden reconocerse por el mes de `date` cuando ya están vinculados.
- Las deudas conservan la normalización/aliases legacy ya existentes.
- No se eliminan ni sobrescriben documentos históricos durante la carga.

## Configuración Firebase Web
Se verificó que `js/firebase-config.js` continúa apuntando al proyecto `tracker-financiero-personal` y no fue sustituido por valores de ejemplo.

## Limitación de la auditoría
Esta es una auditoría estática de código, reglas y contratos de campos. No modifica ni inspecciona el contenido privado real de Firestore. La validación de datos existentes se realiza mediante las capas de compatibilidad incluidas en la app.
