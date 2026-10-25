# Fase 9C — cierre y resultados sin puntuación

## Estado y precedencia

`simulation/final-result.ts` proyecta los datos existentes sin ejecutar movimientos
ni repetir consecuencias. Las situaciones son excluyentes:

1. Sin humanos activos (`isAlive` excluye fallecidos y eliminados):
   `no-active-humans`, incluso si acaba de resolverse un accidente final fatal.
2. Con humanos activos y desplazamiento de ronda 4 completado:
   `evacuation-completed`.
3. En cualquier otro caso: `pending`, sin resolución final. El motivo de bloqueo,
   decisión aprobada, transporte y recursos siguen en los estados de ronda existentes.

No se infiere una derrota ni una victoria. Si el movimiento final se resolvió pero
todos fallecieron, se conserva ese movimiento y su accidente dentro del cierre
por ausencia de humanos activos. No se inventan supervivientes.

El gestor guarda una única resolución, identificador y fecha de servidor, además
de las evidencias privadas por participante. Las publicaciones de cambios comprueban
el cierre después de la transacción y antes de emitir el estado. Se detienen los
temporizadores. La consulta devuelve copias y la reconexión reutiliza el resultado.
La persistencia sigue limitada a la vida del proceso servidor.

## Humanos y NPC

El estado humano se obtiene de eliminación definitiva, salud y lista de evacuados
registrada por el motor, en ese orden. El resultado público incluye los cuatro
nombres y roles, salud y energía finales. No incluye fichas, objetivos ni conocimientos.
No se recuperan objetos ni suministros por finalizar.

Hay una entrada por encuentro NPC de rondas 1, 2 y 4. Se diferencia no alcanzado,
ausente, pendiente, aprobado sin completar, rescate completado, abandonado y muerto.
Los conteos se hacen sobre esas tres entradas, nunca sumando eventos repetidos.

Los rescates completados de rondas 1/2 son hechos históricos. El motor no registra
por separado su llegada a la calle ni un fallecimiento posterior: `evacuated: null`.
No se convierten en fallecidos si muere el grupo ni se presentan como evacuados
confirmados. El NPC de ronda 4 solo se registra rescatado/evacuado después de la
transacción 9A, no al aprobar el rescate. Su muerte por inacción no consume recursos.

Por eso se muestran dos conceptos: NPC con rescate completado históricamente y NPC
con evacuación confirmada. No se mezclan para deducir una puntuación.

## Objetivos y privacidad

Se reutiliza el texto del catálogo de fichas vigente. Las evidencias siempre conservan
`evaluation: pending-evaluation`; `evidenceState` solo describe si existen hechos
confirmados para revisar, nunca un objetivo ganado o una puntuación.

- Mantenimiento: revelar o recorrer rutas no demuestra apertura ni autoría.
  Falta un registro específico de aperturas; no se sustituye por un contador de rutas usadas.
- Médico: pacientes únicos a partir de tratamientos históricos, con evacuación o
  fallecimiento confirmado. La supervivencia posterior de abandonados es desconocida.
  Sin pacientes se mantiene pendiente, sin cumplimiento vacuo.
- Arquitecto/Ingeniero: travesías registradas por galería o grieta aportan hechos
  de exposición extrema. No se publican peligros ocultos, incluido ventilación.
  La ausencia de esos hechos no adjudica automáticamente el objetivo.
- Botones: se guardan rescates completados y evacuaciones confirmadas por separado.
  La ficha vigente habla de supervivencia de huéspedes, mientras que la petición 9C
  formula el objetivo como rescatar al menos dos; esa diferencia queda para la revisión
  de evaluación. No se cambia el catálogo ni se decide una equivalencia en esta fase.

`game:finished` se emite a la sala y `game:objective` solo al socket destinatario
autenticado. Se conserva la restricción actual: un fallecido/eliminado recibe el
resultado público, pero no recupera ficha ni evidencias individuales privadas.
La web verifica también destinatario e identificador del resultado.

## Cierre de acciones

