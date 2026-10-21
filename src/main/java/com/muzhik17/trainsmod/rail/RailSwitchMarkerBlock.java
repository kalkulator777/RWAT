package com.muzhik17.trainsmod.rail;

/**
 * The switch marker (SPEC §2.2 UX): like the plain {@link RailMarkerBlock}
 * (same 8-step rotation from the placer's look, same registry hooks — the
 * registry tells the two apart by block type), but clicking it with rails
 * builds a junction instead of a plain segment, picked by how many other
 * switch markers are in range ({@link RailItem}):
 *
 * <ul>
 * <li><b>None — Y-switch:</b> this marker is the toe (point A), the two
 * nearest plain markers are the branch ends (B and C) — two segments A→B and
 * A→C sharing node A and its tangent.</li>
 * <li><b>One — N-crossover:</b> the two switch markers are junctions on two
 * tracks, the plain markers nearest along them the tracks' continuations; a
 * diagonal joins the junctions.</li>
 * <li><b>Three — X-crossing:</b> two paths split through a shared centre node
 * where the paired chords cross; chords side by side make a scissors
 * crossover between two parallel tracks instead.</li>
 * </ul>
 *
 * <p>The cell a consumed switch marker stood in becomes the junction's switch
 * stand: a redstone signal into it, or into the bed below, throws the switch
 * ({@link RailNetwork#tickSwitches}). An X-crossing has none — routes cross
 * it straight.
 */
public class RailSwitchMarkerBlock extends RailMarkerBlock {

    public RailSwitchMarkerBlock(Properties properties) {
        super(properties);
    }
}
