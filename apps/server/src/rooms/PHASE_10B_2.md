# Fase 10B.2 — seis rondas multijugador

## Alcance y resultado

La partida jugable recorre ahora las seis rondas consecutivas. Las nuevas rondas 4 y 5 utilizan el motor de 10B.1; la única evacuación existente pasa a ronda 6. No se implementan 10C, gas, explosión, puntuaciones, IA, persistencia ni recompensas nuevas. Los documentos originales de `docs/` permanecen intactos y no se realizan commits ni push.

Antes de editar se revisaron el informe 10B.1, los motores y costes, el estado, las evidencias, RoomManager, Socket.IO, RoomVoting, transporte, recursos, privacidad, contratos compartidos, React y las pruebas. Las dependencias de la numeración antigua estaban en: entrada desde ronda 3, estado `roundFour`, encuentro NPC, votaciones, ventanas de suministros, transporte, resultados, evidencias, eventos, selector de pantalla, historial y fixtures de regresión.

## Archivos nuevos

- `apps/server/src/rooms/intermediate.ts`: coordinador por sala y ronda, sin duplicar reglas de simulación o votación.
- `apps/server/src/rooms/six-round.test.ts`: integración del gestor, permisos, recursos, riesgos, bloqueos, transporte, resultados e idempotencia.
- `apps/server/src/rooms/six-round.socket.test.ts`: tres partidas completas con cuatro clientes Socket.IO reales y sus reducers React, incluida reconexión durante votación.
- `apps/server/test-support/final-stage.ts`: fixtures explícitos para aislar las regresiones del motor antiguo de salida. No se usan en producción ni en las pruebas nuevas de partidas completas.
- `apps/web/src/IntermediateRound.tsx`: pantalla común para las nuevas rondas, manteniendo los paneles y estilos existentes.
- `apps/web/src/IntermediateRound.test.ts`: renderizado, fase única, cuatro tarjetas, historial y falta de acuerdo.
- `apps/server/src/rooms/PHASE_10B_2.md`: este informe.

## Archivos modificados

Servidor:

- `rooms/manager.ts`, `socket.ts`, `voting.ts`, `transport.ts`, `round-four.ts`.
- `simulation/state.ts`, `intermediate-rounds.ts`, `round-four.ts`, `energy-costs.ts`, `six-round-energy.ts`, `objective-evidence.ts`, `final-result.ts`.
- Regresiones: `rooms/round-four.test.ts`, `round-four.socket.test.ts`, `game-final.socket.test.ts`, `medical.test.ts`; `simulation/round-four.test.ts`, `final-result.test.ts`, `objective-evidence.test.ts`.

Cliente:

- `GameScreen.tsx`, `Lobby.tsx`, `Medical.tsx`, `RoundFour.tsx`, `game-state.ts`, `game-socket.ts`, `game-history.ts`.
- Regresiones: `RoundFour.test.ts`, `FinalResults.test.ts`.

Contratos: `packages/shared/src/index.ts`.

Los archivos de 10B.1 que ya estaban sin seguimiento al empezar esta intervención se conservan. No se sustituyó el catálogo ni la evaluación energética por motores nuevos.

## Transiciones y fases

El evento `intermediate:action` recibe exclusivamente `{ round: 4 | 5, action }`. El servidor valida forma, sesión, personaje activo, anfitrión cuando corresponde y finalización de la etapa anterior. La ronda 4 requiere completar la 3; la 5 requiere completar la 4. Abrir o repetir una transición ya aplicada no vuelve a cobrar ni a generar accidentes. Una solicitud antigua nunca salta a otra ronda.

Cada coordinador utiliza `prepareIntermediateRound`, `intermediateRouteViews`, `revealIntermediateRoute`, `openIntermediateVote`, `settleIntermediateVote` y `resolveIntermediateRoute`. RoomVoting recibe la decisión creada por el motor de 10B.1 y conserva la misma identidad de votación; no se abre una votación paralela. Las identidades del electorado se vinculan a participantes autenticados.

