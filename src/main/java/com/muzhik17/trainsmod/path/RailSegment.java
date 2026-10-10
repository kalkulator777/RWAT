package com.muzhik17.trainsmod.path;

import org.joml.Vector3d;

/**
 * A rail segment: an edge of the rail graph between two nodes (SPEC §2.2).
 * The actual curve is a Hermite spline built from the node positions and
 * their shared tangents; {@code signA}/{@code signB} (+1/−1) say whether the
 * segment runs along or against each node's stored direction.
 *
 * <p>{@code dirA}/{@code dirB} (nullable) override the node's tangent axis at
 * that end. Normally null — the shared node tangent is what gives smooth
 * joints. A diamond crossing is the exception: its centre node belongs to two
 * paths with two different axes, the node keeps the first path's axis and the
 * second path's segments carry their own (SPEC §2.2, 2026-06-11).
 *
 * <p>{@code group} ties segments built by one click (a switch, a crossing…)
 * into one structure — demolition removes the whole group (SPEC §2.2,
 * 2026-06-11). 0 = standalone segment.
 *
 * <p>{@code style} is the rail style the segment is drawn with (SPEC §6.10):
 * a content-pack rail model id, {@link #DEFAULT_STYLE} ({@code ""}) for the
 * mod's own rail. Purely visual — the server stores it without knowing which
 * styles exist; a client without that style draws the default.
 *
 * <p>{@code bed} is the material of the track bed laid under the segment
 * (SPEC §2.2): a bed material id ({@code gravel}, {@code stone},
 * {@code invisible}…), {@link #DEFAULT_BED} ({@code ""}) for the default
 * gravel. The world side maps it to a bed block; an id it doesn't know lays
 * the default.
 *
 * <p>Pure data, no MC imports. The override vectors are treated as immutable —
 * not copied on access.
 */
public record RailSegment(int id, int nodeA, int signA, int nodeB, int signB,
        Vector3d dirA, Vector3d dirB, int group, String style, String bed) {

    /** The mod's own rail (also what segments from before rail styles carry). */
    public static final String DEFAULT_STYLE = "";
    /** The default gravel bed (also what segments from before bed materials carry). */
    public static final String DEFAULT_BED = "";

    public RailSegment {
        style = style == null ? DEFAULT_STYLE : style;
        bed = bed == null ? DEFAULT_BED : bed;
    }

    /** A segment using the node tangents at both ends (the normal case). */
    public RailSegment(int id, int nodeA, int signA, int nodeB, int signB) {
        this(id, nodeA, signA, nodeB, signB, null, null, 0, DEFAULT_STYLE, DEFAULT_BED);
    }

    /** A segment with optional per-end tangent overrides, ungrouped, default look. */
    public RailSegment(int id, int nodeA, int signA, int nodeB, int signB,
            Vector3d dirA, Vector3d dirB) {
        this(id, nodeA, signA, nodeB, signB, dirA, dirB, 0, DEFAULT_STYLE, DEFAULT_BED);
    }

    /**
     * How a segment looks: its rail style and bed material — what the rails
     * item builds with and a repaint applies.
     */
    public record Look(String style, String bed) {

        /** The mod's own rail on gravel. */
        public static final Look DEFAULT = new Look(DEFAULT_STYLE, DEFAULT_BED);

        public Look {
            style = style == null ? DEFAULT_STYLE : style;
            bed = bed == null ? DEFAULT_BED : bed;
        }
    }

    public Look look() {
        return new Look(style, bed);
    }

    /** The same segment with another group. */
    public RailSegment withGroup(int newGroup) {
        return new RailSegment(id, nodeA, signA, nodeB, signB, dirA, dirB, newGroup, style, bed);
    }

    /** The same segment with another rail style and bed. */
    public RailSegment withLook(Look look) {
        return new RailSegment(id, nodeA, signA, nodeB, signB, dirA, dirB, group, look.style(), look.bed());
    }

    /** The node at the other end, or −1 if {@code nodeId} is not an end. */
    public int otherNode(int nodeId) {
        if (nodeId == nodeA) {
            return nodeB;
        }
        return nodeId == nodeB ? nodeA : -1;
    }
}
