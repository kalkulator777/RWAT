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
 * and the interface describing "who ticks a consist and when" — a v0 stub
 * (tick only if the head's chunk is loaded) swappable later without
 * restructuring (SPEC §2.1).
 *
 * <p>Only {@code s} and {@code v} are synchronized; clients deterministically
 * unroll everything else (see {@code kinematics} and {@code network}).
 */
package com.muzhik17.trainsmod.consist;
