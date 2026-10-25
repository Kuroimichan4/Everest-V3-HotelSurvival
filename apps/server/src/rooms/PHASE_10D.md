# Fase 10D — interfaz por roles, rutas y narrativa

## Resultado

Se mantiene el diseño oscuro y la secuencia de seis rondas. Las tarjetas muestran nombre, rol público y estado autorizado. Los botones **Dar Botiquín** y **Dar Pack** actúan sobre su propia tarjeta y sustituyen los formularios laterales de selección en la pantalla de partida.

Las categorías estructurales se envían únicamente al Arquitecto/Ingeniero activo. Los demás roles no reciben ese campo en sus DTO. Los porcentajes exactos siguen siendo internos. Se conserva el balance de 10B.3: 20/35/55/70 %, así como costes, daños, votaciones, muerte, abandono, recompensas y encuentros.

## Revisión previa

Se inspeccionaron GameScreen, equipo, Supplies y Medical, componentes de las seis rondas, reducers y conexión Socket.IO, proyecciones del servidor, permisos por rol, catálogos, administración de recursos, historial y resultados. Los principales problemas de presentación eran: ausencia de roles en las tarjetas, selección de destinatario en paneles separados, categorías de las rondas intermedias disponibles para todos y una referencia al almacén en la ruta pública de escombros antes de descubrirlo.

## Archivos creados

- `apps/web/src/direct-resources.ts`: recibo pendiente, recuperación y bloqueo de envíos duplicados compartido por todas las tarjetas.
- `apps/web/src/useTeamResources.ts`: coordinación de botones humanos con los RPC existentes y elegibilidad autorizada.
- `apps/web/src/RouteInformation.tsx`: presentación de categorías recibidas e introducciones públicas de rondas 1, 2, 3 y 6.
- `apps/web/src/direct-resources.test.ts`: concurrencia, destinatario, espera de actualización, rechazo, almacenamiento y F5.
- `apps/web/src/role-interface.test.ts`: roles públicos, botones por rol, privacidad visual, ventanas, palanca y narrativa.
- `apps/server/src/rooms/resource-eligibility.test.ts`: elegibilidad por paciente/destinatario y privacidad de valores.
- `apps/server/src/rooms/role-interface.socket.test.ts`: cuatro clientes reales que atraviesan las seis rondas con permisos, revelaciones, recursos y reconexión.
- `apps/server/src/rooms/PHASE_10D.md`: este informe.

## Archivos modificados

Servidor:

- `rooms/manager.ts`: proyección autenticada de roles, estados y elegibilidad; conocimiento privado de ventilación para Mantenimiento; metadatos y descripciones de rutas.
- `rooms/privacy.ts`: filtrado recursivo de categorías y porcentajes; permisos independientes de Médico, Arquitecto y Botones; rol público separado de ficha privada.
- `rooms/round-four.ts`: categorías de la salida para su posterior filtrado por sesión.
- `simulation/routes.ts`, `round-three-routes.ts`, `round-four.ts`: descripciones públicas de rutas, sin anticipar recompensas ni clasificaciones.
- `simulation/intermediate-rounds.ts`: ajustes breves de descripciones públicas para evitar comparaciones que sustituyan la evaluación del Arquitecto. Las introducciones de rondas 4/5 se conservan.

Cliente y contrato:

- `packages/shared/src/index.ts`: roles/estados públicos, elegibilidad sin cifras privadas, categorías opcionales según destinatario y conocimiento privado de ruta.
- `GameScreen.tsx`, `RoundOne.tsx`, `RoundTwo.tsx`, `RoundThree.tsx`, `RoundFour.tsx`, `IntermediateRound.tsx`, `styles.css`: tarjetas, botones, información especializada, herramienta y narrativa.

Regresiones adaptadas:

- `rooms/voting.test.ts`, `round-four.test.ts`, `round-four.socket.test.ts`, `route-availability.test.ts`; `simulation/routes.test.ts`, `round-three-routes.test.ts`.
- Las comparaciones de hechos colectivos excluyen los campos autorizados específicos de cada destinatario. Las pruebas nuevas verifican explícitamente la privacidad de esos campos; no se elimina la cobertura de permisos.

Los cambios de fases anteriores presentes al comenzar permanecen intactos. No se modifican `docs/`, dependencias, porcentajes, costes o reglas del motor. No hay commit ni push.

## Roles públicos y estados

