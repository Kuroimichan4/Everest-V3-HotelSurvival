# Fase 10B.3 — consecuencias por falta de consenso y ajuste de dificultad

## Estado de esta intervención

La propuesta recibió aprobación expresa de la usuaria antes de activar los cambios: «Sí, aprobar los cambios de 10B.3». Primero se incorporaron y ejecutaron las pruebas deterministas de diagnóstico y el análisis comparativo; después se aplicaron las probabilidades y consecuencias aprobadas.

La fase está implementada: BAJO 20 %, MODERADO 35 %, ALTO 55 % y EXTREMO 70 % en las rondas 2–6; réplica única de 10 puntos y ruta obligatoria tras dos fracasos de ruta en rondas 4/5. No se cambian costes, daños de accidente, suministros, humo garantizado, encuentro NPC, recompensas ni reglas de privacidad o transporte. No se implementa otra fase.

## Auditoría del motor

Se revisaron `simulation/routes.ts`, los catálogos de rondas 2, 3, 4/5 y 6, sus resoluciones, `rooms/manager.ts`, `rooms/intermediate.ts`, `rooms/voting.ts`, las proyecciones y pruebas existentes.

- `traverseRouteEffects` utiliza `roll < accidentProbability`. Con RNG uniforme en [0,1), 0,35 representa exactamente un 35 %. En el umbral exacto no hay accidente.
- Hay una tirada de decisión de accidente por movimiento. Si ocurre, se consumen hasta dos muestras adicionales para elegir víctimas distintas sin reemplazo. Estas no son tiradas adicionales de ocurrencia.
- La selección de víctimas excluye fallecidos y abandonados. Si solo queda uno, recibe daño una vez.
- El almacén usa además su propia tirada de recompensa y el encuentro NPC final usa su propia tirada de aparición. No se han cambiado.
- El servidor inyecta `routeRandom`, que por defecto es `Math.random`, en las mismas primitivas empleadas por simulación. No se ha encontrado un motor probabilístico distinto en Socket.IO.
- Los coordinadores conservan resultados, costes y bloqueos. Recargar o repetir una solicitud no abre una nueva tirada sobre un movimiento resuelto.
- Las comprobaciones de energía preceden al azar; un rechazo no confirma un pago parcial.
- No se ha encontrado un error de conversión entre porcentajes y fracciones. Sin registros de las partidas observadas no se puede atribuir con certeza su frecuencia concreta a una causa.
- Con los valores anteriores a 10B.3, un itinerario prudente de cuatro rutas BAJO y una MODERADO tiene una probabilidad teórica de **52,488 % de no sufrir accidentes**: 0,9^4 × 0,8. Es normal que aproximadamente la mitad de esas partidas no tenga ninguno.
- Las pruebas completas de 10B.2 usan habitualmente un RNG fijo de 0,99 para validar recorridos sin accidentes. Ese valor no representa el azar de una partida real y no se usa como valor fijo en producción.

`accident-audit.test.ts` recorre una cuadrícula determinista de 1.000 muestras para cada umbral 0,10/0,20/0,35/0,50/0,55/0,70: produce exactamente 100/200/350/500/550/700 accidentes. Comprueba además valores inmediatamente inferiores al umbral, igualdad, cero y el extremo superior, número de llamadas, víctimas distintas y separación de las tiradas de recompensa.

## Probabilidades aprobadas y activas

| Categoría | Anterior | Nueva aprobada |
|---|---:|---:|
| BAJO | 10 % | 20 % |
| MODERADO | 20 % | 35 % |
| ALTO | 35 % | 55 % |
| EXTREMO | 50 % | 70 % |

Los cuatro catálogos de servidor —ronda 2, ronda 3, rondas intermedias 4/5 y evacuación 6— consultan `ACCIDENT_PROBABILITIES` en `balance-probabilities.ts`. Las tablas histórica y aprobada quedan en el mismo módulo para reproducir la comparación. No se envían porcentajes a los clientes.

Después de dos intentos fallidos (60/30 segundos), `settleIntermediateVote` aplica una sola vez 10 puntos de daño a cada humano activo. Guarda un recibo con decisión, ronda, daños efectivos, fallecimientos y ruta obligatoria: escalera agrietada en ronda 4, cocina en ronda 5. El primer fracaso no aplica ese daño. El movimiento utiliza la misma ruta y su accidente habitual. Recalcula humanos activos, costes y porteadores después de la réplica. Si no queda ninguno, se finaliza sin tirar el accidente. Si falta energía, queda en preparación con bloqueo seguro y permite suministros/reintento sin repetir la réplica. No hay abandonos automáticos.

## Archivos creados

