import type {PersonalDeathMessage} from '@everest/shared';
import type {GameState} from './game-state';
/** Un panel del destinatario, sin cola de notificaciones ni ampliación de permisos. */
export function PersonalDeathNotice({state,participantId,message}:{state:GameState;participantId:string;message:PersonalDeathMessage|null}){
 const own=state.final?.humans.find(p=>p.participantId===participantId)??state.supplies?.characters.find(p=>p.participantId===participantId);
 const gameId=state.final?.gameId??state.supplies?.gameId;
 if(!message||message.participantId!==participantId||message.gameId!==gameId||!own)return null;
 if(own.status==='abandoned'||('eliminated' in own&&own.eliminated)||own.status==='evacuated')return null;
 if(own.status!=='dead'&&own.health!==0)return null;
 return <section className="panel personal-death-notice" role="status" aria-label="Tu fallecimiento" data-personal-death={message.eventId}>
  <p className="eyebrow">TU CAMINO EN EL HOTEL HA TERMINADO</p><h2>Has fallecido</h2>
  <p>{message.message}</p>
  <p className="personal-death-restrictions">Ya no puedes participar en las decisiones, votar, administrar recursos ni realizar acciones de tu rol o de anfitrión.</p>
 </section>;
}