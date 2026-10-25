# Fase 10C.1 — Crisis en transporte humano

Intervención sobre una copia de trabajo con cambios previos de 10B–10D.1 sin confirmar. No se han revertido esos cambios. No se han modificado docs/, objetivos individuales, costes, probabilidades, daños habituales, visibilidad del Arquitecto ni selección de víctimas de accidentes. Sin dependencias, commit ni push. No se desarrolla 10C.2.

## Archivos de esta intervención

Creados:
- apps/server/src/simulation/transport-crisis.ts: daños y recibos idempotentes; registro separado de evacuaciones de sector.
- apps/server/src/rooms/transport-crisis.test.ts: pruebas directas del transporte.
- apps/server/src/rooms/transport-crisis.socket.test.ts: cuatro clientes reales, reconexiones y aislamiento.
- apps/server/src/rooms/PHASE_10C_1.md: este informe.

Modificados (algunos ya tenían cambios de fases anteriores):
- apps/server/src/rooms/transport.ts: secuencia y resolución de la crisis, decisiones encadenadas, distinción entre estado real y previsión NPC.
- apps/server/src/rooms/voting.ts: política de tres plazos y recálculo del electorado antes de reabrir; parada segura si no procede otra votación.
- apps/server/src/rooms/manager.ts: reutilización del avance, recibos de sector y relevo aleatorio del anfitrión.
- apps/server/src/rooms/socket.ts: publicación del cambio de anfitrión.
- apps/server/src/rooms/intermediate.ts: proyección del sector evacuado en rondas 4 y 5.
- apps/server/src/rooms/transport.test.ts y six-round.test.ts: actualización de expectativas antiguas y pruebas reales de los seis coordinadores.
- apps/server/src/simulation/state.ts: recibos opcionales, compatibles con estados sin incidentes previos.
- apps/server/src/simulation/round-two.ts, round-three.ts y round-four.ts: aceptar una evacuación de sector como transición válida sin fabricar un desplazamiento.
- apps/server/src/simulation/final-result.ts: narración de crisis y sectores evacuados en el resultado.
- packages/shared/src/index.ts: contratos de incidentes y sectores; estado previo de NPC pendiente cuando falta un recorrido completado.
- apps/web/src/Transport.tsx: avisos de gas, intento extraordinario, explosión, fallecidos y abandonados.
- apps/web/src/GameScreen.tsx: aviso en la acción actual y después del avance de sector.
- apps/web/src/game-state.ts: selección de la acción vigente y motivos de bloqueo.
- apps/web/src/game-history.ts: eventos únicos de crisis y evacuación sin recompensa.
- apps/web/src/Transport.test.ts: representación, idempotencia y ausencia de acciones de transporte antiguas.

## Tres intentos y daños

El motor de votaciones existente conserva mayoría estricta, cambio de voto, autorización por alternativa y cierre inmediato. Solo el transporte humano utiliza 60, 30 y 10 segundos. Las votaciones de rutas y NPC conservan sus políticas.

Al fracasar el segundo intento se aplica gas: 5 puntos a cada humano vivo y no eliminado, con salud limitada a cero. Después se recalculan agotados, opciones viables y votantes. La tercera ventana pertenece al servidor. Si logra mayoría, se ejecuta el plan normal y el gas permanece.

Al fracasar el tercer intento se aplican otros 5 puntos a los que aún estén vivos. No hay cuarto intento. Cada suceso tiene un recibo identificado por preparación y tipo. Una segunda decisión encadenada no repite el gas del mismo incidente. Los fallecidos dejan de votar y no reciben nuevos daños.

## Abandonos, inventario y continuación

Se vuelve a clasificar al equipo después de la explosión usando el coste de la ruta. Solo se abandonan humanos vivos cuya energía no alcanza ese coste. Poder caminar pero no cargar no causa abandono. Se reutiliza abandonCharacters: eliminación permanente y transferencia de objetos personales al inventario compartido, sin duplicar existencias ni convertir objetos en contadores de packs o botiquines.

En rondas 1–5 se registra una evacuación precipitada independiente del recorrido normal. Se activa automáticamente la preparación siguiente usando el mismo mecanismo de avance. No se cobra desplazamiento, no se sortea accidente ni se conceden hallazgos, herramientas o recompensas de la ruta omitida. Los costes de rescates NPC que ya se habían ejecutado permanecen; un rescate meramente aprobado no se fabrica como completado. Si no queda nadie activo, se utiliza el desenlace existente y no se avanza.

Según la aclaración del usuario, si el anfitrión ya no está activo tras la explosión se elige aleatoriamente un sucesor entre los participantes con humanos vivos y no abandonados. No se reasigna ningún rol profesional. Se publica room:updated y la credencial del nuevo anfitrión conserva el control al reconectar. El anterior no vota ni utiliza recursos. Los participantes desconectados conservan su plaza y pueden recuperar sus controles con su credencial.

