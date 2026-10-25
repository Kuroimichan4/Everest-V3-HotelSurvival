import { expect, test } from "vitest";
import { characterSheet } from "./character-sheets.js";

const cases = [
  ["maintenance", "Mantenimiento", "Descubrir y revelar al equipo al menos dos rutas alternativas que los demás desconocían."],
  ["medic", "Médico", "Conseguir que sobrevivan todos los heridos atendidos."],
  ["architect-engineer", "Arquitecto / Ingeniero", "Evitar que el grupo atraviese zonas de riesgo estructural extremo."],
  ["bellhop", "Botones", "Conseguir que al menos un jugador humano muera envenenado como consecuencia del sabotaje de Botones."],
] as const;

test.each(cases)("ficha y objetivo aprobados de %s", (role, name, objective) => {
  const sheet = characterSheet(role);
  expect(sheet.name).toBe(name);
  expect(sheet.objective).toBe(objective);
  expect(sheet.responsibility.length).toBeGreaterThan(0);
  expect(sheet.knowledge.length).toBeGreaterThan(0);
  const serialized = JSON.stringify(sheet);
  expect(serialized).not.toMatch(/10%|70%|30%|peligro real|peligro.*bajo|riesgo.*bajo|4 packs|8 packs/i);
  expect(serialized).not.toMatch(/(?:dos|2) unidades médicas|garantizad[oa]s?/i);
  expect(serialized.includes("conferencia médica")).toBe(role === "medic");
  expect(serialized.includes("almacén de suministros")).toBe(role === "bellhop");
});

test("el Médico conoce la sala desde el inicio sin asegurar suministros ni cantidades", () => {
  const conference = characterSheet("medic").knowledge.find((entry) => entry.id === "conference")!;
  expect(conference.text).toContain("Tras la puerta cortafuegos de la ronda 3");
  expect(conference.text).toContain("conferencia médica a la que asistías");
  expect(conference.text).toContain("podrías encontrar suministros médicos");
  expect(conference.text).toContain("no hay garantías de que sigan intactos tras el terremoto");
});

test("conocimientos técnicos autorizados y almacén sin cantidad", () => {
  expect(JSON.stringify(characterSheet("maintenance"))).toContain("palanca");
  expect(JSON.stringify(characterSheet("maintenance"))).toContain("conductos de ventilación");
  const warehouse = characterSheet("bellhop").knowledge.find((entry) => entry.id === "warehouse")!;
  expect(warehouse.text).toContain("No conoces cuántos packs contiene");
  expect(warehouse.text).not.toMatch(/\b[48]\b|cuatro|ocho/);
});

test("la proyección filtra por fase y devuelve copias sin alterar el catálogo", () => {
  expect(characterSheet("medic", []).knowledge).toEqual([]);
  const original = characterSheet("medic");
  const copy = characterSheet("medic");
  copy.knowledge[0]!.text = "alterado";
  expect(characterSheet("medic")).toEqual(original);
});

test("Botones gestiona packs sin conocimientos privados sobre huéspedes",()=>{const sheet=characterSheet("bellhop");expect(sheet.responsibility).toContain("packs compartidos");expect(sheet.knowledge.map(k=>k.text).join(" ")).not.toMatch(/huéspedes|situación personal|privilegiada/);expect(sheet.objective).toBe("Conseguir que al menos un jugador humano muera envenenado como consecuencia del sabotaje de Botones.");});
