# Ronda 4 — motor interno, fase 9A

Fuente: petición aprobada de fase 9A, contrastada con la guía y el enunciado
original en `docs/`. Los costes actuales de 8C y las decisiones de esta petición
prevalecen sobre valores antiguos de la guía. No se han modificado esos originales.

## Archivos y alcance

- `round-four.ts`: estado, encuentro, decisiones de NPC, fallos de votación,
  catálogo, disponibilidad y transacción de salida.
- `round-four.test.ts`: pruebas puras, sin salas ni conexiones.
- `energy-costs.ts`: añade únicamente las nuevas salidas (20/10) y rescate de NPC
  inmóvil (40); conserva costes anteriores, rescate asistido (25) y transporte humano (15).
- `state.ts`: parámetro de ronda; por defecto sigue limitado a 1/2/3 para las
  salas existentes. `RoundFourState` admite ronda 4 e historial médico anterior.
- `operations.ts`, `transport.ts`, `routes.ts`, `abandonment.ts`: generalizan
  tipos para conservar el estado de ronda 4 al reutilizar las mismas operaciones.
  Sin cambios en sus cálculos, autorizaciones, daños o selección de víctimas.

No se han añadido contratos compartidos, eventos Socket.IO ni componentes React.
No hay temporizadores, puntuaciones, pantalla final, base de datos ni premios nuevos.

## Flujo del motor

1. `beginRoundFour` exige desplazamiento de ronda 3 completado y algún humano
   activo. Conserva personajes, objetos, inventario, herramientas y registros.
   Una muestra en `[0,1)` genera `none` si es menor de 0,5, `walking-assisted`
   entre 0,5 y 0,75, o `immobile` desde 0,75. Al recibir un estado ya iniciado,
   devuelve el mismo sin consultar el azar. El llamador debe conservar el estado
   devuelto; no hay persistencia global ni PostgreSQL. Un estado serializado conserva
   el encuentro y todos los identificadores y resultados.
2. NPC ausente: no hace falta decidir rescate. Si existe, `decideRoundFourNpc`
   recibe una decisión colectiva validada externamente. Puede abandonarse, asistir
   al caminante (25), cargar al inmóvil (40), o usar una unidad médica y asistirlo
   (25). No permite combinar métodos ni aplicar medicina al caminante.
3. La decisión de rescate se conserva como `awaiting-effort`: todavía no consume
   energía ni medicina y todavía no cuenta como NPC rescatado. `resolveRoundFourExit`
   confirma el esfuerzo junto con el desplazamiento. Es una agrupación técnica
   provisional para garantizar atomicidad, no una nueva prioridad de juego.
   Si la futura integración necesita completar el rescate antes de elegir salida,
   deberá revisarse esa secuencia expresamente.
4. Todos los humanos activos participan en el esfuerzo NPC, siguiendo el rescate
   existente. Si alguno no puede pagarlo, se bloquea. No se inventa una selección
   de porteadores NPC ni una exención para humanos transportados. La medicina NPC
   no toca `medicalTreatments` ni consume la curación humana de esa ronda.
5. `roundFourRouteAvailability` calcula requisitos y energía después del esfuerzo
   NPC hipotético, sin consumir recursos. Proyecta nombre, coste y disponibilidad,
   sin clasificación ni probabilidad reales. Los planes de transporte humano se
   validan con el motor existente; la ejecución nunca elige ni abandona humanos
   automáticamente. Una disponibilidad `with-help` requiere después un plan válido.
6. `resolveRoundFourExit` valida todo, paga y aplica el accidente reutilizando
   `traverseRouteEffects`. La puerta cuesta 20, requiere la palanca existente,
   tiene probabilidad 0,1 y daño 5. La grieta cuesta 10, no requiere herramientas,
   tiene probabilidad 0,5 y daño 30. Hasta dos humanos activos distintos al comienzo
   reciben el daño; con uno solo se aplica una vez. Se excluyen muertos y eliminados.
   Se conserva el plan explícito, los cargos, daños, fallecimientos, humanos que
   sobrevivieron a la salida y el rescate NPC confirmado, sin evaluación final.

La puerta nunca regenera ni consume una palanca nueva: solo consulta `tools.crowbar`.
El estado `lost` heredado de ronda 3 se mantiene también al salir por la grieta.

