# Preparación de migración — V1.0.48

Esta versión implementa la capa previa a la migración. No modifica por sí sola los documentos existentes.

## Snapshot validado
- 638 documentos.
- 21 colecciones conocidas.
- 14 con datos / 7 vacías.
- 0 errores de lectura.
- 0 referencias huérfanas detectadas en las relaciones auditadas.

## Legacy que debe seguir siendo tolerado
- 2 presupuestos sin `month`.
- 109 movimientos sin `transactionDateTime`.
- 23 movimientos con IVA legacy ambiguo.
- 1 deuda con `active=false` y `status=active`.
- 26 cuotas marcadas como pagadas sin `transaction/debtPaymentId` estructurado.
- 1 ocurrencia recurrente que requiere revisión manual por diferencias con la plantilla.

## Regla de despliegue
1. Desplegar Web V1.0.48 + Android V0.2.35.
2. Verificar lectura completa del snapshot sin escrituras masivas.
3. Publicar Rules compatibles con `schemaVersion=2`.
4. Tomar un nuevo respaldo RAW.
5. Ejecutar MIG-001…MIG-011 por lotes controlados, con comparación de saldos antes/después.
