import { expect, test } from "vitest";
import { analyzeBalance, seededRandom, simulateBalanceGame, BALANCE_SCENARIOS } from "./balance-analysis.js";
import { HISTORICAL_PROBABILITIES, PROPOSED_PROBABILITIES } from "./balance-probabilities.js";

test("historical and proposed reference percentages are explicit and distinct", () => {
  expect(HISTORICAL_PROBABILITIES).toEqual({ LOW: .1, MODERATE: .2, HIGH: .35, EXTREME: .5 });
  expect(PROPOSED_PROBABILITIES).toEqual({ LOW: .2, MODERATE: .35, HIGH: .55, EXTREME: .7 });
});
test("seeded RNG repeats bit for bit and samples remain within [0,1)", () => {
  const first = seededRandom(123); const second = seededRandom(123);
  for (let i = 0; i < 1000; i++) { const x = first(); expect(x).toBe(second()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
});
test("seeded comparative analysis is reproducible and does not silently heal patients", () => {
  const a = analyzeBalance(40, 123); expect(analyzeBalance(40, 123)).toEqual(a);
  expect(a).toHaveLength(16);
  expect(a.every(r => r.meanTreatmentCapacity <= 4 && r.meanTreatmentCapacity <= r.meanMedicalOpportunities)).toBe(true);
  expect(a.find(r => r.scenario === "minimum" && r.model === "historical")!.meanMedicalOpportunities).toBeGreaterThan(0);
});
test.each(BALANCE_SCENARIOS)("no accident reference retains the actual energy constraints: $id", scenario => {
  const result = simulateBalanceGame(scenario, { LOW: 0, MODERATE: 0, HIGH: 0, EXTREME: 0 }, 1);
  expect(result.accidents).toBe(0); expect(result.dead).toBe(0);
  expect(result.completed).toBe(scenario.id !== "limited-packs");
  if (scenario.id === "minimum") expect(result.damage).toBe(80);
  expect(result.evacuated).toBe(result.completed ? scenario.humans : 0);
});
