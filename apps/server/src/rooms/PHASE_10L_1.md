# Fase 10L.1 — Nueva partida

## Situación inicial y política aprobada

No existía reinicio: `room:start` rechazaba salas con una partida previa y no había opción de volver a jugar en los resultados. Se reutilizan el lobby, las credenciales y el inicio existentes.

El usuario aprobó que **el anfitrión actual, incluso eliminado, pueda devolver a los cuatro al lobby cuando la partida haya terminado y todos estén conectados**. No se exige unanimidad ni se añade una política de anfitrión desconectado.

## Funcionamiento

«Nueva partida» aparece en la pantalla final del anfitrión. El texto pide revisar primero el desenlace y avisa de que se borrarán juego y chat. La partida no se elimina automáticamente al terminar: conserva sus resultados y objetivos hasta la solicitud autorizada.

El servidor comprueba sesión, anfitrión, cuatro conexiones, finalización e identificadores de partida y resultado. Cancela las programaciones del juego anterior, invalida su agente, elimina el estado del juego y crea un chat vacío. Conserva sala, participantes, nombres, credenciales y anfitrión. Los cuatro reciben la transición al lobby y limpian sus proyecciones, objetivos, avisos de muerte y estado privado del sabotaje. El componente de chat se remonta para no arrastrar borrador, reintento o estado de lectura.

Desde el lobby se utiliza «Iniciar partida»: exige cuatro conectados y ejecuta el sorteo de roles existente. Puede repetirse algún rol por azar, pero no se conserva por obligación. Se crean nuevos identificadores de partida, personajes, decisiones y encuentros; salud, energía, inventario, objetivos, recibos y sabotaje parten del estado inicial existente. El adaptador se crea de nuevo por partida, reiniciando su contexto y presupuesto. Se conserva demo como predeterminado y no se han hecho llamadas reales.

El lobby queda sin mensajes anteriores. Al comenzar aparece, si corresponde, el mensaje del nuevo encuentro NPC; no se copia el historial ni se reutilizan sus identificadores. El texto determinista puede coincidir entre partidas, sin que eso represente un mensaje heredado.

Los clics repetidos sobre el mismo final son idempotentes mientras se está en el lobby. Una solicitud de una partida antigua se rechaza después de iniciar la siguiente. F5 recupera la fase actual de la sala, sin restaurar personajes o resultados viejos. Se refresca la instantánea de sala después de entrar al canal asíncrono para evitar devolver una fase anterior al reinicio.

## Archivos

Modificados:
- `packages/shared/src/index.ts`: solicitud y notificación de reinicio, errores tipados.
- `apps/server/src/rooms/manager.ts`: reinicio autorizado e idempotente, limpieza y retorno al lobby.
- `apps/server/src/rooms/socket.ts`: sincronización por sala y recuperación de estado actual.
- `apps/web/src/game-state.ts` y `game-socket.ts`: limpieza de datos y listeners de reinicio.
- `apps/web/src/Lobby.tsx`: solicitud, mensajes de error, limpieza local y remontaje del panel de chat.
- `apps/web/src/GameScreen.tsx` y `FinalResults.tsx`: control del anfitrión en la pantalla final.
- `apps/web/src/FinalResults.test.ts`: presentación, permisos y limpieza del cliente.

Creados: `restart.test.ts`, `restart.socket.test.ts` y este informe en esta carpeta.

## Verificación

- Pruebas específicas del reinicio y pantalla final: **19 aprobadas**.
- Validación general única: **978 pruebas aprobadas, cero fallos, 81 archivos**.
- TypeScript, compilación de producción y `git diff --check`: correctos.
- Cuatro clientes Socket.IO completan las seis rondas, consultan el final, vuelven al lobby e inician una segunda partida. Se comprueban recursos, roles, objetivos, sabotaje, chat, encuentros y temporizadores nuevos.
- F5 antes, durante y después del reinicio; si una desconexión momentánea impide reunir a los cuatro, se rechaza la solicitud sin borrar el final y puede reintentarse tras reconectar.
- Duplicados, peticiones antiguas, anfitrión eliminado, otro participante no autorizado, dos salas aisladas y respuesta tardía del generador descartada.
- Limpieza de listeners y borrado de todas las proyecciones privadas del cliente. No se ha hecho una revisión visual interactiva adicional en esta fase.

## Revisión manual

1. Terminar una partida con cuatro perfiles y revisar resultados y objetivos de cada sesión.
2. El anfitrión pulsa «Nueva partida»: todos deben ver el mismo lobby, sin historial anterior, con los mismos nombres y código de sala.
3. Pulsar varias veces y recargar durante la transición: debe conservarse una sola transición. Si alguien está desconectado, reconectarlo antes de reintentar.
4. Iniciar desde el anfitrión: comprobar salud/energía e inventario iniciales, roles sorteados, ronda 1 y mensaje de un nuevo NPC. Verificar que Botones puede usar una nueva manipulación y que los objetivos empiezan de cero.
5. Recargar una vez iniciada la segunda partida y revisar que recupera esa partida. Mantener otra sala abierta y comprobar que no se altera.

Sin cambios en balance, rondas, probabilidades, costes, objetivos o implementación de IA. Sin API real, dependencias nuevas, cambios en `docs/`, commit ni push. Se detiene el trabajo para revisión.
