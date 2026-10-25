import type { RouteRiskCategory } from "@everest/shared";
export function RouteRisk({ danger }: { danger?: RouteRiskCategory | undefined }) {
  if (!danger) return null;
  const labels = { LOW: "BAJO", MODERATE: "MODERADO", HIGH: "ALTO", EXTREME: "EXTREMO" };
  return <p className="specialist-information structural-report" aria-label="Informe estructural">Evaluación estructural: <strong>{labels[danger]}</strong></p>;
}
/** Solo contexto público; los encuentros y descubrimientos se describen en su fase real. */
export function RoundIntroduction({ round }: { round: number }) {
  const texts: Record<number,string> = {
    1: "El temblor ha cesado, pero el edificio continúa crujiendo. El polvo llena la planta de habitaciones; hay muebles desplazados, alarmas y puertas deformadas. Un superviviente pide ayuda entre los escombros. El grupo debe organizarse antes de abandonar esta zona.",
    2: "El grupo alcanza el pasillo principal. Las grietas cruzan el techo y los objetos caídos cortan el paso. Antes de continuar hacia los servicios del hotel, debe elegir cómo atravesar esta zona y preparar los recursos que conserva.",
    3: "Las réplicas han alcanzado la planta de servicios. Una puerta de seguridad bloquea un acceso; las tuberías, la maquinaria y las piezas metálicas desplazadas ocupan los demás pasos. El equipo revisa sus herramientas antes de decidir por dónde continuar.",
    6: "El grupo alcanza finalmente el vestíbulo. La luz del exterior entra por las grietas, mientras continúan los desprendimientos en el edificio. La calle está al otro lado de los últimos obstáculos; el equipo debe preparar la salida con los recursos que aún conserva.",
  };
  return texts[round] ? <p className="action-description" data-round-narrative={round}>{texts[round]}</p> : null;
}
