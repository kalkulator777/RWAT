package com.muzhik17.trainsmod.path;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.joml.Vector3d;

/**
 * The rail network: a graph of {@link RailNode}s and {@link RailSegment}s
 * (SPEC §2.2). Pure data + graph operations, no MC imports — persistence
 * (SavedData) and world side effects live in the {@code rail} package
 * adapters.
 */
public final class RailGraph {

    /** Clicking this close to an existing node reuses it instead of creating one. */
    public static final double NODE_SNAP_RADIUS = 1.5;
    /** Route walking safety cap (cycles, runaway branches). */
    public static final int MAX_ROUTE_SEGMENTS = 256;
    /**
     * Min cosine for "this segment continues the track": at a node, a segment
     * departing within 60° of the travel direction is a continuation. Honest
     * continuations are near-tangent (cos ≈ 1 — joints share the node axis);
     * the other side of a junction departs the opposite way (cos ≈ −1). Shared
     * by routing (v1 switching, SPEC §2.2) and rendering (end overhangs).
     */
    public static final double CONTINUATION_DOT = 0.5;

    private final Map<Integer, RailNode> nodes = new LinkedHashMap<>();
    private final Map<Integer, RailSegment> segments = new LinkedHashMap<>();
    /**
     * Switch state (SPEC §2.2 v1): node id → selection counter. At a node
     * where several segments continue the track, the counter (mod the
     * candidate count) picks which one routes follow. Absent = 0.
     */
    private final Map<Integer, Integer> switchSelections = new LinkedHashMap<>();
    private int nextNodeId = 1;
    private int nextSegmentId = 1;
    private int nextGroupId = 1;

    public Collection<RailNode> nodes() {
        return nodes.values();
    }

    public Collection<RailSegment> segments() {
        return segments.values();
    }

    public RailNode node(int id) {
        return nodes.get(id);
    }

    public RailSegment segment(int id) {
        return segments.get(id);
    }

    public boolean isEmpty() {
        return segments.isEmpty();
    }

    // --- construction (used by deserialization) ---

    public void putNode(RailNode node) {
        nodes.put(node.id(), node);
        nextNodeId = Math.max(nextNodeId, node.id() + 1);
    }

    public void putSegment(RailSegment segment) {
        segments.put(segment.id(), segment);
        nextSegmentId = Math.max(nextSegmentId, segment.id() + 1);
        nextGroupId = Math.max(nextGroupId, segment.group() + 1);
        node(segment.nodeA()).segments().add(segment.id());
        node(segment.nodeB()).segments().add(segment.id());
    }

    // --- switch state (SPEC §2.2 v1) ---

    /** The switch selection counter at a node (0 if never toggled). */
    public int switchSelection(int nodeId) {
        return switchSelections.getOrDefault(nodeId, 0);
    }

    /** Set a node's switch selection counter (toggle = increment). */
    public void setSwitchSelection(int nodeId, int selection) {
        if (selection == 0) {
            switchSelections.remove(nodeId);
        } else {
            switchSelections.put(nodeId, selection);
        }
    }

    /** All non-zero switch selections (persistence / sync). */
    public Map<Integer, Integer> switchSelections() {
        return switchSelections;
    }

    // --- structure groups (SPEC §2.2): segments built by one click demolish together ---

    /** A fresh structure group id. */
    public int newGroupId() {
        return nextGroupId++;
    }

    /** Assign a segment to a structure group (replaces the stored record). */
    public void setSegmentGroup(int segmentId, int group) {
        RailSegment s = segments.get(segmentId);
        if (s != null) {
            segments.put(segmentId, s.withGroup(group));
            nextGroupId = Math.max(nextGroupId, group + 1);
        }
    }

    /** Set the rail style a segment is drawn with (replaces the stored record). */
    public void setSegmentStyle(int segmentId, String style) {
        RailSegment s = segments.get(segmentId);
        if (s != null) {
            segments.put(segmentId, s.withStyle(style));
        }
    }

