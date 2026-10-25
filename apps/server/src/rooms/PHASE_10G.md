# Fase 10G — Relevo automático del anfitrión

## Problema y solución

El relevo anterior se invocaba solamente desde explosión y muerte por tratamiento manipulado. Una muerte por accidente ordinario podía dejar creatorId asociado al humano eliminado y bloquear los controles que exigen anfitrión vivo.

Ahora finishIfTerminal centraliza la comprobación para cualquier publicación de estado. Espera a que termine la resolución síncrona del movimiento y comprueba primero si corresponde cerrar la partida. Solo si la partida continúa llama al único selector de sucesión. Se eliminan las llamadas particulares de sabotaje y explosión y el callback afterExplosion que ya no se necesita.

El selector conserva al anfitrión si su humano sigue vivo y no abandonado. En otro caso filtra participantes con humano vivo y no abandonado y utiliza el RandomIndex existente (randomInt en producción). Incluye supervivientes agotados o transportados y no exige conexión temporal. El resultado actualiza creatorId antes de emitir room:updated a toda esa sala. Una publicación posterior encuentra al sucesor activo y no repite el sorteo. Si más adelante ese sucesor queda eliminado, corresponde un nuevo relevo.

No se alteran roles, salud, energía, inventario, probabilidades, daños, costes, objetivos ni tiempos. No se añaden mensajes que revelen información privada.

## Causas y finalización

Accidente, daño ambiental, réplica, gas, explosión, envenenamiento, abandono definitivo y daños acumulados llegan a la misma comprobación sobre el estado confirmado, independientemente de la causa. Se conserva el ajuste de electorado existente de cada coordinador; el relevo no reinicia ni sustituye decisiones, votos, preparaciones ni temporizadores.

Si no quedan humanos activos se construye el resultado final existente sin sorteo. Si el último desplazamiento ya completa la evacuación, tampoco hace falta un sucesor. Una partida finalizada no modifica su resultado ni reabre rondas por esta comprobación.

## Archivos de esta fase

Modificados:
- apps/server/src/rooms/manager.ts: punto común de sucesión y selector idempotente; eliminación de invocaciones particulares.
- apps/server/src/rooms/transport.ts: eliminación del callback específico de explosión.

Creados:
- apps/server/src/rooms/host-succession.test.ts: 14 pruebas de coordinación, selección, finalización e idempotencia.
- apps/server/src/rooms/host-succession.socket.test.ts: una prueba con cuatro clientes reales y otra sala en el mismo gestor.
- apps/server/src/rooms/PHASE_10G.md: este informe.

No se modifica React: ya consume room:updated y deriva las acciones de gestión de creatorId. No se modifica el contrato ni se ofrece una operación de cliente para asignarse anfitrión.

## Seguridad y reconexión

Las operaciones del servidor siguen comparando el participante autenticado con creatorId y comprobando sus permisos de rol. El antiguo anfitrión no recupera autoridad por reconectar. El nuevo anfitrión no recibe atribuciones de otros especialistas. Las credenciales existentes recuperan la misma identidad y el creatorId guardado en la partida activa; F5 no sortea. Las salas conservan su estado independiente.

## Verificación

- Suite completa Vitest: 829 pruebas aprobadas, cero fallos, 70 archivos.
- Tras ampliar la comprobación de aislamiento de salas, prueba Socket.IO específica repetida y aprobada.
- TypeScript: correcto tras la última ampliación.
- Compilación de producción: correcta.
- git diff --check: correcto.

Casos nuevos: accidente real en ronda 2 y avance a ronda 3; muerte ambiental sin accidente en ronda 3; réplica tras dos votaciones fallidas y avance posterior; gas y explosión usando sus efectos idempotentes con votación abierta sin cambiar su plazo; abandono definitivo mediante votación real de transporte; tres posibles candidatos RNG; único superviviente agotado; ningún superviviente; aplazamiento durante movimiento y exclusión de una víctima posterior; F5 del antiguo y nuevo anfitrión; desconexión temporal; último desplazamiento; recursos y roles intactos. La suite existente mantiene los casos reales de explosión y sabotaje médico y sus reconexiones. Los cuatro clientes reales comprueban sincronización, emisión única, permisos, F5 e independencia de otra sala del mismo gestor.

No se ha ejecutado una revisión visual interactiva de navegadores en esta fase.

## Revisión manual con cuatro navegadores

1. Crear y completar la sala con cuatro perfiles separados. Anotar quién es anfitrión y los roles privados.
2. Jugar hasta que el anfitrión muera o sea abandonado definitivamente. Comprobar que los cuatro ven el mismo sucesor vivo, sin cambio de roles, recursos ni reinicio de votación o plazo.
3. Continuar con el sucesor: abrir la siguiente decisión o avanzar cuando lo permita la fase. El anterior anfitrión y los otros participantes deben carecer de esos controles.
4. Recargar tanto el antiguo como el nuevo anfitrión: la identidad del sucesor se mantiene. Confirmar que conserva únicamente sus permisos de especialista originales.
5. Desconectar temporalmente al anfitrión vivo: no debe haber relevo. Revisar otra sala para comprobar que no cambia.
6. Al finalizar la evacuación o quedar sin supervivientes, comprobar que no se inicia una ronda nueva ni cambia el resultado.

## Pendientes

El bloqueo por eliminación definitiva queda corregido. La desconexión temporal de un anfitrión vivo sigue sin activar sucesión, como se solicita. La persistencia continúa siendo la existente en memoria: F5 está cubierto; reiniciar el servidor no incorpora almacenamiento nuevo. Queda pendiente la revisión manual interactiva del usuario.

Se conservan los cambios válidos anteriores del repositorio. Sin modificaciones en docs/, dependencias nuevas, commit, push ni avance a otra fase.