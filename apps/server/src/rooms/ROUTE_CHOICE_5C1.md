# Fase 5C.1: preparación y elección de ruta

Después de confirmar la resolución del NPC de ronda 2 se crea una preparación
sin temporizador. Si el rescate queda bloqueado por energía, no se abre esta fase.
Se muestran pasillo y apuntalamiento con los requisitos existentes de 5A.
Mantenimiento conserva en su ficha privada el conocimiento de los conductos.

Política **provisional para revisión**, no regla definitiva: el creador vivo y
autenticado pulsa «Abrir votación de ruta» después de la conversación. Puede
abrirla sin que se hayan revelado los conductos. No hay apertura automática,
confirmaciones de todos ni obligación de revelar. Si el creador no está
disponible, la preparación espera; no se decide aquí la transferencia de control.

Durante la preparación, `route:reveal` permite al Mantenimiento vivo autenticado
revelar públicamente la existencia de los conductos. La identidad y el rol se
obtienen de la sesión del socket, nunca de parámetros del cliente. La revelación
es un único registro booleano por partida; repetirla confirma el mismo estado sin
otra emisión ni otra entrada. No se publican rol, ficha ni credenciales del autor.

`route:open` congela las opciones y sus requisitos para ambos intentos. Una
revelación nueva posterior se rechaza; una revelación ya confirmada conserva su
respuesta idempotente. Abrir otra vez tampoco crea otra decisión o temporizador.
Los votos solo admiten decisionId, attemptId y optionId, comprobados por el motor
con la identidad de sesión. Ventilación no pertenece a las opciones del motor si
no se reveló antes de abrir. Las opciones bloqueadas tampoco se incorporan.

Se reutilizan RoomVoting y el motor puro existente: primer intento de 60 segundos,
segundo automático de 30, mayoría estricta de humanos vivos y cierre inmediato.
La desconexión no elimina a un humano vivo del electorado. Un nuevo intento borra
los votos del anterior. No se permite cambiar el voto dentro del mismo intento.

`round-two:updated` transmite a la sala la preparación, las opciones autorizadas,
el plazo y el resultado; `vote:own` sigue siendo privado al reanudar sesión.
El resultado definitivo de ruta está en `routeChoice.result`, con decisionId y
outcome (identificador de ruta o NO_AGREEMENT). El campo heredado `vote.result`
solo representa rescates y NO_AGREEMENT; una ruta aprobada se consulta en
`routeChoice.result`. Los datos sobreviven a F5 y reconexiones, pero siguen en
memoria: reiniciar el servidor elimina las partidas.

Las vistas de 5A se proyectan campo a campo: identificador, nombre y coste,
añadiendo solamente el bloqueo de requisitos. Nunca se serializa el catálogo
interno: el peligro real BAJO y el 10 % de ventilación no llegan a ningún rol.

La elección guarda un resultado único y se detiene. No paga desplazamientos,
consume azar, aplica accidentes o daños, ejecuta la consecuencia de NO_AGREEMENT
ni avanza a ronda 3. El microterremoto y avance forzoso por la ruta de mayor
peligro estructural quedan pendientes para una fase posterior.

## Límites pendientes

- Apuntalamiento sin alguno de sus especialistas: se conserva el bloqueo de 5A
  `specialist-availability-pending`; no se decide herencia de conocimientos.
- Muerte de Mantenimiento antes de revelar: no hay sustitución ni revelación
  automática. Solo se impide actuar a fallecidos; el desenlace sigue sin definir.
- Uno o ningún humano vivo conserva los bloqueos de requisitos de 5A; no se
  define un final nuevo ni una excepción de votación.
- La política de apertura manual, incluido el creador ausente o fallecido, debe
  revisarse antes de considerarla definitiva.

## Verificación

Las pruebas de Socket.IO usan cuatro personajes vivos y dos salas en preparación.
Cubren ocultación, autorización, publicación a los cuatro sockets, opciones
congeladas, votos manipulados, repetición, tres votos de mayoría, las tres rutas,
60/30 segundos, acuerdo en segundo intento, NO_AGREEMENT y reconexión con nueva
conexión durante y después del voto. Comprueban que no cambien salud, energía o
inventario, que los resultados no se dupliquen y que no se filtren riesgos.

Prueba manual sugerida: cuatro navegadores, completar ambos rescates, comprobar
las dos opciones iniciales, revelar desde Mantenimiento, recargar, abrir desde
el creador y votar la ruta con tres participantes. Repetir sin revelar: los
conductos no aparecen y ya no pueden revelarse al abrirse la votación.
