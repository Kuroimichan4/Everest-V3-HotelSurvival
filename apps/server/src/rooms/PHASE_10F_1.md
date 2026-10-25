# Fase 10F.1 — Suplemento técnico y sabotaje médico secreto

## Recuperación y alcance

Se revisaron git status y git diff antes de continuar. Se conservaron los cambios previos de 10B–10E.1 y los de la ejecución interrumpida de 10F.1; no se reinició el trabajo ni se revirtió el repositorio.

Ya estaban implementados el cálculo de esfuerzo por participante, el estado secreto del sabotaje, la integración inicial de tratamientos, contratos privados, evaluación de objetivo y pruebas del motor/coordinador. La prueba de cuatro conexiones y seis rondas también quedó recuperada. Faltaban completar los casos de relevo del anfitrión y último humano, adaptar expectativas antiguas a los costes aprobados, verificar muertes durante transporte y ejecutar todas las comprobaciones finales.

Se ha completado exclusivamente 10F.1. No se modifica docs/, la interfaz, las probabilidades de accidente, el número de víctimas, el momento de visibilidad del riesgo ni las otras rutas. Sin nuevas dependencias, commit ni push.

## Archivos creados

- apps/server/src/simulation/medical-sabotage.ts: sustitución secreta, modelo interno, umbral y frases de muerte incierta.
- apps/server/src/simulation/medical-sabotage.test.ts: reglas, límites del RNG, rechazos, inventario, NPC, objetivos y narrativa.
- apps/server/src/simulation/shoring-effort.test.ts: suplementos, energía efectiva, transporte, rescate NPC, atomicidad y recibos.
- apps/server/src/rooms/medical-sabotage.test.ts: permisos, idempotencia, reconexión, electorado, tratamiento y transporte.
- apps/server/src/rooms/medical-sabotage.socket.test.ts: mensajes reales de cuatro clientes, privacidad, aislamiento, seis rondas y relevo del anfitrión.
- apps/server/src/rooms/PHASE_10F_1.md: este informe.

## Archivos modificados por 10F.1

Producción:
- apps/server/src/simulation/energy-costs.ts: suplemento técnico centralizado de 5.
- apps/server/src/simulation/transport.ts: costes efectivos por rol para clasificación, porteadores, viabilidad y pagos.
- apps/server/src/simulation/routes.ts: coste de despeje y resultado de cargos por participante.
- apps/server/src/simulation/round-two-movement.ts: conservación de cargos reales en el recibo de movimiento.
- apps/server/src/simulation/state.ts: estado secreto y registros narrativos separados.
- apps/server/src/simulation/operations.ts: tirada únicamente tras validar tratamiento y resolución atómica.
- apps/server/src/simulation/objective-evidence.ts: objetivo nuevo de Botones y evidencias privadas sin atribución pública.
- apps/server/src/simulation/final-result.ts: incorporación de muerte incierta al resultado público.
- apps/server/src/rooms/manager.ts: autenticación, ventanas, fuentes de azar independientes, proyecciones privadas, tratamientos y relevo reutilizado.
- apps/server/src/rooms/transport.ts: preparación según esfuerzo efectivo, cargos y recálculo por fallecimiento.
- apps/server/src/rooms/voting.ts y apps/server/src/voting/engine.ts: actualización del electorado y votos afectados sin reiniciar intento ni plazo.
- apps/server/src/rooms/socket.ts: acción privada y recuperación de su estado solo para Botones.
- apps/server/src/rooms/character-sheets.ts: sustitución del objetivo individual de Botones.
- packages/shared/src/index.ts: contratos privados, narración médica y cargos reales de ronda 2.

Pruebas anteriores adaptadas, sin suprimir casos:
- apps/server/src/simulation/energy-costs.test.ts
- apps/server/src/simulation/routes.test.ts
- apps/server/src/simulation/round-two-movement.test.ts
- apps/server/src/simulation/objective-evidence.test.ts
- apps/server/src/rooms/character-sheets.test.ts
- apps/server/src/rooms/route-availability.test.ts
- apps/server/src/rooms/voting.test.ts

Los demás cambios que muestra git pertenecen a fases anteriores y se conservan.

## Suplemento energético

