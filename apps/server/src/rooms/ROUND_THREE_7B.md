# Fase 7B: ronda 3 multijugador

## Entrada y preparación

El anfitrión vivo puede pulsar «Avanzar a ronda 3» solamente cuando el recorrido
de ronda 2 figura como completado. `round-three:advance` autentica al solicitante,
comprueba ese requisito y llama a `beginRoundThree`. La transición cambia solo
currentRound: conserva personajes, inventario, herramientas, registros médicos,
NPC y resoluciones anteriores. Una repetición confirma el estado existente sin
volver a entrar ni emitir otra transición. No se añade un NPC de ronda 3.

El resumen de ronda 2 queda congelado al avanzar; el estado de entrada procede
del estado actual, incluidos packs y curaciones posteriores a aquella ruta.
La preparación no abre un temporizador. El anfitrión vivo abre la elección con
`round-three:open`, siguiendo la misma política provisional de debate y apertura
manual de ronda 2. Repetir la apertura no crea otra decisión o temporizador.
La autoridad del anfitrión si fallece no se transfiere automáticamente.

La vista pública tiene tres opciones, con nombre, descripción general y coste.
Se utilizan los nombres generales aprobados en 7B: cortafuegos, galería de
tuberías y calderas, escombros metálicos y almacén. Este último nombre es ahora
explícitamente público; no se publica con él el conocimiento especializado de
Botones ni las cantidades de recursos. El catálogo de 7A no se modifica.

## Votación y consecuencias

Se reutiliza RoomVoting y el motor puro existente, con opciones de 7A y ronda 3:
60 segundos, segundo intento automático de 30, mayoría estricta de humanos vivos
y cierre inmediato. Desconectarse no elimina a un humano vivo del electorado.
Los fallecidos no votan. Con un único vivo puede cerrarse la decisión con un voto,
pero el motor bloquea después el recorrido por el caso aún pendiente.

La identidad del votante se obtiene de su sesión; el payload solo puede contener
decisionId, attemptId y optionId. Se rechazan votos ajenos, opciones desconocidas,
intentos antiguos, cambios de voto y repeticiones del mismo voto en un intento
abierto (`duplicate-vote`), sin alterar la política de las rondas anteriores.
No hay elecciones médicas ni de packs.

Al cerrarse, se registra una sola selección. Una ruta aprobada se entrega al motor
de 7A mediante `resolveRoundThreeChoice`. Si ambos intentos fallan se registra
NO_AGREEMENT, el terremoto y el bloqueo de cortafuegos y escombros. Se pasa
obligatoriamente `pipe-gallery` al mismo motor, sin duplicar su lógica:

- Coste 10 por vivo que atraviesa.
- Daño ambiental 20 por humano que atraviesa.
- Una tirada independiente de accidente con las reglas aprobadas de la galería.
- Palanca conservada y sin recompensas de las otras rutas.

**El terremoto no aplica daño directo.** No se reutiliza la penalización de diez
de salud de rondas anteriores. La pérdida de palanca de cortafuegos tiene su
propio temblor posterior, también sin daño directo adicional.

La selección, el terremoto y las rutas bloqueadas se conservan en la partida.
El estado devuelto por 7A se conserva siempre, incluso si contiene un bloqueo.
Su registro impide nuevas tiradas, costes o recompensas. Votos tardíos, F5,
reaperturas y reenvíos no repiten las consecuencias. No se declara completada
una ruta bloqueada ni se la reintenta automáticamente después de una curación.

## DTO, privacidad y resúmenes

`round-three:updated` se emite al canal de la sala; al reanudar sesión se envía
también su estado al socket autenticado. Se construye campo a campo y transforma
víctimas internas a participantes públicos con nombre y daño. No se serializan
probabilidades, peligro interno, RNG, fichas o credenciales.

En preparación no hay resultado de exploración, premios o instantánea final.
Solo tras completar el motor se publican recursos realmente encontrados, destino
explorado, accidente, daño ambiental, pérdida de palanca y bloqueo del regreso.
Las fichas existentes permanecen privadas: Médico conoce la ubicación de la
conferencia y Botones el almacén sin cantidades. No se programa una revelación
automática ni un mecanismo de compartir conocimientos en esta ronda.

