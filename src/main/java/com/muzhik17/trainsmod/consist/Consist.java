package com.muzhik17.trainsmod.consist;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.muzhik17.trainsmod.network.TrackPathSpec;
import com.muzhik17.trainsmod.path.HermiteSegmentPath;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.path.RoutePath;
import com.muzhik17.trainsmod.physics.AutoHandbrake;
import com.muzhik17.trainsmod.physics.ControlResponse;
import com.muzhik17.trainsmod.physics.PhysicsTuning;
import com.muzhik17.trainsmod.physics.TrainPhysics;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypes;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.nbt.Tag;

/**
 * A consist: logical server-side object, NOT an Entity (SPEC §2.1, decision
 * 0.2). Lives in {@link ConsistManager} (SavedData), owns head
 * distance-along-path {@code s}, speed {@code v} and the ordered wagon list.
 *
 * <p>Direction in v0 is the sign of {@code v} (the SPEC's separate direction
 * field becomes meaningful with switches in v1).
 *
 * <p>The path is described by a {@link TrackPathSpec} — either a route
 * through the rail graph (Layer 1) or the v0 debug straight line — and is
 * materialized lazily against the graph; on graph edits ({@code revision}
 * change) it is rebuilt, and if the route no longer exists the consist
 * freezes. The wagon list always has length 1 in v0 but is a list from day
 * one (SPEC principle #6).
 *
 * <p><b>Coupling (SPEC §6.12):</b> consists that run into each other on one
 * track merge, and a consist can be cut at a coupler; both {@link #rebase}
 * the consist onto a new route / composition. Whenever the meaning of
 * {@code s} changes under the clients' feet (merge, re-anchoring) the consist
 * bumps its <i>frame</i> and records the shift that carries old {@code s}
 * values into the new frame, so clients re-express their interpolation buffer
 * instead of sliding the train across the gap ({@link #shiftFrame}).
 *
 * <p><b>Cab facing:</b> the reverser is the handle as the driver sees it —
 * forward is where the <i>active cab</i> looks. {@link #cabFacing} records
 * which way along the path that cab faces (a cab in a flipped slot looks
 * towards −s), so the traction direction is {@code reverser × cabFacing}.
 */
public final class Consist {

    /** Throttle and brake handles both run 0..{@code NOTCHES} (SPEC §5.3). */
    public static final int NOTCHES = 8;
    /** Driver's signal bits (SPEC §10): the horn (тифон) is sounding. */
    public static final int HORN = 1;
    /** The second signal — the whistle (свисток), IR's "bell" — is sounding. */
    public static final int BELL = 2;
    /** Held notch keys repeat at this period, ticks (first press applies instantly). */
    private static final int NOTCH_REPEAT_TICKS = 5;
    /**
     * The reverser can only be thrown at a standstill (|v| below this,
     * blocks/tick) — the driver's panel shows the train standing by the same rule.
     */
    public static final double REVERSER_STOP_EPS = 1.0e-3;
    /** Type id given to wagons of a save from before compositions were stored. */
    private static final String LEGACY_TYPE_ID = "rwat:legacy";
    /**
     * The legs a route re-walk keeps (SPEC §2.2) reach this far past the
     * train's coupler ends, blocks — plus {@link #KEEP_TICKS} of travel.
     */
    private static final double KEEP_MARGIN = 0.05;
    /**
     * Ticks of travel the kept legs reach past the train's ends: the clients'
     * interpolation delay (2 ticks, {@code ClientConsists}) with a margin.
     */
    private static final double KEEP_TICKS = 4.0;

    private final int id;
    private TrackPathSpec pathSpec;
    private ConsistComposition composition;
    private final List<UUID> wagonIds = new ArrayList<>();
    private double s;
    private double v;

