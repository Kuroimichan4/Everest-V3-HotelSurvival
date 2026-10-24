# Fase 8A: agotamiento, transporte y correcciones de accidentes

Esta fase sustituye expresamente los bloqueos históricos por un único superviviente
y por daños mortales acumulados descritos en fases anteriores. Conserva costes,
probabilidades, recompensas, rescates de NPC y votaciones generales. No implementa
las votaciones, abandonos ni transferencias de inventario personal de 8B.

## Accidentes y daños acumulados

El motor común de routes.ts toma una copia de los humanos activos al inicio del
recorrido. Activo significa salud positiva y ausencia de eliminación definitiva.
Con cuatro o tres elige dos víctimas sin reemplazo; con dos elige ambos; con uno
elige solamente ese humano y aplica su daño una vez. Los fallecidos o eliminados
anteriores nunca participan. Se mantienen los umbrales de los catálogos de rutas.

Se consume una muestra para decidir accidente y, si ocurre, una por víctima
seleccionada, hasta min(2, activos). Se conserva por tanto el número anterior de
muestras con dos, tres y cuatro vivos; con uno, son dos muestras en total si ocurre.
La fuente sigue siendo inyectable y no procede del cliente.

Antes de modificar salud se calcula por personaje el daño de accidente y el daño
garantizado de ese recorrido. El total se aplica una vez con applyDamage, que
satura en cero. Un humano que muera por el humo no desaparece retroactivamente
de las víctimas del accidente. Se registran causas, total, pérdida efectiva de
salud e identificadores de fallecidos en el resultado común. La muerte sigue
derivándose de salud cero; no se añade un segundo indicador contradictorio.

La galería utiliza daño garantizado 20 y accidente 30. Con salud 35 y ambos
efectos termina en cero. La consecuencia de desacuerdo de ruta de ronda 2 se
compone también atómicamente con su accidente mediante daño garantizado 10;
la ronda 3 mantiene exclusivamente su humo y accidente, sin añadir ese daño.
El pago y los daños son provisionales hasta completar la operación, incluidos
los premios y la herramienta de ronda 3. Los registros de ronda 2 y 3 mantienen
su idempotencia y los bloqueos posteriores a muestras inválidas no vuelven a tirar.

Tras un fallecimiento real el servidor deja de ofrecer la ficha privada y emite
`game:role-unavailable` solo al socket afectado. React retira su ficha y controles
de rol. Los demás reciben únicamente el estado común autorizado. Médico y Botones
no obtienen sustitutos automáticos.

## Agotamiento y evaluación de planes

transport.ts ofrece funciones puras:

- classifyMovement distingue caminantes (energía >= coste normal), necesitados de
  transporte (activos con energía < coste normal) y excluidos (muertos/eliminados).
- carrierEnergyCost calcula coste normal + 15 × número de transportados. Por
  ejemplo, para ruta 20: 20 sin transporte, 35 para uno, 50 para dos y 65 para tres.
  No se impone un límite de dos agotados.
- assessTransportPlan valida un plan explícito y calcula cargos sin alterar estado.
  Si falla la capacidad energética, conserva también el presupuesto para inspección.
- payMovement paga esos cargos con spendEnergy sobre un estado provisional y
  devuelve el estado original ante cualquier rechazo.

TransportPlan contiene carrierIds y transportedIds. Los porteadores deben ser
activos y capaces de caminar; cada uno debe poder pagar TODO el coste incrementado.
Los demás caminantes pagan solamente la ruta. Los transportados no pagan energía
ni la recuperan automáticamente. No se presupone un número mínimo de porteadores
mayor que uno ni se eligen porteadores automáticamente.

No se admiten duplicados, solapamientos, identidades ajenas o excluidas, ni transportar
a quien ya puede caminar. Deben quedar incluidos todos los agotados activos del
estado: omitir a alguien no equivale a abandonarlo. En 8B, si se aprueba un abandono,
su eliminación deberá confirmarse expresamente antes de evaluar el plan restante.
Un plan sin porteadores cuando hay transportados, o sin capacidad energética, es
inviable. Si todos están agotados, se detectan todos y no se inventa una salida.

La capacidad para caminar no implica necesariamente poder ser porteador: 25 de
energía bastan para caminar una ruta de coste 20, pero no para transportar a uno,
que exige 35. La futura selección de votantes deberá usar ese presupuesto completo.

## Movimiento con transporte preparado para 8B

transport-movement.ts ofrece resolveTransportMovement, exclusivamente interno,
sin eventos Socket.IO ni llamada desde las votaciones existentes. Reutiliza
traverseRouteEffects con el plan explícito, por lo que los transportados reciben
los mismos daños ambientales y pueden ser víctimas del accidente.

El resultado confirmado registra requestId, ronda, firma de reglas y plan,
cargos, daños, víctimas y fallecidos en transportMovements. Repetir el mismo
identificador conserva el estado actual sin volver a pagar ni tirar, incluso
después de consumir un pack o reconstruir el estado serializado. Alterar sus
parámetros con el mismo identificador produce conflicto.

Un rechazo no confirma pagos o daños ni elimina personajes. Los errores previos
a la tirada no consumen azar. Como las demás primitivas puras, un rechazo por
muestra inválida puede haber consumido la fuente externa: 8B deberá conservar
su resolución fallida si quiere reanudarla, nunca volver a tirar automáticamente.
Esta fase no instala ningún mecanismo de reintento para ese caso.

