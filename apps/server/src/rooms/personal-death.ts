import type {PersonalDeathMessage} from '@everest/shared';
import type {SimulationState} from '../simulation/state.js';
import type {RoundFourState} from '../simulation/round-four.js';
/** Solo categorías de sucesos públicos. Nunca consultar medicalSabotage ni sus tiradas. */
export const PERSONAL_DEATH_NARRATIVES:Record<PersonalDeathMessage['kind'],readonly string[]>={
 accident:[
  'El estruendo del edificio te alcanza antes de que puedas reaccionar. Intentas aferrarte a las voces del equipo, pero el mundo se apaga entre polvo y escombros. Tu camino ha terminado.',
  'Un golpe rompe el frágil equilibrio de tu huida. El suelo parece alejarse y las voces se confunden con el crujido del hotel. La oscuridad termina por envolverlo todo.',
 ],
 gas:[
  'Cada respiración se vuelve más difícil. Buscas a tus compañeros entre la bruma, pero sus siluetas se desdibujan mientras tus fuerzas se agotan. El ruido del hotel acaba convirtiéndose en silencio.',
  'Intentas avanzar una vez más, buscando aire entre el humo y el polvo. Las voces del equipo parecen lejanas. Tus pasos se detienen y la oscuridad cierra el pasillo a tu alrededor.',
 ],
 explosion:[
  'Un destello atraviesa la penumbra y el estruendo lo ocupa todo. Apenas alcanzas a reconocer las voces de tus compañeros antes de que el hotel desaparezca tras una oscuridad sin respuesta.',
  'La explosión te deja sin tiempo para un último paso. El mundo tiembla, las voces se rompen entre los escombros y todo lo que intentabas alcanzar queda al otro lado del silencio.',
 ],
 unexpected:[
  'Por un instante, todo parecía estar bajo control. Entonces sientes que las fuerzas te abandonan. Las voces de tus compañeros se escuchan cada vez más lejos, hasta que todo queda en silencio. ¿Qué ha ocurrido realmente? Nadie parece tener una respuesta.',
  'Intentas decir algo, pero el mundo comienza a alejarse sin que entiendas por qué. Las luces se desdibujan y las voces del equipo se pierden en la distancia. Nadie puede explicar con certeza lo sucedido.',
 ],
};
function publicContext(state:SimulationState,id:string):{kind:PersonalDeathMessage['kind'];round:SimulationState['currentRound']} {
 const sudden=state.suddenMedicalDeaths?.find(d=>d.characterId===id);
 if(sudden)return {kind:'unexpected',round:sudden.round};
 const crisis=state.transportIncidents?.find(d=>d.deceasedIds.includes(id));
 if(crisis)return {kind:crisis.kind==='explosion'?'explosion':'gas',round:crisis.round};
 const final='roundFour' in state?(state as RoundFourState).roundFour:undefined;
 if(final?.collapse?.deceasedIds.includes(id)||final?.exit?.deceasedIds.includes(id))return {kind:'accident',round:6};
 const middle=state.intermediateConsequences?.find(d=>d.deceasedIds.includes(id));
 if(middle)return {kind:'accident',round:middle.round};
 const route=state.intermediateRounds?.find(d=>d.status==='completed'&&d.effects.deceasedIds.includes(id));
 if(route)return {kind:'accident',round:route.round};
 const third=state.roundThreeRoute;
 if(third?.status==='completed'&&third.outcome.deceasedIds.includes(id)){
  const smoke=third.outcome.environmentalVictimIds.includes(id)&&third.outcome.environmentalDamage>0;
  const accident=third.outcome.victimIds.includes(id);
  return {kind:smoke&&!accident?'gas':!smoke&&accident?'accident':'unexpected',round:3};
 }
 const moved=state.transportMovements?.find(d=>d.deceasedIds.includes(id));
 if(moved){const damage=moved.damage.find(d=>d.characterId===id);return {kind:damage?.accidentDamage&&!damage.guaranteedDamage?'accident':'unexpected',round:moved.round};}
 const second=state.roundTwo?.movement;
 if(second?.status==='completed'&&(second.victims.some(v=>v.characterId===id&&v.damage>0)||second.microearthquake))return {kind:'accident',round:2};
 if(state.currentRound===2&&state.roundTwo?.resolution?.microearthquake)return {kind:'accident',round:2};
 if(state.currentRound===1&&state.roundOnePreparation?.result==='NO_AGREEMENT')return {kind:'accident',round:1};
 return {kind:'unexpected',round:state.currentRound};
}
/** Variante determinista por evento; no consume azar del motor ni cambia sus consecuencias. */
export function personalDeathMessage(state:SimulationState,gameId:string,characterId:string,participantId:string):PersonalDeathMessage|null {
 const human=state.characters.find(c=>c.id===characterId);
 if(!human||human.health>0||human.eliminated)return null;
 const context=publicContext(state,characterId);const eventId=`${gameId}:death:${participantId}`;
 let hash=2166136261;for(const char of eventId)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
 const variants=PERSONAL_DEATH_NARRATIVES[context.kind];
 return {gameId,participantId,eventId,round:context.round,kind:context.kind,message:variants[hash%variants.length]!};
}