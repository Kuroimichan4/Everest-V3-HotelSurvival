import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { TeamStatus } from "./GameScreen";
import { emptyGame, type GameState } from "./game-state";

/** Fixtures con CSS real para la comprobación geométrica del navegador. */
test.each(["medic", "bellhop"] as const)("bottom action fixture for %s retains authorized data and disabled buttons", role => {
  const state: GameState = { ...emptyGame, role: { participantId: "p0", role, sheet: { name: role, responsibility: "", objective: "", knowledge: [] } },
    supplies: { gameId: "layout", round: 2, windowId: "prep", inventory: { packs: 4, medicalUnits: 2 },
      characters: [0,1,2,3].map(i => ({ participantId: `p${i}`, name: i === 2 ? "Participante con nombre largo" : `Persona ${i}`, role: i === 0 ? role : "maintenance", status: "active",
        ...(i === 0 || role === "medic" ? { health: 60 + i } : {}), ...(i === 0 ? { energy: 25 } : {}) })),
      resourceActions: [0,1,2,3].map(i => ({ participantId: `p${i}`, ...(role === "medic" ? { medicalEligibility: { allowed: i !== 1, reason: i === 1 ? "treatment-used" : null } } : { packEligibility: { allowed: i !== 1, reason: i === 1 ? "energy-full" : null } }) })) } };
  const markup = renderToStaticMarkup(createElement(TeamStatus, { state, participantId: "p0", enabled: true }));
  expect(markup.match(/data-player=/g)).toHaveLength(4);
  expect(markup.match(/class="card-resource"/g)).toHaveLength(4);
  expect(markup).toContain('disabled=""');
  expect(markup).not.toContain("undefined");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const directory = new URL("../../../.cache/10d1/", import.meta.url); mkdirSync(directory, { recursive: true });
  writeFileSync(new URL(`${role}.html`, directory), `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="shell">${markup}</main></body></html>`);
});
