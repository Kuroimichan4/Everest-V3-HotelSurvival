# Fase 9D.1 — evidencias de objetivos individuales

## Fuentes y alcance

No cambian las fichas, objetivos, costes, probabilidades, tratamientos, votaciones,
rescates ni acciones disponibles. Sin puntos, rankings, IA, PostgreSQL o dependencias.
Se preservan los cambios no confirmados de 9B/9C. Los documentos originales de `docs/`
no se modifican. Esta fase no implementa 9D.2.

Fuentes revisadas: estado y operaciones de simulación; catálogos/resultados de rutas
de rondas 2, 3 y 4; rondas 1/2 y preparación de rescate; registro médico y recibos
autenticados del gestor; coordinación de decisiones y recuperaciones; fichas y objetivos;
proyecciones finales de 9C, contratos, sesiones y componente `FinalResults`.

El registro reutiliza `medicalTreatments`, `treatmentRequests`, resultados completados
de cada ronda y estado de NPC. No añade un segundo flujo de eventos de simulación.
`collectObjectiveLedger` construye una proyección interna tipada y sin efectos al
cerrar la partida. El gestor la guarda una vez, vinculada a `gameId` y `resultId`,
junto a las proyecciones privadas. La memoria se conserva tras F5 mientras el proceso
servidor siga activo, sin reconstrucciones que cambien el resultado al reconectar.

## Mantenimiento

El catálogo privado existente suministra las rutas conocidas. La acción autorizada
`route:reveal` conserva ahora la identidad interna del personaje que efectivamente
revela ventilación, una sola vez, también al recuperar la selección de ruta.
Un registro anterior de revelación sin autor conserva ese autor como desconocido:
no se atribuye retrospectivamente por conocer su rol.

No hay una operación separada que registre apertura/desbloqueo con autoría. El
motor puede comprobar herramientas/especialistas antes de recorrer cortafuegos o
apuntalamiento, pero esos resultados no contienen una apertura acreditada a
Mantenimiento. Ni conocer, revelar, votar, disponer de palanca o recorrer se convierten
en una apertura por equivalencia. `openings` queda vacío y el objetivo pendiente.

Falta aprobar/implementar qué operación concreta acredita apertura efectiva y
registrar su identificador, ruta y autor. No se añade esa acción en esta fase.

## Médico

El historial existente registra paciente, ronda y salud restaurada. Los recibos
existentes, creados solo tras validación y confirmación del tratamiento, conservan
identidad del administrador, destino e identificador de solicitud. Se correlacionan
por paciente y ronda, usando el límite ya aprobado de un tratamiento humano por ronda.

Cada paciente aparece una sola vez, con una lista de tratamientos de distintas rondas.
Repetir una solicitud no crea un tratamiento nuevo. Si faltan recibos históricos,
el administrador queda `null`, nunca se presupone que fue el Médico actual.
La identidad se obtiene de la sesión, sin aceptar autorías nuevas de React.

El estado final registra fallecimiento posterior al tratamiento, abandono y evacuación.
La operación médica solo acepta humanos activos, por lo que un posterior estado de
salud cero confirma que el fallecimiento ocurrió después de ser tratado. Un humano
abandonado con salud positiva no se presume superviviente final. La medicina NPC
de ronda 4 se registra aparte en el encuentro; no crea un paciente humano ni consume
su límite de tratamiento por ronda.

El objetivo puede quedar incumplido por un paciente propio fallecido, o cumplido si
todos los pacientes propios tienen evacuación confirmada y no faltan atribuciones.
Sin pacientes, con atribuciones desconocidas o pacientes abandonados de destino
desconocido, queda pendiente. No hay cumplimiento vacuo ni puntos.

## Arquitecto/Ingeniero

Se guardan exclusivamente los desplazamientos completados: ronda, ruta, identificador
de resolución, categoría real y si se impuso por falta de acuerdo. Las rutas propuestas,
votadas o bloqueadas no se incorporan como travesías.

Los riesgos se leen de los catálogos internos existentes, sin duplicar valores.
La imposición de ronda 2 y ronda 4 consta en sus resultados; la de ronda 3 procede
de su selección de servidor. Si falta ese contexto histórico, queda desconocida,
sin inferirla del nombre de la ruta. La única ruta de ronda 1 sigue siendo obligatoria;
el indicador `forcedByNoAgreement` distingue específicamente imposición por desacuerdo.

Atravesar una ruta extrema confirma el incumplimiento de evitar tales rutas, incluso
cuando fue forzada. Sin ruta extrema, solo se acredita el cumplimiento con itinerario
completo y todas las categorías conocidas. Actualmente ronda 1 no tiene una categoría
estructural explícita, por lo que no se inventa BAJO por no existir accidente de ruta.

