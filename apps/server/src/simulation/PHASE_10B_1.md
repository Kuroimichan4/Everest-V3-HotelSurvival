# Fase 10B.1 — motor aislado de las rondas intermedias

## Alcance y revisión

Se revisaron `state.ts`, `routes.ts`, `round-one.ts`, `round-two.ts`, `round-two-movement.ts`, `round-three.ts`, `round-three-routes.ts`, `round-four.ts`, `operations.ts`, `transport.ts`, `transport-movement.ts`, `energy-costs.ts`, `objective-evidence.ts`, `final-result.ts`, `rooms/manager.ts`, `rooms/identity.ts`, `rooms/privacy.ts`, `voting/engine.ts`, los contratos compartidos y las pantallas e historial de la web. Se contrastó su comportamiento con la suite completa.

No se modificaron `docs/`, React, Socket.IO, contratos públicos, los costes anteriores ni el motor de la evacuación actual. Esta sigue siendo la ronda 4 en la partida real. No hay una segunda evacuación ni un segundo resultado final. El tipo por defecto de `SimulationState` sigue limitado a las cuatro rondas jugables; el tipo interno genérico admite hasta seis.

## Archivos

Nuevos, dentro de `apps/server/src/simulation/`:

- `intermediate-rounds.ts`: catálogo, narrativa, proyecciones autorizadas, revelación, preparación de votación, resolución de desplazamiento y adaptadores internos de recursos y sesión.
- `six-round-energy.ts`: evaluación energética determinista y once escenarios reproducibles.
- `intermediate-rounds.test.ts`: pruebas de catálogo, permisos, accidentes, transporte, recursos, votos, evidencias y viabilidad.
- `PHASE_10B_1.md`: este informe y estrategia de integración.

Modificados en el mismo directorio:

- `energy-costs.ts`: seis costes nuevos centralizados en `INTERMEDIATE_ENERGY`.
- `state.ts`: registros opcionales de las rondas internas y ampliación del núcleo reutilizable.
- `objective-evidence.ts`: admite ese núcleo e incorpora exclusivamente los recorridos intermedios completados.

## Diseño

`IntermediateState` contiene una etapa explícita: preparación, votación, movimiento, completada o falta de consenso pendiente. `prepareIntermediateRound` es una entrada de laboratorio, no un avance de la partida. No concede energía ni recursos. La integración deberá validar el avance desde la ronda anterior.

| Ronda | Ruta | Energía al caminar | Riesgo interno | Accidente | Daño por víctima |
|---|---|---:|---|---:|---:|
| 4 | Escalera de emergencia agrietada | 10 | ALTO | 35 % | 20 |
| 4 | Pasarela de servicio reforzada | 20 | MODERADO | 20 % | 10 |
| 4 | Escalera técnica junto al montacargas | 25 | BAJO | 10 % | 5 |
| 5 | Cocina industrial derrumbada | 10 | EXTREMO | 50 % | 30 |
| 5 | Pasillo del restaurante | 20 | MODERADO | 20 % | 10 |
| 5 | Galería de extracción de cocinas | 25 | BAJO | 10 % | 5 |

Las dos rutas privadas permiten transporte. El montacargas está averiado y no se usa. Las proyecciones incluyen nombre, explicación y coste; omiten probabilidades y metadatos internos.

### Mantenimiento y permisos

Solo un personaje activo de Mantenimiento ve inicialmente la tercera ruta. Para los otros humanos activos se proyectan dos; para una identidad desconocida o eliminada, ninguna. Los catálogos internos y el estado completo nunca deben serializarse al cliente.

`revealIntermediateFromSession` recibe una función de resolución de sesión del servidor: la integración usará la misma búsqueda `connections -> participant.characterId` que `RoomManager.routeAction`, validando también la partida/sala. No se acepta un personaje elegido por el navegador. Este adaptador está probado, pero deliberadamente no está conectado a eventos actuales.