    // driver controls (SPEC §5.3/§5.4): persisted — a parked train keeps its handles
    /** −1 reverse, 0 neutral (cab lever only, SPEC §9), +1 forward. */
    private int reverser = 1;
    private int throttleNotch;
    private int brakeNotch;
    /** Independent (loco) brake, 0..{@code NOTCHES} — cab lever only (SPEC §9). */
    private int indBrakeNotch;
    /** +1 if the active cab faces +s, −1 if it faces −s (a flipped cab slot). Persisted. */
    private int cabFacing = 1;
    /**
     * The wagon whose cab last drove (SPEC §9): its levers show the handles,
     * the other cabs' rest. Transient — after a restart the next driver sets it.
     */
    private transient UUID activeCab;
    /**
     * Wagons whose handbrake is set (SPEC §5.3), by UUID — the state follows
     * the wagon through couplings and cuts. Persisted.
     */
    private final Set<UUID> handbrakes = new HashSet<>();

    // the efforts in effect (SPEC §5.3: a handle sets a target the brakes and
    // engines follow with a lag), 0..1; NaN = take the handle at once (a
    // fresh or reloaded consist). Transient — a restart applies the handles.
    private transient double throttleEffort = Double.NaN;
    private transient double brakeEffort = Double.NaN;
    private transient double indBrakeEffort = Double.NaN;
    /** The pull direction the throttle effort was building for (reverser × cab facing). */
    private transient int effortPull;
    /** Speed the consist ran into a track end with this tick, km/h; 0 = didn't. */
    private transient double endImpactKmh;

    // client frame bookkeeping (SPEC §6.12): transient — clients drop their
    // consist state on disconnect, and a server restart is one
    private transient int frame;
    private transient double frameShift;
    private transient boolean frameUnsent;
    private transient int frameFrom;

    // transient input state: held key directions from the latest DriveInputPayload
    private transient int throttleDir;
    private transient int brakeDir;
    private transient boolean reverserToggle;
    /** Held signals from the driver (SPEC §10): {@link #HORN}, {@link #BELL}. */
    private transient int signals;
    private transient int throttleHeldTicks;
    private transient int brakeHeldTicks;
    private transient boolean controlsChanged;

    private TrackPath cachedPath;
    private int cachedRevision = -1;
    /** The legs the train stood on when its route was last re-walked (SPEC §2.2); transient. */
    private transient List<RailGraph.RouteLeg> keptLegs;

    public Consist(int id, TrackPathSpec pathSpec, ConsistComposition composition,
            double s, double v) {
        this.id = id;
        this.pathSpec = pathSpec;
        this.composition = composition;
        this.s = s;
        this.v = v;
        this.frameFrom = id;
    }

    public ConsistComposition composition() {
        return composition;
    }

    public int id() {
        return id;
    }

    public TrackPathSpec pathSpec() {
        return pathSpec;
    }

    /**
     * Materialize the path against the graph at {@code revision}. A route is
     * not a frozen leg list (SPEC §2.2): it is re-walked around the legs the
     * train stands on whenever the train moves onto other legs and whenever
     * the graph changes (new rails, demolition, a thrown switch) — so newly
     * built track joins the route, demolishing track merely shortens it, a
     * switch the train has cleared routes it by its current position, and a
     * route round a cycle never runs out. The legs under the train never
     * change while it stands on them. Null only if nothing of the old route
     * survived (the consist stays frozen until it is removed).
     */
    public TrackPath resolvePath(RailGraph graph, int revision) {
        if (cachedRevision != revision) {
            if (pathSpec instanceof TrackPathSpec.Route route
                    && cachedPath instanceof RoutePath oldPath) {
                RailGraph.Span span = spanUnderTrain(route, oldPath);
                if (survives(graph, span)) {
                    rewalk(graph, route, oldPath, span);
                } else {
                    reanchor(graph, route, oldPath);
                }
            }
            materialize(graph, revision);
        }
        if (pathSpec instanceof TrackPathSpec.Route route && cachedPath instanceof RoutePath path) {
            RailGraph.Span span = spanUnderTrain(route, path);
            if (!span.legs().equals(keptLegs) && survives(graph, span)
                    && rewalk(graph, route, path, span)) {
                materialize(graph, revision);
            }
        }
        return cachedPath;
    }

