# Tracker Financiero Personal V1.0.25

Proyecto Quarto + Firebase de uso personal.

## Incluye
- múltiples cuentas por banco y tarjetas de crédito;
- movimientos con splits;
- presupuestos con rollover;
- recurrentes y calendario;
- metas;
- deudas manuales/calculadas, sistemas alemán y francés;
- compras a plazos y avances de efectivo en tarjeta;
- seguimiento de cuotas;
- seguros y uso económico;
- activos productivos con transporte, mantenimiento, certificaciones, depreciación e ingresos;
- contratos sin fecha final, desfase de cobro, tarifas por períodos, pagos parciales y pagos que cubren varios períodos;
- inversiones bancarias;
- conciliación;
- importación CSV/XLSX manual;
- exportación JSON/CSV;
- reportes;
- auditoría;
- confirmaciones según impacto;
- sin conexión automática con bancos.

## Firebase
1. Crea proyecto Firebase.
2. Activa Authentication > Email/Password y crea manualmente tu usuario.
3. Crea Firestore.
4. Registra app Web y copia la configuración en `js/firebase-config.js`.
5. `npm install -g firebase-tools`
6. `firebase login`
7. `firebase use --add`
8. En RStudio: `quarto::quarto_preview()`
9. Despliegue:
   `quarto render`
   `firebase deploy --only firestore:rules,firestore:indexes,hosting`

Antes de datos reales, prueba con información ficticia y con un segundo usuario para verificar aislamiento por UID.


## Corrección V1.0.1

- Categorías y subcategorías de uso operativo se seleccionan desde listas desplegables.
- Las listas son dependientes: primero categoría, luego subcategoría.
- Orden alfabético automático en español:
  1. categoría;
  2. subcategoría.
- Aplicado a:
  - movimientos;
  - divisiones (splits);
  - presupuestos;
  - movimientos recurrentes.
- La pantalla `Categorías` conserva campos de texto porque es el lugar donde se crean nuevas entradas.
- Después de cada alta/eliminación en `Categorías`, el listado se vuelve a ordenar automáticamente.

## Corrección V1.0.2

- Se conserva automáticamente la configuración Firebase real del proyecto `tracker-financiero-personal`.
- Se corrigen tarjetas de métricas con importes que se partían o quedaban demasiado estrechos.
- `Generado`, `Cobrado` y `Por cobrar` ahora usan columnas responsivas.
- Se mejora la visualización de métricas similares en Activos y Seguros.
- En móvil, las métricas se apilan verticalmente.


## Mejora V1.0.3

- Dashboard con período seleccionable:
  - este mes;
  - este año;
  - histórico.
- KPIs patrimoniales ampliados:
  - liquidez;
  - inversiones;
  - activos productivos;
  - deudas;
  - patrimonio neto.
- KPIs de flujo para el período:
  - ingresos;
  - egresos;
  - flujo neto;
  - cuentas por cobrar.
- Gráfico tipo dona para composición actual de activos.
- Gráfico tipo dona para distribución de egresos por categoría.
- Se mantiene la configuración Firebase real del proyecto.


## Mejora visual V1.0.4

- Se agrega modo claro / oscuro con:
  - detección automática inicial según sistema;
  - cambio manual mediante botón flotante;
  - persistencia local del tema elegido.
- Rediseño visual más user friendly:
  - tarjetas más limpias y modernas;
  - formularios y botones más claros;
  - tablas más legibles;
  - navbar más agradable y consistente;
  - mejoras responsive para móvil y escritorio.
- Se conserva la configuración Firebase real del proyecto.


## Rediseño UX/UI V1.0.5

- Nueva navegación lateral tipo aplicación.
- Agrupación funcional:
  - Principal
  - Operación
  - Patrimonio
  - Trabajo
  - Control
- Iconos vectoriales integrados, sin librerías externas.
- Página activa claramente destacada.
- Selector de modo claro/oscuro integrado en la navegación.
- Barra superior compacta en móvil.
- Menú lateral deslizable en pantallas pequeñas.
- Dashboard con lenguaje y jerarquía visual más amigables.
- La lógica financiera y el modelo Firebase no cambian.
- Se conserva la configuración Firebase real.


