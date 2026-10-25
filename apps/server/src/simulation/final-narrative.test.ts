import { expect, test, vi } from 'vitest';
import type { AssignedRole, GameFinalResult, PrivateObjectiveEvidence } from '@everest/shared';
import { collectiveNarrative, objectiveNarrative, survivalNarrative } from './final-narrative.js';

function result(statuses: GameFinalResult['humans'][number]['status'][] = ['evacuated', 'evacuated', 'evacuated', 'evacuated']): GameFinalResult {
  return { id: 'final', gameId: 'game', closedAt: 1000, round: 6, kind: statuses.includes('evacuated') ? 'evacuation-completed' : 'no-active-humans',
    humans: statuses.map((status, i) => ({ participantId: 'p' + i, name: 'Persona ' + i, role: (['maintenance', 'medic', 'architect-engineer', 'bellhop'] as const)[i]!, status })),
    npcs: [{ round: 1, status: 'not-encountered', evacuated: null }, { round: 2, status: 'not-encountered', evacuated: null }, { round: 6, status: 'absent', evacuated: false }],
    counts: { evacuated: statuses.filter(s => s === 'evacuated').length, dead: statuses.filter(s => s === 'dead').length, abandoned: statuses.filter(s => s === 'abandoned').length, rescuedNpcs: 0, evacuatedNpcs: 0 },
    inventory: { packs: 2, medicalUnits: 1 }, crowbar: 'available', lastMovement: null, decisions: [] };
}
test.each([
  [['evacuated', 'evacuated', 'evacuated', 'evacuated'], 'Todos al otro lado', 1],
  [['evacuated', 'dead', 'evacuated', 'evacuated'], 'La victoria y sus ausencias', 2],
  [['dead', 'dead', 'dead', 'dead'], 'El hotel guardó sus nombres', 1],
  [['abandoned', 'abandoned', 'abandoned', 'abandoned'], 'La salida quedó pendiente', 2],
] as const)('collective outcome %j is based only on recorded facts', (statuses, title, paragraphs) => {
  const r = result([...statuses]); const before = structuredClone(r); const narrative = collectiveNarrative(r);
  expect(narrative.title).toBe(title); expect(narrative.paragraphs).toHaveLength(paragraphs); expect(r).toEqual(before);
});
test.each(['rescued', 'abandoned', 'approved', 'dead', 'not-encountered', 'absent', 'pending'] as const)('NPC %s is not mistaken for another fate', status => {
  const r = result(); r.npcs[0] = { round: 1, status, evacuated: status === 'rescued' ? true : null };
  if (status === 'rescued') { r.counts.rescuedNpcs = 1; r.counts.evacuatedNpcs = 1; }
  expect(collectiveNarrative(r).paragraphs).toHaveLength(['not-encountered', 'absent', 'pending'].includes(status) ? 1 : 2);
  const text = collectiveNarrative(r).paragraphs.slice(1).join(' ');
  if (status === 'approved') { expect(text).toMatch(/intención|intencion|promesas/i); expect(r.counts.rescuedNpcs).toBe(0); }
  if (status === 'rescued') expect(text).toMatch(/exterior|calle/);
});
test('a completed rescue without an evacuation record never invents arrival or death', () => {
  const r = result(); r.npcs[0] = { round: 1, status: 'rescued', evacuated: null }; r.counts.rescuedNpcs = 1;
  expect(collectiveNarrative(r).paragraphs.at(-1)).toMatch(/no consta|sin una evacuación confirmada/);
});
const roles: AssignedRole[] = ['maintenance', 'medic', 'architect-engineer', 'bellhop'];
const evaluations: PrivateObjectiveEvidence['evaluation'][] = ['fulfilled', 'unfulfilled', 'pending-evaluation'];
test.each(roles.flatMap(role => evaluations.map(evaluation => ({ role, evaluation }))))('$role/$evaluation uses the given evaluation without reassessing objectives', ({ role, evaluation }) => {
  const a = objectiveNarrative('game', 'owner', role, evaluation);
  expect(a.length).toBeGreaterThan(40); expect(a).toBe(objectiveNarrative('game', 'owner', role, evaluation));
  expect(a).not.toBe(objectiveNarrative('game', 'owner', role, evaluations[(evaluations.indexOf(evaluation) + 1) % 3]!));
  if (role !== 'bellhop') expect(a).not.toMatch(/sabot|venen|poison|manipul|responsable|culpable/i);
});
test.each(['evacuated', 'dead', 'abandoned', 'active'] as const)('own epilogue distinguishes %s', status => {
  const text = survivalNarrative('game', 'owner', status);
  expect(text).toBe(survivalNarrative('game', 'owner', status));
  if (status === 'dead') expect(text).toMatch(/falleció|muerte/);
  if (status === 'abandoned') expect(text).toMatch(/no determina|no hace falta inventar una muerte/);
  if (status === 'active') expect(text).toMatch(/no quedó confirmada|sin constar/);
});
test('variants differ across games, survive F5 and never consume game randomness', () => {
  const rng = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('RNG must not be used'); });
  try {
    const variants = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const r = { ...result(), gameId: 'game-' + i }; const before = structuredClone(r);
      variants.add(collectiveNarrative(r).paragraphs[0]!); expect(collectiveNarrative(structuredClone(r))).toEqual(collectiveNarrative(r));
      for (const role of roles) for (const evaluation of evaluations) objectiveNarrative(r.gameId, 'p', role, evaluation);
      survivalNarrative(r.gameId, 'p', 'dead'); expect(r).toEqual(before);
    }
    expect(variants.size).toBeGreaterThan(1); expect(rng).not.toHaveBeenCalled();
  } finally { rng.mockRestore(); }
});
test('public narratives never reveal private objective prose or the cause of mysterious deaths', () => {
  const r = result(['evacuated', 'dead', 'evacuated', 'abandoned']);
  const publicText = JSON.stringify(collectiveNarrative(r)); expect(publicText).not.toMatch(/sabot|venen|poison|plan secreto|cometido oculto|medicación/i);
  for (const role of roles) for (const evaluation of evaluations) expect(publicText).not.toContain(objectiveNarrative(r.gameId, 'p', role, evaluation));
});
