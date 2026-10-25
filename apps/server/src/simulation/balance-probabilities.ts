/** Fuente interna de probabilidades estándar; conserva la referencia histórica para el análisis. */
export const HISTORICAL_PROBABILITIES = Object.freeze({ LOW: .10, MODERATE: .20, HIGH: .35, EXTREME: .50 });
export const PROPOSED_PROBABILITIES = Object.freeze({ LOW: .20, MODERATE: .35, HIGH: .55, EXTREME: .70 });
export type StructuralRisk = keyof typeof HISTORICAL_PROBABILITIES;

/** Balance aprobado de 10B.3. No serializar esta tabla a los jugadores. */
export const ACCIDENT_PROBABILITIES = PROPOSED_PROBABILITIES;
