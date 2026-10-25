import { expect, test } from 'vitest';
import { beforeFinalFixture } from '../../test-support/final-stage.js';
import { createInitialState, type SimulationState } from './state.js';
import { resolveRoundOne } from './round-one.js';
import { beginRoundTwo, resolveRoundTwo } from './round-two.js';
import { resolveRoundTwoMovement } from './round-two-movement.js';
import { resolveRoundThreeChoice } from './round-three.js';
import { beginRoundFour, decideRoundFourNpc, resolveRoundFourExit, type RoundFourState } from './round-four.js';
import { buildFinalResult, objectiveEvidence } from './final-result.js';
import { collectObjectiveLedger, recordMaintenanceRevelation, type EvidenceContext } from './objective-evidence.js';
import { manipulateMedication } from './medical-sabotage.js';
import { administerTreatment, applyDamage } from './operations.js';
import { applyTransportIncident } from './transport-crisis.js';

function ready() {
  const one = resolveRoundOne(createInitialState(), 'one', 'RESCUE_APPROVED'); if (!one.ok) throw new Error(one.error);
  const two = resolveRoundTwo(beginRoundTwo(one.state), 'two', 'RESCUE_APPROVED'); if (!two.ok) throw new Error(two.error);
  const moved = resolveRoundTwoMovement({ ...two.state, characters: two.state.characters.map(c => ({ ...c, energy: 100 })) },
    { decisionId: 'move2', outcome: 'ventilation', ventilationRevealed: true }, () => .99); if (!moved.ok) throw new Error(moved.error);
  const third = resolveRoundThreeChoice({ ...moved.state, currentRound: 3 }, { decisionId: 'move3', outcome: 'metal-debris' }, () => .99); if (!third.ok) throw new Error(third.error);
  const last = beginRoundFour({ ...beforeFinalFixture(third.state), characters: third.state.characters.map(c => ({ ...c, energy: 100 })) }, () => 0);
  if (!last.ok) throw new Error(last.error); return last.state;
}
function exit(s: RoundFourState, route: 'revolving-door' | 'exterior-crack' = 'revolving-door') {
  const r = resolveRoundFourExit(s, 'exit', route, () => .99); if (!r.ok) throw new Error(r.error); return r.state;
}
function result(s: SimulationState) {
  const r = buildFinalResult(s, s.characters.map(c => ({ characterId: c.id, participantId: 'p-' + c.id, name: c.role })),
    { id: 'final', gameId: 'game', closedAt: 1000, ventilationRevealed: true });
  if (!r) throw new Error('not terminal'); return r;
}
const context: EvidenceContext = { treatments: [{ requestId: 'tx', round: 6, patientId: 'p-maintenance', administratorId: 'p-medic' }] };

test('complete classified trajectory without EXTREME fulfills architect without classifying round one', () => {
  const s = exit(ready()); const r = result(s); const ledger = collectObjectiveLedger(s, r);
  expect(ledger.routes.map(x => x.round)).toEqual([1, 2, 3, 4, 5, 6]); expect(ledger.routes[0]!.realRisk).toBeNull();
  const own = objectiveEvidence(s, r, 'architect-engineer');
  expect(own).toMatchObject({ evaluation: 'fulfilled', evidenceState: 'confirmed', missing: [] });
  expect(JSON.stringify(r)).not.toMatch(/EXTREME|realRisk|objective|sabotage/);
});

test.each([false, true])('only completed EXTREME exits fail architect, forced=%s', forced => {
  const initial = ready(); const s = exit({ ...initial, roundFour: { ...initial.roundFour, forcedRoute: forced ? 'exterior-crack' : null } }, 'exterior-crack');
  const ledger = collectObjectiveLedger(s, result(s)); expect(ledger.routes.at(-1)).toMatchObject({ realRisk: 'EXTREME', forcedByNoAgreement: forced });
  expect(objectiveEvidence(s, result(s), 'architect-engineer').evaluation).toBe('unfulfilled');
});

