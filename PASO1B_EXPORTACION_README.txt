TRACKER FINANCIERO PERSONAL · EXPORTACIÓN FIREBASE PARA PASO 1B
Versión base: Web V1.0.48
Proyecto Firebase conservado: tracker-financiero-personal

QUÉ CAMBIÓ
- Se conserva js/firebase-config.js real de la versión entregada.
- Se agrega js/audit-export.js.
- Se agrega un botón en Importar / Exportar:
  "Exportar datos RAW para auditoría".

QUÉ HACE
- Usa el usuario ya autenticado en la app Web.
- Lee directamente desde Firestore con getDocFromServer/getDocsFromServer.
- No utiliza los normalizadores de data-service.js.
- Exporta el documento users/{uid} y estas 21 colecciones conocidas:
  accounts, transactions, budgets, monthlyPlans, categories, recurring,
  goals, liabilities, financingPlans, insurance, assets, contracts,
  receivables, investments, reconciliations, taxPayments, emergencyFund,
  businessTrips, tripExpenses, tripSettlements, auditLog.
- Registra si cada colección está OK, vacía o presenta error.
- Descarga tracker-financiero-auditoria-AAAA-MM-DD.json.

QUÉ NO HACE
- No crea documentos.
- No modifica documentos.
- No elimina documentos.
- No cambia Firestore Rules.
- No necesita cuenta de servicio ni Google Cloud CLI.

CÓMO USARLO
1. Publica/renderiza esta versión igual que tu Web actual.
2. Inicia sesión normalmente.
3. Abre Importar / Exportar.
4. Pulsa "Exportar datos RAW para auditoría".
5. Espera el mensaje de exportación completada.
6. Se descargará un JSON en tu carpeta Descargas.
7. Sube ESE JSON a ChatGPT para ejecutar el Paso 1B.

IMPORTANTE
- El JSON descargado contiene datos financieros personales.
- No contiene la contraseña de tu cuenta ni una clave privada de Firebase.
- No compartas otros archivos de credenciales.
