package com.muzhik17.trainsmod.consist;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.stock.ConsistComposition;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerChunkCache;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.TicketType;
import net.minecraft.world.level.ChunkPos;

/**
 * Chunk loading for consists (SPEC §2.1, decision 2026-10-12): the adapter
 * between the pure {@link ChunkLease} / {@link ChunkCover} and the server's
 * chunk tickets. A consist holding its lease keeps the chunks under its
 * whole length and the way ahead entity-ticking with tickets of its own
 * type ({@link #TICKET}, keyed by the consist id), so every wagon entity of
 * it is loaded, moves with it and meets what stands ahead. A consist that
 * holds nothing runs only while the world ticks under some part of it, and
 * otherwise stands frozen where it is — it still exists, and it still
 * couples: contact is decided on the track, not in loaded chunks.
 *
 * <p>Tickets are not saved: after a restart a consist earns its lease again
 * from its own state (one on the move holds at once). They are a lease on
 * the server's side too: a ticket not renewed within {@link #LEASE_TICKS}
 * lapses by itself, so a consist that vanished — coupled into another,
 * removed by whatever path — can't keep the world loaded. The cover is
 * re-walked only once the consist has moved a {@link ChunkCover#STEP} or
 * its speed changed the way ahead as much, and renewed every
 * {@link #RENEW_TICKS}; in between a held consist costs a few comparisons.
 */
final class ConsistChunks {

    /** A ticket lapses this long after it was last renewed, ticks. */
    private static final int LEASE_TICKS = 100;
    /** Held tickets are renewed this often, ticks. */
    private static final int RENEW_TICKS = 20;
    /** Region ticket distance 2 = level 31: the chunk itself entity-ticking (as {@code /forceload} holds it). */
    private static final int TICKET_DISTANCE = 2;

    /** The ticket a consist holds its chunks with, keyed by the consist id. */
    static final TicketType<Integer> TICKET =
            TicketType.create(RailsWheelsAndTrains.MODID + ":consist", Integer::compare, LEASE_TICKS);

    /** One consist's lease, its tickets and the chunks under it. */
    private static final class Entry {
        final ChunkLease lease = new ChunkLease();
        /** The chunks right under the consist, for the pose they were walked at. */
        long[] under;
        TrackPath underPath;
        ConsistComposition underComposition;
        double underS = Double.NaN;
        /** The chunks holding a ticket of this consist, and the pose and reach they were walked for. */
        Set<Long> held = Set.of();
        TrackPath heldPath;
        ConsistComposition heldComposition;
        double heldS = Double.NaN;
        double heldReach;
        long renewedAt;
        /** The last tick the consist was seen; a consist gone since is swept. */
        long seen;
        /** Whether it ran that tick. */
        boolean ran = true;
    }

    private final Map<Integer, Entry> entries = new HashMap<>();
    private final BlockPos.MutableBlockPos probe = new BlockPos.MutableBlockPos();

    /**
     * This tick's call on one consist (on {@code path}, a driver at its
     * controls or not): take, move or drop its tickets as its lease says,
     * and tell whether it runs — it does while it holds its chunks (even
     * before freshly ticketed ones have loaded: the consist is logical, its
     * wagons catch up as they load) or while the world ticks under any part
     * of it; otherwise it stands frozen.
     */
    boolean runs(ServerLevel level, Consist consist, TrackPath path, boolean driven,
            ChunkLease.Policy policy, long now) {
        Entry entry = entries.computeIfAbsent(consist.id(), id -> new Entry());
        entry.seen = now;
        boolean moving = Math.abs(consist.speed()) >= Consist.REVERSER_STOP_EPS;
        if (entry.lease.hold(policy, now, driven, moving)) {
            hold(level, consist, path, policy, entry, now);
            entry.ran = true;
        } else {
            release(level, consist.id(), entry);
            entry.ran = anyTicking(level, under(consist, path, entry));
        }
        return entry.ran;
    }

    /**
     * True if the consist stood frozen on its last tick: it doesn't move,
     * whatever speed it was frozen with — what runs into it meets a
     * standing train (and pushes it into motion, or takes it along).
     */
    boolean frozen(int consistId) {
        Entry entry = entries.get(consistId);
        return entry != null && !entry.ran;
    }

