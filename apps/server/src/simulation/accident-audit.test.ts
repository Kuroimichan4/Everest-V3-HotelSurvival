import { expect, test, vi } from "vitest";
import { createInitialState } from "./state.js";
import { traverseRouteEffects, traverseRoute } from "./routes.js";
import { resolveRoundThreeRoute } from "./round-three-routes.js";
import { internalIntermediateRoute } from "./intermediate-rounds.js";
import { ROUND_FOUR_ROUTES } from "./round-four.js";

/** Diagnóstico independiente del catálogo activo: conserva los umbrales históricos y propuestos. */
const thresholds = [0.1, 0.2, 0.35, 0.5, 0.55, 0.7];
test.each(thresholds)("exact stratified grid represents probability %s without percent/unit errors", probability => {
  const state = createInitialState();
  let accidents = 0;
  for (let i = 0; i < 1000; i++) {
    let calls = 0;
    const random = () => calls++ === 0 ? i / 1000 : 0;
    const result = traverseRouteEffects(state, { energyCost: 10, accidentProbability: probability, accidentDamage: 5 }, random);
    if (!result.ok) throw new Error(result.error);
    if (result.accident) accidents++;
    expect(calls).toBe(result.accident ? 4 : 1);
  }
  expect(accidents).toBe(probability * 1000);
});
test.each(thresholds)("threshold %s uses a strict boundary and one accident roll", probability => {
  for (const [sample, accident] of [[0, true], [probability - Number.EPSILON, true], [probability, false], [.999999999, false]] as const) {
    const random = vi.fn().mockReturnValueOnce(sample).mockReturnValue(.99);
    const result = traverseRouteEffects(createInitialState(), { energyCost: 10, accidentProbability: probability, accidentDamage: 5 }, random);
    if (!result.ok) throw new Error(result.error);
    expect(result.accident).toBe(accident);
    expect(random).toHaveBeenCalledTimes(accident ? 4 : 1);
    expect(new Set(result.victimIds).size).toBe(result.victimIds.length);
  }
});
test("route selection uses its own catalogue threshold rather than a common hard-coded roll", () => {
  const state = createInitialState();
  const high = traverseRoute(state, "unstable-corridor", () => .3);
  const low = traverseRoute(state, "ventilation", () => .3);
  if (!high.ok || !low.ok) throw new Error("route");
  expect(high.accident).toBe(true); expect(low.accident).toBe(false);
  const kitchen = internalIntermediateRoute("collapsed-kitchen")!;
  const gallery = internalIntermediateRoute("extraction-gallery")!;
  expect(kitchen.accidentProbability).toBeGreaterThan(gallery.accidentProbability);
  expect(ROUND_FOUR_ROUTES["exterior-crack"].accidentProbability).toBeGreaterThan(ROUND_FOUR_ROUTES["revolving-door"].accidentProbability);
});
test("guaranteed smoke exposure and warehouse reward rolls remain independent of accident decision", () => {
  const smoke = resolveRoundThreeRoute({ ...createInitialState(), currentRound: 3 }, "smoke", "pipe-gallery", () => .99);
  if (!smoke.ok) throw new Error(smoke.error);
  expect(smoke.state.characters.every(c => c.health === 80)).toBe(true);
  const random = vi.fn().mockReturnValueOnce(.99).mockReturnValueOnce(.69);
  const warehouse = resolveRoundThreeRoute({ ...createInitialState(), currentRound: 3 }, "warehouse", "metal-debris", random);
  if (!warehouse.ok) throw new Error(warehouse.error);
  expect(warehouse.outcome.gained.packs).toBe(4);
  expect(random).toHaveBeenCalledTimes(2);
  const replay = vi.fn(() => 0);
  expect(resolveRoundThreeRoute(warehouse.state, "warehouse", "metal-debris", replay).state).toBe(warehouse.state);
  expect(replay).not.toHaveBeenCalled();
});
