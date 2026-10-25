import { afterEach, expect, test, vi } from 'vitest';
import { createSurvivorAdapter, GeminiSurvivorAdapter, readSurvivorConfig, survivorModelPrompt, validateModelArgument } from './survivor-gemini.js';
import { demonstrationAdapter, SurvivorAgent, type SurvivorPrompt } from './survivor-agent.js';
import { RoomManager } from './manager.js';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const config = () => readSurvivorConfig({ SURVIVOR_AI_MODE: 'gemini', GEMINI_API_KEY: 'fake-test-only', GEMINI_MODEL: 'test-model', SURVIVOR_AI_TIMEOUT_MS: '250', SURVIVOR_AI_MAX_CALLS: '2' });
const prompt = (situation: SurvivorPrompt['situation'] = 'walking-assisted'): SurvivorPrompt => ({ encounterId: 'internal-id', round: 6, situation,
  vote: { decisionId: 'private-decision-id', attemptId: 'attempt', attempt: 1, openedAt: 1000, deadline: 61000 }, slot: 0, secondsRemaining: 60, previousMessages: [] });
const response = (value: unknown) => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(value) }] } }] }));
const argument = { action: 'advise', text: 'Puedo caminar si me ayudáis. Por favor, no me dejéis atrás.' };
test('default demo and explicit demo never call the provider, even with credentials present', () => {
  const request = vi.fn<typeof fetch>();
  expect(createSurvivorAdapter(readSurvivorConfig({}), request)).toBe(demonstrationAdapter);
  expect(createSurvivorAdapter(readSurvivorConfig({ GEMINI_API_KEY: 'fake-test-only' }), request).respond(prompt())).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});