    /** The consist was just set moving (a bump, a coupling): not frozen for the rest of this tick. */
    void thaw(int consistId) {
        Entry entry = entries.get(consistId);
        if (entry != null) {
            entry.ran = true;
        }
    }

    /** The chunks the consist holds a ticket on now. */
    int heldCount(int consistId) {
        Entry entry = entries.get(consistId);
        return entry == null ? 0 : entry.held.size();
    }

    /** After every consist's {@link #runs}: drop the tickets and state of the consists gone this tick. */
    void sweep(ServerLevel level, long now) {
        Iterator<Map.Entry<Integer, Entry>> it = entries.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<Integer, Entry> e = it.next();
            if (e.getValue().seen != now) {
                release(level, e.getKey(), e.getValue());
                it.remove();
            }
        }
    }

    /** Walk the cover anew if the consist moved on or the way ahead grew or shrank; renew the lease on time. */
    private void hold(ServerLevel level, Consist consist, TrackPath path, ChunkLease.Policy policy,
            Entry entry, long now) {
        ConsistComposition composition = consist.composition();
        double s = consist.s();
        double reach = ChunkCover.lookahead(consist.speed()) * Math.signum(consist.speed());
        boolean renew = now - entry.renewedAt >= RENEW_TICKS;
        boolean moved = entry.heldPath != path || entry.heldComposition != composition
                || !(Math.abs(s - entry.heldS) < ChunkCover.STEP)
                || Math.abs(reach - entry.heldReach) >= ChunkCover.STEP;
        if (!moved && !renew) {
            return;
        }
        long[] cover = ChunkCover.cover(path, Coupling.rearEndS(composition, s),
                Coupling.frontEndS(composition, s), consist.speed(), policy.maxChunks());
        Set<Long> next = new HashSet<>(cover.length * 2);
        ServerChunkCache chunks = level.getChunkSource();
        for (long chunk : cover) {
            next.add(chunk);
            // a ticket already held is only re-added to renew its lease
            if (renew || !entry.held.contains(chunk)) {
                chunks.addRegionTicket(TICKET, new ChunkPos(chunk), TICKET_DISTANCE, consist.id());
            }
        }
        for (long chunk : entry.held) {
            if (!next.contains(chunk)) {
                chunks.removeRegionTicket(TICKET, new ChunkPos(chunk), TICKET_DISTANCE, consist.id());
            }
        }
        entry.held = next;
        entry.heldPath = path;
        entry.heldComposition = composition;
        entry.heldS = s;
        entry.heldReach = reach;
        if (renew) {
            entry.renewedAt = now;
        }
    }

    private static void release(ServerLevel level, int consistId, Entry entry) {
        if (entry.held.isEmpty()) {
            return;
        }
        ServerChunkCache chunks = level.getChunkSource();
        for (long chunk : entry.held) {
            chunks.removeRegionTicket(TICKET, new ChunkPos(chunk), TICKET_DISTANCE, consistId);
        }
        entry.held = Set.of();
        entry.heldPath = null;
        entry.heldS = Double.NaN;
        entry.renewedAt = 0L;
    }

    /** The chunks right under the consist, re-walked only when it moved or changed. */
    private static long[] under(Consist consist, TrackPath path, Entry entry) {
        ConsistComposition composition = consist.composition();
        double s = consist.s();
        if (entry.under == null || entry.underPath != path || entry.underComposition != composition
                || entry.underS != s) {
            entry.under = ChunkCover.under(path, Coupling.rearEndS(composition, s),
                    Coupling.frontEndS(composition, s));
            entry.underPath = path;
            entry.underComposition = composition;
            entry.underS = s;
        }
        return entry.under;
    }

    /** True if any of these chunks is entity-ticking (a player near, or another consist's or a mod's ticket). */
    private boolean anyTicking(ServerLevel level, long[] chunks) {
        for (long chunk : chunks) {
            probe.set(ChunkCover.x(chunk) << ChunkCover.CHUNK_SHIFT, 0, ChunkCover.z(chunk) << ChunkCover.CHUNK_SHIFT);
            if (level.isPositionEntityTicking(probe)) {
                return true;
            }
        }
        return false;
    }
}