test('EXTREME selection without movement cannot invent a traversal or failure', () => {
  const initial = ready(); const s = { ...initial, characters: initial.characters.map(c => ({ ...c, health: 0 })), roundFour: { ...initial.roundFour, forcedRoute: 'exterior-crack' as const } };
  const ledger = collectObjectiveLedger(s, result(s)); expect(ledger.routes.some(r => r.round === 6)).toBe(false);
  expect(objectiveEvidence(s, result(s), 'architect-engineer').evaluation).toBe('pending-evaluation');
});

test('rounds 2, 4 and 5 revelations count once each without traversing those routes', () => {
  let s: SimulationState = createInitialState();
  for (const [round, id] of [[2, 'ventilation'], [4, 'technical-stairs'], [5, 'extraction-gallery']] as const) {
    s = { ...s, currentRound: round };
    s = recordMaintenanceRevelation(s, { round, id, initiallyPrivate: true }, 'maintenance', round * 1000);
    const replay = recordMaintenanceRevelation(s, { round, id, initiallyPrivate: true }, 'maintenance', round * 2000); expect(replay).toBe(s);
  }
  const finalState = { ...s, characters: s.characters.map(c => ({ ...c, health: 0 })) }; const r = result(finalState);
  expect(collectObjectiveLedger(finalState, r).routes).toEqual([]);
  expect(objectiveEvidence(finalState, r, 'maintenance').evaluation).toBe('fulfilled');
  const two = { ...finalState, routeRevelations: s.routeRevelations!.slice(0, 2) };
  expect(objectiveEvidence(two, result(two), 'maintenance').evaluation).toBe('fulfilled');
  const duplicate = { ...two, routeRevelations: [s.routeRevelations![0]!, s.routeRevelations![0]!] };
  expect(objectiveEvidence(duplicate, result(duplicate), 'maintenance').evaluation).toBe('pending-evaluation');
});

test.each(['survives', 'accident', 'environment', 'replica', 'gas', 'explosion', 'abandoned', 'poison'] as const)('human patient outcome %s controls medic without revealing cause', cause => {
  let s = ready(); s = { ...s, characters: s.characters.map(c => c.id === 'maintenance' ? { ...c, health: 60 } : c) };
  if (cause === 'poison') { const m = manipulateMedication(s, 'bellhop', 'sabotage'); if (!m.ok) throw new Error(m.error); s = { ...s, ...m.state, currentRound: 6 }; }
  const tx = administerTreatment(s, 'maintenance', () => 0, () => 0); if (!tx.ok) throw new Error(tx.error); s = { ...s, ...tx.state };
  if (cause === 'gas' || cause === 'explosion') {
    s = { ...s, characters: s.characters.map(c => c.id === 'maintenance' ? { ...c, health: 5 } : c) };
    s = { ...s, ...applyTransportIncident(s, 'incident', 6, cause, 1000).state, currentRound: 6 };
  } else if (cause === 'abandoned') s = { ...s, characters: s.characters.map(c => c.id === 'maintenance' ? { ...c, eliminated: true } : c) };
  else if (cause !== 'poison' && cause !== 'survives') { const hit = applyDamage(s, 'maintenance', 100); if (!hit.ok) throw new Error(hit.error); s = { ...s, ...hit.state }; }
  const final = exit(s); const r = result(final); const own = objectiveEvidence(final, r, 'medic', context);
  expect(own.evaluation).toBe(cause === 'survives' ? 'fulfilled' : cause === 'abandoned' ? 'pending-evaluation' : 'unfulfilled');
  expect(JSON.stringify(own)).not.toMatch(/sabot|poison|venen|actorId/i);
  expect(collectObjectiveLedger(final, r, context).patients).toHaveLength(1);
});

