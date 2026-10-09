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

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.network.RailGraphSyncPayload;
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
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.saveddata.SavedData;
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
     * Create a segment between two marker points, tangents from the markers'
     * directions, drawn in rail {@code style} (SPEC §6.10).
     */
    public RailSegment createSegment(ServerLevel level, Vector3d a, Vector3d dirA,
            Vector3d b, Vector3d dirB, String style) {
        return createSegment(level, a, dirA, false, b, dirB, false, style);
    }

    /**
     * Create a segment with per-end tangent forcing (diamond crossings — see
     * {@link RailGraph#createSegment(Vector3d, Vector3d, boolean, Vector3d, Vector3d, boolean)}).
     */
    public RailSegment createSegment(ServerLevel level, Vector3d a, Vector3d dirA, boolean forceA,
            Vector3d b, Vector3d dirB, boolean forceB, String style) {
        // the segments at the nodes the new one will snap to: their ends there stop being open
        List<RailSegment> neighbours = segmentsAt(graph.nodeNear(a), graph.nodeNear(b));
        Set<BlockPos> stale = laidBefore(neighbours);
        RailSegment created = graph.createSegment(a, dirA, forceA, b, dirB, forceB);
        graph.setSegmentStyle(created.id(), style);
        RailSegment segment = graph.segment(created.id());
        List<RailSegment> relaid = current(neighbours);
        relaid.add(segment);
        layBed(level, stale, relaid);
        markChanged(level);
        return segment;
    }

    /**
     * Redraw the structure whose bed occupies {@code cell} in rail
     * {@code style} (the whole click-built structure, like demolition);
     * returns the structure's segment count, 0 if the cell is no track. The
     * bed is re-laid under the new style's tile.
     */
    public int restyleStructureAt(ServerLevel level, BlockPos cell, String style) {
        RailSegment hit = segmentContaining(cell);
        if (hit == null) {
            return 0;
        }
        List<RailSegment> structure = graph.structureOf(hit);
        restyle(level, structure, style);
        return structure.size();
    }

    /** Redraw every segment of this dimension in rail {@code style}; returns the count. */
    public int restyleAll(ServerLevel level, String style) {
        List<RailSegment> all = List.copyOf(graph.segments());
        if (!all.isEmpty()) {
            restyle(level, all, style);
        }
        return all.size();
    }

    private void restyle(ServerLevel level, List<RailSegment> segments, String style) {
        Set<BlockPos> stale = laidBefore(segments);
        for (RailSegment segment : segments) {
            graph.setSegmentStyle(segment.id(), style);
        }
        layBed(level, stale, current(segments));
        markChanged(level);
    }

    /**
     * Re-lay the bed of every segment of this dimension: blocks no rail
     * touches come out, missing ones go in — for worlds whose bed was laid
     * before it followed the rails (2026-10-09), or after a pack changed a
     * style's tile. Returns the segment count. Loads every chunk the network
     * crosses.
     */
    public int rebed(ServerLevel level) {
        List<RailSegment> all = List.copyOf(graph.segments());
        layBed(level, laidBefore(all), all);
        return all.size();
    }

    /**
     * Mark segments built by one click as one structure (a switch, a crossing):
     * breaking any of its bed blocks demolishes the whole structure.
     */
    public void groupSegments(ServerLevel level, List<RailSegment> built) {
        if (built.size() < 2) {
            return;
        }
        int group = graph.newGroupId();
        for (RailSegment segment : built) {
            graph.setSegmentGroup(segment.id(), group);
        }
        markChanged(level);
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
     * Bring the bed in line with the graph after an edit: {@code segments} are
     * those whose bed may have changed (as they are now), {@code stale} every
     * block they — or the segments the edit removed — held bed in before. A
     * cell gets the most layers any segment under it needs (other segments
     * sharing the cells count too, so a joint or a crossing keeps what the
     * neighbour needs); stale cells no segment wants any more lose their bed.
     */
    private void layBed(ServerLevel level, Set<BlockPos> stale, Collection<RailSegment> segments) {
        Map<BlockPos, Integer> wanted = new LinkedHashMap<>();
        Set<Integer> ids = new HashSet<>();
        for (RailSegment segment : segments) {
            ids.add(segment.id());
            bedCells(segment).forEach((cell, layers) -> wanted.merge(cell, layers, Math::max));
        }
        Set<BlockPos> affected = new HashSet<>(stale);
        affected.addAll(wanted.keySet());
        claims(affected, ids).forEach((cell, layers) -> wanted.merge(cell, layers, Math::max));
        BlockState bed = RailsWheelsAndTrains.TRACK_BED.get().defaultBlockState();
        for (BlockPos cell : stale) {
            if (!wanted.containsKey(cell) && level.getBlockState(cell).is(RailsWheelsAndTrains.TRACK_BED.get())) {
                level.removeBlock(cell, false);
            }
        }
        for (Map.Entry<BlockPos, Integer> cell : wanted.entrySet()) {
            BlockState existing = level.getBlockState(cell.getKey());
            BlockState laid = bed.setValue(TrackBedBlock.LAYERS, cell.getValue());
            if (existing != laid && (existing.isAir() || existing.canBeReplaced()
                    || existing.is(RailsWheelsAndTrains.TRACK_BED.get()))) {
                level.setBlock(cell.getKey(), laid, Block.UPDATE_ALL);
            }
        }
    }

    /**
     * The bed the segments other than {@code excluded} want among
     * {@code cells}, with their layers. Only segments whose
     * {@linkplain #bounds bounds} overlap the cells are rasterized, and of
     * those only the tiles reaching the cells' columns.
     */
    private Map<BlockPos, Integer> claims(Set<BlockPos> cells, Set<Integer> excluded) {
        Map<BlockPos, Integer> claimed = new HashMap<>();
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
            bedCells(segment, area).forEach((cell, layers) -> {
                if (cells.contains(cell)) {
                    claimed.merge(cell, layers, Math::max);
                }
            });
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
                    segmentTag.getInt("Group"), segmentTag.getString("Style")));
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
