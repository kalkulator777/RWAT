package com.muzhik17.trainsmod.client.render;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.muzhik17.trainsmod.client.render.TileSweeper.Tile;

/**
 * One region of drawn track ({@link #SHIFT 64×64 blocks}, 4×4 chunks): the
 * tiles the {@link RailRenderer} bakes into the region's GPU meshes (one per
 * texture), and the box the region is culled by. The static track is grouped
 * by segment, so a graph edit replaces just the affected segments' tiles;
 * the switch blades lying here, by their switch's node, so a throw re-sweeps
 * and re-uploads just that switch's blades — they bake into meshes of their
 * own, apart from the static track. {@code dirty} and {@code bladesDirty}
 * mark either stale after an edit, a throw or a light change — the stale
 * meshes keep drawing until the re-bake lands. Pure (no MC imports); the
 * renderer's subclass holds the meshes.
 */
class RailRegion {

    /**
     * Region edge as a power of two (1 << 6 = 64 blocks, 4×4 chunks). One
     * GPU mesh per region and texture: small enough that a relight or a
     * streaming chunk re-uploads a sliver of the network instead of all of
     * it, large enough that the visible set stays a few dozen draw calls.
     */
    static final int SHIFT = 6;

    /** {@link #key} of the region. */
    final long key;
    /** Static track, by segment. */
    final Map<Integer, List<Tile>> bySegment = new HashMap<>();
    /** Switch blades, by their switch's node. */
    final Map<Integer, List<Tile>> bladesByNode = new HashMap<>();
    boolean dirty = true;
    boolean bladesDirty = true;
    /** Vertices of the static track (the bake budget's measure). */
    int vertexCount;
    /** Bounds of what the tiles draw ({@link Tile#bounds}), blades included. */
    double minX;
    double minY;
    double minZ;
    double maxX;
    double maxY;
    double maxZ;

    RailRegion(long key) {
        this.key = key;
        resetBounds();
    }

    /** Key of the region containing the point (x, z). */
    static long key(double x, double z) {
        return keyOf(((int) Math.floor(x)) >> SHIFT, ((int) Math.floor(z)) >> SHIFT);
    }

    /** Key of region ({@code regionX}, {@code regionZ}), counted in regions. */
    static long keyOf(int regionX, int regionZ) {
        return (regionX & 0xFFFFFFFFL) | (regionZ & 0xFFFFFFFFL) << 32;
    }

    /** Add or replace one segment's tiles here. */
    void put(int segmentId, List<Tile> tiles) {
        put(bySegment, segmentId, tiles);
        dirty = true;
    }

    /** Take one segment's tiles out. */
    void remove(int segmentId) {
        if (remove(bySegment, segmentId)) {
            dirty = true;
        }
    }

    /** Add or replace the blades of the switch at {@code nodeId} lying here. */
    void putBlades(int nodeId, List<Tile> tiles) {
        put(bladesByNode, nodeId, tiles);
        bladesDirty = true;
    }

    /** Take the blades of the switch at {@code nodeId} out. */
    void removeBlades(int nodeId) {
        if (remove(bladesByNode, nodeId)) {
            bladesDirty = true;
        }
    }

    boolean isEmpty() {
        return bySegment.isEmpty() && bladesByNode.isEmpty();
    }

    boolean hasBlades() {
        return !bladesByNode.isEmpty();
    }

    /** Every tile of the static track. */
    List<Tile> tiles() {
        return all(bySegment);
    }

    /** Every blade tile. */
    List<Tile> bladeTiles() {
        return all(bladesByNode);
    }

    /**
     * The box the region is culled by, {minX, minY, minZ, maxX, maxY, maxZ}:
     * the box of what its tiles draw, no margin — a crossing's deck 4 blocks
     * off its centre line is inside, and a plain track's box is no larger
     * than its sleepers.
     */
    double[] cullBox() {
        return new double[] {minX, minY, minZ, maxX, maxY, maxZ};
    }

    /** Called whenever the bounds may have changed (the renderer drops its cached cull box). */
    void boundsChanged() {
    }

    private void put(Map<Integer, List<Tile>> map, int id, List<Tile> tiles) {
        if (map.put(id, tiles) != null) {
            recomputeBounds(); // replaced, not added: don't double-count
        } else {
            for (Tile tile : tiles) {
                include(tile, map == bySegment);
            }
        }
        boundsChanged();
    }

    private boolean remove(Map<Integer, List<Tile>> map, int id) {
        if (map.remove(id) == null) {
            return false;
        }
        recomputeBounds();
        boundsChanged();
        return true;
    }

    private static List<Tile> all(Map<Integer, List<Tile>> map) {
        List<Tile> tiles = new ArrayList<>();
        for (List<Tile> some : map.values()) {
            tiles.addAll(some);
        }
        return tiles;
    }

    private void include(Tile tile, boolean counted) {
        minX = Math.min(minX, tile.bounds[0]);
        minY = Math.min(minY, tile.bounds[1]);
        minZ = Math.min(minZ, tile.bounds[2]);
        maxX = Math.max(maxX, tile.bounds[3]);
        maxY = Math.max(maxY, tile.bounds[4]);
        maxZ = Math.max(maxZ, tile.bounds[5]);
        if (counted) {
            vertexCount += tile.template.vertexCount;
        }
    }

    private void recomputeBounds() {
        resetBounds();
        for (List<Tile> tiles : bySegment.values()) {
            for (Tile tile : tiles) {
                include(tile, true);
            }
        }
        for (List<Tile> tiles : bladesByNode.values()) {
            for (Tile tile : tiles) {
                include(tile, false);
            }
        }
    }

    private void resetBounds() {
        minX = minY = minZ = Double.POSITIVE_INFINITY;
        maxX = maxY = maxZ = Double.NEGATIVE_INFINITY;
        vertexCount = 0;
    }
}
