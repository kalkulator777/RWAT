/**
 * Networking — custom packets.
 *
 * <p>The consist state snapshot ({@code s}, {@code v}, path id) is sent at a
 * fixed rate. Clients run snapshot interpolation with a delay buffer, rendering
 * ~2 ticks in the past and interpolating between received snapshots.
 *
 * <p><b>Critical:</b> interpolation is over {@code s} along the path, never over
 * 3D position — interpolating position cuts corners on curves and is the source
 * of jitter/artifacts (SPEC §2.1).
 */
package com.muzhik17.trainsmod.network;
