# Tracker Financiero Personal V1.0.42

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


## V1.0.26 — Plan mensual

Nuevo módulo `Plan mensual`, separado de `Presupuestos`.

### Objetivo
Responder:
`¿Cuánto dinero puedo gastar este mes después de cubrir mis compromisos y ahorro?`

### Fuentes automáticas
- Ingresos recurrentes.
- Egresos recurrentes.
- Cuotas de préstamos con vencimiento en el mes.
- Cuotas de planes de tarjeta con vencimiento en el mes.
- Primas mensuales de seguros.
- Presupuestos variables por subcategoría.
- Metas de ahorro con fecha objetivo.

### Cálculo
`Disponible para gastar = ingresos previstos - compromisos - ahorro - reservas variables`

### Control de duplicados
Cada fuente automática tiene un control `Incluir en el plan`.
Esto permite excluir una obligación si está registrada en más de un módulo,
por ejemplo una prima de seguro que también fue creada como recurrente.

### Ahorro
Las metas con fecha objetivo generan un aporte mensual sugerido según:
- objetivo;
- ahorro acumulado actual;
- meses restantes.
El usuario puede reemplazar el total sugerido por un valor manual mensual.

### Ajustes manuales
Permite agregar:
- ingreso adicional;
- compromiso adicional;
- reserva variable adicional.

### Configuración mensual
Se guarda en:
`users/{uid}/monthlyPlans/{YYYY-MM}`

Se persisten:
- exclusiones de fuentes;
- ajustes manuales;
- modo y monto de ahorro;
- nota;
- último cálculo resumen.

Las fuentes automáticas permanecen vinculadas a los módulos originales.

### Ejecución registrada
Se muestra separada de la proyección para evitar dobles conteos:
- ingresos reales;
- egresos de caja;
- pagos de planes de tarjeta;
- cuotas de préstamo marcadas pagadas;
- flujo registrado.

### Seguridad
Se añade regla Firestore owner-only para `monthlyPlans`.

Después de actualizar el proyecto Firebase, publicar:
`firebase deploy --only firestore:rules`

### Exportación
`monthlyPlans` se incorpora al JSON de respaldo.

Firebase config real preservado.


## V1.0.27 — Paridad funcional con Android V0.2.14

Base web: V1.0.26.
Referencia Android revisada: V0.2.14.

### Nuevos módulos Web
- Fondo de emergencia.
- IVA / Impuestos.

### Fondo de emergencia
Colección compartida:
`users/{uid}/emergencyFund/main`

Comportamiento homologado:
- objetivo 3 / 6 / 9 / 12 meses;
- mínimo inicial de alimentación USD 5/día;
- mínimo inicial de transporte USD 1/día;
- si existen al menos 90 días de historial, usa el mayor entre mínimo y promedio real;
- recurrentes esenciales;
- seguro de salud;
- próxima cuota obligatoria de préstamos;
- próxima cuota comprometida de tarjetas;
- inclusión/exclusión manual de componentes;
- cuentas reales vinculadas al fondo;
- aportes y retiros como transferencias reales;
- sugerencia al fondo del 80% del ahorro recomendado mientras la cobertura sea menor a 3 meses;
- 60% hasta alcanzar el objetivo configurado.

### IVA / Impuestos
Colección compartida:
`users/{uid}/taxPayments`

Movimientos de ingreso ahora soportan:
- `hasInvoice`
- `invoiceNumber`
- `invoiceBase`
- `taxPeriod`
- `taxPaymentId`
- `vatStatus`

La liquidación:
1. toma facturas pendientes del mismo período;
2. congela el IVA esperado;
3. guarda el IVA realmente pagado;
4. marca las facturas como liquidadas;
5. crea el egreso bancario real por el IVA pagado;
6. bloquea la eliminación de movimientos vinculados.

### Plan mensual
Se reemplaza el esquema provisional de V1.0.26 por el esquema compartido con Android:
- `excludedSources`
- `adjustments`
- `manualSavings`
- `savingsMode`
- `notes`
- `lastCalculation`

Compatibilidad de lectura con documentos V1.0.26:
- `excludedSourceKeys`
- `manualItems`
- `savingMode`
- `savingAmount`
- `note`

