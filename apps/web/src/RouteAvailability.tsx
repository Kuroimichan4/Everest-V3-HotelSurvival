import type { RouteAvailability, RouteRecovery, FailedRouteSelection } from "@everest/shared";
import { reasonLabel } from "./game-state";

const reasons: Record<string, string> = {
  "earthquake-blocked-route": "El terremoto ha bloqueado esta ruta; la galería es obligatoria.",
  "route-energy-insufficient": "Energía insuficiente para atravesar esta ruta: no hay un plan de transporte viable.",
  "more-than-two-exhausted": "Hay más de dos compañeros agotados; su transporte sigue pendiente de definición.",
  "no-eligible-carriers": "No hay porteadores con energía suficiente.",
  "transport-plan-infeasible": "El plan de transporte no puede pagarse íntegramente.",
  "insufficient-energy": "Energía insuficiente para atravesar esta ruta.",
  "specialist-availability-pending": "La disponibilidad sin los especialistas necesarios sigue pendiente de definición.",
  "crowbar-unavailable-pending": "La palanca necesaria no está disponible.",
  "no-living-characters": "No quedan personajes activos; el desenlace sigue pendiente.",
};
export function RouteAvailabilityNotice({ value }: { value: RouteAvailability }) {
  return <span> {value.status === "available" ? "Disponible." : value.status === "with-help"
    ? "Disponible con ayuda: requiere votación de transporte. Cualquier abandono necesita una decisión válida."
    : `No disponible. ${reasons[value.reason ?? ""] ?? "Esta ruta tiene un requisito pendiente."}`}</span>;
}
export function RouteRecoveryPanel({ recovery, history, enabled, busy, onRetry }: {
  recovery?: RouteRecovery | undefined; history?: FailedRouteSelection[] | undefined; enabled: boolean; busy: boolean; onRetry?: ((decisionId: string) => void) | undefined;
}) {
  return <>
    {recovery && <section aria-label="Recuperación de selección">
      <p role="alert">La ruta elegida no puede ejecutarse. {reasons[recovery.reason] ?? reasonLabel(recovery.reason)} No se ha aplicado este desplazamiento.</p>
      <p>{recovery.forced ? "La ruta es obligatoria por falta de consenso. Reparte packs durante esta preparación si es posible y vuelve a comprobarla. No se permite cambiarla por otra; si no puede recuperarse, el caso queda pendiente."
        : "Puedes volver a preparación para escoger otra ruta mediante una nueva votación colectiva, conservando el estado actual."}</p>
      {onRetry && <button disabled={!enabled || busy} onClick={() => onRetry(recovery.decisionId)}>{recovery.forced ? "Volver a comprobar ruta obligatoria" : "Volver a elegir ruta"}</button>}
    </section>}
    {!!history?.length && <details><summary>Selecciones que no pudieron ejecutarse</summary><ul>{history.map(h => <li key={h.decisionId}>Ronda {h.round}: selección no ejecutada. {reasons[h.reason] ?? reasonLabel(h.reason)}</li>)}</ul></details>}
  </>;
}