## Ajuste visual V1.0.6

Paleta minimalista y estética compatible con modo claro y oscuro.

### Paleta
- Azul: identidad principal y liquidez.
- Teal: patrimonio, activos y estados positivos.
- Ámbar: compromisos, vencimientos y trabajo.
- Coral: egresos, deudas y estados negativos.
- Violeta: inversiones, reportes y control.

### Aplicación
- Acento suave por grupo funcional del sidebar.
- Tarjetas con bordes/gradientes sutiles.
- KPIs patrimoniales con color semántico.
- Formularios con foco adaptado a la sección.
- Tablas con interacción cromática discreta.
- Login con tratamiento azul/teal.
- Gráficos del resumen y reportes con paletas controladas.
- Los gráficos se actualizan al cambiar entre claro y oscuro.
- La configuración Firebase real se conserva.


## V1.0.7 — Integridad financiera + categorías visuales

### Categorías
- Icono y color pertenecen a la categoría, no a la subcategoría.
- Catálogo local de iconos SVG; Firestore guarda solo `icon` y `color`.
- Paleta cerrada compatible con modo claro/oscuro.
- Edición del estilo de una categoría aplica a todas sus subcategorías.
- Dashboard muestra dona limpia + leyenda con icono, nombre, valor y porcentaje.
- Categorías pequeñas se agrupan en `Otros` para no saturar el gráfico.

### Correcciones críticas de auditoría
- Conciliación calcula saldo histórico a la fecha elegida.
- Editar una transacción invalida conciliaciones desde la fecha más temprana afectada.
- Saldo de deuda `0` ya no se interpreta como dato faltante.
- Saldo calculado usa el cierre de la última cuota pagada.
- Modos de deuda bloquean combinaciones inválidas.
- Cuotas informadas por banco no inventan desglose capital/interés.
- Compra financiada afecta el saldo real de la tarjeta sin duplicar el gasto.
- Avance de efectivo se registra como transferencia tarjeta → cuenta destino.
- Pago de cuota de tarjeta crea transferencia cuenta bancaria → tarjeta.
- Tasa efectiva/nominal de inversiones ahora se interpreta correctamente.
- Plazos mensuales/anuales de inversiones usan fechas calendario.
- Inversión exige cuenta origen o confirmación explícita de movimiento ya registrado.
- Liquidación separa retorno de capital de rendimiento financiero.
- Archivar ya no es el mecanismo de liquidación de inversiones.
- Cobros de contratos bloquean sobrepagos no asignados.
- Nueva tarifa recalcula períodos futuros no pagados y congela períodos pagados/parciales.
- Transporte estimado de contrato se muestra en la evaluación del contrato.
- Calendario muestra todos los eventos dentro del horizonte seleccionado.
- Recordatorios ya tienen estado visible en dashboard/calendario.
- Importación interpreta fechas Excel y omite duplicados exactos.
- Exportación JSON incluye auditoría y se renombra conceptualmente como copia de datos.
- Escrituras normales y auditoría se realizan mediante batch atómico.
- Snapshots de auditoría compactan arrays grandes para reducir crecimiento.
- Security Rules endurecidas por colección y sin delete para entidades históricas.
- Modal de confirmación admite Escape, focus trap y devuelve el foco.

### Pendiente para V1.1 (requiere migración de datos)
- Migrar `asset.events`, `insurance.usageEvents` y cronogramas extensos a subcolecciones.
- Edición completa y uniforme de todos los módulos históricos.
- Restauración de exportación JSON.
- Aportes propios para metas, separados del saldo completo de la cuenta.
- App Check y Content-Security-Policy.

### Compatibilidad adicional V1.0.7
- Los activos creados en versiones anteriores con `marketValue = 0` por dejar el campo vacío se interpretan como valor de mercado no informado y usan valor contable.
- Desde V1.0.7 se guarda `marketValueProvided` para distinguir explícitamente `0` de `null`.
- La rentabilidad visual de activos incorpora cobros de contratos vinculados y transporte mensual estimado de los períodos generados.