También incorpora:
- cuentas por cobrar vencibles en el mes como ingreso previsto;
- solo cuotas pendientes de préstamos/tarjetas;
- claves de fuente idénticas a Android;
- ajustes de ingreso, compromiso, ahorro y reserva.

### Cuentas por cobrar
La generación automática se alinea con Android:
- solo se generan períodos de trabajo ya cerrados;
- no se genera por anticipado el mes de trabajo actual;
- contratos finalizados conservan los períodos que correspondan hasta su fecha de cierre.

### Metas
- prioridad Alta / Media / Baja;
- edición;
- aporte mensual requerido;
- cuenta vinculada o acumulado manual;
- acceso al fondo de emergencia.

### Dashboard
Nueva Proyección del mes:
- ingresos proyectados;
- egresos registrados;
- egresos pendientes;
- ahorro recomendado del 10% sobre ingreso neto de IVA;
- IVA reservado;
- disponible proyectado.

También muestra el avance del fondo de emergencia.

### Firebase
Se agregan reglas owner-only para:
- `emergencyFund`
- `taxPayments`

Se actualiza `monthlyPlans` al mismo contrato usado por Android.

Después de reemplazar esta versión, publicar las reglas:
`firebase deploy --only firestore:rules`

### Exportación
El JSON ahora incluye:
- `taxPayments`
- `emergencyFund`

El CSV de movimientos incluye campos tributarios.

La configuración Firebase Web real se mantiene sin cambios.


## V1.0.28 — Cierre de auditoría Web ↔ Android

Correcciones aplicadas después de auditar Android V0.2.14 contra Web V1.0.27.

### Presupuestos realmente mensuales
- `month` pasa a ser obligatorio al crear/editar desde Web.
- selector de mes visible y navegación mes anterior/actual/siguiente;
- evita duplicar categoría + subcategoría + mes;
- documentos legacy sin `month` solo se interpretan como presupuesto del mes calendario actual hasta que sean editados;
- Firestore exige `month` y `rollover` en nuevas escrituras.

### Rollover real y compartido
El rollover se calcula de forma recursiva:
`disponible = límite base + saldo positivo no usado del mes anterior`.
El mes anterior puede, a su vez, incluir su propio rollover.
El Plan mensual utiliza exactamente el mismo cálculo que la pantalla Presupuestos.
Los movimientos con `splits` se imputan a su subcategoría correspondiente.

### Contratos
Al pulsar `Finalizar`, la fecha de cierre se fija en la fecha efectiva de finalización (o en la fecha de inicio si el contrato todavía no había comenzado). Ya no se conserva accidentalmente una fecha futura preexistente.

### Recurrentes
La Web ahora permite:
- crear;
- editar;
- actualizar monto, cuenta, categoría, día, recordatorio y vigencia;
- registrar ahora;
- archivar.

### Paridad
Esta versión está diseñada para trabajar con Android V0.2.15 sobre el mismo Firebase.


## V1.0.29 — Contratos: cierre mensual y prorrateo diario

### Regla de devengo
Un contrato mensual genera su cuenta por cobrar únicamente cuando el período de
trabajo queda cerrado.

- Un mes activo en curso no genera cuenta por cobrar.
- El primer día del mes siguiente, el mes anterior queda devengado.
- Si el contrato termina durante el mes actual, ese mes se considera cerrado
  inmediatamente en la fecha efectiva de finalización.

### Prorrateo
Los meses parciales se calculan por días calendario inclusivos:

`importe = tarifa mensual × días trabajados / días calendario del mes`

Ejemplo:
- tarifa: USD 750;
- septiembre: 30 días;
- finalización: 7 de septiembre;
- días trabajados: 7;
- cuenta por cobrar: USD 175,00.

La misma regla se aplica al mes inicial cuando el contrato empieza después del
día 1.

### Reparación de períodos erróneos heredados
`syncReceivablesClosed()` ahora reconcilia documentos ya existentes:

- un período actual/futuro no devengado y sin pagos se marca `active:false`,
  `status:"void"`;
