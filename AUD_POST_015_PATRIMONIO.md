# AUD-POST-015 · Patrimonio y vínculos contables

Base: Web V1.0.88.

- Seguros: la prima mensual se vincula a una cuenta y a un recurrente determinístico; registrar prima genera una sola ocurrencia mensual.
- Activos: compra nueva y eventos monetarios crean Movimientos vinculados en la misma escritura atómica; activos históricos no crean movimientos retroactivos.
- Inversiones: una inversión externa usa `investment_out`/`investment_return`; una inversión respaldada por una cuenta real usa transferencias normales entre cuentas. Solo el rendimiento es ingreso.
- Fondo de emergencia: separa inversiones inmediatas y reserva secundaria; una cuenta que respalda una inversión no se vuelve a sumar como cuenta del fondo.
- Patrimonio Web: las cuentas que respaldan inversiones se excluyen de liquidez y su saldo se clasifica una sola vez como inversión.
- Una cuenta no puede respaldar dos inversiones activas.
- Movimientos estructurados de activos e inversiones están protegidos contra edición/eliminación directa desde Movimientos.
