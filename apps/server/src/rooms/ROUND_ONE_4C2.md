# Fase 4C.2 — cierre de ronda 1

El callback de `RoomVoting` resuelve el resultado cerrado antes de publicar eventos.
`resolveRoundOne` compone `applyDamage` y `spendEnergy` sobre estados inmutables:
primero rescate o microterremoto, después desplazamiento. Solo se conserva el
estado final si todas las operaciones tienen éxito. No hay rutas alternativas,
votación de ruta ni llamadas al azar en la resolución.

`SimulationState.roundOne` guarda decisión, resultado, NPC, costes y finalización.
Su presencia impide repetir consecuencias, incluso con otro identificador o
resultado. El gestor valida y escribe sin `await`; se mantiene una única
instancia de partida por sala en un solo proceso. El temporizador existente
resuelve sin depender de los navegadores.

`round:completed` publica una proyección común al canal autenticado de la sala.
La reconexión recupera esa misma proyección. La relación participante-personaje
usa `characterId`, nunca el rol. Solo se publican nombre, identidad de
participante, salud y energía; las fichas siguen siendo mensajes privados.

## Pendientes y límites

- Energía insuficiente: se rechaza la resolución completa conservando el estado
  anterior. No se consumen packs automáticamente ni se permite energía negativa.
  Falta aprobar cómo continuar en ese caso antes de habilitar consumos previos.
  En el flujo actual todos comienzan con 100 y este caso no es alcanzable.
- La persistencia sigue siendo en memoria: F5 y reconexión conservan la partida,
  reiniciar el servidor la pierde. No hay garantía distribuida entre procesos.
- No se inicia ronda 2. Su transición, reglas pendientes de agotamiento y
  funcionalidades posteriores requieren una fase aprobada.

## Comprobación manual

Arrancar `npm.cmd run dev:server` y `npm.cmd run dev:web`. Abrir cuatro sesiones
independientes en `http://localhost:5173`, crear sala, unirse e iniciar.

1. Tres votos RESCATAR: NPC rescatado, salud 100 y energía 60 para todos.
2. En una sala nueva, tres votos ABANDONAR: NPC abandonado, salud 100 y energía
   85, sin microterremoto.
3. En otra sala nueva, dejar vencer ambos intentos (60 y 30 segundos), o votar
   2/2 en ambos: NPC abandonado, salud 90 y energía 85, con microterremoto.

En los tres casos quedan 8 packs y 4 unidades médicas. Comparar las cuatro
pantallas, abrir la ficha propia y recargar: debe recuperarse el mismo resumen.
Si la conexión anterior aún está activa, esperar su desconexión y pulsar
Reintentar reconexión. Para una nueva sala usar sesiones nuevas o, tras
desconectar, olvidar las credenciales locales; no hay botón para reiniciar ronda.

Las pruebas de red usan sockets reales y reloj controlado; simulan recarga
mediante desconexión y autenticación de un socket nuevo. No sustituyen una
comprobación visual manual en cuatro navegadores.
