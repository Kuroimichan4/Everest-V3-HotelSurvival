# Fase 10F.2.1 — Mensaje personal del jugador fallecido

## Alcance

Se añade exclusivamente presentación narrativa privada del fallecimiento. No cambian el motor de sabotaje, su probabilidad, tratamientos, inventario, objetivos, energía, rutas, accidentes, sucesión ni permisos. Se conservan los cambios anteriores del repositorio. Sin modificaciones de docs/, dependencias nuevas, commit ni push.

## Archivos creados

- apps/server/src/rooms/personal-death.ts: proyección segura de muerte, catálogo narrativo y variante estable por evento.
- apps/server/src/rooms/personal-death.test.ts: causas, misterio, abandono, estabilidad, caché y muerte mientras está desconectado.
- apps/web/src/PersonalDeathNotice.tsx: panel propio visible en juego y desenlace final.
- apps/web/src/personal-death-ui.test.ts: destinatario, estado, causas, duplicados, permisos y fixtures visuales.
- apps/web/src/personal-death-integration.test.ts: cuatro clientes reales, canales privados, F5 y restricciones.
- scripts/ui-check-10f21.mjs: comprobación de escritorio/móvil y capturas locales.
- apps/web/PHASE_10F_2_1.md: este informe.

## Archivos modificados

- packages/shared/src/index.ts: DTO PersonalDeathMessage y evento privado game:personal-death.
- apps/server/src/rooms/manager.ts: obtención del mensaje para la conexión autenticada y almacenamiento por fallecido en la partida.
- apps/server/src/rooms/socket.ts: entrega exclusiva, una vez por conexión/evento, recuperación y limpieza al desconectar.
- apps/web/src/game-socket.ts: filtro del propietario, suscripción y baja exactas, limpieza de estado privado.
- apps/web/src/Lobby.tsx: estado personal separado y conexión con GameScreen.
- apps/web/src/GameScreen.tsx: panel en partida y resultado final.
- apps/web/src/styles.css: panel oscuro destacado y adaptable.

No se modifica el historial público para insertar la narración personal. Los demás archivos pendientes en git pertenecen a fases anteriores.

## Presentación y variantes

El fallecido recibe un panel destacado titulado «Has fallecido», sin abrir el historial. Contiene una narración en segunda persona y recuerda: «Ya no puedes participar en las decisiones, votar, administrar recursos ni realizar acciones de tu rol o de anfitrión».

El panel permanece en el flujo normal de la página, sin modal ni capa que tape permanentemente la partida. La información y las decisiones que ya compartía el servidor siguen consultables conforme a los permisos existentes. También aparece cuando el fallecimiento termina directamente en el resultado final.

Se añaden ocho textos, dos por categoría:

- Accidente o derrumbe: estruendo, pérdida de equilibrio, polvo y escombros.
- Humo o gas: respiración difícil, siluetas que se alejan y silencio.
- Explosión: destello, estruendo y ausencia de tiempo para avanzar.
- Muerte inesperada: pérdida repentina de fuerzas, voces distantes y causa sin explicación.

Las categorías proceden de recibos públicos de fallecimiento o de consecuencias conocidas del servidor. Se usan los registros de crisis, rutas, derrumbes y fallecimiento inesperado. Si el registro combina daños ambientales y accidente sin una causa fatal separada, o no permite atribuir una causa concreta, se utiliza la variante neutral de incertidumbre; no se inventa una causa precisa.

## Protección del misterio

Una muerte después de un tratamiento se proyecta siempre como unexpected. La función no consulta el estado secreto medicalSabotage, sus usos ni sus tiradas. La narración propia no menciona medicamentos, manipulación, veneno, probabilidad, autor ni pistas técnicas exclusivas.

El DTO contiene únicamente gameId, participantId, eventId, round, kind y message. Se construye en el servidor sin copiar el estado interno. El gestor obtiene al personaje desde la conexión autenticada: no existe una solicitud del cliente que permita elegir otra víctima para consultar su mensaje.

Socket.IO lo emite únicamente al socket del fallecido. Los otros reciben sus narraciones públicas anteriores, no este panel personal. El adaptador del cliente comprueba además el propietario, y el componente valida partida y fallecimiento. No se añade este dato a GameState ni al historial común: Lobby lo conserva en un estado privado separado, igual que las otras respuestas personales.

La confirmación privada del objetivo de Botones permanece intacta y sigue siendo exclusiva de su sesión. Si el propio Botones es víctima, conserva únicamente la información privada que ya tenía autorizada; el mensaje de muerte sigue siendo misterioso y no amplía lo que reciben los demás.

## Estabilidad, desconexión y F5

La variante se obtiene de forma determinista a partir del identificador estable de fallecimiento. No consume el azar del motor ni modifica la secuencia de sus probabilidades.