    private void materialize(RailGraph graph, int revision) {
        cachedPath = pathSpec.resolve(graph);
        cachedRevision = revision;
        // path may have changed shape/length under the consist: stay in range
        // (a loop has no ends — sampling wraps, nothing to clamp to)
        if (cachedPath != null && !cachedPath.loop()) {
            s = Math.clamp(s, minHeadS(cachedPath.length()), cachedPath.length());
        }
    }

    /**
     * The legs of the route the train stands on. The span reaches past the
     * coupler ends by {@link #KEEP_MARGIN} plus {@link #KEEP_TICKS} of travel:
     * clients draw the train a couple of ticks in the past and must still
     * find it on a re-walked route.
     */
    private RailGraph.Span spanUnderTrain(TrackPathSpec.Route route, RoutePath path) {
        double margin = KEEP_MARGIN + Math.abs(v) * KEEP_TICKS;
        return RailGraph.span(route.legs(), path,
                Coupling.rearEndS(composition, s) - margin, Coupling.frontEndS(composition, s) + margin);
    }

    /** Whether every leg of the span still exists (none was demolished). */
    private static boolean survives(RailGraph graph, RailGraph.Span span) {
        for (RailGraph.RouteLeg leg : span.legs()) {
            if (graph.segment(leg.segmentId()) == null) {
                return false;
            }
        }
        return true;
    }

    /**
     * Re-walk the route around the legs the train stands on (SPEC §2.2,
     * {@link RailGraph#walkAround}): they are kept, the route beyond the
     * train's ends is walked anew through the switches as they are now, and
     * {@code s} is renumbered so the train stays put. Done when the train
     * moved onto other legs and when the graph changed.
     *
     * @return true if the route changed
     */
    private boolean rewalk(RailGraph graph, TrackPathSpec.Route route, RoutePath path, RailGraph.Span span) {
        keptLegs = span.legs();
        RailGraph.Rewalk rewalk = graph.rewalk(route.legs(), path, span);
        if (rewalk == null) {
            return false;
        }
        pathSpec = TrackPathSpec.Route.of(rewalk.legs());
        // same train, new numbering: clients shift their buffered s instead of sliding
        shiftFrame(rewalk.shift());
        s += rewalk.shift();
        return true;
    }

    /**
     * A leg under the train was demolished: anchor to the leg of the old
     * route nearest the head that survived (the head's own if it did), re-walk
     * the route around it and remap {@code s}. A head whose segment is gone
     * snaps onto the end of the anchor facing it — the train stands at the new
     * track end instead of freezing. If nothing survived, leave the spec as
     * is — {@code resolve} then returns null and the consist freezes.
     */
    private void reanchor(RailGraph graph, TrackPathSpec.Route route, RoutePath oldPath) {
        double headS = oldPath.loop() ? wrapIntoLoop(oldPath)
                : Math.clamp(s, 0.0, oldPath.length());
        int headLeg = oldPath.partIndexAt(headS);
        double legLen = oldPath.partLength(headLeg);
        double frac = legLen > 1.0e-9 ? (headS - oldPath.partStartS(headLeg)) / legLen : 0.0;

        List<RailGraph.RouteLeg> oldLegs = route.legs();
        // nearest surviving leg, searching outward from the head's leg
        int anchor = -1;
        for (int off = 0; off < oldLegs.size() && anchor < 0; off++) {
            for (int candidate : new int[] {headLeg - off, headLeg + off}) {
                if (candidate >= 0 && candidate < oldLegs.size()
                        && graph.segment(oldLegs.get(candidate).segmentId()) != null) {
                    anchor = candidate;
                    break;
                }
            }
        }
        if (anchor < 0) {
            return; // the whole route is gone — frozen
        }
        if (anchor != headLeg) {
            // head segment demolished: snap to the surviving leg's end facing it
            frac = anchor < headLeg ? 1.0 : 0.0;
        }
        RailGraph.RouteLeg anchorLeg = oldLegs.get(anchor);
        // walked around the anchor as the train travelled it: orientation kept
        RailGraph.Walk walk = graph.walkAround(List.of(anchorLeg));
        RailSegment segment = graph.segment(anchorLeg.segmentId());
        double segmentLength = new HermiteSegmentPath(graph.hermite(segment)).length();
        double along = anchorLeg.reversed() ? (1.0 - frac) * segmentLength : frac * segmentLength;
        double newS = graph.legS(walk.legs(), walk.keptStart(), along);

        pathSpec = TrackPathSpec.Route.of(walk.legs());
        keptLegs = null;
        // same head, new numbering: clients shift their buffered s instead of sliding
        shiftFrame(newS - s);
        s = newS;
    }

