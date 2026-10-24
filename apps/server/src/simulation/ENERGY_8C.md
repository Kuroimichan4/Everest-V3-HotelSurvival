# Fase 8C: balance energético y autorización del transporte

## Fuente única

`energy-costs.ts` define `MOVEMENT_ENERGY`. El motor de cada ronda y la
preparación de transporte consumen esa misma fuente. Los catálogos públicos
proyectan los valores; React muestra los datos recibidos, sin su propio catálogo.

| Ronda | Ruta | Energía normal |
| --- | --- | ---: |
| 1 | Paso obligatorio | 25 |
| 2 | Pasillo inestable | 20 |
| 2 | Conductos de ventilación | 30 |
| 2 | Despeje y apuntalamiento | 40 |
| 3 | Puerta cortafuegos | 30 |
| 3 | Galería de tuberías y calderas | 20 |
| 3 | Escombros metálicos y almacén | 40 |

El mismo módulo mantiene separados `NPC_RESCUE_ENERGY = 25` y
`TRANSPORT_ENERGY_PER_PERSON = 15`. Los rescates de NPC no son planes de
transporte humano. No cambian packs (+25 hasta 100), tratamientos (+20),
condiciones iniciales, probabilidades, daños, premios o herramientas.

## Transporte y votantes

`carrierEnergyCost` calcula costeRuta + 15 × númeroTransportados y se reutiliza
en la preparación de alternativas y el pago. Para puerta cortafuegos resulta
30/45/60/75 para cero/uno/dos/tres transportados. El cálculo interno de tres no
habilita una votación para ese caso.

Cada alternativa construye su propio plan con los porteadores capaces de pagar
su coste completo. Se mantiene la política técnica de 8B: todos los capaces de
pagar ese plan participan como porteadores; los demás compañeros que puedan
caminar pagan únicamente su ruta. `assessTransportPlan` valida el conjunto antes
de gastar; un rechazo no paga parcialmente, no consume azar y no abandona a nadie.
Los transportados pagan cero y no recuperan energía automáticamente.

En 8B la viabilidad del plan ya utilizaba el número real de transportados, pero
la autorización de voto solo comprobaba costeRuta + 15. Ahora:

- El electorado común es la unión de los porteadores de alternativas viables de
  transporte; los agotados, muertos y eliminados quedan excluidos.
- Para votar una alternativa que transporta a alguien, el participante debe
  pertenecer al plan de **esa alternativa**. Pagar 45 no autoriza votar un plan
  que exige 60. El servidor lo rechaza con `not-authorized-for-plan`.
- Abandonar se vota dentro del mismo electorado común. La mayoría sigue siendo
  estricta sobre ese conjunto fijo; no cambia según el botón pulsado.
- El contrato público incluye `authorizedVoterIds` por opción. React deshabilita
  las opciones inviables o no autorizadas y explica ambos motivos.
- La selección posterior de destinatario mantiene los permisos de llevar uno.

Esta interpretación conserva la mayoría estable del motor. Con dos votantes,
si uno solo puede pagar llevar a uno y el otro puede pagar llevar a dos, el plan
de dos puede ser viable energéticamente, pero no alcanzar dos votos autorizados.
No se reduce la mayoría para forzar su aprobación: puede quedar pendiente por
desacuerdo. Esta interpretación queda explícita para su revisión; no se ha
introducido una mayoría diferente por alternativa.

Los tiempos provisionales de 60/30 segundos y los estados pendientes de 8B se
mantienen. La apertura vuelve a comprobar energía tras los packs y congela
opciones/electorado. Los resultados, recibos e instantáneas sobreviven a F5
mientras el servidor siga activo, sin repetir pagos, movimientos o accidentes.

## Verificación automatizada

Se conservan todas las pruebas anteriores, adaptando costes y preparando energía
explícita en escenarios que aíslan accidentes, recompensas o permisos. No se
añaden recursos ni controles de depuración a las partidas normales.

- `energy-costs.test.ts`: siete costes, conservación, rescates independientes,
  presupuesto de cero a tres transportados, pago exacto y rechazo por un punto.
