// Antes de ejecutar: npm.cmd run build
// node scripts/analyze-balance.mjs [partidasPorEscenario=10000] [primeraSemilla=20261025]
import { analyzeBalance } from "../apps/server/dist/simulation/balance-analysis.js";
const games = Number(process.argv[2] ?? 10000);
const firstSeed = Number(process.argv[3] ?? 20261025);
console.log(JSON.stringify({ gamesPerScenario: games, firstSeed,
  assumptions: [
    "Análisis de referencia; no resultados observados de jugadores.",
    "Sin curación automática, sin transporte ni abandonos automáticos.",
    "Botones activo entrega el mínimo de packs antes de cada esfuerzo, por orden estable de personaje.",
    "NPC final conserva su generación real y siempre se rechaza en esta referencia.",
    "Oportunidades y capacidad médica se calculan sobre la trayectoria sin curación; no son tratamientos ejecutados.",
    "La referencia forced aplica ambas réplicas propuestas a los dos modelos para aislar el efecto de las probabilidades.",
    "Un bloqueo energético solo indica fracaso del itinerario de referencia, no imposibilidad de otras decisiones.",
  ], results: analyzeBalance(games, firstSeed) }, null, 2));