- al cerrar posteriormente ese período, el mismo documento puede reactivarse
  con el cálculo correcto;
- períodos ya pagados o parciales no se reescriben automáticamente;
- las cuentas por cobrar anuladas dejan de mostrarse en la UI.

Esto corrige filas heredadas como un cobro completo de septiembre creado antes
de terminar septiembre.

### Trazabilidad del cálculo
Las cuentas por cobrar nuevas/actualizadas almacenan:
- `serviceStart`
- `serviceEnd`
- `workedDays`
- `monthDays`
- `prorated`
- `earnedAt`

No se requieren cambios en Firestore Rules.


## V1.0.30 — Comisiones / Viáticos y recuperación de períodos

### Comisiones / Viáticos
Nuevas colecciones compartidas con Android:
- `businessTrips`
- `tripExpenses`
- `tripSettlements`

Cada comisión mantiene separados:
- gasto real desembolsado;
- valor facturado;
- valor reconocido por la entidad;
- anticipos recibidos;
- reembolsos recibidos;
- devoluciones de anticipo;
- monto reconocido aún por recuperar;
- costo personal esperado.

Los movimientos bancarios usan tipos de libro específicos:
- `work_expense`
- `work_reimbursement`
- `work_advance`
- `work_advance_return`

Estos tipos sí modifican el saldo real de la cuenta, pero no se mezclan con
ingresos ni gastos personales de los reportes.

El gasto de comisión crea simultáneamente:
1. `tripExpenses/{id}`;
2. el movimiento bancario vinculado en `transactions/{id}`.

La anulación del gasto se realiza desde Comisiones para conservar integridad.

### Recuperar período perdido
Conciliación incorpora un flujo específico para cuando se deja de registrar por
varios días:

1. cuenta;
2. última fecha confiable;
3. fecha del saldo real;
4. saldo real del banco;
5. Tracker calcula la diferencia.

Si existe diferencia, se crea un único movimiento:
- categoría `Por clasificar`;
- subcategoría `Período perdido`;
- `reconciliationAdjustment = true`;
- `classificationStatus = unclassified`.

No se inventan compras individuales. El movimiento puede reclasificarse
posteriormente desde Movimientos.

La conciliación guarda:
- saldo Tracker antes del ajuste;
- diferencia original;
- transacción de ajuste;
- saldo conciliado final.

### Firebase
Se amplían `transactions` para los cuatro tipos de flujo de comisión y se
añaden reglas owner-only para:
- `businessTrips`
- `tripExpenses`
- `tripSettlements`

Después de actualizar esta versión se deben publicar las reglas:
`firebase deploy --only firestore:rules`


## V1.0.31 — Conciliación reversible y sincronizada

Web y Android usan ahora el mismo modelo de conciliación:

- `trackerBalanceBefore`
- `bankBalance`
- `differenceBefore`
- `adjustmentTransactionId`
- `adjustmentAmount`
- `trackerBalanceAfter`
- `differenceAfter`
- `status`
- `classificationStatus`
- `mode`
- `active`

Estados de conciliación:
- `review`
- `reopened`
- `needs_review`
- `reconciled`
- `reconciled_with_adjustment`
- `voided`

Estados de clasificación del ajuste:
- `none`
- `unclassified`
- `partial`
- `classified`

### Flujo
Una conciliación normal registra primero la diferencia. Si existe diferencia,
puede resolverse con un único movimiento de ajuste `Por clasificar`.

`Recuperar período` crea ese ajuste automáticamente cuando el saldo Tracker no
coincide con el saldo real.

### Edición y reversión
- Editar recalcula únicamente el ajuste vinculado.
- Si cambia el monto del ajuste, su clasificación se reinicia.
- Reabrir conserva el ajuste pero devuelve la conciliación a revisión.
- Eliminar es una reversión lógica: la conciliación queda `voided` y su ajuste
  se elimina del libro, devolviendo el saldo al punto previo.
- Los demás movimientos reales no se modifican.
- Las conciliaciones posteriores quedan `needs_review`.

### Reclasificación
El ajuste se clasifica mediante `splits`. La suma total del movimiento no
cambia, por lo que reclasificar no modifica el saldo de la cuenta. La
clasificación puede reiniciarse para volver todo el ajuste a `Por clasificar`
sin alterar el saldo.

