/** Información pública durante la espera; room:start inicia la simulación. */
export function GameIntroduction() {
 return <section className="game-introduction" aria-labelledby="introduction-title">
  <p className="eyebrow">ANTES DE COMENZAR</p><h2 id="introduction-title">El terremoto llegó sin previo aviso</h2>
  <p>En unos segundos, los pasillos del hotel se deformaron, las paredes comenzaron a resquebrajarse y varias plantas quedaron parcialmente sepultadas. Las alarmas siguen sonando entre el polvo y los escombros.</p>
  <p>En el exterior, la ciudad también ha sufrido graves daños. Nadie sabe cuánto tardarán en llegar los equipos de emergencia.</p>
  <p>Cuatro supervivientes han conseguido reunirse. Cada uno posee conocimientos diferentes, pero escapar por su cuenta será difícil. El edificio sigue temblando: cada decisión puede acercarlos a la salida… o dejarlos atrapados para siempre.</p>
  <h3>Cómo sobrevivir juntos</h3>
  <ul><li>La simulación tiene seis rondas. Cada participante recibe un rol, información privada y un objetivo individual.</li>
   <li>Algunas decisiones se votan con tiempo limitado. Podéis cambiar vuestro voto mientras estén abiertas.</li>
   <li>La salud y la energía pueden agotarse; los suministros médicos y los packs son limitados.</li>
   <li>Compartid información y coordinaos: las decisiones y sus consecuencias afectan a las rondas posteriores.</li></ul>
  <p className="notice">Leed esta introducción antes de empezar. El anfitrión iniciará la primera ronda cuando el equipo esté preparado; hasta entonces no hay votaciones ni cuenta atrás.</p>
 </section>;
}