# AUD-POST-010 · Presupuestos y alertas · Web V1.0.83

- El formulario deja de estar visible permanentemente: `+ Nuevo presupuesto` abre un modal.
- La selección usa `Categoría · Subcategoría` en un único flujo, igual que Movimientos.
- El mes visible usa `‹ Mes Año ›`; al pulsar el mes se abre selector de mes/año y aparece `Ir al mes actual` cuando corresponde.
- Resumen mensual: Presupuestado, Gastado, Disponible y % de uso.
- Lista compacta por presupuesto con progreso, rollover y detalle por `ⓘ`.
- Alertas: 30% restante, 10% restante y presupuesto sobrepasado.
- Las alertas Web se integran al menú global de Notificaciones junto con pagos e ingresos pendientes.
- No se modifica la fórmula contable existente: disponible = base + rollover positivo; restante = disponible - gasto analítico.
