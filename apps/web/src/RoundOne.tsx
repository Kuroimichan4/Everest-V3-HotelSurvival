import type { OwnVote, PublicVote, RoundOneSummary } from "@everest/shared";
import { VotePanel } from "./VotePanel";
export function RoundOne({ summary, vote, own, enabled, busy, onVote }: {
  summary: RoundOneSummary | null; vote: PublicVote; own: OwnVote | null; enabled: boolean; busy: boolean; onVote: (option: string) => void;
}) {
  if (summary || vote.status !== "open") return <p>La decisión ha terminado. Esperando el siguiente paso del servidor.</p>;
  return <section aria-label="Rescate de superviviente">
    <p className="eyebrow">DECISIÓN DEL EQUIPO</p><h2>¿Rescatamos al superviviente?</h2>
    <p className="action-description">{vote.round === 1 ? "Tras el terremoto encontráis a un superviviente que necesita ayuda para caminar." : "Un segundo superviviente necesita ayuda para caminar."}</p>
    {vote.round === 1 && <p>El paso que abandona la planta de habitaciones es obligatorio: −25 de energía por humano que camine, además del esfuerzo de rescate si se aprueba.</p>}
    <VotePanel title="Votación de rescate" vote={vote} own={own} enabled={enabled} busy={busy} onVote={onVote} options={[
      { id: "rescue", label: "Rescatar", detail: "−25 de energía por humano participante." },
      { id: "abandon", label: "Continuar sin rescatar", detail: "El equipo continúa sin este superviviente." },
    ]} />
  </section>;
}
