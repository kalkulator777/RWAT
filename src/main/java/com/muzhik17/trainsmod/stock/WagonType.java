package com.muzhik17.trainsmod.stock;

import java.util.List;

/**
 * Declaration of one rolling-stock type (SPEC §5.1): the data that makes a
 * ChME3 different from a boxcar — geometry, mass, traction, brakes, cab.
 * Pure data, no MC imports; this is a 1:1 sketch of the future pack JSON, so
 * fields use human units (tonnes, kW, km/h, kN) and get converted to
 * blocks/ticks at the point of use, not here.
 *
 * <p>Roles are <b>capabilities, not an enum</b> (SPEC §5.1): {@link #powered()}
 * is the presence of a {@link Traction} section, {@link #drivable()} the
 * presence of a {@link Cab}. A locomotive has both; a cab car only the cab; an
 * EMU motor car only traction; freight stock neither.
 *
 * @param id           namespaced type id, e.g. {@code rwat:chme3}
 * @param length       over buffers/couplers, blocks
 * @param bogieOffsets longitudinal bogie pivot positions relative to the body
 *                     centre, +forward, front first — a list, not a pair
 *                     (SPEC §5.1: two bogies are the common case, not the model)
 * @param massT        empty mass, tonnes (cargo is a future per-instance field)
 * @param maxSpeedKmh  design speed, km/h
 * @param resistance   Davis running-resistance coefficients; never null
 *                     (use {@link Resistance#NONE})
 * @param traction     null = unpowered
 * @param cab          null = no driver's seat, cannot be driven from
 * @param brakes       brake circuit forces; never null (use {@link Brakes#NONE})
 * @param interior     boardable interior volume (SPEC v1.5-б); null = not
 *                     boardable for walking (a freight wagon, a bare loco)
 * @param doors        doorways in the hull (SPEC v1.5, doors); empty = none.
 *                     The list order is the door index the per-wagon open
 *                     state is keyed by.
 */
