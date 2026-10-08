/**
 * Layer 1 — Rail system.
 *
 * <p>A path segment is a 3D parametric spline (Hermite vs Bézier is open
 * question #1, decided at implementation; the interface must not depend on it).
 * Every segment carries an <b>arc-length table</b> mapping parameter {@code t}
 * to travelled length — all motion is by length, never by raw {@code t}.
 *
 * <p>A node is a point with a <b>list</b> of connections (≤2 in v0, structure
 * allows N — groundwork for switches). The network is a graph of nodes and
 * segments, persisted as level SavedData (SPEC §2.2).
 *
 * <p>Heights are in from the start: the spline is 3D from day one.
 */
package com.muzhik17.trainsmod.path;