test('Gemini uses the initial configurable model and rejects model paths or URLs', () => {
  expect(readSurvivorConfig({ SURVIVOR_AI_MODE: 'gemini', GEMINI_API_KEY: 'fake-test-only' }).model).toBe('gemini-3.5-flash-lite');
  expect(() => readSurvivorConfig({ GEMINI_MODEL: '../models/other?key=secret' })).toThrow('GEMINI_MODEL');
  expect(() => readSurvivorConfig({ SURVIVOR_AI_MODE: 'openai' })).toThrow('SURVIVOR_AI_MODE');
});
test.each([{ SURVIVOR_AI_MODE: 'other' }, { SURVIVOR_AI_MODE: 'gemini' }, { SURVIVOR_AI_TIMEOUT_MS: '5000' }, { SURVIVOR_AI_TIMEOUT_MS: 'NaN' }, { SURVIVOR_AI_MAX_CALLS: '-1' }, { SURVIVOR_AI_MAX_CALLS: '16' }])('configuration rejects unsafe setup without exposing values: %j', env => {
  expect(() => readSurvivorConfig(env)).toThrow();
});
test('generateContent request uses configured model, JSON schema and header key without tools or private context', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(response(argument)); const adapter = new GeminiSurvivorAdapter(config(), request);
  const p = { ...prompt(), health: 12, energy: 30, medicalSabotage: 'secret', chat: 'HUMAN CONVERSATION' };
  expect(await adapter.respond(p)).toEqual(argument);
  const [url, init] = request.mock.calls[0]!; expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent'); expect(init!.headers).toMatchObject({ 'x-goog-api-key': 'fake-test-only' });
  expect(String(url)).not.toContain('fake-test-only');
  const body = JSON.parse(init!.body as string); expect(body).toMatchObject({ generationConfig: { candidateCount: 1, maxOutputTokens: 400, responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: { additionalProperties: false, required: ['action', 'text'] } } } } });
  expect(body.tools).toBeUndefined(); expect(body.systemInstruction.parts[0].text).toBeTruthy();
  expect(body.contents[0].parts[0].text).not.toMatch(/fake-test-only|internal-id|private-decision-id|health|energy|medicalSabotage|HUMAN CONVERSATION/);
  expect(adapter.outcomes).toEqual([{ source: 'gemini', reason: 'generated' }]);
});
test('physical state, waiting time, narrative identity and escalating emotion are separate prompt fields', () => {
  const first = survivorModelPrompt(prompt('immobile'));
  const second = survivorModelPrompt({ ...prompt('walking-assisted'), slot: 1, vote: { ...prompt().vote, attempt: 2, openedAt: 61000, deadline: 91000 }, secondsRemaining: 15, previousMessages: ['Tengo miedo.'] });
  expect(first.situation.mobility).toContain('No puedes moverte'); expect(second.situation.mobility).toContain('únicamente con ayuda');
  expect(second.emotion).toMatch(/angustia|urgencia/); expect(second.previousArguments).toEqual(['Tengo miedo.']); expect(second.publicInformation.secondsWaitingThisAttempt).toBe(15);
});
test.each([
  { action: 'vote', text: 'Ayudadme.' }, { action: 'advise', text: '<script>alert()</script>' },
  { action: 'advise', text: 'Tengo una palanca.' }, { action: 'advise', text: 'Tengo una herida.' },
  { action: 'advise', text: 'Salud 30', health: 30 }, { action: 'advise', text: 'x'.repeat(301) },
])('invalid or fabricated content falls back to demonstration once: %j', value => {
  expect(validateModelArgument(value, prompt())).toBeNull();
});
test('mobility contradictions rejected and correct pleas accepted', () => {
  expect(validateModelArgument(argument, prompt('immobile'))).toBeNull();
  expect(validateModelArgument({ action: 'warn', text: 'No puedo moverme, ayudadme.' }, prompt('walking-assisted'))).toBeNull();
  expect(validateModelArgument({ action: 'warn', text: 'No puedo caminar. Por favor, ayudadme.' }, prompt('immobile'))).not.toBeNull();
  expect(validateModelArgument(argument, prompt('walking-assisted'))).toEqual(argument);
});
test.each(['http', 'invalid', 'refusal', 'incomplete', 'malformed'] as const)('provider %s fails safely without retries or logging response bodies', async failure => {
  const reply = failure === 'http' ? new Response('sensitive provider error', { status: 429 }) : failure === 'invalid' ? response({ ...argument, actorId: 'secret' })
    : failure === 'refusal' ? new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }))
    : failure === 'incomplete' ? new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { role: 'model', parts: [{ text: JSON.stringify(argument) }] } }] })) : new Response('not JSON');
  const request = vi.fn<typeof fetch>().mockResolvedValue(reply); const adapter = new GeminiSurvivorAdapter(config(), request);
  expect(await adapter.respond(prompt())).toEqual(demonstrationAdapter.respond(prompt())); expect(request).toHaveBeenCalledTimes(1);
  expect(adapter.outcomes[0]!.source).toBe('demonstration'); expect(JSON.stringify(adapter.outcomes)).not.toMatch(/fake-test-only|sensitive|secret/);
});
test.each([
  { candidates: [] },
  { candidates: [{ finishReason: 'SAFETY', content: { role: 'model', parts: [{ text: JSON.stringify(argument) }] } }] },
  { candidates: [{ finishReason: 'STOP', safetyRatings: [{ blocked: true }], content: { role: 'model', parts: [{ text: JSON.stringify(argument) }] } }] },
  { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { name: 'vote', args: {} } }] } }] },
  { candidates: [{ finishReason: 'STOP', content: { role: 'user', parts: [{ text: JSON.stringify(argument) }] } }] },
  { candidates: [{ finishReason: 'STOP' }, { finishReason: 'STOP' }] },
])('Gemini non-text, blocked or ambiguous result uses a single deterministic fallback: %j', body => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
  const adapter = new GeminiSurvivorAdapter(config(), request);
  return adapter.respond(prompt()).then(result => {
    expect(result).toEqual(demonstrationAdapter.respond(prompt())); expect(request).toHaveBeenCalledTimes(1);
    expect(adapter.outcomes).toEqual([{ source: 'demonstration', reason: 'invalid' }]);
  });
});
test('Gemini thought parts are never published and text parts form one validated JSON response', async () => {
  const json = JSON.stringify(argument);
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [
    { thought: true, text: 'INTERNAL REASONING' }, { text: json.slice(0, 10) }, { text: json.slice(10) },
  ] } }] })));
  expect(await new GeminiSurvivorAdapter(config(), request).respond(prompt())).toEqual(argument);
});
test('timeout includes an unresponsive fetch, aborts it and produces one demo response', async () => {
  vi.useFakeTimers(); const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})); const adapter = new GeminiSurvivorAdapter(config(), request);
  const pending = adapter.respond(prompt()); await vi.advanceTimersByTimeAsync(250);
  expect(await pending).toEqual(demonstrationAdapter.respond(prompt())); expect(request.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  expect(adapter.outcomes).toEqual([{ source: 'demonstration', reason: 'timeout' }]);
});
test('call budget is per adapter/game and exhaustion never causes another request', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => response(argument)); const c = { ...config(), maxCalls: 1 };
  const first = new GeminiSurvivorAdapter(c, request); const second = new GeminiSurvivorAdapter(c, request);
  await first.respond(prompt()); await first.respond(prompt()); await second.respond(prompt()); expect(request).toHaveBeenCalledTimes(2);
  expect(first.outcomes.at(-1)).toEqual({ source: 'demonstration', reason: 'budget' });
});
test('each game in the same manager gets a fresh budget; F5 does not create another adapter', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => response(argument)); const factory = vi.fn(() => createSurvivorAdapter({ ...config(), maxCalls: 1 }, request));
  const manager = new RoomManager(() => 0, { now: () => 1000, schedule: () => () => {} }, undefined, undefined, undefined, factory);
  try {
    for (const prefix of ['first', 'second']) {
      const r = manager.create(prefix + '0', 'Host'); if (!r.ok) throw new Error(r.error);
      for (let i = 1; i < 4; i++) manager.join(prefix + i, 'Person ' + i, r.value.room.code); manager.start(prefix + '0');
      manager.disconnect(prefix + '0'); expect(manager.resume(prefix + '-restored', r.value.credential).ok).toBe(true); manager.finalSession(prefix + '-restored');
    }
    await Promise.resolve(); expect(factory).toHaveBeenCalledTimes(2); expect(request).toHaveBeenCalledTimes(2);
  } finally { manager.dispose(); }
});
test('a provider reply after the vote closes cannot publish, even though its HTTP request succeeded', async () => {
  let resolve!: (r: Response) => void; const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(r => { resolve = r; }));
  const adapter = new GeminiSurvivorAdapter(config(), request); const agent = new SurvivorAgent(adapter, { now: () => 1000, schedule: () => () => {} });
  let current: SurvivorPrompt | null = prompt(); const publish = vi.fn(); agent.observe(() => current, publish); current = null;
  resolve(response(argument)); await new Promise(r => setTimeout(r, 0)); expect(publish).not.toHaveBeenCalled(); agent.dispose();
});