public record WagonType(
        String id,
        double length,
        double[] bogieOffsets,
        double massT,
        double maxSpeedKmh,
        Resistance resistance,
        Traction traction,
        Cab cab,
        Brakes brakes,
        Interior interior,
        List<Door> doors) {

    /** A type without doors (every declaration before doors existed). */
    public WagonType(String id, double length, double[] bogieOffsets, double massT,
            double maxSpeedKmh, Resistance resistance, Traction traction, Cab cab,
            Brakes brakes, Interior interior) {
        this(id, length, bogieOffsets, massT, maxSpeedKmh, resistance, traction, cab, brakes,
                interior, List.of());
    }

    public WagonType {
        doors = List.copyOf(doors);
    }

    /**
     * Davis running resistance of this wagon (SPEC §5.4):
     * {@code R = a + b·v + c·v²} in Newtons with {@code v} in m/s. The
     * {@code a} term doubles as the static (starting) resistance.
     */
    public record Resistance(double a, double b, double c) {

        public static final Resistance NONE = new Resistance(0.0, 0.0, 0.0);

        /** Resistance magnitude in Newtons at speed {@code vMs} (m/s, sign-free). */
        public double newtons(double vMs) {
            double v = Math.abs(vMs);
            return a + b * v + c * v * v;
        }
    }

    /** Presence = the wagon produces tractive effort (SPEC §5.1). */
    public record Traction(double powerKw, double maxTractiveEffortKn) {
    }

    /**
     * Presence = the consist can be driven from here (SPEC §5.1). A cab with
     * a walkable {@link #interior} is walked like a passenger car and driven
     * by its levers (SPEC §9); its optional {@code seat} is the driver's
     * chair, where the keys drive. A cab without an interior seats the driver
     * at the vehicle's own seat, keys only (every type before §9).
     *
     * @param seat the driver's chair, null = none
     */
    public record Cab(Seat seat) {

        /** A cab without a chair. */
        public Cab() {
            this(null);
        }
    }

    /**
     * The driver's chair (SPEC §9) in the <b>model's local frame</b>: the
     * point on top of the cushion a seated driver sits on, and which way they
     * face ({@code yaw} degrees, 0 = model +Z forward, +90 = towards −X, the
     * entity yaw sense).
     */
    public record Seat(double x, double y, double z, float yaw) {

        /** This chair as seen in the pose frame — mirrored for a flipped wagon. */
        public Seat inFrame(boolean flipped) {
            return flipped ? new Seat(-x, y, -z, yaw + 180.0F) : this;
        }
    }

    /**
     * Per-circuit brake forces, kN (SPEC §5.3). Circuits differ in who commands
     * them and which wagons they act on; v-first the force is notch-proportional
     * and instant — no air-pipe simulation, the data shape doesn't depend on it.
     *
     * @param trainKn       automatic (train) brake — driver's brake valve, acts
     *                      on every wagon of the consist; 0 = unbraked wagon
     * @param independentKn loco/independent brake — cab-fitted sections only
     * @param dynamicKn     dynamic brake peak force — traction units only
     * @param dynamicFadeKmh speed below which the dynamic brake fades to zero
     * @param parkingKn     handbrake, holds a parked consist on grade
     */
    public record Brakes(double trainKn, double independentKn,
            double dynamicKn, double dynamicFadeKmh, double parkingKn) {

        public static final Brakes NONE = new Brakes(0.0, 0.0, 0.0, 0.0, 0.0);
    }

    /**
     * The walkable floor (SPEC v1.5-б, §9.1): one or more axis-aligned
     * <b>zones</b> in the <b>model's local frame</b> (+Z forward, +Y up, as the
     * renderer uses). A rider boards as a passenger and walks the zones in
     * local coordinates, the body pose carrying them along for free. A
     * passenger car is one zone (the saloon); a locomotive is its cab plus the
     * walkways and end platforms of the frame. Each zone's {@code minY} is the
     * floor the feet rest on; its faces are walls. Zones that join must overlap
     * (by at least a player width) — a rider crosses from one to the other
     * where both hold them. Doors between zones ({@link Door#inner}) bridge
     * the wall while open.
     */
    public record Interior(List<Zone> zones) {

        /** One box of floor. */
        public record Zone(double minX, double minY, double minZ,
                double maxX, double maxY, double maxZ) {

            /** True if a rider centred at (x, z) fits inside, {@code margin} off the walls. */
            public boolean holds(double x, double z, double margin) {
                return x >= minX + margin - EPS && x <= maxX - margin + EPS
                        && z >= minZ + margin - EPS && z <= maxZ - margin + EPS;
            }

            /** (x, z) pulled inside, {@code margin} off the walls, feet on this floor. */
            public org.joml.Vector3d clamp(double x, double z, double margin) {
                return new org.joml.Vector3d(clampAxis(x, minX, maxX, margin), minY,
                        clampAxis(z, minZ, maxZ, margin));
            }

            Zone mirrored() {
                return new Zone(-maxX, minY, -maxZ, -minX, maxY, -minZ);
            }
        }

        private static final double EPS = 1.0e-9;

        public Interior {
            if (zones.isEmpty()) {
                throw new IllegalArgumentException("an interior needs at least one zone");
            }
            zones = List.copyOf(zones);
        }

        /** A single-box interior (a passenger saloon; every declaration before §9.1). */
        public Interior(double minX, double minY, double minZ,
                double maxX, double maxY, double maxZ) {
            this(List.of(new Zone(minX, minY, minZ, maxX, maxY, maxZ)));
        }

        /** The lowest floor — where a rider is put when nothing better is known. */
        public double floorY() {
            double floor = Double.MAX_VALUE;
            for (Zone zone : zones) {
                floor = Math.min(floor, zone.minY());
            }
            return floor;
        }

        // the bounds of all zones (one zone: its own faces)
        public double minX() {
            return zones.stream().mapToDouble(Zone::minX).min().orElseThrow();
        }

        public double maxX() {
            return zones.stream().mapToDouble(Zone::maxX).max().orElseThrow();
        }

        public double minZ() {
            return zones.stream().mapToDouble(Zone::minZ).min().orElseThrow();
        }

        public double maxZ() {
            return zones.stream().mapToDouble(Zone::maxZ).max().orElseThrow();
        }

        /**
         * Clamp a rider's feet to the walkable floor: the nearest point of any
         * zone, {@code margin} (the player's half-width) off its walls, y on that
         * zone's floor (no stairs/vertical movement). Degenerate-narrow axes
         * collapse to their midpoint rather than throwing.
         */
        public org.joml.Vector3d clampFeet(org.joml.Vector3d local, double margin) {
            org.joml.Vector3d best = null;
            double bestDist = Double.MAX_VALUE;
            for (Zone zone : zones) {
                org.joml.Vector3d c = zone.clamp(local.x, local.z, margin);
                double d = Math.hypot(c.x - local.x, c.z - local.z);
                if (d < bestDist - EPS) {
                    best = c;
                    bestDist = d;
                }
            }
            return best;
        }

        /** The highest floor among zones holding (x, z), or NaN if none does. */
        public double floorAt(double x, double z, double margin) {
            double floor = Double.NaN;
            for (Zone zone : zones) {
                if (zone.holds(x, z, margin) && !(zone.minY() <= floor)) {
                    floor = zone.minY();
                }
            }
            return floor;
        }

        /**
         * This floor as seen in the frame the wagon's pose puts it in: a
         * flipped wagon is the model turned 180° about Y, so a cab at one end
         * is at the other (doors do the same, {@link Door#inFrame}).
         */
        public Interior inFrame(boolean flipped) {
            if (!flipped) {
                return this;
            }
            List<Zone> mirrored = new java.util.ArrayList<>(zones.size());
            for (Zone zone : zones) {
                mirrored.add(zone.mirrored());
            }
            return new Interior(mirrored);
        }

        private static double clampAxis(double value, double min, double max, double margin) {
            double lo = min + margin;
            double hi = max - margin;
            if (lo > hi) {
                return (min + max) * 0.5;
            }
            return Math.clamp(value, lo, hi);
        }
    }

    /**
     * One doorway (SPEC v1.5, doors): the door leaf's box in the <b>model's
     * local frame</b> (+Z forward, +Y up), as measured from the asset's
     * {@code DOOR_n} object. The box is thin along the wall it sits in — that
     * thinnest horizontal extent is the wall normal ({@link #axis}), and the
     * side of the body centre it lies on is the outward direction
     * ({@link #outward}). Closed, the door is part of the hull wall; open, the
     * hull has a walk-through opening there and the interior a way out.
     *
     * <p>Two variations (SPEC §9.1): an {@code inner} door sits between two
     * floor zones (a cab door onto a loco's walkway) — closed it is wall, open
     * a bridge between them; the hull isn't cut. A {@code fixed} door has no
     * leaf: an always-open opening such as a loco's corner steps.
     *
     * @param id the door's name, matching the model's animation for it
     *           (e.g. {@code door1} ↔ the asset's {@code Door1} control group)
     */
    public record Door(String id, double minX, double minY, double minZ,
            double maxX, double maxY, double maxZ, boolean inner, boolean fixed) {

        /** An ordinary hull door (every declaration before §9.1). */
        public Door(String id, double minX, double minY, double minZ,
                double maxX, double maxY, double maxZ) {
            this(id, minX, minY, minZ, maxX, maxY, maxZ, false, false);
        }

        /** True if this doorway lets a rider through now, given the open-door bits. */
        public boolean open(int openMask, int index) {
            return fixed || (index < 32 && (openMask >> index & 1) != 0);
        }

        /** The face towards the wagon centre, along {@link #axis}. */
        public double innerFace() {
            return axis() == 0 ? (outward() > 0 ? minX : maxX) : (outward() > 0 ? minZ : maxZ);
        }

        /** The face away from the wagon centre, along {@link #axis}. */
        public double outerFace() {
            return axis() == 0 ? (outward() > 0 ? maxX : minX) : (outward() > 0 ? maxZ : minZ);
        }

        /** The wall normal: 0 = X (a side door), 2 = Z (an end door). */
        public int axis() {
            return maxX - minX <= maxZ - minZ ? 0 : 2;
        }

        /** +1 if the door faces the + side of its {@link #axis}, −1 if the − side. */
        public int outward() {
            double centre = axis() == 0 ? minX + maxX : minZ + maxZ;
            return centre >= 0.0 ? 1 : -1;
        }

        /** Span along the wall, horizontally: Z for a side door, X for an end door. */
        public double spanMin() {
            return axis() == 0 ? minZ : minX;
        }

        public double spanMax() {
            return axis() == 0 ? maxZ : maxX;
        }

        /**
         * This door as seen in the frame the wagon's pose puts it in: a
         * flipped wagon is the model turned 180° about Y (SPEC §5.5 step 3),
         * so its doors swap sides and ends.
         */
        public Door inFrame(boolean flipped) {
            return flipped ? new Door(id, -maxX, minY, -maxZ, -minX, maxY, -minZ, inner, fixed) : this;
        }
    }

    /**
     * The solid collision hull (SPEC v1.5-а): the body envelope that pushes
     * outside entities, an axis-aligned box in the <b>model's local frame</b>
     * (+Z forward, +Y up). A single solid box, with {@code minZ/maxZ} the
     * rear/front end walls; open {@link Door}s cut walk-through openings in
     * it for players (SPEC v1.5, see {@code HullCollision.Portal}).
     */
    public record Hull(double minX, double minY, double minZ,
            double maxX, double maxY, double maxZ) {
    }

    /** Half the stock loading gauge, blocks — body half-width of the collision hull. */
    private static final double HULL_HALF_WIDTH = 1.7;
    /** Hull floor in model space: above the under-frame gap so an entity can't crouch under. */
    private static final double HULL_MIN_Y = 0.4;
    /** Hull roof in model space: standard loading-gauge height. */
    private static final double HULL_MAX_Y = 4.7;

    /**
     * This type's solid collision hull (SPEC v1.5-а). v0 derives it from
     * {@link #length} (z half-length) and standard loading-gauge constants
     * (width/height) — a single box per car, so even a cab loco with no
     * {@link #interior} gets a pushing body. Per-type overrides come later;
     * door openings are applied at collision time from the open-door state.
     * Tuned by play-test, not gospel.
     */
    public Hull collidableHull() {
        double halfLen = length / 2.0;
        return new Hull(-HULL_HALF_WIDTH, HULL_MIN_Y, -halfLen,
                HULL_HALF_WIDTH, HULL_MAX_Y, halfLen);
    }

    public boolean powered() {
        return traction != null;
    }

    public boolean drivable() {
        return cab != null;
    }

    /** True if a player can board and walk this wagon's interior (SPEC v1.5-б). */
    public boolean boardable() {
        return interior != null;
    }

    /**
     * True if the interior is entered and left only through its doors (SPEC
     * v1.5, doors) — the right-click board/exit is kept just for boardable
     * types declaring no way in, which would otherwise be unreachable. Doors
     * between zones ({@link Door#inner}) aren't a way in.
     */
    public boolean doorsOnly() {
        if (!boardable()) {
            return false;
        }
        for (Door door : doors) {
            if (!door.inner()) {
                return true;
            }
        }
        return false;
    }

    /** Distance from the first (front) to the last bogie pivot, blocks. */
    public double wheelbase() {
        return bogieOffsets[0] - bogieOffsets[bogieOffsets.length - 1];
    }
}