Las rutas conectadas siguen ejecutándose SIN plan de transporte. Si aparece un
agotado se devuelve `transport-vote-pending`, sin coste parcial ni muerte por
agotamiento. Se conserva el bloqueo explícito de la ronda y la interfaz indica
que espera la votación futura de 8B. No se utiliza un plan calculado como autorización
del equipo, ni se activa un abandono. El coste del rescate del NPC permanece separado
del coste de desplazamiento: esta fase no inventa cómo sustituir ese esfuerzo.

## Packs en preparación

Además de las ventanas posteriores al recorrido, se añaden ventanas con UUID propio
a las preparaciones existentes de rutas 2 y 3. Se crean una vez, no al recuperar
sesión. Los recibos de consumo anteriores siguen vigentes; otra petición con la
ventana de una fase ya cerrada se rechaza.

La ventana de preparación se cierra al abrir la votación. No se amplía a la votación
abierta ni a una resolución bloqueada: son fases distintas de la preparación.
La ronda 1 no tiene una preparación separada de ruta antes de su resolución
conjunta actual; no se introduce una nueva fase o un nuevo momento de consumo allí.
Su ventana posterior permanece igual.

El gestor marca explícitamente la resolución de movimiento y cierra cualquier
ventana mientras se ejecuta, con try/finally. No hay await dentro del movimiento.
Las pruebas usan además una fuente aleatoria reentrante para comprobar que un
intento de pack durante la ejecución se rechaza. Un recibo repetido aceptado antes
puede confirmarse, pero eso no aplica un consumo nuevo.

Se reutilizan consumePack, permisos de Botones, inventario común, límites de energía,
recibos por partida y sincronización de 6A. La sección existente de suministros ya
aparece en las pantallas de preparación gracias a la nueva ventana, sin rediseño.
Los muertos y eliminados no aparecen como destinatarios. El histórico permanece
congelado; la preparación y el estado actual sí reflejan el pack.

## Inventario e integración necesaria en 8B

El modelo actual tiene cantidades compartidas de packs y unidades médicas, y
tools.crowbar como disponibilidad persistente de una herramienta compartida en
el estado. La ficha de Mantenimiento menciona su posesión inicial, pero no existe
una tabla de propietarios o inventario personal por humano. No se crean otras
posesiones, botiquines personales ni herramientas en esta fase.

HumanCharacter admite ahora eliminated opcional para representar la eliminación
definitiva en 8B, sin ejecutarla aquí. Los estados existentes sin ese campo siguen
activos según salud. La marca se excluye de accidentes, movimiento, recursos,
tratamientos, permisos y votos, y puede mostrarse públicamente sin revelar rol.

8B deberá conectar una decisión autorizada al plan y su requestId estable, definir
el electorado de porteadores con el coste completo, resolver las opciones de
transportar y la elección de identidad cuando proceda, y registrar un abandono
antes de eliminar. También necesitará representar propietarios de los objetos
individuales realmente aprobados y transferirlos exactamente una vez al inventario
compartido. Los packs y unidades médicas ya comunes no deben volver a sumarse.
Este documento identifica la adaptación; no introduce transferencias ejecutables.

## Pendientes

- Votaciones de transporte y abandono, incluidos los detalles para más de dos
  agotados; el motor de cálculo sí admite todos sin inventar otra fórmula.
- Eliminación efectiva y transferencia de objetos personales tras votación.
- Reanudación explícita de una ronda ya bloqueada, sin repetir tiradas o premios.
- Falta de palanca y disponibilidad de especialistas que hayan fallecido.
- Sustitución de Médico/Botones y autoridad del anfitrión fallecido.
- Desenlace sin humanos activos y decisión definitiva sobre tratar salud completa.

Accidentes con uno y fallecimientos por daños acumulados ya NO son casos pendientes.
No se implementa ronda 4, PostgreSQL, IA o dependencias nuevas.

## Verificación

Los casos de pruebas anteriores que esperaban bloqueos por las reglas ahora
sustituidas se adaptan para comprobar sus resultados nuevos, manteniendo el resto.
Se añaden transport.test.ts y accumulated-damage.test.ts con presupuestos para
cero a cuatro transportados, uno/dos/tres agotados, capacidad de cada porteador,
coste cero para el transportado, muertes y daño acumulado, excluidos, idempotencia,
planes inválidos y ausencia de gasto parcial o selección automática.

Socket.IO comprueba packs en ambas preparaciones, cuatro estados idénticos,
F5, ventana obsoleta, aislamiento, rechazo durante resolución, fallecimientos
sincronizados y retirada privada de fichas sin nuevas tiradas. Los cálculos de
transporte no se llaman desde ningún evento de juego.

Ejecutar npm.cmd test, npm.cmd run typecheck, npm.cmd run build y git diff --check
con Node 24 en PATH. Para la prueba manual, completar el rescate de ronda 2 o
avanzar a ronda 3 y, antes de abrir el voto, repartir un pack desde Botones;
recargar y comprobar inventario y energía. Tras abrir el voto el control se cierra.
Si no se repartió energía suficiente, la ruta debe quedar pendiente de transporte,
sin eliminar a nadie ni abrir todavía nuevas votaciones.
