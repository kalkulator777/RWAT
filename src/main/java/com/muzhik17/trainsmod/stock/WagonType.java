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
 * @param maxSpeedKmh  design (permitted) speed, km/h; 0 = not declared — the
 *                     wagon doesn't limit the train (SPEC §5.4)
 * @param resistance   Davis running-resistance coefficients; never null
 *                     (use {@link Resistance#NONE}; a pack that omits them
 *                     gets {@link StockDefaults#resistance})
 * @param traction     null = unpowered
 * @param cab          null = no driver's seat, cannot be driven from
 * @param brakes       brake circuit forces and timing; never null (use
 *                     {@link Brakes#NONE}; omitted in a pack =
 *                     {@link StockDefaults#brakes})
 * @param interior     boardable interior volume (SPEC v1.5-б); null = not
 *                     boardable for walking (a freight wagon, a bare loco)
 * @param doors        doorways in the hull (SPEC v1.5, doors); empty = none.
 *                     The list order is the door index the per-wagon open
 *                     state is keyed by.
 * @param couplers     where the couplers engage, relative to the frame ends
 *                     (SPEC §6.12); never null (use {@link Couplers#AT_ENDS})
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
        List<Door> doors,
        Couplers couplers) {

    /** A type coupling at its frame ends (every declaration before coupler offsets existed). */
    public WagonType(String id, double length, double[] bogieOffsets, double massT,
            double maxSpeedKmh, Resistance resistance, Traction traction, Cab cab,
            Brakes brakes, Interior interior, List<Door> doors) {
        this(id, length, bogieOffsets, massT, maxSpeedKmh, resistance, traction, cab, brakes,
                interior, doors, Couplers.AT_ENDS);
    }

    /** A type without doors (every declaration before doors existed). */
    public WagonType(String id, double length, double[] bogieOffsets, double massT,
            double maxSpeedKmh, Resistance resistance, Traction traction, Cab cab,
            Brakes brakes, Interior interior) {
        this(id, length, bogieOffsets, massT, maxSpeedKmh, resistance, traction, cab, brakes,
                interior, List.of());
    }

    public WagonType {
        doors = List.copyOf(doors);
        couplers = couplers == null ? Couplers.AT_ENDS : couplers;
    }

    /**
     * Where the couplers engage (SPEC §6.12): each end's offset from the
     * frame end ({@code ±length/2}), blocks, + outward. Coupled wagons stand
     * coupler point to coupler point; a negative offset lets the coupler
     * heads (and the gangway bellows) of two wagons meet inside the frames,
     * the way IR's {@code couplers.front_offset/rear_offset} do.
     */
    public record Couplers(double front, double rear) {

        /** Couplers engaging right at the frame ends. */
        public static final Couplers AT_ENDS = new Couplers(0.0, 0.0);
    }

    /**
     * Distance from the body centre to the coupler point of the type's front
     * ({@code front}) or rear end, blocks.
     */
    public double couplerReach(boolean front) {
        return length / 2.0 + (front ? couplers.front() : couplers.rear());
    }

    /**
     * Davis running resistance of this wagon (SPEC §5.4):
     * {@code R = a + b·v + c·v²} in Newtons with {@code v} in m/s — rolling
     * and the wagon's own skin drag. The {@code a} term doubles as the static
     * (starting) resistance. {@code cFront} is the nose's air drag
     * ({@code cFront·v²}), paid only by the wagon that leads the train in the
     * direction of travel — a locomotive in the middle of a train doesn't push
     * the air, the tail car of a train backing up does.
     */
    public record Resistance(double a, double b, double c, double cFront) {

        public static final Resistance NONE = new Resistance(0.0, 0.0, 0.0, 0.0);

        /** Rolling and skin terms only, no nose drag (every declaration before {@code c_front}). */
        public Resistance(double a, double b, double c) {
            this(a, b, c, 0.0);
        }

        /** Rolling and skin resistance in Newtons at speed {@code vMs} (m/s, sign-free). */
        public double newtons(double vMs) {
            double v = Math.abs(vMs);
            return a + b * v + c * v * v;
        }

        /** The nose's air drag in Newtons at {@code vMs}, when this wagon leads. */
        public double frontalNewtons(double vMs) {
            return cFront * vMs * vMs;
        }
    }

    /**
     * Presence = the wagon produces tractive effort (SPEC §5.1).
     *
     * @param powerKw             power at the rail, kW (the hyperbola {@code TE = P/v})
     * @param maxTractiveEffortKn starting tractive effort, kN
     * @param adhesion            multiplier on the dry-rail adhesion limit
     *                            {@code μ(v)·m·g} (SPEC §5.4): 1 = all axles
     *                            powered, plain wheel slip control; above 1 —
     *                            a modern slip control, below — unpowered axles
     * @param rampS               seconds for the tractive effort to follow the
     *                            throttle (to ~95%, SPEC §5.3) — a diesel
     *                            spools up, an electric is quicker
     */
    public record Traction(double powerKw, double maxTractiveEffortKn, double adhesion, double rampS) {

        /** Default adhesion and ramp (every declaration before them). */
        public Traction(double powerKw, double maxTractiveEffortKn) {
            this(powerKw, maxTractiveEffortKn, StockDefaults.ADHESION, StockDefaults.TRACTION_RAMP_S);
        }
    }

    /**
     * Presence = the consist can be driven from here (SPEC §5.1). A cab with
     * a walkable {@link #interior} is walked like a passenger car and driven
     * by its levers (SPEC §9); its {@code seats} are the driver's chairs,
     * where the keys drive — the assistant's chair beside the driver's, the
     * other end's cab of a double-ended locomotive. A cab without an interior
     * seats the driver at the vehicle's own seat, keys only (every type
     * before §9).
     *
     * @param seats the driver's chairs, in the pack's order (the first is the
     *              one in control when several are manned); empty = none
     */
    public record Cab(List<Seat> seats) {

        public Cab {
            seats = List.copyOf(seats);
        }

        /** A cab without a chair. */
        public Cab() {
            this(List.of());
        }
    }

    /**
     * A driver's chair (SPEC §9) in the <b>model's local frame</b>: the point
     * on top of the cushion a seated driver sits on, and which way they face
     * ({@code yaw} degrees, 0 = model +Z forward, +90 = towards −X, the
     * entity yaw sense).
     */
    public record Seat(double x, double y, double z, float yaw) {

        /** This chair as seen in the pose frame — mirrored for a flipped wagon. */
        public Seat inFrame(boolean flipped) {
            return flipped ? new Seat(-x, y, -z, yaw + 180.0F) : this;
        }

        /**
         * True if the chair looks towards the model's rear (more than 90°
         * off forward — the other end's cab): from it, the driver's forward
         * is the model's −Z. A chair turned square to the side counts as
         * forward.
         */
        public boolean facesBack() {
            double off = ((yaw % 360.0) + 540.0) % 360.0 - 180.0;
            return Math.abs(off) > 90.0;
        }
    }

    /**
     * Per-circuit brake forces, kN, and how fast the train brake acts
     * (SPEC §5.3). Circuits differ in who commands them and which wagons they
     * act on. The force is notch-proportional; it builds up and releases
     * over {@code applyS}/{@code releaseS} — the brake cylinders filling and
     * venting, without simulating the air pipe itself.
     *
     * @param trainKn       automatic (train) brake — driver's brake valve, acts
     *                      on every wagon of the consist; 0 = unbraked wagon
     * @param independentKn loco/independent brake — cab-fitted sections only
     * @param dynamicKn     dynamic brake peak force — traction units only (no
     *                      control for it yet)
     * @param dynamicFadeKmh speed below which the dynamic brake fades to zero
     * @param parkingKn     handbrake, holds a parked wagon on grade
     * @param applyS        seconds for the train/independent brake to build up
     *                      (to ~95%) after the handle moves
     * @param releaseS      seconds for it to release
     */
    public record Brakes(double trainKn, double independentKn,
            double dynamicKn, double dynamicFadeKmh, double parkingKn,
            double applyS, double releaseS) {

        public static final Brakes NONE = new Brakes(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);

        /** Forces only, with a passenger brake's timing (every declaration before timing). */
        public Brakes(double trainKn, double independentKn,
                double dynamicKn, double dynamicFadeKmh, double parkingKn) {
            this(trainKn, independentKn, dynamicKn, dynamicFadeKmh, parkingKn,
                    StockDefaults.BrakeSystem.PASSENGER.applyS(),
                    StockDefaults.BrakeSystem.PASSENGER.releaseS());
        }
    }

    /**
     * The walkable floor (SPEC v1.5-б, §9.1): one or more axis-aligned
     * <b>zones</b> in the <b>model's local frame</b> (+Z forward, +Y up, as the
     * renderer uses). A rider boards as a passenger and walks the zones in
     * local coordinates, the body pose carrying them along for free. A
     * passenger car is one zone (the saloon); a locomotive is its cab plus the
     * walkways and end platforms of the frame. Each zone's {@code minY} is the
     * floor the feet rest on. The floor is the <b>union</b> of the zones (SPEC
     * §9.8): a rider stands wherever their body fits inside it, so zones that
     * touch join without overlapping and a gap of any width between them is
     * a wall ({@link FloorRegion}). Doors between zones ({@link Door#inner})
     * bridge such a gap while open.
     */
    public static final class Interior {

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

        private final List<Zone> zones;
        /** Where a centre fits, for the last margin asked (in practice always the player's). */
        private volatile FloorRegion region;
        /** This floor turned 180° (a flipped wagon), made once. */
        private volatile Interior mirror;

        public Interior(List<Zone> zones) {
            if (zones.isEmpty()) {
                throw new IllegalArgumentException("an interior needs at least one zone");
            }
            this.zones = List.copyOf(zones);
        }

        /** A single-box interior (a passenger saloon; every declaration before §9.1). */
        public Interior(double minX, double minY, double minZ,
                double maxX, double maxY, double maxZ) {
            this(List.of(new Zone(minX, minY, minZ, maxX, maxY, maxZ)));
        }

        /** The floor's boxes, as declared. */
        public List<Zone> zones() {
            return zones;
        }

        /** Where a rider centred there fits, {@code margin} (the player's half-width) off every wall. */
        public FloorRegion region(double margin) {
            FloorRegion r = region;
            if (r == null || r.margin() != margin) {
                r = FloorRegion.of(zones, margin);
                region = r;
            }
            return r;
        }

        /** True if a rider centred at (x, z) stands on the floor, {@code margin} off every wall. */
        public boolean fits(double x, double z, double margin) {
            return region(margin).fits(x, z);
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
         * Clamp a rider's feet to the walkable floor: the nearest point where
         * they fit, {@code margin} (the player's half-width) off every wall, y
         * on the floor there (no stairs/vertical movement). A floor no player
         * fits anywhere gives the nearest zone's midline rather than throwing.
         */
        public org.joml.Vector3d clampFeet(org.joml.Vector3d local, double margin) {
            double[] at = region(margin).nearest(local.x, local.z);
            if (at != null) {
                double floor = floorUnder(at[0], at[1]);
                return new org.joml.Vector3d(at[0], Double.isNaN(floor) ? floorY() : floor, at[1]);
            }
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

        /**
         * The floor under a rider centred at (x, z) — the highest zone under
         * that point — or NaN if they don't fit there.
         */
        public double floorAt(double x, double z, double margin) {
            return fits(x, z, margin) ? floorUnder(x, z) : Double.NaN;
        }

        /** The highest zone floor under the point (x, z), or NaN if no zone is. */
        private double floorUnder(double x, double z) {
            double floor = Double.NaN;
            for (Zone zone : zones) {
                if (zone.holds(x, z, 0.0) && !(zone.minY() <= floor)) {
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
            Interior m = mirror;
            if (m == null) {
                List<Zone> mirrored = new java.util.ArrayList<>(zones.size());
                for (Zone zone : zones) {
                    mirrored.add(zone.mirrored());
                }
                m = new Interior(mirrored);
                m.mirror = this;
                mirror = m;
            }
            return m;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Interior other && zones.equals(other.zones);
        }

        @Override
        public int hashCode() {
            return zones.hashCode();
        }

        @Override
        public String toString() {
            return "Interior[zones=" + zones + "]";
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
     * <p>A {@code connecting} door (SPEC §9.5, IR's {@code DOOR_n_CONNECTING})
     * is an end door onto the gangway: open, walking through it carries the
     * rider into the coupled neighbour on that end, through the neighbour's
     * own connecting door there; with no such neighbour it is wall. It isn't
     * a way in from the ground, so the hull isn't cut there either.
     *
     * @param id    the door's name, matching the model's animation for it
     *              (e.g. {@code door1} ↔ the asset's {@code Door1} control group)
     * @param group doors of one group open and close together, null = on its
     *              own: IR works all doors of a control group at once (an
     *              EMU's left side, DR1's {@code DL}), and one IR animation may
     *              swing the leaves of several doorways
     */
    public record Door(String id, double minX, double minY, double minZ,
            double maxX, double maxY, double maxZ, boolean inner, boolean fixed,
            boolean connecting, String group) {

        /** An ordinary hull door (every declaration before §9.1). */
        public Door(String id, double minX, double minY, double minZ,
                double maxX, double maxY, double maxZ) {
            this(id, minX, minY, minZ, maxX, maxY, maxZ, false, false, false, null);
        }

        /** A hull, inner or fixed door (§9.1, before gangways). */
        public Door(String id, double minX, double minY, double minZ,
                double maxX, double maxY, double maxZ, boolean inner, boolean fixed) {
            this(id, minX, minY, minZ, maxX, maxY, maxZ, inner, fixed, false, null);
        }

        /** A door on its own (§9.5, before door groups). */
        public Door(String id, double minX, double minY, double minZ,
                double maxX, double maxY, double maxZ, boolean inner, boolean fixed,
                boolean connecting) {
            this(id, minX, minY, minZ, maxX, maxY, maxZ, inner, fixed, connecting, null);
        }

        /** True if this door opens and closes together with {@code other} (same group). */
        public boolean groupedWith(Door other) {
            return group != null && group.equals(other.group);
        }

        /** True for a way in from outside: neither between zones nor onto a gangway. */
        public boolean external() {
            return !inner && !connecting;
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
            return flipped
                    ? new Door(id, -maxX, minY, -maxZ, -minX, maxY, -minZ, inner, fixed, connecting, group)
                    : this;
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

    /** How far outside a door's box a model leaf's centre may lie and still be that door's. */
    private static final double LEAF_SLACK = 0.1;

    /**
     * The door a model part centred at ({@code x, y, z}) — model frame —
     * belongs to: the first door with a leaf whose box, grown by
     * {@value #LEAF_SLACK}, holds that point; −1 if none. A leaf the asset
     * moves by {@code ROT_}/{@code TL_} swings with this door's openness
     * (SPEC §9.5): no names to match, so a hand-declared door box picks up
     * its leaf as well.
     */
    public int doorHolding(double x, double y, double z) {
        for (int i = 0; i < doors.size(); i++) {
            Door d = doors.get(i);
            if (!d.fixed() && x >= d.minX() - LEAF_SLACK && x <= d.maxX() + LEAF_SLACK
                    && y >= d.minY() - LEAF_SLACK && y <= d.maxY() + LEAF_SLACK
                    && z >= d.minZ() - LEAF_SLACK && z <= d.maxZ() + LEAF_SLACK) {
                return i;
            }
        }
        return -1;
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
     * between zones ({@link Door#inner}) and onto gangways ({@link
     * Door#connecting}) aren't a way in.
     */
    public boolean doorsOnly() {
        if (!boardable()) {
            return false;
        }
        for (Door door : doors) {
            if (door.external()) {
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