- `apps/server/src/simulation/accident-audit.test.ts`: diagnóstico determinista del RNG y los umbrales.
- `apps/server/src/simulation/balance-probabilities.ts`: fuente central activa y tablas histórica/aprobada del análisis.
- `apps/server/src/simulation/balance-analysis.ts`: simulaciones con semillas y primitivas reales de pago, packs, daño y accidentes.
- `apps/server/src/simulation/balance-analysis.test.ts`: reproducibilidad, porcentajes de referencia, oportunidades médicas y restricciones energéticas.
- `scripts/analyze-balance.mjs`: ejecución reproducible de la comparación.
- `apps/server/src/simulation/PHASE_10B_3.md`: este informe.

También se crean `simulation/intermediate-consensus.test.ts` y `rooms/intermediate-consensus.socket.test.ts`, con pruebas de motor y cuatro conexiones reales para las consecuencias nuevas.

## Archivos modificados

- `simulation/routes.ts`, `round-three-routes.ts`, `intermediate-rounds.ts`, `round-four.ts`: probabilidades centralizadas; consecuencias y selección forzada en las intermedias.
- `simulation/state.ts`: recibos de consecuencias conservados entre rondas y reconexiones.
- `simulation/objective-evidence.ts`: marca como forzada una ruta realmente recorrida; no acredita recorridos cuando la réplica impide moverse.
- `simulation/final-result.ts`: incluye las réplicas en las decisiones finales, incluso al fallecer todos antes de recorrer la ruta.
- `rooms/intermediate.ts`, `manager.ts`: coordinación, proyección de intentos y consecuencias y preparación de recursos/transporte.
- `packages/shared/src/index.ts`: contrato de intentos fallidos y consecuencia proyectada; se elimina el bloqueo provisional de diseño.
- `web/GameScreen.tsx`, `IntermediateRound.tsx`, `game-state.ts`, `game-history.ts`: aviso único del intento fallido, réplica, daño propio y ruta impuesta; historial deduplicado y fase actual.
- Pruebas anteriores adaptadas en `simulation/routes.test.ts`, `round-three-routes.test.ts`, `round-four.test.ts`, `intermediate-rounds.test.ts`, `rooms/six-round.test.ts` y `web/IntermediateRound.test.ts`. Se sustituyen expectativas antiguas de umbrales y bloqueo provisional por los valores y reglas aprobados; las regresiones restantes se conservan.

Los cambios de 10B.1/10B.2 que estaban en el árbol de trabajo al empezar se conservan. No se modifican `docs/`, dependencias ni inventarios, y no se realizan commits ni push.

## Interfaz y privacidad

El primer y segundo intento fallidos se identifican por sus recibos, sin acumular mensajes. La réplica tiene un aviso único que sigue visible durante transporte, bloqueo o resultado de esa ronda. Solo se muestra el daño efectivo del personaje propio. El Médico conserva la salud exacta de todos mediante la proyección existente, pero no recibe energía exacta ajena ni daños privados ajenos. El historial recibe los mismos datos filtrados, no el estado del motor.

Las rutas secretas siguen sujetas a la revelación autenticada. Las probabilidades reales no se añaden a ningún DTO. Los recibos y snapshots se recuperan con F5 sin nueva réplica, accidente ni gasto.

## Método y límites de la comparación

Ejecución desde la raíz, con Node disponible:

```powershell
npm.cmd run build
node scripts/analyze-balance.mjs 10000 20261025
```

Son 10.000 semillas consecutivas por escenario y modelo, ocho escenarios y dos modelos: **160.000 partidas de referencia**. El generador Mulberry32 es exclusivo del análisis. Cada etapa, recompensa y encuentro utiliza una subsemilla estable, de modo que el número de muestras consumidas al elegir víctimas no desplace las tiradas de otros sucesos entre los modelos.

Políticas de referencia declaradas:

