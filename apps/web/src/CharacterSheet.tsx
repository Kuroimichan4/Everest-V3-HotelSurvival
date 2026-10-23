import type { CharacterSheet as Sheet } from "@everest/shared";

export function CharacterSheet({ sheet }: { sheet: Sheet }) {
  return <section className="character-sheet" aria-labelledby="character-title">
    <p className="eyebrow">Ficha privada de tu personaje</p>
    <h3 id="character-title">{sheet.name}</h3>
    <p>{sheet.responsibility}</p>
    <h4>Objetivo individual</h4>
    <p>{sheet.objective}</p>
    <h4>Conocimientos privados</h4>
    <ul>{sheet.knowledge.map((entry) => <li key={entry.id}>{entry.text}</li>)}</ul>
    <p className="notice">Esta información es privada. Puedes compartirla voluntariamente con el equipo durante la partida.</p>
  </section>;
}