    /** Head {@code s} wrapped into the old loop's range (it grows freely on loops). */
    private double wrapIntoLoop(RoutePath oldPath) {
        double wrapped = s % oldPath.length();
        return wrapped < 0.0 ? wrapped + oldPath.length() : wrapped;
    }

    public double s() {
        return s;
    }

    public void setS(double s) {
        this.s = s;
    }

    public double speed() {
        return v;
    }

    /**
     * Debug speed override (e.g. {@code /rwat speed}). The physics keeps
     * integrating from here — without throttle the resistance bleeds it off.
     */
    public void setSpeed(double v) {
        this.v = v;
    }

    /**
     * Put the consist on a new route / composition / head (coupling —
     * SPEC §6.12). The path cache is dropped so the next
     * {@link #resolvePath} materializes the new route as is (no re-anchoring
     * from the old one). The caller records any frame shift.
     */
    void rebase(TrackPathSpec pathSpec, ConsistComposition composition, double s, double v) {
        this.pathSpec = pathSpec;
        this.composition = composition;
        this.s = s;
        this.v = v;
        this.cachedPath = null;
        this.cachedRevision = -1;
    }

    /**
     * A bump (SPEC §6.12): pushed {@code shift} along the path, leaving at
     * {@code newV}; an open route keeps the whole train on it.
     */
    void bump(double shift, double newV, TrackPath path) {
        s += shift;
        v = newV;
        if (path != null && !path.loop()) {
            s = Math.clamp(s, minHeadS(path.length()), path.length());
        }
    }

    /** New make-up on the same route and head (the front part of a split). */
    void setComposition(ConsistComposition composition) {
        this.composition = composition;
    }

    /**
     * A part split off another consist takes its handles along: reverser and
     * cab facing (so it keeps the same direction sense), the brake as set, and
     * the throttle only if {@code withThrottle} (the part the driver stays in).
     */
    void copyHandlesFrom(Consist other, boolean withThrottle) {
        reverser = other.reverser;
        cabFacing = other.cabFacing;
        brakeNotch = other.brakeNotch;
        indBrakeNotch = other.indBrakeNotch;
        throttleNotch = withThrottle ? other.throttleNotch : 0;
        activeCab = other.activeCab; // a cab not in this part simply shows nowhere
        // the brakes stay as applied; the engines of a part without the
        // driver wind down from where they were
        brakeEffort = other.brakeEffort;
        indBrakeEffort = other.indBrakeEffort;
        throttleEffort = other.throttleEffort;
        effortPull = other.effortPull;
    }

    /** Shut the throttle (the part of a split the driver isn't in). */
    void closeThrottle() {
        throttleNotch = 0;
    }

    /**
     * A driver controls the train from a cab facing {@code facing} (+1 =
     * towards +s). Same facing as the last active cab: nothing changes.
     * Otherwise, at a standstill with the throttle shut the handle is simply
     * read from the new cab (forward = where this driver looks — changing
     * ends); on the move or under power the reverser flips instead, so the
     * train keeps pulling the way it was going.
     */
    void takeControl(UUID cab, int facing) {
        activeCab = cab;
        if (facing == cabFacing || facing == 0) {
            return;
        }
        if (Math.abs(v) >= REVERSER_STOP_EPS || throttleNotch != 0) {
            reverser = -reverser;
        }
        cabFacing = facing;
        controlsChanged = true;
    }

