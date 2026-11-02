/**
 * Layer 1 MC adapters: persistence and world side effects of the rail
 * network. The graph itself ({@code path.RailGraph}) is pure math; this
 * package owns its SavedData wrapper ({@code RailNetwork}), client sync,
 * the track bed collision blocks (SPEC §2.2, 0.3) and the two-marker build
 * tool (SPEC §2.2 UX v0). {@code RailEdit} — what a click with the rails
 * came to and how long the rails rest after it — imports no Minecraft
 * class and is tested as the core is.
 */
package com.muzhik17.trainsmod.rail;
