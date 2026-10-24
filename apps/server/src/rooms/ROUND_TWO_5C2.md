# Fase 5C.2: resolución del desplazamiento y resumen de ronda 2

Esta fase sustituye la parada posterior a la elección descrita en 5C.1. Conserva
su preparación, revelación autenticada y apertura provisional por el creador.
No modifica los documentos originales de docs/, la ronda 1 ni el motor de rutas.

## Conexión y transacción

El cierre del RoomVoting de rutas conserva primero su resultado. El gestor llama
a `resolveRoundTwoMovement` con esa decisión y con la revelación almacenada en
el servidor. No hay un evento del cliente para elegir el resultado del accidente,
forzar una ruta o repetir el desplazamiento.

El coordinador exige un rescate resuelto y rechaza ventilación sin revelar.
Para una ruta aprobada llama a `traverseRoute` directamente. Para NO_AGREEMENT,
aplica provisionalmente −10 de salud a cada humano vivo mediante `applyDamage`
y después atraviesa obligatoriamente el pasillo principal. El motor de rutas
existente paga energía con `spendEnergy`, usa una muestra para decidir accidente
y, solo si ocurre, otras dos para elegir víctimas vivas sin repetición. No hay
otra tirada de accidente ni un coste energético adicional por desacuerdo.

Los costes y daños del resumen se obtienen de las diferencias de estado; no se
duplica el catálogo. El rescate y sus consecuencias permanecen separados: sus
microterremotos pueden acumularse con el de la votación de ruta.

El estado final solo se confirma si toda la operación termina correctamente.
Un rechazo devuelve el estado original por referencia: no se confirman ni el
microterremoto de ruta, ni pagos, ni daño de accidente. Los efectos del rescate
ya confirmado se conservan. El gestor guarda únicamente el motivo de bloqueo
y la decisión, y publica `movement-blocked`, nunca `completed`.

## Resolución única y privacidad

`roundTwo.movement` registra `completed` con decisión, ruta, coste, accidente,
víctimas y daños, o `blocked` con su motivo. Se escribe sin operaciones asíncronas
intermedias. Si existe ese registro no se vuelve a ejecutar la operación.
Votar, abrir de nuevo, recuperar sesión o vencer otros temporizadores no repite
efectos ni muestras, incluso después de un bloqueo que consumiera azar.
La política de recuperación de un bloqueo queda pendiente; no hay reintento
automático que pueda cambiar el accidente.

RoomManager recibe una fuente aleatoria inyectable como tercer argumento; en
ejecución normal utiliza Math.random del servidor. Las pruebas inyectan muestras
conocidas. No se acepta fuente, semilla ni secuencia desde el navegador.

El DTO de movimiento se construye campo a campo y traduce identificadores internos
de víctimas a participantes y nombres públicos. Publica resultados observados,
nunca peligro, probabilidad o muestras. Ventilación conserva ocultos su peligro
real y probabilidad incluso después del recorrido. Las fichas siguen usando
el canal privado existente y no forman parte del resumen común.

`round-two:updated`, limitado al canal de cada sala, lleva la misma vista a los
cuatro participantes y la restaura al reanudar sesión. `RoundTwo.tsx` muestra
«Ronda 2 completada», ambos resultados, ruta usada, desplazamiento forzoso,
microterremotos separados, accidente, víctimas con daños, salud, energía,
inventario y estado de ambos NPC. React no resuelve consecuencias.
Los datos siguen en memoria: sobreviven a F5, no al reinicio del servidor.

## Casos pendientes

- Energía insuficiente: bloqueo sin pagos parciales, packs ni recuperación automática.
- Un único humano vivo, ninguno vivo o especialistas ausentes: se conservan
  los rechazos de 5A; no se declara un final ni se heredan conocimientos.
- Accidente mortal: se conserva `fatal-accident-order-pending` del motor de rutas.
- Microterremoto de ruta que causaría una muerte: bloqueo previo
  `fatal-microearthquake-order-pending` hasta definir ese orden excepcional.
- Menos de dos opciones habilitadas al abrir: se devuelve `requirements-pending`;
  el motor exige dos opciones y no se inventa una elección automática.
- Fallecimiento de Mantenimiento antes de revelar y disponibilidad del creador:
  permanecen pendientes como en 5C.1.
- Recuperación de bloqueos, tratamientos y ronda 3 quedan fuera de esta fase.

Con cuatro humanos vivos en el recorrido normal no aparece ninguno de estos
bloqueos: después de ambos rescates aprobados quedan 35 de energía, suficientes
para cualquiera de las tres rutas. Incluso acumulando desacuerdos y un accidente
del pasillo, el recorrido normal no causa fallecimientos.

## Pruebas y comprobación manual

`round-two-movement.test.ts` verifica las tres rutas con y sin accidente, costes,
dos víctimas distintas, número de muestras, independencia del rescate, dos
microterremotos, falta de revelación, idempotencia y rechazos atómicos.
Las pruebas de Socket.IO en `voting.test.ts` comprueban las tres rutas, recorrido
forzoso, accidentes, ambos desacuerdos, cuatro resúmenes iguales, nueva conexión
tras F5, aislamiento de salas y conservación del bloqueo sin nuevas tiradas.
Se mantienen las pruebas anteriores, adaptando la expectativa posterior al voto
de 5C.1 para incluir ahora el desplazamiento autorizado.

1. Arrancar servidor y web con los scripts existentes (`npm.cmd run dev:server`
   y `npm.cmd run dev:web`, con Node 24 de .tools en PATH si es necesario).
2. Crear sala y entrar desde cuatro navegadores o pestañas independientes;
   aprobar ambos rescates. Antes de la ruta: salud 100 y energía 35.
3. Abrir la votación desde el creador y aprobar pasillo con tres votos:
   energía 25; sin accidente salud 100; con accidente dos humanos quedan en 80.
4. En partidas nuevas, revelar ventilación desde Mantenimiento antes de abrir:
   energía final 15; si ocurre accidente, dos humanos quedan en 95.
   Para apuntalamiento: energía final 5; con accidente dos quedan en 90.
5. En otra partida dejar vencer 60 y 30 segundos de ruta: pasillo forzoso,
   energía 25, salud 90 sin accidente o dos en 70 con accidente.
6. Dejar vencer también el rescate de ronda 2 en una partida nueva: ambos NPC
   de ronda 1/rescate se distinguen; el de ronda 2 queda abandonado. Con desacuerdo
   de ruta, salud 80 sin accidente o dos en 60 con accidente; energía 50 si se
   aprobó el rescate de ronda 1. Se muestran los dos microterremotos por separado.
7. Recargar después del resumen: mismos resultados, víctimas y recursos, ficha
   privada accesible. Otra sala debe conservar su propio estado.

La ejecución normal no permite forzar accidentes desde la UI. Para reproducir
ambas ramas de manera determinista ejecutar las pruebas, por ejemplo
`npm.cmd test -- apps/server/src/simulation/round-two-movement.test.ts` y
`npm.cmd test -- apps/server/src/rooms/voting.test.ts -t "5C.2"`.
