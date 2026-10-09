package com.muzhik17.trainsmod.rail;

import java.util.Map;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.path.TileFootprint;

/**
 * Server-side registry of the rail styles' tiles as the track bed sees them
 * (SPEC §2.2, §6.10): style id → {@link TileFootprint}, read from the same
 * declarations and OBJs the client draws
 * ({@link com.muzhik17.trainsmod.data.RailFootprintReloadListener}) and
 * replaced wholesale on every data reload. The style itself stays a client
 * matter — the server only needs to know which blocks the drawn rails touch.
 */
public final class RailFootprints {

    /** The mod's own rail: what {@link RailSegment#DEFAULT_STYLE} and unknown styles lay. */
    public static final String STANDARD = RailsWheelsAndTrains.MODID + ":standard";

    /**
     * The standard rail's boxes ({@code assets/railswheelsandtrains/rail/standard.obj}:
     * sleeper, two rails), for the case not even its OBJ loaded — the bed
     * must not vanish with a broken resource.
     */
    private static final TileFootprint BUILT_IN = TileFootprint.ofBoxes(1.0,
            new float[] {-0.14F, 0.0F, -1.25F, 0.14F, 0.16F, 1.25F},
            new float[] {-0.5F, 0.16F, 0.7275F, 0.5F, 0.40625F, 0.8975F},
            new float[] {-0.5F, 0.16F, -0.8975F, 0.5F, 0.40625F, -0.7275F});

    private static volatile Map<String, TileFootprint> footprints = Map.of();

    private RailFootprints() {
    }

    /**
     * The tile a segment drawn in {@code style} lays its bed with: the style's
     * own if this server has it, else the standard rail's — the same fallback
     * the client draws with, so the bed still matches what is shown.
     */
    public static TileFootprint forStyle(String style) {
        Map<String, TileFootprint> all = footprints;
        TileFootprint found = style.isEmpty() ? null : all.get(style);
        if (found != null) {
            return found;
        }
        TileFootprint standard = all.get(STANDARD);
        return standard != null ? standard : BUILT_IN;
    }

    /** Replace the registry (data reload). */
    public static void load(Map<String, TileFootprint> loaded) {
        footprints = Map.copyOf(loaded);
    }
}
