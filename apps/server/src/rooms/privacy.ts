import type { AssignedRole } from "@everest/shared";
/** Proyección de envío. Los DTO internos nunca se emiten directamente a una sala. */
export function projectForParticipant<T>(value: T, participantId: string, medic: boolean, architect = false, bellhop = false, publicRoles: Readonly<Record<string, AssignedRole>> = {}, structuralRounds: ReadonlySet<number> = new Set()): T {
  const visit = (input: unknown, inheritedOwner?: string, inheritedRound?: number): unknown => {
    if (Array.isArray(input)) return input.map(item => visit(item, inheritedOwner, inheritedRound));
    if (!input || typeof input !== "object") return input;
    const source = input as Record<string, unknown>;
    const owner = typeof source.participantId === "string" ? source.participantId
      : typeof source.targetParticipantId === "string" ? source.targetParticipantId : inheritedOwner;
    const own = owner === participantId;
    const round = typeof source.round === "number" ? source.round : inheritedRound;
    const structural = architect && round !== undefined && structuralRounds.has(round);
    const projected: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
      if (["accidentProbability", "probability"].includes(key)) continue;
      if (["danger", "realRisk", "riskCategory"].includes(key) && !structural) continue;
      if (key === "packEligibility" && !bellhop) continue;
      if (key === "medicalEligibility" && !medic) continue;
      if (owner && !own) {
        if (key === "energy" || key === "routeEnergy" || key === "transportEnergy") continue;
        if ((key === "health" || key === "healthRestored") && !medic) continue;
        if (key === "damage") continue;
        if (key === "restored" && !(medic && source.kind === "treatment")) continue;
      }
      projected[key] = visit(entry, owner, round);
    }
    if (typeof source.health === "number" && typeof source.energy === "number" && !source.status) {
      projected.status = source.eliminated ? "abandoned" : source.health <= 0 ? "dead" : "active";
    }
    if (typeof source.participantId === "string" && typeof source.name === "string" && (typeof source.health === "number" || typeof source.energy === "number") && publicRoles[source.participantId]) projected.role = publicRoles[source.participantId];
    return projected;
  };
  return visit(value) as T;
}
