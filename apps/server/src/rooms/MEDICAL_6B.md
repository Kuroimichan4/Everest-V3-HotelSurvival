# Fase 6B: tratamientos directos del Médico

La decisión confirmada en esta fase sustituye la antigua propuesta de votación
médica de 20 segundos de docs/. No existe votación médica: solo el Médico vivo
decide y administra una unidad a un humano vivo, incluido él mismo. Los documentos
originales se conservan. No se implementa atención a NPC ni ronda 3.

## Motor y límite por ronda

`administerTreatment` en operations.ts reutiliza el patrón inmutable de las
operaciones y `replaceCharacter`. Rechaza destinatario inexistente o fallecido,
uso previo en la ronda, salud completa y falta de unidades sin cambiar el estado.
Un éxito restaura hasta 20 de salud, máximo 100, descuenta exactamente una unidad
médica y añade un registro a `SimulationState.medicalTreatments` con ronda,
identificador interno del humano y recuperación real. Energía y packs no cambian.

El límite se consulta por pareja (ronda, personaje), no por equipo ni por momento
del tratamiento. Curarse antes de la ruta impide recibir otra unidad después de
esa ruta aunque el personaje vuelva a resultar herido. Los registros anteriores
no se borran al avanzar; al consultar otra ronda el personaje vuelve a ser elegible
si sigue vivo, herido y quedan unidades. Se conserva todo el inventario.

**Salud completa sigue PENDIENTE:** `health-full-pending` es un rechazo provisional
seguro, sin gasto ni registro de uso. La interfaz lo indica expresamente y
deshabilita el botón; no se convierte en una regla definitiva.

## Autorización, momentos y resolución única

`medical:treat` acepta solamente requestId, gameId, round y targetParticipantId.
El gestor obtiene sala, solicitante, personaje, rol y estado vital de la sesión
autenticada del socket. El destinatario se busca exclusivamente entre humanos
participantes de esa sala. Un rol o autor añadido al payload se rechaza. Antes de
iniciar una partida no se admiten tratamientos; partida o ronda ajenas tampoco.

En las rondas 1 y 2 iniciadas se permite tratar en los estados estables antes o
después del desplazamiento, incluidas las votaciones generales abiertas. No se
intercala con una resolución de rescate o ruta, pues estas son síncronas.
Un tratamiento no modifica plazos, electorado u opciones; no abre una votación,
consume azar, repite consecuencias ni avanza de ronda.
Si existe una resolución bloqueada, curar no la reintenta ni la da por completada.
Su reanudación continúa fuera de alcance.

Cada partida conserva `treatmentRequests`: recibos de tratamientos confirmados
con solicitud, autor, destinatario y ronda. Validación, salud, inventario, registro
de uso y recibo se confirman sin await. Dos solicitudes para la última unidad
no pueden gastarla ambas. Un rechazo no deja efectos parciales.

Una repetición idéntica de un recibo aceptado solo confirma el éxito pasado,
sin tratar ni emitir otra actualización. Cambiar su destinatario o ronda con
el mismo identificador produce `request-conflict`. Una petición nueva de una
ronda anterior se rechaza. Confirmar un recibo antiguo tras avanzar no aplica
una cura en la ronda nueva. Sesión y autoridad del Médico vivo siguen exigidas.

React guarda la petición pendiente en sessionStorage antes de enviarla. Ante
respuesta perdida permite reintentar con el mismo identificador y la recupera
al recargar o reconectar. No crea otra mientras exista una pendiente. Los recibos
y límites efectivos viven en el servidor, no se confía en el navegador.
F5 conserva los datos; reiniciar el servidor elimina las partidas en memoria.

## Sincronización e historial

`medical:updated` publica al canal de la sala personajes y salud actuales,
inventario y registros autorizados de tratamientos, traducidos a identificadores
públicos de participantes. No publica autor, roles, fichas, credenciales, riesgos
de rutas ni aleatoriedad. La reconexión recibe la misma vista desde el servidor.

Se reutiliza la publicación de suministros: una cura actualiza también el panel
actual de packs, y una entrega de pack actualiza el inventario visible en el panel
médico. Botones conserva íntegra su autoridad y sus ventanas de distribución.
Las fichas siguen por su canal privado.

`Medical.tsx` muestra unidades, salud y quién recibió tratamiento en la ronda.
Solo el Médico vivo ve selección y «Administrar tratamiento». El resto consulta
el estado común. Se conserva el estilo existente.
Las instantáneas históricas de las rutas no cambian con tratamientos posteriores;
una cura anterior sí forma parte del estado con que se atraviesa la ruta.
La transición existente a ronda 2 utiliza salud e inventario actuales, no el
resumen histórico, y conserva los registros anteriores.

## Pendientes

- Decisión definitiva sobre solicitudes a humanos con salud completa.
- Sustitución del Médico fallecido: no hay transferencia automática a otro rol.
- Tratamientos de NPC y sus reglas especiales.
- Reanudación explícita de resoluciones bloqueadas y futuras rondas.

## Comprobación manual

1. Arrancar web y servidor con los scripts existentes y Node 24 en PATH. Entrar
   en una sala con cuatro navegadores o pestañas independientes.
2. Al iniciar ronda 1 todos tienen salud 100. El Médico ve la sección y el aviso
   de salud completa pendiente; no se permite gastar unidades. Los demás no ven
   botón de tratamiento.
3. Para producir lesiones reproducibles, dejar vencer 60 y 30 segundos del
   rescate de ronda 1. Se termina la ruta con salud 90 para todos y cuatro unidades.
4. El Médico puede curarse o elegir otro humano: queda en 100 y el inventario
   pasa a tres. Los cuatro clientes muestran la marca de tratamiento. El histórico
   de ruta conserva salud 90 y cuatro unidades; el estado actual refleja la cura.
5. Recargar Médico y otro participante: se conservan salud, unidades, ficha y
   límite. No se puede repetir el tratamiento del mismo humano en esa ronda.
6. Avanzar a ronda 2 desde el creador. Los heridos no tratados conservan salud 90
   y las unidades restantes. Curar antes de desplazarse mientras se vota el rescate
   no reinicia el voto. Si alguien ya tratado en ronda 1 sigue herido, puede recibir
   una unidad en ronda 2; el límite es por ronda.
7. Completar una ruta. Si ocurre un accidente, tratar después a un herido que aún
   no recibió unidad en ronda 2. Si ya se trató antes, una lesión nueva no elimina
   el límite. No cambia el resultado histórico del accidente ni sus víctimas.
8. En otra sala comprobar independencia de salud, inventario y tratamientos.
   Botones sigue pudiendo repartir packs únicamente tras completar una ruta.

Las pruebas deterministas del motor están en simulation/medical.test.ts y las de
autorización e historial en rooms/medical.test.ts. Las de Socket.IO en voting.test.ts
verifican antes/después de ruta, cuatro vistas iguales, sincronización de ambos
paneles, reconexión real, duplicados simultáneos, última unidad entre dos humanos,
aislamiento y ausencia de votos, nuevas tiradas o avance por tratar.
