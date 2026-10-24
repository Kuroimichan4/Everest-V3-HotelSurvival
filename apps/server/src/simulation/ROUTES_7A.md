# Fase 7A: motor de rutas de ronda 3

Motor interno exclusivamente de backend. No se añaden eventos Socket.IO,
contratos compartidos, interfaz, votación o transición hacia ronda 3. Como la
primitiva de 5A, recibe el estado actual y no modifica `currentRound`: la futura
integración deberá autorizar la fase y conectar su ciclo de vida. No se modifica
el flujo jugable de rondas 1 y 2 ni las reglas de packs o tratamientos.

## Reutilización

`traverseRouteEffects` en routes.ts contiene el pago y accidente que ya usaba
`traverseRoute`: `spendEnergy`, una muestra uniforme para decidir accidente,
otras dos solo si ocurre para extraer vivos sin repetición y `applyDamage`.
La entrada de ronda 2 conserva su catálogo, requisitos, errores y resultados;
ahora delega en esa operación común. El catálogo nuevo de round-three-routes.ts
también la utiliza. No se duplica la selección de víctimas ni el motor de salud.

## Tres recorridos

- `fire-door`: coste 20 por vivo, accidente 20 % y daño 10 a dos vivos distintos.
  Requiere palanca disponible. Tras recorrerla, la palanca queda perdida y el
  regreso bloqueado por un nuevo temblor sin daño directo. Se descubre la sala de
  conferencias médicas y se suman dos unidades médicas garantizadas. El accidente
  es independiente de estos efectos y no se tira para decidir pérdida o premio.
- `pipe-gallery`: coste 10 por vivo, accidente 50 % y daño 30 a dos vivos distintos.
  Se aplica además daño ambiental 20 a todos los humanos que atraviesan, tanto
  con accidente como sin él. El resultado registra ambas causas por separado.
- `metal-debris`: coste 30 por vivo, accidente 20 % y daño 10 a dos vivos distintos.
  Al llegar al almacén se toma una muestra adicional independiente: `< 0.7` suma
  cuatro packs; desde `0.7` hasta menos de uno suma ocho. Se concede exactamente
  una de esas cantidades. No se altera el estado previo de la palanca ni las
  unidades médicas.

El orden interno es pago y accidente, daño ambiental si corresponde y efectos
de exploración. El orden excepcional que implique muertes no se resuelve aquí:
se bloquea antes de confirmar cambios. En un accidente no mortal de la galería,
las víctimas pierden 50 de salud total y el resto 20. Los fallecidos previos no
pagan, reciben daño, ni pueden ser elegidos como víctimas.

## Palanca, historial y transacción única

`SimulationState.tools.crowbar` vale `available` inicialmente y pasa a `lost`
al completar cortafuegos. Las operaciones anteriores conservan el objeto por
sus copias de estado habituales. No se asigna un nuevo propietario, recupera
automáticamente la herramienta ni se inventa qué hacer si falta.

`resolveRoundThreeRoute` recibe estado, requestId, identificador de ruta y una
fuente aleatoria inyectada. Devuelve un estado inmutable con `roundThreeRoute`:

- `completed`: resultado, costes, accidente, víctimas, daño ambiental, pérdida,
  regreso bloqueado, descubrimiento y cantidades realmente obtenidas.
- `blocked`: solicitud, ruta y motivo pendiente o de validación.

Repetir la misma solicitud y ruta devuelve la resolución guardada sin muestras,
pagos ni premios nuevos. Cambiar solicitud o ruta tras tener una resolución
devuelve `round-three-already-resolved`. El bloqueo también se guarda para evitar
que un fallo posterior a una tirada permita volver a tirar hasta obtener otro
resultado. No hay reintento automático ni recuperación de bloqueos en esta fase.

**El llamador debe conservar el estado devuelto también en caso de bloqueo.**
En un rechazo no se confirman consecuencias parciales: personajes, inventario,
herramientas y registros anteriores permanecen por referencia. Únicamente se
añade el registro de bloqueo; no se marca el recorrido como completado. Las
entradas inválidas o rutas desconocidas se rechazan sin registro y sin azar.
Todas las operaciones provisionales se descartan si falla un pago, una muestra
o una consecuencia acumulada. El RNG externo no se rebobina; el registro impide
repetirlo. La fuente y las muestras no se serializan.

## Visibilidad

Las tres opciones generales aparecen en `publicRoundThreeRouteViews` con solo
identificador, nombre y coste. «Escombros metálicos» no anuncia el almacén antes
de compartir el conocimiento. No se copian definiciones internas, probabilidades,
destinos especializados ni premios a esa vista.

`privateRoundThreeKnowledge` ofrece al Médico la sala tras cortafuegos y a Botones
el almacén tras los escombros, sin cantidades o garantías de recursos. Los demás
roles no reciben esos destinos. Las fichas existentes permanecen intactas.
Como en 5A, estas proyecciones no autentican: la futura integración debe obtener
el rol de la sesión y enviar cada vista a su destinatario autorizado. No se añade
una revelación automática ni multijugador en esta fase.

`roundThreeExplorationView` solo devuelve datos tras completar el recorrido:
efectos observados y recursos descubiertos, sin probabilidad, catálogo ni muestras.
Con bloqueo o antes de explorar devuelve null. Esta proyección sigue siendo
interna: sus identificadores de víctimas deberán traducirse a participantes
públicos al conectarla a las salas, igual que se hizo en ronda 2. No se envía
ninguna de estas vistas desde Socket.IO todavía.

## Pendientes y comportamientos seguros

- Un vivo: `single-survivor-pending`, antes de pagar o tirar, incluso si la
  muestra futura no produciría accidente. No se inventa una excepción.
- Ningún vivo: `no-living-characters`, sin declarar un desenlace final nuevo.
- Palanca perdida antes de cortafuegos: `crowbar-unavailable-pending`.
- Energía insuficiente: `insufficient-energy`, sin pagos parciales ni consumo de
  packs automático. Se permite terminar una acción pagando exactamente hasta cero.
- Accidente mortal: se conserva `fatal-accident-order-pending` del motor común.
- Humo mortal por sí mismo o acumulado al accidente:
  `fatal-environment-order-pending`, sin confirmar pagos o daños.
- Recuperación/reanudación tras bloqueos, transición a ronda 3 y controles de
  acceso del futuro flujo multijugador quedan para revisión posterior.

## Pruebas

round-three-routes.test.ts prueba umbrales de accidente, costes, daños,
víctimas distintas con dos, tres y cuatro vivos, humo acumulable, pérdida sin
daño, dos unidades médicas, extremos y umbral 70/30 del almacén, exclusión de
premios, independencia de muestras, conservación de palanca, privacidad antes y
después de explorar, recursos e historial de rondas anteriores, idempotencia y
bloqueos sin efectos parciales, incluso ante una muestra de premio inválida.

Dos fixtures existentes de packs y tratamientos usan ahora un reloj fijo para
evitar comparaciones inestables del `serverNow` real por un milisegundo. Sus
reglas y expectativas jugables se mantienen.

Ejecutar `npm.cmd test`, `npm.cmd run typecheck` y `npm.cmd run build` con Node 24
en PATH. Para ejecutar solo el motor nuevo:
`npm.cmd test -- apps/server/src/simulation/round-three-routes.test.ts`.
No hay recorrido manual de ronda 3 en el navegador en esta fase.
