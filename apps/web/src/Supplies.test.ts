import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { SuppliesView } from "@everest/shared";
import { Supplies } from "./Supplies";

afterEach(() => vi.unstubAllGlobals());

function state(round: 1 | 2 | 3 = 1, windowId: string | null = "after-r1"): SuppliesView {
  return { gameId: "game", round, windowId, inventory: { packs: 2, medicalUnits: 4 },
    characters: [
      { participantId: "self", name: "Botones", health: 100, energy: 60 },
      { participantId: "other", name: "Otro humano", health: 80, energy: 90 },
      { participantId: "dead", name: "Fallecido", health: 0, energy: 80 },
      { participantId: "eliminated", name: "Eliminado", health: 80, energy: 80, eliminated: true },
    ] };
}
function render(view = state(), bellhop = true, enabled = true) {
  return renderToStaticMarkup(createElement(Supplies, { state: view, bellhop, enabled, onGive: vi.fn() }));
}

test.each([
  [1, "after-r1"], [2, "prep-r2"], [2, "after-r2"], [3, "prep-r3"], [3, "after-r3"],
] as const)("React muestra reparto accesible y habilitado en ronda %i ventana %s", (round, windowId) => {
  const html = render(state(round, windowId));
  expect(html).toContain("Gestionar suministros");
  expect(html).not.toContain("<details");
  expect(html).toContain("<button>Entregar pack</button>");
  expect(html).toContain('<option value="self" selected="">Botones');
  expect(html).toContain('<option value="other">Otro humano');
  expect(html).not.toContain('<option value="dead"');
  expect(html).not.toContain('<option value="eliminated"');
});

test.each([1, 2, 3] as const)("ventana cerrada en ronda %i conserva panel e inventario y explica el bloqueo", round => {
  const html = render(state(round, null));
  expect(html).toContain("Gestionar suministros");
  expect(html).toContain("Packs disponibles: 2");
  expect(html).toContain("no durante votaciones, desplazamientos ni su resolución");
  expect(html).toContain('<button disabled="">Entregar pack</button>');
});

test("inventario agotado sigue visible y no permite entregar", () => {
  const view = state(); view.inventory.packs = 0;
  const html = render(view);
  expect(html).toContain("Packs disponibles: 0");
  expect(html).toContain("No quedan packs disponibles.");
  expect(html).toContain('<button disabled="">Entregar pack</button>');
});

test("otros roles conservan información común sin controles operativos", () => {
  const html = render(state(), false);
  expect(html).toContain("Solo Botones vivo puede autorizar el reparto");
  expect(html).toContain("Packs disponibles: 2");
  expect(html).not.toContain("<select");
  expect(html).not.toContain("Entregar pack");
});

test("sesión no preparada y destinatario con energía completa explican su bloqueo", () => {
  expect(render(state(), true, false)).toContain("Esperando conexión y autenticación");
  expect(render(state(), true, false)).toContain('<button disabled="">Entregar pack</button>');
  const view = state(); view.characters[0]!.energy = 100;
  expect(render(view)).toContain("El destinatario ya tiene 100 de energía.");
  expect(render(view)).toContain('<button disabled="">Entregar pack</button>');
});

test("recargar con una entrega pendiente ofrece reintento y bloquea nuevas entregas", () => {
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => key === "everest-pack-pending:game"
    ? JSON.stringify({ requestId: "receipt", windowId: "after-r1", targetParticipantId: "self" }) : null });
  const html = render();
  expect(html).toContain("Hay una entrega pendiente de confirmación.");
  expect(html).toContain('<button disabled="">Entregar pack</button>');
  expect(html).toContain("Reintentar entrega pendiente");
});

test("sin humanos activos no hay destinatarios y la tabla distingue muerte de eliminación", () => {
  const view = state(); view.characters = view.characters.slice(2);
  const html = render(view);
  expect(html).toContain("No hay destinatarios vivos disponibles.");
  expect(html).toContain('<button disabled="">Entregar pack</button>');
  expect(html).toContain("<td>Fallecido</td>");
  expect(html).toContain("<td>Eliminado</td>");
});
