# Tracker Financiero Personal V1.0.73

Correcciones sobre V1.0.71 + reglas Firestore corregidas.

## Facturación
- Editor alineado con Movimientos.
- Zona superior fija: Más IVA / Incluye IVA, monto, tarifa IVA, Base, IVA y Total.
- Zona central desplazable: datos de factura, fechas, contrato/cuenta por cobrar, cobro inicial y notas.
- Cabecera fija con Cerrar.
- Barra inferior fija con Cancelar / Guardar factura.
- Los errores de guardado permanecen visibles en la zona fija.
- La ventana solo se cierra después de un guardado confirmado.

## Movimientos contractuales legacy
- `normalizeTransaction()` conserva `contractId` y `contractAllocations`.
- La reversión relee el documento crudo de Firestore si el modelo cargado no contiene asignaciones.
- Se valida que la suma de asignaciones coincida con el monto antes de modificar cuentas por cobrar.
- Si no hay evidencia suficiente, no se elimina ningún dato.

## Sin cambios
- firebase-config.js
- Firestore Rules corregidas
- MIG-005 y lógica de facturación financiera fuera de los puntos indicados
