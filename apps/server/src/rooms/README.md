# Salas multijugador y votación de rescate — fase 4C.1

Implementación provisional de desarrollo en memoria: cada `buildApp()` tiene su propio gestor. Al reiniciar el servidor se pierden salas, credenciales y partidas. Está integrada únicamente la decisión de rescate de ronda 1, sin consecuencias ni avance de ronda. No hay persistencia ni migraciones; no se añaden dependencias.

## Responsabilidades

- `manager.ts`: valida creación, entrada, inicio, reconexión y desconexión. La sala guarda código, creador, participantes y una partida opcional. La partida solo se crea al iniciar y contiene su propio identificador y estado del motor.
- `identity.ts`: genera identificadores UUID, códigos públicos aleatorios de 12 caracteres hexadecimales y credenciales privadas de 32 bytes criptográficos. El participante conserva identificador, nombre, hash de credencial, conexión actual y referencia opcional a su personaje. El servidor conserva el hash SHA-256 del token y lo compara en tiempo constante; el token original no se guarda en el gestor.
- `roles.ts`: mezcla Fisher–Yates con `crypto.randomInt` para obtener índices uniformes. La fuente de índices se sustituye en pruebas para reproducir el resultado. No hay roles al entrar en una sala.
- `socket.ts`: recibe solicitudes, vincula sockets autorizados al canal de su sala y publica únicamente proyecciones permitidas. El cliente no elige su identificador, personaje, rol ni función de creador.
- `packages/shared/src/index.ts`: define mensajes públicos, respuestas privadas y códigos de error. No contiene conocimientos privados ni el estado del motor.
- `apps/web/src/Lobby.tsx`: muestra formulario, cuatro plazas, conexión, creador, inicio manual y rol propio. Conserva las comprobaciones HTTP y Socket.IO de la pantalla anterior.

Sala, partida, participante, personaje, rol y conexión son conceptos diferentes. El participante persiste durante una desconexión; su socket cambia al reconectar. Al iniciar se crea un personaje con UUID propio para cada participante y se guarda la relación `characterId`. No se usan los identificadores basados en roles del estado inicial como identidades de personas o de personajes de esta partida. La salud, energía e inventario se inicializan con el motor existente sin cambiar sus reglas.

## Mensajes y privacidad

El servidor valida los datos en tiempo de ejecución: los tipos TypeScript no validan mensajes recibidos por la red. Los nombres se recortan y aceptan entre 1 y 40 caracteres; esta restricción técnica limita entradas vacías o excesivas. Los códigos no distinguen mayúsculas y minúsculas y se recortan al validar.

- `room:create`, `room:join`: respuesta privada con credencial y vista pública de sala. Una conexión solo puede pertenecer a una sala.
- `room:resume`: valida código, identificador y token antes de vincular la nueva conexión. Es idempotente para la misma conexión autenticada. Una sesión que sigue conectada en otro socket se rechaza con `session-in-use`; se evita sustituir silenciosamente su conexión.
- `room:updated`: solo código, creador, estado de espera/iniciada y participantes con id, nombre y conexión. No se envía a conexiones fuera de la sala; no incluye roles, tokens, hashes, id de socket, personajes ni inventario.
- `room:start`: identifica al solicitante por su conexión autenticada, comprueba creador, cuatro conectados e inicio único. La validación y el cambio de estado son síncronos, sin `await`: las solicitudes repetidas no pueden volver a sortear.
- `game:role`: mensaje individual con participante, rol y ficha privada propia. Se emite al iniciar y al reconectar con credencial válida; no contiene conocimientos de otros roles. La consulta interna además comprueba que el personaje siga vivo, como preparación para fases posteriores.

**Decisión aprobada — ficha del Médico:** desde el inicio conoce la sala de la conferencia tras la puerta cortafuegos de la ronda 3 y la posibilidad de encontrar suministros, sin conocer su cantidad ni asegurar que haya material aprovechable. La recompensa interna para la futura ronda 3 sigue siendo de 2 unidades médicas garantizadas al acceder; no se anticipa en fichas ni eventos públicos. La resolución de esa recompensa todavía no está implementada.

El código de sala permite entrar si quedan plazas antes del inicio; no es una credencial de reconexión. Los tokens son secretos de sesión, no deben compartirse, publicarse ni registrarse en logs. No hay cuentas de usuario en esta fase.

## Reconexión y decisiones pendientes

React guarda la credencial en `sessionStorage`, por pestaña y origen, y la envía al reconectar, incluso después de recargar. Diferentes perfiles de navegador permiten sesiones independientes. Duplicar una pestaña puede copiar su almacenamiento: esa pestaña debe reconectar la misma identidad, no conseguir otra plaza. Se rechazan conexiones simultáneas con la misma credencial. Si un transporte antiguo aún no se ha cerrado, se puede reintentar tras su desconexión.

Una desconexión marca `connected: false`: no mata al personaje, no cambia el rol, no libera plaza y no transfiere la función del creador. Mientras falte uno no puede iniciarse la partida. Tras iniciar, una reconexión recupera el rol anterior; no se acepta un nuevo participante.

