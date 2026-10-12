package com.muzhik17.trainsmod.client.render;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.joml.Matrix4f;
import org.joml.Vector3d;

import com.mojang.blaze3d.vertex.VertexFormat;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientRailGraph;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.RailStyle;
import com.muzhik17.trainsmod.client.render.model.RailStyles;
import com.muzhik17.trainsmod.path.HermiteSegment;
import com.muzhik17.trainsmod.path.HermiteSegmentPath;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailNode;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.path.SwitchThroat;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.path.TrackSweep;

import net.minecraft.Util;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.culling.Frustum;
import net.minecraft.core.BlockPos;
import net.minecraft.core.SectionPos;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;

/**
 * Draws the rails in the world (SPEC §2.2 visual / §2.4 pipeline): the tile of
 * each segment's {@linkplain RailStyle rail style} (SPEC §6.10) is swept along
 * its spline — every tile is bent to the curve so there are no gaps on bends —
 * and baked into {@link GpuMesh}es (one per texture) per
 * {@link #REGION_BLOCKS_SHIFT 64-block region}, so a frame
 * costs a handful of draw calls for the visible regions (the per-frame CPU
 * emit was a major part of the FPS drop; a single mesh for the whole network
 * meant every re-upload pushed the entire track at once — a ~0.8 s freeze on
 * a ~4000-block network). Regions outside the render distance, outside the
 * view frustum or over unloaded chunks are not drawn — no rails floating over
 * the void. Directional diffuse is baked into the vertex colour (the terrain
 * shader the rails draw with ignores normals — see {@link RwatRenderTypes#rails}).
 *
 * <p>Graph changes are applied <b>per segment</b>: each segment's bent tiles
 * are cached under a key of its curve and end treatment, and a new graph only
 * re-sweeps segments whose key changed (plus drops removed ones) — building a
 * segment touches that segment and its neighbours, and a switch throw (state
 * only, no geometry) touches nothing. The full re-sweep on every revision used
 * to freeze every client in the dimension on each redstone toggle.
 *
 * <p>World light is baked per tile and refreshed <b>on change</b>, the way
 * vanilla re-meshes chunk sections: the client light engine reports every
 * section whose light changed ({@link #onSectionLightChanged}, fed by two
 * mixins), only the tiles sampling light in that section are re-sampled, and
 * a region is re-uploaded only when a value actually differs — a torch next
 * to the track shows in the same frame, and an unchanged world costs nothing
 * (the earlier 10-second polling did both wrong: up to 10 s late, and a full
 * pass over the network every time). Re-uploads (light, graph edits, first
 * sight) are spread over frames by {@link #BAKE_VERTEX_BUDGET}, nearest
 * visible regions first, and a region keeps drawing its previous mesh until
 * the new one is ready.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class RailRenderer {

    /**
     * Tiles re-sampled per frame from light-changed sections. A torch dirties
     * a few sections; a burst of streaming chunks can dirty hundreds at once,
     * and those spill over to the next frames (each sample is a block-state
     * and two light-engine lookups).
     */
    private static final int LIGHT_TILE_BUDGET = 2048;

    /**
     * Switch point-blade rendering master switch (SPEC §2.2 v1). Off it drew
     * every segment as plain swept track (2026-06-12: the old blade — a
     * whole leg's rails shifted sideways — read as crossing rails); back on
     * 2026-10-12 with real blades: a leg's inner rail planed to a point
     * against the other leg's stock rail, thrown off it when the switch is
     * set the other way ({@link SwitchThroat}). Cosmetic only — the switch
     * mechanics (state, redstone toggle, routing, train re-anchor) and the
     * track bed don't depend on it.
     */
    private static final boolean SWITCH_BLADES = true;

    /** Blade throw animation duration, ms. */
    private static final long BLADE_ANIM_MS = 500;

    /**
     * Region bucket edge as a power of two (1 << 6 = 64 blocks, 4×4 chunks).
     * One {@link GpuMesh} per bucket: small enough that a relight or a
     * streaming chunk re-uploads a sliver of the network instead of all of
     * it, large enough that the visible set stays a few dozen draw calls.
     */
    private static final int REGION_BLOCKS_SHIFT = 6;

    /**
     * Vertices baked per frame before the remaining dirty regions wait for
     * the next frame (~1600 tiles, ~4 MB). At least one region is baked every
     * frame regardless, so an oversized region still makes progress.
     */
    private static final int BAKE_VERTEX_BUDGET = 131_072;

    /**
     * Frustum-test margin around a region's tile centres: half the sleeper
     * length (1.31) plus the rail height, rounded up.
     */
    private static final double CULL_MARGIN = 2.0;

    /**
     * One texture's share of a rail style tile, flattened for sweeping:
     * triangles (rail OBJs are mostly triangles, stored as degenerate quads in
     * {@link Mesh} — emitting them as triangles saves a quarter of the
     * vertices), with each vertex tied to one of a handful of along-track
     * <i>stations</i> (distinct local X — 7 in MVP's rail). Bending then
     * samples the spline frame once per station, not twice per vertex.
     */
    private static final class TileTemplate {
        final RenderType renderType;
        /** Repeat distance along the track, blocks (the style's tile length). */
        final double tileLength;
        /** Distinct along-tile fractions 0..1, one path frame each. */
        final double[] stations;
        final int[] station; // per vertex: index into stations
        final float[] y;     // per vertex: local height (up)
        final float[] z;     // per vertex: local cross-track (right)
        final float[] nx;    // per vertex: local normal, X = along
        final float[] ny;
        final float[] nz;
        final float[] u;
        final float[] v;
        final float[] rgba;  // per vertex: base colour, 4 floats
        /** Per vertex: the vertex whose bent normal shades it (its quad's first corner). */
        final int[] shadeFrom;
        final int vertexCount;

        TileTemplate(Mesh mesh, RenderType renderType, double tileLength) {
            this.renderType = renderType;
            this.tileLength = tileLength;
            List<Mesh.Vertex> verts = new ArrayList<>();
            List<Mesh.Quad> owners = new ArrayList<>();
            List<Integer> shadeSrc = new ArrayList<>();
            for (Mesh.Quad q : mesh.quads()) {
                int first = verts.size();
                // QUADS index order is (0,1,2)(2,3,0); a triangle is (0,1,2) only
                for (Mesh.Vertex vx : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2()}) {
                    verts.add(vx);
                    owners.add(q);
                    shadeSrc.add(first);
                }
                if (!sameCorner(q.v2(), q.v3())) {
                    for (Mesh.Vertex vx : new Mesh.Vertex[]{q.v2(), q.v3(), q.v0()}) {
                        verts.add(vx);
                        owners.add(q);
                        shadeSrc.add(first);
                    }
                }
            }
            vertexCount = verts.size();
            Map<Float, Integer> stationOf = new LinkedHashMap<>();
            station = new int[vertexCount];
            y = new float[vertexCount];
            z = new float[vertexCount];
            nx = new float[vertexCount];
            ny = new float[vertexCount];
            nz = new float[vertexCount];
            u = new float[vertexCount];
            v = new float[vertexCount];
            rgba = new float[vertexCount * 4];
            shadeFrom = new int[vertexCount];
            for (int i = 0; i < vertexCount; i++) {
                Mesh.Vertex vx = verts.get(i);
                Mesh.Quad q = owners.get(i);
                station[i] = stationOf.computeIfAbsent(vx.x(), k -> stationOf.size());
                y[i] = vx.y();
                z[i] = vx.z();
                nx[i] = vx.nx();
                ny[i] = vx.ny();
                nz[i] = vx.nz();
                u[i] = vx.u();
                v[i] = vx.v();
                rgba[i * 4] = q.r();
                rgba[i * 4 + 1] = q.g();
                rgba[i * 4 + 2] = q.b();
                rgba[i * 4 + 3] = q.a();
                shadeFrom[i] = shadeSrc.get(i);
            }
            stations = new double[stationOf.size()];
            for (Map.Entry<Float, Integer> entry : stationOf.entrySet()) {
                // 0..1 along the tile, which is centred on x = 0
                stations[entry.getValue()] = entry.getKey() / tileLength + 0.5;
            }
        }

        private static boolean sameCorner(Mesh.Vertex a, Mesh.Vertex b) {
            return a == b || a.equals(b);
        }
    }

    /**
     * A rail style flattened for sweeping, one template per texture:
     * {@code full} for track; for a switch throat (SPEC §2.2 v1) the same
     * tile apart — {@code base} (all but the rail objects) and the rail
     * objects of either side, {@code plusRails}/{@code minusRails}.
     * {@code styleId} is the style actually drawn ({@code ""} if not even the
     * standard rail loaded — then there is nothing to draw); {@code blades}
     * null if its switches draw as plain track.
     */
    private record StyleTemplates(String styleId, List<TileTemplate> full, List<TileTemplate> base,
            List<TileTemplate> plusRails, List<TileTemplate> minusRails, RailStyle.Blades blades) {

        /** The rail objects on {@code side} ({@link SwitchThroat#PLUS_Z}/{@link SwitchThroat#MINUS_Z}). */
        List<TileTemplate> rails(int side) {
            return side == SwitchThroat.PLUS_Z ? plusRails : minusRails;
        }

        /**
         * What a leg's blade stretch draws statically: its sleepers if it
         * keeps the throat's, and the rails that aren't blades.
         */
        List<TileTemplate> throat(ThroatEnd end) {
            List<TileTemplate> out = new ArrayList<>();
            if (end.sleepers()) {
                out.addAll(base);
            }
            for (int side : new int[] {SwitchThroat.PLUS_Z, SwitchThroat.MINUS_Z}) {
                if ((end.bladeSides() & side) == 0) {
                    out.addAll(rails(side));
                }
            }
            return out;
        }
    }

    private static final StyleTemplates NO_TEMPLATES =
            new StyleTemplates("", List.of(), List.of(), List.of(), List.of(), null);
    /** Templates per loaded style (identity: a resource reload brings new style objects and clears this). */
    private static final Map<RailStyle, StyleTemplates> styleTemplates = new IdentityHashMap<>();

    /** The templates a segment of rail style {@code style} is swept with (unknown styles → standard rail). */
    private static StyleTemplates templatesFor(String style) {
        RailStyle railStyle = RailStyles.forSegment(style);
        if (railStyle == null) {
            return NO_TEMPLATES;
        }
        return styleTemplates.computeIfAbsent(railStyle, s -> {
            List<TileTemplate> full = new ArrayList<>();
            List<TileTemplate> base = new ArrayList<>();
            List<TileTemplate> plusRails = new ArrayList<>();
            List<TileTemplate> minusRails = new ArrayList<>();
            for (RailStyle.Part part : s.parts()) {
                RenderType type = RwatRenderTypes.rails(part.texture());
                addTemplate(full, part.full(), type, s.tileLength());
                addTemplate(base, part.base(), type, s.tileLength());
                addTemplate(plusRails, part.plusRails(), type, s.tileLength());
                addTemplate(minusRails, part.minusRails(), type, s.tileLength());
            }
            return new StyleTemplates(s.id(), List.copyOf(full), List.copyOf(base),
                    List.copyOf(plusRails), List.copyOf(minusRails), s.blades());
        });
    }

    /** A template of the mesh, unless it has no faces (a texture only the other objects use). */
    private static void addTemplate(List<TileTemplate> out, Mesh mesh, RenderType type, double tileLength) {
        if (!mesh.quads().isEmpty()) {
            out.add(new TileTemplate(mesh, type, tileLength));
        }
    }

    /**
     * One bent tile, compact: world positions plus a packed normal and baked
     * diffuse shade per vertex — UV and base colour stay in the shared
     * {@link TileTemplate} (~4 KB per tile, where a bent {@link Mesh} of
     * records was ~22 KB, ~85 MB of heap for a 3800-block network). The
     * geometry depends only on the rail graph; {@code light} is the one field
     * a relight may touch (sampled one block above the tile centre, in
     * section {@code lightSection}).
     */
    private static final class Tile {
        final TileTemplate template;
        final float[] xyz;
        /** Per vertex: normal as three signed bytes (bits 0–23) + shade 0–255 (bits 24–31). */
        final int[] normalShade;
        final double cx;
        final double cy;
        final double cz;
        /** Region bucket holding the tile. */
        final long bucketKey;
        /** {@link SectionPos#asLong} of the light sample point ({@link #tileLight}). */
        final long lightSection;
        int light = -1; // never sampled

        Tile(TileTemplate template, float[] xyz, int[] normalShade, Vector3d centre) {
            this.template = template;
            this.xyz = xyz;
            this.normalShade = normalShade;
            this.cx = centre.x;
            this.cy = centre.y;
            this.cz = centre.z;
            this.bucketKey = RailRenderer.bucketKey(cx, cz);
            this.lightSection = SectionPos.asLong(SectionPos.blockToSectionCoord(cx),
                    SectionPos.blockToSectionCoord(cy + 1.0), SectionPos.blockToSectionCoord(cz));
        }
    }

    /**
     * The tiles and GPU meshes of one region of track, grouped by segment so
     * a graph edit replaces just the affected segments' tiles. {@code meshes}
     * (one per texture) are baked lazily once the region is in range (a
     * region the player never approaches is never uploaded); {@code dirty}
     * marks them stale after a graph edit or a light change — the stale
     * meshes keep drawing until the re-bake lands. Freed once the player
     * leaves the region far behind.
     */
    private static final class Bucket {
        final Map<Integer, List<Tile>> bySegment = new HashMap<>();
        List<GpuMesh> meshes;
        boolean dirty = true;
        int vertexCount;
        double minX;
        double minY;
        double minZ;
        double maxX;
        double maxY;
        double maxZ;
        AABB cullBox;
        // per-frame scratch for the bake ordering
        double distSq;
        boolean inView;

        Bucket() {
            resetBounds();
        }

        void put(int segmentId, List<Tile> tiles) {
            if (bySegment.put(segmentId, tiles) != null) {
                recomputeBounds(); // replaced, not added: don't double-count
            } else {
                for (Tile tile : tiles) {
                    include(tile);
                }
            }
            cullBox = null;
            dirty = true;
        }

        void remove(int segmentId) {
            if (bySegment.remove(segmentId) == null) {
                return;
            }
            recomputeBounds();
            cullBox = null;
            dirty = true;
        }

        boolean isEmpty() {
            return bySegment.isEmpty();
        }

        AABB cullBox() {
            if (cullBox == null) {
                cullBox = new AABB(minX, minY, minZ, maxX, maxY, maxZ).inflate(CULL_MARGIN);
            }
            return cullBox;
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

    /**
     * What a segment's static sweep depends on: its curve and its end
     * treatment (overhang at open ends, switch throats). Equal key → the
     * cached tiles are still exactly right. Switch selection is deliberately
     * not part of it — it moves only the blades.
     */
    private record SegmentKey(Vector3d p0, Vector3d m0, Vector3d p1, Vector3d m1,
            boolean overhangA, boolean overhangB, ThroatEnd throatA, ThroatEnd throatB, String style) {
    }

    /**
     * A segment end in a switch throat, as its static sweep sees it (SPEC
     * §2.2 v1): the first {@code bladeLength} from the node draws the sleepers
     * only on the throat's sleeper leg ({@code sleepers}) and leaves out the
     * blade rails ({@code bladeSides}, {@link SwitchThroat} side bits) —
     * {@link #rebuildBlades} draws those.
     */
    private record ThroatEnd(double bladeLength, boolean sleepers, int bladeSides) {
    }

    /** A cached segment sweep: its key and the region buckets holding its tiles. */
    private record SegmentEntry(SegmentKey key, Set<Long> bucketKeys) {
    }

    /**
     * A blade found at sweep time: the rail on {@code side} of
     * {@code segmentId}'s end at {@code nodeId}, {@code length} long, in a
     * throat of co-directional legs ({@code groupIds}, sorted — a switch's
     * diverging side); {@code separation} is how far its stock rail is from it.
     */
    private record BladeSpec(int nodeId, int segmentId, List<Integer> groupIds, int side, double length,
            SwitchThroat.Separation separation) {
    }

    /** Region buckets keyed by {@link ChunkPos#asLong} of the region coords. */
    private static final Map<Long, Bucket> buckets = new HashMap<>();
    /** Segment id → its cached sweep (the tiles live in {@link #buckets}). */
    private static final Map<Integer, SegmentEntry> segmentCache = new HashMap<>();
    /** Static tiles by the section their light is sampled in — the relight index. */
    private static final Map<Long, List<Tile>> tilesBySection = new HashMap<>();
    /** Light-changed sections holding rail tiles, waiting to be re-sampled (FIFO). */
    private static final Set<Long> lightDirty = new LinkedHashSet<>();
    private static final List<Tile> bladeTiles = new ArrayList<>();
    /** Light sections of the blade tiles. */
    private static final Set<Long> bladeSections = new HashSet<>();
    private static final List<BladeSpec> bladeSpecs = new ArrayList<>();
    /** Switch selection counters as currently displayed (animation reference). */
    private static final Map<Integer, Integer> shownSelection = new HashMap<>();
    /** Selection counters from before the latest change, per animating node. */
    private static final Map<Integer, Integer> prevSelection = new HashMap<>();
    /** Animation start (Util.getMillis()) per animating node. */
    private static final Map<Integer, Long> animStart = new HashMap<>();
    private static List<GpuMesh> bladeMeshes;
    private static boolean bladesDirty;
    private static int cachedGeneration = -1;
    /** The level the cache was built in — a new one (dimension change) starts over. */
    private static ClientLevel cachedLevel;

    /** Per-frame scratch (render thread only). */
    private static final List<Bucket> inRange = new ArrayList<>();
    private static final List<Bucket> bakeQueue = new ArrayList<>();
    private static final GpuMesh.Batch BATCH = new GpuMesh.Batch();
    private static final Comparator<Bucket> BAKE_ORDER = Comparator
            .comparing((Bucket b) -> !b.inView) // visible first
            .thenComparingDouble(b -> b.distSq);

    private RailRenderer() {
    }

    @SubscribeEvent
    static void onRenderLevel(RenderLevelStageEvent event) {
        // Stage choice is load-bearing: the block stages (e.g. AFTER_CUTOUT_BLOCKS)
        // fire before vanilla puts the camera rotation on the modelview stack, so
        // geometry drawn there lands in view space and sticks to the camera.
        // AFTER_BLOCK_ENTITIES fires with the camera matrix on the stack and entity
        // lighting set up — the same configuration vanilla block entities draw in.
        if (event.getStage() != RenderLevelStageEvent.Stage.AFTER_BLOCK_ENTITIES) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        ClientLevel level = mc.level;
        if (level == null) {
            return;
        }
        if (level != cachedLevel) {
            clear(); // dimension change: nothing of the old level's track applies
            cachedLevel = level;
        }
        RailGraph graph = ClientRailGraph.graph();
        if (graph == null) {
            if (cachedGeneration != -1) {
                clear();
                cachedLevel = level;
            }
            return;
        }
        long now = Util.getMillis();
        if (SWITCH_BLADES && cachedGeneration != ClientRailGraph.generation()) {
            trackSelectionChanges(graph, now, cachedGeneration == -1);
        }
        if (cachedGeneration != ClientRailGraph.generation()) {
            syncSegments(level, graph);
            cachedGeneration = ClientRailGraph.generation();
        }
        relightDirtySections(level);
        if (SWITCH_BLADES) {
            boolean finished = animStart.values().removeIf(start -> now - start >= BLADE_ANIM_MS);
            if (bladesDirty || finished || !animStart.isEmpty()) {
                rebuildBlades(level, graph, now);
                bladesDirty = false;
            }
        }
        if (buckets.isEmpty() && bladeTiles.isEmpty()) {
            return;
        }
        drawTerrainPath(event, level);
    }

    /**
     * Record switch selection changes for the blade animation: a changed node
     * remembers its previous counter and the change time; the blades then
     * lerp between the two states. The first sync after login just adopts the
     * state — no throw animation for switches that were already set.
     */
    private static void trackSelectionChanges(RailGraph graph, long now, boolean firstSync) {
        Map<Integer, Integer> current = new HashMap<>();
        for (Map.Entry<Integer, Integer> entry : graph.switchSelections().entrySet()) {
            current.put(entry.getKey(), entry.getValue());
        }
        for (Integer node : shownSelection.keySet()) {
            current.putIfAbsent(node, 0);
        }
        for (Map.Entry<Integer, Integer> entry : current.entrySet()) {
            int shown = shownSelection.getOrDefault(entry.getKey(), 0);
            if (entry.getValue() != shown && !firstSync) {
                prevSelection.put(entry.getKey(), shown);
                animStart.put(entry.getKey(), now);
            }
        }
        shownSelection.clear();
        shownSelection.putAll(current);
    }

    /**
     * Terrain shader, diffuse baked in, ChunkOffset = −camera for fog. Picks
     * the regions in range (render distance, loaded centre chunk), re-bakes
     * the stale ones within the frame budget — visible and nearest first —
     * and draws those in the view frustum.
     */
    private static void drawTerrainPath(RenderLevelStageEvent event, ClientLevel level) {
        // no −cam translate: the camera offset goes through ChunkOffset, so the
        // terrain shader's fog is computed camera-relative (see RwatRenderTypes)
        Vec3 cam = event.getCamera().getPosition();
        Frustum frustum = event.getFrustum();
        // Cull limit: just past the render distance. Together with the
        // loaded-chunk check this stops rails from floating over the void
        // where the terrain itself is not drawn.
        double limit = (Minecraft.getInstance().options.getEffectiveRenderDistance() + 1) * 16.0;
        double evict = limit * 2.0;
        inRange.clear();
        bakeQueue.clear();
        for (Bucket bucket : buckets.values()) {
            double dx = Math.max(0.0, Math.max(bucket.minX - cam.x, cam.x - bucket.maxX));
            double dz = Math.max(0.0, Math.max(bucket.minZ - cam.z, cam.z - bucket.maxZ));
            double distSq = dx * dx + dz * dz;
            if (distSq > limit * limit || !centreChunkLoaded(level, bucket)) {
                // free the GPU memory of regions left far behind
                if (bucket.meshes != null && distSq > evict * evict) {
                    closeAll(bucket.meshes);
                    bucket.meshes = null;
                    bucket.dirty = true;
                }
                continue;
            }
            bucket.distSq = distSq;
            bucket.inView = frustum == null || frustum.isVisible(bucket.cullBox());
            inRange.add(bucket);
            if (bucket.meshes == null || bucket.dirty) {
                bakeQueue.add(bucket);
            }
        }
        if (!bakeQueue.isEmpty()) {
            bakeQueue.sort(BAKE_ORDER);
            int budget = BAKE_VERTEX_BUDGET;
            for (Bucket bucket : bakeQueue) {
                if (budget <= 0) {
                    break; // the rest next frame; stale meshes keep drawing meanwhile
                }
                bakeBucket(level, bucket);
                budget -= bucket.vertexCount;
            }
        }
        Matrix4f pose = event.getPoseStack().last().pose();
        float offX = (float) -cam.x;
        float offY = (float) -cam.y;
        float offZ = (float) -cam.z;
        for (Bucket bucket : inRange) {
            if (bucket.inView && bucket.meshes != null) {
                for (GpuMesh mesh : bucket.meshes) {
                    BATCH.add(mesh, pose, offX, offY, offZ);
                }
            }
        }
        if (bladeMeshes == null && !bladeTiles.isEmpty()) {
            refreshLight(level, bladeTiles);
            bladeMeshes = uploadByTexture(bladeTiles);
        }
        if (bladeMeshes != null) {
            for (GpuMesh mesh : bladeMeshes) {
                BATCH.add(mesh, pose, offX, offY, offZ);
            }
        }
        BATCH.flush();
    }

    /** Whether the chunk under the bucket's centre is loaded on the client. */
    private static boolean centreChunkLoaded(ClientLevel level, Bucket bucket) {
        int chunkX = SectionPos.blockToSectionCoord((bucket.minX + bucket.maxX) / 2.0);
        int chunkZ = SectionPos.blockToSectionCoord((bucket.minZ + bucket.maxZ) / 2.0);
        return level.hasChunk(chunkX, chunkZ);
    }

    /**
     * (Re-)upload one bucket's mesh. Light is re-sampled first: the tiles may
     * have been swept while the bucket's chunks were still unloaded, and the
     * first visible frame is exactly when the truth is available.
     */
    private static void bakeBucket(ClientLevel level, Bucket bucket) {
        List<Tile> tiles = new ArrayList<>();
        for (List<Tile> segmentTiles : bucket.bySegment.values()) {
            tiles.addAll(segmentTiles);
        }
        refreshLight(level, tiles);
        List<GpuMesh> baked = uploadByTexture(tiles);
        if (bucket.meshes != null) {
            closeAll(bucket.meshes);
        }
        bucket.meshes = baked;
        bucket.dirty = false;
    }

    /** Upload tiles as one terrain-shader GPU mesh per texture (render type). */
    private static List<GpuMesh> uploadByTexture(List<Tile> tiles) {
        Map<RenderType, List<Tile>> byType = new LinkedHashMap<>();
        for (Tile tile : tiles) {
            byType.computeIfAbsent(tile.template.renderType, t -> new ArrayList<>()).add(tile);
        }
        List<GpuMesh> meshes = new ArrayList<>(byType.size());
        for (Map.Entry<RenderType, List<Tile>> entry : byType.entrySet()) {
            meshes.add(upload(entry.getValue(), tilesVertexCount(entry.getValue()), entry.getKey()));
        }
        return meshes;
    }

    private static void closeAll(List<GpuMesh> meshes) {
        for (GpuMesh mesh : meshes) {
            mesh.close();
        }
    }

    /** Emit tiles (all of one texture) as triangles into one terrain-shader GPU mesh. */
    private static GpuMesh upload(List<Tile> tiles, int vertexCount, RenderType renderType) {
        GpuMesh.Builder builder = new GpuMesh.Builder(renderType,
                VertexFormat.Mode.TRIANGLES, vertexCount);
        for (Tile tile : tiles) {
            TileTemplate t = tile.template;
            for (int i = 0; i < t.vertexCount; i++) {
                int packed = tile.normalShade[i];
                float shade = (packed >>> 24) / 255.0F;
                int color = Mesh.argb(t.rgba[i * 4] * shade, t.rgba[i * 4 + 1] * shade,
                        t.rgba[i * 4 + 2] * shade, t.rgba[i * 4 + 3]);
                builder.vertex(tile.xyz[i * 3], tile.xyz[i * 3 + 1], tile.xyz[i * 3 + 2],
                        color, t.u[i], t.v[i], tile.light,
                        (byte) packed / 127.0F, (byte) (packed >> 8) / 127.0F,
                        (byte) (packed >> 16) / 127.0F);
            }
        }
        return builder.upload();
    }

    private static int tilesVertexCount(List<Tile> tiles) {
        int count = 0;
        for (Tile tile : tiles) {
            count += tile.template.vertexCount;
        }
        return count;
    }

    /** Key of the region bucket containing the point. */
    private static long bucketKey(double x, double z) {
        return ChunkPos.asLong(
                ((int) Math.floor(x)) >> REGION_BLOCKS_SHIFT,
                ((int) Math.floor(z)) >> REGION_BLOCKS_SHIFT);
    }

    /** Drop the cached geometry and animation state (e.g. on logout). */
    public static void clear() {
        dropGeometry();
        dropBladeGeometry();
        styleTemplates.clear();
        bladeSpecs.clear();
        shownSelection.clear();
        prevSelection.clear();
        animStart.clear();
        bladesDirty = false;
        cachedGeneration = -1;
        cachedLevel = null;
    }

    private static void dropGeometry() {
        for (Bucket bucket : buckets.values()) {
            if (bucket.meshes != null) {
                closeAll(bucket.meshes);
            }
        }
        buckets.clear();
        segmentCache.clear();
        tilesBySection.clear();
        lightDirty.clear();
    }

    private static void dropBladeGeometry() {
        if (bladeMeshes != null) {
            closeAll(bladeMeshes);
            bladeMeshes = null;
        }
        bladeTiles.clear();
        bladeSections.clear();
    }

    /** World light sampled one block above a tile's centre. */
    private static int tileLight(ClientLevel level, Tile tile) {
        return LevelRenderer.getLightColor(level,
                BlockPos.containing(tile.cx, tile.cy + 1.0, tile.cz));
    }

    /**
     * Bring the cached segment sweeps in line with a new graph: segments
     * whose {@link SegmentKey} is unchanged keep their tiles (and their
     * regions' GPU meshes stay clean); changed and new segments are re-swept,
     * removed ones dropped — only the regions they touch go dirty. The
     * switch throats are laid out first ({@link #throats}): their blade rails
     * are left out of the static sweep and recorded as {@link BladeSpec}s —
     * {@link #rebuildBlades} draws them as the switch is set.
     */
    private static void syncSegments(ClientLevel level, RailGraph graph) {
        bladeSpecs.clear();
        bladesDirty = true;
        Map<Long, ThroatEnd> throats = SWITCH_BLADES ? throats(graph) : Map.of();
        Set<Integer> alive = new HashSet<>();
        for (RailSegment segment : graph.segments()) {
            alive.add(segment.id());
            HermiteSegment curve = graph.hermite(segment);
            StyleTemplates templates = templatesFor(segment.style());
            SegmentKey key = new SegmentKey(
                    curve.start(), curve.startTangent(), curve.end(), curve.endTangent(),
                    graph.overhangAt(segment, segment.nodeA()),
                    graph.overhangAt(segment, segment.nodeB()),
                    throats.get(endKey(segment.id(), true)), throats.get(endKey(segment.id(), false)),
                    templates.styleId());
            SegmentEntry cached = segmentCache.get(segment.id());
            if (cached != null && cached.key().equals(key)) {
                continue; // untouched by this edit
            }
            if (cached != null) {
                evictSegment(segment.id(), cached);
            }
            segmentCache.put(segment.id(), sweepSegment(segment.id(), curve, key, templates));
        }
        segmentCache.entrySet().removeIf(entry -> {
            if (alive.contains(entry.getKey())) {
                return false;
            }
            evictSegment(entry.getKey(), entry.getValue());
            return true;
        });
    }

    /**
     * Lay out the switch throats (SPEC §2.2 v1): every cluster of
     * co-directional segment ends at a node ({@link #bladeCluster}) whose
     * legs all draw in a style with blades gets its {@link SwitchThroat} —
     * per leg end the static sweep's treatment (returned, by
     * {@link #endKey}) and per blade a {@link BladeSpec}. A throat with a leg
     * in a style without blades stays plain track: its rail objects aren't
     * the running rails, and nothing else may be bent.
     */
    private static Map<Long, ThroatEnd> throats(RailGraph graph) {
        Map<Long, ThroatEnd> ends = new HashMap<>();
        for (RailNode node : graph.nodes()) {
            Set<List<Integer>> seen = new HashSet<>();
            for (int segmentId : node.segments()) {
                List<Integer> cluster = bladeCluster(graph, graph.segment(segmentId), node.id());
                if (cluster == null || !seen.add(cluster) || !bladed(graph, cluster)) {
                    continue;
                }
                SwitchThroat throat = SwitchThroat.of(graph, node.id(), cluster);
                int sleeperLeg = throat.sleeperLeg();
                for (int legId : cluster) {
                    int sides = throat.bladeSides(legId);
                    double length = throat.bladeLength(legId);
                    ends.put(endKey(legId, throat.atStart(legId)), new ThroatEnd(length, legId == sleeperLeg, sides));
                    for (int side : new int[] {SwitchThroat.PLUS_Z, SwitchThroat.MINUS_Z}) {
                        if ((sides & side) != 0) {
                            bladeSpecs.add(new BladeSpec(node.id(), legId, cluster, side, length,
                                    throat.separation(legId, side)));
                        }
                    }
                }
            }
        }
        return ends;
    }

    /** Whether every leg of a throat draws in a style with blades. */
    private static boolean bladed(RailGraph graph, List<Integer> legIds) {
        for (int id : legIds) {
            if (templatesFor(graph.segment(id).style()).blades() == null) {
                return false;
            }
        }
        return true;
    }

    /** Key of a segment's end: its start (node A) or its end (node B). */
    private static long endKey(int segmentId, boolean atStart) {
        return segmentId * 2L + (atStart ? 0 : 1);
    }

    /**
     * Sweep one segment's static tiles and file them into region buckets. A
     * throat end's blade stretch draws apart from the rest — without its
     * blades, and without sleepers but on the sleeper leg; an open end's
     * overhang at a Y's toe is plain track in front of it.
     */
    private static SegmentEntry sweepSegment(int segmentId, HermiteSegment curve, SegmentKey key,
            StyleTemplates templates) {
        HermiteSegmentPath base = new HermiteSegmentPath(curve);
        double length = base.length();
        double startOver = key.overhangA() ? TrackSweep.END_OVERHANG : 0.0;
        TrackPath path = TrackSweep.path(base, key.overhangA(), key.overhangB());
        double from = 0.0;
        double to = path.length();
        List<Tile> swept = new ArrayList<>();
        if (key.throatA() != null) {
            double heel = startOver + key.throatA().bladeLength();
            sweepAll(templates.full(), new SubPath(path, 0.0, startOver), swept);
            sweepAll(templates.throat(key.throatA()), new SubPath(path, startOver, heel), swept);
            from = heel;
        }
        if (key.throatB() != null) {
            double tip = startOver + length;
            double heel = tip - key.throatB().bladeLength();
            sweepAll(templates.throat(key.throatB()), new SubPath(path, heel, tip), swept);
            sweepAll(templates.full(), new SubPath(path, tip, path.length()), swept);
            to = heel;
        }
        sweepAll(templates.full(), new SubPath(path, from, to), swept);

        Map<Long, List<Tile>> byBucket = new HashMap<>();
        for (Tile tile : swept) {
            byBucket.computeIfAbsent(tile.bucketKey, k -> new ArrayList<>()).add(tile);
            tilesBySection.computeIfAbsent(tile.lightSection, k -> new ArrayList<>()).add(tile);
        }
        for (Map.Entry<Long, List<Tile>> entry : byBucket.entrySet()) {
            buckets.computeIfAbsent(entry.getKey(), k -> new Bucket())
                    .put(segmentId, entry.getValue());
        }
        return new SegmentEntry(key, byBucket.keySet());
    }

    /**
     * Take a segment's tiles out of its buckets and the light index; emptied
     * buckets are freed.
     */
    private static void evictSegment(int segmentId, SegmentEntry entry) {
        Set<Tile> evicted = Collections.newSetFromMap(new IdentityHashMap<>());
        for (long bucketKey : entry.bucketKeys()) {
            Bucket bucket = buckets.get(bucketKey);
            if (bucket == null) {
                continue;
            }
            List<Tile> tiles = bucket.bySegment.get(segmentId);
            if (tiles != null) {
                evicted.addAll(tiles);
            }
            bucket.remove(segmentId);
            if (bucket.isEmpty()) {
                if (bucket.meshes != null) {
                    closeAll(bucket.meshes);
                }
                buckets.remove(bucketKey);
            }
        }
        Set<Long> sections = new HashSet<>();
        for (Tile tile : evicted) {
            sections.add(tile.lightSection);
        }
        for (long section : sections) {
            List<Tile> indexed = tilesBySection.get(section);
            if (indexed != null && indexed.removeIf(evicted::contains) && indexed.isEmpty()) {
                tilesBySection.remove(section);
            }
        }
    }

    /**
     * The cluster of co-directional segment-ends {@code segment} belongs to at
     * {@code nodeId} (sorted ids, {@code segment} included), or null if the
     * end is no switch blade: the diverging legs of a Y/N/scissors junction
     * depart their node the same way (mutual cos > {@link RailGraph#CONTINUATION_DOT}),
     * a plain joint's two ends depart opposite ways, and a diamond crossing's
     * perpendicular legs are no cluster either.
     */
    private static List<Integer> bladeCluster(RailGraph graph, RailSegment segment, int nodeId) {
        Vector3d dep = graph.departure(segment, nodeId);
        List<Integer> cluster = new ArrayList<>();
        for (int otherId : graph.node(nodeId).segments()) {
            if (otherId == segment.id()) {
                continue;
            }
            if (graph.departure(graph.segment(otherId), nodeId).dot(dep) > RailGraph.CONTINUATION_DOT) {
                cluster.add(otherId);
            }
        }
        if (cluster.isEmpty()) {
            return null;
        }
        cluster.add(segment.id());
        cluster.sort(Integer::compare);
        return cluster;
    }

    /**
     * Rebuild the blade tiles against the current switch states: every blade
     * rail is swept planed against its stock rail ({@link SwitchThroat}) —
     * closed (pressed against it) on the selected leg, where the route runs,
     * thrown {@link SwitchThroat#BLADE_THROW} off it at the tip on the
     * others. A selection change lerps the throws over {@link #BLADE_ANIM_MS}
     * (smoothstep), so the blades visibly move when the switch is thrown —
     * all of a throat's blades together, like blades on one tie bar.
     */
    private static void rebuildBlades(ClientLevel level, RailGraph graph, long now) {
        dropBladeGeometry();
        for (BladeSpec spec : bladeSpecs) {
            RailSegment segment = graph.segment(spec.segmentId());
            if (segment == null) {
                continue;
            }
            HermiteSegmentPath base = new HermiteSegmentPath(graph.hermite(segment));
            double length = base.length();
            boolean tipAtStart = segment.nodeA() == spec.nodeId();

            List<Integer> ids = spec.groupIds();
            int current = graph.switchSelection(spec.nodeId());
            int previous = prevSelection.getOrDefault(spec.nodeId(), current);
            Long start = animStart.get(spec.nodeId());
            double progress = start == null ? 1.0
                    : Math.clamp((now - start) / (double) BLADE_ANIM_MS, 0.0, 1.0);
            int selectedId = ids.get(Math.floorMod(current, ids.size()));
            int prevSelectedId = ids.get(Math.floorMod(previous, ids.size()));

            double target = spec.segmentId() == selectedId ? 0.0 : 1.0;
            double from = spec.segmentId() == prevSelectedId ? 0.0 : 1.0;
            double eased = progress * progress * (3.0 - 2.0 * progress);
            double open = from + (target - from) * eased;

            // the same stretch the static sweep left out, so the tiles line up
            boolean overhangA = graph.overhangAt(segment, segment.nodeA());
            double startOver = overhangA ? TrackSweep.END_OVERHANG : 0.0;
            TrackPath path = TrackSweep.path(base, overhangA, graph.overhangAt(segment, segment.nodeB()));
            double tip = tipAtStart ? startOver : startOver + length;
            double heel = tipAtStart ? tip + spec.length() : tip - spec.length();
            StyleTemplates templates = templatesFor(segment.style());
            if (templates.blades() == null) {
                continue; // restyled under us; the next sync drops the spec
            }
            BladeBend bend = new BladeBend(spec.side(), templates.blades().face(spec.side()), spec.length(),
                    tipAtStart, spec.separation(), open);
            for (TileTemplate rail : templates.rails(spec.side())) {
                sweep(rail, new SubPath(path, Math.min(tip, heel), Math.max(tip, heel)), bend, bladeTiles);
            }
        }
        for (Tile tile : bladeTiles) {
            bladeSections.add(tile.lightSection);
        }
    }

    /**
     * How a blade rail bends along its stretch (SPEC §2.2 v1, {@link SwitchThroat}):
     * at each station, {@code d} from the tip, its section is cut back to
     * clear the stock rail that is {@code separation} away, moved
     * {@code open} × {@link SwitchThroat#BLADE_THROW} toward the track centre
     * and lowered by {@link SwitchThroat#BLADE_TIP_DROP} — the latter two
     * fading to nothing at the heel, where the blade joins its leg's rail.
     */
    private record BladeBend(int side, double gaugeFace, double length, boolean tipAtStart,
            SwitchThroat.Separation separation, double open) {

        /** Fill {cut, thrown, drop} at {@code s} into the stretch (tip first or last, as the leg runs). */
        void station(double s, double[] out, int offset) {
            double d = tipAtStart ? s : length - s;
            double fade = SwitchThroat.fade(d, length);
            out[offset] = SwitchThroat.cut(gaugeFace, separation.at(d));
            out[offset + 1] = SwitchThroat.BLADE_THROW * open * fade;
            out[offset + 2] = SwitchThroat.BLADE_TIP_DROP * fade;
        }
    }

    /**
     * A contiguous stretch {@code [from, to]} of another path, re-parametrized
     * from zero — lets the sweep lay a switch throat's blade stretch apart.
     */
    private record SubPath(TrackPath inner, double from, double to) implements TrackPath {

        @Override
        public double length() {
            return to - from;
        }

        @Override
        public Vector3d samplePosition(double s) {
            return inner.samplePosition(from + s);
        }

        @Override
        public Vector3d sampleTangent(double s) {
            return inner.sampleTangent(from + s);
        }
    }

    /**
     * A chunk section's light changed on the client (called from the light
     * mixins, on the render thread — where vanilla's light engine and packet
     * handling run). Cheap and frequent — every light change and every
     * streamed chunk ends up here — so it only flags sections that actually
     * hold rail tiles; {@link #relightDirtySections} does the work in the
     * next rail pass.
     */
    public static void onSectionLightChanged(int sectionX, int sectionY, int sectionZ) {
        long key = SectionPos.asLong(sectionX, sectionY, sectionZ);
        if (tilesBySection.containsKey(key) || bladeSections.contains(key)) {
            lightDirty.add(key);
        }
    }

    /**
     * Re-sample the tiles of light-changed sections, up to
     * {@link #LIGHT_TILE_BUDGET} this frame. A tile whose value actually
     * changed marks its region dirty for a re-upload within the bake budget —
     * a torch costs one small region, not the whole network, and the old mesh
     * stays on screen until then. No geometry is touched.
     */
    private static void relightDirtySections(ClientLevel level) {
        if (lightDirty.isEmpty()) {
            return;
        }
        int budget = LIGHT_TILE_BUDGET;
        boolean blades = false;
        Iterator<Long> it = lightDirty.iterator();
        while (budget > 0 && it.hasNext()) {
            long section = it.next();
            it.remove();
            blades |= bladeSections.contains(section);
            List<Tile> tiles = tilesBySection.get(section);
            if (tiles == null) {
                continue; // the segment went away since it was flagged
            }
            for (Tile tile : tiles) {
                if (refreshTile(level, tile)) {
                    Bucket bucket = buckets.get(tile.bucketKey);
                    if (bucket != null) {
                        bucket.dirty = true;
                    }
                }
            }
            budget -= tiles.size();
        }
        if (blades && refreshLight(level, bladeTiles) && bladeMeshes != null) {
            closeAll(bladeMeshes);
            bladeMeshes = null;
        }
    }

    /** Refresh {@code Tile.light} in place; true if any value changed. */
    private static boolean refreshLight(ClientLevel level, List<Tile> tiles) {
        boolean changed = false;
        for (Tile tile : tiles) {
            changed |= refreshTile(level, tile);
        }
        return changed;
    }

    /**
     * Re-sample one tile's light; true if it changed. A tile whose own chunk
     * isn't loaded keeps its last value (unless it has none yet) — "no data"
     * would read as darkness until the chunk streams in, and that arrival is
     * itself reported as a light change.
     */
    private static boolean refreshTile(ClientLevel level, Tile tile) {
        if (tile.light >= 0 && !level.hasChunk(
                SectionPos.blockToSectionCoord(tile.cx), SectionPos.blockToSectionCoord(tile.cz))) {
            return false;
        }
        int light = tileLight(level, tile);
        if (light == tile.light) {
            return false;
        }
        tile.light = light;
        return true;
    }

    /**
     * Repeat the tile along the path, bending each copy to the spline — laid
     * by the {@link TrackSweep} rules the track bed rasterizes with.
     */
    private static void sweep(TileTemplate template, TrackPath path, List<Tile> out) {
        sweep(template, path, null, out);
    }

    /** {@link #sweep(TileTemplate, TrackPath, List)} with every tile bent into a blade, unless {@code bend} is null. */
    private static void sweep(TileTemplate template, TrackPath path, BladeBend bend, List<Tile> out) {
        double length = path.length();
        if (length < 1.0e-6) {
            return;
        }
        int n = TrackSweep.tileCount(length, template.tileLength);
        double tileLen = length / n;
        for (int i = 0; i < n; i++) {
            Vector3d centre = path.samplePosition((i + 0.5) * tileLen);
            out.add(bendTile(template, i, tileLen, path, centre, bend));
        }
    }

    /** Sweep every template along the path. */
    private static void sweepAll(List<TileTemplate> templates, TrackPath path, List<Tile> out) {
        for (TileTemplate template : templates) {
            sweep(template, path, out);
        }
    }

    /** Light0/Light1 of {@code Lighting.setupLevel}, normalized. */
    private static final float[] DIFFUSE_LIGHT_0 = {0.16169F, 0.80845F, -0.56592F};
    private static final float[] DIFFUSE_LIGHT_1 = {-0.16169F, 0.80845F, 0.56592F};

    /**
     * The entity shader's {@code minecraft_mix_light} factor, baked at build
     * time: the terrain shader the rails draw with ignores normals (vanilla
     * bakes terrain shade the same way), so without this the rails would lose
     * the shading an entity shader would give them from the normals.
     */
    private static float diffuseShade(float nx, float ny, float nz) {
        float light0 = Math.max(0.0F,
                DIFFUSE_LIGHT_0[0] * nx + DIFFUSE_LIGHT_0[1] * ny + DIFFUSE_LIGHT_0[2] * nz);
        float light1 = Math.max(0.0F,
                DIFFUSE_LIGHT_1[0] * nx + DIFFUSE_LIGHT_1[1] * ny + DIFFUSE_LIGHT_1[2] * nz);
        return Math.min(1.0F, (light0 + light1) * 0.6F + 0.4F);
    }

    /**
     * Bend one copy of the tile onto the spline at tile index {@code i}: each
     * template station (local <b>X</b>, the rails' length) picks a distance
     * {@code s} along the path and gets the path frame there; a vertex's
     * local Z rides the frame's right axis (gauge) and local Y its up axis;
     * the normal is rotated into the same frame (local X→forward, Z→right,
     * Y→up). Diffuse shade is taken from each quad's first corner, as the
     * per-quad shading always was. A {@code bend} (a switch blade's rail)
     * reshapes each vertex's across and height at its station first.
     */
    private static Tile bendTile(TileTemplate t, int tileIndex, double tileLen, TrackPath path,
            Vector3d centre, BladeBend bend) {
        int stations = t.stations.length;
        double[] frame = new double[stations * TrackSweep.FRAME_STRIDE]; // pos, fwd, right, up
        double[] blade = bend == null ? null : new double[stations * 3]; // cut, thrown, drop
        for (int k = 0; k < stations; k++) {
            double s = (tileIndex + t.stations[k]) * tileLen;
            TrackSweep.frame(path, s, frame, k * TrackSweep.FRAME_STRIDE);
            if (bend != null) {
                bend.station(s, blade, k * 3);
            }
        }
        int n = t.vertexCount;
        float[] xyz = new float[n * 3];
        float[] normals = new float[n * 3];
        for (int i = 0; i < n; i++) {
            int o = t.station[i] * TrackSweep.FRAME_STRIDE;
            double across = t.z[i]; // local Z is the cross-track (gauge) axis
            double height = t.y[i] + TrackSweep.RAIL_Y_OFFSET;
            if (bend != null) {
                int b = t.station[i] * 3;
                across = SwitchThroat.bladeAcross(across, bend.side(), blade[b], blade[b + 1]);
                height -= blade[b + 2];
            }
            xyz[i * 3] = (float) (frame[o] + frame[o + 6] * across + frame[o + 9] * height);
            xyz[i * 3 + 1] = (float) (frame[o + 1] + frame[o + 7] * across + frame[o + 10] * height);
            xyz[i * 3 + 2] = (float) (frame[o + 2] + frame[o + 8] * across + frame[o + 11] * height);
            normals[i * 3] = (float) (frame[o + 3] * t.nx[i] + frame[o + 6] * t.nz[i] + frame[o + 9] * t.ny[i]);
            normals[i * 3 + 1] = (float) (frame[o + 4] * t.nx[i] + frame[o + 7] * t.nz[i] + frame[o + 10] * t.ny[i]);
            normals[i * 3 + 2] = (float) (frame[o + 5] * t.nx[i] + frame[o + 8] * t.nz[i] + frame[o + 11] * t.ny[i]);
        }
        int[] normalShade = new int[n];
        for (int i = 0; i < n; i++) {
            int src = t.shadeFrom[i] * 3;
            float shade = diffuseShade(normals[src], normals[src + 1], normals[src + 2]);
            normalShade[i] = packNormal(normals[i * 3]) | packNormal(normals[i * 3 + 1]) << 8
                    | packNormal(normals[i * 3 + 2]) << 16 | Math.round(shade * 255.0F) << 24;
        }
        return new Tile(t, xyz, normalShade, centre);
    }

    /** One normal component as a signed byte, quantized like BufferBuilder's. */
    private static int packNormal(float component) {
        return (int) (Math.clamp(component, -1.0F, 1.0F) * 127.0F) & 0xFF;
    }
}