Despeje y apuntalamiento conserva su base de 40. Mantenimiento y Arquitecto/Ingeniero añaden 5 cuando caminan o actúan como porteadores; Médico y Botones pagan 40. Cada porteador añade los 15 existentes por humano transportado. Un transportado no paga movimiento ni suplemento porque no realiza el esfuerzo.

El mismo cálculo alimenta disponibilidad de ruta, clasificación de agotados, alternativas viables, autorización de porteadores y pago final. Un técnico con 44 no se trata como caminante suficiente; un técnico porteador de un humano necesita 60, frente a los 55 de los otros roles. No hay energía negativa ni pagos parciales de movimiento. El coste de rescate NPC permanece separado y no se vuelve a cobrar al reescoger una ruta.

Pasillo principal y Conductos de ventilación conservan sus costes. El recibo de ronda 2 almacena los cargos efectivos por personaje y la vista de resultado los proyecta por participante. Las cantidades privadas se filtran por sesión. La reproducción del mismo desplazamiento no vuelve a cobrar ni sortear.

### Contradicción técnica preservada

La restricción anterior exige que Mantenimiento y Arquitecto estén vivos y no abandonados; no exige que caminen. Por ello sigue siendo posible transportar a un especialista vivo que no tenga energía para realizar el trabajo técnico. Se conserva esta regla, sin sustitutos automáticos ni cobro a un transportado. Si falta un especialista activo, despeje continúa bloqueado. Resolver la contradicción requeriría una regla nueva, fuera de esta intervención.

## Sabotaje y tratamiento

Solo la sesión autenticada de Botones puede solicitar medical:sabotage con gameId y requestId. El servidor verifica identidad, existencia de medicación, estado de partida y ventanas compatibles con los tratamientos: rondas 1–3 conforme al permiso actual; rondas 4–6 conforme a sus ventanas de suministros. No hay voto ni coste de energía.

La manipulación sustituye medicación: no modifica inventory.medicalUnits. Se registra una única operación secreta en la partida. Repetir su identificador devuelve el recibo; otro identificador no permite manipular de nuevo. F5 recupera el mismo estado mientras el servidor siga activo.

Un tratamiento humano primero valida Médico activo, sesión, partida, ronda, ventana, paciente vivo/no abandonado, salud elegible, existencias, límite de uno por humano y ronda, e identificador de solicitud. Solo entonces el sabotaje pendiente realiza una muestra de la fuente de azar médica inyectada.

El criterio es sample < 0.25, con muestras válidas en [0,1): 0 y valores inmediatamente inferiores a 0.25 envenenan; 0.25 y superiores no. No depende del número de unidades restantes. Una tirada fallida cura normalmente hasta +20, consume una unidad y mantiene el sabotaje pendiente. No se sortean unidades de un conjunto decreciente.

Una tirada favorable consume exactamente una unidad, deja directamente salud cero, registra tratamiento con restauración cero, registra una muerte de causa incierta y consume el sabotaje. No se publica un estado intermedio de curación. Los tratamientos posteriores no vuelven a tirar por esta manipulación. Los rechazados y las repeticiones no gastan otra unidad ni generan otra muerte.

El azar de tratamiento y el de narrativa son inyectables por separado del azar de rutas (cuarto y quinto parámetros de RoomManager). Las frases describen un tratamiento normal, empeoramiento repentino, fallecimiento e incertidumbre; no contienen autoría ni procedimientos reales. Cambiar la frase no altera el resultado. Una muestra narrativa inválida usa una frase de reserva.

El consumo especial de una unidad médica para el NPC final no llama al tratamiento humano: no tira, no consume el sabotaje y no acredita el objetivo.

## Fallecimientos, votaciones y anfitrión

La salud cero reutiliza la exclusión existente: sin voto, packs, tratamiento nuevo, manipulación ni acciones de rol. No se reasignan profesiones ni se revive a nadie.

Las votaciones afectadas conservan identificador, intento y vencimiento. Se retiran votos de fallecidos, se recalcula la mayoría estricta y se cierra inmediatamente si ya existe mayoría válida. En transporte se recalculan porteadores/opciones y se retiran los votos a un destinatario que ya no es viable. Si muere el único agotado, deja de ser necesario transportarlo y se intenta el movimiento normal, sin inventar un transporte aprobado.