**PENDIENTE de producto:** cuándo liberar plazas abandonadas, salida voluntaria, sustitución de participantes, transferencia de creador, expiración/cierre de salas, recuperación tras cerrar definitivamente la pestaña y política de múltiples conexiones. Se utiliza provisionalmente la reserva de plaza y la exclusión de conexiones simultáneas para evitar duplicación o usurpación accidental. No son reglas definitivas.

El botón «Olvidar credencial local» permite empezar otra sesión cuando la anterior no puede recuperarse (por ejemplo, tras reiniciar el servidor); no libera la plaza anterior. Sin la credencial no se recupera una plaza por nombre. La persistencia, limpieza de salas y límites de servicio quedan para su fase correspondiente; este gestor no pretende ser un servicio definitivo de producción ni funcionar repartido entre varios servidores.

## Comprobación manual

1. Desde la raíz, ejecutar `npm.cmd run dev:server` y `npm.cmd run dev:web` en dos terminales. Si Node no está en PATH, seguir la instrucción de Node portátil del README principal en ambas terminales.
2. Abrir `http://localhost:5173` en cuatro perfiles o sesiones de navegador independientes (cuatro pestañas nuevas también sirven si no copian una sesión existente).
3. En la primera introducir un nombre y pulsar «Crear sala». Compartir el código; los otros tres introducen nombre y código y pulsan «Unirse a sala».
4. Verificar las cuatro plazas y 4/4 conectados. Solo el creador ve «Iniciar partida», habilitado con los cuatro conectados. Antes de iniciar, una quinta sesión debe recibir un error de sala completa.
5. El creador pulsa «Iniciar partida». Cada pantalla muestra su ficha privada y la votación de rescate de ronda 1, con el mismo intento y plazo. Tres votos RESCATAR cierran inmediatamente con RESCUE_APPROVED; en otra partida, tres votos ABANDONAR producen ABANDON_APPROVED.
6. Recargar una pantalla durante la votación: recupera identidad, ficha, intento, plazo y confirmación del voto propio si ya votó. Una desconexión no reduce la mayoría de tres ni libera plaza.
7. En una partida nueva, no votar o repartir votos 2/2: tras 60 segundos empieza el segundo intento, con votos vacíos y 30 segundos. Si también vence, todas las pantallas muestran NO_AGREEMENT.

Pruebas automáticas: `npm.cmd test` incluye el motor anterior, el gestor y una prueba de red con cinco clientes Socket.IO, inicio repetido y reconexión mediante un sexto socket. `npm.cmd run typecheck` comprueba todos los paquetes y `npm.cmd run build` los compila. Las pruebas no necesitan una base de datos.

## Integración de votaciones — fase 4C.1

`Game.voting` conserva una instancia de `RoomVoting` por partida. `rooms/voting.ts` adapta el motor puro existente, sin duplicar sus reglas. La decisión se crea una sola vez con el inicio autorizado de partida. El resultado cerrado queda conservado dentro de esa instancia para una futura resolución; todavía no existe un procedimiento de aplicación de consecuencias.

- `vote:cast` solo admite `decisionId`, `attemptId` y `optionId`. El gestor obtiene al participante desde el socket autenticado y comprueba su personaje vivo; el motor valida electorado, opción, plazo e intento. Los identificadores de otras partidas se rechazan. Añadir campos para suplantar un participante también se rechaza.
- `vote:updated` se envía únicamente al canal de la sala. Contiene identificadores de decisión e intento, ronda, número de intento, plazo, hora del servidor, mayoría necesaria, estado y resultado. No contiene votos individuales, recuentos por opción, credenciales, fichas ni estado de simulación.
- `vote:own` y la respuesta privada de `vote:cast` confirman solo el voto del solicitante. Al reconectar, el servidor envía la vista actual y esa confirmación, sin crear otra decisión ni reiniciar plazos.

Un único `setTimeout` por votación abierta comprueba el vencimiento incluso sin clientes conectados. El primer vencimiento abre el segundo intento desde el instante real de apertura; el segundo devuelve NO_AGREEMENT. Al alcanzar mayoría se cancela el temporizador. El cierre del servidor cancela los temporizadores restantes. Si el planificador aún no ha procesado un plazo, un voto tardío se rechaza antes de actualizar el intento vencido. Las operaciones son síncronas y no intercalan `await` entre validación y escritura.

React usa el plazo y la hora recibida del servidor, junto con tiempo monotónico transcurrido localmente, para una cuenta atrás orientativa. La latencia puede desplazar ligeramente la visualización; el servidor decide la validez y el cierre. La ficha privada permanece accesible junto a la ronda.

`voting.test.ts` utiliza conexiones Socket.IO reales y un reloj/planificador controlable para comprobar sincronización, aislamiento entre salas, reenvíos, suplantación, reconexión y vencimientos sin esperar 60 segundos reales.

Pendiente para 4C.2: consumir el resultado una sola vez y aplicar las consecuencias aprobadas sobre energía, salud y NPC. Esta fase no altera esos estados ni avanza a ronda 2. Cambio de voto, fallecimientos durante un intento y visibilidad individual siguen pendientes; se conserva la instantánea estable del motor y se rechaza provisionalmente el cambio de voto. No hay transferencia del creador.