Tras guardar el cierre, no se admiten nuevos votos, desplazamientos, aperturas de
transporte ni consumos. Los suministros tienen ventana cerrada. Las repeticiones
de recibos ya confirmados conservan sus respuestas idempotentes, sin otro gasto;
algunas acciones de ronda 4 ya cerradas también se reconocen como recibidas, sin
ejecutar nada. No se reabre una fase por reconexión. No hay reinicio público añadido.

## Interfaz

`FinalResults.tsx` reutiliza paneles, tarjetas y estilos existentes. `GameScreen`
elige una sola pantalla final con prioridad sobre todos los estados de rondas.
No monta botones, paneles de recursos ni votaciones activos. Incluye desenlace,
cuatro humanos, encuentros NPC, última salida/accidente, recursos, decisiones
relevantes y evidencias propias. El historial existente sigue plegado y de solo lectura.
Las instantáneas repetidas sustituyen estado sin acumular resultados.

## Archivos

Nuevos: `simulation/final-result.ts`, `simulation/final-result.test.ts`,
`rooms/game-final.socket.test.ts`, `web/src/FinalResults.tsx`,
`web/src/FinalResults.test.ts` y este documento.

Modificados: `rooms/manager.ts`, `rooms/socket.ts`, `rooms/round-four.test.ts`,
`packages/shared/src/index.ts`, `web/src/game-state.ts`, `web/src/game-socket.ts`
y `web/src/GameScreen.tsx`. Se preservan las correcciones 9B sin confirmar existentes.
La prueba previa de muerte total ahora comprueba el cierre descriptivo y la ausencia
de voto activo, en lugar de conservar solo una votación cerrada.

## Escenarios deterministas, sin alterar la partida normal

Desde la raíz, con el Node de `.tools` disponible en PATH:

```powershell
npx.cmd vitest run apps/server/src/rooms/game-final.socket.test.ts
npx.cmd vitest run apps/server/src/simulation/final-result.test.ts apps/web/src/FinalResults.test.ts
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
git -c core.safecrlf=false diff --check
```

La integración usa la fuente aleatoria inyectada de `RoomManager`, exclusivamente
desde Vitest: 0 genera ausencia, 0,6 caminante asistido y 0,9 inmóvil. Cuatro clientes
reales Socket.IO recorren las rondas previas, distribuyen packs mediante Botones,
acuerdan asistencia/transporte si corresponde y evacuan por grieta. Comprueban un
resultado común por cliente, datos privados por destinatario, aislamiento de otra
sala, cierre de acciones y reconexión sin nuevas tiradas. El rescate médico y las
probabilidades siguen cubiertos por las pruebas anteriores y las pruebas puras.
No hay botón, endpoint, variable pública ni parámetro de cliente para forzar el azar.

Las pruebas puras cubren además abandono y fallecimiento humano, muerte por accidente
final, rescate pendiente bloqueado, NPC ausente/abandonado/fallecido/rescatado,
recuentos y evidencias suficientes o insuficientes. El renderizado verifica cuatro
tarjetas, privacidad, ausencia de acciones y resultado/historial únicos. Los resultados
reales de todos los comandos se indican en el informe de sesión.

## Revisión manual

Arrancar `npm.cmd run dev:server` y `npm.cmd run dev:web`. Jugar en cuatro perfiles
independientes, completar ronda 3 y preparar energía suficiente con packs. En ronda 4,
resolver el NPC si aparece, abrir la salida y alcanzar mayoría. Debe aparecer
«Fin de la simulación» en los cuatro perfiles. Revisar tarjetas, recursos, NPC,
objetivo propio e historial plegado; recargar para comprobar que se conservan.
Los controles de juego ya no deben mostrarse. Con una muerte, comparar estado
fallecido y acceso privado restringido, sin considerarlo evacuado.

Para reproducir los tres encuentros sin repetir manualmente partidas, ejecutar el
test Socket.IO anterior. Una revisión visual real en navegadores no queda sustituida
por ese test ni por el renderizado estático.

No se avanza al sistema de puntuaciones, rankings ni evaluación definitiva.
