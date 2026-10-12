package com.muzhik17.trainsmod.consist;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.path.StraightLinePath;
import com.muzhik17.trainsmod.path.TrackPath;

/**
 * Which chunks a consist holds (SPEC §2.1, decision 2026-10-12): its length
 * plus a chunk past each end, the way ahead by its speed in front of the
 * leading end only, the cap keeping the leading part, the path's ends and a
 * loop's lap as limits.
 */
class ChunkCoverTest {

    /** A straight track along +X at z = 8 (the middle of chunk row 0), 0..1000. */
    private static final TrackPath LINE = new StraightLinePath(new Vector3d(0, 64, 8), new Vector3d(1000, 64, 8));

    /** Chunk x of each chunk, z asserted 0 on the way. */
    private static int[] xs(long[] chunks) {
        return Arrays.stream(chunks).mapToInt(chunk -> {
            assertEquals(0, ChunkCover.z(chunk), "a +X track at z = 8 stays in chunk row 0");
            return ChunkCover.x(chunk);
        }).toArray();
    }

    private static int[] range(int from, int to) {
        int step = to >= from ? 1 : -1;
        int[] out = new int[Math.abs(to - from) + 1];
        for (int i = 0; i < out.length; i++) {
            out[i] = from + i * step;
        }
        return out;
    }

    @Test
    void standingTrain_holdsItsLengthAndAChunkPastEachEnd_frontFirst() {
        // frame from 100 to 200: margins to 84 and 216 → chunks 5 … 13
        long[] cover = ChunkCover.cover(LINE, 100.0, 200.0, 0.0, 256);

        assertArrayEquals(range(13, 5), xs(cover));
    }

    @Test
    void theWayAheadGrowsWithSpeed_onTheLeadingEndOnly() {
        // 1 block/tick (72 km/h): 60 blocks ahead of the front → to 276 (chunk 17)
        assertArrayEquals(range(17, 5), xs(ChunkCover.cover(LINE, 100.0, 200.0, 1.0, 256)));
        // running −s the rear leads: from 100 − 16 − 60 = 24 (chunk 1), the front keeps its margin
        assertArrayEquals(range(1, 13), xs(ChunkCover.cover(LINE, 100.0, 200.0, -1.0, 256)));
    }

    @Test
    void theWayAheadIsCapped() {
        assertEquals(ChunkCover.MAX_LOOKAHEAD, ChunkCover.lookahead(50.0), 1.0e-9);
        assertEquals(ChunkCover.MAX_LOOKAHEAD, ChunkCover.lookahead(-50.0), 1.0e-9);
        assertEquals(30.0, ChunkCover.lookahead(-0.5), 1.0e-9);
        // 200 + 16 + 192 = 408 → chunk 25
        assertEquals(25, ChunkCover.x(ChunkCover.cover(LINE, 100.0, 200.0, 50.0, 256)[0]));
    }

    @Test
    void aTrainLongerThanTheCap_keepsTheWayAheadAndItsLeadingPart() {
        long[] cover = ChunkCover.cover(LINE, 100.0, 900.0, 1.0, 10);

        // front 900 + 76 = 976 → chunk 61, ten chunks back from there
        assertArrayEquals(range(61, 52), xs(cover));
    }

    @Test
    void anOpenPathEnds_whereItEnds() {
        long[] cover = ChunkCover.cover(LINE, 950.0, 1000.0, 2.0, 256);

        // nothing past x = 1000 (chunk 62), however far ahead it looks
        assertEquals(62, ChunkCover.x(cover[0]));
        assertArrayEquals(range(62, 58), xs(cover)); // rear 950 − 16 = 934 → chunk 58
    }

    @Test
    void under_isTheTrainItselfWithoutMargins() {
        assertArrayEquals(range(12, 6), xs(ChunkCover.under(LINE, 100.0, 200.0)));
    }

    @Test
    void aCurve_coversTheChunksItsTrackRunsThrough() {
        // a diagonal from chunk (0, 0) to chunk (3, 3)
        TrackPath diagonal = new StraightLinePath(new Vector3d(2, 64, 2), new Vector3d(62, 64, 62));

        long[] cover = ChunkCover.under(diagonal, 0.0, diagonal.length());

        for (int c = 0; c <= 3; c++) {
            long chunk = ChunkCover.key(c, c);
            assertTrue(Arrays.stream(cover).anyMatch(k -> k == chunk), "chunk (" + c + ", " + c + ") covered");
        }
        // and nothing off it
        for (long chunk : cover) {
            assertTrue(Math.abs(ChunkCover.x(chunk) - ChunkCover.z(chunk)) <= 1, "near the diagonal");
        }
    }

    @Test
    void aLoop_isWalkedOnceRound() {
        // a 64-block "loop": a square ring of four chunks, sampled by its arc length
        TrackPath ring = new TrackPath() {
            @Override
            public double length() {
                return 64.0;
            }

            @Override
            public boolean loop() {
                return true;
            }

            @Override
            public Vector3d samplePosition(double s) {
                double u = ((s % 64.0) + 64.0) % 64.0;
                int side = (int) (u / 16.0);
                double t = u - side * 16.0;
                return switch (side) {
                    case 0 -> new Vector3d(-8 + t, 64, -8);
                    case 1 -> new Vector3d(8, 64, -8 + t);
                    case 2 -> new Vector3d(8 - t, 64, 8);
                    default -> new Vector3d(-8, 64, 8 - t);
                };
            }

            @Override
            public Vector3d sampleTangent(double s) {
                return new Vector3d(1, 0, 0);
            }
        };

        // a train longer than the ring: every chunk once, no endless walk
        long[] cover = ChunkCover.cover(ring, 0.0, 500.0, 0.5, 256);

        assertEquals(4, cover.length);
        assertEquals(4, Arrays.stream(cover).distinct().count());
    }

    @Test
    void keys_packLikeChunkPos() {
        // ChunkPos.asLong(x, z) = x & 0xFFFFFFFF | (z & 0xFFFFFFFF) << 32
        assertEquals(0x0000_0002_0000_0001L, ChunkCover.key(1, 2));
        assertEquals(0xFFFF_FFFE_FFFF_FFFFL, ChunkCover.key(-1, -2));
        for (int[] c : new int[][] {{0, 0}, {-1, 5}, {123456, -98765}, {-30000000 >> 4, 30000000 >> 4}}) {
            long key = ChunkCover.key(c[0], c[1]);
            assertEquals(c[0], ChunkCover.x(key));
            assertEquals(c[1], ChunkCover.z(key));
        }
        // negative coordinates floor into the chunk west/north of 0
        TrackPath west = new StraightLinePath(new Vector3d(-20, 64, -0.5), new Vector3d(-1, 64, -0.5));
        long[] cover = ChunkCover.under(west, 0.0, west.length());
        assertEquals(ChunkCover.key(-1, -1), cover[0]);
        assertEquals(ChunkCover.key(-2, -1), cover[cover.length - 1]);
    }
}