    /** All segments of {@code segment}'s structure (just itself if ungrouped). */
    public List<RailSegment> structureOf(RailSegment segment) {
        if (segment.group() == 0) {
            return List.of(segment);
        }
        List<RailSegment> structure = new ArrayList<>();
        for (RailSegment s : segments.values()) {
            if (s.group() == segment.group()) {
                structure.add(s);
            }
        }
        return structure;
    }

    // --- editing ---

    /**
     * Create a segment between two marker points (SPEC §2.2 UX): each end
     * snaps to an existing node within {@link #NODE_SNAP_RADIUS} (reusing its
     * shared tangent → smooth continuation), otherwise a new node is created
     * with the given direction as its tangent axis. The directions' signs
     * don't matter — each segment end resolves its sign toward the chord.
     *
     * @param dirA tangent axis at {@code a} (e.g. the marker's look direction)
     * @param dirB tangent axis at {@code b}
     * @return the created segment
     */
    public RailSegment createSegment(Vector3d a, Vector3d dirA, Vector3d b, Vector3d dirB) {
        return createSegment(a, dirA, false, b, dirB, false);
    }

    /**
     * Like {@link #createSegment(Vector3d, Vector3d, Vector3d, Vector3d)}, but
     * {@code forceA}/{@code forceB} store the given axis on the segment end
     * itself ({@link RailSegment#dirA()}) even when the end snaps to an
     * existing node with a different axis. Used by diamond crossings: the
     * centre node carries the first path's axis, the second path's segments
     * carry their own.
     */
    public RailSegment createSegment(Vector3d a, Vector3d dirA, boolean forceA,
            Vector3d b, Vector3d dirB, boolean forceB) {
        RailNode nodeA = nodeNear(a);
        if (nodeA == null) {
            nodeA = new RailNode(nextNodeId++, a, new Vector3d(dirA));
            nodes.put(nodeA.id(), nodeA);
        }
        RailNode nodeB = nodeNear(b);
        if (nodeB == null) {
            nodeB = new RailNode(nextNodeId++, b, new Vector3d(dirB));
            nodes.put(nodeB.id(), nodeB);
        }
        Vector3d axisA = forceA ? new Vector3d(dirA).normalize() : nodeA.direction();
        Vector3d axisB = forceB ? new Vector3d(dirB).normalize() : nodeB.direction();
        Vector3d actualChord = nodeB.position().sub(nodeA.position());
        int signA = axisA.dot(actualChord) >= 0.0 ? 1 : -1;
        int signB = axisB.dot(actualChord) >= 0.0 ? 1 : -1;
        RailSegment segment = new RailSegment(nextSegmentId++, nodeA.id(), signA, nodeB.id(), signB,
                forceA ? axisA : null, forceB ? axisB : null);
        segments.put(segment.id(), segment);
        nodeA.segments().add(segment.id());
        nodeB.segments().add(segment.id());
        return segment;
    }

    /**
     * Remove a segment; nodes left without segments are removed too.
     *
     * @return the removed segment, or null if unknown
     */
    public RailSegment removeSegment(int id) {
        RailSegment segment = segments.remove(id);
        if (segment == null) {
            return null;
        }
        for (int nodeId : new int[] {segment.nodeA(), segment.nodeB()}) {
            RailNode node = node(nodeId);
            if (node != null) {
                node.segments().remove((Integer) id);
                if (node.segments().isEmpty()) {
                    nodes.remove(nodeId);
                    switchSelections.remove(nodeId);
                }
            }
        }
        return segment;
    }

    // --- geometry ---

