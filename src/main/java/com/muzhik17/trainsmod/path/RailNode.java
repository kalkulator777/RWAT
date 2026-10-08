package com.muzhik17.trainsmod.path;

import java.util.ArrayList;
import java.util.List;

import org.joml.Vector3d;

/**
 * A rail network node (SPEC §2.2): position + tangent + a <b>list</b> of
 * connected segments (≤2 in v0, the structure allows N — groundwork for
 * switches).
 *
 * <p>Per the Hermite decision (SPEC #1): the node stores the «rail direction
 * at this point» as a <b>unit</b> vector shared by all adjacent segments —
 * direction continuity (G1) at joints for free. Segments scale it by their
 * chord length and a per-end sign (a segment may leave the node along
 * {@code +direction} or {@code -direction}).
 *
 * <p>Pure data, no MC imports.
 */
public final class RailNode {

    private final int id;
    private final Vector3d position;
    private final Vector3d direction;
    private final List<Integer> segments = new ArrayList<>(2);

    public RailNode(int id, Vector3d position, Vector3d direction) {
        this.id = id;
        this.position = new Vector3d(position);
        this.direction = new Vector3d(direction).normalize();
    }

    public int id() {
        return id;
    }

    public Vector3d position() {
        return new Vector3d(position);
    }

    /** Unit rail direction at this node. */
    public Vector3d direction() {
        return new Vector3d(direction);
    }

    /** Ids of segments connected to this node. Mutable, owned by the graph. */
    public List<Integer> segments() {
        return segments;
    }
}