Según la confirmación del usuario, la muerte por sabotaje del anfitrión usa el mismo mecanismo aleatorio de relevo que la explosión. Los candidatos son exclusivamente humanos vivos y no abandonados. Se actualiza creatorId y se emite room:updated; no se alteran roles. Repetir tratamiento, actualizar o reconectar no vuelve a elegir anfitrión. El antiguo pierde los controles de anfitrión. Si no hay candidatos, se usa el desenlace de ausencia de humanos activos.

## Objetivos e inventario agotado

Botones cumple exclusivamente por una muerte humana atribuida a su manipulación registrada. Sin manipulación o sin víctima queda incumplido al finalizar, aunque se hayan rescatado NPC. Las muertes por accidente, explosión, abandono u otras causas no lo acreditan. También puede ser víctima el propio Botones: conserva acceso autenticado a su resultado privado y lo recupera tras F5.

El paciente envenenado aparece como fallecido en las evidencias del Médico, conforme a su objetivo vigente. Es un tratamiento registrado, aunque no restaure salud. La evidencia del Médico no expone manipulación ni autoría.

Si se agotan las unidades tras tiradas fallidas, no aparece una víctima ficticia ni se acredita el objetivo. Los NPC siguen contando en los resultados colectivos como antes.

## Privacidad y contratos para 10F.2

El estado interno medicalSabotage conserva autor, usos, activaciones y víctima. Nunca se añade a los DTO públicos. PrivateMedicalSabotage contiene únicamente gameId, performed, objectiveFulfilled, canManipulate y reason. Solo la sesión de Botones recibe medical:sabotage-private, incluida la reconexión. La respuesta privada de la acción tampoco se difunde por la sala.

Médico y otros roles conservan inventario normal, estados médicos autorizados y una narración de muerte incierta. No reciben estado pendiente, autor, muestras aleatorias, número de usos fallidos ni cumplimiento de Botones. El resultado público incluye únicamente el fallecimiento y la frase incierta; la autoría solo se usa para su evaluación privada.

Las pruebas inspeccionan mensajes reales recibidos por cada cliente durante la manipulación, el fallecimiento y una partida completa. No dependen de ocultación por React. También verifican aislamiento entre salas.

## Validación final

- Vitest completo: 740 pruebas aprobadas en 60 archivos (base de 10E.1: 686/56; incremento: 54 pruebas y 4 archivos de pruebas).
- TypeScript de shared, server y web: correcto.
- Compilación de los tres paquetes y Vite: correcta.
- git diff --check: correcto.
- docs/: sin modificaciones.

Se cubren límites exactos de RNG, muestras inválidas con rechazo atómico, tratamientos rechazados y duplicados, una manipulación y una muerte, agotamiento sin víctima, tratamiento de Botones, NPC médico, objetivos, cargos 45/40, transporte y rescate, recibos y privacidad. Cuatro clientes reales verifican seis rondas y F5; otros casos reales verifican envenenamiento del anfitrión con tres candidatos, un único candidato válido y muerte del último humano, incluyendo ausencia de un segundo sorteo y recuperación del nuevo anfitrión.

## Pendiente para 10F.2 y limitaciones

Quedan la interfaz del botón secreto, su habilitación, confirmación y resultado privado, sus listeners de cliente, y la presentación visual contextual de las nuevas narraciones médicas. Los contratos y datos del servidor están listos. No se ha añadido el botón ni se ha rediseñado la interfaz en 10F.1.

El suplemento técnico y los cargos reales ya existen en servidor; cualquier explicación visual adicional de esos cargos puede utilizar el contrato de resultados. La contradicción de especialistas transportados se mantiene documentada. Si un fallecimiento deja agotados pero ningún porteador elegible, el transporte conserva un bloqueo explícito seguro, como en el caso análogo de gas, sin inventar una votación o una decisión colectiva.

La persistencia continúa siendo la de la instancia de servidor activa; no se añade base de datos. Los errores técnicos de azar no generan pagos ni estados parciales.

Fin exclusivo de 10F.1. Esperando revisión del usuario; 10F.2 no iniciada.