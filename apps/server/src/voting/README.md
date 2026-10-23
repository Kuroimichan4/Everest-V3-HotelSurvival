# Motor de votaciones — fase 4B

Motor interno puro sin React, Socket.IO, Fastify, Prisma ni temporizadores. No ejecuta consecuencias. `types.ts` define decisión, opciones, electorado, votos, política, intentos y resultados; `engine.ts` implementa las operaciones; `engine.test.ts` comprueba las reglas con tiempo simulado.

Una `Decision` conserva opciones y un historial de `VotingAttempt`. Cada intento tiene identificador único dentro de esa decisión, copia del electorado, umbral, votos, instante de apertura y plazo absoluto en milisegundos. `GENERAL_POLICY` establece 60 000 y 30 000 ms; la política separa duraciones y criterio de mayoría para futuras ampliaciones. Solo se implementa mayoría estricta de vivos: `floor(vivos / 2) + 1`. Cero vivos es un electorado inválido, sin inventar el desenlace de la partida. La conexión no forma parte del cálculo.

`castVote` valida intento, apertura, tiempo, identidad, vida y opción. En el instante del plazo ya no admite votos, aunque aún no se haya llamado a `checkDeadline`. Cuenta cada opción por separado; al alcanzar el umbral cierra tanto intento como decisión y devuelve `approved` con su opción. Aprobar abandonar es una decisión válida. Una decisión cerrada no cambia de resultado.

`checkDeadline` antes del plazo no cambia nada. Al vencer registra `no-majority` en el intento, con el plazo como instante efectivo de cierre. La decisión pasa a `awaiting-retry` si queda otro intento o a `closed` con `no-agreement` si se agotaron. `openNextAttempt` abre explícitamente el siguiente intento con otro identificador, votos vacíos y 30 segundos desde su apertura real; conserva el historial. Esto permite que la futura capa de aplicación gestione los efectos entre intentos sin implementarlos aquí.

Todas las operaciones devuelven un nuevo estado cuando hay cambios; los rechazos devuelven la referencia original. Los reenvíos idénticos durante un intento abierto son idempotentes. Un reenvío tras cierre o plazo se rechaza.

## Pendientes y límites provisionales

- Cambiar de voto: política de producto PENDIENTE; provisionalmente se devuelve `vote-change-pending`, sin sustituir el voto registrado.
- Fallecimiento durante un intento y recálculo del electorado: PENDIENTES. La API trabaja únicamente con una instantánea estable; tampoco actualiza vivos entre intentos. No usarla con cambios de vida hasta definir esa integración.
- Visibilidad de votos individuales: PENDIENTE. Este estado es interno y no debe emitirse directamente a clientes.
- Electorados especiales, votaciones médicas y reglas de ronda 4: no implementados. Sus futuras políticas y consecuencias deberán definirse antes de extender el motor.

## Ejemplo e integración futura

Crear `rescue-r1`, opciones `rescue`/`abandon`, cuatro participantes vivos, intento `a1` y tiempo 1000 produce un plazo 61000 y umbral 3. Los votos `rescue` de tres participantes cierran inmediatamente con `{ kind: "approved", optionId: "rescue" }`; el cuarto ya no vota.

La futura capa Socket.IO deberá resolver la identidad desde la conexión autenticada, elegir opciones y electorado desde el estado autoritativo, generar identificadores, inyectar el reloj del servidor y serializar las actualizaciones por decisión. Un planificador del servidor llamará a `checkDeadline` y guardará su resultado; después abrirá el segundo intento cuando corresponda. Debe descartar cualquier plazo o identidad elegidos por el cliente y diseñar una proyección pública según la política de privacidad pendiente. La ronda 1 consumirá `approved` o `no-agreement` para aplicar rescate, abandono o consecuencias aprobadas. Nada de esa integración se implementa en esta fase.

Verificación desde la raíz: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`.