Se reutilizan los dos intentos de 60 y 30 segundos, mayoría estricta, cambios de voto, cierre inmediato y plazos de servidor. Con mayoría se realiza el movimiento o se prepara el transporte existente. Sin mayoría en ambos intentos, la fase `no-consensus-pending` se sincroniza con todos: no se elige una ruta, no hay daños ni costes y no se permite avanzar.

Las nuevas escenas muestran número, título, contexto, rutas, riesgo categórico, costes autorizados, votación y preparación. La etapa autoritativa y la ronda máxima recibida impiden que un snapshot auxiliar antiguo oculte la acción vigente. Solo se muestra un panel de acción; siguen existiendo cuatro tarjetas de equipo y un historial plegado.

## Rutas secretas y evidencias

Cada envío de `intermediate:updated` se construye para el personaje de esa conexión; nunca se emite un catálogo privado común a la sala. Antes de revelar, solo Mantenimiento recibe los datos de su ruta. Su conocimiento privado no permite votarla sin compartirla.

La revelación exige sesión autenticada, personaje activo de Mantenimiento y fase de preparación. Se conserva el registro existente con ruta, autor, ronda y momento de servidor, sin duplicarlo. La recarga recupera el mismo registro y la misma fase. Dos rutas distintas reveladas cuentan aunque se elijan otras rutas; la revelación de ventilación en ronda 2 sigue contando.

No se publica automáticamente una ruta si Mantenimiento ha muerto o ha sido abandonado y no se crea sustituto. Continúa pendiente definir una política de relevo.

Las evidencias de rutas se ordenan por ronda y solo incorporan movimientos completados. Recorrer la cocina de ronda 5 registra EXTREMO para Arquitecto/Ingeniero. No se publican probabilidades. Los tratamientos conservan autoría, paciente y ronda entre las seis etapas. El NPC final queda etiquetado como ronda 6; no se añaden NPC en las rondas intermedias.

## Recursos, agotamiento y transporte

RoomManager sigue siendo la autoridad de permisos y recibos de packs y tratamientos. Se reutilizan sus inventarios y primitivas existentes; no se reconstruyen inventarios al avanzar. Las ventanas nuevas permiten preparación, preparación de transporte y revisión después del movimiento; se cierran durante votos de ruta/transporte, selección de destinatario, falta de consenso y bloqueo por azar inválido.

La restricción médica sigue siendo un tratamiento por humano y ronda. Se prueba un mismo paciente en rondas 4 y 5. Los recibos previos no se reinterpretan como tratamientos de ronda 6.

El transporte usa `TransportDecision` y sus reglas de elegibilidad por alternativa: +15 por humano transportado y por porteador, coste base cero para el transportado y pago íntegro antes de confirmar el movimiento. Los gastos inviables no se aplican parcialmente. La falta de acuerdo en transporte conserva el estado pendiente vigente; no hay tercera votación, gas ni explosión.

Cada movimiento nuevo conserva el recibo del motor de 10B.1. Una resolución repetida no vuelve a consumir azar, salud ni energía. La aleatoriedad inválida bloquea nuevos intentos aleatorios sin confirmar gastos o daños. Los snapshots del resultado se fijan al terminar el movimiento, para que packs o tratamientos posteriores no reescriban la historia.

La privacidad sigue pasando por `sessionProjection`: valores exactos propios, salud ajena solo para Médico activo, energía ajena nunca. También se filtran víctimas, tratamientos, recursos, resultados y snapshots del historial. Elegibilidad y disponibilidad se comunican sin enviar cifras privadas de terceros.

## Evacuación y desenlace

El módulo técnico `simulation/round-four.ts`, su coordinador y algunos nombres `RoundFour*` se conservan para limitar la refactorización, pero ahora su ronda es **6**. Su entrada exige una ronda 5 completada. No existe otro motor de salida.

