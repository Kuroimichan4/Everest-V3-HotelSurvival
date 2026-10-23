# Motor básico — fase 2

Módulo interno, puro y sin conexión con HTTP, Socket.IO, React, Prisma o IA. No exportarlo mediante los contratos públicos: contiene roles y estado interno. No crea salas ni implementa rondas.

## Fuentes y alcance

- **REQUISITO DEL PROFESOR:** mantener estado de la partida, recursos y consecuencias; roles diferenciados y al menos cuatro fases en el producto final. El enunciado no establece los valores numéricos de este motor.
- **DECISIÓN APROBADA:** la petición de esta fase confirma cuatro roles, salud y energía iniciales de 100, muerte con salud 0, costes energéticos sin saldo negativo, ocho packs (+25 energía) y cuatro unidades médicas. Las unidades médicas solo se representan; no se implementan curaciones.
- **DECISIÓN APROBADA:** con exactamente 100 de energía no se puede consumir un pack; se rechaza sin modificar personajes ni inventario compartido.
- **PENDIENTE:** quién solicita packs y cuándo; desenlace si todos fallecen; recursos para NPC; consecuencias adicionales del agotamiento. Tampoco se implementan mecánicas posteriores descritas en la guía.

## Estado y operaciones

`state.ts` separa las definiciones de las operaciones de `operations.ts`:

- `HumanCharacter`: `id` identifica al destinatario dentro de la partida; `role` distingue su especialidad; `health` permite calcular daño y fallecimiento; `energy` permite validar y pagar costes. La vida se deriva con `isAlive`, sin duplicar un indicador que pueda contradecir la salud.
- `SharedInventory`: `packs` cuenta los packs compartidos; `medicalUnits` representa las existencias médicas, sin operaciones médicas en esta fase.
- `SimulationState`: `characters` contiene los cuatro humanos e `inventory` sus recursos compartidos. No incluye un estado de finalización porque esa regla sigue pendiente.
- `OperationResult`: `ok` discrimina éxito y rechazo; `state` contiene el estado resultante, o el mismo original si se rechaza; `error` explica el rechazo y solo existe cuando `ok` es falso.

`createInitialState()` crea objetos independientes por partida. `applyDamage()` limita la salud a cero. `spendEnergy()` valida y paga un coste, sin ejecutar efectos de una futura acción. `consumePack()` recupera energía y descuenta un pack en una única operación. Ninguna operación modifica sus entradas; todos los campos del estado son `readonly` en TypeScript.

Las operaciones reciben un estado válido creado por el módulo o producido por sus operaciones. No son validadores de JSON arbitrario ni una barrera de autorización: cuando exista persistencia o una API, habrá que validar entradas y permisos antes de invocarlas. No se exponen rutas ni eventos nuevos.

Los importes deben ser finitos y no negativos. No se impone una granularidad entera a salud y energía porque no está aprobada. Las existencias parten de enteros y solo se descuenta un pack si quedan unidades. Se puede aplicar daño a un fallecido: su salud permanece en cero; esto no constituye una acción del personaje. Un fallecido no puede pagar costes, ni siquiera cero, ni recibir packs.

Con exactamente 100 de energía se devuelve `energy-full` y el estado original, conforme a la regla aprobada. Con menos de 100, un pack recupera 25 de energía hasta un máximo de 100 y descuenta una unidad del inventario. La función tampoco decide quién solicita un pack ni en qué momento de una ronda.

## Ejemplo

```ts
const initial = createInitialState();
const result = applyDamage(initial, "maintenance", 20);
if (result.ok) {
  // result.state.characters[0].health es 80; initial conserva 100.
}
```

El consumidor debe conservar `result.state` tras cada éxito; no hay estado global. Para comprobar el módulo y la base existente, ejecutar desde la raíz `npm.cmd test`, `npm.cmd run typecheck` y `npm.cmd run build`.