La revelación solo se permite en preparación y utiliza `recordMaintenanceRevelation`: guarda ruta, ronda, autor y fecha de servidor. Repetirla no cambia ni duplica el registro. Entrar en una ronda no revela nada. Tras compartirla aparece para los otros humanos y entre las opciones de votación.

Dos revelaciones diferentes válidas cumplen el objetivo existente de Mantenimiento sin necesidad de abrir o recorrer las rutas. Un Mantenimiento muerto o abandonado no puede revelar: `intermediateMaintenanceStatus` señala internamente `replacement-policy-pending`. No se designa sucesor ni se publica la ruta automáticamente.

### Votos, costes y accidentes

Se usa `createDecision` y el mismo motor `castVote/checkDeadline/openNextAttempt`: 60 y 30 segundos, mayoría estricta, cambio de voto y cierre inmediato. Las opciones proceden del catálogo del servidor y excluyen las rutas privadas sin revelar. Al finalizar, `settleIntermediateVote` permite movimiento solo con aprobación; el desplazamiento valida que la ruta coincida con la aprobada.

Tras dos intentos sin mayoría se devuelve `no-consensus-pending`: no hay daño, coste, derrumbe ni selección forzosa. Queda bloqueado el movimiento hasta que se defina su consecuencia en 10B.2.

El movimiento utiliza `traverseRouteEffects`, que reutiliza el pago, clasificación y transporte actuales y aplica el daño con las funciones existentes. Selecciona hasta dos humanos activos distintos sin reemplazo; si queda uno, recibe daño una vez. Los eliminados quedan excluidos, los transportados pagan cero y los porteadores abonan coste de ruta +15 por transportado. La salud nunca baja de cero y los pagos insuficientes se rechazan sin efectos parciales.

Cada ronda conserva su resultado: reintentar la misma solicitud devuelve el resultado sin consumir azar, energía ni salud; otra solicitud tras resolver se rechaza. Una fuente aleatoria inválida deja un bloqueo persistente sin confirmar pagos ni daños, evitando volver a tirar. Un rechazo previo al azar por energía insuficiente permite usar suministros y reintentar.

Los recursos usan `consumePack` y `administerTreatment`. El adaptador exige Botones o Médico activos respectivamente, conserva recibos idempotentes y autoriza preparación y movimiento aprobado, no votación ni ronda completada. Esta última ventana permite resolver el agotamiento; las ventanas de transporte y sus identificadores de sesión deberán conectarse al servicio real en 10B.2. Se conserva un tratamiento por paciente y ronda, incluidos los historiales anteriores. No hay inventarios ni premios nuevos.

El registro de objetivos incluye únicamente movimientos completados, con categoría real interna. Atravesar la cocina registra EXTREMO y hace incumplir el objetivo del Arquitecto; conocerla, revelarla o votarla no lo hace. El registro no publica probabilidades.

## Evaluación de energía de seis etapas

Reproducible con `npm run build` y, desde la raíz:

```sh
node --input-type=module -e "import {ENERGY_SCENARIOS,evaluateSixRoundEnergy} from './apps/server/dist/simulation/six-round-energy.js'; console.table(ENERGY_SCENARIOS.map(evaluateSixRoundEnergy));"
```

Supuestos: cuatro humanos inicialmente con 100 de energía; packs de +25 administrados antes del esfuerzo cuando sean necesarios, sin superar 100. Se mantiene el grupo completo, sin abandonos implícitos ni transporte en esta tabla. No hay penalizaciones por falta de consenso. La evaluación es energética: no garantiza supervivencia ante todos los accidentes, disponibilidad futura de especialistas ni acceso a una ventana multijugador aún no integrada.

Recorrido mínimo: paso inicial 25, pasillo inestable 20, galería de tuberías 20, escalera agrietada 10, cocina 10, grieta exterior 10 = **95** por humano. Incluye riesgos extremos. La galería conserva su daño garantizado de 20 en el motor real.

Recorrido de menor riesgo: paso inicial 25, ventilación 30, puerta cortafuegos 30, escalera técnica 25, galería de extracción 25, puerta giratoria 20 = **155**. Requiere las revelaciones correspondientes y la palanca disponible en ronda 3. La variante con almacén sustituye puerta cortafuegos por escombros metálicos (+10), con el mismo riesgo moderado en esa ronda.

