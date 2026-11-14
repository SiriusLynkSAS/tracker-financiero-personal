# V1.0.81 · AUD-POST-008 · Sistema unificado de fechas

- Todos los `input[type=date]` Web usan el mismo patrón visual de Movimientos: botón de calendario + picker nativo.
- Los campos opcionales permiten quitar la fecha sin escribir manualmente.
- Se cubren también fechas creadas dinámicamente mediante `MutationObserver`.
- `confirmAction()` usa ahora un `<dialog>` modal del top layer del navegador. Esto evita que una confirmación invocada desde otro diálogo (por ejemplo, Editar fechas de Contratos) quede detrás o al final de la página.
- No se añade hora a ningún campo de fecha fuera de Movimientos/Facturación que ya la requieren por lógica propia.
