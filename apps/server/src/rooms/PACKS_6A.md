# Fase 6A: packs administrados por Botones

Decisiones confirmadas en esta fase: únicamente Botones vivo decide la asignación
de packs del inventario compartido, sin votación y para cualquier humano vivo,
incluido él mismo. Solo después de completar una ruta. No hay un límite añadido
por personaje o ronda. Se reutiliza `consumePack()` sin alterar sus reglas:
recuperar hasta 25 de energía, máximo 100, y descontar una unidad; rechazar
destinatario fallecido, energía completa o inventario agotado sin cambios parciales.

## Autorización y ventana de consumo

`pack:give` recibe exclusivamente `requestId`, `windowId` y `targetParticipantId`.
El servidor resuelve la sala, el solicitante, su personaje, rol y estado vital
desde la conexión autenticada. El destinatario se busca solo entre participantes
de esa sala y se transforma a su identificador de personaje interno. No acepta
identidad del autor, rol, cantidad de packs o energía desde el cliente.

La ventana de suministros tiene como identificador la decisión de la ruta
completada: en ronda 1, su decisión conjunta de rescate/desplazamiento; en ronda 2,
la decisión de ruta. Antes de completar la ruta o si el desplazamiento está
bloqueado, `windowId` es null. Avanzar a ronda 2 cierra la ventana anterior y no
se abre otra hasta completar la nueva ruta. Una petición nueva con una ventana
antigua se rechaza. No se habilitan packs para desbloquear rescates o rutas.

## Atomicidad, repetición y reconexión

Cada partida conserva sus recibos de consumo aceptados en `packRequests`, con
identificador, autor, destinatario y ventana. La validación, `consumePack`,
confirmación de estado y guardado del recibo son síncronos, sin await intermedios.
Dos peticiones no pueden gastar la misma última unidad. Los rechazos no gastan
packs ni alteran energía.

Repetir una petición aceptada idéntica confirma el recibo sin volver a consumir
ni emitir otra actualización. Reutilizar su identificador con otro destinatario
o ventana se rechaza como conflicto. Un recibo anterior puede confirmarse después
de avanzar de ronda: esto solo reconoce el consumo pasado y no permite uno nuevo.
Las comprobaciones de sesión y Botones vivo siguen siendo obligatorias.
Los identificadores pertenecen a cada partida; no se mezclan recibos entre salas.

React guarda una entrega pendiente en sessionStorage antes de enviarla. Si no
llega la respuesta permite reintentar con el mismo identificador; al recargar o
reconectar recupera esa petición. Mientras queda pendiente no crea otra entrega.
Una respuesta definitiva limpia la petición. Si no se puede guardar, la UI
explica el problema y no envía el consumo. El servidor es la autoridad sobre
idempotencia; el almacenamiento del navegador no sustituye su registro.

Todo sigue en memoria del servidor. F5 no borra recursos ni recibos; reiniciar
el servidor elimina las partidas como en las fases anteriores.

## Estado actual e historial

`supplies:updated` publica un DTO con ronda, ventana, salud y energía actuales
de los participantes e inventario compartido. Se emite únicamente al canal de
la sala al consumir y en las transiciones existentes. Al reanudar sesión se
envía al socket autenticado. No contiene roles, fichas, credenciales ni riesgos.

La instantánea histórica de ronda 1 se congela al terminar su ruta, antes de
cualquier pack. Para ronda 2 se congelan personajes e inventario al terminar
el desplazamiento; las consecuencias ya registradas permanecen intactas.
Los resúmenes se rotulan «Estado al terminar la ruta (histórico)».
El panel separado «Estado actual del equipo» muestra valores posteriores a los
packs para todos. Solo Botones vivo ve «Gestionar suministros», selección de
destinatario y «Entregar pack» durante una ventana autorizada.

Avanzar utiliza siempre el SimulationState actual, nunca la instantánea histórica:
los packs de ronda 1 afectan a la energía inicial de ronda 2, y los de ronda 2
permanecen en el estado acumulado para la futura ronda 3. No se reinicia inventario.
La política provisional de avance manual por el creador se conserva.

## Pendientes

Si Botones fallece no hay sucesor automático. El servidor rechaza la entrega
desde esa sesión y desde cualquier otro rol. Está pendiente decidir quién podrá
administrar los packs. No se añaden otros momentos de consumo, tratamientos,
reanudación de bloqueos ni ronda 3.

## Pruebas y comprobación manual

`packs.test.ts` prueba permisos y suplantación, reparto a los cuatro humanos,
máximo 100, existencias, fallecidos, ventanas, recursos entre rondas, recibos
repetidos y conservación histórica. Los estados límite de muerte se construyen
solo en las pruebas; no existe una API de depuración en producción.
`voting.test.ts` añade pruebas de Socket.IO para rondas 1 y 2: cuatro vistas
idénticas, rechazo de otros roles, peticiones duplicadas simultáneas, nueva
conexión tras F5, aislamiento de salas y disputa de la última unidad.

1. Ejecutar `npm.cmd run dev:server` y `npm.cmd run dev:web` con Node 24 en PATH.
2. Entrar con cuatro navegadores o pestañas independientes, iniciar y aprobar
   el rescate de ronda 1. El histórico muestra energía 60 e inventario 8/4.
3. Desde Botones abrir «Gestionar suministros», seleccionar a alguien y entregar:
   el estado actual de los cuatro navegadores muestra energía 85 y siete packs;
   la instantánea histórica conserva 60 y ocho packs.
4. Entregar otro al mismo destinatario: queda en 100 y seis packs. El botón se
   deshabilita para él con explicación. Repartir a Botones y a los demás; los
   otros roles no deben tener controles de reparto.
5. Recargar Botones y otro navegador: se conserva el estado actual y la ficha.
   Avanzar desde el creador: la energía recuperada pasa a ronda 2 y el reparto
   queda cerrado durante rescate, preparación y votación de ruta.
6. Completar la ruta de ronda 2 y volver a repartir. Comprobar que el histórico
   de ruta conserva sus valores y el panel actual cambia en los cuatro clientes.
7. Abrir otra sala y verificar que sus recursos no cambian. Para pruebas de
   última unidad, duplicados y reenvíos deterministas ejecutar Vitest; la UI
   evita crear entregas nuevas mientras hay una pendiente.
