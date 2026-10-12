package com.muzhik17.trainsmod.consist;

import java.util.LinkedHashSet;
import java.util.Set;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.path.TrackPath;

/**
 * Which chunks a consist keeps loaded (SPEC §2.1, decision 2026-10-12): the
 * ground under its whole length, a margin past both ends, and the way ahead
 * of its leading end — as far as it runs in {@link #LOOKAHEAD_TICKS} at its
 * speed, so the chunks it is about to enter are loaded (and their wagons
 * there with them) before it gets there. Pure, no MC imports (SPEC
 * principle #4): a chunk is a 16-block column keyed like
 * {@code ChunkPos.asLong}; {@code ConsistChunks} turns them into tickets.
 *
 * <p>The path is walked, not the world: a train on a curve covers the chunks
 * its track runs through, nothing in between.
 */
public final class ChunkCover {

    /** Blocks per chunk side, as a shift. */
    public static final int CHUNK_SHIFT = 4;
    /**
     * The path is sampled at most this far apart, blocks — a quarter chunk:
     * a track only skips a chunk it clips the corner of, and that one is
     * loaded anyway (a ticket loads the ring around its chunk).
     */
    public static final double STEP = 4.0;
    /** Ground kept past each end of the train, blocks: the next chunk, where what it runs into stands. */
    public static final double END_MARGIN = 16.0;
    /** The way ahead: as far as the train runs in this many ticks (3 s) at its speed. */
    public static final double LOOKAHEAD_TICKS = 60.0;
    /** … but no farther than this, blocks (12 chunks; 200 km/h runs them in 3.5 s). */
    public static final double MAX_LOOKAHEAD = 192.0;

    private ChunkCover() {
    }

    /** How far ahead of its leading end a train running at {@code v} (blocks/tick) keeps the way loaded, blocks. */
    public static double lookahead(double v) {
        return Math.min(Math.abs(v) * LOOKAHEAD_TICKS, MAX_LOOKAHEAD);
    }

    /**
     * The chunks to hold for a train spanning {@code [rearS, frontS]} on
     * {@code path} and running at {@code v} (blocks/tick, + = towards higher
     * {@code s}): walked from the lookahead of its leading end back to the
     * margin of its trailing end, in the order first touched, at most
     * {@code max} — a train longer than the cap keeps the way ahead and its
     * leading part. Standing, the front counts as leading.
     */
    public static long[] cover(TrackPath path, double rearS, double frontS, double v, int max) {
        double ahead = END_MARGIN + lookahead(v);
        return v < 0.0
                ? walk(path, rearS - ahead, frontS + END_MARGIN, max)
                : walk(path, frontS + ahead, rearS - END_MARGIN, max);
    }

    /** The chunks right under a train spanning {@code [rearS, frontS]} (no margins), front first. */
    public static long[] under(TrackPath path, double rearS, double frontS) {
        return walk(path, frontS, rearS, Integer.MAX_VALUE);
    }

    /**
     * The chunks the path runs through from {@code from} to {@code to}
     * (either way), first touched first, at most {@code max}. An open path
     * is walked within its ends; on a loop a walk longer than a lap stops
     * after one.
     */
    static long[] walk(TrackPath path, double from, double to, int max) {
        double length = path.length();
        if (!path.loop()) {
            from = Math.clamp(from, 0.0, length);
            to = Math.clamp(to, 0.0, length);
        } else if (Math.abs(to - from) > length) {
            to = from + Math.signum(to - from) * length;
        }
        int steps = Math.max(1, (int) Math.ceil(Math.abs(to - from) / STEP));
        Set<Long> chunks = new LinkedHashSet<>();
        long last = 0L;
        for (int i = 0; i <= steps && chunks.size() < max; i++) {
            Vector3d at = path.samplePosition(from + (to - from) * i / steps);
            long chunk = key((int) Math.floor(at.x) >> CHUNK_SHIFT, (int) Math.floor(at.z) >> CHUNK_SHIFT);
            if (i == 0 || chunk != last) {
                chunks.add(chunk);
                last = chunk;
            }
        }
        long[] out = new long[chunks.size()];
        int i = 0;
        for (long chunk : chunks) {
            out[i++] = chunk;
        }
        return out;
    }

    /** A chunk's key — the same packing as {@code ChunkPos.asLong(x, z)}. */
    public static long key(int x, int z) {
        return (x & 0xFFFFFFFFL) | (z & 0xFFFFFFFFL) << 32;
    }

    /** The chunk x of a {@link #key}. */
    public static int x(long key) {
        return (int) key;
    }

    /** The chunk z of a {@link #key}. */
    public static int z(long key) {
        return (int) (key >>> 32);
    }
}