## Corrección V1.0.8 — separación préstamos / tarjetas

- Los préstamos/deudas y los planes de tarjeta ya no comparten el mismo contexto de cronograma.
- Un préstamo muestra únicamente:
  - acreedor;
  - concepto;
  - tasa;
  - cronograma;
  - saldo;
  - estado de cuotas.
- El selector `Cuenta bancaria para pagar la tarjeta` solo existe en el cronograma de tarjetas.
- Los botones de pago son independientes:
  - préstamo: `Marcar pagada`;
  - tarjeta: `Pagar cuota`.
- Se eliminó la inferencia de tipo basada únicamente en coincidencia de IDs entre colecciones.
- Se usan estados separados:
  - `selectedDebtId`;
  - `selectedCardPlanId`.
- Al abrir un préstamo se cierra el cronograma de tarjeta y viceversa.
- Los préstamos nuevos se guardan con `liabilityType: "loan"`.
- Visualmente:
  - préstamos usan acento ámbar;
  - tarjetas usan acento violeta.
- Firebase config real preservado.


## Corrección V1.0.9 — tarjeta resumen de préstamos

- Cada tarjeta de préstamo ahora muestra tres métricas visibles:
  - **Préstamo**: capital original.
  - **Pagado**: capital amortizado estimado.
  - **Pendiente**: saldo actual.
- Se mantiene además:
  - acreedor;
  - concepto;
  - saldo destacado;
  - tasa;
  - estado de cuota actual;
  - acceso al cronograma.
- Cálculo visual usado:
  - `pendiente = currentManualBalance ?? calculatedBalance ?? originalPrincipal`
  - `pagado = max(0, originalPrincipal - pendiente)`
- Firebase config real preservado.


## V1.0.10 — Resumen de préstamos y deuda de tarjetas

- El módulo muestra ahora tres KPI agregados:
  - préstamos pendientes;
  - planes de tarjeta pendientes;
  - deuda total pendiente.
- Cada préstamo conserva:
  - Préstamo;
  - Pagado;
  - Pendiente.
- Cada plan de tarjeta muestra:
  - Plan: total programado de cuotas;
  - Pagado: suma de cuotas pagadas;
  - Pendiente: suma de cuotas todavía no pagadas.
- Para planes con cuota informada por el banco no se inventa desglose de capital/interés.
- Préstamos y tarjetas siguen separados funcionalmente.
- Firebase config real preservado.


## V1.0.11 — Edición de préstamos y deudas

- Se agrega botón **Editar** en cada préstamo/deuda.
- El formulario existente se reutiliza para edición.
- Se puede modificar:
  - acreedor;
  - concepto;
  - modo;
  - sistema de amortización;
  - capital original;
  - saldo manual;
  - tasa;
  - tipo de tasa;
  - plazo;
  - primera cuota;
  - cuota actual;
  - recordatorio.
- Cambios simples no reconstruyen el cronograma innecesariamente.
- Cambios financieros requieren confirmación.
- En deudas calculadas:
  - cuotas ya pagadas se conservan;
  - cuotas futuras se recalculan;
  - saldo pendiente se vuelve a calcular.
- Se impide reducir el plazo por debajo de las cuotas ya pagadas.
- Existe botón **Cancelar edición**.
- Auditoría se mantiene mediante `saveLiability`.
- Firebase config real preservado.


## V1.0.12 — Mejora visual de préstamos y planes de tarjeta

- Se mejora la jerarquía visual de las tarjetas de deuda.
- Cambios principales:
  - título y subtítulo mejor definidos;
  - métricas con mejor proporción y legibilidad;
  - tarjeta hero para el saldo pendiente;
  - chips informativos para modo, tasa y cuota;
  - botones organizados en grilla consistente;
  - `Archivar` pasa a una fila propia;
  - `Pendiente` se destaca visualmente.
- Se aplica tanto a:
  - préstamos/deudas;
  - planes de tarjeta.
- Se reducen los problemas de truncamiento en montos medianos/altos.
- Firebase config real preservado.


