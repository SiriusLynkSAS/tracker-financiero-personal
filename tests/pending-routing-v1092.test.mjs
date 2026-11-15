import assert from 'node:assert/strict';
import fs from 'node:fs';
const notifications=fs.readFileSync(new URL('../js/notifications.js',import.meta.url),'utf8');
const pending=fs.readFileSync(new URL('../js/pending.js',import.meta.url),'utf8');
assert.match(notifications,/href="pendientes\.html\?focus=\$\{encodeURIComponent\(x\.key\)\}"/,
  'Las notificaciones de pagos/cuotas deben abrir el Centro de Pendientes y no la acción de pago directa.');
assert.doesNotMatch(notifications,/pending\.slice\(0,5\)[\s\S]{0,500}href="\$\{x\.url\}"/,
  'El menú no debe saltar directamente a pagar/cobrar un pendiente.');
assert.match(pending,/new URLSearchParams\(location\.search\)\.get\("focus"\)/,
  'Pendientes debe aceptar el elemento enfocado desde la notificación.');
assert.match(pending,/if\(target\) openPending\(target\)/,
  'El pendiente enfocado debe abrir su detalle para elegir pagar o cerrar histórico.');
assert.match(pending,/pending-detail-historical/,
  'Debe conservarse la acción Ya pagado / histórico.');
console.log('pending-routing-v1092: ok');
