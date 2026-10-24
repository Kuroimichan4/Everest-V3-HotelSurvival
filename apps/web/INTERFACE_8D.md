# Interfaz 8D

## Diagnóstico real

No había un append de instantáneas que añadiera cuatro pantallas. El servidor
publicaba una actualización por socket y el cliente utilizaba setters de
sustitución. La repetición visible estaba en la composición: cada ronda dibujaba
su tabla histórica, Suministros dibujaba otra tabla actual, Médico listaba otra
vez la salud de todos y Transporte podía seguir mostrando un resultado de una
ronda anterior junto a la acción nueva. El inventario también se repetía en
varios bloques completos.

App abría una segunda conexión Socket.IO solo para diagnóstico. Los efectos del
Lobby tenían dependencias vacías y desconectaban al limpiar, pero no retiraban
explícitamente sus listeners. No se atribuye la repetición de cuatro bloques a
StrictMode: se conserva ese modo y se comprueba el ciclo alta/baja/alta.

## Estructura actual

- `App`: un contenedor, un Lobby, sin conexión de diagnóstico adicional.
- `game-socket`: altas y bajas simétricas, callbacks desactivados después de la
  limpieza y comprobación del destinatario de la ficha privada.
- `game-state`: reducer de instantáneas por tipo; nunca append. Una instantánea
  idéntica conserva el estado existente. `activeScene` elige una única acción y
  un único voto de la ronda actual, también para enviar el voto desde Lobby.
- `GameScreen`: cabecera, personaje propio, una acción principal, equipo,
  inventario, resultado reciente e historial desplegable. El equipo tiene cuatro
  tarjetas con claves de participante estables. No se ocultan duplicados por CSS.
- `VotePanel`: opciones coherentes, permisos, voto propio y mayoría. El reloj
  compartido utiliza deadline/serverNow y tiempo monotónico desde la recepción;
  un cambio de instantánea no arranca de nuevo el plazo. El primer render de una
  votación recuperada también deriva el tiempo del servidor, evitando el cero
  transitorio que se detectó durante la prueba de navegador.
- `RoundOne`, `RoundTwo`, `RoundThree` y `Transport`: presentan solo la acción
  vigente. No contienen otras tablas del equipo ni su propio historial completo.
- `Supplies` y `Medical`: paneles exclusivos del especialista, con selector,
  existencias, bloqueo explicado y confirmación breve. Conservan solicitudes
  pendientes, recibos e idempotencia. Un ref impide crear otra solicitud durante
  un envío. Las confirmaciones no se generan al recibir instantáneas públicas.
- `game-history`: proyección de solo lectura, con claves de decisión, recorrido,
  tratamiento o entrega. El historial está cerrado inicialmente; abrirlo no
  emite peticiones ni vuelve a calcular consecuencias. Las tablas históricas,
  cuando existen, quedan dentro de sus registros desplegables.

La cabecera muestra sala, ronda, fase, conexión y reloj. El personaje tiene su
ficha privada cerrada inicialmente. El panel central prioriza recuperación de
ruta, fin de recorrido, transporte o acción de ronda, de forma excluyente.
Solo el anfitrión ve los avances de ronda. La ronda 4 no tiene controles.

El tema utiliza petróleo, gris azulado y acentos verdes; tarjetas, barras,
opciones bloqueadas reconocibles, foco de teclado y reglas para escritorio y
pantallas pequeñas. No se añade ninguna dependencia de UI o de navegador.

## Historial y privacidad

La única ampliación del servidor es una proyección pública de actividad y del
estado global de la palanca. Las entregas y tratamientos confirmados se guardan
con el recibo, ronda, destinatario público y recuperación real, limitada al máximo.
Un recibo repetido devuelve la confirmación previa sin agregar entrada ni emitir
otra actualización. No se publican actor, roles, credenciales ni conocimientos.

Los registros previos de simulación y las instantáneas históricas siguen intactos.
El cliente conserva las vistas anteriores para leerlas en el historial y recibe
de nuevo esos datos al reconectar. No infiere una nueva acción comparando energía
o salud entre dos eventos. Todo lo que se anuncia como confirmado procede del
servidor. Las salas siguen en memoria y se pierden al reiniciar el servidor.

El equipo muestra nombres, salud, energía y estado públicos. El rol y la ficha
solo se muestran para el participante autorizado. Desconectar limpia la ficha;
la revocación por muerte/abandono se conserva. No cambian autorizaciones,
mayorías, tiempos, costes, probabilidades, suministros, tratamientos, transporte,
abandonos, recompensas ni recuperación de rutas de 8C.1.