test.each(['none', 'manipulated', 'failed-roll', 'successful'] as const)('bellhop objective from final-round sabotage: %s', mode => {
  let s = ready(); s = { ...s, characters: s.characters.map(c => c.id === 'maintenance' ? { ...c, health: 60 } : c) };
  if (mode !== 'none') { const m = manipulateMedication(s, 'bellhop', 'once'); if (!m.ok) throw new Error(m.error); s = { ...s, ...m.state, currentRound: 6 }; }
  if (mode === 'failed-roll' || mode === 'successful') { const tx = administerTreatment(s, 'maintenance', () => mode === 'successful' ? 0 : .25); if (!tx.ok) throw new Error(tx.error); s = { ...s, ...tx.state }; }
  const final = exit(s); const r = result(final); const before = JSON.stringify(final);
  for (let i = 0; i < 2; i++) expect(objectiveEvidence(final, r, 'bellhop').evaluation).toBe(mode === 'successful' ? 'fulfilled' : 'unfulfilled');
  expect(JSON.stringify(final)).toBe(before); expect(JSON.stringify(r)).not.toMatch(/sabot|poison|venen|actorId/i);
});

test('approved final NPC rescue never counts as executed on an early terminal ending', () => {
  const initial = ready(); const chosen = decideRoundFourNpc({ ...initial, roundFour: { ...initial.roundFour, npc: { encounter: 'immobile', status: 'awaiting-decision', failedAttempts: 0 } } }, 'npc', 'medical-assist');
  if (!chosen.ok) throw new Error(chosen.error);
  const s = { ...chosen.state, characters: chosen.state.characters.map(c => ({ ...c, health: 0 })) }; const r = result(s);
  expect(r).toMatchObject({ kind: 'no-active-humans', counts: { evacuated: 0, dead: 4, rescuedNpcs: 2, evacuatedNpcs: 0 } });
  expect(r.npcs[2]).toMatchObject({ status: 'approved', evacuated: null });
  expect(collectObjectiveLedger(s, r).npcs[2]).toMatchObject({ rescueApproved: true, rescued: false, medicalUnitsUsed: 0 });
});

test('earlier NPC companions evacuate and absent human patients never fulfill medic', () => {
  const s = exit(ready()); const r = result(s);
  expect(r.counts).toMatchObject({ evacuated: 4, rescuedNpcs: 2, evacuatedNpcs: 2 });
  expect(r.npcs.slice(0, 2).every(n => n.evacuated)).toBe(true);
  expect(objectiveEvidence(s, r, 'medic').evaluation).toBe('pending-evaluation');
});

test.each([1, 2, 3, 4, 5])('early ending in round %i reports the last actual movement, not an unexecuted next one', round => {
  const full = ready();
  const { roundThreeRoute, roundTwo, ...base } = full;
  const s: SimulationState = { ...base, currentRound: round as 1 | 2 | 3 | 4 | 5,
    ...(round >= 3 && roundThreeRoute ? { roundThreeRoute } : {}), ...(round >= 2 && roundTwo ? { roundTwo } : {}),
    intermediateRounds: full.intermediateRounds!.filter(r => r.round <= round), characters: full.characters.map(c => ({ ...c, health: 0 })) };
  const r = result(s); expect(r.lastMovement?.completed).toBe(true);
  if (round === 2) { expect(r.lastMovement!.routeName).toBe('Conductos de ventilación'); expect(r.decisions.join(' ')).toContain('Ruta de ronda 2: Conductos de ventilación'); }
  expect(r.counts).toMatchObject({ dead: 4, evacuated: 0 });
});

test('early death after a precipitated sector advance retains the previous actual movement', () => {
  const full = ready(); const { roundThreeRoute: _third, ...rest } = full;
  const s: SimulationState = { ...rest, currentRound: 4, intermediateRounds: [],
    sectorEvacuations: [{ round: 3, incidentId: 'explosion', routeId: 'pipe-gallery', at: 1000 }],
    characters: full.characters.map(c => ({ ...c, health: 0 })) };
  const r = result(s); expect(r.lastMovement!.routeName).toBe('Conductos de ventilación');
  expect(r.decisions.join(' ')).not.toContain('Ruta de ronda 3:');
  expect(collectObjectiveLedger(s, r).routes.map(r => r.round)).toEqual([1, 2]);
});
