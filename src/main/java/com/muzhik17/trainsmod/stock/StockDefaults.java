package com.muzhik17.trainsmod.stock;

import java.util.Locale;

/**
 * What a type gets for the physics a pack doesn't declare (SPEC §5.4, §6.4):
 * an omitted field takes the engine default, an explicit {@code 0} stays
 * zero. A pack written by hand and one made by the IR converter run on the
 * same defaults — the converter only writes what its source actually knows.
 * Pure, no MC imports.
 *
 * <p>The figures are those of real stock (Russian traction-calculation
 * norms and the Davis form, SI): a pack describes the real machine, and how
 * arcade a server plays is its physics profile ({@code physics.PhysicsTuning}),
 * not the data.
 */
public final class StockDefaults {

    /** Davis {@code a}: per tonne, N/t — bearings and rolling. */
    static final double RESISTANCE_A_PER_TONNE = 7.0;
    /** Davis {@code a}: per wagon, N — flange and track. */
    static final double RESISTANCE_A_PER_WAGON = 200.0;
    /** Davis {@code b}, per wagon, N·s/m. */
    static final double RESISTANCE_B = 14.0;
    /** Davis {@code c}, per wagon — skin and bogie drag, N·s²/m². */
    static final double RESISTANCE_C = 1.3;
    /** Nose drag of the leading wagon, N·s²/m² (½·ρ·Cd·A of a train front). */
    static final double RESISTANCE_C_FRONT = 5.0;

    /** Loco/independent brake of a cab-fitted wagon, kN per tonne. */
    static final double INDEPENDENT_KN_PER_TONNE = 0.7;
    /** Handbrake, kN per tonne: holds the wagon on about a 4% grade. */
    static final double PARKING_KN_PER_TONNE = 0.4;

    /** Adhesion multiplier: all axles powered. */
    public static final double ADHESION = 1.0;
    /** Seconds for the tractive effort to follow the throttle (~95%). */
    public static final double TRACTION_RAMP_S = 4.0;

    private StockDefaults() {
    }

    /**
     * Brake systems (SPEC §5.3): how strong the train brake is per tonne and
     * how fast it acts. A pack picks one with {@code "brakes": {"system": …}}
     * and may override any figure.
     *
     * @param knPerTonne full-service train brake force, kN per tonne (≈ the
     *                   deceleration in m/s² it alone gives)
     * @param applyS     seconds to build up (~95%)
     * @param releaseS   seconds to release (~95%)
     */
    public enum BrakeSystem {
        /** Passenger air brake: ≈1 m/s², fills in a few seconds. */
        PASSENGER(1.0, 4.0, 8.0),
        /** Freight air brake: weaker per tonne, slow along the train. */
        FREIGHT(0.6, 15.0, 30.0),
        /** Electro-pneumatic (EMU, modern coaches): every car valves at once. */
        EP(1.1, 1.5, 3.0);

        private final double knPerTonne;
        private final double applyS;
        private final double releaseS;

        BrakeSystem(double knPerTonne, double applyS, double releaseS) {
            this.knPerTonne = knPerTonne;
            this.applyS = applyS;
            this.releaseS = releaseS;
        }

        public double knPerTonne() {
            return knPerTonne;
        }

        public double applyS() {
            return applyS;
        }

        public double releaseS() {
            return releaseS;
        }

        /** The JSON name: {@code passenger}, {@code freight}, {@code ep}. */
        public String jsonName() {
            return name().toLowerCase(Locale.ROOT);
        }

        /** The system with this JSON name, or null. */
        public static BrakeSystem byName(String name) {
            for (BrakeSystem system : values()) {
                if (system.jsonName().equals(name)) {
                    return system;
                }
            }
            return null;
        }
    }

    /** The brake system a type gets when its pack names none. */
    public static final BrakeSystem DEFAULT_BRAKE_SYSTEM = BrakeSystem.PASSENGER;

    /**
     * Running resistance of a wagon of {@code massT} tonnes (SPEC §5.4):
     * close to the Russian norms for roller-bearing cars on welded track —
     * a 53 t coach coasts down from 100 km/h at ≈0.04 m/s².
     */
    public static WagonType.Resistance resistance(double massT) {
        return new WagonType.Resistance(
                RESISTANCE_A_PER_TONNE * massT + RESISTANCE_A_PER_WAGON,
                RESISTANCE_B, RESISTANCE_C, RESISTANCE_C_FRONT);
    }

    /**
     * Brakes of a wagon of {@code massT} tonnes with {@code system}: the train
     * brake from the system, the independent brake if the wagon has a cab,
     * a handbrake; no dynamic brake.
     */
    public static WagonType.Brakes brakes(BrakeSystem system, double massT, boolean drivable) {
        return new WagonType.Brakes(
                system.knPerTonne() * massT,
                drivable ? INDEPENDENT_KN_PER_TONNE * massT : 0.0,
                0.0, 0.0,
                PARKING_KN_PER_TONNE * massT,
                system.applyS(), system.releaseS());
    }
}