En ronda 6 se mantienen los abandonos y se intenta la misma salida elegida mediante resolveRoundFourExit. El esfuerzo NPC pendiente, el coste de salida y el accidente siguen siendo la transacción normal. La previsión de energía para calcular porteadores nunca se confirma como pago anticipado. Si la transacción falla, no se publican gastos parciales ni un rescate inventado. Si se completa, se calcula el desenlace existente con quienes realmente escapan.

Con dos agotados se conserva la decisión válida de transportar a uno y se abre la selección independiente del destinatario. Cada decisión tiene sus propios intentos y electorado; los recibos de gas/explosión pertenecen al incidente completo. Sin selección aprobada no se inventa un destinatario. El fallo extraordinario abandona a los humanos que siguen necesitando ayuda, sin cobrar el transporte no realizado.

## Sincronización y privacidad

Los plazos y consecuencias se resuelven en servidor. Reconectar recupera la misma preparación, intento y vencimiento. Los clientes muestran instantáneas; no ejecutan daños. El historial utiliza identificadores estables y React no acumula avisos al recibir de nuevo una instantánea.

Se conserva la proyección individual: energía propia; salud ajena solo para Médico activo; daño numérico de los sucesos solo para el propietario. Los fallecimientos y abandonos son públicos. Las cifras internas no se difunden directamente por Socket.IO. La selección de acción usa la ronda autoritativa para descartar votaciones previas.

## Verificación

- Vitest: 674 pruebas aprobadas en 54 archivos.
- TypeScript: correcto en shared, server y web.
- Compilación: correcta en los tres paquetes, incluida producción Vite.
- git diff --check: correcto.

Las pruebas nuevas cubren plazos, cambios de voto en los tres intentos, mayorías inmediatas, gas y explosión, fallecimientos, electorado recalculado, caminantes sin capacidad de carga, objetos transferidos una vez, dos agotados y votaciones encadenadas, continuación en rondas 1–5, ausencia de recompensas, salida 6 con rescate NPC pendiente y accidente, error atómico de azar, desenlaces sin humanos activos, sucesión de anfitrión, cuatro sockets reales, F5 en los tres intentos, privacidad, aislamiento entre salas y listener único al reconectar.

No se ha ejecutado una revisión visual manual en navegadores durante esta intervención. La comprobación React es automatizada con renderizado estático.

## Reproducción manual

1. Abrir cuatro navegadores o perfiles, crear sala, reunir cuatro participantes e iniciar.
2. Llegar a una preparación con un humano cuya energía sea inferior al coste de ruta y otros con energía para cargar. No recuperarle con packs. Para una reproducción determinista de desarrollo, las pruebas fijan esa energía antes de abrir la ruta; no se han añadido controles ni trampas al producto.
3. Elegir la ruta y abrir transporte. No votar o repartir los votos sin mayoría. Observar los 60 segundos y el segundo plazo de 30.
4. Tras el segundo fracaso, comprobar fuga, daño propio de 5 y plazo extraordinario de 10 segundos. Recargar distintos clientes durante cada intento: debe conservarse el vencimiento del servidor.
5. En una partida, conseguir mayoría durante esos 10 segundos: comprobar movimiento normal y gas conservado.
6. En otra, dejar vencer: comprobar otros 5 de daño, abandonos públicos y paso a la siguiente preparación. Verificar energía sin coste ordinario y ausencia de recompensas del sector omitido.
7. Si el abandonado era anfitrión, comprobar la etiqueta de anfitrión y apertura de votación desde el sucesor. El anterior debe permanecer excluido.
8. Repetir en ronda 6: comprobar la misma salida, coste y accidente habituales, rescate NPC solo si se completa el esfuerzo y resultado final coherente.
9. Revisar historial sin eventos duplicados y salud/energía privadas; comprobar también un agotado y dos, resolviendo o dejando fallar la selección de destinatario.

## Excepciones que necesitan una política adicional

- Si el gas mata a todos los porteadores autorizados y queda algún humano que necesita transporte, no existe electorado válido para una mayoría estricta. Se conserva un estado bloqueado explícito (no-eligible-voters-after-gas), sin inventar votos, transporte ni explosión aprobada. Esta combinación queda pendiente de una regla de continuación.
- Más de dos agotados o ausencia inicial de porteadores conservan los bloqueos de las reglas anteriores; no se ha definido una crisis automática sin votación inicial válida.
- Si el gas mata al único agotado, desaparece la necesidad de transporte y se intenta caminar normalmente; no se inventa una decisión de abandono.
- Un fallo técnico de azar al generar la preparación 6 puede impedir activarla tras evacuar el sector 5. El recibo del sector permanece y el anfitrión puede usar el avance existente; no se inventa encuentro ni se revierten daños.
- Una salida final no ejecutable conserva el rescate NPC aprobado y pendiente junto con los daños y abandonos reales; el azar inválido mantiene su bloqueo previo contra nuevos sorteos. No se inventa el abandono del NPC.

Fin de 10C.1. Esperando revisión; 10C.2 no iniciada.