    /** The Hermite curve of a segment, oriented from {@code nodeA} to {@code nodeB}. */
    public HermiteSegment hermite(RailSegment segment) {
        RailNode a = node(segment.nodeA());
        RailNode b = node(segment.nodeB());
        Vector3d pa = a.position();
        Vector3d pb = b.position();
        double chordLength = pa.distance(pb);
        Vector3d axisA = segment.dirA() != null ? new Vector3d(segment.dirA()) : a.direction();
        Vector3d axisB = segment.dirB() != null ? new Vector3d(segment.dirB()) : b.direction();
        Vector3d ma = axisA.mul(segment.signA() * chordLength);
        Vector3d mb = axisB.mul(segment.signB() * chordLength);
        return new HermiteSegment(pa, ma, pb, mb);
    }

    /**
     * Unit direction a segment departs from {@code nodeId} in (away from the
     * node, into the segment). Uses the actual curve velocity, so per-end
     * tangent overrides and sign resolution are respected.
     */
    public Vector3d departure(RailSegment segment, int nodeId) {
        HermiteSegment curve = hermite(segment);
        return segment.nodeA() == nodeId
                ? curve.velocity(0.0).normalize()
                : curve.velocity(1.0).normalize().negate();
    }

    /**
     * Segments at {@code nodeId} that continue the track for a train arriving
     * there along {@code from}: departing within {@link #CONTINUATION_DOT} of
     * the travel direction, lowest id first. Empty at a track end (or a cusp —
     * two segments meeting at an impassable angle).
     */
    public List<RailSegment> continuationsOf(RailSegment from, int nodeId) {
        Vector3d travel = departure(from, nodeId).negate();
        List<RailSegment> candidates = new ArrayList<>();
        for (int otherId : node(nodeId).segments()) {
            if (otherId == from.id()) {
                continue;
            }
            RailSegment other = segment(otherId);
            if (departure(other, nodeId).dot(travel) > CONTINUATION_DOT) {
                candidates.add(other);
            }
        }
        candidates.sort((s1, s2) -> Integer.compare(s1.id(), s2.id()));
        return candidates;
    }

    /**
     * Whether the segment's end at {@code nodeId} is an open track end that
     * grows the {@link TrackSweep#END_OVERHANG}: no other segment continues
     * the track past the node (departs within {@link #CONTINUATION_DOT} of the
     * outward direction). A dead-end node is trivially open; a switch node is
     * open on the side none of its legs leave from — a Y-toe or the open ends
     * of a scissors get the overhang, while straight joints and the legs' far
     * side don't. Co-directional open ends share one overhang (both legs of a
     * Y end at the toe along the same axis — two would z-fight): only the
     * lowest segment id draws it. Shared by the rail renderer and the track
     * bed, which must sweep the same tiles.
     */
    public boolean overhangAt(RailSegment segment, int nodeId) {
        Vector3d outward = departure(segment, nodeId).negate();
        for (int otherId : node(nodeId).segments()) {
            if (otherId == segment.id()) {
                continue;
            }
            Vector3d dep = departure(segment(otherId), nodeId);
            if (dep.dot(outward) > CONTINUATION_DOT) {
                return false; // the track continues past this node
            }
            if (otherId < segment.id() && dep.negate().dot(outward) > CONTINUATION_DOT) {
                return false; // a co-directional twin with a lower id draws it
            }
        }
        return true;
    }

    /**
     * The segment a train arriving at {@code nodeId} along {@code from}
     * continues onto, or null at a track end. A single candidate is followed
     * unconditionally (plain joints, the straight partner of a diamond
     * crossing, trailing through a switch); several candidates are a facing
     * switch — the node's selection counter picks one (SPEC §2.2 v1).
     */
    public RailSegment continuation(RailSegment from, int nodeId) {
        List<RailSegment> candidates = continuationsOf(from, nodeId);
        if (candidates.isEmpty()) {
            return null;
        }
        return candidates.get(Math.floorMod(switchSelection(nodeId), candidates.size()));
    }