Se añaden eventos canónicos `round-six:advance/open/retry/updated`. Los eventos antiguos `round-four:*` siguen siendo alias del mismo servicio, con las mismas comprobaciones: no pueden iniciar la salida desde ronda 3 ni crear una segunda evacuación. El cliente usa los eventos nuevos.

Se conservan las probabilidades de encuentro 50/25/25, las opciones NPC, rescates pendientes, reglas de palanca, costes y accidentes de puerta/grieta y las consecuencias de falta de acuerdo de salida. El primer fracaso aplica una sola vez −5 de salud y recargo +5; el segundo inutiliza la puerta y obliga a la grieta por 15. Las regresiones originales se mantienen adaptando su numeración y preparación de fixtures.

El resultado por evacuación solo se construye al completar la salida de ronda 6. Completar las rondas 4 o 5 no termina la partida. La ausencia de humanos activos sigue siendo terminal en cualquier ronda. Si el último accidente ocurre en una ronda intermedia, el resultado conserva ese desplazamiento como último movimiento.

Los NPC rescatados en rondas 1 y 2 se consideran evacuados cuando se completa la salida final, conforme a la regla aprobada. El resultado final se sella una vez, se recupera con F5 y no vuelve a aplicar efectos. Se mantienen abandonos, fallecimientos, recursos, historial y objetivos privados.

## Validación y viabilidad

Las nuevas partidas completas verifican costes reales, sin reponer artificialmente energía ni inventario:

| Recorrido | Packs consumidos | Resultado sin accidentes |
|---|---:|---|
| Mínimo: pasillo inestable, tuberías, escalera agrietada, cocina y grieta | 0 | Cuatro evacuados, salud 80 y energía 5 |
| Prudente: ventilación, almacén, escalera técnica, extracción y puerta giratoria | 12 | Cuatro evacuados, energía 10; con almacén de ocho quedan cuatro packs |
| Mínimo con rescates NPC de rondas 1 y 2 | 8 | Cuatro humanos y dos NPC evacuados; energía humana final 5 |

Se mantienen las conclusiones de 10B.1: no todas las combinaciones prudentes y de rescate tienen recursos suficientes. El servidor bloquea rutas inviables; no cambia costes para hacerlas posibles. La viabilidad sin accidentes no garantiza sobrevivir a todos los posibles accidentes.

También se comprueban rutas secretas y rechazo de votos manipulados, autoría y duplicados, tratamientos entre rondas, accidentes con dos víctimas distintas, transporte real en ronda 5, azar inválido, Mantenimiento eliminado, recursos fuera de ventana, falta de consenso de ruta y transporte, snapshots estables, final temprano por ausencia de humanos, aislamiento entre salas y bloqueo de acciones después del resultado.

Los tres recorridos Socket.IO usan cuatro clientes reales, eventos autenticados, revelaciones, comprobación de privacidad, recarga durante votación con conservación del voto y plazo, transiciones completas y un único resultado final. Las pruebas React comprueban una escena activa y cuatro tarjetas; no equivalen a una prueba visual manual del navegador.

## Comprobación manual con cuatro navegadores

