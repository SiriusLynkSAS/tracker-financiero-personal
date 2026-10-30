# Auditoría de compatibilidad Firebase y regresión

## Base
- Web origen: V1.0.42
- Android origen: V0.2.32
- Web nueva: V1.0.43
- Android nueva: V0.2.33

## Resultado
- Auditoría final: **67/67 verificaciones satisfactorias**.
- Todos los módulos JavaScript Web pasan análisis como ES modules.
- `firebase-config.js`, `google-services.json` y `firestore.rules` permanecen sin cambios.
- No se añade ninguna colección Firebase.
- No se renombra ni elimina ningún campo existente.
- `previousBalance`, `newBalance`, `balanceBefore` y `balanceAfter` **no se persisten** en Firebase.

## Saldos por movimiento
Los tres valores se calculan dinámicamente desde:
1. `openingBalance` de cada cuenta.
2. Todos los movimientos del ledger.
3. Orden por `transactionDateTime`, con ID como desempate determinístico.
4. El efecto financiero real del tipo de movimiento.

### Efectos
- ingreso / reembolso / anticipo: `+ amount`
- egreso / gasto de comisión / devolución de anticipo: `-(amount + cargos)`
- transferencia origen: `-(amount + cargos)`
- transferencia destino: `+ amount`
- salida a inversión: `- amount`
- retorno de inversión: `+ amount`

La transferencia presenta dos saldos independientes: origen y destino.

## Regresiones revisadas
- Caché persistente Web se conserva.
- Android cache-first se conserva.
- Notificaciones Android 08:00 / 20:00 se conservan.
- Categorías Web usa Nuevo/Editar explícitos; formularios cerrados por defecto.
- Se eliminó la entrada principal duplicada de Pendientes del sidebar Web.
- Android Categorías ya cumplía el patrón explícito Nuevo/Editar y no requirió cambio de datos.

## Limitación de compilación
No se ejecutó build Gradle Android completo porque el proyecto no incluye Gradle Wrapper y el entorno no dispone del toolchain Android completo.


## V1.0.44
- `Saldo final` es exclusivamente un valor calculado de presentación.
- No se añadieron `previousBalance`, `newBalance`, `balanceBefore` ni `balanceAfter` a Firestore.
- Se reutiliza `ledgerSnapshots`, calculado desde `openingBalance` + movimientos ordenados por `transactionDateTime`.
