package com.muzhik17.trainsmod.client;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.muzhik17.trainsmod.consist.Handles;
import com.muzhik17.trainsmod.kinematics.ConsistKinematics;
import com.muzhik17.trainsmod.kinematics.WagonPose;
import com.muzhik17.trainsmod.network.ConsistSnapshotPayload;
import com.muzhik17.trainsmod.network.TrackPathSpec;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.stock.ConsistComposition;

/**
 * Client-side consist state: snapshot interpolation over {@code s} (SPEC
 * §2.1). Renders ~{@link #INTERP_DELAY_TICKS} ticks in the past, interpolating
 * {@code s} between received snapshots — never 3D position (position
 * interpolation cuts corners on curves; the RTM jitter source). Past the
 * newest snapshot the client extrapolates {@code s += v} (packet loss rule,
 * 0.2).
 *
 * <p><b>Clock:</b> playback runs on a per-consist clock advanced once per
 * client tick ({@link #tickAll}) and gently nudged toward (newest snapshot −
 * delay). The client's {@code getGameTime()} is deliberately <i>not</i> used:
 * the server hard-corrects it every 20 ticks, and each correction would jump
 * {@code s} — the periodic back-and-forth jerk seen in play-tests.
 *
 * <p><b>Phase:</b> {@link #tickPose} (the entity tick / rider seat) samples at
 * the clock; {@link #renderPose} interpolates between the previous and current
 * tick's clock by partialTick — the same one-tick-behind window vanilla uses
 * to lerp entities. Sampling render time "ahead" of the seat is what made the
 * driver slide backwards proportionally to speed.
 *
 * <p><b>Frames (SPEC §6.12):</b> buffered snapshots are only comparable
 * while {@code s} means the same thing. When the server renumbers it —
 * a coupling re-heads the consist, a re-anchor re-walks its route — the
 * snapshot's frame counter moves on and carries the shift; the buffer is
 * shifted along instead of interpolating across the jump (which slid the train
 * for the length of the delay). A consist split off another seeds its buffer
 * and clock from the parent's, so the uncoupled half keeps moving smoothly.
 *
 * <p><b>Membership:</b> each snapshot lists its wagons' entity ids in index
 * order; a wagon reads its consist and index from the newest listing
 * ({@link #memberConsist}/{@link #memberIndex}), which flips in the very packet
 * that brings the new composition — synced entity data lags a tick behind.
 *
 * <p>Deliberately free of client-only MC classes so referencing it from common
 * entity code is safe on a dedicated server.
 */
public final class ClientConsists {

    /** Snapshot interpolation delay buffer (SPEC §2.1: render ~2 ticks in the past). */
    public static final double INTERP_DELAY_TICKS = 2.0;
    private static final long BUFFER_KEEP_TICKS = 40;
    private static final double MAX_EXTRAPOLATION_TICKS = 20.0;
    /**
     * Snapshot silence after which a consist's state is dropped wholesale.
     * Snapshots stop when this client no longer tracks any of the consist's
     * wagons; the state must not outlive that, or a later re-tracked wagon's
     * first tick samples the stale buffer and teleports the entity to where
     * the train was minutes ago — usually a client-unloaded chunk, where it
     * stops ticking and goes permanently invisible (the "/tp to the parked
     * train: no locomotive" play-test bug, 2026-06-12). Generous vs the
     * 20-tick extrapolation cap: a live-but-lagging stream keeps its buffer.
     */
    private static final double STALE_DROP_TICKS = 60.0;
    /** Clock drift beyond this snaps instead of slewing (teleport / lag spike). */
    private static final double CLOCK_SNAP_TICKS = 20.0;
    /** Max clock slew per tick (5% time dilation — imperceptible). */
    private static final double CLOCK_SLEW_PER_TICK = 0.05;

    private record Snapshot(long gameTime, double s, double v) {
    }

    /** A wagon's place as the newest snapshot listing it says. */
    private record Member(int consistId, int index) {
    }