1. Desde la raíz, con Node 24 y npm 11 disponibles, ejecutar `npm.cmd run dev:server` y `npm.cmd run dev:web` en terminales separadas. No hace falta base de datos. El README explica cómo habilitar el Node portátil del repositorio si no está en PATH.
2. Abrir `http://localhost:5173` en cuatro pestañas independientes o perfiles. Cada sesión se guarda en `sessionStorage`; evitar duplicar una pestaña que ya tenga credenciales de otra. Crear sala, unir a las otras tres e iniciar con el anfitrión.
3. En ronda 1, decidir rescate. Para comprobar el recorrido mínimo, elegir abandonar. Al completar, el anfitrión avanza a ronda 2.
4. En ronda 2 elegir pasillo inestable, resolver después la votación NPC y confirmar preparación del desplazamiento/transporte. Verificar que este orden se conserva. Avanzar a ronda 3.
5. Elegir galería de tuberías para coste mínimo. Curar heridos en ventanas autorizadas si los accidentes lo requieren. Al completar, comprobar que el botón inicia **Descenso entre las ruinas**, no la evacuación.
6. En ronda 4 comparar las pantallas antes de revelar: solo Mantenimiento conoce la escalera técnica. Revelarla y comprobar que aparece a todos. Abrir votación, cambiar un voto antes de alcanzar mayoría y recargar una sesión: deben conservarse la ruta revelada, el voto propio y el plazo. Elegir escalera agrietada para el recorrido mínimo.
7. Al completar la ronda 4 no debe aparecer resultado final. Avanzar a ronda 5, repetir la comprobación de la galería de extracción y elegir cocina para el mínimo. Revisar heridos y recursos; si alguien necesita transporte, solo los autorizados pueden votar cada alternativa.
8. Solo tras completar ronda 5 iniciar ronda 6. Resolver el NPC final si aparece; para conservar el presupuesto mínimo, abandonarlo. Elegir grieta exterior. El azar real puede causar heridos o fallecimientos; las pruebas automatizadas fijan el azar para verificar el presupuesto de referencia.
9. Comprobar un solo resultado final, NPC de rondas 1/2 evacuados si fueron rescatados, objetivos propios, historial sin duplicados y cifras privadas correctas. Recargar y comprobar que no se repiten efectos ni se reabre la partida.
10. Para probar el bloqueo de diseño, dejar sin votos ambos intentos de ruta de ronda 4 o 5: debe mostrarse la falta de consenso y no ejecutarse ningún movimiento. Reiniciar con otra sala para otro recorrido; no existe todavía una resolución de ese bloqueo.

## Pendientes y riesgos para 10C

- Definir la consecuencia de dos intentos fallidos de ruta en las rondas 4 y 5. Actualmente queda un bloqueo explícito, seguro y recuperable por sesión, sin continuación diseñada.
- Definir el relevo de Mantenimiento eliminado; no se presupone sucesor.
- Mantener pendiente la decisión de balance energético. Las estrategias inviables permanecen bloqueadas.
- Ronda 1 sigue sin categoría estructural explícita: Arquitecto puede seguir pendiente si no se confirma EXTREMO. No se inventa una categoría nueva.
- El servidor conserva estado en memoria: F5/reconexión funciona mientras el proceso siga activo; reiniciarlo pierde las salas, como antes.
- Los alias técnicos `RoundFour*` ahora significan evacuación de ronda 6. Cualquier futuro cambio debe usar los discriminantes de ronda y no reemplazar globalmente el número 4.
- Gas/explosión deberá introducir una fase propia del transporte sin consenso y un temporizador de servidor de 10 segundos, con sus autorizaciones. Habrá que coordinar cancelación de temporizadores, reconexión, ventanas de recursos y finalización anticipada, sin reabrir decisiones cerradas.
- Los daños de explosión, fallecimientos, abandonos y posibles movimientos necesitarán una única transacción y recibos idempotentes, con privacidad en todos los envíos. No deben dispararse tanto desde el timeout como desde un voto tardío, ni mezclarse con el bloqueo de consenso de rutas.

No se avanza a 10C.

## Resultado de las comprobaciones finales

- **Vitest: 573 pruebas aprobadas en 42 archivos**; 546 regresiones anteriores adaptadas y 27 pruebas nuevas.
- `npm.cmd run typecheck`: correcto en los tres workspaces.
- `npm.cmd run build`: correcto para shared, servidor y web.
- `git diff --check`: correcto. Los avisos LF/CRLF corresponden a la normalización de finales de línea de Git en Windows.
- `git diff --name-only -- docs`: vacío.
- Tres partidas Socket.IO completas con cuatro clientes: mínimo, prudente y dos rescates.
- Sin prueba visual manual de cuatro navegadores; quedan incluidas las instrucciones anteriores para revisión.
