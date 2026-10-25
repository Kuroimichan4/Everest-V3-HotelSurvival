import {useEffect,useRef,useState} from 'react';
import type {PrivateMedicalSabotage} from '@everest/shared';
import {SabotageRequest,sabotageReason,type SabotageSender} from './sabotage-request';
export function BellhopSabotage({state,participantId,gameId,authorized,connected,readOnly=false,onSabotage}:{
 state:PrivateMedicalSabotage|null;participantId:string;gameId:string;authorized:boolean;connected:boolean;readOnly?:boolean;onSabotage?:SabotageSender|undefined;
}){
 const [,render]=useState(0);const mounted=useRef(false);
 const pending=useRef<SabotageRequest|null>(null);
 if(!pending.current||pending.current.gameId!==gameId)pending.current=new SabotageRequest(gameId);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const request=pending.current;
 const own=state?.participantId===participantId&&state.gameId===gameId?state:null;
 if(!authorized&&!own)return null;
 const enabled=connected&&!readOnly&&authorized&&own?.canManipulate===true&&!own.performed&&!own.objectiveFulfilled&&!!onSabotage;
 const changed=()=>{if(mounted.current)render(n=>n+1);};
 return <section className="bellhop-sabotage" aria-label="Capacidad privada de Botones" data-private-capacity="bellhop">
  <p className="eyebrow">SOLO PARA TU PERSONAJE</p><h4>Capacidad especial</h4>
  <p>Manipular una unidad de medicación una sola vez por partida.</p>
  <p><strong>{!own?'Recuperando estado autorizado…':own.objectiveFulfilled?'Sabotaje activado · Objetivo: Cumplido':readOnly?(own.reason==='game-finished'?'Objetivo: Incumplido':'Recuperando resultado final…'):own.performed?'Utilizada · Sabotaje pendiente':own.canManipulate?'Disponible':'No disponible en este momento'}</strong></p>
  {own?.objectiveFulfilled?<p role="status">Tu sabotaje ha tenido efecto. Has cumplido tu objetivo individual.</p>:own?.performed&&!readOnly?<p role="status">Has conseguido manipular la medicación sin que nadie se percate. Ahora solo queda esperar...</p>:null}
  {!readOnly&&<button disabled={!enabled||request.sending||request.confirmed} onClick={()=>{if(enabled&&onSabotage)request.run(onSabotage,changed);}}>{request.sending?'Enviando…':'Manipular medicación'}</button>}
  {own&&!own.performed&&own.reason&&<p className="muted">{sabotageReason(own.reason)}</p>}
  {request.message&&<p role="status">{request.message}</p>}
  {!connected&&<p className="muted">Sin conexión. Recupera tu sesión para consultar el estado autorizado.</p>}
 </section>;
}