import { randomInt } from "node:crypto";
import type { HumanRole } from "../simulation/state.js";

export type RandomIndex = (exclusiveMax: number) => number;

/** Fisher–Yates: índice uniforme [0, i], sin ordenar por un comparador aleatorio. */
export function shuffleRoles(randomIndex: RandomIndex = randomInt): HumanRole[] {
  const roles: HumanRole[] = ["maintenance", "medic", "architect-engineer", "bellhop"];
  for (let i = roles.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error("Índice aleatorio inválido");
    [roles[i], roles[j]] = [roles[j]!, roles[i]!];
  }
  return roles;
}
