# Fase 8B: transporte y abandono

## Inserción y autoridad

Tras conservar la elección de ruta, `RoomManager.moveOrPrepare` compara la
energía de cada humano activo con el coste normal. Sin agotados llama al
motor habitual inmediatamente. Con agotados crea una preparación de transporte,
conserva la ruta y no aplica pagos de movimiento, accidentes ni recompensas.

La ronda 1 tiene un paso obligatorio cuyo coste vigente define `energy-costs.ts`. `prepareRoundOne` conserva
por separado las consecuencias del rescate de NPC ya decidido; no se vuelven
a cobrar ni a dañar personajes al continuar. Las rondas 2 y 3 conservan sus
votaciones de ruta y sus resoluciones de NPC anteriores.

En preparación Botones puede repartir packs con las mismas validaciones y
recibos existentes. Cualquier participante autenticado y vivo puede pulsar
«Comprobar energía y continuar» cuando termine la preparación: es una política
de inicio provisional, sin temporizador. No es un voto del agotado sobre sí
mismo. Al continuar se reclasifica al equipo. Si todos pueden caminar,
se ejecuta normalmente sin votación adicional. Al votar se fijan opciones y
electorado y se cierra el reparto hasta terminar el movimiento.

La elegibilidad vigente se deriva de los planes viables y se comprueba por
alternativa, conforme a la corrección 8C documentada en
`../simulation/ENERGY_8C.md`. Los agotados, muertos y eliminados quedan excluidos.
Un caminante que no puede portear paga solo su desplazamiento y no vota transporte.
La identidad se obtiene del socket autenticado; no se acepta identidad de actor
en la solicitud. Los identificadores de decisión, intento y preparación aíslan
etapas, rondas y salas. Las peticiones no llevan planes arbitrarios del cliente.

## Políticas técnicas provisionales

- Tiempos: `TRANSPORT_POLICY`, 60 segundos y segundo intento de 30, revisables.
  Se inyecta en `RoomVoting`; mayoría estricta solo del electorado autorizado.
- Formación del plan: para cada opción participan **todos** los compañeros que
  puedan pagar su coste completo. No se ha fijado un mínimo de dos porteadores.
  Para transportar dos, alguien capaz de portear uno pero no dos sigue caminando
  normalmente y no recibe un cobro adicional. La interfaz muestra los porteadores
  y el coste de cada opción antes de votar. Esta selección técnica es revisable.
- Inicio: cualquier humano activo puede continuar la preparación. No abre de
  nuevo la votación de ruta ni modifica la ruta seleccionada.

Un agotado: transportar o abandonar. Dos: ambos, solo uno o ninguno. Si gana
solo uno se abre otra decisión independiente con el mismo electorado; hasta
resolverla no se elimina a ninguno. Cada porteador del plan elegido paga
coste normal + 15 por transportado; los transportados pagan cero y conservan
su energía. Se valida todo el plan antes de confirmar abandonos y movimiento.
Las opciones impagables se muestran deshabilitadas y el servidor las rechaza.

Dos intentos sin mayoría dejan `transport-no-agreement`, sin consecuencias
añadidas. Más de dos agotados o ausencia de porteadores elegibles dejan,
respectivamente, `more-than-two-exhausted` o `no-eligible-carriers`. Estos
estados pendientes conservan el estado y no ofrecen reintentos ilimitados.
Para cambiar su política futura basta ajustar el controlador y su política;
el motor de votos y las consecuencias de rutas permanecen independientes.

## Abandono, objetos y movimiento

`abandonCharacters` marca `eliminated: true` sin reducir salud. Los eliminados
no votan, caminan, reciben packs/tratamientos ni recuperan ficha privada con
F5. Se revoca la ficha del socket afectado. No se sustituye a Botones o Médico.

La estructura opcional mínima `personalItems` y `sharedItems` conserva objetos
por identidad. Inicialmente no contiene posesiones inventadas. Al abandonar,
se vacían los objetos personales y se transfieren una sola vez al inventario
común, con registro por personaje. No se suman de nuevo packs o unidades médicas,
que ya eran compartidos, ni se modifica la palanca global. Su pérdida solo puede
ocurrir por la consecuencia ya existente de puerta cortafuegos.

La ejecución síncrona valida todos los costes y entrega el plan a los motores
existentes. Estos usan `payMovement` y `traverseRouteEffects`, incluyendo a los
transportados entre los humanos activos que reciben ambiente y accidentes.
No se invoca `resolveTransportMovement` además del motor de ronda: el auxiliar
interno de 8A no debe provocar un segundo desplazamiento ni una segunda tirada.
No cambian probabilidades, daños, costes normales ni recompensas.

Cada caso conserva decisiones e intentos, destinatario, transportados,
abandonados, gastos normales/adicionales y objetos transferidos. La ruta conserva
su propia decisión independiente. El resultado terminado es una instantánea que
no cambia con rondas o consumos posteriores. El historial y los recibos permanecen
en la partida en memoria y se recuperan con la credencial existente tras F5.

Un error posterior de movimiento deja un bloqueo explícito sin pagos parciales
ni nuevas tiradas. Un abandono válido ya confirmado continúa siendo definitivo.
Si se abandona a un especialista necesario para apuntalamiento, el requisito de
ruta existente bloquea su resolución: no se inventa disponibilidad. Si deja de
estar activo el creador, no se inventa una transferencia de anfitrión.

## Archivos

- `rooms/transport.ts`: controlador, decisiones, planes y vistas públicas.
- `simulation/abandonment.ts`: eliminación y transferencia idempotente.
- `rooms/manager.ts`, `socket.ts`, `voting.ts`: integración, eventos y política.
- `simulation/state.ts`, `round-one.ts`, `round-two-movement.ts`,
  `round-three.ts`, `round-three-routes.ts`: estado y plan opcional de movimiento.
- `packages/shared/src/index.ts`: contratos públicos sin secretos de accidentes.
- `apps/web/src/Transport.tsx`, `Lobby.tsx`: pantalla, votos y reconexión.
- Pruebas nuevas de transporte del gestor y React, abandono del dominio y pruebas
  Socket.IO añadidas en `voting.test.ts`. Se adaptan dos expectativas provisionales
  antiguas de bloqueo por agotamiento a la preparación de 8B.

## Verificación manual

Los ejemplos de costes de la primera versión de 8B han sido sustituidos por
el balance 8C. La secuencia manual vigente y las cantidades esperadas se
encuentran en `../simulation/ENERGY_8C.md`.

Siguen pendientes tres o más agotados, ausencia de votantes, resolución futura
del desacuerdo, relevo de roles/anfitrión y ronda 4. El servidor sigue sin
persistencia externa: reiniciarlo pierde las salas.