## Intentos fallidos independientes

`ROUND_FOUR_VOTE_SECONDS` prepara 60 y 30 segundos para 9B; este módulo no abre
votaciones ni implementa electorado, mayorías o autorizaciones nuevas.

- `failRoundFourNpcVote`, intento 1: conserva exactamente
  **El superviviente parece debilitarse a cada segundo que pasa**.
  Intento 2: NPC definitivamente muerto. No hay tercer intento ni derrumbe.
- `failRoundFourExitVote`, intento 1: aplica 5 de daño a cada humano activo,
  registra también los fallecimientos y establece un recargo único de 5.
  Puerta y grieta pasan a costar 25 y 15. Intento 2: bloquea la puerta y fija
  obligatoriamente la grieta; conserva recargo y daño ya aplicado, sin repetirlo.
  La grieta forzada mantiene su accidente normal. No hay derrota automática.

Cada decisión tiene su propio identificador y secuencia de intentos. Repetir un
intento ya aplicado con el mismo identificador devuelve el mismo estado; cambiar
el identificador o saltarse el primer intento se rechaza. El rescate se decide
antes de ejecutar salida; los estados de ambos tipos de votación son independientes.

## Atomicidad e idempotencia

Un rechazo de recursos, esfuerzo o plan devuelve el estado original, sin pagos,
consumo médico, daños, abandonos o premios parciales. El azar del accidente solo
se consulta después de validar el pago conjunto. Los costes NPC y transporte humano
se registran por separado. No se cobra 40 y 25 por el mismo NPC.

Una salida confirmada conserva `requestId`, ruta, plan y resultado. Repetirlos
devuelve el estado guardado, sin volver a tirar; otro identificador, ruta o plan
se rechaza. Si una fuente aleatoria inválida falla después de iniciar las tiradas,
se conserva únicamente `blockedMovement`, sin gastos, para impedir repetir el sorteo.
No hay recuperación automática de ese error de infraestructura.

El consumidor debe confirmar siempre el `state` devuelto, incluido ese bloqueo.
Como en los demás módulos puros, estas operaciones no validan sesiones ni JSON
externo y no sustituyen la serialización de acciones del gestor de sala.

## Pendientes conservados

- Todos fallecidos antes de iniciar ronda o salir: bloqueo `no-living-characters`;
  sin inventar derrota, victoria, transición o puntuación. Una muerte total en
  el accidente queda registrada, sin resolver su evaluación final.
- Si rescate más transporte humano no cabe en el presupuesto: bloqueo seguro
  `insufficient-energy` o `combined-effort-pending`, sin prioridad o reparto.
  Falta concretar cualquier exención o reparto distinto del rescate entre humanos.
- Salida forzada inviable: se conserva la grieta obligatoria y se rechaza el
  desplazamiento. No se abandona a nadie ni se inventa una vía alternativa.
  Las primitivas de packs y tratamientos siguen disponibles para la integración.
- Relevo de Médico/Botones fallecidos o eliminados y falta de votantes autorizados:
  no hay nuevas autorizaciones; deberán bloquearse en la futura capa de sala.
- Puntuación, objetivos individuales, balance final y recompensas adicionales:
  pendientes. Aquí solo se guardan consecuencias objetivas y recursos consumidos.

## Verificación y futura fase 9B

Las pruebas cubren costes, límites probabilísticos y reparto 50/25/25, continuidad
desde ronda 3, palanca, rescates y medicina, intentos independientes, derrumbe,
grieta forzada, víctimas únicas, muerte acumulada, planes de transporte, energía
cero, bloqueos atómicos, recuperación con packs y reproducción del estado serializado.

Ejecutar desde la raíz: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`
y `git -c core.safecrlf=false diff --check`. Usar el Node local de `.tools` si no
está en PATH. El informe de la sesión indica los resultados realmente observados.

9B deberá conectar este estado a la partida autoritativa, conservar cada resultado,
validar sesión/rol y decisiones colectivas, reutilizar el motor de voto 60/30 con
mayoría de vivos y cierre inmediato, resolver ventanas de recursos y transporte,
proyectar DTO seguros y añadir reconexión e interfaz. Esa integración requiere
revisión previa de los pendientes y de la agrupación atómica de esfuerzos descrita.
No se ha iniciado automáticamente.
