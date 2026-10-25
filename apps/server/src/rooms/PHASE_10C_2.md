# Fase 10C.2 — Informe

## Archivos de esta intervención

Producción: apps/server/src/simulation/routes.ts y balance-analysis.ts; apps/server/src/rooms/privacy.ts, manager.ts y character-sheets.ts; apps/web/src/RouteInformation.tsx, GameScreen.tsx y styles.css.

Creados: simulation/three-victim-accidents.test.ts, rooms/structural-visibility.test.ts, web/src/structural-report-ui.test.ts, scripts/analyze-accident-victims.mjs, scripts/ui-check-10c2.mjs, este informe y simulation/PHASE_10C_2_BALANCE.md.

Pruebas existentes adaptadas sin eliminar casos: simulación accident-audit, accumulated-damage, intermediate-consensus, intermediate-rounds, round-two-movement, routes, transport, round-three, round-three-routes y round-four; salas intermediate-consensus.socket, round-four, six-round, transport-crisis, transport, voting, round-four.socket y role-interface.socket; web role-interface. Todos los nombres corresponden a archivos .test.ts.

Se conservan los cambios previos del repositorio; esta lista describe la intervención actual, no todo el estado pendiente de git.

## Comportamiento

El motor común selecciona min(3, humanos vivos y no abandonados al inicio), mediante RNG y extracción sin reemplazo. Incluye transportados. La validación anterior a la aplicación conserva atomicidad ante RNG inválido. Rondas 2–6 comparten el cambio; no se añade accidente a ronda 1. Probabilidades, daño individual, costes y recompensas permanecen iguales.

Daños ambientales, réplicas, gas y explosión siguen afectando a todos los destinatarios correspondientes, independientemente de las tres víctimas. Se conserva su acumulación, salud no negativa, muertes, electorado, finalización y mensajes personales sin revelar sabotaje.

El servidor registra aperturas de votaciones de rutas por ronda y decisión; votaciones NPC no conceden permiso. El proyector elimina categorías salvo para Arquitecto activo y ronda autorizada. Las probabilidades exactas siguen filtradas. Los permisos sobreviven reintentos y F5 dentro de la partida activa del servidor, sin desbloquear rondas futuras. No se añade persistencia tras reiniciar el servidor.

Mantenimiento conserva el conocimiento exclusivo de rutas secretas hasta revelarlas. Revelar no habilita anticipadamente el riesgo: el Arquitecto necesita también la apertura correspondiente. Se conservan las ventanas de revelación y el objetivo individual. El informe autorizado se destaca en las tarjetas existentes; preparación muestra un aviso sin categorías.

## Pruebas y balance

Vitest: 814 pruebas aprobadas en 68 archivos. TypeScript y compilación de producción correctos. Revisión mediante git diff --check. Cobertura nueva de selección 0–4, exclusiones, transporte, RNG, atomicidad, probabilidades, daños acumulados, fallecimientos, DTO por rol, rondas independientes, F5 y cuatro clientes Socket.IO. Se mantienen las pruebas de sucesión por explosión y sabotaje.

Comprobación automatizada con Edge sin interfaz: preparación Arquitecto, votación Arquitecto y votación Médico a 1440, 900, 390 y 320 px. Las 12 combinaciones pasan las mediciones sin desbordamiento horizontal ni acciones duplicadas; informes 0/3/0 y temporizador solamente en votación. Capturas y mediciones en .cache/10c2. No sustituye una partida interactiva multicliente.

El informe PHASE_10C_2_BALANCE.md documenta 180.000 recorridos con semillas controladas y supuestos explícitos. Mínimo gasto con cuatro humanos pasa de 3,345 a 2,276 evacuados medios; el prudente mantiene cuatro bajo esos supuestos. Grupos de dos o uno no cambian entre límites. No se reajusta ningún parámetro.

## Revisión manual con cuatro navegadores

1. Entrar con los cuatro roles. En preparación de ronda 2 comprobar nombres, descripciones y energía sin categorías ni porcentajes en pantalla ni mensajes de red.
2. Solo Mantenimiento conoce Conductos de ventilación. Revelarla antes de abrir votación y comprobar que todavía no se envía riesgo al Arquitecto.
3. Abrir votación: solo Arquitecto recibe categorías resaltadas. Recargar las cuatro sesiones y verificar permisos y mismo plazo; repetir tras intento fallido.
4. Avanzar por rondas 3–6: el permiso anterior no anticipa informes nuevos. La votación NPC de ronda 6 no los desbloquea.
5. Revisar móvil, escritorio y texto ampliado; observar accidentes, transportados, daño ambiental general, historial, resultados y mensaje personal de fallecimiento sin revelar sabotaje.

## Límites y contradicciones pendientes

El relevo vigente se conserva para explosión y sabotaje médico. Una muerte del anfitrión por accidente ordinario puede dejar sin controles de avance a un superviviente: no se ha inventado una regla nueva de sucesión. Se conserva también la exigencia previa de especialistas vivos en apuntalamiento en situaciones de transporte.

El análisis no ejecuta curaciones, sabotaje ni transporte automático. Los bloqueos energéticos de algunos recorridos no significan muerte ni imposibilidad de otras decisiones. Las oportunidades médicas son ventanas potenciales, no tratamientos efectuados.

No se modifica docs/, no se añaden dependencias y no se hace commit, push ni avance de fase.