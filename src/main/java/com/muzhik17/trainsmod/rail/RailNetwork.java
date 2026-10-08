package com.muzhik17.trainsmod.rail;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.network.RailGraphSyncPayload;
import com.muzhik17.trainsmod.path.HermiteSegment;
import com.muzhik17.trainsmod.path.HermiteSegmentPath;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailNode;
import com.muzhik17.trainsmod.path.RailSegment;

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
 * <p>{@code revision} increments on every edit — consists and clients use it
 * to know when to rebuild their materialized paths.
 */
public final class RailNetwork extends SavedData {

    private static final String DATA_NAME = RailsWheelsAndTrains.MODID + "_rails";
    /**
     * Half-width of the strip the bed must fully cover (SPEC 0.3): the rail
     * model's widest part — the sleeper ends — reaches ±1.3125 from the path
     * axis (measured from rail.obj). The excess (0.1625 ≈ 2.6px) is the
     * guaranteed gravel shoulder beyond the sleeper end: wherever the sleeper
     * lands closer than that to a cell border, the neighbouring cell joins the
     * bed. Kept under 1.5 so an axis-aligned straight (its spline runs through
     * cell centres) still lays exactly 3 cells wide.
     */
    private static final double BED_HALF_WIDTH = 1.49;
    /**
     * Step along the path when rasterizing the bed strip. Must be small: a cell
     * whose corner the strip edge clips <em>between</em> two consecutive steps
     * is never filled, and a missed clip of chord {@code c} can eat up to
     * {@code ~c/2} of the shoulder — at 0.25 that zeroed the margin in spots
     * on curves (sleeper flush with the bed edge). At 0.05 the worst residual
     * loss is ~0.025. Placement-time only, so the cost is irrelevant.
     */
    private static final double BED_SAMPLE_STEP = 0.05;
    /** Across-the-path sample count per side; spacing stays well under a cell. */
    private static final int BED_ACROSS_SAMPLES = 6;

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
        RailSegment created = graph.createSegment(a, dirA, forceA, b, dirB, forceB);
        graph.setSegmentStyle(created.id(), style);
        RailSegment segment = graph.segment(created.id());
        placeBed(level, segment);
        markChanged(level);
        return segment;
    }

    /**
     * Redraw the structure whose bed occupies {@code cell} in rail
     * {@code style} (the whole click-built structure, like demolition);
     * returns the structure's segment count, 0 if the cell is no track.
     */
    public int restyleStructureAt(ServerLevel level, BlockPos cell, String style) {
        for (RailSegment segment : graph.segments()) {
            if (bedCells(segment).containsKey(cell)) {
                List<RailSegment> structure = graph.structureOf(segment);
                for (RailSegment member : structure) {
                    graph.setSegmentStyle(member.id(), style);
                }
                markChanged(level);
                return structure.size();
            }
        }
        return 0;
    }

    /** Redraw every segment of this dimension in rail {@code style}; returns the count. */
    public int restyleAll(ServerLevel level, String style) {
        List<Integer> ids = graph.segments().stream().map(RailSegment::id).toList();
        for (int id : ids) {
            graph.setSegmentStyle(id, style);
        }
        if (!ids.isEmpty()) {
            markChanged(level);
        }
        return ids.size();
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
        for (RailSegment segment : graph.segments()) {
            if (bedCells(segment).containsKey(cell)) {
                removeStructure(level, segment);
                return segment;
            }
        }
        return null;
    }

    /**
     * Remove a segment's whole structure (SPEC §2.2: segments built by one
     * click are one element) and its bed — except the cells still under the
     * surviving segments, so demolishing one track at a joint or a flat
     * crossing no longer bites holes into the neighbour's bed.
     */
    private void removeStructure(ServerLevel level, RailSegment segment) {
        LinkedHashSet<BlockPos> cells = new LinkedHashSet<>();
        for (RailSegment doomed : graph.structureOf(segment)) {
            cells.addAll(bedCells(doomed).keySet());
            graph.removeSegment(doomed.id());
        }
        for (RailSegment survivor : graph.segments()) {
            cells.removeAll(bedCells(survivor).keySet());
        }
        for (BlockPos cell : cells) {
            if (level.getBlockState(cell).is(RailsWheelsAndTrains.TRACK_BED.get())) {
                level.removeBlock(cell, false);
            }
        }
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
     * {@link TrackBedBlock#LAYERS}) per cell. The bed strip is
     * <em>rasterized</em>: marching along the curve (step {@link #BED_SAMPLE_STEP})
     * and, at each step, across it from {@code −BED_HALF_WIDTH} to
     * {@code +BED_HALF_WIDTH} inclusive ({@link #BED_ACROSS_SAMPLES} per side —
     * symmetric, so both strip edges are always sampled exactly), every sampled
     * point's cell is filled. Marking the cells the strip actually passes
     * through — rather than testing cell centres against a distance — is what
     * guarantees 100 % coverage on diagonals and curves, where the sleeper
     * ends overhang cells whose centres are outside the strip.
     *
     * <p>Height per cell follows the spline: {@code round((y − cellBase)·8)}
     * layers (clamped ≥1), so the bed top sits at the rail's foot — a thin
     * 2px frame on flat ground, stepping up on slopes without burying the
     * rail (the earlier {@code +1} base layer is what pushed it half-way up the
     * sleeper). Max over the samples touching a cell.
     */
    private Map<BlockPos, Integer> bedCells(RailSegment segment) {
        Map<BlockPos, Integer> cells = new LinkedHashMap<>();
        HermiteSegment curve = graph.hermite(segment);
        HermiteSegmentPath path = new HermiteSegmentPath(curve);
        double length = path.length();
        for (double s = 0.0; s <= length; s += BED_SAMPLE_STEP) {
            Vector3d pos = path.samplePosition(s);
            Vector3d tangent = path.sampleTangent(s);
            // horizontal forward; for a vertical tangent fall back to +X
            Vector3d fwd = new Vector3d(tangent.x, 0.0, tangent.z);
            if (fwd.lengthSquared() < 1.0e-6) {
                fwd.set(1, 0, 0);
            } else {
                fwd.normalize();
            }
            Vector3d right = new Vector3d(fwd.z, 0.0, -fwd.x); // horizontal unit perpendicular
            int cy = (int) Math.floor(pos.y);
            int layers = Math.clamp((int) Math.round((pos.y - cy) * 8.0), 1, 8);
            for (int i = -BED_ACROSS_SAMPLES; i <= BED_ACROSS_SAMPLES; i++) {
                double a = BED_HALF_WIDTH * i / BED_ACROSS_SAMPLES;
                int cx = (int) Math.floor(pos.x + right.x * a);
                int cz = (int) Math.floor(pos.z + right.z * a);
                cells.merge(new BlockPos(cx, cy, cz), layers, Math::max);
            }
        }
        return cells;
    }

    private void placeBed(ServerLevel level, RailSegment segment) {
        BlockState bed = RailsWheelsAndTrains.TRACK_BED.get().defaultBlockState();
        for (Map.Entry<BlockPos, Integer> cell : bedCells(segment).entrySet()) {
            BlockState existing = level.getBlockState(cell.getKey());
            if (existing.isAir() || existing.canBeReplaced()
                    || existing.is(RailsWheelsAndTrains.TRACK_BED.get())) {
                level.setBlock(cell.getKey(),
                        bed.setValue(TrackBedBlock.LAYERS, cell.getValue()), Block.UPDATE_ALL);
            }
        }
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
