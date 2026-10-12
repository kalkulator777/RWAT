/**
 * Layer 0 — Foundation.
 *
 * <p>The server-authoritative consist. Per SPEC 0.2: the consist is a logical
 * server-side object living in SavedData (NOT an Entity), ticked by its own
 * manager; each wagon is an Entity whose position is driven from the consist's
 * {@code s} every tick and re-attached by UUID on chunk load. State: reference
 * to a path, head distance-along-path {@code s}, speed {@code v}, direction,
 * and an ordered list of wagons (length 1 in v0, but modelled as a list from
 * day one). Per-tick rule in v0: {@code s += v}.
 *
 * <p>Layer 0 is built against a minimal path interface
 * ({@code samplePosition(s)}, {@code length()}) with a hardcoded straight-line
 * debug implementation; Layer 1 substitutes the real graph later.
 *
 * <p>Also owns persistence (consists in SavedData, wagon entities in chunks)
 * and "who ticks a consist and when" (SPEC §2.1): the v0 stub (tick only if
 * the head's chunk is loaded) is replaced by chunk loading (2026-10-12) — a
 * consist driven or on the move holds the chunks under it and the way ahead
 * with tickets ({@code ConsistChunks}; which chunks and when, the pure
 * {@code ChunkCover} and {@code ChunkLease}), and coupling is decided on the
 * track whether the chunks are loaded or not.
 *
 * <p>Only {@code s} and {@code v} are synchronized; clients deterministically
 * unroll everything else (see {@code kinematics} and {@code network}).
 */
package com.muzhik17.trainsmod.consist;