### Cuentas
Bancos y cuentas muestra:
- saldo actual;
- última conciliación válida;
- saldo conciliado;
- alerta cuando existe una conciliación posterior que requiere revisión.

### Compatibilidad
Los documentos antiguos con `trackerBalance`, `difference` e `invalidated`
se normalizan al nuevo modelo al leerlos. Se mantienen los alias históricos
para que versiones anteriores no pierdan compatibilidad.

No se agregaron colecciones ni se modificaron Firestore Rules respecto de
V1.0.30.


## V1.0.34 — Analítica conciliada, cierre contractual por fecha y recuperación de activos

- Los ajustes de conciliación sin clasificar ya no se contabilizan como ingreso o gasto analítico. Los saldos bancarios sí conservan el ajuste completo. En clasificaciones parciales, solo las divisiones ya clasificadas participan en reportes/presupuestos.
- Dashboard, proyección mensual, ejecución del Plan mensual, presupuestos, fondo de emergencia y reportes usan la misma vista analítica de movimientos.
- Finalización de contratos por fecha efectiva seleccionable. Una fecha futura queda programada; al alcanzarse se cierra automáticamente. El período final se prorratea por días calendario.
- Advertencia cuando existen períodos pagados posteriores o un período final pagado cuyo valor no puede recalcularse automáticamente.
- Contratos admiten múltiples activos con porcentaje de atribución y un costo directo mensual adicional al transporte.
- Activos separan costo puesto en operación, mejoras capitalizables, costos operativos, costo financiero, depreciación lineal, recuperación devengada/cobrada por contratos, pendiente de recuperar, resultado económico y ROI.
- Compatibilidad con contratos históricos: `assetId` se interpreta como una asignación del 100% si no existe `assetAllocations`.
- No se requieren reglas Firestore nuevas respecto de V1.0.31.


## V1.0.34 — conciliación como corrección de saldo

Los movimientos generados por conciliación (`reconciliationAdjustment = true`)
se excluyen siempre de la analítica de ingresos y egresos, aunque la
conciliación haya sido aprobada o el ajuste haya sido clasificado. Siguen
modificando el saldo real de la cuenta.

La clasificación del ajuste es documental: explica de dónde provino la
diferencia, pero no lo convierte automáticamente en ingreso/gasto. Dashboard,
Plan mensual, proyecciones, presupuestos y reportes usan esta misma regla.


## V1.0.34 — conciliación fuera de ingresos proyectados

- Los ajustes de conciliación se excluyen siempre de ingresos, egresos y proyecciones.
- Compatibilidad con movimientos heredados: además de `reconciliationAdjustment`, se reconocen por `reconciliationId` y por la descripción canónica `Ajuste de conciliación`.
- La inferencia se aplica al cargar movimientos y en el motor analítico, evitando que una conciliación aprobada/clasificada vuelva a entrar como ingreso.


## V1.0.35 — Deudas históricas y seguimiento unificado

- Edición de préstamos reforzada para actualizar siempre el mismo documento por ID.
- Bloqueo de doble guardado y prevención de duplicados activos por acreedor + concepto.
- Deudas manuales/importadas conservan plazo original, primera cuota, pagado hasta y cronograma visible.
- Modo manual: saldo reportado + cronograma de seguimiento, con cuota informada opcional.
- Modo importado/reportado: cronograma mensual con cuota informada por acreedor.
- El saldo informado puede coexistir con el saldo teórico en deudas calculadas y se muestra la diferencia.
- “Pagado” en tarjetas de préstamo pasa a “Capital amortizado”.
- Pagos históricos se representan como estado del cronograma y no generan transacciones bancarias retroactivas.
- Los registros antiguos sin cronograma pueden visualizar un cronograma derivado al abrirlos, usando sus campos históricos.


## V1.0.38 — Paridad Resumen / Deudas