Los dos primeros rescates añaden 50 por humano. El último NPC añade 25 si se ayuda a caminar (incluida la opción médica, que además consume una unidad) o 40 si se transporta inmóvil. La evaluación no altera sus reglas ni genera encuentros.

| Escenario | Coste por humano | Packs disponibles iniciales + almacén | Packs gastados hasta terminar/bloquear | Llegan los cuatro | Bloqueo |
|---|---:|---:|---:|---|---|
| Mínimo sin rescates | 95 | 8 + 0 | 0 | Sí, energía final 5 | — |
| Mínimo sin suministros | 95 | 0 + 0 | 0 | Sí, energía final 5 | — |
| Menor riesgo, sin rescates | 155 | 8 + 0 | 8 | No | Etapa 6 |
| Mínimo con dos rescates | 145 | 8 + 0 | 8 | Sí, energía final 5 | — |
| Menor riesgo con dos rescates | 205 | 8 + 0 | 8 | No | Etapa 4 |
| Almacén +4, sin rescates, rutas prudentes | 165 | 8 + 4 | 12 | Sí, energía final 10 | — |
| Almacén +8, solo último rescate asistido, rutas prudentes | 190 | 8 + 8 | 16 | Sí, energía final 10 | — |
| Almacén +4, dos rescates, rutas prudentes | 215 | 8 + 4 | 12 | No | Etapa 5 |
| Almacén +8, dos rescates, rutas prudentes | 215 | 8 + 8 | 16 | No | Etapa 6 |
| Almacén +8, tres rescates asistidos, rutas prudentes | 240 | 8 + 8 | 16 | No | Etapa 6 |
| Almacén +8, dos rescates y último NPC inmóvil transportado, rutas prudentes | 255 | 8 + 8 | 16 | No | Etapa 6 |

Los fallos no son solo consecuencia del reparto elegido: 155 exige al menos 12 packs para cuatro humanos (hay 8), 205 exige 20 (hay 8), 215 exige 20 (hay 12 o 16), 240 exige 24 y 255 exige 28 (hay 16). Con costes de esta tabla no hay pérdidas por el límite de 100 que alteren estas conclusiones. No se ajustó automáticamente ningún valor.

Transporte final verificado: con energías [0,50,50,50] y sin packs, dos movimientos de coste 10 pueden realizarse transportando al primero con el segundo: resultado [0,0,30,30]. El transportado no paga; el porteador paga 25 cada vez. No basta para un desplazamiento adicional sin otra decisión de transporte. El transporte no resuelve por sí mismo el agotamiento general: necesita humanos capaces de pagar los sobrecostes.

Hay una prueba completa de seis desplazamientos que reutiliza los motores anteriores, atraviesa las nuevas rondas aprobadas por votación y evalúa los efectos de salida sin crear un nuevo resultado final: con cero packs y azar sin accidentes, los cuatro conservan salud 80 y energía 5. Demuestra que al menos un humano puede alcanzar la salida; no es una garantía bajo cualquier azar. Se prueba además el caso de un único humano.

## Migración segura prevista para 10B.2

