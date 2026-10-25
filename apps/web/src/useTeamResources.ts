import { useEffect, useRef, useState } from "react";
import type { PackInput, TreatmentInput } from "@everest/shared";
import type { GameState } from "./game-state";
import type { GameActions } from "./GameScreen";
import { DirectResourceRequest } from "./direct-resources";
const packInput = (v: unknown): v is PackInput => !!v && typeof v === "object" && typeof (v as PackInput).requestId === "string" && typeof (v as PackInput).windowId === "string" && typeof (v as PackInput).targetParticipantId === "string";
const medicalInput = (v: unknown): v is TreatmentInput => !!v && typeof v === "object" && typeof (v as TreatmentInput).requestId === "string" && typeof (v as TreatmentInput).gameId === "string" && [1,2,3,4,5,6].includes((v as TreatmentInput).round) && typeof (v as TreatmentInput).targetParticipantId === "string";
export function useTeamResources(state: GameState, enabled: boolean, actions?: Pick<GameActions,"onGive"|"onTreat">) {
  const gameId = state.supplies?.gameId ?? "loading";
  const [, render] = useState(0);
  const changed = () => render(n => n + 1);
  const requests = useRef<null | { pack: DirectResourceRequest<PackInput>; medical: DirectResourceRequest<TreatmentInput> }>(null);
  if (!requests.current) {
    let storage: Storage | null = null; try { storage = sessionStorage; } catch { /* Se informa al intentar administrar. */ }
    requests.current = { pack: new DirectResourceRequest(`everest-pack-pending:${gameId}`, packInput, storage), medical: new DirectResourceRequest(`everest-medical-pending:${gameId}`, medicalInput, storage) };
  }
  const { pack, medical } = requests.current;
  const snapshot = JSON.stringify([state.supplies, state.medical?.treatments]);
  const role = state.role?.role;
  useEffect(() => {
    if (!enabled || !actions) return;
    if (role === "bellhop" && pack.pending) pack.retry(snapshot, actions.onGive, changed);
    if (role === "medic" && medical.pending) medical.retry(snapshot, actions.onTreat, changed);
  }, [enabled, role, gameId]);
  return {
    busy: role === "bellhop" ? pack.blocked(snapshot) : medical.blocked(snapshot),
    message: role === "bellhop" ? pack.message : medical.message,
    pending: role === "bellhop" ? !!pack.pending : !!medical.pending,
    retry: () => { if (!enabled || !actions) return; if (role === "bellhop") pack.retry(snapshot, actions.onGive, changed); else if (role === "medic") medical.retry(snapshot, actions.onTreat, changed); },
    give: (targetParticipantId: string) => {
      if (!enabled || role !== "bellhop" || !actions || !state.supplies?.windowId) return;
      const target = state.supplies.resourceActions?.find(c => c.participantId === targetParticipantId);
      if (!target?.packEligibility?.allowed) return;
      pack.begin({ requestId: crypto.randomUUID(), windowId: state.supplies.windowId, targetParticipantId }, snapshot, actions.onGive, changed);
    },
    treat: (targetParticipantId: string) => {
      if (!enabled || role !== "medic" || !actions || !state.supplies) return;
      const target = state.supplies.resourceActions?.find(c => c.participantId === targetParticipantId);
      if (!target?.medicalEligibility?.allowed) return;
      medical.begin({ requestId: crypto.randomUUID(), gameId, round: state.supplies.round, targetParticipantId }, snapshot, actions.onTreat, changed);
    },
  };
}
