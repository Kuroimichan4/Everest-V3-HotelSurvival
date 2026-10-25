import type {MedicalSabotageInput,MedicalSabotageReply} from '@everest/shared';
export type SabotageSender=(input:MedicalSabotageInput,done:(reply:MedicalSabotageReply|null)=>void)=>void;
export function sabotageReason(reason:string|null) {
 const messages:Record<string,string>={
  'no-medical-units':'No quedan unidades médicas disponibles.',
  'sabotage-already-used':'El servidor indica que esta capacidad ya se utilizó.',
  'game-finished':'La partida ha terminado.',
  'bellhop-dead':'Tu personaje ya no puede actuar.',
  'supplies-not-open':'Esta fase no permite manipular la medicación.',
  'not-authorized':'Tu sesión no está autorizada para esta capacidad.',
  'invalid-session':'Recupera tu sesión antes de actuar.',
  'wrong-game':'Recupera el estado actual de la partida.',
 };
 return messages[reason??'']??'El servidor no permite esta acción en el estado actual.';
}
/** Un envío en vuelo; los reintentos sin confirmación conservan el identificador. */
export class SabotageRequest {
 sending=false;
 confirmed=false;
 private serial=0;
 message='';
 private requestId:string|null=null;
 constructor(readonly gameId:string){}
 run(send:SabotageSender,changed:()=>void){
  if(this.sending||this.confirmed)return;
  this.requestId??=crypto.randomUUID();
  const input={gameId:this.gameId,requestId:this.requestId};
  this.sending=true;this.message='';changed();
  const serial=++this.serial;
  send(input,reply=>{
   if(!this.sending||serial!==this.serial)return;
   this.sending=false;
   if(!reply)this.message='Sin confirmación del servidor. Puedes reintentar con la misma solicitud o reconectar para recuperar el estado.';
   else if(!reply.ok)this.message=sabotageReason(reply.error);
   else if(reply.requestId!==input.requestId||reply.state.gameId!==input.gameId)this.message='La respuesta no corresponde a la solicitud. Recupera tu sesión.';
   if(reply?.ok && reply.requestId===input.requestId && reply.state.gameId===input.gameId && reply.state.performed)this.confirmed=true;
   changed();
  });
 }
}