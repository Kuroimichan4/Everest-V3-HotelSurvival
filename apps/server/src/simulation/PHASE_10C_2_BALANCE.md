# Fase 10C.2 — Comparación de accidentes

10.000 partidas por escenario y modelo; semilla inicial 20261025: 180.000 recorridos de referencia. Valores medios por partida, sistema anterior de dos víctimas → nuevo de tres.

## Supuestos

- Referencia estadística, no conducta observada de jugadores; 9 escenarios, modelos de dos y tres víctimas.
- Probabilidades actuales 20/35/55/70 %, daños, costes y rutas idénticos entre modelos.
- Mínimo energético: pasillo principal, galería de tuberías, escalera agrietada, cocina derrumbada, grieta exterior.
- Prudente: Mantenimiento activo puede revelar las rutas secretas; ventilación revelada, escombros/almacén, escalera técnica revelada, galería de extracción revelada, puerta giratoria con palanca.
- Rescates NPC: se aprueban los dos primeros; NPC final usa su generación real y se rechaza.
- Grupos mínimos/rescate: cuatro roles; dos humanos Médico y Botones; un humano Médico. Prudente: cuatro roles; dos humanos Mantenimiento y Botones; un humano Mantenimiento. No se inventan sustitutos ni revelaciones por otros roles.
- Sin curación, sabotaje, transporte o abandono automáticos. Botones activo reparte packs mínimos antes de cada esfuerzo.
- Un bloqueo de energía detiene ese itinerario de referencia y no demuestra que otras elecciones sean imposibles.
- Salud baja: vivo con salud estrictamente inferior a 50 al detenerse la referencia.
- Oportunidades médicas: pacientes vivos y heridos por ronda antes/después del recorrido, sin curación ejecutada; capacidad limitada a cuatro unidades y Médico activo.
- Muerte por accidente: fallece en el recorrido y habría sobrevivido a su daño ambiental sin el accidente; las demás muertes se contabilizan aparte en meanDead.
- Semillas por etapa compartidas: el sorteo de accidente está emparejado antes de extraer víctimas; rondas futuras usan corrientes independientes.

## Resultados

| Escenario | Daño | Vivos <50 | Muertes por accidente | Evacuados | Oportunidades médicas |
|---|---:|---:|---:|---:|---:|
| minimum-4 | 247.736 → 318.693 | 1.439 → 1.468 | 0.655 → 1.724 | 3.345 → 2.276 | 16.701 → 16.588 |
| prudent-4 | 14.928 → 22.392 | 0.000 → 0.000 | 0.000 → 0.000 | 4.000 → 4.000 | 5.897 → 8.286 |
| npc-rescues-4 | 247.736 → 318.693 | 1.439 → 1.468 | 0.655 → 1.724 | 3.345 → 2.276 | 16.701 → 16.588 |
| minimum-2 | 183.074 → 183.074 | 0.497 → 0.497 | 1.395 → 1.395 | 0.605 → 0.605 | 8.335 → 8.335 |
| prudent-2 | 14.928 → 14.928 | 0.000 → 0.000 | 0.000 → 0.000 | 2.000 → 2.000 | 0.000 → 0.000 |
| npc-rescues-2 | 183.074 → 183.074 | 0.497 → 0.497 | 1.395 → 1.395 | 0.605 → 0.605 | 8.335 → 8.335 |
| minimum-1 | 91.537 → 91.537 | 0.248 → 0.248 | 0.697 → 0.697 | 0.303 → 0.303 | 4.168 → 4.168 |
| prudent-1 | 4.445 → 4.445 | 0.000 → 0.000 | 0.000 → 0.000 | 0.000 → 0.000 | 0.000 → 0.000 |
| npc-rescues-1 | 11.050 → 11.050 | 0.000 → 0.000 | 0.000 → 0.000 | 0.000 → 0.000 | 1.105 → 1.105 |

| Escenario | Partidas con algún evacuado | Bloqueo energético | Capacidad médica potencial |
|---|---:|---:|---:|
| minimum-4 | 100.00 % → 86.73 % | 0.00 % → 0.00 % | 4.000 → 4.000 |
| prudent-4 | 100.00 % → 100.00 % | 0.00 % → 0.00 % | 2.651 → 2.651 |
| npc-rescues-4 | 100.00 % → 86.73 % | 0.00 % → 0.00 % | 4.000 → 4.000 |
| minimum-2 | 30.27 % → 30.27 % | 0.00 % → 0.00 % | 4.000 → 4.000 |
| prudent-2 | 100.00 % → 100.00 % | 0.00 % → 0.00 % | 0.000 → 0.000 |
| npc-rescues-2 | 30.27 % → 30.27 % | 0.00 % → 0.00 % | 4.000 → 4.000 |
| minimum-1 | 30.27 % → 30.27 % | 0.00 % → 0.00 % | 3.882 → 3.882 |
| prudent-1 | 0.00 % → 0.00 % | 100.00 % → 100.00 % | 0.000 → 0.000 |
| npc-rescues-1 | 0.00 % → 0.00 % | 100.00 % → 100.00 % | 1.105 → 1.105 |

## Interpretación

En mínimo gasto con cuatro humanos, la evacuación individual media cae del 83,64 % al 56,90 % (−26,73 puntos). Las partidas con algún evacuado pasan del 100 % al 86,73 %. El recorrido prudente de cuatro humanos mantiene cuatro evacuados, aunque el daño medio aumenta un 50 %. No se ha reajustado ningún parámetro.

Con dos o un humano ambos límites producen resultados idénticos. Los recorridos prudent-1 y npc-rescues-1 se detienen por energía: cero evacuados no significa muerte de todos. Los rescates con cuatro humanos coinciden en salud con mínimo gasto porque los packs cubren el esfuerzo adicional. Las oportunidades médicas cuentan ventanas potenciales, pueden repetirse para un paciente y no representan curaciones efectuadas; pueden reducirse si el Médico o los pacientes mueren antes.

Reproducción: ejecutar la compilación y después `node scripts/analyze-accident-victims.mjs`. JSON generado en `.cache/10c2-victims.json`. La comparación usa el motor común con un límite contrafactual reservado al análisis; el juego siempre utiliza tres.
