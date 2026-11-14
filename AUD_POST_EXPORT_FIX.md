# AUD-POST-001 / AUD-POST-002 · Exportador RAW

Base: Web V1.0.78.
Resultado: Web V1.0.79.

Cambios:
- cobertura RAW: 22 -> 26 colecciones;
- añadidas: `contractPayments`, `investmentBankReports`, `investmentSettlements`, `investmentTaxWithholdings`;
- `sourceAppVersion`: `V1.0.79`;
- `exporterVersion`: `1.1.0`;
- prueba automática `tests/audit-export-coverage.test.mjs` compara el exportador con `firebase/firestore.rules`.

Sin cambios en datos, cálculos, reglas Firestore, índices o configuración Firebase.