## V1.0.13 — Mejora de legibilidad en métricas de deuda

- Se mejora específicamente la lectura de:
  - Préstamo;
  - Pagado;
  - Pendiente.
- Cambios:
  - las tarjetas de métricas reciben más ancho mínimo;
  - los montos usan mejor tamaño y salto de línea;
  - en pantallas angostas la grilla cambia de 3 columnas a 2;
  - `Pendiente` pasa a ocupar todo el ancho cuando hace falta;
  - en pantallas muy estrechas las métricas pasan a 1 columna.
- Se conserva el formato visual general de V1.0.12.
- Firebase config real preservado.


## V1.0.14 — Reacomodo de métricas en tarjetas de deuda

- Se corrige el problema de espacio insuficiente en:
  - Préstamo;
  - Pagado;
  - Pendiente.
- Nuevo layout:
  - primera fila: `Préstamo` + `Pagado`;
  - segunda fila: `Pendiente` ocupa todo el ancho.
- Beneficios:
  - desaparece el recorte lateral del tercer bloque;
  - los montos se muestran completos con mayor probabilidad;
  - la solución depende del ancho real disponible en la tarjeta, no de suposiciones visuales.
- En pantallas muy estrechas:
  - las tres métricas pasan a una sola columna.
- Se mantiene el estilo general de V1.0.13.
- Firebase config real preservado.


## V1.0.15 — Simplificación de métricas en deudas

- Se elimina la duplicidad entre:
  - `Pendiente`
  - `Saldo pendiente`
- Ahora en préstamos se muestra:
  - **Préstamo**
  - **Pagado**
  - **Saldo pendiente**
- Ahora en planes de tarjeta se muestra:
  - **Plan**
  - **Pagado**
  - **Saldo pendiente**
- En tarjetas, la caja principal cambia de etiqueta:
  - de `Saldo del plan`
  - a **`Saldo pendiente`**
- Se mantiene el estilo general y se aprovecha mejor el espacio horizontal.
- Firebase config real preservado.


## V1.0.16 — Sincronización de cronograma y cuota actual

- Al marcar una cuota de préstamo como pagada:
  - la fila cambia inmediatamente a **Pagada**;
  - el saldo pendiente toma el `closingBalance` de esa cuota;
  - `currentInstallment` avanza a la siguiente cuota pendiente;
  - la tarjeta resumen se actualiza;
  - el cronograma se vuelve a dibujar automáticamente.
- Ejemplo:
  - antes: `cuota 16/36`;
  - se paga cuota 16;
  - después: `cuota 17/36`.
- Solo la primera cuota pendiente puede marcarse como pagada.
- Se impide pagar cuotas fuera de secuencia.
- Cuotas futuras muestran que deben esperar a la cuota actual.
- Cuando se paga la última cuota:
  - estado `paid_off`;
  - saldo pendiente llega al saldo de cierre;
  - la tarjeta muestra `Liquidado`.
- Se corrige la diferencia conceptual entre:
  - última cuota pagada;
  - próxima cuota a pagar.
- Firebase config real preservado.


## V1.0.17 — Corrección real de actualización de deuda

### Causa corregida
En préstamos calculados, `currentManualBalance` podía tener prioridad sobre
`calculatedBalance`. Por eso el cronograma podía actualizarse pero la tarjeta
seguía mostrando el saldo anterior.

### Nuevo modelo
- Préstamo calculado:
  - `calculatedBalance` = saldo operativo del cronograma.
  - `bankReportedBalance` = saldo opcional informado por el acreedor.
  - `currentManualBalance` = `null`.
- Préstamo manual/importado:
  - `currentManualBalance` = saldo pendiente operativo.

### Cuota
- `currentInstallment` significa ahora **próxima cuota a pagar**.
- Ejemplo:
  - `16/36` = cuotas 1–15 pagadas;
  - al pagar 16 → `17/36`.
- Al crear/editar una deuda calculada con próxima cuota 16:
  - cuotas 1–15 se marcan como históricamente pagadas;
  - el saldo se coloca al cierre de la cuota 15.
- Deudas antiguas se normalizan al realizar el siguiente pago.