La proyección enlaza cada participante con su personaje interno y añade el rol público a las tarjetas y snapshots autorizados. Se publica el rol también si el personaje ha fallecido o ha sido abandonado; eso no mantiene sus permisos de especialista activo.

La salud y energía exactas propias siguen disponibles. Solo Médico activo recibe salud exacta ajena; nadie recibe energía exacta de terceros. Objetivos y conocimientos continúan en su canal privado. Las tarjetas sin cifras autorizadas no dibujan barras vacías.

Los estados de agotamiento y transporte se comunican mediante etiquetas, derivadas del personaje y del transporte de la ronda vigente. No se necesitan valores ocultos en React para mostrarlos.

## Botones directos

El Médico dispone de **Dar Botiquín** en las cuatro tarjetas humanas, incluida la suya. Botones dispone de **Dar Pack**, también para sí mismo. Los demás roles no tienen esos controles. Cada botón incluye el nombre del destinatario en su etiqueta accesible.

El servidor calcula elegibilidad y motivo de bloqueo usando el estado real; solo envía los permisos médicos al Médico y los permisos de packs a Botones. Botones puede saber que una entrega no procede por energía completa, pero no recibe una cifra de energía ajena. React no busca valores privados para decidir la acción.

Se conservan los servicios originales: una unidad médica recupera hasta 20 de salud, un pack hasta 25 de energía, ambos con límite 100. Se mantienen inventario compartido, un tratamiento por paciente/ronda, exclusión de fallecidos/abandonados, destinatarios humanos válidos y ventanas actuales. En particular, no se cambian las reglas históricas de tratamientos de rondas 1–3 para hacerlas coincidir artificialmente con las ventanas de packs.

Las cuatro tarjetas comparten una única solicitud pendiente por tipo y partida. El primer clic guarda el identificador y destinatario antes del envío; otro clic no crea un gasto paralelo. Una confirmación correcta espera una actualización del servidor antes de permitir otra dosis intencional. Si no llega confirmación, el reintento y F5 conservan el mismo identificador. El servidor sigue siendo la autoridad final de recibos e inventario.

Los desplegables antiguos dejan de montarse en GameScreen. Sus componentes de legado permanecen fuera del flujo y del paquete activo de la partida; no existe un segundo formulario operativo. Los recibos pendientes usan las mismas claves de sesión para poder recuperarse.

El tratamiento del NPC de ronda 6 conserva su votación especial y no aparece como paciente humano en una tarjeta.

## Categorías de riesgo y rutas secretas

Las opciones conocidas incorporan metadatos de categoría en la capa interna del servidor. La proyección recursiva elimina `danger`, `realRisk` y `riskCategory` para quien no sea Arquitecto activo, y elimina los campos de probabilidad para todos. Este filtro se aplica a las emisiones y a la recuperación de sesión, incluyendo estructuras anidadas e historial.

Mantenimiento conoce sus rutas privadas, pero no recibe por ello categorías. En ronda 2 recibe una tarjeta privada con nombre, descripción y coste de ventilación antes de revelarla; esa tarjeta no es una opción de voto. El Arquitecto no recibe su identidad ni categoría hasta la revelación. Entonces aparece entre las opciones públicas y el Arquitecto recibe su evaluación. Las rondas 4/5 conservan la misma separación entre conocimiento de Mantenimiento y evaluación estructural.

React dibuja una etiqueta solo si el DTO autorizado contiene la categoría. No hay ocultación mediante CSS ni porcentajes en las tarjetas. Las descripciones públicas se limitan a obstáculos físicos, herramientas y esfuerzo, sin comparaciones categóricas de seguridad.

## Palanca y narrativa

La puerta cortafuegos muestra **−30 energía** y **−1 palanca** tanto en preparación, antes de abrir la votación, como en las opciones de voto. Explica que requiere la herramienta y que se pierde al completar el recorrido. El motor sigue cobrándola una sola vez al atravesar la puerta; abrir o votar no la consume. La pérdida llega al inventario compartido y afecta a la salida giratoria de ronda 6 como antes.

Se añadieron introducciones públicas breves:

- Ronda 1: polvo, alarmas, habitaciones deformadas, organización y superviviente garantizado; se explica el paso obligatorio de 25 sin inventar rutas.
- Ronda 2: pasillo agrietado y obstruido; las opciones describen el paso directo, el apuntalamiento con sus especialistas y la ventilación privada. El segundo NPC solo aparece en la fase de rescate posterior a elegir ruta.
- Ronda 3: planta de servicios, puerta, tuberías y maquinaria desplazada; se explica la palanca y el humo sin anticipar accidentes ni hallazgos. La ruta pública de escombros ya no anuncia el almacén.
- Ronda 6: vestíbulo, luz exterior y preparación de la salida; descripciones de puerta y grieta con costes y herramienta. No se anuncia un superviviente antes de su aparición real.

Las introducciones de rondas 4 y 5 se conservan. Al completar el recorrido, la acción principal pasa al resultado/siguiente paso y no repite la introducción anterior. Las consecuencias e historial mantienen los datos reales y permanecen filtrados por sesión.

## Pruebas y revisión manual

La prueba nueva de cuatro sockets recorre seis rondas y comprueba: los cuatro roles públicos, salud/energía por destinatario, elegibilidad privada, packs y tratamiento al objetivo correcto, recibos repetidos sin gastos dobles, revelación de ventilación, categoría exclusiva del Arquitecto, reconexión, ocultación de recompensas y palanca antes/durante/después de la puerta. También comprueba categorías en las rondas 4, 5 y 6 y termina con cuatro humanos evacuados.

Las pruebas de React verifican cuatro tarjetas, botones solo por rol, motivos de deshabilitación, ausencia de desplegables y paneles duplicados, información de herramienta y narrativas sin NPC anticipados ni recompensas. Las pruebas del controlador verifican clics concurrentes, mismo recibo tras F5 y bloqueo hasta actualizar el estado. Las pruebas anteriores siguen cubriendo límites, inventario, ventanas y condiciones de los tratamientos.

Para comprobar manualmente:

1. Arrancar `npm.cmd run dev:server` y `npm.cmd run dev:web` desde la raíz, en dos terminales con Node 24 disponible.
2. Abrir cuatro sesiones independientes en `http://localhost:5173`, crear y completar una sala e iniciar la partida.
3. Verificar en las cuatro pantallas nombre, rol y estado de cada tarjeta. Comparar cifras: Médico ve salud de todos; cada uno ve solo su energía. No deben aparecer barras vacías por privacidad.
4. Tras el primer desplazamiento, usar **Dar Pack** desde Botones sobre una tarjeta concreta, incluida la propia. Comprobar destinatario, inventario y bloqueo por energía completa, inventario vacío o ventana cerrada.
5. Cuando haya heridos, usar **Dar Botiquín** desde Médico. Comprobar paciente correcto, recuperación, inventario y límite por ronda. Repetir rápidamente y recargar durante una confirmación para comprobar el recibo único.
6. En ronda 2 comparar la tarjeta privada de Mantenimiento con la pantalla del Arquitecto antes de revelar. Revelar y comprobar que solo el Arquitecto obtiene BAJO para ventilación.
7. En ronda 3 comprobar **−1 palanca** antes de abrir voto. No debe anunciarse una cantidad médica ni el almacén. Completar la puerta y comprobar la palanca perdida y el descubrimiento posterior.
8. Revisar narrativas de las seis rondas, presentación del NPC solo en su fase, historial plegado, una única acción principal y disposición de botones en móvil.
9. En ronda 6 comprobar que el NPC especial se decide por voto y que la puerta giratoria refleja la herramienta disponible. Recargar para comprobar roles, permisos, recursos y fase.

## Pendientes

- Revisión visual manual con cuatro navegadores y tamaños móviles; esta intervención incluye pruebas de renderizado y sockets, no una prueba visual manual.
- Persistencia tras reiniciar servidor, relevo de especialistas y demás decisiones pendientes de fases anteriores siguen fuera de alcance.
- No se implementan gas, explosión, puntuaciones, IA ni PostgreSQL. No se avanza a otra fase.

## Validación final

- **644 pruebas aprobadas en 50 archivos**, incluidas las 612 anteriores adaptadas a la información pública nueva y 32 pruebas añadidas.
- `npm.cmd run typecheck`: correcto en los tres workspaces.
- `npm.cmd run build`: correcto para shared, servidor y web.
- `git diff --check`: correcto mediante `git -c core.safecrlf=false diff --check`, sin problemas de espacios.
- `git diff --name-only -- docs`: vacío.
- No hay dependencias nuevas, commit ni push. La intervención termina en 10D para revisión.
