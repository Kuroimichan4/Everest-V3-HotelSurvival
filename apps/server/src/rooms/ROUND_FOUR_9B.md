# Fase 9B — evacuación multijugador

## Archivos

- Nuevos: `rooms/round-four.ts`, `rooms/round-four.test.ts`,
  `rooms/round-four.socket.test.ts`, `web/src/RoundFour.tsx`, `web/src/RoundFour.test.ts`
  y este informe.
- Coordinación y sesiones: `rooms/manager.ts`, `rooms/socket.ts`, `rooms/voting.ts`.
- Motor: `voting/engine.ts` permite suministrar el electorado actualizado al abrir
  el siguiente intento; sin ese parámetro mantiene el comportamiento anterior.
  `simulation/round-four.ts` exporta su previsión pura del esfuerzo y una proyección
  de alternativas NPC usando sus costes centralizados. No cambia probabilidades ni daños.
  `simulation/state.ts` admite ronda 4 por defecto para la integración.
- Transporte: `rooms/transport.ts` admite ronda 4 y descarta propuestas de abandono
  no confirmadas si su transacción 9A falla; conserva las reglas de rondas 1–3.
- Contratos: `packages/shared/src/index.ts` amplía rondas de votos, recursos y transporte
  y define `RoundFourView`, acciones y evento público específicos.
- Interfaz: `game-state.ts`, `game-socket.ts`, `Lobby.tsx`, `GameScreen.tsx`,
  `game-history.ts`, `Medical.tsx` incorporan la fase al flujo de 8D, sin cambiar CSS.
  La lectura de tratamientos pendientes admite ronda 4. El test médico anterior
  usa ronda 5 como entrada inválida y comprueba ronda 4 como válida pero incorrecta
  cuando la partida sigue en ronda 1.

Se conservan los cambios no confirmados de fases anteriores. No se han modificado
los originales de `docs/`, ni añadido dependencias, IA, PostgreSQL, puntuaciones,
victoria definitiva o nuevas reglas de rondas anteriores.

## Flujo autoritativo

El anfitrión vivo y activo puede pulsar **Avanzar a ronda 4** tras completar la ruta
de ronda 3. `beginRoundFour` conserva recursos, personajes, estados, herramientas,
registros médicos y decisiones previas. Se guarda una sola muestra 50/25/25 del
encuentro. Una petición repetida o una reconexión no llama otra vez al azar.

Si no hay NPC se abre directamente la preparación de salida. Si existe, comienza
la votación de rescate: asistencia (25) o abandono para caminante; transporte (40),
medicina más asistencia (una unidad y 25) o abandono para inmóvil. La medicina es
una alternativa de esta misma votación, nunca una votación médica adicional.

Se utiliza `RoomVoting`: 60 segundos, 30 segundos, mayoría estricta y cierre
inmediato. El primer fracaso NPC aplica el mensaje literal del motor; el segundo
registra NPC muerto y deja preparar la salida sin derrumbe ni gasto de rescate.
La decisión aprobada queda como `awaiting-effort`; todavía no se cuenta como rescate
completado ni se cobra la medicina.

En preparación, Botones distribuye packs y Médico administra sus tratamientos
humanos directos con límite por ronda. Son operaciones autenticadas ya existentes.
Los recursos de ronda 4 se cierran durante votaciones, después de evacuar y durante
errores de azar para mantener opciones y presupuesto estables. La medicina pendiente
del NPC no se consume ni reserva por adelantado: se vuelve a validar en el motor.
Si se ha utilizado en un tratamiento humano durante preparación, la decisión NPC
se conserva y la salida queda bloqueada si ya no puede pagarse.

El anfitrión abre la votación de salida, incluso si solo queda una ruta viable.
Se muestran dos tarjetas, coste de ruta y motivo de indisponibilidad. El servidor
rechaza votar por la puerta si falta palanca. No publica catálogos de riesgos,
probabilidades ni fichas ajenas. No recrea la palanca.

Al terminar el primer intento de salida, **antes de abrir el segundo**, el coordinador
llama al motor 9A: −5 salud una sola vez y recargo +5. Actualiza costes, disponibilidad
y electorado con los humanos que siguen activos; el intento extraordinario dura 30 s.
Si todos fallecen, se conserva un bloqueo sin abrir un electorado inválido.
El segundo fracaso llama a 9A para forzar grieta de coste 15, sin otro daño por derrumbe.

La salida aprobada o forzada se conserva por su identificador. El servidor consulta
la previsión de esfuerzo NPC y evalúa la energía residual para el transporte humano.
Reutiliza `TransportDecision`, su electorado de porteadores, la autorización por
alternativa y la selección de destinatario con dos agotados. Se siguen sumando
15 por humano transportado y porteador, separados del esfuerzo NPC.

