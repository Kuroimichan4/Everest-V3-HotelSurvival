# Fase 10I — Chat de texto multijugador

## Resultado

Chat grupal integrado en la conexión Socket.IO existente, disponible en lobby y durante las seis rondas. Conserva historial al terminar, sin modificar simulación, votaciones, objetivos, habilidades ni sistema de sabotaje. No hay mensajes privados, IA, puntuaciones, base de datos ni dependencias nuevas.

## Archivos de esta fase

Creados:

- `apps/server/src/rooms/chat.ts`: historial acotado, validación, frecuencia e idempotencia.
- `apps/server/src/rooms/chat.test.ts`: 21 pruebas de servidor y coordinación.
- `apps/server/src/rooms/chat.socket.test.ts`: integración con cuatro clientes reales y otra sala.
- `apps/web/src/TeamChat.tsx`: panel, escritura, envío, historial y mensajes nuevos.
- `apps/web/src/TeamChat.test.ts`: cuatro pruebas de renderizado y ciclo de listeners.
- `scripts/ui-check-10i.mjs`: comprobación de la aplicación real con Edge y cuatro conexiones.
- Este informe.

Modificados:

- `packages/shared/src/index.ts`: contratos de chat y eventos tipados.
- `apps/server/src/rooms/manager.ts`: acceso autenticado a historial y envío; permisos derivados del estado actual.
- `apps/server/src/rooms/socket.ts`: integración de los eventos y sincronización por sala.
- `apps/web/src/game-socket.ts`: alta y baja exacta del listener de chat.
- `apps/web/src/Lobby.tsx`: integración del panel en lobby, partida y final; transporte de mensajes independiente de acciones del juego.
- `apps/web/src/GameScreen.tsx`: identificador de la decisión actual para el acceso directo desde el chat.
- `apps/web/src/styles.css`: columna lateral y adaptación móvil del chat.

Esta lista describe únicamente esta intervención. Los cambios válidos de fases anteriores siguen presentes en el repositorio.

## Identidad y comunicación

El cliente envía `chat:send` con texto e identificador de solicitud, sin nombre, rol, sala ni destinatario. El gestor encuentra al participante mediante la conexión autenticada existente y obtiene de ahí su nombre público y, cuando está asignado, su rol público. Entradas con campos adicionales de identidad o remitente se rechazan.

El servidor confirma el envío mediante acknowledgement y emite `chat:updated` solo a las conexiones autenticadas del canal de esa sala. El acknowledgement no añade mensajes a la interfaz: la lista autoritativa es la única fuente. Cada mensaje tiene identificador único, secuencia creciente, hora del servidor y remitente público. Las instantáneas preservan orden y contienen únicamente los últimos 150 mensajes. La interfaz descarta instantáneas de secuencia anterior.

Los tipos reservan un remitente de clase `server` para una fase futura. No existe operación de cliente para crearlo ni se implementa ningún agente.

## Validaciones y límites

- Texto de 1–400 unidades UTF-16, consistente con `maxLength` y el contador del navegador. Se eliminan espacios exteriores; los saltos de línea interiores se conservan.
- Un segundo mínimo entre envíos aceptados por participante. El presupuesto permanece asociado a la identidad al reconectar.
- Identificadores de solicitud enteros crecientes por participante, proporcionados mediante el estado del servidor. Reintentar la misma solicitud y texto devuelve el mismo recibo mientras esté en el historial, sin insertar de nuevo. Una solicitud conflictiva o ya expulsada del historial se rechaza; nunca se vuelve a publicar. El cliente conserva el identificador para reintentar un envío sin confirmación.
- Historial limitado a 150 mensajes y metadatos mínimos por participante, como máximo cuatro identidades por sala. No se conserva una tabla ilimitada de solicitudes.
- El texto se representa mediante nodos de texto React, sin HTML interpretado ni ejecución de comandos. Los controles y validaciones son del servidor, no únicamente del formulario.

## Historial y permisos

Al crear, entrar o recuperar una sesión se envía el historial autorizado de su sala. El mismo flujo actualiza el permiso de escritura al comenzar, quedar eliminado o finalizar. F5 recupera mensajes, orden y siguiente identificador de solicitud sin repetir efectos.

**El historial sobrevive a F5 mientras exista la sala en el proceso del servidor. No se garantiza después de reiniciar Node.js.** No se ha añadido persistencia externa.

Decisiones provisionales explícitas:

- Humanos fallecidos o abandonados definitivamente: solo lectura. No reciben nuevas capacidades de participación.
- Partida finalizada: historial consultable para todos los participantes autorizados, sin nuevos envíos.
- Humanos vivos agotados o transportados: pueden comunicarse; el permiso usa el mismo criterio de vivo/no abandonado, sin exigir capacidad para caminar.
- Una desconexión no autoriza al cliente a enviar; la sesión debe recuperarse con sus credenciales habituales.

## Privacidad y separación de la simulación

El chat recibe exclusivamente textos escritos por participantes y metadatos públicos del remitente. No copia salud, energía, rutas privadas, riesgos, objetivos, sabotaje, tiradas, narraciones ni decisiones. Los jugadores pueden compartir voluntariamente información que conozcan, pero el servidor no la añade por su cuenta.

