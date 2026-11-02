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
import com.muzhik17.trainsmod.client.render.TileSweeper.RailBend;
import com.muzhik17.trainsmod.client.render.TileSweeper.SubPath;
import com.muzhik17.trainsmod.client.render.TileSweeper.Template;
import com.muzhik17.trainsmod.client.render.TileSweeper.Tile;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.RailStyle;
import com.muzhik17.trainsmod.client.render.model.RailStyles;
import com.muzhik17.trainsmod.path.HermiteSegment;
import com.muzhik17.trainsmod.path.HermiteSegmentPath;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailNode;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.path.SwitchFrog;
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
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;

/**
 * Draws the rails in the world (SPEC §2.2 visual / §2.4 pipeline): the tile of
 * each segment's {@linkplain RailStyle rail style} (SPEC §6.10) is swept along
 * its spline ({@link TileSweeper}) — every tile is bent to the curve so there
 * are no gaps on bends — and baked into {@link GpuMesh}es (one per texture) per
 * {@link RailRegion 64-block region}, so a frame
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
 * <p>Switch blades are kept <b>per switch</b>, in the regions they lie in, by
 * the same visibility rules as the track, and baked into meshes of their own
 * per region: a throw re-sweeps that switch's blades each frame while they
 * move — and only while they are in view ({@link BladeAnimator}) — and
 * re-uploads just their regions' blade meshes. (They were one mesh for the
 * whole network, drawn whatever the distance and over unloaded chunks, and
 * every blade of the network was re-swept each frame any switch moved.)
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
     * set the other way ({@link SwitchThroat}); and since 2026-10-13 the frog
     * where the legs' inner rails meet ({@link SwitchFrog}). Cosmetic only — the switch
     * mechanics (state, redstone toggle, routing, train re-anchor) and the
     * track bed don't depend on it.
     */
    private static final boolean SWITCH_BLADES = true;

    /** Plain rail kept between a blade's heel and the frog's wing rails, blocks. */
    private static final double FROG_CLEARANCE = 0.5;
    /** The shortest blade a frog may leave a sharp switch; closer to the toe, no frog. */
    private static final double MIN_BLADE = 1.0;

    /**
     * Vertices baked per frame before the remaining dirty regions wait for
     * the next frame (~1600 tiles, ~4 MB). At least one region is baked every
     * frame regardless, so an oversized region still makes progress.
     */
    private static final int BAKE_VERTEX_BUDGET = 131_072;

    /**
     * One texture's share of a rail style tile as a sweep {@link Template}:
     * triangles (rail OBJs are mostly triangles, stored as degenerate quads in
     * {@link Mesh} — emitting them as triangles saves a quarter of the
     * vertices).
     */
    private static Template template(Mesh mesh, RenderType renderType, double tileLength) {
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
        int vertexCount = verts.size();
        float[] position = new float[vertexCount * 3];
        float[] normal = new float[vertexCount * 3];
        float[] uv = new float[vertexCount * 2];
        float[] rgba = new float[vertexCount * 4];
        int[] shadeFrom = new int[vertexCount];
        for (int i = 0; i < vertexCount; i++) {
            Mesh.Vertex vx = verts.get(i);
            Mesh.Quad q = owners.get(i);
            position[i * 3] = vx.x();
            position[i * 3 + 1] = vx.y();
            position[i * 3 + 2] = vx.z();
            normal[i * 3] = vx.nx();
            normal[i * 3 + 1] = vx.ny();
            normal[i * 3 + 2] = vx.nz();
            uv[i * 2] = vx.u();
            uv[i * 2 + 1] = vx.v();
            rgba[i * 4] = q.r();
            rgba[i * 4 + 1] = q.g();
            rgba[i * 4 + 2] = q.b();
            rgba[i * 4 + 3] = q.a();
            shadeFrom[i] = shadeSrc.get(i);
        }
        return new Template(renderType, tileLength, position, normal, uv, rgba, shadeFrom);
    }

    private static boolean sameCorner(Mesh.Vertex a, Mesh.Vertex b) {
        return a == b || a.equals(b);
    }

    /**
     * A rail style flattened for sweeping, one template per texture:
     * {@code full} for track; for a switch throat (SPEC §2.2 v1) the same
     * tile apart — {@code base} (all but the rail objects) and the rail
     * objects of either side, {@code plusRails}/{@code minusRails}, plus
     * those cut finer along the track ({@code plusBent}/{@code minusBent},
     * {@link #BENT_STATIONS}) for the rails a throat bends. {@code styleId}
     * is the style actually drawn ({@code ""} if not even the standard rail
     * loaded — then there is nothing to draw); {@code blades} null if its
     * switches draw as plain track.
     */
    private record StyleTemplates(String styleId, List<Template> full, List<Template> base,
            List<Template> plusRails, List<Template> minusRails,
            List<Template> plusBent, List<Template> minusBent, RailStyle.Blades blades) {

        /** The rail objects on {@code side} ({@link SwitchThroat#PLUS_Z}/{@link SwitchThroat#MINUS_Z}). */
        List<Template> rails(int side) {
            return side == SwitchThroat.PLUS_Z ? plusRails : minusRails;
        }

        /** The rail objects on {@code side}, cut finer to bend into a blade or a frog's rail. */
        List<Template> bent(int side) {
            return side == SwitchThroat.PLUS_Z ? plusBent : minusBent;
        }

        /**
         * What a leg's blade stretch draws statically: its sleepers if it
         * keeps the throat's, and the rails that aren't blades.
         */
        List<Template> throat(ThroatEnd end) {
            List<Template> out = new ArrayList<>();
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
            new StyleTemplates("", List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), null);
    /**
     * Stations per tile a bent rail is cut into, at least: a blade's point
     * and a frog's nose and wings take shape over fractions of a block, and
     * a rail modelled as a plain box (the mod's own) has stations only at
     * the tile's ends.
     */
    private static final int BENT_STATIONS = 8;
    /** Templates per loaded style (identity: a resource reload brings new style objects and clears this). */
    private static final Map<RailStyle, StyleTemplates> styleTemplates = new IdentityHashMap<>();

    /** The templates a segment of rail style {@code style} is swept with (unknown styles → standard rail). */
    private static StyleTemplates templatesFor(String style) {
        RailStyle railStyle = RailStyles.forSegment(style);
        if (railStyle == null) {
            return NO_TEMPLATES;
        }
        return styleTemplates.computeIfAbsent(railStyle, s -> {
            List<Template> full = new ArrayList<>();
            List<Template> base = new ArrayList<>();
            List<Template> plusRails = new ArrayList<>();
            List<Template> minusRails = new ArrayList<>();
            List<Template> plusBent = new ArrayList<>();
            List<Template> minusBent = new ArrayList<>();
            float[] planes = new float[BENT_STATIONS - 1];
            for (int k = 1; k < BENT_STATIONS; k++) {
                planes[k - 1] = (float) (s.tileLength() * (k / (double) BENT_STATIONS - 0.5));
            }
            for (RailStyle.Part part : s.parts()) {
                RenderType type = RwatRenderTypes.rails(part.texture());
                addTemplate(full, part.full(), type, s.tileLength());
                addTemplate(base, part.base(), type, s.tileLength());
                addTemplate(plusRails, part.plusRails(), type, s.tileLength());
                addTemplate(minusRails, part.minusRails(), type, s.tileLength());
                addTemplate(plusBent, part.plusRails().slicedAlongX(planes), type, s.tileLength());
                addTemplate(minusBent, part.minusRails().slicedAlongX(planes), type, s.tileLength());
            }
            return new StyleTemplates(s.id(), List.copyOf(full), List.copyOf(base),
                    List.copyOf(plusRails), List.copyOf(minusRails), List.copyOf(plusBent),
                    List.copyOf(minusBent), s.blades());
        });
    }

    /** A template of the mesh, unless it has no faces (a texture only the other objects use). */
    private static void addTemplate(List<Template> out, Mesh mesh, RenderType type, double tileLength) {
        if (!mesh.quads().isEmpty()) {
            out.add(template(mesh, type, tileLength));
        }
    }

    /**
     * A {@link RailRegion} with its GPU meshes (one per texture) — of the
     * static track and, apart, of the switch blades — baked lazily once the
     * region is in range (a region the player never approaches is never
     * uploaded) and freed once the player leaves it far behind.
     */
    private static final class Bucket extends RailRegion {
        List<GpuMesh> meshes;
        List<GpuMesh> bladeMeshes;
        /** {@link #cullBox()} as an AABB, null until asked for after a change. */
        private AABB cullAabb;
        // per-frame scratch for the bake ordering
        double distSq;
        boolean inView;
        /** Drawn in the last frame: in range, over a loaded chunk and in view. */
        boolean drawn;

        Bucket(long key) {
            super(key);
        }

        /** Free the GPU meshes; they are baked again when the region is next drawn. */
        void closeMeshes() {
            if (meshes != null) {
                closeAll(meshes);
                meshes = null;
                dirty = true;
            }
            if (bladeMeshes != null) {
                closeAll(bladeMeshes);
                bladeMeshes = null;
            }
        }

        AABB cullAabb() {
            if (cullAabb == null) {
                double[] box = cullBox();
                cullAabb = new AABB(box[0], box[1], box[2], box[3], box[4], box[5]);
            }
            return cullAabb;
        }

        @Override
        void boundsChanged() {
            cullAabb = null;
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
     * {@link #sweepBlades} draws those; further in, the {@code frog} (null
     * if none) bends the inner rail into a wing rail and a point rail.
     */
    private record ThroatEnd(double bladeLength, boolean sleepers, int bladeSides, SwitchFrog frog) {
    }

    /** A cached segment sweep: its key and the region buckets holding its tiles. */
    private record SegmentEntry(SegmentKey key, Set<Long> bucketKeys) {
    }

    /**
     * A blade found at layout time: the rail on {@code side} of
     * {@code segmentId}'s end at {@code nodeId}, {@code length} long, in a
     * throat of co-directional legs ({@code groupIds}, sorted — a switch's
     * diverging side); {@code separation} is how far its stock rail is from
     * it, its tip first if {@code tipAtStart}. It lies along the stretch of
     * the leg's sweep path the static sweep leaves out ({@link #bladeStretch}),
     * so the tiles line up.
     */
    private record BladeSpec(int nodeId, int segmentId, List<Integer> groupIds, int side, double length,
            SwitchThroat.Separation separation, boolean tipAtStart) {
    }

    /**
     * The blades of the switch at one node, as the last graph sync laid them
     * out: what they depend on ({@code key} — the node's throats and their
     * legs' {@link SegmentKey}s: an equal key on the next sync keeps the
     * blades as they are), the blades, the stretches they lie along (made on
     * their first sweep) and the regions holding their tiles.
     */
    private static final class NodeBlades {
        final List<Object> key;
        final List<BladeSpec> specs;
        List<TrackPath> stretches;
        Set<Long> regionKeys = Set.of();

        NodeBlades(List<Object> key, List<BladeSpec> specs) {
            this.key = key;
            this.specs = specs;
        }
    }

    /** Throat geometry of the last graph revision, by what it depends on — a switch throw reuses it all. */
    private static final Map<ThroatKey, ThroatGeometry> throatCache = new HashMap<>();
    /** Scratch: the throats of the revision being laid out. */
    private static final Map<ThroatKey, ThroatGeometry> liveThroats = new HashMap<>();
    /** Scratch: the blades of the revision being laid out, by node, and the throats they belong to. */
    private static final Map<Integer, List<BladeSpec>> liveBlades = new HashMap<>();
    private static final Map<Integer, List<ThroatKey>> liveBladeThroats = new HashMap<>();
    /** Region buckets by {@link RailRegion#key}. */
    private static final Map<Long, Bucket> buckets = new HashMap<>();
    /** Segment id → its cached sweep (the tiles live in {@link #buckets}). */
    private static final Map<Integer, SegmentEntry> segmentCache = new HashMap<>();
    /** Static tiles by the section their light is sampled in — the relight index. */
    private static final Map<Long, List<Tile>> tilesBySection = new HashMap<>();
    /** Blade tiles by the section their light is sampled in. */
    private static final Map<Long, List<Tile>> bladeTilesBySection = new HashMap<>();
    /** Light-changed sections holding rail tiles, waiting to be re-sampled (FIFO). */
    private static final Set<Long> lightDirty = new LinkedHashSet<>();
    /** Switch node → its blades (the tiles live in {@link #buckets}). */
    private static final Map<Integer, NodeBlades> nodeBlades = new HashMap<>();
    private static final BladeAnimator animator = new BladeAnimator();
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
        if (cachedGeneration != ClientRailGraph.generation()) {
            if (SWITCH_BLADES) {
                animator.adopt(graph.switchSelections(), now, cachedGeneration == -1);
            }
            syncSegments(graph, now);
            cachedGeneration = ClientRailGraph.generation();
        }
        relightDirtySections(level);
        // the blades of the switches being thrown, and of those whose throw just ended (BladeAnimator)
        for (int nodeId : animator.due(now, RailRenderer::bladesDrawn)) {
            NodeBlades blades = nodeBlades.get(nodeId);
            if (blades != null) {
                sweepBlades(graph, nodeId, blades, now);
            }
        }
        if (buckets.isEmpty()) {
            return;
        }
        drawTerrainPath(event, level);
    }

    /** Whether any region holding the blades of the switch at {@code nodeId} was drawn in the last frame. */
    private static boolean bladesDrawn(int nodeId) {
        NodeBlades blades = nodeBlades.get(nodeId);
        if (blades == null) {
            return false;
        }
        for (long key : blades.regionKeys) {
            Bucket bucket = buckets.get(key);
            if (bucket != null && bucket.drawn) {
                return true;
            }
        }
        return false;
    }

    /**
     * Terrain shader, diffuse baked in, ChunkOffset = −camera for fog. Picks
     * the regions in range (render distance, loaded centre chunk), re-bakes
     * the stale ones within the frame budget — visible and nearest first —
     * and draws those in the view frustum, their switch blades with them
     * (re-baked at once when stale: a throw moves them every frame, and a
     * region's blades are a sliver of its track).
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
            bucket.drawn = false;
            double dx = Math.max(0.0, Math.max(bucket.minX - cam.x, cam.x - bucket.maxX));
            double dz = Math.max(0.0, Math.max(bucket.minZ - cam.z, cam.z - bucket.maxZ));
            double distSq = dx * dx + dz * dz;
            if (distSq > limit * limit || !centreChunkLoaded(level, bucket)) {
                // free the GPU memory of regions left far behind
                if (distSq > evict * evict) {
                    bucket.closeMeshes();
                }
                continue;
            }
            bucket.distSq = distSq;
            bucket.inView = frustum == null || frustum.isVisible(bucket.cullAabb());
            bucket.drawn = bucket.inView;
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
            if (!bucket.inView) {
                continue;
            }
            if (bucket.meshes != null) {
                for (GpuMesh mesh : bucket.meshes) {
                    BATCH.add(mesh, pose, offX, offY, offZ);
                }
            }
            if (bucket.bladesDirty || bucket.bladeMeshes == null && bucket.hasBlades()) {
                bakeBlades(level, bucket);
            }
            if (bucket.bladeMeshes != null) {
                for (GpuMesh mesh : bucket.bladeMeshes) {
                    BATCH.add(mesh, pose, offX, offY, offZ);
                }
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
        List<Tile> tiles = bucket.tiles();
        refreshLight(level, tiles);
        List<GpuMesh> baked = uploadByTexture(tiles);
        if (bucket.meshes != null) {
            closeAll(bucket.meshes);
        }
        bucket.meshes = baked;
        bucket.dirty = false;
    }

    /** (Re-)upload one bucket's blade meshes, light re-sampled first as in {@link #bakeBucket}. */
    private static void bakeBlades(ClientLevel level, Bucket bucket) {
        List<Tile> tiles = bucket.bladeTiles();
        refreshLight(level, tiles);
        List<GpuMesh> baked = uploadByTexture(tiles);
        if (bucket.bladeMeshes != null) {
            closeAll(bucket.bladeMeshes);
        }
        bucket.bladeMeshes = baked;
        bucket.bladesDirty = false;
    }

    /** Upload tiles as one terrain-shader GPU mesh per texture (render type). */
    private static List<GpuMesh> uploadByTexture(List<Tile> tiles) {
        Map<RenderType, List<Tile>> byType = new LinkedHashMap<>();
        for (Tile tile : tiles) {
            byType.computeIfAbsent((RenderType) tile.template.renderType, t -> new ArrayList<>()).add(tile);
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
            Template t = tile.template;
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

    /** Drop the cached geometry and animation state (e.g. on logout). */
    public static void clear() {
        for (Bucket bucket : buckets.values()) {
            bucket.closeMeshes();
        }
        buckets.clear();
        segmentCache.clear();
        tilesBySection.clear();
        bladeTilesBySection.clear();
        lightDirty.clear();
        nodeBlades.clear();
        animator.clear();
        styleTemplates.clear();
        throatCache.clear();
        cachedGeneration = -1;
        cachedLevel = null;
    }

    /** World light sampled one block above a tile's centre. */
    private static int tileLight(ClientLevel level, Tile tile) {
        return LevelRenderer.getLightColor(level,
                BlockPos.containing(tile.cx, tile.cy + 1.0, tile.cz));
    }

    /** {@link SectionPos#asLong} of the section a tile's light is sampled in ({@link #tileLight}). */
    private static long lightSection(Tile tile) {
        return SectionPos.asLong(SectionPos.blockToSectionCoord(tile.cx),
                SectionPos.blockToSectionCoord(tile.cy + 1.0), SectionPos.blockToSectionCoord(tile.cz));
    }

    /**
     * Bring the cached segment sweeps in line with a new graph: segments
     * whose {@link SegmentKey} is unchanged keep their tiles (and their
     * regions' GPU meshes stay clean); changed and new segments are re-swept,
     * removed ones dropped — only the regions they touch go dirty. The
     * switch throats are laid out first ({@link #throats}): their blade rails
     * are left out of the static sweep and recorded as {@link BladeSpec}s,
     * per switch — {@link #syncBlades} sweeps those of the switches whose
     * blades changed, and only those. A switch throw changes no geometry:
     * nothing is swept here, its blades move frame by frame (the
     * {@link BladeAnimator}).
     */
    private static void syncSegments(RailGraph graph, long now) {
        Map<Long, ThroatEnd> throats = SWITCH_BLADES ? throats(graph) : Map.of();
        Map<Integer, SegmentKey> keys = new HashMap<>();
        for (RailSegment segment : graph.segments()) {
            HermiteSegment curve = graph.hermite(segment);
            StyleTemplates templates = templatesFor(segment.style());
            SegmentKey key = new SegmentKey(
                    curve.start(), curve.startTangent(), curve.end(), curve.endTangent(),
                    graph.overhangAt(segment, segment.nodeA()),
                    graph.overhangAt(segment, segment.nodeB()),
                    throats.get(endKey(segment.id(), true)), throats.get(endKey(segment.id(), false)),
                    templates.styleId());
            keys.put(segment.id(), key);
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
            if (keys.containsKey(entry.getKey())) {
                return false;
            }
            evictSegment(entry.getKey(), entry.getValue());
            return true;
        });
        syncBlades(graph, keys, now);
    }

    /**
     * Bring the switches' blades in line with the throats just laid out: a
     * switch whose blades depend on what they did before — the same throats,
     * their legs swept the same ({@link NodeBlades#key}) — keeps its tiles; a
     * new or changed one is swept, at its throw's current point; one gone is
     * dropped.
     */
    private static void syncBlades(RailGraph graph, Map<Integer, SegmentKey> keys, long now) {
        for (Map.Entry<Integer, List<BladeSpec>> entry : liveBlades.entrySet()) {
            int nodeId = entry.getKey();
            List<Object> key = new ArrayList<>(liveBladeThroats.get(nodeId));
            for (BladeSpec spec : entry.getValue()) {
                key.add(keys.get(spec.segmentId()));
            }
            NodeBlades cached = nodeBlades.get(nodeId);
            if (cached != null && cached.key.equals(key)) {
                continue;
            }
            if (cached != null) {
                evictBlades(nodeId, cached);
            }
            NodeBlades blades = new NodeBlades(key, entry.getValue());
            nodeBlades.put(nodeId, blades);
            sweepBlades(graph, nodeId, blades, now);
        }
        nodeBlades.entrySet().removeIf(entry -> {
            if (liveBlades.containsKey(entry.getKey())) {
                return false;
            }
            evictBlades(entry.getKey(), entry.getValue());
            return true;
        });
        liveBlades.clear();
        liveBladeThroats.clear();
    }

    /**
     * Lay out the switch throats (SPEC §2.2 v1): every cluster of
     * co-directional segment ends at a node ({@link #bladeCluster}) whose
     * legs all draw in a style with blades gets its {@link SwitchThroat} —
     * per leg end the static sweep's treatment (returned, by
     * {@link #endKey}) and per blade a {@link BladeSpec}. A throat with a leg
     * in a style without blades stays plain track: its rail objects aren't
     * the running rails, and nothing else may be bent. A two-legged throat
     * gets its frog too, unless that runs into what the legs' far ends hold
     * (another switch's blades or frog).
     */
    private static Map<Long, ThroatEnd> throats(RailGraph graph) {
        List<ThroatPlan> plans = new ArrayList<>();
        Map<Long, ThroatPlan> planOfEnd = new HashMap<>();
        for (RailNode node : graph.nodes()) {
            Set<List<Integer>> seen = new HashSet<>();
            for (int segmentId : node.segments()) {
                List<Integer> cluster = bladeCluster(graph, graph.segment(segmentId), node.id());
                if (cluster == null || !seen.add(cluster) || !bladed(graph, cluster)) {
                    continue;
                }
                ThroatKey throatKey = ThroatKey.of(graph, node.id(), cluster);
                ThroatGeometry geometry = throatCache.get(throatKey);
                if (geometry == null) {
                    SwitchThroat throat = SwitchThroat.of(graph, node.id(), cluster);
                    int sleeperLeg = throat.sleeperLeg();
                    geometry = new ThroatGeometry(throat, sleeperLeg, frogs(graph, throat, sleeperLeg),
                            new HashMap<>());
                }
                liveThroats.put(throatKey, geometry);
                SwitchThroat throat = geometry.throat();
                ThroatPlan plan = new ThroatPlan(node.id(), cluster, throat, geometry.sleeperLeg(),
                        new HashMap<>(geometry.frogs()), throatKey, geometry);
                plans.add(plan);
                for (int legId : cluster) {
                    planOfEnd.put(endKey(legId, throat.atStart(legId)), plan);
                }
            }
        }
        // a leg with a switch at either end: what each end draws must not meet
        boolean dropped = true;
        while (dropped) {
            dropped = false;
            for (ThroatPlan plan : plans) {
                if (plan.frogs().isEmpty()) {
                    continue;
                }
                for (int legId : plan.cluster()) {
                    ThroatPlan far = planOfEnd.get(endKey(legId, !plan.throat().atStart(legId)));
                    if (far != null && plan.extent(legId) + far.extent(legId)
                            > plan.throat().legLength(legId) - FROG_CLEARANCE) {
                        plan.frogs().clear();
                        dropped = true;
                        break;
                    }
                }
            }
        }
        Map<Long, ThroatEnd> ends = new HashMap<>();
        for (ThroatPlan plan : plans) {
            SwitchThroat throat = plan.throat();
            List<BladeSpec> blades = liveBlades.computeIfAbsent(plan.nodeId(), k -> new ArrayList<>());
            liveBladeThroats.computeIfAbsent(plan.nodeId(), k -> new ArrayList<>()).add(plan.key());
            for (int legId : plan.cluster()) {
                int sides = throat.bladeSides(legId);
                SwitchFrog frog = plan.frogs().get(legId);
                double length = frog == null ? throat.bladeLength(legId)
                        : Math.min(throat.bladeLength(legId), frog.start() - FROG_CLEARANCE);
                boolean atStart = throat.atStart(legId);
                ends.put(endKey(legId, atStart), new ThroatEnd(length, legId == plan.sleeperLeg(), sides, frog));
                for (int side : new int[] {SwitchThroat.PLUS_Z, SwitchThroat.MINUS_Z}) {
                    if ((sides & side) != 0) {
                        blades.add(new BladeSpec(plan.nodeId(), legId, plan.cluster(), side, length,
                                plan.geometry().separation(legId, side, length), atStart));
                    }
                }
            }
        }
        throatCache.clear();
        throatCache.putAll(liveThroats);
        liveThroats.clear();
        return ends;
    }

    /**
     * What a throat's geometry depends on: its node, and its legs' curves and
     * styles. The same key on the next graph revision (a switch thrown,
     * track built elsewhere) reuses the computed {@link ThroatGeometry}.
     */
    private record ThroatKey(int nodeId, List<Object> legs) {

        static ThroatKey of(RailGraph graph, int nodeId, List<Integer> cluster) {
            List<Object> legs = new ArrayList<>();
            for (int legId : cluster) {
                RailSegment segment = graph.segment(legId);
                HermiteSegment curve = graph.hermite(segment);
                legs.add(List.of(legId, curve.start(), curve.startTangent(), curve.end(), curve.endTangent(),
                        segment.style()));
            }
            return new ThroatKey(nodeId, legs);
        }
    }

    /** A throat's computed geometry: the throat, its sleeper leg, its frogs, its blades' separations. */
    private record ThroatGeometry(SwitchThroat throat, int sleeperLeg, Map<Integer, SwitchFrog> frogs,
            Map<List<Object>, SwitchThroat.Separation> separations) {

        SwitchThroat.Separation separation(int legId, int side, double length) {
            return separations.computeIfAbsent(List.of(legId, side, length),
                    k -> throat.separation(legId, side, length));
        }
    }

    /** A throat as laid out, before its ends are settled: its frogs by leg (empty: none). */
    private record ThroatPlan(int nodeId, List<Integer> cluster, SwitchThroat throat, int sleeperLeg,
            Map<Integer, SwitchFrog> frogs, ThroatKey key, ThroatGeometry geometry) {

        /** How far into leg {@code legId} from the node this throat draws its own way. */
        double extent(int legId) {
            SwitchFrog frog = frogs.get(legId);
            return frog != null ? frog.end() : throat.bladeLength(legId);
        }
    }

    /**
     * The frogs of a two-legged throat, by leg (empty if it has none): both
     * legs' or neither — one leg alone can't draw half a frog. The sleeper
     * leg's point rail makes the nose's tip. Blades end
     * {@link #FROG_CLEARANCE} before a frog's wing rails start; a frog that
     * leaves less than {@link #MIN_BLADE} of blade isn't drawn.
     */
    private static Map<Integer, SwitchFrog> frogs(RailGraph graph, SwitchThroat throat, int sleeperLeg) {
        List<Integer> legs = throat.legIds();
        if (legs.size() != 2) {
            return Map.of();
        }
        Map<Integer, SwitchFrog> frogs = new HashMap<>();
        for (int i = 0; i < 2; i++) {
            int legId = legs.get(i);
            int mateId = legs.get(1 - i);
            RailStyle.Blades own = templatesFor(graph.segment(legId).style()).blades();
            RailStyle.Blades mate = templatesFor(graph.segment(mateId).style()).blades();
            int side = throat.bladeSides(legId);
            int mateSide = throat.bladeSides(mateId);
            SwitchFrog frog = throat.frog(legId, own.profile(side), mate.profile(mateSide), legId == sleeperLeg);
            if (frog == null || frog.start() - FROG_CLEARANCE < MIN_BLADE) {
                return Map.of();
            }
            frogs.put(legId, frog);
        }
        return frogs;
    }

    /**
     * The blade stretch of a leg's sweep path: {@code bladeLength} from its
     * end at the node — past the overhang at an open toe, as
     * {@link #sweepSegment} lays it.
     */
    private static TrackPath bladeStretch(RailGraph graph, RailSegment segment, boolean atStart,
            double bladeLength) {
        HermiteSegmentPath base = new HermiteSegmentPath(graph.hermite(segment));
        boolean overhangA = graph.overhangAt(segment, segment.nodeA());
        double startOver = overhangA ? TrackSweep.END_OVERHANG : 0.0;
        TrackPath path = TrackSweep.path(base, overhangA, graph.overhangAt(segment, segment.nodeB()));
        double tip = atStart ? startOver : startOver + base.length();
        return atStart ? new SubPath(path, tip, tip + bladeLength) : new SubPath(path, tip - bladeLength, tip);
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
            TileSweeper.sweepAll(templates.full(), new SubPath(path, 0.0, startOver), swept);
            TileSweeper.sweepAll(templates.throat(key.throatA()), new SubPath(path, startOver, heel), swept);
            from = heel;
        }
        if (key.throatB() != null) {
            double tip = startOver + length;
            double heel = tip - key.throatB().bladeLength();
            TileSweeper.sweepAll(templates.throat(key.throatB()), new SubPath(path, heel, tip), swept);
            TileSweeper.sweepAll(templates.full(), new SubPath(path, tip, path.length()), swept);
            to = heel;
        }
        sweepMiddle(templates, path, from, to, startOver, length, key, swept);

        Map<Long, List<Tile>> byBucket = new HashMap<>();
        for (Tile tile : swept) {
            byBucket.computeIfAbsent(tile.regionKey, k -> new ArrayList<>()).add(tile);
            tilesBySection.computeIfAbsent(lightSection(tile), k -> new ArrayList<>()).add(tile);
        }
        for (Map.Entry<Long, List<Tile>> entry : byBucket.entrySet()) {
            buckets.computeIfAbsent(entry.getKey(), Bucket::new)
                    .put(segmentId, entry.getValue());
        }
        return new SegmentEntry(key, byBucket.keySet());
    }

    /**
     * The middle of a segment, {@code [from, to]} of its sweep path: plain
     * track — but where a throat's frog bends this leg's inner rail (SPEC
     * §2.2 v1), that rail is laid apart: plain up to the frog, the wing rail
     * and the point rail bent through it ({@link SwitchFrog}), plain again
     * after. The sleepers and the other rail stay one plain sweep, so they
     * look as they always did.
     */
    private static void sweepMiddle(StyleTemplates templates, TrackPath path, double from, double to,
            double startOver, double length, SegmentKey key, List<Tile> out) {
        SwitchFrog frogA = key.throatA() == null ? null : key.throatA().frog();
        SwitchFrog frogB = key.throatB() == null ? null : key.throatB().frog();
        if (frogA == null && frogB == null) {
            TileSweeper.sweepAll(templates.full(), new SubPath(path, from, to), out);
            return;
        }
        TileSweeper.sweepAll(templates.base(), new SubPath(path, from, to), out);
        for (int side : new int[] {SwitchThroat.PLUS_Z, SwitchThroat.MINUS_Z}) {
            double plainFrom = from;
            List<double[]> plain = new ArrayList<>();
            List<FrogBend> bends = new ArrayList<>();
            List<SubPath> bent = new ArrayList<>();
            // the frog at node A comes first along the path, node B's last (throats() keeps them apart)
            if (frogA != null && frogA.side() == side) {
                plain.add(new double[] {plainFrom, startOver + frogA.start()});
                plainFrom = startOver + frogA.pointEnd(); // the rail runs on past the V, beside the wing
                bent.add(new SubPath(path, startOver + frogA.wingStart(), startOver + frogA.wingEnd()));
                bends.add(new FrogBend(frogA, true, frogA.wingStart(), 1.0));
                bent.add(new SubPath(path, startOver + frogA.noseStart(), startOver + frogA.pointEnd()));
                bends.add(new FrogBend(frogA, false, frogA.noseStart(), 1.0));
            }
            if (frogB != null && frogB.side() == side) {
                double node = startOver + length;
                plain.add(new double[] {plainFrom, node - frogB.pointEnd()});
                plainFrom = node - frogB.start();
                bent.add(new SubPath(path, node - frogB.wingEnd(), node - frogB.wingStart()));
                bends.add(new FrogBend(frogB, true, frogB.wingEnd(), -1.0));
                bent.add(new SubPath(path, node - frogB.pointEnd(), node - frogB.noseStart()));
                bends.add(new FrogBend(frogB, false, frogB.pointEnd(), -1.0));
            }
            plain.add(new double[] {plainFrom, to});
            for (double[] piece : plain) {
                TileSweeper.sweepAll(templates.rails(side), new SubPath(path, piece[0], piece[1]), out);
            }
            for (int i = 0; i < bent.size(); i++) {
                for (Template rail : templates.bent(side)) {
                    TileSweeper.sweep(rail, bent.get(i), bends.get(i), out);
                }
            }
        }
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
            dropIfEmpty(bucket);
        }
        unindex(tilesBySection, evicted);
    }

    /** Free an emptied bucket. */
    private static void dropIfEmpty(Bucket bucket) {
        if (bucket.isEmpty()) {
            bucket.closeMeshes();
            buckets.remove(bucket.key);
        }
    }

    /** Take the tiles out of a light index. */
    private static void unindex(Map<Long, List<Tile>> index, Set<Tile> tiles) {
        Set<Long> sections = new HashSet<>();
        for (Tile tile : tiles) {
            sections.add(lightSection(tile));
        }
        for (long section : sections) {
            List<Tile> indexed = index.get(section);
            if (indexed != null && indexed.removeIf(tiles::contains) && indexed.isEmpty()) {
                index.remove(section);
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
     * Sweep the blades of the switch at {@code nodeId} against its current
     * state and file them into their regions, in place of the ones there:
     * every blade rail is swept planed against its stock rail
     * ({@link SwitchThroat}) — closed (pressed against it) on the selected
     * leg, where the route runs, thrown {@link SwitchThroat#BLADE_THROW} off
     * it at the tip on the others; during a throw, as far as the
     * {@link BladeAnimator} has it at {@code now}. Only those regions' blade
     * meshes go stale; their static track is untouched.
     */
    private static void sweepBlades(RailGraph graph, int nodeId, NodeBlades blades, long now) {
        if (blades.stretches == null) {
            List<TrackPath> stretches = new ArrayList<>();
            for (BladeSpec spec : blades.specs) {
                RailSegment segment = graph.segment(spec.segmentId());
                stretches.add(segment == null ? null
                        : bladeStretch(graph, segment, spec.tipAtStart(), spec.length()));
            }
            blades.stretches = stretches;
        }
        List<Tile> swept = new ArrayList<>();
        for (int i = 0; i < blades.specs.size(); i++) {
            BladeSpec spec = blades.specs.get(i);
            RailSegment segment = graph.segment(spec.segmentId());
            StyleTemplates templates = segment == null ? NO_TEMPLATES : templatesFor(segment.style());
            TrackPath stretch = blades.stretches.get(i);
            if (templates.blades() == null || stretch == null) {
                continue; // gone or restyled under us; the next sync drops the spec
            }
            double open = animator.open(nodeId, spec.segmentId(), spec.groupIds(), graph.switchSelection(nodeId),
                    now);
            BladeBend bend = new BladeBend(spec.side(), templates.blades().face(spec.side()), spec.length(),
                    spec.tipAtStart(), spec.separation(), open);
            for (Template rail : templates.bent(spec.side())) {
                TileSweeper.sweep(rail, stretch, bend, swept);
            }
        }
        evictBlades(nodeId, blades);
        Map<Long, List<Tile>> byBucket = new HashMap<>();
        for (Tile tile : swept) {
            byBucket.computeIfAbsent(tile.regionKey, k -> new ArrayList<>()).add(tile);
            bladeTilesBySection.computeIfAbsent(lightSection(tile), k -> new ArrayList<>()).add(tile);
        }
        for (Map.Entry<Long, List<Tile>> entry : byBucket.entrySet()) {
            buckets.computeIfAbsent(entry.getKey(), Bucket::new).putBlades(nodeId, entry.getValue());
        }
        blades.regionKeys = byBucket.keySet();
    }

    /** Take the blades of the switch at {@code nodeId} out of their buckets and the light index. */
    private static void evictBlades(int nodeId, NodeBlades blades) {
        Set<Tile> evicted = Collections.newSetFromMap(new IdentityHashMap<>());
        for (long key : blades.regionKeys) {
            Bucket bucket = buckets.get(key);
            if (bucket == null) {
                continue;
            }
            List<Tile> tiles = bucket.bladesByNode.get(nodeId);
            if (tiles != null) {
                evicted.addAll(tiles);
            }
            bucket.removeBlades(nodeId);
            dropIfEmpty(bucket);
        }
        unindex(bladeTilesBySection, evicted);
        blades.regionKeys = Set.of();
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
            SwitchThroat.Separation separation, double open) implements RailBend {

        @Override
        public void station(double s, double[] out, int offset) {
            double d = tipAtStart ? s : length - s;
            double fade = SwitchThroat.fade(d, length);
            double gap = separation.at(d);
            out[offset] = SwitchThroat.bladeFloor(gaugeFace, gap);
            out[offset + 1] = SwitchThroat.cut(gaugeFace, gap);
            out[offset + 2] = -SwitchThroat.BLADE_THROW * open * fade;
            out[offset + 3] = SwitchThroat.BLADE_TIP_DROP * fade;
        }
    }

    /**
     * How a frog's wing rail ({@code wing}) or point rail bends along its
     * stretch (SPEC §2.2 v1, {@link SwitchFrog}); the stretch starts
     * {@code dStart} from the node and runs away from it ({@code dir} 1) or
     * toward it (−1, a leg ending at the node).
     */
    private record FrogBend(SwitchFrog frog, boolean wing, double dStart, double dir) implements RailBend {

        @Override
        public int side() {
            return frog.side();
        }

        @Override
        public double gaugeFace() {
            return frog.rail().gaugeFace();
        }

        @Override
        public void station(double s, double[] out, int offset) {
            double d = dStart + dir * s;
            if (wing) {
                frog.wing(d, out, offset);
            } else {
                frog.point(d, out, offset);
            }
            out[offset + 3] = 0.0;
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
        if (tilesBySection.containsKey(key) || bladeTilesBySection.containsKey(key)) {
            lightDirty.add(key);
        }
    }

    /**
     * Re-sample the tiles of light-changed sections, up to
     * {@link #LIGHT_TILE_BUDGET} this frame. A tile whose value actually
     * changed marks its region's meshes (static or blades) dirty for a
     * re-upload — a torch costs one small region, not the whole network, and
     * the old mesh stays on screen until then. No geometry is touched.
     */
    private static void relightDirtySections(ClientLevel level) {
        if (lightDirty.isEmpty()) {
            return;
        }
        int budget = LIGHT_TILE_BUDGET;
        Iterator<Long> it = lightDirty.iterator();
        while (budget > 0 && it.hasNext()) {
            long section = it.next();
            it.remove();
            // the tiles may have gone away since the section was flagged
            budget -= relight(level, tilesBySection.get(section), false);
            budget -= relight(level, bladeTilesBySection.get(section), true);
        }
    }

    /** Re-sample the tiles (null: none), marking the regions of those that changed; how many there were. */
    private static int relight(ClientLevel level, List<Tile> tiles, boolean blades) {
        if (tiles == null) {
            return 0;
        }
        for (Tile tile : tiles) {
            if (refreshTile(level, tile)) {
                Bucket bucket = buckets.get(tile.regionKey);
                if (bucket != null && blades) {
                    bucket.bladesDirty = true;
                } else if (bucket != null) {
                    bucket.dirty = true;
                }
            }
        }
        return tiles.size();
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
}
