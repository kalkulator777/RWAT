/**
 * Rails, Wheels &amp; Trains — a standalone train mod for Minecraft 1.21.1 / NeoForge.
 *
 * <p>SPEC.md in the project root is the source of truth. The codebase is built
 * bottom-up by dependency order (see SPEC §1.1); each layer has its own package:
 *
 * <ul>
 *   <li>{@code consist}   — Layer 0: the server-authoritative train entity,
 *       persistence, and the tick/loading interface.</li>
 *   <li>{@code path}      — Layer 1: 3D spline segments, arc-length tables, the
 *       node/segment graph stored as level SavedData.</li>
 *   <li>{@code kinematics}— Layer 2: bogies on the spline, body pose derived from
 *       the two bogies, driver controls.</li>
 *   <li>{@code network}   — custom packets (consist state snapshots, etc.).</li>
 *   <li>{@code platform}  — version-isolation facade hiding version-specific and
 *       render-pipeline calls behind our own interfaces (SPEC principle #4).</li>
 *   <li>{@code client.render} — Layer 3: rendering, kept off the dedicated
 *       server. Geometry is data, baked through the modern pipeline.</li>
 * </ul>
 */
package com.muzhik17.trainsmod;
