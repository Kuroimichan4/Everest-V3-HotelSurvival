# Fase 8C.1: disponibilidad energética y recuperación de rutas

## Diagnóstico y cálculo

La selección de ronda 2 solo comprobaba requisitos de especialistas; la de
ronda 3 ofrecía las tres rutas sin comprobar energía. Después, la elección se
conservaba aunque no hubiera transporte viable. Los estados de transporte o
movimiento bloqueados no tenían una transición de vuelta a selección.

`simulation/transport.ts` añade dos funciones puras compartidas:

- `assessTransportAlternative`: construye y valida el mismo plan hipotético que
  utiliza el controlador de transporte. Reutiliza `carrierEnergyCost` y
  `assessTransportPlan`. Nunca confirma abandonos ni pagos.
- `routeEnergyAvailability`: disponible si todos los humanos activos pueden
  caminar; disponible con ayuda si una alternativa de transporte de uno/dos
  agotados es viable; no disponible si no existe esa alternativa o el número
  de agotados sigue pendiente de definición.

Una alternativa parcial puede requerir dejar a otro compañero atrás. Calcular
su viabilidad no lo autoriza: siguen siendo obligatorias las votaciones de
transporte y destinatario antes de cualquier abandono. No se considera disponible
una ruta únicamente porque hipotéticamente se pudiera abandonar a todos sin
porteadores autorizados. Los casos de tres agotados siguen sin votación definida.

Los requisitos existentes de especialistas y palanca también se muestran como
restricciones. Los costes siguen procediendo de `energy-costs.ts`; no cambian
probabilidades, daños ni premios. Ventilación permanece oculta al equipo hasta
que Mantenimiento la revele; las vistas de disponibilidad no publican secretos.

## Preparación, packs y votos

Las opciones se recalculan en preparación y se transmiten junto con los eventos
existentes de ronda cuando Botones entrega un pack. No cambian sus permisos,
recibos o límite de energía. Las rutas no disponibles permanecen visibles con
un motivo, y no se puede abrir una votación sin ninguna ruta disponible.

Al abrir se conserva una instantánea de las opciones. El servidor comprueba
los votos contra ella. Las rutas bloqueadas se rechazan aunque el cliente
manipule Socket.IO. Los packs siguen cerrados durante una votación abierta.

Si solo una ruta está habilitada se conserva una decisión colectiva: el motor
recibe la lista de rutas visibles y el gestor impide votar las deshabilitadas.
No se elige automáticamente la única opción. La mayoría general, los intentos
de 60/30 segundos y las consecuencias de desacuerdo permanecen iguales.

El transporte mantiene los planes y la autorización por alternativa aprobados
en 8C, con mayoría estricta del conjunto de porteadores posibles. La disponibilidad
«con ayuda» no ejecuta el transporte automáticamente ni garantiza consenso.

## Recuperación

Antes de ejecutar una selección se vuelve a comprobar su energía. Una selección
normal imposible presenta `recovery`: motivo e identificador de decisión. No
se llama al motor de ruta ni se consume azar. También se reconocen bloqueos
energéticos guardados de los motores anteriores al recuperar una sesión.

Un humano autenticado y activo puede solicitar `route:retry` con esa decisión.
La solicitud vuelve a preparación, no selecciona otra ruta. Se conserva el
estado actual de personajes, inventario, herramientas, NPC y revelaciones.
Se registra la decisión fallida en `failedSelections`, con resultado y motivo;
se cancelan temporizadores del intento anterior y se conserva cualquier caso
de transporte anterior como `superseded` en el historial del servidor.

La siguiente votación requiere al anfitrión para abrirse y una nueva mayoría
colectiva, con identificadores nuevos. Los votos anteriores no sirven para ella.
Repetir una recuperación ya confirmada no añade historial ni reinicia otra
votación. No se restauran recursos ni se vuelven a aplicar consecuencias de NPC.

Esta transición solo cubre fallos energéticos previos a ejecutar la ruta. No
permite repetir una tirada tras `invalid-random` ni evita un desacuerdo de
transporte: este último mantiene su estado pendiente aprobado en 8B.

La ronda 1 sigue teniendo su único paso obligatorio, con sus comprobaciones
seguras y transporte existentes; no recibe una ruta alternativa.

## Rutas forzadas

Ronda 2 conserva pasillo obligatorio y su consecuencia ya aprobada. Ronda 3
conserva el terremoto, el bloqueo de las dos alternativas y galería obligatoria.
Si no hay energía, `recovery.forced` conserva esa obligación y el motivo. No
se permite volver a otra selección. Se reutiliza una ventana de preparación
para packs y una acción de comprobación de la misma ruta. Si recupera viabilidad,
se continúa por el flujo normal o la votación de transporte; si no, permanece
pendiente de diseño. No se añaden muertes, daños o penalizaciones.