- `rooms/transport.test.ts`: estados deterministas con uno/dos agotados,
  porteadores capaces de ambos o solo uno, ningún porteador, permisos por plan,
  packs antes del desplazamiento, ausencia de pagos parciales e idempotencia.
- `Transport.test.ts`: renderizado React con DTO real del controlador del servidor
  para contrastar 30/45/60 y permisos por alternativa.
- `rooms/voting.test.ts`: cuatro sockets, aislamiento, F5, solicitudes simultáneas,
  decisiones de ruta y transporte separadas, sin gastos ni tiradas repetidos.

## Comprobación manual del balance actual

Esta guía sustituye los ejemplos energéticos de las guías 8A/8B. No se ha realizado
verificación visual de navegador desde el agente.

1. Ejecutar `npm run dev:server` y `npm run dev:web`. Abrir
   http://localhost:5173 en cuatro perfiles independientes. Crear una sala,
   unir a cuatro jugadores e iniciar. Identificar a Botones por su ficha.
2. Aprobar RESCATAR en ronda 1 con tres votos. Comprobar 100 − 25 de rescate − 25
   de ruta = **50** por humano y que el resumen muestra ambos costes por separado.
3. Avanzar a ronda 2 y aprobar RESCATAR: quedan **25** por humano. Comprobar las
   opciones públicas de pasillo (20) y apuntalamiento (40). Mantenimiento puede
   revelar ventilación (30), sin publicar su riesgo interno.
4. Aprobar pasillo inestable: quedan **5** por humano. No repartir packs todavía.
   Avanzar a ronda 3: las opciones deben mostrar 30/20/40. Aprobar puerta
   cortafuegos (30): aparece preparación de transporte, sin cobrar la ruta.
5. **Dos agotados y dos capaces de ambos:** durante preparación, Botones entrega
   tres packs a cada uno de dos humanos: pasan de 5 a **80**; los otros siguen
   a 5. Quedan dos packs compartidos. Continuar; los dos porteadores ven las
   alternativas 60 (ambos), 45 (uno) y abandono. Dos votos por llevar ambos
   completan la ruta: cada porteador queda a **20**, los transportados a **5**.
   La puerta aplica su accidente, dos unidades médicas y pérdida de palanca
   habituales. Hacer F5 y comprobar que no se repite el movimiento.
6. **Dos agotados y porteadores capaces solo de uno:** repetir desde una partida
   nueva; en el paso 5 dar solo dos packs a cada futuro porteador: tendrán **55**.
   Llevar ambos (60) debe aparecer inviable; llevar uno (45) sí es viable.
   Aprobar llevar uno y elegir después destinatario. Nadie se elimina hasta la
   segunda decisión. Los porteadores quedan a **10**; el transportado conserva
   5 y el otro agotado queda eliminado definitivamente.
7. **Un agotado y tres capaces:** en otra partida, durante preparación dar dos
   packs a cada uno de tres humanos: tendrán **55**; el cuarto conserva 5.
   Se requieren dos de tres votos para transportarlo. Cada porteador paga 45 y
   queda a **10**. El transportado conserva 5.
8. **Recuperación que evita votar:** en otra partida, tras el paso 4 dar un pack
   a cada humano: todos pasan de 5 a **30**. Continuar sin votación de transporte;
   cada uno paga exactamente 30 y queda a **0**.
9. **Permisos distintos por alternativa:** preparar dos agotados a 5, un humano
   a 55 (dos packs) y otro a 80 (tres packs). Al abrir, el de 55 ve bloqueado
   llevar ambos por falta de energía para ese plan, aunque el de 80 sí pueda.
   Ambos pueden votar llevar uno. La mayoría común permanece en dos.
10. Probar F5 durante las votaciones de transporte y de destinatario. Mantener
    otra sala abierta para comprobar aislamiento. Los afectados agotados siguen
    el proceso sin botones de voto; los abandonados no recuperan ficha ni permisos.

Siguen pendientes las votaciones para tres o más agotados, ausencia de votantes,
resolución futura del desacuerdo, relevos de roles/anfitrión y ronda 4. No hay
persistencia externa: reiniciar el servidor pierde las salas.