    private static final class State {
        TrackPathSpec spec;
        TrackPath path;
        ConsistComposition composition;
        int graphGenerationUsed = -1;
        final ArrayDeque<Snapshot> buffer = new ArrayDeque<>();
        /** Playback clock in server-snapshot time; NaN until the first snapshot. */
        double clock = Double.NaN;
        /** The clock one client tick ago — the lerp window vanilla shows riders in. */
        double prevClock = Double.NaN;
        /** The server frame the buffered {@code s} values are in. */
        int frame;
        /** The driver's handles per the newest snapshot (SPEC §9: cab levers). */
        Handles handles = Handles.REST;
        /** Which wagons have their handbrake set, by index, per the newest snapshot (SPEC §5.3). */
        BitSet handbrakes = new BitSet();
        /** The train / loco brake in effect, 0..1 (the cab's pressure gauges). */
        float trainBrakePressure;
        float indBrakePressure;
        /** The driver's held signals per the newest snapshot (SPEC §10). */
        int signals;
        /** The wagons' entity ids by index per the newest snapshot (−1: not tracked here). */
        int[] wagonIds = new int[0];

        /** (Re)materialize the path when the spec or the client graph changed. */
        TrackPath path() {
            if (spec == null) {
                return null;
            }
            if (path == null || graphGenerationUsed != ClientRailGraph.generation()) {
                path = spec.resolve(ClientRailGraph.graph());
                graphGenerationUsed = ClientRailGraph.generation();
            }
            return path;
        }
    }

    private static final Map<Integer, State> STATES = new HashMap<>();
    /** Wagon entity id → its consist and index, per the newest snapshot listing it. */
    private static final Map<Integer, Member> MEMBERS = new HashMap<>();

    private ClientConsists() {
    }

    /** Called on the client main thread from the payload handler. */
    public static void handleSnapshot(ConsistSnapshotPayload payload) {
        State state = STATES.get(payload.consistId());
        if (state == null) {
            state = new State();
            state.frame = payload.frame();
            if (payload.frameFrom() != payload.consistId()) {
                adoptParent(state, STATES.get(payload.frameFrom()), payload.frameShift(),
                        payload.gameTime());
            }
            STATES.put(payload.consistId(), state);
        } else {
            Snapshot newest = state.buffer.peekLast();
            if (newest != null && payload.gameTime() <= newest.gameTime) {
                return; // out of order / duplicate (one copy per tracked wagon)
            }
            if (payload.frame() != state.frame) {
                reframe(state, payload);
            }
        }
        if (!payload.pathSpec().equals(state.spec)) {
            state.spec = payload.pathSpec();
            state.path = null; // re-resolve lazily
        }
        state.composition = payload.composition();
        state.handles = payload.handles();
        state.handbrakes = payload.handbrakes();
        state.trainBrakePressure = payload.trainBrakePressure();
        state.indBrakePressure = payload.indBrakePressure();
        state.signals = payload.signals();
        int[] wagonIds = payload.wagonEntityIds();
        state.wagonIds = wagonIds;
        for (int i = 0; i < wagonIds.length; i++) {
            if (wagonIds[i] >= 0) {
                MEMBERS.put(wagonIds[i], new Member(payload.consistId(), i));
            }
        }
        state.buffer.addLast(new Snapshot(payload.gameTime(), payload.s(), payload.v()));
        long cutoff = payload.gameTime() - BUFFER_KEEP_TICKS;
        while (!state.buffer.isEmpty() && state.buffer.peekFirst().gameTime < cutoff) {
            state.buffer.pollFirst();
        }
    }

    /**
     * The server renumbered {@code s} (SPEC §6.12: a coupling, a
     * re-anchor). The next frame comes with the shift from the one we hold:
     * carry the buffered snapshots over, so the train doesn't slide across the
     * jump while the buffer drains. Missed a frame (the shift is relative to
     * one we never saw): drop the buffer — a short hold, never a slide.
     */
    private static void reframe(State state, ConsistSnapshotPayload payload) {
        if (payload.frame() == state.frame + 1 && payload.frameFrom() == payload.consistId()) {
            List<Snapshot> shifted = new ArrayList<>(state.buffer.size());
            for (Snapshot snapshot : state.buffer) {
                shifted.add(new Snapshot(snapshot.gameTime, snapshot.s + payload.frameShift(),
                        snapshot.v));
            }
            state.buffer.clear();
            state.buffer.addAll(shifted);
        } else {
            state.buffer.clear();
        }
        state.frame = payload.frame();
    }