### Interfaz
- `Saldo informado por acreedor` es opcional en modo calculado.
- Ese dato ya no bloquea el saldo calculado.
- Dashboard usa saldo calculado para préstamos calculados.
- Firebase config real preservado.


## V1.0.18 — Saldo pendiente calculado desde la cuota seleccionada

### Préstamos calculados
- El campo editable de saldo se elimina del modo calculado.
- Se muestra `Saldo pendiente calculado`, solo lectura.
- El usuario introduce:
  - capital;
  - tasa;
  - sistema;
  - plazo;
  - primera cuota;
  - **Pagado hasta la cuota**.
- Al pulsar `Calcular`:
  - se genera el cronograma;
  - las cuotas 1..N se consideran pagadas;
  - el saldo pendiente corresponde al `closingBalance` de la cuota N;
  - si N = 0, el saldo pendiente es el capital original;
  - se muestra la siguiente cuota pendiente.
- Al guardar:
  - todas las cuotas 1..N se guardan con `status = paid`;
  - las cuotas N+1..plazo se guardan `pending`;
  - `calculatedBalance` se guarda con el saldo resultante;
  - `paidThroughInstallment = N`;
  - `currentInstallment` queda como la siguiente cuota pendiente.
- Si N = plazo:
  - saldo = 0;
  - estado = `paid_off`.

### Manual/importado
- El saldo pendiente sigue siendo editable porque no existe cronograma calculable.

Firebase config real preservado.


## V1.0.19 — Información de la siguiente cuota

En préstamos calculados, encima de `Saldo pendiente calculado` se muestra
un panel de solo lectura con la siguiente cuota pendiente:

- N.º de cuota.
- Capital de esa cuota.
- Interés de esa cuota.
- Total de la cuota.

El panel:
- se actualiza al pulsar `Calcular`;
- se actualiza al editar una deuda;
- se actualiza al marcar una cuota como pagada;
- si ya no existen cuotas pendientes, indica que el préstamo está liquidado;
- permanece oculto en deudas manuales/importadas.

Firebase config real preservado.


## V1.0.20 — Siguiente cuota en la tarjeta del préstamo

Corrección de interpretación:
- la información solicitada no era solo en el formulario de cálculo;
- ahora también aparece en la **tarjeta visual del préstamo**.

En cada tarjeta de préstamo calculado, encima de `Saldo pendiente`, se muestra:
- Siguiente cuota;
- Capital;
- Interés;
- Total cuota.

Detalles:
- para préstamos manuales/importados no se muestra este bloque;
- si el préstamo está liquidado, la tarjeta muestra estado `Liquidado`;
- el bloque se calcula desde `paidThroughInstallment` y el cronograma actual.

Firebase config real preservado.


## V1.0.21 — Siguiente cuota con total en fila inferior

Ajuste visual del bloque `Siguiente cuota` en la tarjeta del préstamo:

- primera fila:
  - Capital
  - Interés
- segunda fila:
  - Total cuota (ancho completo)

Objetivo:
- mejorar legibilidad;
- dar mayor jerarquía al valor total de la cuota;
- mantener compatibilidad con tema claro/oscuro y responsive.

Firebase config real preservado.


## V1.0.22 — Paridad funcional de planes de tarjeta

Las mejoras realizadas en préstamos se trasladan a planes de tarjeta:

- `Pagado hasta la cuota`.
- Botón `Calcular`.
- Saldo pendiente de solo lectura.
- Panel de siguiente cuota:
  - número;
  - capital;
  - interés;
  - total.
- La tarjeta visual muestra también la siguiente cuota.
- Cronograma:
  - cuotas históricas pagadas;
  - próxima cuota resaltada;
  - cuotas futuras bloqueadas hasta pagar la actual.
- Al pagar:
  - solo se permite la primera cuota pendiente;
  - se actualiza `paidThroughInstallment`;
  - se recalcula el saldo pendiente;
  - avanza la próxima cuota;
  - se crea transferencia banco → tarjeta.
