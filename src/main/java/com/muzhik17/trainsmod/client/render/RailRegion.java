package com.muzhik17.trainsmod.client.render;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.muzhik17.trainsmod.client.render.TileSweeper.Tile;

/**
 * One region of drawn track ({@link #SHIFT 64×64 blocks}, 4×4 chunks): the
 * tiles the {@link RailRenderer} bakes into the region's GPU meshes (one per
 * texture), grouped by segment so a graph edit replaces just the affected
 * segments' tiles, and the box the region is culled by. {@code dirty} marks
 * the meshes stale after a graph edit or a light change — the stale meshes
 * keep drawing until the re-bake lands. Pure (no MC imports); the
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

    /**
     * Frustum-test margin around a region's tile centres: half the sleeper
     * length (1.31) plus the rail height, rounded up.
     */
    static final double CULL_MARGIN = 2.0;

    /** {@link #key} of the region. */
    final long key;
    final Map<Integer, List<Tile>> bySegment = new HashMap<>();
    boolean dirty = true;
    int vertexCount;
    /** Bounds of the tile centres. */
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
        if (bySegment.put(segmentId, tiles) != null) {
            recomputeBounds(); // replaced, not added: don't double-count
        } else {
            for (Tile tile : tiles) {
                include(tile);
            }
        }
        boundsChanged();
        dirty = true;
    }

    /** Take one segment's tiles out. */
    void remove(int segmentId) {
        if (bySegment.remove(segmentId) == null) {
            return;
        }
        recomputeBounds();
        boundsChanged();
        dirty = true;
    }

    boolean isEmpty() {
        return bySegment.isEmpty();
    }

    /** Every tile of the region. */
    List<Tile> tiles() {
        List<Tile> tiles = new ArrayList<>();
        for (List<Tile> segmentTiles : bySegment.values()) {
            tiles.addAll(segmentTiles);
        }
        return tiles;
    }

    /** The box the region is culled by, {minX, minY, minZ, maxX, maxY, maxZ}. */
    double[] cullBox() {
        return new double[] {minX - CULL_MARGIN, minY - CULL_MARGIN, minZ - CULL_MARGIN,
                maxX + CULL_MARGIN, maxY + CULL_MARGIN, maxZ + CULL_MARGIN};
    }

    /** Called whenever the bounds may have changed (the renderer drops its cached cull box). */
    void boundsChanged() {
    }

    private void include(Tile tile) {
        minX = Math.min(minX, tile.cx);
        minY = Math.min(minY, tile.cy);
        minZ = Math.min(minZ, tile.cz);
        maxX = Math.max(maxX, tile.cx);
        maxY = Math.max(maxY, tile.cy);
        maxZ = Math.max(maxZ, tile.cz);
        vertexCount += tile.template.vertexCount;
    }

    private void recomputeBounds() {
        resetBounds();
        for (List<Tile> tiles : bySegment.values()) {
            for (Tile tile : tiles) {
                include(tile);
            }
        }
    }

    private void resetBounds() {
        minX = minY = minZ = Double.POSITIVE_INFINITY;
        maxX = maxY = maxZ = Double.NEGATIVE_INFINITY;
        vertexCount = 0;
    }
}
