/**
 * The server-authoritative consist (SPEC §2): a logical object kept in
 * SavedData ({@code Consist}, ticked by {@code ConsistManager}), not an
 * Entity. It holds a position on the track graph (the head's distance along
 * its path), the speed, the direction and an ordered list of wagons; each
 * wagon is an Entity ({@code WagonEntity}) placed from the consist's state
 * every tick and re-attached by UUID on chunk load. Couplings between wagons
 * are decided by the pure {@code Coupling}.
 *
 * <p>Also owns persistence (consists in SavedData, wagon entities in chunks)
 * and "who ticks a consist and when" (SPEC §2.1): a consist driven or on the
 * move holds the chunks under it and the way ahead with tickets ({@code
 * ConsistChunks}; which chunks and when, the pure {@code ChunkCover} and
 * {@code ChunkLease}), and coupling is decided on the track whether the
 * chunks are loaded or not.
 *
 * <p>Who may touch a wagon is one rule, the pure {@code TouchRules}: it
 * decides from the facts each side gathers ({@code WagonTouch}: in the game,
 * the right to build, the driver's key, the crowbar, aboard, the cabs) and the
 * reach the caller knows. The server decides every click, drag and step of a
 * player on a wagon by it; the client asks the same rule before it sends, so
 * what the server would refuse isn't sent. A walking rider's pace is the pure
 * {@code WalkBudget}: one step a server tick, a few ticks' worth kept.
 *
 * <p>The client gets a snapshot of the consist every tick (head {@code s},
 * speed {@code v}, composition, handles; see {@code network}) and unrolls
 * the rest deterministically (see {@code kinematics}).
 */
package com.muzhik17.trainsmod.consist;
