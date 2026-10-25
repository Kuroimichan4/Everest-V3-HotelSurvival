import type { AssignedRole, GameFinalResult, PrivateObjectiveEvidence } from '@everest/shared';

/** Stable prose selection only; never reads or consumes the simulation RNG. */
export function narrativeVariant(seed: string, category: string, alternatives: readonly string[]): string {
  let hash = 2166136261;
  for (const character of `${seed}:${category}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return alternatives[(hash >>> 0) % alternatives.length]!;
}
const collective = {
  all: ['La calle os recibió a todos. Entre el polvo y el miedo, mantuvisteis al equipo unido hasta el último umbral. El hotel no consiguió quedarse con ninguno de vosotros.',
    'Salisteis todos. En un edificio que parecía empeñado en separar vuestros caminos, lograsteis que la última puerta se abriera para el equipo entero.'],
  partial: ['Una parte del equipo alcanzó la calle. La salida existe, pero las ausencias impiden confundirla con una victoria completa.',
    'Quienes llegaron al exterior pueden respirar de nuevo. El alivio es real; también lo son los huecos que quedaron en el equipo.'],
  deadAll: ['El hotel guardó todos vuestros nombres. Ninguno de los humanos del equipo alcanzó la calle con vida; el silencio es ahora el desenlace de vuestra historia.',
    'No hubo regreso para el equipo humano. La evacuación terminó en duelo, y la calle quedó al otro lado de una promesa que nadie pudo cumplir.'],
  noExit: ['Ningún humano del equipo tiene una evacuación confirmada. El desastre cerró esta historia sin concederle una llegada a la calle.',
    'La salida no quedó registrada para ninguno del equipo humano. Lo que se sabe termina aquí; el silencio no autoriza a inventar el destino de quienes quedaron atrás.'],
  deaths: ['Los compañeros fallecidos merecen algo más que una cifra. Sus historias terminaron dentro del hotel; no fueron simples nombres tachados de una decisión.',
    'Hubo vidas que el edificio no devolvió. Recordarlas exige distinguir la pérdida de una persona de cualquier cálculo sobre el camino restante.'],
  abandoned: ['Hubo compañeros abandonados. Quizá continuar pareciera la única decisión posible; aun así, la palabra «necesario» no vuelve ligero el peso de dejar a alguien atrás.',
    'El equipo dejó atrás a parte de los suyos. Sobrevivir puede exigir decisiones terribles; resulta menos convincente fingir después que no tuvieron un coste moral.'],
  npcSaved: ['También llegaron a la calle supervivientes que encontraron ayuda en vosotros. Frente al impulso de pensar solo en el siguiente paso, hicisteis sitio a otras vidas.',
    'La evacuación alcanzó a personas que no formaban parte del equipo inicial. Su llegada al exterior da al esfuerzo compartido una grandeza que ninguna cifra necesita adornar.'],
  npcAbandoned: ['Hubo supervivientes encontrados que quedaron abandonados. Sus peticiones no desaparecen porque la decisión resultara conveniente; algunas preguntas pesan más que una puerta cerrada.',
    'Dejasteis atrás a supervivientes que habíais encontrado. Tal vez el riesgo fuera demasiado alto. Esa explicación merece ser examinada, no convertida sin más en una absolución.'],
  npcApproved: ['Una ayuda aprobada no llegó a convertirse en rescate. La intención quedó escrita; la mano que debía alcanzarla no completó el trayecto.',
    'Hubo promesas de rescate que no pudieron ejecutarse. El acuerdo habla de una intención, pero no puede hacerse pasar por una vida puesta a salvo.'],
  npcUnknown: ['Se completaron rescates cuya llegada al exterior no consta. Reconocer ese esfuerzo no permite inventarles un desenlace.',
    'Algunos rescates quedaron registrados sin una evacuación confirmada. Hay mérito en haber ayudado y prudencia en no contar un final que nadie ha acreditado.'],
  npcDead: ['También fallecieron supervivientes encontrados durante el recorrido. Su destino merece ser reconocido sin disfrazarlo de un abandono.',
    'Entre los encuentros del hotel hubo vidas que terminaron allí. La muerte y el abandono no son el mismo desenlace, aunque ambos dejen una ausencia.'],
} as const;

export function collectiveNarrative(result: GameFinalResult): { title: string; paragraphs: string[] } {
  const { evacuated, dead, abandoned, evacuatedNpcs } = result.counts;
  const total = result.humans.length;
  const base = total > 0 && evacuated === total ? 'all' : evacuated > 0 ? 'partial' : total > 0 && dead === total ? 'deadAll' : 'noExit';
  const categories: (keyof typeof collective)[] = [base];
  if (dead > 0 && base !== 'deadAll') categories.push('deaths');
  if (abandoned > 0) categories.push('abandoned');
  if (evacuatedNpcs > 0) categories.push('npcSaved');
  if (result.npcs.some(n => n.status === 'abandoned')) categories.push('npcAbandoned');
  if (result.npcs.some(n => n.status === 'approved')) categories.push('npcApproved');
  if (result.npcs.some(n => n.status === 'rescued' && n.evacuated !== true)) categories.push('npcUnknown');
  if (result.npcs.some(n => n.status === 'dead')) categories.push('npcDead');
  return { title: { all: 'Todos al otro lado', partial: 'La victoria y sus ausencias', deadAll: 'El hotel guardó sus nombres', noExit: 'La salida quedó pendiente' }[base],
    paragraphs: categories.map(category => narrativeVariant(result.gameId ?? result.id, `collective:${category}`, collective[category])) };
}
const individual: Record<AssignedRole, Record<PrivateObjectiveEvidence['evaluation'], readonly string[]>> = {
  maintenance: {
    fulfilled: ['Donde los demás veían paredes, tú encontraste posibilidades y las compartiste. Conocer el edificio sirvió de algo más que de consuelo: abriste alternativas para el equipo.', 'Tu conocimiento salió de los planos y llegó a tus compañeros. Compartiste suficientes alternativas para que el hotel dejara de imponer un único camino.'],
    unfulfilled: ['El hotel tenía recovecos; tu conocimiento no llegó a convertirse en suficientes alternativas compartidas. Un pasadizo guardado en silencio se parece demasiado a una pared.', 'Conocer las entrañas del edificio era una ventaja prometedora. Habría resultado aún más útil convertirla en las revelaciones que el equipo necesitaba.'],
    'pending-evaluation': ['Queda constancia de lo que compartiste, pero no basta para acreditar tu cometido. La historia conserva sus puertas abiertas; el veredicto sigue pendiente.', 'El registro no permite cerrar la valoración de tus alternativas. Ni la fama de conocer el hotel ni una frase solemne pueden sustituir las pruebas que faltan.'],
  },
  medic: {
    fulfilled: ['Todos los pacientes humanos que atendiste sobrevivieron. Entre el estruendo y el miedo, tus cuidados sostuvieron vidas que pudieron alcanzar el exterior.', 'Quienes recibieron tus cuidados llegaron con vida. En un hotel que se venía abajo, conseguiste que atender a otros siguiera significando esperanza.'],
    unfulfilled: ['No todos tus pacientes sobrevivieron. La medicina tuvo límites terribles aquella noche; el deber de cuidar también exige mirar de frente los desenlaces que no pudo evitar.', 'Tus cuidados no alcanzaron a salvar a todos los pacientes. La bata no concede inmunidad frente a la pérdida, ni convierte el dolor en una explicación suficiente.'],
    'pending-evaluation': ['No hay pruebas suficientes para cerrar tu cometido. La ausencia de un desenlace acreditado no puede convertirse, por cortesía, en un triunfo médico.', 'Tu valoración permanece pendiente. Aquí los cuidados se juzgan por pacientes y destinos registrados, no por el prestigio de quien llevaba el botiquín.'],
  },
  'architect-engineer': {
    fulfilled: ['El grupo completó el recorrido sin atravesar rutas de riesgo extremo. Tu cometido quedó cumplido: la prudencia también puede tener la firmeza de una estructura bien pensada.', 'Ninguna ruta extrema formó parte del itinerario completado. A veces la mejor demostración de criterio consiste en los peligros que no llegan a convertirse en pasos.'],
    unfulfilled: ['El grupo atravesó una ruta de riesgo extremo. Los conocimientos estructurales no votaban por sí solos, desde luego; el trayecto dejó una ironía difícil de apuntalar.', 'Una ruta extrema terminó bajo vuestros pies. La estructura de tu cometido era clara; las decisiones del grupo encontraron una forma bastante dramática de contradecirla.'],
    'pending-evaluation': ['El recorrido registrado no permite cerrar tu cometido. Una historia incompleta no demuestra prudencia ni autoriza a inventar una temeridad.', 'Tu valoración sigue pendiente: solo cuentan los caminos efectivamente recorridos y los hechos acreditados. Las posibilidades que no ocurrieron no merecen condena.'],
  },
  bellhop: {
    fulfilled: ['Tu plan secreto dejó una víctima humana y cumplió su propósito. Una eficacia siniestra: mientras el hotel se desmoronaba, tu discreción también encontró cómo hacer daño.', 'Tu cometido oculto quedó cumplido. Hay una ironía helada en prestar servicio con tanta atención a los detalles que nadie debía advertir.'],
    unfulfilled: ['Tu plan no consiguió la muerte humana que exigía tu cometido secreto. Tanta discreción para acabar sin el desenlace que buscabas: un servicio bastante deficiente para tus propias ambiciones.', 'El hotel ofrecía caos de sobra, pero tus propósitos ocultos no alcanzaron su objetivo. Esta vez, la intriga se quedó sin el final que habías pretendido.'],
    'pending-evaluation': ['Tu propósito oculto no tiene todavía un desenlace acreditado. El silencio puede guardar secretos; no fabrica pruebas.', 'La valoración de tu cometido permanece pendiente. Una intención oscura tampoco tiene derecho a atribuirse hechos que no constan.'],
  },
};
export function objectiveNarrative(seed: string, participantId: string, role: AssignedRole, evaluation: PrivateObjectiveEvidence['evaluation']): string {
  return narrativeVariant(`${seed}:${participantId}`, `objective:${role}:${evaluation}`, individual[role][evaluation]);
}
const survival = {
  evacuated: ['Alcanzaste el exterior con vida. El aire frío no borra lo ocurrido, pero te concede algo que el hotel estuvo a punto de arrebatarte: un después.', 'La calle está bajo tus pies. Sigues con vida, y ahora te corresponde cargar con el recuerdo de cómo llegaste hasta ella.'],
  dead: ['Tu historia terminó antes de alcanzar la calle. El hotel conserva el lugar donde cayó tu personaje; su muerte merece un nombre propio, no una explicación apresurada.', 'Tu personaje falleció dentro del hotel. No hay salida confirmada que pueda cambiar ese destino, ni cifra capaz de contar toda su historia.'],
  abandoned: ['Tu personaje quedó abandonado. Cuando el grupo decidió quién continuaba, tu nombre quedó al otro lado de la esperanza; el registro no determina lo que ocurrió después.', 'Te dejaron atrás. Eso es lo que consta, y ya pesa bastante: no hace falta inventar una muerte para reconocer la dureza de aquel abandono.'],
  active: ['Tu personaje seguía activo en el registro final, pero su evacuación no quedó confirmada. Esta historia no concederá una salida que nadie ha acreditado.', 'El último registro conserva a tu personaje activo. Su llegada a la calle sigue sin constar; el relato se detiene donde terminan los hechos.'],
} as const;
export function survivalNarrative(seed: string, participantId: string, status: GameFinalResult['humans'][number]['status']): string {
  return narrativeVariant(`${seed}:${participantId}`, `survival:${status}`, survival[status]);
}