- No hay curación automática. La salud no se restaura en ninguna simulación.
- No se inventan decisiones de transporte o abandono: un itinerario sin energía suficiente se detiene. Eso no demuestra que otras decisiones de jugadores sean imposibles.
- Si Botones está activo, entrega el mínimo de packs necesario antes de cada esfuerzo, siguiendo un orden estable de personajes. Es una estrategia de referencia, no una predicción de jugadores.
- Los rescates de los dos primeros NPC añaden sus costes aprobados de 25 por humano. El encuentro final se genera con la regla existente y siempre se rechaza en esta referencia para aislar el efecto del itinerario.
- El itinerario prudente presupone rutas privadas conocidas y reveladas, usa almacén en ronda 3 y conserva sus recompensas 70 % cuatro packs / 30 % ocho packs.
- La referencia extrema impuesta conserva tres rutas EXTREMO y aplica las dos réplicas propuestas **en ambos modelos**, para aislar el efecto del porcentaje. Esta comparación mantiene constante la consecuencia ya aprobada para aislar la variación probabilística.
- Los casos de tres humanos conservan Mantenimiento, Médico y Botones; los de dos, Médico y Botones; el de uno, Médico. No se crean sustitutos. Los costes y daños se aplican solo a los presentes activos.
- Las oportunidades médicas son parejas distintas paciente/ronda observadas en ventanas anteriores al desenlace, con Médico activo y paciente vivo herido. No se cuentan ventanas después de la salida final.
- La capacidad médica es una cota de huecos de tratamiento que permitiría el inventario sobre esa trayectoria **sin curación**, no tratamientos ejecutados ni una predicción del efecto de curar. Curar cambiaría las lesiones posteriores y requeriría una estrategia del Médico explícita.
- Daño medio significa salud efectivamente perdida por todo el grupo, limitada a cero; incluye humo garantizado y, en la referencia impuesta, réplicas. No es daño por persona ni incluye una curación hipotética.
- «Bajo 50» cuenta humanos vivos que terminan entre 1 y 49; las muertes se muestran por separado. Las tasas sin accidentes de itinerarios bloqueados están condicionadas por las etapas realmente alcanzadas.

## Datos comparativos

Las cifras siguientes son medias por partida salvo porcentajes. Cada fila representa 10.000 partidas.

| Escenario | Modelo | Accidentes | Sin accidentes | Daño grupo | Vivos <50 | Muertos | Evacuados | Partidas con evacuación | Oportunidades médicas | Capacidad de tratamientos |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| minimum | historical | 2.210 | 5.460 | 197.644 | 0.986 | 0.251 | 3.749 | 100.000 | 16.557 | 4.000 |
| minimum | proposed | 3.214 | 0.520 | 247.736 | 1.439 | 0.655 | 3.345 | 100.000 | 16.701 | 4.000 |
| prudent-warehouse | historical | 0.594 | 52.860 | 7.866 | 0.000 | 0.000 | 4.000 | 100.000 | 3.326 | 1.655 |
| prudent-warehouse | proposed | 1.147 | 27.100 | 14.928 | 0.000 | 0.000 | 4.000 | 100.000 | 5.897 | 2.651 |
| two-npc-rescues | historical | 2.210 | 5.460 | 197.644 | 0.986 | 0.251 | 3.749 | 100.000 | 16.557 | 4.000 |
| two-npc-rescues | proposed | 3.214 | 0.520 | 247.736 | 1.439 | 0.655 | 3.345 | 100.000 | 16.701 | 4.000 |
| limited-packs | historical | 0.427 | 63.120 | 6.204 | 0.000 | 0.000 | 0.000 | 0.000 | 2.582 | 1.475 |
| limited-packs | proposed | 0.810 | 39.530 | 11.554 | 0.000 | 0.000 | 0.000 | 0.000 | 4.607 | 2.419 |
| repeated-extreme-forced | historical | 2.210 | 5.460 | 273.776 | 2.158 | 0.721 | 3.279 | 99.790 | 16.140 | 4.000 |
| repeated-extreme-forced | proposed | 3.214 | 0.520 | 318.010 | 2.100 | 1.394 | 2.606 | 98.630 | 15.866 | 4.000 |
| three-humans | historical | 2.210 | 5.460 | 176.505 | 0.991 | 0.408 | 2.592 | 99.190 | 12.479 | 4.000 |
| three-humans | proposed | 3.214 | 0.520 | 223.596 | 1.163 | 1.012 | 1.988 | 95.190 | 12.501 | 4.000 |
| two-humans | historical | 2.137 | 5.460 | 150.572 | 0.791 | 0.684 | 1.316 | 65.800 | 8.406 | 4.000 |
| two-humans | proposed | 2.943 | 0.520 | 183.074 | 0.497 | 1.395 | 0.605 | 30.270 | 8.335 | 4.000 |
| one-human | historical | 2.137 | 5.460 | 75.286 | 0.396 | 0.342 | 0.658 | 65.800 | 4.203 | 3.941 |
| one-human | proposed | 2.943 | 0.520 | 91.537 | 0.248 | 0.697 | 0.303 | 30.270 | 4.168 | 3.882 |

## Interpretación y necesidad de botiquines

