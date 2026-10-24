# Fase 5B: transición y segundo rescate

El creador pulsa «Avanzar a ronda 2» tras el resumen de ronda 1. Es una solución de interfaz provisional, no una regla definitiva. El servidor rechaza avances anticipados, ajenos o repetidos; conserva personajes, recursos, credenciales, fichas e historial. El resumen de ronda 1 queda congelado al avanzar.

El nuevo NPC tiene identidad por ronda (`round-two-survivor`, dentro de su partida) y resolución independiente del NPC anterior. Todos los humanos vivos participan en el rescate, siguiendo el modelo colectivo existente; votar ABANDONAR no exime del esfuerzo si se aprueba RESCATAR.

Se reutiliza RoomVoting con ronda 2 y su motor de mayoría estricta: 60 segundos, segundo intento automático de 30, cierre inmediato. Los votos repetidos idénticos conservan la confirmación previa sin contarse otra vez, igual que en ronda 1; cambiar el voto se rechaza. Los identificadores de decisión e intento impiden reutilizar votos antiguos.

`round:advance` es una solicitud autenticada sin estado enviado por el cliente. `round-two:updated` publica solo situación común en el canal de la sala, al avanzar, votar, vencer un plazo o reanudar sesión. La ficha sigue llegando por el canal privado existente. F5 recupera la misma decisión, plazo, voto propio y resolución, sin recrearlos. El estado sigue en memoria: reiniciar el servidor elimina las partidas.

La resolución es atómica y reutiliza spendEnergy/applyDamage sobre humanos vivos: RESCATAR cuesta 25 de energía; ABANDONAR no cuesta; NO_AGREEMENT abandona al NPC y causa un microterremoto de 10 de daño. Un resultado guardado impide repetir consecuencias. No se ejecuta el motor de rutas ni se aplica desplazamiento, accidente o segunda penalización.

Si falta energía, se conserva el resultado de votación y se publica `resolution-blocked` / `insufficient-energy`, sin pagos parciales ni cambio del NPC. Propuesta pendiente: autorizar un mecanismo de consumo de packs y una reanudación explícita de la resolución. No se implementa sin decidir cuándo y quién puede consumirlos. Tampoco se inicia otra votación si no quedan humanos vivos; el desenlace de ese caso sigue pendiente.

## Comprobación manual

1. Ejecutar `npm.cmd run dev:server` y `npm.cmd run dev:web` en terminales distintas, con Node 24 en PATH.
2. Abrir cuatro pestañas independientes desde cero, crear sala, compartir código, entrar con cuatro nombres e iniciar desde el creador.
3. Aprobar RESCATAR en ronda 1 con tres votos: salud 100, energía 60, ocho packs y cuatro unidades médicas.
4. Avanzar desde el creador: ronda 2 debe conservar esos valores y la ficha privada. Con tres votos RESCATAR, energía 35, salud 100 y ambos NPC rescatados.
5. Repetir en partidas nuevas: ABANDONAR en ronda 2 conserva energía 60; dejar vencer 60 y 30 segundos abandona al segundo NPC, deja salud 90 y energía 60.
6. Recargar una pestaña durante la votación y después del resultado: se conservan plazo, intento, voto y costes. Verificar que otra sala no cambia.
7. El resultado termina en «Pendiente la elección de ruta», sin botones de rutas.

Pendiente para la siguiente fase: interfaz y disponibilidad de rutas por rol, requisitos con especialistas fallecidos, energía insuficiente y uso de packs, orden ante consecuencias mortales y accidentes con pocos supervivientes, y resolución independiente de falta de acuerdo en rutas. Esta fase no decide esos casos ni inicia la siguiente.
