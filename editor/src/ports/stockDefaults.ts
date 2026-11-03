/**
 * What a type gets for the physics a pack doesn't declare: port of
 * `stock/StockDefaults.java` (SPEC §5.4, §6.4; golden `fixtures/golden/stock_defaults/`).
 * An omitted field takes the engine default, an explicit 0 stays zero; the editor shows
 * these in the empty fields.
 */

/** Davis `a`: per tonne, N/t — bearings and rolling. */
const RESISTANCE_A_PER_TONNE = 7.0;
/** Davis `a`: per wagon, N — flange and track. */
const RESISTANCE_A_PER_WAGON = 200.0;
/** Davis `b`, per wagon, N·s/m. */
const RESISTANCE_B = 14.0;
/** Davis `c`, per wagon — skin and bogie drag, N·s²/m². */
const RESISTANCE_C = 1.3;
/** Nose drag of the leading wagon, N·s²/m². */
const RESISTANCE_C_FRONT = 5.0;
/** Loco/independent brake of a cab-fitted wagon, kN per tonne. */
const INDEPENDENT_KN_PER_TONNE = 0.7;
/** Handbrake, kN per tonne: holds the wagon on about a 4% grade. */
const PARKING_KN_PER_TONNE = 0.4;

/** Adhesion multiplier: all axles powered (`StockDefaults.ADHESION`). */
export const ADHESION = 1.0;
/** Seconds for the tractive effort to follow the throttle, ~95% (`StockDefaults.TRACTION_RAMP_S`). */
export const TRACTION_RAMP_S = 4.0;

/** Davis running-resistance coefficients (`WagonType.Resistance`): N, N·s/m, N·s²/m². */
export interface Resistance {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly cFront: number;
}

/** Brake circuit forces, kN, and the train brake's timing, s (`WagonType.Brakes`). */
export interface Brakes {
  readonly trainKn: number;
  readonly independentKn: number;
  readonly dynamicKn: number;
  readonly dynamicFadeKmh: number;
  readonly parkingKn: number;
  readonly applyS: number;
  readonly releaseS: number;
}

/**
 * A brake system (`StockDefaults.BrakeSystem`): the train brake's force per tonne and how
 * fast it acts. A pack picks one with `"brakes": {"system": …}`.
 */
export interface BrakeSystem {
  /** The JSON name: `passenger`, `freight`, `ep`. */
  readonly jsonName: 'passenger' | 'freight' | 'ep';
  /** Full-service train brake force, kN per tonne. */
  readonly knPerTonne: number;
  /** Seconds to build up (~95%). */
  readonly applyS: number;
  /** Seconds to release (~95%). */
  readonly releaseS: number;
}

/** Passenger air brake: ≈1 m/s², fills in a few seconds. */
export const PASSENGER: BrakeSystem = { jsonName: 'passenger', knPerTonne: 1.0, applyS: 4.0, releaseS: 8.0 };
/** Freight air brake: weaker per tonne, slow along the train. */
export const FREIGHT: BrakeSystem = { jsonName: 'freight', knPerTonne: 0.6, applyS: 15.0, releaseS: 30.0 };
/** Electro-pneumatic (EMU, modern coaches): every car valves at once. */
export const EP: BrakeSystem = { jsonName: 'ep', knPerTonne: 1.1, applyS: 1.5, releaseS: 3.0 };

/** Every brake system, in the engine's order (`BrakeSystem.values()`). */
export const BRAKE_SYSTEMS: readonly BrakeSystem[] = [PASSENGER, FREIGHT, EP];

/** The brake system a type gets when its pack names none. */
export const DEFAULT_BRAKE_SYSTEM: BrakeSystem = PASSENGER;

/** The system with this JSON name (exactly, case and blanks count), or null (`BrakeSystem.byName`). */
export function brakeSystemByName(name: string): BrakeSystem | null {
  return BRAKE_SYSTEMS.find((system) => system.jsonName === name) ?? null;
}

/** Running resistance of a wagon of `massT` tonnes (`StockDefaults.resistance`). */
export function resistance(massT: number): Resistance {
  return {
    a: RESISTANCE_A_PER_TONNE * massT + RESISTANCE_A_PER_WAGON,
    b: RESISTANCE_B,
    c: RESISTANCE_C,
    cFront: RESISTANCE_C_FRONT,
  };
}

/**
 * Brakes of a wagon of `massT` tonnes with `system` (`StockDefaults.brakes`): the train
 * brake from the system, the independent brake if the wagon has a cab, a handbrake; no
 * dynamic brake.
 */
export function brakes(system: BrakeSystem, massT: number, drivable: boolean): Brakes {
  return {
    trainKn: system.knPerTonne * massT,
    independentKn: drivable ? INDEPENDENT_KN_PER_TONNE * massT : 0.0,
    dynamicKn: 0.0,
    dynamicFadeKmh: 0.0,
    parkingKn: PARKING_KN_PER_TONNE * massT,
    applyS: system.applyS,
    releaseS: system.releaseS,
  };
}