## Archivos de esta corrección

- `simulation/transport.ts`: disponibilidad y evaluación común de alternativas.
- `rooms/transport.ts`: reutiliza esa evaluación y archiva casos sustituidos.
- `rooms/manager.ts`: instantáneas, validación, historial y recuperación segura.
- `rooms/socket.ts`: acción de recuperación y actualización pública tras packs.
- `packages/shared/src/index.ts`: disponibilidad, recuperación e historial público.
- `apps/web/src/RouteAvailability.tsx`, `RoundTwo.tsx`, `RoundThree.tsx` y
  `Lobby.tsx`: motivos, botones deshabilitados y recuperación.
- Pruebas nuevas en `simulation/route-availability.test.ts`,
  `rooms/route-availability.test.ts` y `apps/web/src/RouteAvailability.test.ts`;
  ampliación de `rooms/voting.test.ts`. Las pruebas anteriores de bloqueos
  provisionales se adaptan a la prevención antes de votar.

## Prueba manual reproducible

No se ha realizado verificación visual en navegador desde el agente. Las pruebas
React renderizan el HTML; las pruebas Socket.IO utilizan cuatro conexiones reales.

1. Arrancar `npm run dev:server` y `npm run dev:web`. Abrir
   http://localhost:5173 en cuatro perfiles independientes, crear una sala,
   unir cuatro jugadores e iniciar. Identificar a Botones y Mantenimiento.
2. Aprobar RESCATAR en ronda 1: todos quedan con 50 de energía. Avanzar a ronda
   2 y aprobar RESCATAR: quedan con 25.
3. En preparación, pasillo (20) aparece disponible y apuntalamiento (40) no
   disponible. Revelar ventilación: aparece visible con coste 30 y no disponible.
   Ninguna vista debe mostrar su probabilidad real ni clasificación de riesgo.
4. Abrir votación: las rutas bloqueadas siguen visibles con botones deshabilitados.
   Aprobar pasillo con tres votos: quedan 5 por humano. Avanzar a ronda 3.
5. Las tres rutas de ronda 3 están inicialmente no disponibles. El botón de abrir
   votación está deshabilitado y se explica que pueden repartirse packs. Dar un
   pack a cada humano: quedan con 30. Las cuatro pantallas deben actualizarse:
   galería (20) y puerta (30) disponibles, escombros (40) no disponible.
6. Dar otro pack a dos humanos: tendrán 55, los otros dos 30. Escombros pasa a
   «Disponible con ayuda» porque se puede transportar a uno, aunque no a ambos.
   Hacer F5 y comprobar que conserva estado y existencias (quedan dos packs).
7. Abrir votación y aprobar escombros con tres votos. Debe aparecer preparación
   de transporte, sin haber cobrado el movimiento. Continuar: solo los dos con
   55 votan. Llevar ambos (70) es inviable; llevar uno (55) es viable. Elegir uno
   y después el destinatario. Los porteadores quedan con 0 y el transportado
   conserva 30; el otro solo queda eliminado tras completar la decisión válida.
   Accidentes y recompensa del almacén se aplican según sus reglas habituales.
8. Durante una votación de ruta, comprobar que Botones no puede entregar packs
   y que la disponibilidad permanece fijada. Mantener otra sala abierta para
   confirmar que sus estados no reciben cambios ajenos.
9. Si una sesión ya muestra una selección fallida por energía, pulsar «Volver
   a elegir ruta»: no deben cambiar salud, energía, recursos ni revelaciones.
   El anfitrión abre la nueva votación y hace falta otra mayoría. Hacer F5 antes
   y después del retorno; el historial conserva el intento fallido.
10. Si el aviso corresponde a una ruta forzada, solo aparece «Volver a comprobar
    ruta obligatoria», con opción de repartir packs antes. No debe ofrecer una
    elección alternativa ni aplicar efectos hasta que pueda continuar.

Los pasos 9 y 10 cubren estados heredados o inesperados. En una partida normal
la validación nueva y el bloqueo de packs durante votación previenen que se
elija una ruta imposible. Las regresiones automatizadas construyen esos estados
directamente, sin añadir controles de depuración a los jugadores.

Siguen pendientes el transporte de tres o más agotados, la ausencia de porteadores
o consenso sin recuperación, los relevos de roles/anfitrión y la disponibilidad
de especialistas tras abandonos. Un estado sin packs suficientes puede seguir
pendiente; no se inventan recursos. No se implementa ronda 4 ni persistencia externa.
