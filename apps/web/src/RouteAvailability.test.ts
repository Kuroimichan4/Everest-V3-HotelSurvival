import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { RouteAvailability, RoundTwoView, RoundThreeView, PublicVote } from "@everest/shared";
import { RouteAvailabilityNotice, RouteRecoveryPanel } from "./RouteAvailability";
import { RoundTwo } from "./RoundTwo";
import { RoundThree } from "./RoundThree";

test.each([
  [{ status: "available", reason: null }, "Disponible."],
  [{ status: "with-help", reason: null }, "requiere votación de transporte"],
  [{ status: "unavailable", reason: "route-energy-insufficient" }, "Energía insuficiente"],
] as const)("React explica disponibilidad %j", (value, expected) => {
  expect(renderToStaticMarkup(createElement(RouteAvailabilityNotice, { value }))).toContain(expected);
});

test.each([false, true])("recuperación forzada %s ofrece la acción correspondiente sin cambiar ruta unilateralmente", forced => {
  const html = renderToStaticMarkup(createElement(RouteRecoveryPanel, { recovery: { decisionId: "selected", forced, reason: "route-energy-insufficient" }, enabled: true, busy: false, onRetry: vi.fn() }));
  expect(html).toContain(forced ? "Volver a comprobar ruta obligatoria" : "Volver a elegir ruta");
  expect(html).toContain(forced ? "No se permite cambiarla por otra" : "nueva votación colectiva");
});

test("rondas 2 y 3 mantienen rutas bloqueadas visibles y con voto deshabilitado", () => {
  const blocked: RouteAvailability = { status: "unavailable", reason: "route-energy-insufficient" };
  const vote: PublicVote = { decisionId: "route", attemptId: "attempt", round: 2, attemptNumber: 1, deadline: 61000, serverNow: 1000, requiredVotes: 3, status: "open", result: null };
  const second: RoundTwoView = { round: 2, npcId: "round-two-survivor", mobility: "walks-with-help", npc: "abandoned", phase: "route-pending", blocked: null, result: "ABANDON_APPROVED", microearthquake: false, previousNpc: "abandoned", characters: [], inventory: { packs: 8, medicalUnits: 4 }, movement: null,
    routeChoice: { phase: "voting", ventilationRevealed: false, vote, result: null, options: [{ id: "shoring", name: "Apuntalamiento", energyCost: 40, blocked: blocked.reason, availability: blocked }] } };
  const third: RoundThreeView = { round: 3, phase: "voting", vote: { ...vote, round: 3 }, selection: null, forced: false, earthquake: false, blockedRoutes: [], movement: null, blocked: null, afterRoute: null, previousNpcs: [], options: [{ id: "metal-debris", name: "Escombros", energyCost: 40, description: "Paso entre escombros", availability: blocked }] };
  const html2 = renderToStaticMarkup(createElement(RoundTwo, { state: second, vote, own: null, enabled: true, busy: false, maintenance: false, creator: true, onVote: vi.fn(), onRouteAction: vi.fn() }));
  const html3 = renderToStaticMarkup(createElement(RoundThree, { state: third, own: null, enabled: true, busy: false, creator: true, onVote: vi.fn(), onOpen: vi.fn() }));
  for (const [html, name] of [[html2, "Apuntalamiento"], [html3, "Escombros"]]) {
    expect(html).toContain(name);
    expect(html).toContain("40"); expect(html).toContain("No disponible.");
    expect(html).toContain(`<button disabled="">Votar ${name}</button>`);
    expect(html).not.toMatch(/probability|LOW|BAJO|warehouse|conference/);
  }
});
