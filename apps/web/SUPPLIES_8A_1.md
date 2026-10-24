# Corrección 8A.1

El componente `Supplies` ocultaba los controles con `bellhop && state.windowId`
y los encerraba en un `details` cerrado por defecto. Una ventana cerrada no
explicaba por qué desaparecían; una ventana abierta exigía encontrar y abrir
el desplegable. Estas condiciones explican la falta de visibilidad observada
en el código. No se ha reproducido visualmente el incidente del navegador.

Se sustituye el desplegable por controles visibles para Botones vivo y un
estado explicativo. Una ventana cerrada deshabilita el reparto sin ocultarlo.
El inventario se mantiene visible para todos, incluso con cero packs. La
tabla distingue fallecido (salud cero) de eliminado. Otros roles no reciben
controles de reparto.

La revisión de Lobby, RoundOne, RoundTwo y RoundThree confirma que el panel
común se monta fuera de la selección de pantalla de ronda. La autorización
parte de la ficha privada recibida para la sesión y del personaje vivo. Se
mantienen las comprobaciones del servidor y los eventos pack:give,
supplies:updated y game:role-unavailable. No se cambia ninguna ventana ni
se añade una vía para suplantar roles.

Ventanas existentes: después de ruta 1, preparación de ruta 2, después de
ruta 2, preparación de ruta 3 y después de ruta 3. La votación y la resolución
cierran la ventana. El inventario actual procede de SuppliesView; las tablas
históricas de las rondas no reflejan consumos posteriores.

Las regresiones React renderizan HTML con react-dom/server: presencia de
controles, ausencia de desplegable, estados deshabilitados, destinatarios,
existencias cero y petición pendiente recuperada. No ejecutan clics en un
navegador. Las pruebas Socket.IO verifican autorización, entrega real,
sincronización, reconexión, idempotencia y rechazo durante resolución.
Los casos deterministas del motor verifican muerte ambiental con salud 20,
daño acumulado con salud 35, un único superviviente y exclusión posterior.

## Comprobación manual pendiente

1. Arrancar `npm run dev:server` y `npm run dev:web` en dos terminales.
   Abrir http://localhost:5173 en cuatro perfiles independientes; crear una
   sala, unir los otros tres e iniciar. Identificar Botones por su ficha.
2. Durante la votación inicial, buscar «Gestionar suministros»: Botones ve
   «Entregar pack» deshabilitado y el motivo; los demás ven existencias sin
   selector ni botón de entrega.
3. Tres participantes votan RESCATAR. Después de completar la ruta 1,
   Botones selecciona un humano con energía inferior a 100 y entrega un pack.
   Comprobar aumento de hasta 25, límite 100 y reducción de una unidad en
   las cuatro pantallas. Probar también como destinatario a Botones.
4. Pulsar F5 en Botones: recuperar ficha, controles e inventario sin otra
   reducción. Para una confirmación perdida, comprobar «Reintentar entrega
   pendiente»; el servidor conserva el recibo y no duplica el consumo.
5. El creador avanza a ronda 2. Comprobar cierre durante votación del NPC;
   tres votos RESCATAR abren preparación. Entregar otro pack antes de abrir
   la votación de ruta. Al abrirla, verificar botón deshabilitado.
6. Tres votos por pasillo principal completan ruta 2. Comprobar que el
   reparto vuelve a estar disponible y conserva el inventario acumulado.
7. El creador avanza a ronda 3. Entregar un pack durante preparación, abrir
   votación (reparto deshabilitado) y aprobar puerta cortafuegos con tres
   votos. Comprobar reparto disponible después de ruta 3. La ruta añade las
   unidades médicas previstas; no reinicia los packs.
8. En ventanas abiertas, agotar packs repartiendo a humanos con energía
   inferior a 100: debe mantenerse el inventario cero y mostrarse el motivo
   del botón deshabilitado. Cambiar destinatario si el primero ya tiene 100.

No se han modificado costes, probabilidades ni reglas médicas. No hay
controles de depuración nuevos. Los escenarios mortales se construyen solo
en pruebas. Continúan pendientes la fase 8B, las reglas de relevo si fallece
Botones y la ronda 4. Las salas siguen almacenadas en memoria: F5 conserva
la sesión mientras el servidor siga activo; reiniciarlo pierde las salas.