    /** The driver's handles a cab lever can set (SPEC §9). */
    public enum Handle {
        REVERSER, THROTTLE, TRAIN_BRAKE, INDEPENDENT_BRAKE;

        private static final Handle[] VALUES = values();

        /** The handle with this ordinal, or null (an out-of-range network value). */
        public static Handle byOrdinal(int ordinal) {
            return ordinal >= 0 && ordinal < VALUES.length ? VALUES[ordinal] : null;
        }
    }

    /**
     * Put a handle to a position (SPEC §9: the driver drags its lever in the
     * cab): notches clamp to {@code 0..NOTCHES}, the reverser to −1..1 and it
     * moves only at a standstill with the throttle shut — a lever dragged on
     * the move just snaps back. Returns true if the handle moved.
     */
    public boolean setHandle(Handle handle, int value) {
        int before = handle(handle);
        switch (handle) {
            case REVERSER -> {
                if (Math.abs(v) < REVERSER_STOP_EPS && throttleNotch == 0) {
                    reverser = Math.clamp(value, -1, 1);
                }
            }
            case THROTTLE -> throttleNotch = Math.clamp(value, 0, NOTCHES);
            case TRAIN_BRAKE -> brakeNotch = Math.clamp(value, 0, NOTCHES);
            case INDEPENDENT_BRAKE -> indBrakeNotch = Math.clamp(value, 0, NOTCHES);
        }
        boolean moved = handle(handle) != before;
        controlsChanged |= moved;
        return moved;
    }

    /** A handle's position: notches 0..{@code NOTCHES}, the reverser −1..1. */
    public int handle(Handle handle) {
        return switch (handle) {
            case REVERSER -> reverser;
            case THROTTLE -> throttleNotch;
            case TRAIN_BRAKE -> brakeNotch;
            case INDEPENDENT_BRAKE -> indBrakeNotch;
        };
    }

    /** The wagon whose cab drives (or last drove), or null. */
    public UUID activeCab() {
        return activeCab;
    }

    // --- client frame (SPEC §6.12) ---

    /**
     * The meaning of {@code s} changed: an old head value {@code s_old} now
     * reads {@code s_old + shift}. Bumps the frame once per snapshot sent;
     * several changes before the next snapshot accumulate into one shift.
     */
    void shiftFrame(double shift) {
        if (shift == 0.0) {
            return;
        }
        // a part just split off (frame not sent yet) still seeds from its
        // parent: parent head + (inherited shift + this one) = our new head
        if (!frameUnsent) {
            frame++;
            frameShift = 0.0;
            frameUnsent = true;
        }
        frameShift += shift;
    }

    /**
     * This consist was just split off {@code parentId}: a client seeing it for
     * the first time seeds its interpolation buffer from the parent's, shifted
     * by {@code shift} (parent head value + shift = this consist's head value).
     */
    void inheritFrame(int parentId, double shift) {
        frameFrom = parentId;
        frameShift = shift;
        frameUnsent = true;
    }

    /** Frame counter carried by the snapshot. */
    public int frame() {
        return frame;
    }

    /** Shift from the previous frame (or from the parent's, see {@link #frameFrom}). */
    public double frameShift() {
        return frameShift;
    }

    /** This consist's own id, or the parent's until the first snapshot after a split. */
    public int frameFrom() {
        return frameFrom;
    }

    /** A snapshot carried the current frame to the clients. */
    void frameSent() {
        frameUnsent = false;
        frameFrom = id;
    }

    /** The reverser handle as the active cab's driver sees it: +1 forward, 0 neutral, −1 reverse. */
    public int reverser() {
        return reverser;
    }

    /** Which way along the path the active cab faces (+1 = +s). */
    public int cabFacing() {
        return cabFacing;
    }

    public int throttleNotch() {
        return throttleNotch;
    }

    public int brakeNotch() {
        return brakeNotch;
    }