El transporte usa una previsión sin gastos para evaluar planes. Solo los abandonos
colectivamente aprobados pasan como propuesta a la transacción final. La resolución
9A parte del presupuesto real y confirma rescate, medicina, ruta, transporte y accidente
conjuntamente. Un rechazo no confirma gastos ni abandonos. El resultado y las víctimas
quedan guardados. Una fuente aleatoria inválida bloquea nuevas tiradas sin confirmar
propuestas de eliminación o transferencia de objetos.

## Recuperación, interfaz y seguridad

Eventos nuevos: `round-four:advance`, `round-four:open`, `round-four:retry` y
`round-four:updated`. Los votos siguen usando `vote:cast`. No se acepta identidad
de actor ni rol del navegador: se obtiene de la sesión, y se rechazan fallecidos y
eliminados. El identificador de preparación se verifica para reintentar una salida.

En bloqueos energéticos, los packs de preparación y **Comprobar de nuevo la salida
acordada** permiten reevaluar el mismo acuerdo, conservando el rescate y cualquier
ruta forzada. No se reabre otra votación de ruta ni se elige una alternativa distinta.
Una votación de transporte pendiente o sin acuerdo no se salta con ese botón.

Las conexiones autenticadas reciben las mismas proyecciones públicas; cada reconexión
recupera solo su ficha y voto propios. Se conserva el plazo original del intento.
La persistencia sigue siendo la memoria del servidor: F5 no reinicia la partida,
pero reiniciar el proceso servidor sí la pierde.

La pantalla de 8D mantiene una cabecera, una acción y un equipo. El estado actual
elige entre NPC, rutas, transporte, bloqueo y resumen provisional; no conserva
votaciones anteriores como acciones. Cada evento sustituye su snapshot. El listener
nuevo se da de baja simétricamente al desmontar. El historial nace plegado y usa
claves de decisión, derrumbe y movimiento, sin añadir copias al recibir eventos.
El resumen muestra salida, accidente, humanos evacuados, fallecidos/abandonados y
NPC. Salud, energía, inventario y palanca siguen en el panel común. Sin puntuaciones
ni declaración de victoria, especialmente si nadie sobrevive al accidente final.

## Comprobación automatizada

`rooms/round-four.test.ts`: transición real por rondas anteriores y packs, los tres
rescates, coste atómico, límites de recursos, permisos, intentos 60/30, mensaje,
derrumbe, electorado actualizado, muerte total, palanca, accidentes, energía,
transporte simple y con dos agotados, autorización por alternativa, abandono
explícito, bloqueo de azar y reconexiones.

`rooms/round-four.socket.test.ts`: cuatro clientes reales de Socket.IO recorren
rondas 1–4, recuperan voto durante reconexión, acuerdan medicina NPC, resuelven
accidente y recuperan resultado sin nuevos cargos ni tiradas. Otra sala de cuatro
clientes mantiene su votación e inventario y no recibe eventos de ronda 4 ajenos.

`web/src/RoundFour.test.ts`: renderizado de fases, un panel activo/equipo, cuatro
tarjetas, historial plegado, countdown 60/30, voto recuperado, rescate pendiente,
resultados no duplicados, ficha ajena excluida, controles deshabilitados y limpieza
de listeners. Estas pruebas no sustituyen una revisión visual en cuatro navegadores.

Comandos desde la raíz con el Node local de `.tools` en PATH:
`npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`,
`git -c core.safecrlf=false diff --check`. El informe de sesión indica resultados observados.

## Prueba manual desde cuatro navegadores/perfiles independientes

1. Arrancar servidor (`npm.cmd run dev:server`) y web (`npm.cmd run dev:web`).
   Crear sala, unir cuatro personas e iniciar. Cada perfil conserva su propia sesión.
2. Para un recorrido con margen energético, abandonar NPC de rondas 1/2 y usar
   pasillo principal y escombros metálicos en ronda 3. Botones puede entregar dos
   packs a cada humano tras ronda 3; comprobar existencias y estado real del equipo.
3. El anfitrión pulsa **Avanzar a ronda 4**. El encuentro es aleatorio; repetir una
   partida si se quiere observar otra variante, sin esperar que F5 cambie el NPC.
   Comprobar que nadie distinto del anfitrión ve el control de transición.
4. NPC caminante: aprobar asistencia con tres votos. Inmóvil: probar transporte o
   medicina en partidas diferentes. Ver **Rescate aprobado, pendiente…** y comprobar
   que todavía no se cobra. Otra partida: dejar pasar 60 s, verificar mensaje literal,
   dejar 30 s y comprobar NPC muerto sin daños de derrumbe.
