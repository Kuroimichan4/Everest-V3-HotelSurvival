import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { TransportView } from "@everest/shared";
import { Transport, TransportCrisis } from "./Transport";
import { GameHistory } from "./GameScreen";
import { emptyGame, activeScene, gameReducer } from "./game-state";
import { TransportDecision } from "../../server/src/rooms/transport.js";
import { createInitialState } from "../../server/src/simulation/state.js";
import { publicRoundThreeRouteViews } from "../../server/src/simulation/round-three-routes.js";

function state(): TransportView {
  return { cases: [{ preparationId: "prep", round: 3, routeId: "fire-door", routeName: "Puerta cortafuegos", routeCost: 30,
    phase: "voting", reason: null, exhaustedIds: ["a", "b"], eligibleIds: ["c", "d"],
    people: [{ participantId: "a", name: "Ana", energy: 0 }, { participantId: "b", name: "Bruno", energy: 10 },
      { participantId: "c", name: "Carla", energy: 45 }, { participantId: "d", name: "Diego", energy: 50 }],
    options: [{ id: "carry-all", label: "Transportar a los dos", viable: false, carrierIds: [], carrierCost: 60, authorizedVoterIds: [] },
      { id: "carry-one", label: "Transportar solamente a uno", viable: true, carrierIds: ["c", "d"], carrierCost: 45, authorizedVoterIds: ["c", "d"] },
      { id: "leave-all", label: "No transportar a ninguno", viable: true, carrierIds: [], carrierCost: 30, authorizedVoterIds: ["c", "d"] }],
    vote: { decisionId: "decision", attemptId: "attempt", round: 3, attemptNumber: 1, deadline: 61000, serverNow: 1000, requiredVotes: 2, status: "open", result: null },
    decisions: [], transportedIds: [], abandonedIds: [], charges: [], transfers: [] }] };
}
function render(view: TransportView, participantId: string) {
  return renderToStaticMarkup(createElement(Transport, { state: view, participantId, own: null, enabled: true, busy: false, onOpen: vi.fn(), onVote: vi.fn() }));
}
test("React muestra ruta, costes, opciones inviables y mayoría a los porteadores", () => {
  const html = render(state(), "c");
  expect(html).toContain("Puerta cortafuegos");
  expect(html).not.toContain("<table");
  expect(html).toContain("Mayoría necesaria: 2");
  expect(html).toContain("Plan no viable energéticamente.");
  expect(html).toContain('<button disabled="">Votar Transportar a los dos</button>');
  expect(html).toContain("Coste por porteador: 45");
  expect(html).toContain("Tiempo restante:");
});
test.each(["a", "b", "outsider"])("participante %s sigue el proceso sin controles de voto", participant => {
  const html = render(state(), participant);
  expect(html).toContain("Transporte");
  expect(html).toContain("no estás autorizado para votar");
  expect(html).not.toContain("<button");
});
test("preparación explica packs y ofrece continuar; la segunda votación no anuncia abandono prematuro", () => {
  const view = state(); const current = view.cases[0]!;
  current.phase = "preparation"; current.vote = null;
  expect(render(view, "a")).toContain("Botones puede repartir packs");
  expect(render(view, "a")).toContain("<button>Comprobar energía y continuar</button>");
  current.phase = "selection";
  expect(render(view, "a")).toContain("todavía no se ha abandonado a nadie");
});
test("desacuerdo explícito conserva información y no ofrece un voto nuevo", () => {
  const view = state(); view.cases[0]!.phase = "pending"; view.cases[0]!.reason = "transport-no-agreement";
  expect(render(view, "c")).toContain("El desplazamiento sigue pendiente.");
  expect(render(view, "c")).not.toContain("<button");
});
test("resultado diferencia transportados, abandonados, gastos y transferencias", () => {
  const view = state(); const current = view.cases[0]!;
  current.phase = "completed"; current.transportedIds = ["b"]; current.abandonedIds = ["a"];
  current.charges = [{ participantId: "c", kind: "carrier", routeEnergy: 30, transportEnergy: 15 }];
  current.transfers = [{ participantId: "a", items: [{ id: "map", kind: "Mapa" }] }];
  const html = renderToStaticMarkup(createElement(GameHistory, { state: { ...emptyGame, transport: view } }));
  expect(render(view, "c")).toBe("");
  expect(html).toContain("Transportados: Bruno.");
  expect(html).toContain("30 de ruta + 15 de transporte");
  expect(html).toContain("Objetos de Ana transferidos: Mapa");
});

test.each([[45, 45], [45, 60], [60, 60]])("8C: React muestra costes y permisos calculados por servidor con porteadores %i/%i", (first, second) => {
  const initial = createInitialState();
  const energies = [0, 0, first, second];
  const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, energy: energies[i]! })) };
  const route = publicRoundThreeRouteViews().find(r => r.id === "fire-door")!;
  const execute = vi.fn(() => null);
  const controller = new TransportDecision({ round: 3, id: route.id, name: route.name, cost: route.energyCost },
    () => state, execute, { now: () => 1000, schedule: () => () => {} }, () => {},
    state.characters.map((c, i) => ({ characterId: c.id, participantId: `p${i}`, name: `P${i}` })), { readActual: () => state, commit: () => {}, evacuateSector: () => {} });
  controller.open(controller.preparationId);
  const view = controller.view();
  expect(view.routeCost).toBe(30);
  expect(view.options.find(o => o.id === "carry-all")!.carrierCost).toBe(60);
  expect(view.options.find(o => o.id === "carry-one")!.carrierCost).toBe(45);
  const html = render({ cases: [view] }, "p2");
  expect(html).toContain("Coste normal: 30");
  expect(html).toContain("Coste por porteador: 45");
  if (second < 60) expect(html).toContain("Plan no viable energéticamente.");
  else {
    expect(html).toContain("Coste por porteador: 60");
    if (first < 60) expect(html).toContain("No puedes votar esta alternativa");
    else expect(html).not.toContain("No puedes votar esta alternativa");
  }
  expect(execute).not.toHaveBeenCalled();
  controller.dispose();
});

test("crisis narrative and history are idempotent and show only projected personal damage",()=>{
 const v=state();const c=v.cases[0]!;c.vote!.attemptNumber=3;c.crisis={gas:{incidentId:'prep',at:91000,victims:[{participantId:'a'},{participantId:'c',damage:5}],deceasedIds:[]}};
 const html=renderToStaticMarkup(createElement(TransportCrisis,{state:c,participantId:'c'}));expect(html).toContain('Solo quedan diez segundos');expect(html).toContain('5 puntos');expect(html).not.toContain('Fallecidos por la fuga');
 let game={...emptyGame,transport:v};expect(gameReducer(game,{type:'transport',value:structuredClone(v)})).toBe(game);
 c.phase='sector-evacuated';c.vote!.status='closed';c.crisis.explosion={incidentId:'prep',at:101000,victims:[{participantId:'c',damage:5}],deceasedIds:['a']};
 expect(render(v,'c')).toBe('');const history=renderToStaticMarkup(createElement(GameHistory,{state:game}));expect(history.match(/Fuga de gas/g)).toHaveLength(1);expect(history.match(/Evacuación precipitada del sector/g)).toHaveLength(1);expect(history).not.toContain('Ruta completada');
 expect(activeScene({...game,supplies:{gameId:'game',round:4,windowId:'next',inventory:{packs:8,medicalUnits:4},characters:[]}})).toMatchObject({round:4,transport:undefined,vote:null});
});
