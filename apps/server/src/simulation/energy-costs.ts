/** Balance 8C. Fuente única del backend; las vistas públicas proyectan estos costes. */
export const MOVEMENT_ENERGY = Object.freeze({
  "round-one-passage": 25,
  "unstable-corridor": 20,
  ventilation: 30,
  shoring: 40,
  "fire-door": 30,
  "pipe-gallery": 20,
  "metal-debris": 40,
});

/** Salidas de ronda 4; el catálogo anterior mantiene sus siete entradas. */
export const EXIT_MOVEMENT_ENERGY = Object.freeze({ "revolving-door": 20, "exterior-crack": 10 });

// El rescate de NPC y el transporte humano son operaciones independientes.
export const NPC_RESCUE_ENERGY = 25;
export const IMMOBILE_NPC_RESCUE_ENERGY = 40;
export const TRANSPORT_ENERGY_PER_PERSON = 15;