El registro interno sí conserva BAJO para ventilación, tomado del catálogo; no sale
por vistas de rutas, eventos públicos ni evidencias privadas de ningún rol. La
proyección privada del arquitecto describe las travesías y extremos confirmados,
sin publicar otras categorías ocultas. No se expone el registro completo a React.

## Botones

Los tres encuentros tienen identificadores estables distintos de las personas:
`round-one-survivor`, `round-two-survivor`, `round-four-survivor`. Cada uno conserva
aparición/no aparición/encuentro no alcanzado, encontrado, ayuda aprobada, rescate
completado, abandono, fallecimiento y evacuación confirmada o desconocida.

Rondas 1/2 mantienen `evacuated: null` cuando falta su desenlace. No se inventa su
llegada a la calle ni una muerte posterior. En ronda 4 la aprobación es independiente
del rescate efectivo; el gasto médico solo consta cuando realmente se ejecuta.
Dos aprobaciones, o dos rescates sin desenlace de supervivencia, no acreditan el objetivo.

El modelo permite cumplimiento si llegan a confirmarse dos supervivencias y un
incumplimiento si los desenlaces completos lo descartan. Con las reglas/datos actuales
normalmente sigue pendiente: solo el NPC de ronda 4 puede confirmar evacuación.
Falta decidir cómo se registra el desenlace de NPC anteriores. Se conserva el objetivo
exacto de la ficha: que sobrevivan como mínimo dos huéspedes adicionales.

## Modelo de evaluación y privacidad

`assessObjective` distingue `fulfilled`, `unfulfilled` y `pending-evaluation` sin
asignar valores numéricos ni ganadores. Solo aplica las condiciones ya expresadas
por los objetivos a hechos concluyentes. `evidenceState` continúa describiendo los
hechos disponibles y no sustituye a la evaluación. El texto final de 9C muestra el
estado correspondiente y una explicación breve, manteniendo el diseño existente.

No hay consultas públicas nuevas, acciones de apertura, botones de pruebas ni
parámetros para manipular registros. `objectiveSession` sigue autorizando por sesión
y devolviendo únicamente la proyección del personaje, después del cierre. Los
fallecidos y eliminados conservan sus restricciones de acceso privado. Los registros
internos se mantienen también para evaluar sus hechos en servidor, sin darles permisos.

El resultado colectivo no incorpora objetivos, pacientes/administradores, aperturas
o riesgos reales. El evento privado no publica el registro interno ni datos de otros
objetivos. La web comprueba destinatario e identificador de resolución. Los listeners
existentes conservan limpieza y sustitución de snapshots, sin añadir pantallas.

## Archivos y pruebas

Nuevos: `simulation/objective-evidence.ts`, su prueba y este documento.
Modificados: `simulation/final-result.ts`, `simulation/routes.ts`,
`simulation/round-three-routes.ts`, `rooms/manager.ts`, contratos compartidos,
`web/src/FinalResults.tsx`, `web/src/FinalResults.test.ts` y
`rooms/game-final.socket.test.ts`.

Las pruebas puras verifican pacientes únicos, tratamientos en varias rondas,
autoría/ausencia de autoría, fallecimiento, abandono, evacuación, apertura distinta
de revelación y travesía, riesgos reales, imposición por desacuerdo, no ejecución,
NPC únicos, rescates pendientes, desenlace no confirmado y medicina NPC separada.

La integración real de cuatro sockets añade revelación autorizada repetida y un
tratamiento RPC con recibo repetido. Comprueba autor, ronda y cantidad, ausencia de
consulta privada durante la partida, evaluación propia al finalizar, coherencia
con el estado final, resultado público sin objetivos y conservación del registro y
de la proyección privada tras F5. Se ejecuta para las tres variantes de NPC de ronda 4.

Desde la raíz, con el Node local de `.tools` en PATH:

```powershell
npx.cmd vitest run apps/server/src/simulation/objective-evidence.test.ts
npx.cmd vitest run apps/server/src/rooms/game-final.socket.test.ts
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
git -c core.safecrlf=false diff --check
```

El informe de sesión indica los resultados observados. No se afirma una revisión
visual en cuatro navegadores a partir de pruebas automatizadas.

Antes de puntuaciones faltan las operaciones acreditables de apertura, la categoría
explícita de ronda 1 y la regla/registro de supervivencia de NPC anteriores. Esta
fase no decide umbrales de puntuación ni reinterpreta esos casos pendientes.