- Si se paga la última cuota, el plan pasa a `paid_off`.
- Edición de planes:
  - descripción;
  - método;
  - tasa;
  - número de cuotas;
  - cuota bancaria;
  - primera fecha;
  - pagado hasta.
- Durante edición quedan bloqueados:
  - tarjeta;
  - tipo de operación;
  - principal original;
  - comisión inicial.
  Esto evita desalinear el plan con los movimientos ya creados en el libro.
- No se puede reducir `Pagado hasta` por debajo de una cuota que ya tenga
  un pago bancario real registrado.
- Al crear un plan histórico, las cuotas previas pueden marcarse pagadas,
  pero no se inventan transferencias bancarias retroactivas.

Firebase config real preservado.


## V1.0.23 — Categorías y herencia de estilo

- Se corrige el selector de colores:
  - Azul, Celeste, Teal, Verde, Ámbar, Coral, Violeta y Gris ahora muestran
    su color real en lugar de verse todos azules.
- El color es propiedad de la categoría principal.
- Al escribir el nombre de una categoría ya existente:
  - se interpreta que se está agregando una subcategoría;
  - se ocultan los selectores de icono y color;
  - se muestra el estilo que será heredado.
- La subcategoría no puede definir un color diferente.
- El icono también se hereda del estilo de la categoría para evitar controles
  que luego serían ignorados.
- Por compatibilidad con el modelo Firestore actual, los documentos de
  subcategoría siguen almacenando `icon` y `color`, pero siempre se copian
  automáticamente desde la categoría padre.
- La tabla de categorías renderiza el estilo canónico de la categoría, no
  un estilo independiente de cada subcategoría.
- El editor `Estilo de categoría existente` continúa aplicando el cambio a
  todas sus subcategorías.

Firebase config real preservado.


## V1.0.24 — Selector de iconos sin duplicados

Se corrige el menú de iconos de Categorías.

### Causa
El catálogo `CATEGORY_ICONS` contenía iconos únicos, pero `setupPicker()` usaba
una expresión regular sobre el HTML completo de `iconOptionsHtml()`.
La coincidencia podía comenzar en un botón anterior y terminar en el icono
buscado, provocando que el selector repitiera visualmente varios iconos.

### Corrección
- Nuevo `iconOptionHtml()` renderiza exactamente un icono.
- `setupPicker()` deja de usar expresiones regulares sobre HTML.
- Nuevo `UNIQUE_CATEGORY_ICONS` elimina IDs duplicados de forma defensiva.
- La búsqueda sigue funcionando por:
  - ID;
  - etiqueta.
- La selección visual se mantiene.
- Se ajusta ligeramente el ancho mínimo de las tarjetas del selector.

Firebase config real preservado.


## V1.0.25 — Identidad Sirius / Canis para Web

Actualización visual sin cambios en la lógica financiera ni en el modelo de datos.

### Identidad
- Nueva marca web basada en el concepto Sirius / Canis.
- Tres estrellas de referencia, con Sirius como punto principal.
- Nuevo símbolo para:
  - sidebar;
  - barra móvil;
  - login;
  - favicon;
  - iconos web/PWA.
- Nuevos recursos locales en `assets/brand/`.

### Tema claro / oscuro
- La identidad se adapta a ambos temas sin invertir imágenes.
- Se conserva la paleta funcional existente para:
  - ingresos;
  - egresos;
  - deudas;
  - inversiones;
  - categorías;
  - alertas.
- Sirius se utiliza como lenguaje de identidad, foco y navegación.

### Login
- Nuevo layout de dos paneles en escritorio.
- Panel visual con constelación.
- Formulario limpio y responsive.
- En móvil se oculta el panel decorativo y se conserva la marca compacta.

### Web app
- Favicon SVG.
- Apple touch icon.
- Iconos PNG 192 y 512.
- `manifest.webmanifest`.
- `theme-color` sincronizado con claro/oscuro.

### Integridad
No se modificaron:
- colecciones Firestore;
- Security Rules;
- lógica de saldos;
- movimientos;
- préstamos;
- tarjetas;
- categorías;
- contratos;
- inversiones;
- auditoría.

La configuración Firebase real se preserva.
