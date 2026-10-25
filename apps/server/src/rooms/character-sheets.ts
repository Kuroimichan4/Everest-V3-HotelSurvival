import type { AssignedRole, CharacterSheet } from "@everest/shared";

interface KnowledgeDefinition {
  id: string;
  text: string;
  revealAt: "briefing" | "round-1" | "round-2" | "round-3" | "round-4";
}
interface RoleDefinition extends Omit<CharacterSheet, "knowledge"> {
  knowledge: KnowledgeDefinition[];
}

// Catálogo privado del backend. No importar desde la web ni añadir valores secretos del motor.
const definitions: Record<AssignedRole, RoleDefinition> = {
  maintenance: {
    name: "Mantenimiento",
    responsibility: "Aportas conocimientos técnicos sobre instalaciones y herramientas para abrir rutas alternativas.",
    objective: "Descubrir y revelar al equipo al menos dos rutas alternativas que los demás desconocían.",
    knowledge: [
      { id: "technical", revealAt: "briefing", text: "Conoces las instalaciones, las herramientas y la existencia de los conductos de ventilación como ruta técnica." },
      { id: "crowbar", revealAt: "briefing", text: "Inicialmente dispones de la palanca necesaria para determinadas acciones." },
    ],
  },
  medic: {
    name: "Médico",
    responsibility: "Puedes consultar la salud del equipo y administrar tratamientos con las unidades médicas compartidas disponibles.",
    objective: "Conseguir que sobrevivan todos los heridos atendidos.",
    knowledge: [
      { id: "medical", revealAt: "briefing", text: "Posees conocimientos médicos especializados sobre los supervivientes." },
      { id: "conference", revealAt: "briefing", text: "Tras la puerta cortafuegos de la ronda 3 está la sala de la conferencia médica a la que asistías. Allí podrías encontrar suministros médicos; no hay garantías de que sigan intactos tras el terremoto ni conoces la cantidad aprovechable." },
    ],
  },
  "architect-engineer": {
    name: "Arquitecto / Ingeniero",
    responsibility: "Ayudas al equipo a evaluar la seguridad estructural de las rutas conocidas cuando se abre su votación.",
    objective: "Evitar que el grupo atraviese zonas de riesgo estructural extremo.",
    knowledge: [
      { id: "structural", revealAt: "briefing", text: "Puedes evaluar el estado estructural de las rutas conocidas después de abrir la votación de su ronda." },
    ],
  },
  bellhop: {
    name: "Botones",
    responsibility: "Gestionas los packs compartidos y distribuyes suministros energéticos al equipo.",
    objective: "Conseguir que al menos un jugador humano muera envenenado como consecuencia del sabotaje de Botones.",
    knowledge: [
      { id: "locations", revealAt: "briefing", text: "Conoces las zonas de servicio y la ubicación de suministros energéticos del hotel; puedes repartir los packs compartidos." },
      { id: "warehouse", revealAt: "briefing", text: "Conoces el almacén de suministros de la ronda 3, al que se llega por el desvío entre escombros metálicos. No conoces cuántos packs contiene." },
    ],
  },
};

/** Proyección explícita: futuras fases podrán revelar entradas sin enviar el catálogo. */
export function characterSheet(role: AssignedRole, revealed: readonly KnowledgeDefinition["revealAt"][] = ["briefing"]): CharacterSheet {
  const definition = definitions[role];
  return {
    name: definition.name,
    responsibility: definition.responsibility,
    objective: definition.objective,
    knowledge: definition.knowledge.filter((entry) => revealed.includes(entry.revealAt))
      .map(({ id, text }) => ({ id, text })),
  };
}