    /**
     * Driver input for the next tick (SPEC §5.3): held key directions for the
     * throttle and train-brake handles (+1 up / −1 down / 0 idle), a
     * reverser-toggle edge and the held signals (SPEC §10). No driver → call
     * with all zeros so stale held keys don't keep notching (or sounding).
     */
    public void setDriveInput(int throttleDir, int brakeDir, boolean reverserToggle, int signals) {
        this.throttleDir = Integer.signum(throttleDir);
        this.brakeDir = Integer.signum(brakeDir);
        this.reverserToggle |= reverserToggle;
        this.signals = signals & (HORN | BELL);
    }

    /** The signals the driver holds now ({@link #HORN}, {@link #BELL}); transient, rides the snapshot. */
    public int signals() {
        return signals;
    }

    public List<UUID> wagonIds() {
        return wagonIds;
    }

    /**
     * Lowest head {@code s} that still keeps the whole rigid train on the path
     * (the rearmost bogie stays at {@code s ≥ 0}). Above this the head can run
     * up to {@code length}; below it the trailing wagons would clamp onto the
     * start point and overlap.
     */
    private double minHeadS(double pathLength) {
        return Math.min(composition.totalLength(), pathLength);
    }

    /**
     * Per-tick drive (SPEC §2.1, §5.4): apply the driver's handle input
     * (notched, with key repeat), let the auto handbrakes follow the throttle
     * if the profile has them, let the efforts follow the handles with the
     * train's timing (SPEC §5.3), run one step of longitudinal physics
     * (traction / brakes / Davis resistance / per-wagon grade), then
     * {@code s += v} while keeping the whole rigid train on the path — the
     * head is held in {@code [minHeadS, length]} so neither end runs off and
     * piles the wagons against a clamped path end. Hitting an end zeroes the
     * speed (the handles stay where the driver left them;
     * {@link #endImpactKmh} tells how hard). On a closed loop there are no
     * ends: {@code s} grows (or shrinks) freely and the path wraps it during
     * sampling, so the consist circulates.
     *
     * @return true if state changed (needs saving)
     */
    public boolean advance(TrackPath path, PhysicsTuning tuning) {
        double prevV = v;
        applyDriveInput();
        boolean handbrakesMoved = tuning.autoHandbrake() && autoHandbrakes();

        // the handle is cab-relative: a cab facing −s drives the train backwards
        int pull = reverser * cabFacing;
        if (pull != effortPull) {
            throttleEffort = 0.0; // a thrown reverser starts the engines from idle
            effortPull = pull;
        }
        ControlResponse response = ControlResponse.of(composition, tuning.responseScale());
        throttleEffort = ControlResponse.approach(throttleEffort,
                pull != 0 ? throttleNotch / (double) NOTCHES : 0.0,
                response.tractionUpS(), response.tractionDownS());
        brakeEffort = ControlResponse.approach(brakeEffort, brakeNotch / (double) NOTCHES,
                response.brakeApplyS(), response.brakeReleaseS());
        indBrakeEffort = ControlResponse.approach(indBrakeEffort, indBrakeNotch / (double) NOTCHES,
                response.independentApplyS(), response.independentReleaseS());

        v = TrainPhysics.step(path, s, v, composition,
                new TrainPhysics.Controls(pull, throttleEffort, brakeEffort, indBrakeEffort),
                handbrakeMask(), tuning);

        endImpactKmh = 0.0;
        if (v != 0.0) {
            s += v;
            if (!path.loop()) {
                double min = minHeadS(path.length());
                if (s <= min || s >= path.length()) {
                    endImpactKmh = Math.abs(TrainPhysics.kmh(v));
                    s = s <= min ? min : path.length();
                    v = 0.0;
                }
            }
        }
        boolean handlesMoved = controlsChanged;
        controlsChanged = false;
        return v != prevV || v != 0.0 || handlesMoved || handbrakesMoved;
    }

    /**
     * The train brake in effect, 0..1 — the cylinders' pressure as a fraction
     * of full (SPEC §5.3): it follows the handle with the brake's timing. The
     * handle itself before the first tick.
     */
    public double trainBrakeEffort() {
        return Double.isNaN(brakeEffort) ? brakeNotch / (double) NOTCHES : brakeEffort;
    }