- El recorrido mínimo pasa de 2,210 a 3,214 accidentes medios; sus partidas sin accidentes pasan de 5,46 % a 0,52 %. La pérdida media del grupo aumenta de 197,64 a 247,74; los evacuados medios bajan de 3,749 a 3,345. En esta referencia de cuatro humanos sigue llegando al menos uno en todas las semillas, pero eso no significa que lleguen los cuatro ni garantiza otros itinerarios o decisiones.
- En el prudente, los accidentes medios pasan de 0,594 a 1,147 y las partidas sin accidentes de 52,86 % a 27,10 %. Las lesiones siguen siendo pequeñas: ningún humano baja de 50 en estas rutas sin exposición al humo. Las oportunidades médicas aumentan de 3,326 a 5,897 por partida, y la capacidad de tratamientos de referencia de 1,655 a 2,651. Más ocasiones de curar no implican más inventario.
- Con dos rescates y ocho packs, el recorrido mínimo mantiene su viabilidad energética bajo la estrategia declarada; sus lesiones son iguales a las del mínimo sin rescates porque los rescates no añaden daño.
- En el prudente con cero packs iniciales, ni siquiera la recompensa normal del almacén basta para completar el itinerario de referencia con cuatro caminantes: las partidas quedan bloqueadas por energía en ambos modelos. No se alteran suministros para compensarlo.
- La referencia extrema con réplicas sube de 0,721 a 1,394 fallecimientos medios. La proporción con algún evacuado baja del 99,79 % al 98,63 %; los evacuados medios, de 3,279 a 2,606. Los cuatro tratamientos posibles se saturan en ambos modelos, sin simularlos.
- El ajuste es especialmente severo con grupos pequeños: con uno o dos humanos al inicio, sin curación, la proporción con evacuación baja del 65,80 % al 30,27 %. Esta caída se señala como riesgo de dificultad, sin aplicar compensaciones no autorizadas. No se han cambiado daños, recursos o reglas para suavizarla.
- Las trayectorias de riesgo alto/extremo ya saturaban la capacidad potencial de cuatro tratamientos. El aumento de probabilidad genera más lesiones y muertes, pero no aumenta los cuatro botiquines ni garantiza poder usarlos antes de un fallecimiento.

No hay datos reales de jugadores en este análisis. Las oportunidades de curación no permiten estimar cuánto subiría la supervivencia sin definir y simular explícitamente una política médica; hacerlo automáticamente ocultaría esa decisión de diseño.

## Comprobaciones manuales recomendadas

1. Cuatro sesiones: dejar vencer el primer intento de ruta en ronda 4/5 y comprobar que todavía no se aplica el daño de 10.
2. Dejar vencer el segundo: comprobar réplica única, daño propio, ruta impuesta y preparación de movimiento/transporte.
3. Recargar antes y después del segundo vencimiento: confirmar plazos, recibo de réplica, salud y costes sin duplicados.
4. Comparar Médico y otros roles: salud ajena exacta solo para Médico; ningún porcentaje interno o ruta no revelada en los eventos públicos.
5. Probar humanos con 10 o menos de salud antes de la réplica, muerte de todos, energía insuficiente y transporte requerido; sin abandonos ni gastos automáticos para desbloquear.
6. Recorrer las seis rondas y comprobar que el desenlace sigue siendo único y que las reglas particulares de otras rondas y del transporte no cambian.

## Límites y cuestiones pendientes

- Las estadísticas son referencias sin curación automática; no predicen decisiones reales del Médico ni sustituyen una prueba de juego con usuarios.
- El ajuste aumenta especialmente la mortalidad con pocos humanos; no se corrige mediante daños o recursos diferentes sin una decisión posterior.
- El transporte sin consenso conserva sus reglas actuales. No se implementan gas, tercera votación ni explosión.
- Las salas siguen en memoria: F5 conserva la partida mientras el proceso del servidor siga activo; reiniciar el proceso sigue perdiendo las salas.
- No se avanza automáticamente a otra fase. No se realizan commits ni push.

## Validación final

- **612 pruebas aprobadas en 46 archivos**: las 573 anteriores adaptadas al balance aprobado y 39 pruebas nuevas.
- `npm.cmd run typecheck`: correcto en shared, servidor y web.
- `npm.cmd run build`: correcto en los tres workspaces.
- `git diff --check`: correcto; comprobación adicional sin avisos de normalización mediante `git -c core.safecrlf=false diff --check`.
- `git diff --name-only -- docs`: vacío.
- La suite incluye las tres partidas completas de seis rondas con cuatro clientes Socket.IO de 10B.2 y dos pruebas nuevas con cuatro clientes para réplica, accidente, privacidad y recarga en rondas 4/5.
- Los umbrales históricos se comprobaron antes de modificar los catálogos y siguen cubiertos por el diagnóstico parametrizado.
- No se realizó una prueba visual manual en cuatro navegadores. Se validó renderizado React mediante las pruebas existentes y nuevas de avisos e historial.