    /**
     * A consist just split off {@code parent} (SPEC §6.12): start from the
     * parent's buffer (shifted onto this consist's head) and clock, so the
     * uncoupled half plays on in step instead of freezing for the delay.
     */
    private static void adoptParent(State state, State parent, double shift, long gameTime) {
        if (parent == null) {
            return;
        }
        for (Snapshot snapshot : parent.buffer) {
            if (snapshot.gameTime < gameTime) {
                state.buffer.addLast(new Snapshot(snapshot.gameTime, snapshot.s + shift, snapshot.v));
            }
        }
        state.clock = parent.clock;
        state.prevClock = parent.prevClock;
    }

    /**
     * The consist a wagon entity belongs to per the newest snapshot listing it,
     * else {@code fallback} (its synced entity data).
     */
    public static int memberConsist(int entityId, int fallback) {
        Member member = MEMBERS.get(entityId);
        return member != null ? member.consistId : fallback;
    }

    /** The entity id of wagon {@code index} of a consist per the newest snapshot, −1 if unknown. */
    public static int entityIdAt(int consistId, int index) {
        State state = STATES.get(consistId);
        return state == null || index < 0 || index >= state.wagonIds.length ? -1 : state.wagonIds[index];
    }

    /** The wagon's index in that consist — see {@link #memberConsist}. */
    public static int memberIndex(int entityId, int fallback) {
        Member member = MEMBERS.get(entityId);
        return member != null ? member.index : fallback;
    }

    /**
     * Advance every consist's playback clock by one client tick, slewing it
     * toward (newest snapshot − delay). Called once per client tick (Pre).
     * Also drops states whose snapshot stream has gone silent (untracked
     * consist) — see {@link #STALE_DROP_TICKS}.
     */
    public static void tickAll() {
        var iterator = STATES.entrySet().iterator();
        while (iterator.hasNext()) {
            var entry = iterator.next();
            State state = entry.getValue();
            Snapshot newest = state.buffer.peekLast();
            if (newest == null) {
                continue;
            }
            if (!Double.isNaN(state.clock)
                    && state.clock - newest.gameTime > STALE_DROP_TICKS) {
                iterator.remove();
                int consistId = entry.getKey();
                MEMBERS.values().removeIf(member -> member.consistId == consistId);
                continue;
            }
            double target = newest.gameTime - INTERP_DELAY_TICKS;
            if (Double.isNaN(state.clock) || Math.abs(target - state.clock) > CLOCK_SNAP_TICKS) {
                state.prevClock = target - 1.0;
                state.clock = target;
                continue;
            }
            state.prevClock = state.clock;
            state.clock += 1.0;
            double err = target - state.clock;
            state.clock += Math.max(-CLOCK_SLEW_PER_TICK, Math.min(CLOCK_SLEW_PER_TICK, err));
        }
    }

    /**
     * Pose at the current clock tick — what the wagon entity (and through it,
     * the rider's seat) is set to each client tick. Null if nothing is known
     * about this consist yet, or its path is unresolved.
     */
    public static WagonPose tickPose(int consistId, int wagonIndex) {
        return poseAt(consistId, wagonIndex, state -> state.clock);
    }

    /**
     * Pose for rendering at {@code partialTick}: interpolates the clock window
     * [prevClock, clock] — the same one-tick-behind window vanilla entity lerp
     * shows, so the model never leads or trails its riders.
     */
    public static WagonPose renderPose(int consistId, int wagonIndex, float partialTick) {
        return poseAt(consistId, wagonIndex,
                state -> state.prevClock + (state.clock - state.prevClock) * partialTick);
    }

    private interface TimeOf {
        double at(State state);
    }

    private static WagonPose poseAt(int consistId, int wagonIndex, TimeOf timeOf) {
        State state = STATES.get(consistId);
        if (state == null || state.buffer.isEmpty() || state.composition == null
                || Double.isNaN(state.clock)
                || wagonIndex >= state.composition.wagonCount()) {
            return null;
        }
        TrackPath path = state.path();
        if (path == null) {
            return null;
        }
        double s = sampleS(state, timeOf.at(state));
        return ConsistKinematics.wagonPose(path, s, wagonIndex, state.composition);
    }