    /** The independent (loco) brake in effect, 0..1 — see {@link #trainBrakeEffort}. */
    public double independentBrakeEffort() {
        return Double.isNaN(indBrakeEffort) ? indBrakeNotch / (double) NOTCHES : indBrakeEffort;
    }

    /** Speed the consist ran into a track end with on its last advance, km/h; 0 = didn't. */
    public double endImpactKmh() {
        return endImpactKmh;
    }

    /**
     * Auto handbrakes (SPEC §5.3, profiles with {@code autoHandbrake}): off
     * once the throttle opens, on when standing with it shut ({@link AutoHandbrake}).
     *
     * @return true if any handbrake moved
     */
    private boolean autoHandbrakes() {
        Boolean set = AutoHandbrake.target(throttleNotch, reverser, v);
        return set != null && setAllHandbrakes(set);
    }

    // --- handbrakes (SPEC §5.3) ---

    /** True if {@code wagon}'s handbrake is set. */
    public boolean handbrake(UUID wagon) {
        return handbrakes.contains(wagon);
    }

    /**
     * Set or release one wagon's handbrake.
     *
     * @return true if it moved (false: already so, or not a wagon of this consist)
     */
    public boolean setHandbrake(UUID wagon, boolean set) {
        if (!wagonIds.contains(wagon)) {
            return false;
        }
        return set ? handbrakes.add(wagon) : handbrakes.remove(wagon);
    }

    /**
     * Set or release every wagon's handbrake.
     *
     * @return true if any moved
     */
    public boolean setAllHandbrakes(boolean set) {
        boolean moved = false;
        for (UUID wagon : wagonIds) {
            moved |= set ? handbrakes.add(wagon) : handbrakes.remove(wagon);
        }
        return moved;
    }

    /** How many of this consist's wagons have their handbrake set. */
    public int handbrakesSet() {
        int count = 0;
        for (UUID wagon : wagonIds) {
            if (handbrakes.contains(wagon)) {
                count++;
            }
        }
        return count;
    }

    /** Per wagon index, true = its handbrake is set (the physics' and the snapshot's view). */
    public boolean[] handbrakeMask() {
        boolean[] mask = new boolean[wagonIds.size()];
        for (int i = 0; i < mask.length; i++) {
            mask[i] = handbrakes.contains(wagonIds.get(i));
        }
        return mask;
    }

    /**
     * Wagons that moved here from {@code other} (a coupling, a cut) bring
     * their handbrake state along.
     */
    void takeHandbrakes(Consist other) {
        for (UUID wagon : wagonIds) {
            if (other.handbrakes.remove(wagon)) {
                handbrakes.add(wagon);
            }
        }
    }

    /** Turn held key directions into notch movements: instant on press, then key repeat. */
    private void applyDriveInput() {
        throttleHeldTicks = throttleDir != 0 ? throttleHeldTicks + 1 : 0;
        brakeHeldTicks = brakeDir != 0 ? brakeHeldTicks + 1 : 0;

        if (throttleDir != 0 && (throttleHeldTicks - 1) % NOTCH_REPEAT_TICKS == 0) {
            int next = Math.clamp(throttleNotch + throttleDir, 0, NOTCHES);
            controlsChanged |= next != throttleNotch;
            throttleNotch = next;
        }
        if (brakeDir != 0 && (brakeHeldTicks - 1) % NOTCH_REPEAT_TICKS == 0) {
            int next = Math.clamp(brakeNotch + brakeDir, 0, NOTCHES);
            controlsChanged |= next != brakeNotch;
            brakeNotch = next;
        }
        // the reverser only throws at a standstill with the throttle shut;
        // the key flips forward/reverse (neutral, set by the cab lever, → forward)
        if (reverserToggle) {
            reverserToggle = false;
            if (Math.abs(v) < REVERSER_STOP_EPS && throttleNotch == 0) {
                reverser = reverser > 0 ? -1 : 1;
                controlsChanged = true;
            }
        }
    }

