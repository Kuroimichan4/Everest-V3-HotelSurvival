import type {GameState} from './game-state';
/** Usa la frase ya persistida por el servidor: no sortea ni acumula avisos locales. */
export function MedicalDeathNotices({state}:{state:GameState}){
 const seen=new Set<string>();
 return <>{(state.medical?.deaths??[]).map(event=>{
  const id=`medical-death:${state.medical!.gameId}:${event.round}:${event.participantId}`;
  if(seen.has(id))return null;seen.add(id);
  const name=state.supplies?.characters.find(c=>c.participantId===event.participantId)?.name??state.final?.humans.find(c=>c.participantId===event.participantId)?.name??'Un compañero';
  return <aside className="notice medical-death-notice" role="status" key={id} data-medical-death={id}>
   <h3>Fallecimiento inesperado: {name}</h3><p>{name} ha fallecido después de un tratamiento. La causa sigue siendo incierta.</p><p>{event.message}</p>
  </aside>;
 })}</>;
}