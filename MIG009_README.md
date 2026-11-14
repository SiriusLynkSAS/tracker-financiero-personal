# Bloque 9 de 11 · MIG-009

## Caso auditado
- 5 receivables en RAW 2026-11-08.
- 4 contienen `data.id` redundante igual a su Document ID.
- `jsi7tqeDwG74ox98R7n4` ya está en formato canónico sin `data.id`.

## Acción
- Eliminar únicamente `data.id` de los 4 documentos legacy.
- No rellenar el quinto documento.
- No modificar campos financieros ni contractuales.
- Registrar trazabilidad en `auditLog`.

## Prevención
- Web hace que el Document ID gane sobre cualquier `data.id` al leer.
- `sanitizeReceivableWrite()` elimina `id` antes de escribir.
- `atomicWrite()` sanea `receivables` antes de persistirlos.
- Android ya usa `DocumentSnapshot.id` y `receivableMap()` no escribe `id`.