## Verificación

Las pruebas Vitest comprueban una pantalla/equipo/acción por estado, repetición
de snapshots, historial sin claves duplicadas, privacidad, acción vigente,
StrictMode mediante alta/baja/alta y limpieza de listeners. La prueba Socket.IO
con cuatro clientes comprueba una emisión de suministros por cliente, recibos
repetidos sin emisiones extra y recuperación del historial tras reconectar.
Las pruebas anteriores de presentación se adaptan al traslado del estado común
y de los resultados históricos, sin eliminar sus comprobaciones de permisos.

Se realizó una comprobación parcial en Edge headless real con cuatro pestañas
de sesiones independientes, utilizando la UI de desarrollo. Se capturó y revisó
el escritorio y se comprobó parcialmente el flujo de rescate, recarga y packs.
La captura local está en `.cache/8d/01-rescate-escritorio.png`. El intento dentro
del entorno restringido no pudo controlar el renderer; las primeras ejecuciones
fuera de ese entorno permitieron probar la página. La última ejecución externa
no fue autorizada: no se declara aprobado el recorrido completo del script ni
la revisión visual móvil tras los últimos cambios.

`scripts/ui-smoke-8d.mjs` deja una comprobación reproducible opcional, sin librerías
adicionales: arranca servicios locales de prueba en 3101/5183 y Edge instalado,
utiliza solo controles reales y guarda capturas bajo `.cache/8d`. Requiere esos
puertos libres y ejecutar primero la compilación. Puede configurarse otro
Chromium mediante `BROWSER_EXECUTABLE`. Su ejecución completa queda pendiente;
no forma parte del total de pruebas Vitest aprobadas. No añade controles de
depuración a la aplicación.

## Revisión manual con cuatro jugadores

1. Arrancar `npm run dev:server` y `npm run dev:web`. Abrir cuatro perfiles
   independientes en http://localhost:5173. Crear una sala, unir los demás y
   comenzar cuando haya cuatro conectados.
2. En cada navegador comprobar una cabecera, un personaje propio, una acción y
   cuatro tarjetas de equipo. La ficha privada y el historial deben empezar
   cerrados. Abrir una ficha y comprobar que solo contiene el propio rol.
3. Votar rescate con un jugador y recargarlo antes de la mayoría: conservar
   voto registrado y tiempo restante. Completar tres votos coincidentes. La
   acción pasa a avance de ronda y aparece un único resultado del recorrido.
4. Botones entrega un pack a un humano con energía menor que 100. Las cuatro
   pantallas deben actualizar las mismas tarjetas, con una reducción del stock.
   Solo Botones recibe la confirmación de su envío; el historial registra una
   entrega. Repetir F5 y verificar que no se entrega otro pack.
5. Avanzar a ronda 2, decidir sobre el segundo NPC y preparar ruta. Comprobar
   tarjetas de rutas, costes, disponibilidad y motivos. Solo Mantenimiento
   puede revelar ventilación; solo el anfitrión abre la votación. No deben
   seguir visibles los controles de rescate de ronda 1.
6. Completar pasillo y avanzar a ronda 3. Con el balance normal tras rescatar
   ambos NPC quedan 5 de energía si no se usaron packs. Durante preparación,
   Botones puede dar tres packs a cada uno de dos humanos (80 de energía),
   dejando a los otros dos a 5. Se utilizan seis packs de los ocho iniciales.
7. Aprobar galería (20): aparece únicamente la preparación de transporte como
   acción principal. Continuar y aprobar llevar a ambos con los dos porteadores.
   Pagan 50 cada uno y quedan con 30; los transportados conservan 5. Los
   agotados observan sin controles de voto. Comprobar el resultado y que las
   votaciones anteriores solo quedan en el historial.
8. El Médico selecciona un humano herido y administra tratamiento. Las tarjetas
   se actualizan en los cuatro navegadores, se descuenta una unidad y se registra
   una sola acción. El destinatario ya tratado queda bloqueado para esa ronda.
9. Abrir «Historial de la partida»: registros únicos y tablas claramente
   históricas, sin botones operativos. Cerrarlo y verificar que las tarjetas
   actuales siguen siendo las mismas. Ningún valor se recalcula al abrirlo.
10. Revisar escritorio y anchuras de 390 y 680 px: sin desplazamiento horizontal,
    botones accesibles, acción principal destacada y paneles de especialistas
    accesibles mediante desplazamiento vertical. Comprobar teclado/foco.

La validación de energía, planes de transporte, desacuerdos y rutas forzadas
sigue siendo la del servidor. No se avanza a otra fase de desarrollo.