    /** Node within {@link #NODE_SNAP_RADIUS} of the point, or null. */
    public RailNode nodeNear(Vector3d point) {
        RailNode best = null;
        double bestDistSq = NODE_SNAP_RADIUS * NODE_SNAP_RADIUS;
        for (RailNode node : nodes.values()) {
            double distSq = node.position().distanceSquared(point);
            if (distSq <= bestDistSq) {
                bestDistSq = distSq;
                best = node;
            }
        }
        return best;
    }

    /**
     * Segment whose curve passes nearest to the point (coarse 16-point
     * sampling — debug/UX precision), or null if none within {@code maxDist}.
     */
    public RailSegment segmentNear(Vector3d point, double maxDist) {
        RailSegment best = null;
        double bestDistSq = maxDist * maxDist;
        for (RailSegment segment : segments.values()) {
            HermiteSegment curve = hermite(segment);
            for (int i = 0; i <= 16; i++) {
                double distSq = curve.position(i / 16.0).distanceSquared(point);
                if (distSq <= bestDistSq) {
                    bestDistSq = distSq;
                    best = segment;
                }
            }
        }
        return best;
    }

    /** The point of a segment nearest to a query point: arc length {@code s} along it (A→B). */
    public record SegmentHit(RailSegment segment, double s, double distance) {
    }

    /**
     * The point of the track nearest to {@code point} — segment and exact
     * arc length — or null if no track passes within {@code maxDist}. Unlike
     * {@link #segmentNear}'s 16 samples this is precise to a few millimetres,
     * for placing things where the player clicked (SPEC §6.11). Segments
     * whose coarse samples are provably farther than {@code maxDist} are
     * skipped before the fine search.
     */
    public SegmentHit nearestPoint(Vector3d point, double maxDist) {
        SegmentHit best = null;
        for (RailSegment segment : segments.values()) {
            HermiteSegmentPath path = new HermiteSegmentPath(hermite(segment));
            double length = path.length();
            double coarseStep = length / 16.0;
            double coarseMin = Double.MAX_VALUE;
            for (int i = 0; i <= 16; i++) {
                coarseMin = Math.min(coarseMin, path.samplePosition(i * coarseStep).distance(point));
            }
            // no point of the curve is closer than its nearest sample minus half a step
            if (coarseMin - coarseStep * 0.5 > Math.min(maxDist, best == null ? maxDist : best.distance())) {
                continue;
            }
            double s = nearestS(path, point);
            double distance = path.samplePosition(s).distance(point);
            if (distance <= maxDist && (best == null || distance < best.distance())) {
                best = new SegmentHit(segment, s, distance);
            }
        }
        return best;
    }

