# Fase 10H.1 — Auditoría de objetivos y resultados finales

## Alcance y conclusión

Se ha revisado el evaluador único existente, sus recibos, la coordinación de las seis rondas, finales anticipados, relevo del anfitrión, proyecciones públicas y privadas, Socket.IO y pantalla final. Se conservan todos los cambios válidos anteriores. No se introduce un evaluador paralelo ni puntuaciones.

Ya funcionaban correctamente:

- Mantenimiento registra autor, ronda y momento de revelación. Deduplica por ruta y no exige recorrerla. Las acciones de rondas 2, 4 y 5 aportan evidencia; conocer una ruta o recorrerla no sustituye revelarla.
- Médico registra humanos tratados y deduplica pacientes y tratamientos de la misma ronda. Usa recibos autenticados para atribuir al administrador. Cualquier muerte posterior, incluida la muerte misteriosa, impide cumplir; no necesita conocer su causa. El esfuerzo de rescate de un NPC no crea un paciente humano.
- Arquitecto solo recibe evidencia de desplazamientos completados. Elegir, votar, revelar o bloquear una ruta no constituye un recorrido. Un recorrido forzado sí cuenta una vez ejecutado.
- Botones usa la víctima humana registrada por el sabotaje consumado. Manipular, fallar una tirada, rescatar NPC o causar una muerte ajena al sabotaje no concede cumplimiento. El antiguo objetivo de salvar huéspedes ya no interviene en el evaluador activo. Se mantienen el 25 % y una manipulación por partida.
- El resultado colectivo distingue rescate aprobado de ejecutado, humanos evacuados/fallecidos/abandonados y rescates históricos de evacuaciones NPC. Los acompañantes de rondas anteriores se contabilizan como evacuados al completarse la salida conforme al modelo existente.
- La finalización es idempotente y guarda evidencias privadas. El relevo 10G no cambia roles ni atribuciones de tratamientos o revelaciones. Se mantienen las restricciones de acceso de personajes eliminados y la excepción privada existente de Botones.

## Inconsistencias corregidas

1. Arquitecto nunca podía acreditar un itinerario completo sin EXTREMO: la evaluación exigía categoría no nula también a ronda 1, que carece de clasificación. Ahora se comprueban las categorías de las rondas clasificadas, sin asignar riesgo nuevo a ronda 1. El cumplimiento confirmado ya no presenta una advertencia de falta de categoría de esa ronda.
2. El resumen del último movimiento solo consideraba la salida o un movimiento intermedio de la ronda actual. Podía omitir los recorridos de rondas 1–3 o el último recorrido previo tras un avance precipitado. Ahora busca el último desplazamiento realmente completado; no crea recorridos de sectores evacuados extraordinariamente ni de rutas seleccionadas sin ejecución. La ronda 2 también aparece en las decisiones finales con su nombre visible.
3. La pantalla decía que no había evaluación definitiva de objetivos incluso cuando mostraba cumplido o incumplido. Se corrige ese texto y se utiliza «Última ruta recorrida» para abarcar también finales anticipados.

## Archivos de esta intervención

Modificados:

- `apps/server/src/simulation/objective-evidence.ts`: corrección del requisito de clasificación y explicación privada del Arquitecto.
- `apps/server/src/simulation/final-result.ts`: último recorrido real y texto de ruta de ronda 2.
- `apps/web/src/FinalResults.tsx`: dos correcciones de texto, sin rediseño.
- `apps/server/src/rooms/game-final.socket.test.ts`: ampliación de las tres variantes existentes con revelaciones reales de rondas 2/4/5, repeticiones, rutas no seleccionadas, Arquitecto cumplido/incumplido, reconexión antes del final y privacidad.
- `apps/web/src/FinalResults.test.ts`: comprobación de textos coherentes en los tres estados del objetivo.

Creados:

- `apps/server/src/simulation/objective-audit.test.ts`: 25 casos adicionales.
- Este informe.

## Evaluación de cada objetivo

| Rol | Cumplido | Incumplido | Pendiente conservado |
|---|---|---|---|
| Mantenimiento | Al menos dos rutas distintas con revelación efectiva y autoría verificable | No se introduce un nuevo estado de fallo | Menos de dos revelaciones verificadas |
| Médico | Tiene pacientes humanos atribuidos, sin lagunas de atribución y todos evacuados | Algún paciente propio falleció después del tratamiento | Sin pacientes; recibos sin atribución; supervivencia de paciente abandonado no confirmada |
| Arquitecto | Itinerario completo de seis rondas, categorías registradas donde existen y ningún EXTREMO recorrido | Cualquier EXTREMO efectivamente recorrido, voluntario o forzado | Itinerario incompleto sin EXTREMO o categoría ausente donde debería existir |
| Botones | Víctima humana atribuida al sabotaje de ese participante | No consta tal víctima, haya manipulación o no | No se añade un estado nuevo |

Se conservan estos estados pendientes en lugar de inventar éxitos, fallos o reglas para supervivencia fuera del edificio no registrada. La ausencia de clasificación en ronda 1 no se convierte en BAJO ni en otra categoría.

## Resultado colectivo y excepciones

