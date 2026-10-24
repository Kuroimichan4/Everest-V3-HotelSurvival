import { expect, test, vi } from "vitest";
import { createInitialState } from "./state.js";
import { resolveRoundOne } from "./round-one.js";
import { beginRoundTwo, resolveRoundTwo } from "./round-two.js";
import { resolveRoundTwoMovement } from "./round-two-movement.js";
import { beginRoundThree, resolveRoundThreeChoice } from "./round-three.js";

function completedTwo() {
  const first = resolveRoundOne(createInitialState(), "r1", "RESCUE_APPROVED").state;
  const rescue = resolveRoundTwo(beginRoundTwo(first), "r2", "RESCUE_APPROVED").state;
  return resolveRoundTwoMovement(rescue, { decisionId: "r2-route", outcome: "unstable-corridor", ventilationRevealed: false }, () => 0.99).state;
}
test("solo una ronda 2 completada permite transición; conserva todo el estado por referencia", () => {
  const first = createInitialState();
  expect(beginRoundThree(first)).toBe(first);
  const waiting = beginRoundTwo(resolveRoundOne(first, "r1", "ABANDON_APPROVED").state);
  expect(beginRoundThree(waiting)).toBe(waiting);
  const state = completedTwo();
  const next = beginRoundThree(state);
  expect(next).toEqual({ ...state, currentRound: 3 });
  expect(next.characters).toBe(state.characters);
  expect(next.inventory).toBe(state.inventory);
  expect(next.tools).toBe(state.tools);
  expect(next.roundOne).toBe(state.roundOne);
  expect(next.roundTwo).toBe(state.roundTwo);
  expect(beginRoundThree(next)).toBe(next);
});
test.each([false, true])("NO_AGREEMENT fuerza galería sin daño directo del terremoto, accidente %s", accident => {
  const completed = completedTwo();
  const state = beginRoundThree({ ...completed, characters: completed.characters.map(c => ({ ...c, energy: 35 })) });
  const random = vi.fn(() => accident ? 0 : 0.99);
  const result = resolveRoundThreeChoice(state, { decisionId: "r3", outcome: "NO_AGREEMENT" }, random);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.outcome.routeId).toBe("pipe-gallery");
  expect(result.state.characters.map(c => [c.health, c.energy])).toEqual([[accident ? 50 : 80, 15], [accident ? 50 : 80, 15], [80, 15], [80, 15]]);
  expect(result.state.inventory).toEqual(state.inventory);
  expect(result.state.tools).toBe(state.tools);
  expect(result.outcome.gained).toEqual({ packs: 0, medicalUnits: 0 });
  expect(random).toHaveBeenCalledTimes(accident ? 3 : 1);
  const again = resolveRoundThreeChoice(result.state, { decisionId: "r3", outcome: "NO_AGREEMENT" }, random);
  expect(again.state).toBe(result.state);
  expect(random).toHaveBeenCalledTimes(accident ? 3 : 1);
});