`RoundThree.tsx` presenta preparación, voto con contador, elección o galería
forzosa, terremoto, bloqueo explícito y resultado. La instantánea histórica guarda
salud, energía, inventario y palanca al terminar la ruta. Se distinguen víctimas
del accidente y del humo/gas. Se conserva además el estado de los dos NPC previos.
El panel de suministros muestra el estado actual después de consumos y curas;
la palanca no tiene operaciones posteriores a la ruta en esta fase.

## Packs y tratamientos

Los contratos y el estado admiten ahora ronda 3. La nueva ventana de packs se
abre únicamente con un recorrido de ronda 3 completado y usa su identificador.
Mientras se prepara, vota o está bloqueado, no puede utilizarse la ventana antigua
de ronda 2 ni consumir packs. Botones mantiene su autoridad exclusiva.

El Médico conserva sus tratamientos directos antes y después del recorrido.
Los usos se consultan por ronda y destinatario: un uso en ronda 2 no consume
el límite de ronda 3; un tratamiento antes de la ruta sí impide otro después
en esa misma ronda. No se reinician recursos ni registros. Las peticiones
pendientes recuperadas tras F5 aceptan ahora ronda 3. Recibos antiguos solo
confirman efectos pasados; nunca crean otro consumo. Los históricos no cambian.

## Pruebas y pendientes

Las pruebas de simulación cubren transición preservando estado y galería forzosa
con y sin accidente, comprobando que no existe daño extra del terremoto.
Las de salas comprueban mayorías con uno a cuatro vivos y bloqueos por energía,
palanca y fallecimientos excepcionales. Las de Socket.IO cubren las tres rutas,
ambas recompensas del almacén, acuerdo en el segundo intento, fallo de los dos,
cuatro vistas iguales, aislamiento, privacidad, duplicados, F5 en preparación,
votación, final y bloqueo, y suministros y tratamientos de ronda 3.

Continúan pendientes los casos de un superviviente, muertes por daño acumulado,
palanca ausente, energía insuficiente y recuperación de bloqueos. Se conservan
los rechazos seguros de 7A. También siguen pendientes la sustitución de Médico
o Botones fallecidos y la decisión definitiva sobre salud completa.
No hay transición a ronda 4. Todo sigue en memoria: F5 conserva la partida,
reiniciar el servidor la elimina.

## Comprobación manual con cuatro jugadores

1. Arrancar servidor y web con los scripts existentes y Node 24 en PATH. Crear
   una sala, entrar cuatro participantes e iniciar la partida.
2. Para un recorrido sencillo de prueba aprobar ambos rescates y el pasillo de
   ronda 2. Sin accidentes quedan 25 de energía por humano. Antes de avanzar,
   Botones puede entregar un pack a cada uno: quedan 50 y cuatro packs compartidos.
   Este paso permite probar también escombros, que cuesta 30. Si solo quedan 25
   y no se reparten packs antes de avanzar, esa ruta debe bloquearse por energía.
3. El anfitrión pulsa «Avanzar a ronda 3». Comprobar las tres opciones, ausencia
   de contador durante preparación, ficha privada y conservación de recursos.
   Médico puede tratar heridos antes de votar, con su límite nuevo de ronda 3.
4. Abrir la votación y reunir tres votos iguales. Probar cada ruta en una partida
   nueva: cortafuegos resta 20, añade dos unidades médicas y pierde la palanca;
   galería resta 10 y siempre causa 20 de daño ambiental; escombros resta 30 y
   añade exclusivamente cuatro u ocho packs. Si ocurre accidente comprobar las
   dos víctimas y el daño adicional por su causa.
5. En otra partida no votar hasta vencer 60 y 30 segundos. Deben aparecer el
   terremoto, las dos rutas bloqueadas y la galería forzosa. Sin accidente, humanos
   que empezaron con salud 100 terminan en 80, no en 70; con accidente dos quedan
   en 50 y el resto en 80. No se obtienen premios de otras rutas.
6. Recargar durante el voto y tras el resultado: se conservan decisión, intento,
   plazo, voto propio, víctimas y premios. Repartir packs y curar después de la
   ruta: cambian los paneles actuales de los cuatro clientes, no el histórico.
7. Mantener otra sala abierta para comprobar independencia. No debe aparecer
   información de otros roles ni porcentajes ocultos en los mensajes públicos.

Los accidentes y premios no se fuerzan desde el navegador. Para ambas ramas
reproducibles usar las pruebas deterministas: `npm.cmd test`,
`npm.cmd run typecheck`, `npm.cmd run build` y `git diff --check`.