    // --- NBT ---

    public CompoundTag save(CompoundTag tag) {
        tag.putInt("Id", id);
        tag.putDouble("S", s);
        tag.putDouble("V", v);
        tag.putInt("Reverser", reverser);
        tag.putInt("CabFacing", cabFacing);
        tag.putInt("Throttle", throttleNotch);
        tag.putInt("Brake", brakeNotch);
        tag.putInt("IndBrake", indBrakeNotch);
        pathSpec.save(tag);
        ListTag wagons = new ListTag();
        for (UUID uuid : wagonIds) {
            wagons.add(NbtUtils.createUUID(uuid));
        }
        tag.put("Wagons", wagons);
        ListTag handbrakeList = new ListTag();
        for (UUID uuid : wagonIds) {
            if (handbrakes.contains(uuid)) {
                handbrakeList.add(NbtUtils.createUUID(uuid));
            }
        }
        tag.put("Handbrakes", handbrakeList);
        ListTag slots = new ListTag();
        for (ConsistComposition.Slot slot : composition.slots()) {
            CompoundTag slotTag = new CompoundTag();
            slotTag.putString("Type", slot.type().id());
            slotTag.putBoolean("Flipped", slot.flipped());
            if (!slot.livery().isEmpty()) {
                slotTag.putString("Livery", slot.livery());
            }
            slots.add(slotTag);
        }
        tag.put("Composition", slots);
        return tag;
    }

    public static Consist load(CompoundTag tag) {
        Consist consist = new Consist(tag.getInt("Id"), TrackPathSpec.load(tag),
                loadComposition(tag), tag.getDouble("S"), tag.getDouble("V"));
        consist.reverser = tag.contains("Reverser") ? Math.clamp(tag.getInt("Reverser"), -1, 1) : 1;
        consist.indBrakeNotch = Math.clamp(tag.getInt("IndBrake"), 0, NOTCHES);
        consist.cabFacing = tag.getInt("CabFacing") < 0 ? -1 : 1;
        consist.throttleNotch = Math.clamp(tag.getInt("Throttle"), 0, NOTCHES);
        consist.brakeNotch = Math.clamp(tag.getInt("Brake"), 0, NOTCHES);
        for (Tag entry : tag.getList("Wagons", Tag.TAG_INT_ARRAY)) {
            consist.wagonIds.add(NbtUtils.loadUUID(entry));
        }
        for (Tag entry : tag.getList("Handbrakes", Tag.TAG_INT_ARRAY)) {
            consist.handbrakes.add(NbtUtils.loadUUID(entry));
        }
        return consist;
    }

    /**
     * Composition from NBT. An id no pack declares (a removed pack) becomes the
     * placeholder carrying that same id (SPEC §6.5), so the next save writes it
     * back unchanged and the consist recovers when the pack returns. A save
     * from before compositions gets one placeholder per saved wagon — the
     * wagon count must keep matching the saved wagon entities.
     */
    private static ConsistComposition loadComposition(CompoundTag tag) {
        ListTag slots = tag.getList("Composition", Tag.TAG_COMPOUND);
        if (slots.isEmpty()) {
            int wagons = Math.max(1, tag.getList("Wagons", Tag.TAG_INT_ARRAY).size());
            List<ConsistComposition.Slot> legacy = new ArrayList<>(wagons);
            for (int i = 0; i < wagons; i++) {
                legacy.add(new ConsistComposition.Slot(WagonTypes.missing(LEGACY_TYPE_ID), false));
            }
            return new ConsistComposition(legacy);
        }
        List<ConsistComposition.Slot> loaded = new ArrayList<>(slots.size());
        for (int i = 0; i < slots.size(); i++) {
            CompoundTag slotTag = slots.getCompound(i);
            WagonType type = WagonTypes.resolve(slotTag.getString("Type"));
            loaded.add(new ConsistComposition.Slot(type, slotTag.getBoolean("Flipped"),
                    slotTag.getString("Livery")));
        }
        return new ConsistComposition(loaded);
    }
}