- `Deudas y tarjetas` y `Resumen` usan la misma base para préstamos activos.
- Los registros históricos de `liabilities` se normalizan en memoria como préstamos aunque no tengan `liabilityType`.
- La deuda de tarjeta se toma del saldo real de cada cuenta de crédito, igual que en Resumen.
- Si una tarjeta tiene deuda pero no tiene `financingPlans`, se muestra igualmente en Deudas y tarjetas.
- Los planes de financiamiento permanecen como desglose; ya no son la única condición para que una deuda de tarjeta sea visible.
- El saldo informado por acreedor tiene prioridad como saldo de referencia también en Resumen, manteniendo paridad con el módulo Deudas.


## V1.0.38 — Recuperación y visibilidad de deudas existentes

- El módulo Deudas muestra todos los documentos de `liabilities`: activos y archivados.
- Los registros archivados pueden reactivarse directamente.
- Adaptador defensivo para esquemas antiguos: nombres, saldo, principal, plazo, tasa y fechas anteriores.
- Un registro legado defectuoso ya no impide renderizar toda la lista.
- El módulo muestra cuántos documentos fueron leídos de Firebase para verificar la carga real.
- La carga de tarjetas/cuentas/movimientos ya no bloquea la visualización de préstamos si uno de esos módulos falla.


## V1.0.39 — Pagos reales y dinámicos de deudas

- El cronograma permanece como expectativa y cada cuota puede registrar el pago realmente realizado.
- Cada pago guarda fecha, monto, capital, interés, otros cargos, nota y saldo informado después del pago.
- Soporta pagos parciales: una cuota puede recibir varios pagos sin avanzar a la siguiente hasta marcarla como completada.
- Permite crear un egreso en Movimientos, vincular un egreso existente o registrar el pago sin movimiento bancario.
- Los movimientos vinculados a una deuda quedan protegidos contra edición/eliminación directa.
- Las cuotas históricas anteriores al uso de Tracker permanecen como historial y no crean movimientos retroactivos.


## V1.0.41 — Movimientos: registro rápido + detalles opcionales

- Formulario principal reducido a tipo, monto, cuenta, categoría/subcategoría, descripción y fecha.
- Factura, IVA, referencia y splits pasan a “Más detalles”.
- Monto nuevo vacío; campos monetarios usan entrada decimal y seleccionan el valor completo al enfocar.
- Selector de tipo mediante botones Gasto / Ingreso / Transferencia.
- Cuenta usada recientemente se recuerda localmente para el próximo movimiento.
- Atajos Hoy / Ayer para fecha.
- Los selectores quitan el foco de campos de texto para evitar mantener teclados abiertos en dispositivos táctiles.
- Botón Guardar permanece accesible y muestra el monto actual.


## V1.0.41 — Movimientos, recurrentes y pendientes
- Movimientos ordenables por fecha/hora real, búsqueda y filtros.
- `transactionDateTime` es aditivo; `date` se conserva para compatibilidad.
- Recurrentes se ejecutan una sola vez por mes con ID de transacción determinístico y campos `recurringId` / `recurringOccurrence`.
- Transferencias admiten `feeAmount`, `taxAmount`, `otherChargeAmount` y `grossDebitAmount`.
- Centro de pendientes Web con campana y pantalla dedicada.
- No se renombraron colecciones ni campos históricos de Firebase.


## V1.0.42 — Cache-first, archivados y modo consulta

- Firestore Web usa caché persistente IndexedDB con coordinación entre pestañas.
- Las lecturas de entidades priorizan memoria/caché local y revalidan Firebase en segundo plano.
- Consultas idénticas simultáneas se deduplican en memoria.
- Las pantallas se vuelven a renderizar de forma debounced cuando termina una revalidación remota.
- Cuentas, recurrentes, metas, deudas/planes de tarjeta, activos, seguros, contratos e inversiones muestran por defecto solo registros operativos.
- Los registros archivados/finalizados se abren mediante un botón específico y dejan de ocupar permanentemente la vista principal.
- Los formularios de creación/edición ya no permanecen abiertos de forma permanente: Nuevo y Editar son acciones explícitas.
- Los contratos finalizados y las inversiones liquidadas se muestran como histórico de solo lectura; no se reactivan automáticamente.
- No se renombró, migró ni eliminó ningún campo o colección Firestore.