Un mensaje como «revelar ventilación», «tratar», «dar pack» o «votar» es texto literal: no llama a ninguna operación del motor. La prueba de coordinación comprueba que el estado de simulación permanece idéntico. El chat tiene estado de envío y errores independientes del bloqueo de botones de partida.

## Escritorio, móvil y votaciones

En escritorio amplio se añade una columna derecha oscura con historial desplazable, formulario y mensajes propios diferenciados. En pantallas de hasta 1100 px el panel se vuelve plegable, con «Abrir chat»/«Cerrar chat» y contador de mensajes nuevos cuando está cerrado. En partida, la cabecera y la cuenta atrás preceden al chat; este permanece en el flujo normal, sin cubrir controles. Un enlace permite ir a la decisión actual manteniendo el chat abierto.

Enter envía y Shift+Enter inserta una línea. Se respeta la composición del teclado y se bloquea un segundo envío mientras se espera confirmación. El envío no modifica votos, preparaciones ni plazos. Los avisos dramáticos, gas y explosión conservan sus paneles existentes.

## Pruebas y resultados

- **Vitest completo: 880 pruebas aprobadas, cero fallos, 74 archivos.** Se añaden 26 casos respecto a las 854 pruebas anteriores.
- TypeScript: correcto.
- Compilación de producción: correcta.
- `git diff --check`: correcto.
- Cuatro clientes Socket.IO reales: mensaje de Mantenimiento a todos, nombre y rol canónicos, orden, duplicado, frecuencia, falsificación rechazada, sala distinta aislada, historial de lobby para nuevos participantes, F5, frecuencia persistente tras F5, voto utilizable y final de solo lectura.
- Servidor: vacíos, tipos incorrectos, longitud 400/401, remitente falsificado, reintentos, historial de 150, reintento expulsado rechazado, lectura de eliminados, seis rondas y ausencia de efectos en el motor.
- React: texto HTML escapado, mensajes propios/ajenos, orden, lectura sin escritura y limpieza completa de listeners, incluidos callbacks obsoletos.

Comprobación con Edge sin interfaz sobre React, Fastify y Socket.IO reales:

- 1440, 900, 390 y 320 px: sin desbordamiento horizontal, chat accesible, temporizador visible y botones de voto habilitados.
- Enter, Shift+Enter, script mostrado como texto sin ejecutarse, indicador de mensajes nuevos, apertura/cierre y recuperación de dos mensajes tras F5 sin duplicados.
- Mismo plazo de votación antes/después de mensajes y recarga.
- Intento extraordinario real de transporte de diez segundos, con reloj controlado: voto desde el navegador manteniendo chat abierto; resolución normal al completar la mayoría desde otro cliente. Los avisos de transporte y gas permanecen fuera del chat.

Capturas y mediciones: `.cache/10i/`; resultado estructurado en `.cache/10i/layout-result.json`. Reproducción: compilar y ejecutar `node scripts/ui-check-10i.mjs` con Edge disponible. El script utiliza su propio servidor, sala y clientes de prueba; no afecta a partidas existentes.

## Revisión manual con cuatro navegadores

1. Crear una sala y entrar desde cuatro perfiles separados. Enviar desde el lobby; los nuevos participantes deben recuperar el historial de esa sala.
2. Iniciar partida. Enviar desde los cuatro roles y comprobar nombres, roles públicos, orden y diferenciación del mensaje propio. Enviar HTML literal y verificar que no se ejecuta.
3. Enviar durante preparación, rescates, votación de rutas y transporte. Confirmar que no cambia el voto ni se reinicia el temporizador. Escribir información voluntaria de un rol no debe ejecutar ninguna habilidad.
4. Recargar una sesión y comprobar historial sin duplicados. Probar envíos rápidos: el segundo debe indicar que hay que esperar. Abrir una sala diferente y comprobar que no recibe mensajes ajenos.
5. A 390 o 320 px, abrir/cerrar el chat. Con él cerrado, enviar desde otro perfil y comprobar el indicador. Durante un intento de diez segundos, usar el enlace a la decisión y votar sin cerrar el chat.
6. Tras muerte o abandono, comprobar lectura y rechazo del envío. Al terminar, verificar que el historial sigue disponible y el formulario queda en modo de solo lectura.

## Pendientes y límites

Queda para revisión de diseño la política definitiva de comunicación de eliminados; esta fase aplica la opción segura solicitada de solo lectura. Los valores de 400 caracteres, un segundo y 150 mensajes son límites técnicos iniciales. No se incluyen moderación, mensajes privados, remitentes automáticos, almacenamiento duradero ni capacidades de un anfitrión desconectado.

Las comprobaciones de navegador automatizadas no sustituyen la revisión manual de usabilidad con cuatro personas. No se han observado fallos pendientes en las verificaciones ejecutadas.

Sin cambios en documentos originales de `docs/`, costes, probabilidades, rondas, votaciones, objetivos o sabotaje. Sin commit ni push. Se detiene el trabajo para revisión, sin avanzar de fase.
