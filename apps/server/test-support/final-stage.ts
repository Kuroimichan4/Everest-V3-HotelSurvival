import type { SimulationState } from "../src/simulation/state.js";
import type { RoomManager } from "../src/rooms/manager.js";

/** Fixtures for isolated evacuation regression tests: completed stages, with the original exit budget.
 * Complete six-round integration tests exercise real movements and resource accounting separately. */
export function beforeFinalFixture(state: SimulationState): SimulationState {
  return { ...state, currentRound: 5, intermediateRounds: [4, 5].map(round => ({ round: round as 4 | 5,
    requestId: `fixture-${round}`, routeId: round === 4 ? "service-walkway" as const : "restaurant-corridor" as const,
    status: "completed" as const, realRisk: "MODERATE" as const,
    effects: { accident: false, victimIds: [], deceasedIds: [], damage: [], charges: [] } })) };
}
export function completeIntermediateFixture(manager: RoomManager, code: string, host: string, sockets: readonly string[]) {
  const game = (manager as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!.game;
  const original = game.state.characters;
  game.state = { ...game.state, characters: original.map(c => ({ ...c, energy: 100 })) };
  for (const round of [4, 5] as const) {
    const advanced = manager.intermediateAction(host, { round, action: "advance" });
    if (!advanced.ok) throw new Error(advanced.error);
    const opened = manager.intermediateAction(host, { round, action: "open" });
    if (!opened.ok) throw new Error(opened.error);
    const vote = manager.publicVote(code)!;
    for (const socket of sockets.slice(0, 3)) {
      const result = manager.vote(socket, { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId: round === 4 ? "cracked-stairs" : "collapsed-kitchen" });
      if (!result.ok) throw new Error(result.error);
    }
  }
  game.state = { ...game.state, characters: original };
}