| Zona | Dependencia actual | Acción futura |
|---|---|---|
| `simulation/round-four.ts`, `rooms/round-four.ts` | Evacuación, NPC final, bloqueos y resultado en ronda 4 | Separar identidad de etapa y número; conservar una sola implementación y una sola entrada a evacuación |
| `rooms/manager.ts` | Avance desde ronda 3 a evacuación; ramas `currentRound === 4`; `fourthWindow`, publicación y finalización | Insertar etapas 4 y 5 antes de llamar al motor final; mantener guardas de finalización e idempotencia |
| `rooms/socket.ts`, `packages/shared/src/index.ts` | Eventos `round-four:advance/open/retry/updated`, `RoundFourView`, uniones limitadas a 1–4 | Elegir nombres/versionado de protocolo; migrar ambos extremos juntos, evitando dos suscripciones o dos evacuaciones |
| `state.ts`, transporte | Estados y registros con numeración de ronda | Usar seis rondas en la partida nueva; impedir interpretar el nuevo descenso como salida antigua |
| `simulation/final-result.ts` | Busca `roundFour` en ronda 4, NPC y resultado etiquetados como 4 | Construir exactamente un resultado en ronda 6 o ante eliminación terminal, nunca al completar el descenso |
| `objective-evidence.ts` | Trayectoria `[1,2,3,4]`, NPC final 4 y salida 4 | Adaptar trayectoria a seis; mantener revelaciones únicas y evidencias únicamente de recorridos reales |
| Recursos en `rooms/manager.ts` y contratos | Ventanas, recibos y contadores 1–4 | Llevar historiales a seis sin borrar tratamientos; conectar permisos, recibos y ventanas de transporte al adaptador interno |
| `game-state.ts`, `GameScreen.tsx`, `RoundFour.tsx`, `game-socket.ts` | Ronda 4 significa pantalla de evacuación y final | Añadir escenas 4/5 y mover la escena final a 6; revisar reconexiones y estados obsoletos |
| `game-history.ts`, `FinalResults.tsx`, contratos finales | Eventos NPC/derrumbe/salida con `round:4`, identificadores `npc:4` y resultados | Migrar etiquetas e identidades del NPC final sin duplicar historial ni rescates |
| Pruebas | `round-four*`, `game-final*`, `objective-evidence*`, `final-result*`, `game-state*`, UI y sockets | Conservar regresiones del motor final y añadir flujo completo de seis etapas, reconexión y reintentos |

Orden recomendado: confirmar las reglas pendientes; decidir discriminantes/versionado del estado y protocolo; adaptar tipos internos y finales; insertar transiciones en servidor; conectar proyecciones privadas y servicios autenticados; adaptar cliente e historial; verificar integración completa y reconexión. No hacer un reemplazo textual masivo de 4 por 6: el número 4 también identifica ahora una ronda intermedia legítima.

Riesgos principales: confundir ambos significados de ronda 4, finalizar anticipadamente, duplicar el NPC o la salida, reutilizar recibos de otra ronda, publicar catálogos internos, perder historiales al reconstruir estado y procesar eventos de una etapa antigua.

## Pendientes que necesitan decisión antes de integrar

1. Consecuencia del fracaso de las dos votaciones de ruta en cada ronda nueva. Actualmente queda pendiente, sin penalización ni ruta forzosa.
2. Política de relevo cuando Mantenimiento muere o es abandonado antes de revelar. Actualmente no hay sucesión automática.
3. Balance energético: decidir si se aceptan los itinerarios inviables para el grupo completo o si posteriormente se modifican recursos, rutas o costes. Los valores aprobados se conservan.
4. Protocolo y estados de seis rondas, incluida la estrategia para eventos antiguos y reconexiones. Los estados internos de laboratorio no deben pasarse al constructor actual de resultados como si fueran una partida integrada.
5. Integración de ventanas de recursos y decisiones de transporte sin consenso, manteniendo las reglas actuales hasta 10C.

Limitaciones previas conservadas: el riesgo de ronda 1 sigue sin categoría estructural explícita; por ello el objetivo del Arquitecto puede continuar pendiente aunque no se haya recorrido EXTREMO. Las revelaciones históricas sin autoría completa no acreditan automáticamente el objetivo de Mantenimiento. No se inventaron hechos ni se corrigieron estas cuestiones fuera de alcance.

## Validación final

- Vitest: **546 pruebas aprobadas en 39 archivos** (511 existentes y 35 nuevas).
- TypeScript: `npm run typecheck` aprobado en todos los workspaces.
- Compilación: `npm run build` aprobada en todos los workspaces.
- `git diff --check`: aprobado; Git únicamente avisa de la normalización habitual LF/CRLF en Windows.
- Sin modificaciones en `docs/`, sin dependencias nuevas, sin commit ni push.
