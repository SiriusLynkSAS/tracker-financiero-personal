# AUD-POST-009 · Bancos y cuentas

Base: Web V1.0.82 / Android V0.2.36.5.20.

## UX
- Las observaciones/paneles MIG ya no se cargan en pantallas operativas.
- Cuentas deja de mostrar un formulario permanente: Nueva cuenta abre un diálogo modal.
- La vista principal es un listado/tabla agrupado por institución; el icono de información abre el detalle.
- Editar reutiliza el mismo editor y conserva el Document ID; el ID no se muestra en la interfaz.
- Tipo de cuenta y saldo inicial quedan en la zona superior; detalles en zona desplazable; Cerrar/Cancelar/Guardar permanecen visibles.
- Últimos 4 dígitos: solo dígitos, máximo 4. Montos: teclado decimal y sanitización.
- Fecha base: selector global DateOnly, sin escritura manual y sin hora.

## Integridad y conexiones
- Snapshot auditado: 15 cuentas, 218 referencias efectivas a cuentas y 0 referencias huérfanas.
- Se preservan accountId/fromAccountId/toAccountId y parentId de tarjetas; editar una cuenta nunca crea un nuevo ID.
- Cuentas archivadas se conservan para historial, pero los módulos operativos usan cuentas activas para nuevas operaciones según corresponda.
- Se añadió preselección de cuenta en Conciliación al abrir desde el detalle de Cuentas.

## Paridad Android
- Android ahora lee y persiste last4, closingDay, paymentDay, reminderDaysBefore, statementBalance y minimumPayment.
- El editor usa teclado numérico/decimal y DateOnlyPickerField.
- Navegación desde detalle: Movimientos filtra por `?account=`, Conciliación preselecciona `?account=` y Deudas/Tarjetas resalta o preselecciona la tarjeta mediante `?card=`.