    /** Arc length of the point of {@code path} nearest to {@code point}: 0.25 sampling, then ternary refinement. */
    static double nearestS(TrackPath path, Vector3d point) {
        double length = path.length();
        double step = 0.25;
        double bestS = 0.0;
        double bestDistSq = Double.MAX_VALUE;
        for (double s = 0.0; s <= length + 1.0e-9; s += step) {
            double distSq = path.samplePosition(Math.min(s, length)).distanceSquared(point);
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestS = Math.min(s, length);
            }
        }
        double lo = Math.max(0.0, bestS - step);
        double hi = Math.min(length, bestS + step);
        for (int i = 0; i < 40; i++) {
            double m1 = lo + (hi - lo) / 3.0;
            double m2 = hi - (hi - lo) / 3.0;
            if (path.samplePosition(m1).distanceSquared(point) <= path.samplePosition(m2).distanceSquared(point)) {
                hi = m2;
            } else {
                lo = m1;
            }
        }
        return (lo + hi) * 0.5;
    }

    /**
     * One leg of a route: a segment travelled either A→B ({@code reversed} =
     * false) or B→A.
     */
    public record RouteLeg(int segmentId, boolean reversed) {
    }

    /**
     * Walk the path through {@code startSegmentId}: extend in both directions,
     * at every node following {@link #continuation} — through plain joints
     * unconditionally, through switches by their selection counter. Stops at
     * dead ends, cusps and cycles. Re-walked whenever the graph (or a switch)
     * changes, so routes always reflect the current network (SPEC §2.2 v1).
     */
    public List<RouteLeg> walkRoute(int startSegmentId) {
        RailSegment start = segment(startSegmentId);
        if (start == null) {
            return List.of();
        }
        Set<Integer> visited = new LinkedHashSet<>();
        visited.add(start.id());

        List<RouteLeg> backward = walkFrom(start, start.nodeA(), visited);
        List<RouteLeg> forward = walkFrom(start, start.nodeB(), visited);

        List<RouteLeg> route = new ArrayList<>();
        // backward legs were discovered moving away from the route start: flip them
        for (int i = backward.size() - 1; i >= 0; i--) {
            RouteLeg leg = backward.get(i);
            route.add(new RouteLeg(leg.segmentId(), !leg.reversed()));
        }
        route.add(new RouteLeg(start.id(), false));
        route.addAll(forward);
        return route;
    }

    /** Extend from {@code node} away from {@code from}; legs oriented in walk direction. */
    private List<RouteLeg> walkFrom(RailSegment from, int nodeId, Set<Integer> visited) {
        List<RouteLeg> legs = new ArrayList<>();
        RailSegment current = from;
        int atNode = nodeId;
        while (legs.size() < MAX_ROUTE_SEGMENTS) {
            if (node(atNode) == null) {
                break;
            }
            RailSegment next = continuation(current, atNode);
            if (next == null || visited.contains(next.id())) {
                break; // track end / cusp, or cycle closed
            }
            visited.add(next.id());
            // travelling away from atNode: reversed if we enter at its nodeB
            boolean reversed = next.nodeB() == atNode;
            legs.add(new RouteLeg(next.id(), reversed));
            current = next;
            atNode = next.otherNode(atNode);
        }
        return legs;
    }

    /**
     * Route arc length of a point given on one of its segments ({@code segmentS}
     * along that segment, A→B), or NaN if the route doesn't use the segment.
     */
    public double routeS(List<RouteLeg> legs, int segmentId, double segmentS) {
        double before = 0.0;
        for (RouteLeg leg : legs) {
            RailSegment segment = segment(leg.segmentId());
            if (segment == null) {
                return Double.NaN;
            }
            double length = new HermiteSegmentPath(hermite(segment)).length();
            if (leg.segmentId() == segmentId) {
                return before + (leg.reversed() ? length - segmentS : segmentS);
            }
            before += length;
        }
        return Double.NaN;
    }

    /**
     * Materialize a route as a {@link TrackPath}. A route whose last leg ends
     * at the node its first leg started from is a closed loop — the path then
     * wraps instead of clamping, and consists circulate (SPEC §2.2).
     *
     * @return the path, or null if any segment is missing (stale route)
     */
    public RoutePath buildRoutePath(List<RouteLeg> legs) {
        if (legs.isEmpty()) {
            return null;
        }
        HermiteSegmentPath[] parts = new HermiteSegmentPath[legs.size()];
        boolean[] reversed = new boolean[legs.size()];
        for (int i = 0; i < legs.size(); i++) {
            RailSegment segment = segment(legs.get(i).segmentId());
            if (segment == null) {
                return null;
            }
            parts[i] = new HermiteSegmentPath(hermite(segment));
            reversed[i] = legs.get(i).reversed();
        }
        boolean loop = legs.size() > 1 && legStartNode(legs.get(0)) == legEndNode(legs.get(legs.size() - 1));
        return new RoutePath(parts, reversed, loop);
    }

    private int legStartNode(RouteLeg leg) {
        RailSegment segment = segment(leg.segmentId());
        return leg.reversed() ? segment.nodeB() : segment.nodeA();
    }

    private int legEndNode(RouteLeg leg) {
        RailSegment segment = segment(leg.segmentId());
        return leg.reversed() ? segment.nodeA() : segment.nodeB();
    }
}