El gestor guarda la proyección al publicar un fallecimiento, también para participantes desconectados. Una transición posterior de ronda no cambia su categoría, texto ni identificador. Las respuestas se clonan para no permitir que una lectura modifique la copia guardada.

Por conexión se entrega una sola vez cada eventId. Los snapshots repetidos no vuelven a enviar el aviso. Al desconectar se limpia esa marca de entrega y el estado local. F5 autentica una conexión nueva y recupera el mismo mensaje guardado; React representa un único panel, no una cola de notificaciones nuevas.

Esta recuperación conserva la limitación vigente: las partidas y mensajes están en la memoria de la instancia activa del servidor, no sobreviven a reiniciarla.

## Fallecido, abandonado y evacuado

El servidor solo genera el mensaje para salud agotada y sin eliminación por abandono. Un abandonado no recibe automáticamente una narración de muerte, incluso si un estado de prueba contradictorio combina eliminación y salud cero. La interfaz también excluye abandono y evacuación final.

No se cambian autorizaciones. Los fallecidos siguen sin votar, administrar recursos, actuar por rol, manipular medicación o avanzar como anfitrión. F5 recupera su fallecimiento y sus restricciones. No hay resurrección, nuevos permisos de espectador, reasignación de roles ni nuevas reglas de sucesión.

## Verificación

- Vitest completo: 793 pruebas aprobadas en 65 archivos. Base anterior: 763 en 62; incremento: 30 pruebas en tres archivos.
- TypeScript: correcto en shared, server y web.
- Compilación: correcta en los tres paquetes, incluida producción Vite.
- git diff --check: correcto.
- docs/: sin modificaciones.

Las pruebas nuevas cubren accidente real de ronda 2, humo de ronda 3, fuga, explosión, derrumbe final y muerte por sabotaje; narrativa neutral para causas no separables; exclusión de abandono; estabilidad y copia de proyecciones; fallecimiento desconectado; panel tras F5 y en resultados; botones deshabilitados; filtros de propietario/partida y limpieza de listeners.

La integración con cuatro sockets reales comprueba un tratamiento envenenado, entrega solo a la víctima, ausencia de datos secretos en los mensajes del fallecido y del Médico, objetivo de Botones intacto, no repetición al publicar snapshots, rechazo de acciones del fallecido, abandono sin falso mensaje, reconexión y conservación del texto tras avanzar de ronda.

## Revisión visual

Edge sin ventana comprobó las cuatro categorías y un abandonado a 1440, 900, 390 y 320 píxeles: veinte combinaciones. Sin desbordamiento horizontal, superposiciones o modales; un solo panel para el fallecido y ninguno para el abandonado. Las decisiones visibles del personaje eliminado permanecen deshabilitadas.

Se han inspeccionado capturas de escritorio y móvil. Son fixtures React con el CSS real, complementados por sockets reales en la prueba de integración; no sustituyen una partida interactiva manual en cuatro navegadores.

Artefactos locales en .cache/10f21/: accident-*.png, gas-*.png, explosion-*.png, unexpected-*.png, abandoned-*.png y layout-result.json. Se regeneran con la prueba personal-death-ui.test.ts y node scripts/ui-check-10f21.mjs.

## Comprobación manual con cuatro navegadores

1. Abrir cuatro perfiles o sesiones independientes, reunir participantes e iniciar la partida.
2. Jugar hasta que un humano fallezca por las consecuencias normales. En su navegador debe aparecer el panel personal sin abrir el historial; en los otros no debe aparecer esa narración en segunda persona.
3. Para humo/gas, revisar la galería de tuberías o la crisis de transporte cuando la salud restante sea insuficiente. Para explosión, dejar fracasar el tercer intento de transporte. Para accidentes o derrumbes, revisar sus desenlaces normales. No se han añadido controles de depuración para forzar daños.
4. Probar también el sabotaje: Botones manipula su medicación una vez; Médico trata un humano lesionado y elegible. Si se activa el desenlace fatal, el paciente debe recibir un mensaje misterioso y los demás solo el relato público. Solo Botones debe ver su confirmación de objetivo. Un tratamiento puede no activar el sabotaje: es el resultado probabilístico previsto.
5. Intentar votar y usar recursos desde el fallecido; los controles deben permanecer deshabilitados y el servidor debe rechazar cualquier solicitud no autorizada.
6. Recargar al fallecido: debe volver el mismo texto, un único panel y ninguna acción recuperada. Avanzar con el equipo y volver a recargar: el mensaje original debe conservarse.
7. Abandonar a un compañero durante un transporte y confirmar que no recibe «Has fallecido» por ese abandono. Revisar también el resultado final de evacuados.
8. Comprobar lectura y desplazamiento a anchura móvil y escritorio. La prueba personal-death-integration.test.ts reproduce de forma determinista la privacidad y F5 con cuatro conexiones, sin cambiar las probabilidades del producto.

Fin exclusivo de 10F.2.1. Trabajo detenido para revisión del usuario.