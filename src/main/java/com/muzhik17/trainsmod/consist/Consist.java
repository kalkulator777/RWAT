package com.muzhik17.trainsmod.consist;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.muzhik17.trainsmod.network.TrackPathSpec;
import com.muzhik17.trainsmod.path.HermiteSegmentPath;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RoutePath;
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
    /** Held notch keys repeat at this period, ticks (first press applies instantly). */
    private static final int NOTCH_REPEAT_TICKS = 5;
    /**
     * The reverser can only be thrown at a standstill (|v| below this,
     * blocks/tick) — the driver's panel shows the train standing by the same rule.
     */
    public static final double REVERSER_STOP_EPS = 1.0e-3;
    /** Type id given to wagons of a save from before compositions were stored. */
    private static final String LEGACY_TYPE_ID = "rwat:legacy";

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
    private transient int throttleHeldTicks;
    private transient int brakeHeldTicks;
    private transient boolean controlsChanged;

    private TrackPath cachedPath;
    private int cachedRevision = -1;

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
     * Materialize the path against the graph at {@code revision}; cached
     * until the graph changes. A route is not a frozen leg list: on every
     * graph change (new rails, demolition, a thrown switch) the consist
     * re-anchors to the segment under its head and the route is re-walked
     * from there through the current network (SPEC §2.2 v1) — so newly built
     * track joins the route and demolishing track merely shortens it. Null
     * only if nothing of the old route survived (the consist stays frozen
     * until it is removed).
     */
    public TrackPath resolvePath(RailGraph graph, int revision) {
        if (cachedRevision != revision) {
            if (pathSpec instanceof TrackPathSpec.Route route
                    && cachedPath instanceof RoutePath oldPath) {
                reanchor(graph, route, oldPath);
            }
            cachedPath = pathSpec.resolve(graph);
            cachedRevision = revision;
            // path may have changed shape/length under the consist: stay in range
            // (a loop has no ends — sampling wraps, nothing to clamp to)
            if (cachedPath != null && !cachedPath.loop()) {
                s = Math.clamp(s, minHeadS(cachedPath.length()), cachedPath.length());
            }
        }
        return cachedPath;
    }

    /**
     * Re-derive the route from the current head position against the changed
     * graph: find the leg under the head (on the path materialized from the
     * previous graph state), re-walk the route from that segment and remap
     * {@code s} so the head stays at the same world position. If the head's
     * segment was demolished, anchor to the nearest surviving leg of the old
     * route (the head snaps onto its end — the train stands at the new track
     * end instead of freezing). If nothing survived, leave the spec as is —
     * {@code resolve} then returns null and the consist freezes.
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

        List<RailGraph.RouteLeg> newLegs = graph.walkRoute(anchorLeg.segmentId());
        int at = -1;
        for (int i = 0; i < newLegs.size(); i++) {
            if (newLegs.get(i).segmentId() == anchorLeg.segmentId()) {
                at = i;
                break;
            }
        }
        if (at < 0) {
            return; // cannot happen (walkRoute always contains its start), stay safe
        }
        // keep the train's travel orientation: if the new walk traverses the
        // anchor segment the other way round, flip the whole route
        if (newLegs.get(at).reversed() != anchorLeg.reversed()) {
            List<RailGraph.RouteLeg> flipped = new ArrayList<>(newLegs.size());
            for (int i = newLegs.size() - 1; i >= 0; i--) {
                RailGraph.RouteLeg leg = newLegs.get(i);
                flipped.add(new RailGraph.RouteLeg(leg.segmentId(), !leg.reversed()));
            }
            newLegs = flipped;
            at = newLegs.size() - 1 - at;
        }

        double newS = 0.0;
        for (int i = 0; i < at; i++) {
            newS += segmentLength(graph, newLegs.get(i).segmentId());
        }
        newS += frac * segmentLength(graph, newLegs.get(at).segmentId());

        pathSpec = TrackPathSpec.Route.of(newLegs);
        // same head, new numbering: clients shift their buffered s instead of sliding
        shiftFrame(newS - s);
        s = newS;
    }

    /** Head {@code s} wrapped into the old loop's range (it grows freely on loops). */
    private double wrapIntoLoop(RoutePath oldPath) {
        double wrapped = s % oldPath.length();
        return wrapped < 0.0 ? wrapped + oldPath.length() : wrapped;
    }

    private static double segmentLength(RailGraph graph, int segmentId) {
        return new HermiteSegmentPath(graph.hermite(graph.segment(segmentId))).length();
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
        if (!frameUnsent || frameFrom != id) {
            frame++;
            frameShift = 0.0;
            frameUnsent = true;
            frameFrom = id;
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
     * throttle and train-brake handles (+1 up / −1 down / 0 idle) and a
     * reverser-toggle edge. No driver → call with all zeros so stale held keys
     * don't keep notching.
     */
    public void setDriveInput(int throttleDir, int brakeDir, boolean reverserToggle) {
        this.throttleDir = Integer.signum(throttleDir);
        this.brakeDir = Integer.signum(brakeDir);
        this.reverserToggle |= reverserToggle;
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
     * (notched, with key repeat), run one step of longitudinal physics
     * (traction / brakes / Davis resistance / per-wagon grade), then
     * {@code s += v} while keeping the whole rigid train on the path — the
     * head is held in {@code [minHeadS, length]} so neither end runs off and
     * piles the wagons against a clamped path end. Hitting an end zeroes the
     * speed (the handles stay where the driver left them). On a closed loop
     * there are no ends: {@code s} grows (or shrinks) freely and the path
     * wraps it during sampling, so the consist circulates.
     *
     * @return true if state changed (needs saving)
     */
    public boolean advance(TrackPath path) {
        double prevV = v;
        applyDriveInput();

        // the handle is cab-relative: a cab facing −s drives the train backwards
        v = TrainPhysics.step(path, s, v, composition, new TrainPhysics.Controls(
                reverser * cabFacing,
                throttleNotch / (double) NOTCHES,
                brakeNotch / (double) NOTCHES,
                indBrakeNotch / (double) NOTCHES));

        if (v != 0.0) {
            s += v;
            if (!path.loop()) {
                double min = minHeadS(path.length());
                if (s <= min) {
                    s = min;
                    v = 0.0;
                } else if (s >= path.length()) {
                    s = path.length();
                    v = 0.0;
                }
            }
        }
        boolean handlesMoved = controlsChanged;
        controlsChanged = false;
        return v != prevV || v != 0.0 || handlesMoved;
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
