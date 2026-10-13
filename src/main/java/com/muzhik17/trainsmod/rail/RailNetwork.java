package com.muzhik17.trainsmod.rail;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

import org.joml.Vector3d;
import org.joml.Vector3f;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.ServerConfig;
import com.muzhik17.trainsmod.network.RailGraphSyncPayload;
import com.muzhik17.trainsmod.path.BedClearing;
import com.muzhik17.trainsmod.path.BedRaster;
import com.muzhik17.trainsmod.path.HermiteSegment;
import com.muzhik17.trainsmod.path.HermiteSegmentPath;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailNode;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.path.TileFootprint;
import com.muzhik17.trainsmod.path.TrackSweep;

import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.particles.DustParticleOptions;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.saveddata.SavedData;
import net.neoforged.neoforge.common.CommonHooks;
import net.neoforged.neoforge.event.level.BlockEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * SavedData wrapper around the pure {@link RailGraph}: persistence, client
 * sync and world side effects (track bed collision blocks, SPEC §2.2/0.3).
 * The graph in here is the source of truth; bed blocks are dumb.
 *
 * <p>The bed under a segment is exactly the blocks its drawn rails touch
 * ({@link BedRaster} over the segment's style tile, {@link RailFootprints}).
 * That depends on more than the segment: an open end carries the rails half
 * a block further, and the ends' state sets how the tiles fall along the
 * whole segment — so every edit re-lays the beds it can change (the edited
 * segments and their neighbours at the shared nodes), taking out what is no
 * longer under any rail and laying what now is.
 *
 * <p>{@code revision} increments on every edit — consists and clients use it
 * to know when to rebuild their materialized paths.
 */
public final class RailNetwork extends SavedData {

    private static final String DATA_NAME = RailsWheelsAndTrains.MODID + "_rails";

    private final RailGraph graph = new RailGraph();
    /** Placed rail markers awaiting connection: position → {@link RailMarkerBlock#ROTATION}. */
    private final Map<BlockPos, Integer> markers = new LinkedHashMap<>();
    /**
     * Switch stands (SPEC §2.2 v1): the cell a switch marker occupied before
     * the junction consumed it → the junction node it controls. A redstone
     * signal into that cell (or into the bed cell below — e.g. a lever on the
     * bed) toggles the node's switch selection.
     */
    private final Map<BlockPos, Integer> switchStands = new LinkedHashMap<>();
    /** Last polled power per stand, for rising-edge detection. Transient. */
    private final Map<BlockPos, Boolean> standPowered = new LinkedHashMap<>();
    private int revision = 1;

    public static RailNetwork get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(
                new SavedData.Factory<>(RailNetwork::new, RailNetwork::load), DATA_NAME);
    }

    public RailGraph graph() {
        return graph;
    }

    public int revision() {
        return revision;
    }

    // --- editing (always through here, so blocks and clients stay in sync) ---

    /**
     * One segment of a structure to build: from marker point {@code a} to
     * {@code b}, tangent axes from the markers, with per-end axis forcing as
     * in {@link RailGraph#createSegment(Vector3d, Vector3d, boolean, Vector3d, Vector3d, boolean)}
     * (diamond crossings).
     */
    public record SegmentSpec(Vector3d a, Vector3d dirA, boolean forceA,
            Vector3d b, Vector3d dirB, boolean forceB) {

        public SegmentSpec(Vector3d a, Vector3d dirA, Vector3d b, Vector3d dirB) {
            this(a, dirA, false, b, dirB, false);
        }
    }

    /**
     * Build what one click of the rails builds (SPEC §2.2): the segments in
     * order — each end snapping to an existing node, as
     * {@link RailGraph#createSegment} does — drawn in {@code look}'s rail style
     * (SPEC §6.10) on its bed material, grouped into one structure if more
     * than one, with the {@code consumed} marker blocks taken away. The bed
     * clears its way on behalf of {@code player}: whatever stands where the
     * bed goes, or where the rails reach above it, is broken without drops
     * ({@link BedClearing}) — and, with the server's {@code clear_gauge} on,
     * everything in the loading gauge over the new segments, so a train
     * fits through a hill ({@link #gaugeCells}). If something there can't go — unbreakable, a
     * container, or not the player's to break — nothing is built or changed,
     * the player is told where, and null is returned.
     */
    public List<RailSegment> build(ServerLevel level, ServerPlayer player, List<SegmentSpec> specs,
            RailSegment.Look look, Collection<BlockPos> consumed) {
        // the segments at the nodes the new ones will snap to: their ends there stop being open
        List<RailNode> snapped = new ArrayList<>();
        for (SegmentSpec spec : specs) {
            snapped.add(graph.nodeNear(spec.a()));
            snapped.add(graph.nodeNear(spec.b()));
        }
        List<RailSegment> neighbours = segmentsAt(snapped.toArray(RailNode[]::new));
        Set<BlockPos> stale = laidBefore(neighbours);
        List<Integer> created = new ArrayList<>();
        for (SegmentSpec spec : specs) {
            RailSegment segment = graph.createSegment(spec.a(), spec.dirA(), spec.forceA(),
                    spec.b(), spec.dirB(), spec.forceB());
            graph.setSegmentLook(segment.id(), look);
            created.add(segment.id());
        }
        List<RailSegment> relaid = current(neighbours);
        for (int id : created) {
            relaid.add(graph.segment(id));
        }
        BedLayout layout = layout(stale, relaid);
        ServerConfig.Gauge gauge = ServerConfig.clearedGauge();
        Set<BlockPos> gaugeCells = gauge == null ? Set.of() : gaugeCells(created, gauge, layout);
        BedClearing.Plan clearing = planClearing(level, player, layout, new HashSet<>(consumed), gaugeCells);
        if (clearing.refused()) {
            for (int i = created.size() - 1; i >= 0; i--) {
                graph.removeSegment(created.get(i));
            }
            reportBlocked(level, player, clearing.blocked());
            return null;
        }
        for (BlockPos marker : consumed) {
            level.removeBlock(marker, false);
        }
        clearWay(level, player, clearing.removed());
        layBed(level, layout);
        List<RailSegment> built = new ArrayList<>();
        for (int id : created) {
            built.add(graph.segment(id));
        }
        if (built.size() > 1) {
            int group = graph.newGroupId();
            for (RailSegment segment : built) {
                graph.setSegmentGroup(segment.id(), group);
            }
        }
        markChanged(level);
        return built;
    }

    /**
     * Redraw the structure whose bed occupies {@code cell} in {@code look}'s
     * rail style and bed material (the whole click-built structure, like
     * demolition), on behalf of {@code player}: the bed is re-laid under the
     * new style's tile, in the new material, clearing its way as a build does.
     * Returns the structure's segment count; 0 if the cell is no track, −1 if
     * the way can't be cleared (the player is told where; nothing changed).
     */
    public int restyleStructureAt(ServerLevel level, ServerPlayer player, BlockPos cell,
            RailSegment.Look look) {
        RailSegment hit = segmentContaining(cell);
        if (hit == null) {
            return 0;
        }
        List<RailSegment> structure = graph.structureOf(hit);
        Set<BlockPos> stale = laidBefore(structure);
        for (RailSegment segment : structure) {
            graph.setSegmentLook(segment.id(), look);
        }
        BedLayout layout = layout(stale, current(structure));
        BedClearing.Plan clearing = planClearing(level, player, layout, Set.of(), Set.of());
        if (clearing.refused()) {
            for (RailSegment segment : structure) {
                graph.setSegmentLook(segment.id(), segment.look());
            }
            reportBlocked(level, player, clearing.blocked());
            return -1;
        }
        clearWay(level, player, clearing.removed());
        layBed(level, layout);
        markChanged(level);
        return structure.size();
    }

    /**
     * Redraw every segment of this dimension in rail {@code style}, beds kept;
     * returns the count. An admin command, not a build: the bed goes only
     * where it is free ({@link #layBed(ServerLevel, BedLayout)}) and nothing in
     * its way is broken — a player clears it by repainting with the rails.
     */
    public int restyleAll(ServerLevel level, String style) {
        return relookAll(level, segment -> new RailSegment.Look(style, segment.bed()));
    }

    /** Re-lay the bed of every segment of this dimension in {@code material}, styles kept; returns the count. Breaks nothing, as {@link #restyleAll}. */
    public int rebedAll(ServerLevel level, BedMaterial material) {
        return relookAll(level, segment -> new RailSegment.Look(segment.style(), material.key()));
    }

    private int relookAll(ServerLevel level, Function<RailSegment, RailSegment.Look> look) {
        List<RailSegment> all = List.copyOf(graph.segments());
        if (!all.isEmpty()) {
            relook(level, all, look);
        }
        return all.size();
    }

    private void relook(ServerLevel level, List<RailSegment> segments,
            Function<RailSegment, RailSegment.Look> look) {
        Set<BlockPos> stale = laidBefore(segments);
        for (RailSegment segment : segments) {
            graph.setSegmentLook(segment.id(), look.apply(segment));
        }
        layBed(level, stale, current(segments));
        markChanged(level);
    }

    /**
     * Re-lay the bed of every segment of this dimension: blocks no rail
     * touches come out, missing ones go in — for worlds whose bed was laid
     * before it followed the rails (2026-10-09), or after a pack changed a
     * style's tile. Returns the segment count. Loads every chunk the network
     * crosses. Breaks nothing, as {@link #restyleAll}.
     */
    public int rebed(ServerLevel level) {
        List<RailSegment> all = List.copyOf(graph.segments());
        layBed(level, laidBefore(all), all);
        return all.size();
    }

    /** Remove the structure nearest to {@code point}, or null if none in range. */
    public RailSegment removeSegmentNear(ServerLevel level, Vector3d point, double maxDist) {
        RailSegment segment = graph.segmentNear(point, maxDist);
        if (segment == null) {
            return null;
        }
        removeStructure(level, segment);
        return segment;
    }

    /**
     * Remove the structure whose bed occupies {@code cell} (one click built it,
     * one break removes it — a switch loses all its legs at once), or null if
     * the cell belongs to no segment. Exact membership test against each
     * segment's own {@link #bedCells}, no distance heuristics; at a shared
     * joint cell the first matching segment wins.
     */
    public RailSegment removeSegmentContaining(ServerLevel level, BlockPos cell) {
        RailSegment segment = segmentContaining(cell);
        if (segment != null) {
            removeStructure(level, segment);
        }
        return segment;
    }

    /**
     * Remove a segment's whole structure (SPEC §2.2: segments built by one
     * click are one element) and its bed — except the cells still under the
     * surviving segments, so demolishing one track at a joint or a flat
     * crossing doesn't bite holes into the neighbour's bed. The neighbours'
     * beds are re-laid: an end left open grows its overhang.
     */
    private void removeStructure(ServerLevel level, RailSegment segment) {
        List<RailSegment> doomed = graph.structureOf(segment);
        Set<Integer> doomedIds = new HashSet<>();
        Set<Integer> doomedNodes = new HashSet<>();
        for (RailSegment member : doomed) {
            doomedIds.add(member.id());
            doomedNodes.add(member.nodeA());
            doomedNodes.add(member.nodeB());
        }
        List<RailSegment> neighbours = new ArrayList<>();
        for (int nodeId : doomedNodes) {
            for (RailSegment other : segmentsAt(graph.node(nodeId))) {
                if (!doomedIds.contains(other.id()) && !neighbours.contains(other)) {
                    neighbours.add(other);
                }
            }
        }
        Set<BlockPos> stale = laidBefore(doomed);
        stale.addAll(laidBefore(neighbours));
        for (RailSegment member : doomed) {
            graph.removeSegment(member.id());
        }
        layBed(level, stale, current(neighbours));
        markChanged(level);
    }

    private void markChanged(ServerLevel level) {
        revision++;
        setDirty();
        PacketDistributor.sendToPlayersInDimension(level, RailGraphSyncPayload.of(this));
    }

    // --- switch stands (SPEC §2.2 v1): redstone-toggled switch state ---

    /**
     * Register the junction node at {@code nodePoint} as controlled from
     * {@code standPos} — the cell the consumed switch marker stood in. Called
     * by the junction builders right after creating the segments.
     */
    public void registerSwitchStand(BlockPos standPos, Vector3d nodePoint) {
        RailNode node = graph.nodeNear(nodePoint);
        if (node != null) {
            switchStands.put(standPos.immutable(), node.id());
            setDirty();
        }
    }

    /**
     * Poll the switch stands for redstone (called every server tick): a rising
     * edge of a signal into the stand cell — or into the cell below it, so a
     * lever on the track bed works — advances the node's switch selection by
     * one (SPEC §2.2 v1: cycle through the diverging legs). Stands whose node
     * is gone (the junction was demolished) are pruned on the way.
     */
    public void tickSwitches(ServerLevel level) {
        boolean changed = false;
        for (Iterator<Map.Entry<BlockPos, Integer>> it = switchStands.entrySet().iterator();
                it.hasNext(); ) {
            Map.Entry<BlockPos, Integer> stand = it.next();
            BlockPos pos = stand.getKey();
            if (graph.node(stand.getValue()) == null) {
                it.remove();
                standPowered.remove(pos);
                setDirty();
                continue;
            }
            boolean powered = level.hasNeighborSignal(pos) || level.hasNeighborSignal(pos.below());
            Boolean was = standPowered.put(pos, powered);
            if (was != null && !was && powered) {
                graph.setSwitchSelection(stand.getValue(),
                        graph.switchSelection(stand.getValue()) + 1);
                level.playSound(null, pos, SoundEvents.PISTON_CONTRACT,
                        SoundSource.BLOCKS, 0.4F, 0.6F);
                changed = true;
            }
        }
        if (changed) {
            markChanged(level);
        }
    }

    // --- rail markers (SPEC §2.2 UX): the server-side registry of placed marker blocks ---

    /** Reported by {@link RailMarkerBlock} on placement. */
    public void addMarker(BlockPos pos, int rotation) {
        markers.put(pos.immutable(), rotation);
        setDirty();
    }

    /** Reported by {@link RailMarkerBlock} on removal (break or consumption). */
    public void removeMarker(BlockPos pos) {
        if (markers.remove(pos) != null) {
            setDirty();
        }
    }

    /**
     * Up to {@code count} markers of one kind nearest to {@code from}
     * (excluding {@code from} itself), nearest first; {@code switchMarkers}
     * selects {@link RailSwitchMarkerBlock} vs plain {@link RailMarkerBlock}.
     * Entries whose block is gone (e.g. removed without the hook firing) are
     * pruned on the way — the world is re-checked, the registry is just an
     * index so connecting doesn't scan blocks.
     */
    public List<BlockPos> nearestMarkers(ServerLevel level, BlockPos from, double maxDist,
            boolean switchMarkers, int count) {
        record Found(BlockPos pos, double distSq) {
        }
        List<Found> found = new ArrayList<>();
        double maxDistSq = maxDist * maxDist;
        for (Iterator<BlockPos> it = markers.keySet().iterator(); it.hasNext(); ) {
            BlockPos pos = it.next();
            if (pos.equals(from)) {
                continue;
            }
            Block block = level.getBlockState(pos).getBlock();
            if (!(block instanceof RailMarkerBlock)) {
                it.remove(); // stale entry
                setDirty();
                continue;
            }
            if (block instanceof RailSwitchMarkerBlock != switchMarkers) {
                continue;
            }
            double distSq = pos.distSqr(from);
            if (distSq <= maxDistSq) {
                found.add(new Found(pos, distSq));
            }
        }
        found.sort(Comparator.comparingDouble(Found::distSq));
        return found.stream().limit(count).map(Found::pos).toList();
    }

    // --- track bed blocks (SPEC §2.2, 0.3) ---

    /**
     * Cells the segment's bed occupies, with the bed height (in 2px
     * {@link TrackBedBlock#LAYERS}) per cell: every block its drawn rails
     * touch — the segment's style tile swept the way the renderer sweeps it,
     * open-end overhangs included ({@link TrackSweep}, {@link BedRaster}).
     * {@code area} (null for all) limits the work to the tiles reaching into
     * it; only the cells in its columns are then complete.
     */
    private Map<BlockPos, Integer> bedCells(RailSegment segment, BedRaster.Area area) {
        Map<BlockPos, Integer> cells = new LinkedHashMap<>();
        BedRaster.cells(TrackSweep.path(graph, segment), RailFootprints.forStyle(segment.style()), area)
                .forEach((cell, layers) -> cells.put(new BlockPos(cell.x(), cell.y(), cell.z()), layers));
        return cells;
    }

    /** The bed under a segment, in full. */
    private Map<BlockPos, Integer> bedCells(RailSegment segment) {
        return bedCells(segment, null);
    }

    /**
     * Every block the segments may hold bed in right now, before an edit: their
     * current bed plus the strip older versions laid ({@link BedRaster#legacyStrip}),
     * so re-laying them also clears what a world built back then left.
     */
    private Set<BlockPos> laidBefore(Collection<RailSegment> segments) {
        Set<BlockPos> cells = new LinkedHashSet<>();
        for (RailSegment segment : segments) {
            cells.addAll(bedCells(segment).keySet());
            for (BedRaster.Cell cell : BedRaster.legacyStrip(new HermiteSegmentPath(graph.hermite(segment)))) {
                cells.add(new BlockPos(cell.x(), cell.y(), cell.z()));
            }
        }
        return cells;
    }

    /**
     * One cell of bed as a segment wants it: how high, in what material, and
     * which segment wants it.
     */
    private record Bed(int layers, BedMaterial material, int segment) {

        /**
         * The bed a cell two segments want gets: the taller one; at equal
         * height the older segment's — a track built onto an existing one
         * doesn't repaint the joint, and the outcome doesn't depend on order.
         */
        static Bed stronger(Bed a, Bed b) {
            if (a.layers != b.layers) {
                return a.layers > b.layers ? a : b;
            }
            return a.segment <= b.segment ? a : b;
        }

        BlockState state() {
            return RailsWheelsAndTrains.trackBed(material).defaultBlockState()
                    .setValue(TrackBedBlock.LAYERS, layers);
        }
    }

    /** Merge a segment's bed cells into {@code into}, the stronger bed winning each cell. */
    private void want(Map<BlockPos, Bed> into, RailSegment segment, BedRaster.Area area,
            Set<BlockPos> only) {
        BedMaterial material = BedMaterial.of(segment.bed());
        bedCells(segment, area).forEach((cell, layers) -> {
            if (only == null || only.contains(cell)) {
                into.merge(cell, new Bed(layers, material, segment.id()), Bed::stronger);
            }
        });
    }

    /**
     * What an edit does to the bed: {@code wanted} — the bed each cell gets;
     * {@code stale} — the cells that held bed before; {@code headroom} — the
     * cells above the edited segments' bed their rails reach into
     * ({@link BedRaster.Raster#headroom}), bed cells excluded.
     */
    private record BedLayout(Map<BlockPos, Bed> wanted, Set<BlockPos> stale, Set<BlockPos> headroom) {
    }

    /**
     * The bed after an edit: {@code segments} are those whose bed may have
     * changed (as they are now), {@code stale} every block they — or the
     * segments the edit removed — held bed in before. A cell gets the most
     * layers any segment under it needs (other segments sharing the cells
     * count too, so a joint or a crossing keeps what the neighbour needs), in
     * the material of the segment that needs them ({@link Bed#stronger});
     * stale cells no segment wants any more lose their bed.
     */
    private BedLayout layout(Set<BlockPos> stale, Collection<RailSegment> segments) {
        Map<BlockPos, Bed> wanted = new LinkedHashMap<>();
        Set<BlockPos> headroom = new LinkedHashSet<>();
        Set<Integer> ids = new HashSet<>();
        for (RailSegment segment : segments) {
            ids.add(segment.id());
            BedMaterial material = BedMaterial.of(segment.bed());
            BedRaster.Raster raster = BedRaster.raster(TrackSweep.path(graph, segment),
                    RailFootprints.forStyle(segment.style()), null);
            raster.bed().forEach((cell, layers) ->
                    wanted.merge(pos(cell), new Bed(layers, material, segment.id()), Bed::stronger));
            raster.headroom().forEach(cell -> headroom.add(pos(cell)));
        }
        Set<BlockPos> affected = new HashSet<>(stale);
        affected.addAll(wanted.keySet());
        claims(affected, ids).forEach((cell, bed) -> wanted.merge(cell, bed, Bed::stronger));
        headroom.removeAll(wanted.keySet());
        return new BedLayout(wanted, stale, headroom);
    }

    /** Bring the bed in line with the graph after an edit, without breaking anything ({@link #layout}). */
    private void layBed(ServerLevel level, Set<BlockPos> stale, Collection<RailSegment> segments) {
        layBed(level, layout(stale, segments));
    }

    /**
     * Lay out the bed: stale bed no segment wants comes out, the wanted bed
     * goes into cells that are free for it — air, replaceable (plants,
     * fluids) or bed. Anything else stays: only a player's build clears the
     * way ({@link #clearWay}).
     */
    private void layBed(ServerLevel level, BedLayout layout) {
        for (BlockPos cell : layout.stale()) {
            if (!layout.wanted().containsKey(cell) && isBed(level.getBlockState(cell))) {
                level.removeBlock(cell, false);
            }
        }
        for (Map.Entry<BlockPos, Bed> cell : layout.wanted().entrySet()) {
            BlockState existing = level.getBlockState(cell.getKey());
            BlockState laid = cell.getValue().state();
            if (existing != laid && (existing.isAir() || existing.canBeReplaced() || isBed(existing))) {
                level.setBlock(cell.getKey(), laid, Block.UPDATE_ALL);
            }
        }
    }

    // --- clearing the way (SPEC §2.2): a player's build drills through what's in it ---

    /** At most this many broken blocks show the break effect (particles, sound); the rest go quietly. */
    private static final int BREAK_EFFECTS = 32;

    /**
     * Plan clearing the way for a layout on behalf of {@code player}
     * ({@link BedClearing}): obstacles in the bed and above it — its
     * headroom, and the {@code gauge} cells if the build clears the loading
     * gauge — are to be broken, plants above it removed; unbreakable blocks,
     * containers and blocks the player may not break there refuse.
     * {@code consumed} cells (the build's own markers, removed by it) count
     * as empty. Nothing changes yet — the protection check posts a
     * {@link BlockEvent.BreakEvent} per block to be broken, as a pickaxe would.
     */
    private BedClearing.Plan planClearing(ServerLevel level, ServerPlayer player, BedLayout layout,
            Set<BlockPos> consumed, Set<BlockPos> gauge) {
        Set<BedRaster.Cell> bed = new LinkedHashSet<>();
        layout.wanted().keySet().forEach(pos -> bed.add(cell(pos)));
        Set<BedRaster.Cell> above = new LinkedHashSet<>();
        layout.headroom().forEach(pos -> above.add(cell(pos)));
        gauge.forEach(pos -> above.add(cell(pos)));
        return BedClearing.plan(bed, above,
                cell -> {
                    BlockPos pos = pos(cell);
                    return consumed.contains(pos) ? BedClearing.Occupant.EMPTY
                            : occupant(level, pos, level.getBlockState(pos));
                },
                cell -> mayBreak(level, player, pos(cell)));
    }

    /**
     * The loading gauge starts this far over the rail foot, blocks: a block the
     * foot merely grazes from below stays (no pits beside the track on a grade).
     */
    public static final double GAUGE_FLOOR = 0.25;

    /**
     * The loading gauge over newly built segments (SPEC §2.2, option
     * {@code clear_gauge}): {@link BedRaster#gauge} up to {@code gauge}'s
     * height over each segment's rail head, along the path its tile is swept
     * on — bed cells left to the bed.
     */
    private Set<BlockPos> gaugeCells(List<Integer> segments, ServerConfig.Gauge gauge, BedLayout layout) {
        Set<BlockPos> cells = new LinkedHashSet<>();
        for (int id : segments) {
            RailSegment segment = graph.segment(id);
            double top = RailFootprints.forStyle(segment.style()).top() + gauge.height();
            BedRaster.gauge(TrackSweep.path(graph, segment), gauge.halfWidth(), GAUGE_FLOOR, top)
                    .forEach(cell -> cells.add(pos(cell)));
        }
        cells.removeAll(layout.wanted().keySet());
        return cells;
    }

    /** What a block in the track's way is, as far as clearing it goes. */
    private static BedClearing.Occupant occupant(ServerLevel level, BlockPos pos, BlockState state) {
        if (state.isAir()) {
            return BedClearing.Occupant.EMPTY;
        }
        if (isBed(state)) {
            return BedClearing.Occupant.BED;
        }
        if (state.hasBlockEntity()) {
            return BedClearing.Occupant.CONTAINER;
        }
        if (state.getDestroySpeed(level, pos) < 0.0F) {
            return BedClearing.Occupant.UNBREAKABLE;
        }
        if (state.canBeReplaced()) {
            return state.getFluidState().isEmpty() ? BedClearing.Occupant.SOFT : BedClearing.Occupant.FLUID;
        }
        return BedClearing.Occupant.SOLID;
    }

    /**
     * Whether {@code player} may break the block at {@code pos}: the world lets
     * them act there (spawn protection, world border) and no handler cancels
     * the {@link BlockEvent.BreakEvent} (region protection) — the checks a
     * pickaxe goes through.
     */
    private static boolean mayBreak(ServerLevel level, ServerPlayer player, BlockPos pos) {
        if (!level.mayInteract(player, pos)) {
            return false;
        }
        GameType mode = player.gameMode.getGameModeForPlayer();
        return !CommonHooks.fireBlockBreak(level, mode, player, pos, level.getBlockState(pos)).isCanceled();
    }

    /**
     * Break what the plan removes: no drops in any game mode (SPEC §2.2 — a
     * free drill by the user's decision). A waterlogged block leaves its
     * water. Up to {@link #BREAK_EFFECTS} blocks, spread over the way, show
     * the break effect.
     */
    private static void clearWay(ServerLevel level, ServerPlayer player, List<BedRaster.Cell> removed) {
        int every = Math.max(1, (removed.size() + BREAK_EFFECTS - 1) / BREAK_EFFECTS);
        for (int i = 0; i < removed.size(); i++) {
            BlockPos pos = pos(removed.get(i));
            if (i % every == 0) {
                level.destroyBlock(pos, false, player);
            } else {
                level.removeBlock(pos, false);
            }
        }
    }

    /**
     * Tell the player why the way can't be cleared, at the blocking block —
     * and mark it with a burst of red dust.
     */
    private static void reportBlocked(ServerLevel level, ServerPlayer player, BedClearing.Blocked blocked) {
        BlockPos pos = pos(blocked.cell());
        BlockState state = level.getBlockState(pos);
        String key = switch (blocked.reason()) {
            case UNBREAKABLE -> "message.railswheelsandtrains.rail.blocked.unbreakable";
            case CONTAINER -> "message.railswheelsandtrains.rail.blocked.container";
            case PROTECTED -> "message.railswheelsandtrains.rail.blocked.protected";
        };
        player.displayClientMessage(Component.translatable(key, state.getBlock().getName(),
                pos.getX(), pos.getY(), pos.getZ()), false);
        DustParticleOptions dust = new DustParticleOptions(new Vector3f(1.0F, 0.15F, 0.1F), 1.5F);
        for (int corner = 0; corner < 8; corner++) {
            level.sendParticles(player, dust, true,
                    pos.getX() + ((corner & 1) == 0 ? -0.02 : 1.02),
                    pos.getY() + ((corner & 2) == 0 ? -0.02 : 1.02),
                    pos.getZ() + ((corner & 4) == 0 ? -0.02 : 1.02), 4, 0.03, 0.03, 0.03, 0.0);
        }
        level.sendParticles(player, dust, true, pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5,
                12, 0.35, 0.35, 0.35, 0.0);
    }

    private static BlockPos pos(BedRaster.Cell cell) {
        return new BlockPos(cell.x(), cell.y(), cell.z());
    }

    private static BedRaster.Cell cell(BlockPos pos) {
        return new BedRaster.Cell(pos.getX(), pos.getY(), pos.getZ());
    }

    private static boolean isBed(BlockState state) {
        return state.getBlock() instanceof TrackBedBlock;
    }

    /**
     * The bed the segments other than {@code excluded} want among
     * {@code cells}. Only segments whose {@linkplain #bounds bounds} overlap
     * the cells are rasterized, and of those only the tiles reaching the
     * cells' columns.
     */
    private Map<BlockPos, Bed> claims(Set<BlockPos> cells, Set<Integer> excluded) {
        Map<BlockPos, Bed> claimed = new HashMap<>();
        if (cells.isEmpty()) {
            return claimed;
        }
        Set<Long> columns = new HashSet<>();
        double[] box = {Double.POSITIVE_INFINITY, Double.POSITIVE_INFINITY,
                Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY};
        for (BlockPos cell : cells) {
            columns.add(BedRaster.column(cell.getX(), cell.getZ()));
            box[0] = Math.min(box[0], cell.getX());
            box[1] = Math.min(box[1], cell.getZ());
            box[2] = Math.max(box[2], cell.getX() + 1.0);
            box[3] = Math.max(box[3], cell.getZ() + 1.0);
        }
        BedRaster.Area area = BedRaster.Area.columns(columns);
        for (RailSegment segment : graph.segments()) {
            if (excluded.contains(segment.id()) || !overlaps(bounds(segment), box)) {
                continue;
            }
            want(claimed, segment, area, cells);
        }
        return claimed;
    }

    /** The segment whose bed holds {@code cell}, or null; the first in graph order, like the old scan. */
    private RailSegment segmentContaining(BlockPos cell) {
        double[] box = {cell.getX(), cell.getZ(), cell.getX() + 1.0, cell.getZ() + 1.0};
        BedRaster.Area area = BedRaster.Area.box(cell.getX(), cell.getZ(), cell.getX(), cell.getZ());
        for (RailSegment segment : graph.segments()) {
            if (overlaps(bounds(segment), box) && bedCells(segment, area).containsKey(cell)) {
                return segment;
            }
        }
        return null;
    }

    /**
     * An XZ box {@code {minX, minZ, maxX, maxZ}} no block of the segment's bed —
     * current or {@linkplain BedRaster#legacyStrip legacy} — lies outside of:
     * the curve keeps to the hull of its Bézier control points, widened by
     * how far the tile reaches across and along it, the end overhang and a
     * block of rounding.
     */
    private double[] bounds(RailSegment segment) {
        HermiteSegment curve = graph.hermite(segment);
        Vector3d p0 = curve.start();
        Vector3d p1 = curve.end();
        Vector3d c0 = curve.startTangent().div(3.0).add(p0);
        Vector3d c1 = new Vector3d(p1).sub(curve.endTangent().div(3.0));
        TileFootprint tile = RailFootprints.forStyle(segment.style());
        double margin = Math.max(tile.reach(), BedRaster.LEGACY_HALF_WIDTH)
                + 1.5 * tile.extent() + TrackSweep.END_OVERHANG + 1.0;
        return new double[] {
                Math.min(Math.min(p0.x, c0.x), Math.min(c1.x, p1.x)) - margin,
                Math.min(Math.min(p0.z, c0.z), Math.min(c1.z, p1.z)) - margin,
                Math.max(Math.max(p0.x, c0.x), Math.max(c1.x, p1.x)) + margin,
                Math.max(Math.max(p0.z, c0.z), Math.max(c1.z, p1.z)) + margin};
    }

    private static boolean overlaps(double[] a, double[] b) {
        return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
    }

    /** The segments at the given nodes (null nodes skipped), each once. */
    private List<RailSegment> segmentsAt(RailNode... nodes) {
        List<RailSegment> found = new ArrayList<>();
        for (RailNode node : nodes) {
            if (node == null) {
                continue;
            }
            for (int id : node.segments()) {
                RailSegment segment = graph.segment(id);
                if (segment != null && !found.contains(segment)) {
                    found.add(segment);
                }
            }
        }
        return found;
    }

    /** The segments as the graph holds them now (styles may have changed), dropping removed ones. */
    private List<RailSegment> current(Collection<RailSegment> segments) {
        List<RailSegment> now = new ArrayList<>();
        for (RailSegment segment : segments) {
            RailSegment live = graph.segment(segment.id());
            if (live != null) {
                now.add(live);
            }
        }
        return now;
    }

    // --- SavedData ---

    @Override
    public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
        ListTag nodes = new ListTag();
        for (RailNode node : graph.nodes()) {
            CompoundTag nodeTag = new CompoundTag();
            nodeTag.putInt("Id", node.id());
            Vector3d position = node.position();
            nodeTag.putDouble("X", position.x);
            nodeTag.putDouble("Y", position.y);
            nodeTag.putDouble("Z", position.z);
            Vector3d direction = node.direction();
            nodeTag.putDouble("DX", direction.x);
            nodeTag.putDouble("DY", direction.y);
            nodeTag.putDouble("DZ", direction.z);
            nodes.add(nodeTag);
        }
        tag.put("Nodes", nodes);

        ListTag segments = new ListTag();
        for (RailSegment segment : graph.segments()) {
            CompoundTag segmentTag = new CompoundTag();
            segmentTag.putInt("Id", segment.id());
            segmentTag.putInt("A", segment.nodeA());
            segmentTag.putInt("SA", segment.signA());
            segmentTag.putInt("B", segment.nodeB());
            segmentTag.putInt("SB", segment.signB());
            if (segment.dirA() != null) {
                segmentTag.putDouble("DAX", segment.dirA().x);
                segmentTag.putDouble("DAY", segment.dirA().y);
                segmentTag.putDouble("DAZ", segment.dirA().z);
            }
            if (segment.dirB() != null) {
                segmentTag.putDouble("DBX", segment.dirB().x);
                segmentTag.putDouble("DBY", segment.dirB().y);
                segmentTag.putDouble("DBZ", segment.dirB().z);
            }
            if (segment.group() != 0) {
                segmentTag.putInt("Group", segment.group());
            }
            if (!segment.style().isEmpty()) {
                segmentTag.putString("Style", segment.style());
            }
            if (!segment.bed().isEmpty()) {
                segmentTag.putString("Bed", segment.bed());
            }
            segments.add(segmentTag);
        }
        tag.put("Segments", segments);

        ListTag markerList = new ListTag();
        for (Map.Entry<BlockPos, Integer> entry : markers.entrySet()) {
            CompoundTag markerTag = new CompoundTag();
            markerTag.putInt("X", entry.getKey().getX());
            markerTag.putInt("Y", entry.getKey().getY());
            markerTag.putInt("Z", entry.getKey().getZ());
            markerTag.putInt("Rot", entry.getValue());
            markerList.add(markerTag);
        }
        tag.put("Markers", markerList);

        ListTag standList = new ListTag();
        for (Map.Entry<BlockPos, Integer> entry : switchStands.entrySet()) {
            CompoundTag standTag = new CompoundTag();
            standTag.putInt("X", entry.getKey().getX());
            standTag.putInt("Y", entry.getKey().getY());
            standTag.putInt("Z", entry.getKey().getZ());
            standTag.putInt("Node", entry.getValue());
            standList.add(standTag);
        }
        tag.put("SwitchStands", standList);

        ListTag switchList = new ListTag();
        for (Map.Entry<Integer, Integer> entry : graph.switchSelections().entrySet()) {
            CompoundTag switchTag = new CompoundTag();
            switchTag.putInt("Node", entry.getKey());
            switchTag.putInt("Sel", entry.getValue());
            switchList.add(switchTag);
        }
        tag.put("Switches", switchList);
        tag.putInt("Revision", revision);
        return tag;
    }

    private static RailNetwork load(CompoundTag tag, HolderLookup.Provider registries) {
        RailNetwork network = new RailNetwork();
        for (Tag entry : tag.getList("Nodes", Tag.TAG_COMPOUND)) {
            CompoundTag nodeTag = (CompoundTag) entry;
            network.graph.putNode(new RailNode(nodeTag.getInt("Id"),
                    new Vector3d(nodeTag.getDouble("X"), nodeTag.getDouble("Y"), nodeTag.getDouble("Z")),
                    new Vector3d(nodeTag.getDouble("DX"), nodeTag.getDouble("DY"), nodeTag.getDouble("DZ"))));
        }
        for (Tag entry : tag.getList("Segments", Tag.TAG_COMPOUND)) {
            CompoundTag segmentTag = (CompoundTag) entry;
            Vector3d dirA = segmentTag.contains("DAX")
                    ? new Vector3d(segmentTag.getDouble("DAX"), segmentTag.getDouble("DAY"),
                            segmentTag.getDouble("DAZ"))
                    : null;
            Vector3d dirB = segmentTag.contains("DBX")
                    ? new Vector3d(segmentTag.getDouble("DBX"), segmentTag.getDouble("DBY"),
                            segmentTag.getDouble("DBZ"))
                    : null;
            network.graph.putSegment(new RailSegment(segmentTag.getInt("Id"),
                    segmentTag.getInt("A"), segmentTag.getInt("SA"),
                    segmentTag.getInt("B"), segmentTag.getInt("SB"), dirA, dirB,
                    segmentTag.getInt("Group"), segmentTag.getString("Style"),
                    segmentTag.getString("Bed")));
        }
        for (Tag entry : tag.getList("Markers", Tag.TAG_COMPOUND)) {
            CompoundTag markerTag = (CompoundTag) entry;
            network.markers.put(new BlockPos(markerTag.getInt("X"),
                    markerTag.getInt("Y"), markerTag.getInt("Z")), markerTag.getInt("Rot"));
        }
        for (Tag entry : tag.getList("SwitchStands", Tag.TAG_COMPOUND)) {
            CompoundTag standTag = (CompoundTag) entry;
            network.switchStands.put(new BlockPos(standTag.getInt("X"),
                    standTag.getInt("Y"), standTag.getInt("Z")), standTag.getInt("Node"));
        }
        for (Tag entry : tag.getList("Switches", Tag.TAG_COMPOUND)) {
            CompoundTag switchTag = (CompoundTag) entry;
            network.graph.setSwitchSelection(switchTag.getInt("Node"), switchTag.getInt("Sel"));
        }
        network.revision = Math.max(1, tag.getInt("Revision"));
        return network;
    }
}
