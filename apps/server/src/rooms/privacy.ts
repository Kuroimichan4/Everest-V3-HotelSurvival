/** Proyección de envío. Los DTO internos nunca se emiten directamente a una sala. */
export function projectForParticipant<T>(value: T, participantId: string, medic: boolean): T {
  const visit = (input: unknown, inheritedOwner?: string): unknown => {
    if (Array.isArray(input)) return input.map(item => visit(item, inheritedOwner));
    if (!input || typeof input !== "object") return input;
    const source = input as Record<string, unknown>;
    const owner = typeof source.participantId === "string" ? source.participantId
      : typeof source.targetParticipantId === "string" ? source.targetParticipantId : inheritedOwner;
    const own = owner === participantId;
    const projected: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
      if (owner && !own) {
        if (key === "energy" || key === "routeEnergy" || key === "transportEnergy") continue;
        if ((key === "health" || key === "healthRestored") && !medic) continue;
        if (key === "damage") continue;
        if (key === "restored" && !(medic && source.kind === "treatment")) continue;
      }
      projected[key] = visit(entry, owner);
    }
    if (typeof source.health === "number" && typeof source.energy === "number" && !source.status) {
      projected.status = source.eliminated ? "abandoned" : source.health <= 0 ? "dead" : "active";
    }
    return projected;
  };
  return visit(value) as T;
}
