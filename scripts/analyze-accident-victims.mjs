// Ejecutar después de npm.cmd run build. Solo análisis, sin parámetros de partida.
import {mkdir,writeFile} from 'node:fs/promises';
import {analyzeAccidentVictims} from '../apps/server/dist/simulation/balance-analysis.js';
const games=Number(process.argv[2]??10000);const seed=Number(process.argv[3]??20261025);
const report={gamesPerScenario:games,firstSeed:seed,assumptions:[
 'Referencia estadística, no conducta observada de jugadores; 9 escenarios, modelos de dos y tres víctimas.',
 'Probabilidades actuales 20/35/55/70 %, daños, costes y rutas idénticos entre modelos.',
 'Mínimo energético: pasillo principal, galería de tuberías, escalera agrietada, cocina derrumbada, grieta exterior.',
 'Prudente: Mantenimiento activo puede revelar las rutas secretas; ventilación revelada, escombros/almacén, escalera técnica revelada, galería de extracción revelada, puerta giratoria con palanca.',
 'Rescates NPC: se aprueban los dos primeros; NPC final usa su generación real y se rechaza.',
 'Grupos mínimos/rescate: cuatro roles; dos humanos Médico y Botones; un humano Médico. Prudente: cuatro roles; dos humanos Mantenimiento y Botones; un humano Mantenimiento. No se inventan sustitutos ni revelaciones por otros roles.',
 'Sin curación, sabotaje, transporte o abandono automáticos. Botones activo reparte packs mínimos antes de cada esfuerzo.',
 'Un bloqueo de energía detiene ese itinerario de referencia y no demuestra que otras elecciones sean imposibles.',
 'Salud baja: vivo con salud estrictamente inferior a 50 al detenerse la referencia.',
 'Oportunidades médicas: pacientes vivos y heridos por ronda antes/después del recorrido, sin curación ejecutada; capacidad limitada a cuatro unidades y Médico activo.',
 'Muerte por accidente: fallece en el recorrido y habría sobrevivido a su daño ambiental sin el accidente; las demás muertes se contabilizan aparte en meanDead.',
 'Semillas por etapa compartidas: el sorteo de accidente está emparejado antes de extraer víctimas; rondas futuras usan corrientes independientes.',
],results:analyzeAccidentVictims(games,seed)};
await mkdir(new URL('../.cache/',import.meta.url),{recursive:true});await writeFile(new URL('../.cache/10c2-victims.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));