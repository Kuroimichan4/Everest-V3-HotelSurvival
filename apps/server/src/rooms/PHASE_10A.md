# Fase 10A

La simulación sigue terminando en ronda 4. No hay rondas 5/6 jugables ni nuevas
rutas, fuga de gas, explosión, puntuación o probabilidades modificadas.

## Archivos de esta intervención

- Nuevos: `rooms/privacy.ts`, `rooms/privacy.test.ts` y esta guía.
- Servidor: `rooms/manager.ts`, `rooms/socket.ts`, `rooms/character-sheets.ts`,
  `rooms/transport.ts`, `simulation/state.ts`, `simulation/objective-evidence.ts`,
  `simulation/final-result.ts`, `voting/engine.ts` y `voting/types.ts`.
- Contratos: `packages/shared/src/index.ts` (campos privados opcionales y estado
  colectivo sin cifras).
- React: `GameScreen.tsx`, `Medical.tsx`, `Supplies.tsx`, `Transport.tsx`,
  `RoundTwo.tsx`, `RoundFour.tsx`, `VotePanel.tsx`, `FinalResults.tsx`,
  `game-state.ts` y `game-history.ts`.
- Pruebas adaptadas/ampliadas: fichas, motor, privacidad, disponibilidad de rutas,
  packs, médico, transporte, rondas 2/3/4, Socket.IO, evidencias, resultado final y
  representación de React. Se conservan los casos previos, actualizando el orden
  de preparación y las expectativas de cifras por destinatario.
- Documentación de implementación actualizada: `voting/README.md` y
  `rooms/ROUND_THREE_7B.md`. No se modificaron los originales de `docs/`.

Los archivos de finalización y evidencias ya estaban presentes como cambios sin
commit de fases anteriores; esta intervención los conserva y adapta. Tampoco se
han descartado los demás cambios previos del repositorio.

## Revelaciones

`SimulationState.routeRevelations` conserva ruta, ronda, identificador interno del
personaje autor, privacidad inicial y tiempo del servidor. La acción autenticada
de Mantenimiento registra ventilación de ronda 2 antes de publicar su existencia.
Repetirla o reconectar no añade evidencias. Las rutas públicas, conocer una ruta,
votarla o recorrerla no cuentan como revelación. El objetivo exige dos rutas
distintas con evidencia completa; no exige abrirlas ni recorrerlas.

Solo existe una oportunidad actual. Los registros admiten rondas futuras, pero
no se han creado sus rutas ni evidencias. Los registros antiguos sin autor o
momento verificable se conservan como incompletos y no acreditan el objetivo.

## Privacidad

Los modelos de simulación y las vistas internas de `RoomManager` mantienen sus
valores completos. Toda emisión de estado de juego en Socket.IO, tanto pública
como de recuperación, pasa por una proyección por sesión autenticada. No existe
un DTO único compartido con las mismas barras para toda la sala.

Cada jugador recibe su salud y energía. El Médico activo recibe además la salud
ajena, nunca la energía. La proyección elimina también los deltas individuales
de energía, gastos, daños y curaciones no autorizadas en objetos anidados,
historiales y resultados. Los estados activo/fallecido/abandonado, las identidades,
los necesitados de transporte, la elegibilidad por alternativa y los costes
generales siguen disponibles. React admite campos privados ausentes y no dibuja
barras ni cifras ficticias. Las fichas y los objetivos siguen siendo personales.

## Votos y ronda 2

Cada intento mantiene un voto por participante. Cambiarlo sustituye su opción;
repetirla no aumenta el recuento. Se conservan los plazos 60/30 y la mayoría
inmediata, así como la política y autorización por alternativa del transporte.
Una decisión cerrada rechaza cambios. F5 recupera la opción vigente.

El orden de ronda 2 es preparación de ruta → votación de ruta → encuentro NPC
garantizado → decisión NPC → preparación de desplazamiento → movimiento.
Durante la preparación inicial no hay votación NPC abierta. Las rutas se congelan
al abrir la votación; el anfitrión sigue iniciándola mediante la política
provisional existente. La falta de acuerdo de ruta conserva su selección forzada
y sus consecuencias existentes al ejecutar el desplazamiento.

Tras el NPC se ofrece siempre una preparación explícita, aunque no haya agotados.
Pueden usarse packs/tratamientos autorizados. «Comprobar energía y continuar»
revisa el estado: ejecuta el movimiento si nadie precisa transporte o abre la
decisión correspondiente. No se mueve al cerrar el voto de ruta o de NPC.
Si falta energía para pagar el rescate, su decisión permanece cerrada y pendiente;
los packs y el reintento aplican el rescate una sola vez. La recuperación de una
selección de ruta obsoleta conserva el NPC resuelto y no repite sus gastos.

Los NPC rescatados en rondas 1/2 se consideran evacuados al completar la salida,
si no consta muerte. La ronda 4 conserva sus reglas propias y sigue cerrando la
simulación. F5 conserva el estado mientras viva el proceso del servidor; no se ha
añadido persistencia en base de datos.

## Comprobación con cuatro navegadores

1. Crear una sala y entrar con cuatro sesiones. Comprobar los eventos en las
   herramientas de red: cada sesión recibe una sola energía exacta; solo Médico
   recibe cuatro saludes. Verificar tarjetas, historial y pantalla final.
2. Con dos votos de rescate y uno de abandono, cambiar uno de rescate a abandono.
   Debe continuar abierta, sin mayoría falsa. Recargar ese navegador: conserva
   abandono y el plazo. Cambiar el segundo voto de rescate a abandono cierra de
   inmediato. Un cambio posterior se rechaza.
3. Entrar en ronda 2: aparecen rutas, sin NPC. Revelar ventilación desde
   Mantenimiento; los cuatro la ven, sin peligro real ni probabilidad. Repetir y
   recargar no crea otro registro. Abrir la ruta y acordarla.
4. Aparece el NPC con sus dos intentos. Resolverlo y comprobar que aún no hay
   movimiento. Usar recursos y recargar: el rescate, su coste y la selección
   continúan registrados una sola vez. Continuar desde la preparación.
5. Completar las rondas 3/4 y revisar el final. Cada navegador conserva solo sus
   cifras autorizadas y su objetivo. Repetir con otra sala para comprobar aislamiento.

## Pendiente

La fase 10B deberá integrar las nuevas rondas y sus catálogos, las oportunidades
secretas de Mantenimiento y la migración del cierre final. Siguen pendientes las
reglas anteriores sobre pérdida de especialistas y los demás casos no definidos;
esta fase no los resuelve por inferencia. No se ha realizado prueba manual en
cuatro navegadores: las pruebas de integración utilizan cuatro clientes Socket.IO
reales, además de verificar el HTML renderizado.
