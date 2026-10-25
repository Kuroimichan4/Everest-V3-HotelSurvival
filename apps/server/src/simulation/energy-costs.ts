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

/** Salidas de ronda 6; el catálogo anterior mantiene sus siete entradas. */
export const EXIT_MOVEMENT_ENERGY = Object.freeze({ "revolving-door": 20, "exterior-crack": 10 });

// El rescate de NPC y el transporte humano son operaciones independientes.
export const NPC_RESCUE_ENERGY = 25;
export const IMMOBILE_NPC_RESCUE_ENERGY = 40;
export const TRANSPORT_ENERGY_PER_PERSON = 15;

/** Rondas intermedias 4 y 5; costes aprobados en 10B.1. */
export const INTERMEDIATE_ENERGY = Object.freeze({
  "cracked-stairs": 10, "service-walkway": 20, "technical-stairs": 25,
  "collapsed-kitchen": 10, "restaurant-corridor": 20, "extraction-gallery": 25,
});

/** 10F.1: solo trabajo técnico en despeje; transportados no realizan esfuerzo. */
export const SHORING_SPECIALIST_ENERGY = 5;