Los humanos se clasifican usando su estado confirmado y los identificadores que completaron la evacuación; el abandono definitivo se conserva separado del fallecimiento. Los contadores se derivan de esas categorías sin restaurar recursos. La ausencia de humanos activos termina la partida incluso antes de ronda 6. Si el último accidente mata a todos, prevalece ese final sobre el simple hecho de haberse completado el desplazamiento.

Los NPC se cuentan por encuentro, una sola vez. Una ayuda aprobada sin esfuerzo confirmado conserva `approved`, sin sumarse a rescates ni a evacuados. Los rescates ejecutados permanecen en el recuento histórico; sus evacuaciones solo se acreditan conforme a los recibos de salida del modelo vigente. Un final anticipado no inventa la muerte ni la evacuación de acompañantes cuyo desenlace no consta. El esfuerzo médico del NPC final permanece separado de tratamientos humanos.

Las explosiones y avances extraordinarios conservan sus recibos específicos y no crean un recorrido ordinario. La eliminación del anfitrión mantiene el relevo centralizado de 10G; no reinicia ni altera los objetivos. El sabotaje durante ronda 6 queda reflejado en la evidencia de Médico y Botones antes de cerrar el resultado.

## Privacidad y reconexión

El registro interno completo no se envía a la sala. Cada objetivo se emite a su sesión autenticada. El resultado público no incluye el objetivo ni la causalidad secreta del sabotaje. El Médico conoce el desenlace del paciente, no el secreto de Botones. Se conserva la proyección de salud/energía por rol y la restricción temporal de riesgos de 10C.2.

La reconexión recupera el resultado y la evidencia guardados, sin resolver efectos ni volver a tirar azar. La pantalla descarta objetivos de otro participante o de otro resultado. Los personajes fallecidos o abandonados mantienen las restricciones de lectura existentes; esta auditoría no amplía privilegios de espectador.

## Validación

- Vitest completo: **854 pruebas aprobadas, cero fallos, 71 archivos** (25 casos nuevos respecto a 10G; sin eliminar pruebas anteriores).
- TypeScript: correcto.
- Compilación de producción: correcta.
- `git diff --check`: correcto.
- Tres variantes de integración final con cuatro clientes Socket.IO reales: NPC ausente, asistido y transportado; todas pasan. Incluyen reconexión antes y después del final, evidencia inmutable, privacidad y aislamiento de otra sala.
- Nuevas pruebas puras: dos/tres revelaciones, duplicado, rutas no recorridas; pacientes supervivientes, fallecidos, abandonados y muerte misteriosa; EXTREMO completado, forzado y no ejecutado; sabotaje final exitoso/fallido/no activado; NPC aprobado sin ejecución; acompañantes evacuados; finales anticipados de rondas 1–5 y sector saltado.
- Las pruebas de paciente representan algunas muertes posteriores mediante la operación común de daño; las suites existentes de accidentes, consenso, crisis de transporte y sabotaje verifican las causas y coordinación reales.
- Pruebas de renderizado React para estados cumplido/incumplido/pendiente y privacidad. No se ha realizado una revisión visual interactiva de navegadores en esta fase.

## Revisión manual de los cuatro roles

1. Entrar con cuatro perfiles separados y anotar roles y objetivos privados. Revelar ventilación en ronda 2 y otra alternativa en ronda 4 o 5; elegir otras rutas públicas. Mantenimiento debe mostrar dos revelaciones distintas y objetivo cumplido. Repetir una revelación no debe aumentar el número.
2. Con Médico, tratar un humano y completar una evacuación donde sobreviva. Repetir en otra partida con muerte posterior del paciente. Comprobar cumplido/incumplido; sin pacientes debe seguir pendiente. Una muerte misteriosa no debe revelar el sabotaje al Médico.
3. Completar con Arquitecto un recorrido sin EXTREMO y comprobar cumplido; repetir atravesando una ruta EXTREMO y comprobar incumplido. Una mera votación o desplazamiento bloqueado no debe generar evidencia de recorrido.
4. Con Botones, verificar que manipular sin víctima no cumple y que una muerte humana por el sabotaje sí cumple. El desenlace de los otros roles y el resultado colectivo deben conservar lenguaje incierto respecto a esa causa.
5. Aprobar un rescate NPC sin llegar a ejecutar el esfuerzo: no debe sumar rescate. Completar otra partida con acompañantes de rondas anteriores y comprobar rescates históricos y evacuaciones confirmadas por separado.
6. Revisar un final anticipado y una eliminación del anfitrión con continuidad. El resumen debe mostrar el último recorrido ejecutado, sin inventar salida o etapas. Recargar antes y después del final y comprobar mismos resultados y evidencia propia en las cuatro sesiones.

## Decisiones pendientes para futuras puntuaciones

No se han definido pesos, puntos, penalizaciones, desempates ni relación entre resultado colectivo y objetivo privado. Tampoco se convierten los estados pendientes existentes en valores numéricos. Antes de puntuar conviene decidir cómo tratar objetivos incompletos en finales anticipados, pacientes abandonados sin supervivencia confirmada y registros históricos sin atribución. Estas decisiones quedan fuera de esta fase; los hechos y estados actuales se conservan explícitos.

Sin cambios en documentos originales de `docs/`, mecánicas, habilidades, probabilidades, energía, votaciones o dependencias. Sin commit ni push. Se detiene el trabajo para revisión.
