import {isAlive,type SimulationState} from './state.js';
export const POISON_PROBABILITY = 0.25;
export interface MedicalSabotage {
 readonly actorId:string;readonly requestId:string;readonly status:'pending'|'consumed';
 readonly uses:readonly {round:SimulationState['currentRound'];patientId:string;poisoned:boolean}[];
 readonly victimId?:string;
}
export const SUDDEN_DEATH_NARRATIVES = [
 'El tratamiento parecía normal, pero el paciente empeoró de repente. Su respiración se apagó y falleció. Nadie comprende qué ha ocurrido.',
 'Durante una intervención aparentemente habitual, el paciente sufrió un brusco empeoramiento y murió. Entre el polvo y las alarmas, la causa sigue siendo incierta.',
 'Todo parecía transcurrir con normalidad. De pronto, el estado del paciente se agravó hasta que dejó de responder y falleció. El equipo no encuentra una explicación clara.',
] as const;
export function manipulateMedication(state:SimulationState,actorId:string,requestId:string){
 const actor=state.characters.find(c=>c.id===actorId);
 const reject=(error:string)=>({ok:false as const,state,error});
 if(!actor||actor.role!=='bellhop')return reject('not-authorized');
 if(state.medicalSabotage)return state.medicalSabotage.actorId===actorId&&state.medicalSabotage.requestId===requestId?{ok:true as const,state}:reject('sabotage-already-used');
 if(!isAlive(actor))return reject('bellhop-dead');
 if(state.inventory.medicalUnits<=0)return reject('no-medical-units');
 return {ok:true as const,state:{...state,medicalSabotage:{actorId,requestId,status:'pending' as const,uses:[]}}};
}