    /** The synced composition slot of one wagon (type + flipped), or null if unknown. */
    public static ConsistComposition.Slot slot(int consistId, int wagonIndex) {
        State state = STATES.get(consistId);
        if (state == null || state.composition == null
                || wagonIndex >= state.composition.wagonCount()) {
            return null;
        }
        return state.composition.slot(wagonIndex);
    }

    /** The synced composition of a consist, or null if unknown. */
    public static ConsistComposition composition(int consistId) {
        State state = STATES.get(consistId);
        return state == null ? null : state.composition;
    }

    /** How many of a consist's wagons have their handbrake set (SPEC §5.3); 0 if unknown. */
    public static int handbrakesSet(int consistId) {
        State state = STATES.get(consistId);
        return state == null ? 0 : state.handbrakes.cardinality();
    }

    /** True if wagon {@code index} of a consist has its handbrake set (SPEC §5.3). */
    public static boolean handbrake(int consistId, int index) {
        State state = STATES.get(consistId);
        return state != null && index >= 0 && state.handbrakes.get(index);
    }

    /** The train brake in effect, 0..1 — what the cab's brake gauges read (SPEC §5.3). */
    public static float trainBrakePressure(int consistId) {
        State state = STATES.get(consistId);
        return state == null ? 0.0F : state.trainBrakePressure;
    }

    /** The loco (independent) brake in effect, 0..1. */
    public static float indBrakePressure(int consistId) {
        State state = STATES.get(consistId);
        return state == null ? 0.0F : state.indBrakePressure;
    }

    /** The signals the consist's driver holds (SPEC §10: {@code Consist.HORN}/{@code BELL}), 0 if unknown. */
    public static int signals(int consistId) {
        State state = STATES.get(consistId);
        return state == null ? 0 : state.signals;
    }

    /** The driver's handles of a consist (SPEC §9), or {@link Handles#REST} if unknown. */
    public static Handles handles(int consistId) {
        State state = STATES.get(consistId);
        return state == null ? Handles.REST : state.handles;
    }

    /** The consist's speed per the newest snapshot, blocks/tick (signed), or 0. */
    public static double speed(int consistId) {
        State state = STATES.get(consistId);
        Snapshot newest = state == null ? null : state.buffer.peekLast();
        return newest == null ? 0.0 : newest.v;
    }

    /**
     * The consist's speed at the playback clock — in step with
     * {@link #tickPose} rather than with the newest snapshot, so a lurch
     * shows when the train is seen to stop — blocks/tick (signed), or 0.
     */
    public static double tickSpeed(int consistId) {
        State state = STATES.get(consistId);
        if (state == null || state.buffer.isEmpty() || Double.isNaN(state.clock)) {
            return 0.0;
        }
        Snapshot previous = null;
        for (Snapshot snapshot : state.buffer) {
            if (snapshot.gameTime >= state.clock) {
                if (previous == null) {
                    return snapshot.v;
                }
                double f = (state.clock - previous.gameTime) / (snapshot.gameTime - previous.gameTime);
                return previous.v + (snapshot.v - previous.v) * f;
            }
            previous = snapshot;
        }
        return state.buffer.peekLast().v;
    }

    /** The consist's materialized path (for debug rendering), or null. */
    public static TrackPath trackPath(int consistId) {
        State state = STATES.get(consistId);
        return state == null ? null : state.path();
    }

    /** Interpolate s between bracketing snapshots; extrapolate past the newest. */
    private static double sampleS(State state, double time) {
        Snapshot previous = null;
        for (Snapshot snapshot : state.buffer) {
            if (snapshot.gameTime >= time) {
                if (previous == null) {
                    return snapshot.s;
                }
                double f = (time - previous.gameTime) / (snapshot.gameTime - previous.gameTime);
                return previous.s + (snapshot.s - previous.s) * f;
            }
            previous = snapshot;
        }
        Snapshot newest = state.buffer.peekLast();
        double dt = Math.min(time - newest.gameTime, MAX_EXTRAPOLATION_TICKS);
        return newest.s + newest.v * dt;
    }

    /** Drop everything (e.g. on logout / level change). */
    public static void clearAll() {
        STATES.clear();
        MEMBERS.clear();
    }
}