5. En preparación de salida, repartir packs con Botones. Comprobar que los otros
   roles no pueden repartirlos. Médico puede tratar una vez por humano y ronda.
   Sin unidades, la opción médica no se puede votar. F5 conserva entregas y tratamientos.
6. Abrir salida. Con palanca, ambas rutas pueden ser candidatas si hay presupuesto.
   Para probar pérdida real de palanca, repetir escogiendo cortafuegos en ronda 3:
   la puerta giratoria de ronda 4 debe estar bloqueada y la grieta seguir disponible
   si el presupuesto alcanza. Repartir packs antes de abrir cuando haga falta.
7. Durante cada votación, emitir uno o dos votos y recargar un perfil. Su voto y
   plazo permanecen; tres coincidencias con cuatro vivos cierran inmediatamente.
   No debe mostrarse otra acción anterior ni duplicarse el equipo.
8. En otra partida, dejar pasar los 60 s de salida: comprobar −5 de salud y costes
   25/15; recargar y comprobar que no repite daño. Esperar otros 30 s: grieta forzada,
   mismo daño previo. Si falta energía, comprobar bloqueo, repartir packs y reintentar
   conservando la grieta. No debe declararse derrota automática.
9. Para observar transporte humano, evitar repartir a un humano todo el margen que
   necesita para la ruta y mantener suficiente energía en los demás. Tras elegir ruta,
   abrir preparación de transporte; el agotado no puede votar por su propio traslado.
   Comprobar que se presentan únicamente alternativas autorizadas. Los presupuestos
   concretos y el caso de dos agotados se reproducen de forma determinista en Vitest.
10. Tras salir, comprobar resumen provisional, humanos evacuados/fallecidos/abandonados,
    NPC completado y recursos. F5 no repite accidente ni medicina. Abrir/cerrar historial
    sin acciones. Verificar también en móvil y comprobar otra sala en paralelo.

## Pendientes

- Desenlace formal si todos fallecen, incluido accidente final; sin puntuación.
- Relevo de anfitrión o especialistas fallecidos/eliminados; no se delega autoridad.
- Falta de votantes de transporte, más de dos agotados o falta de acuerdo de transporte:
  conserva el comportamiento pendiente existente, sin inventar rescates automáticos.
- Presupuestos combinados inviables: bloqueo y reevaluación con recursos válidos;
  sin convertir rescate en abandono ni repartir esfuerzos de otra manera.
- Reactivar recursos inexistentes, nueva palanca o nueva salida: no implementado.
- La revisión visual en cuatro navegadores, dispositivos y escenarios aleatorios
  queda como comprobación manual; no se afirma haberla realizado con estas pruebas.

La fase de puntuaciones y pantalla final definitiva no se inicia automáticamente.

## Corrección de visibilidad y salida del rescate por inacción

Se reprodujeron seis regresiones en el selector de la acción actual: los cuatro
roles podían quedar mostrando ronda 3 si su snapshot auxiliar de suministros seguía
en esa ronda, aunque ya hubieran recibido el estado público de ronda 4. Ese mismo
conflicto ocultaba la preparación de salida después del fallecimiento del NPC.
Un snapshot de transporte también podía desplazar indebidamente la acción vigente.

`activeScene` da ahora prioridad al estado de ronda 4 y solo activa su panel de
transporte cuando la fase pública es `transport`. El voto del NPC cerrado permanece
en el historial, pero no se utiliza como decisión activa durante la preparación.
No se han cambiado emisiones, temporizadores ni consecuencias del motor: la
coordinación ya registraba la muerte y publicaba preparación a toda la sala.

La prueba Socket.IO adicional alimenta el reducer y los listeners reales de cuatro
clientes, retrasa los snapshots auxiliares de tres, recupera una sesión con voto
mediante reconexión y deja agotar 60/30 segundos. Comprueba mensaje literal, una
emisión por transición y cliente, NPC muerto, ausencia de gastos/derrumbe, ningún
voto activo residual y posterior elección y ejecución de la grieta. Las pruebas
de renderizado comprueban que aparecen rescate o preparación según corresponda,
sin depender del rol. El import de tipos del binder usa extensión `.js` para poder
comprobarlo también desde las pruebas NodeNext del servidor.

Reproducción manual: en cuatro perfiles, alcanzar ronda 4 con NPC presente, recargar
uno durante el rescate y dejar pasar ambos intentos. Todos deben mostrar el mismo
intento/plazo; tras los primeros 60 s aparece el mensaje literal y otros 30 s;
después se muestra preparación de salida, sin daño ni consumo. El anfitrión puede
abrir la votación de salida. La revisión visual en navegadores sigue siendo manual.
