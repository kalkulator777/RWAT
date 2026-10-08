package com.muzhik17.trainsmod.client.render.model;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.path.RailSegment;

/**
 * Client-side rail style registry (SPEC §6.10): style id → {@link RailStyle},
 * from every {@code assets/<ns>/rail_models/} declaration of the resource
 * packs — the mod's own {@link #STANDARD} rail included, it is declared the
 * same way. Replaced wholesale by {@link RailModelReloadListener} on every
 * resource reload.
 */
public final class RailStyles {

    /** The mod's own rail: what {@link RailSegment#DEFAULT_STYLE} and unknown styles draw. */
    public static final String STANDARD = RailsWheelsAndTrains.MODID + ":standard";

    private static volatile Map<String, RailStyle> styles = Map.of();

    private RailStyles() {
    }

    /**
     * The style a segment is drawn with: its own if this client has it, else
     * the standard rail (a pack missing on this client must not hide the
     * track). Null only if not even the standard rail loaded.
     */
    public static RailStyle forSegment(String style) {
        Map<String, RailStyle> all = styles;
        RailStyle found = style.isEmpty() ? null : all.get(style);
        return found != null ? found : all.get(STANDARD);
    }

    /**
     * Style ids for the picker: the standard rail as {@code ""} first (what a
     * rails stack without a choice builds), then the packs' styles by id.
     */
    public static List<String> pickable() {
        List<String> ids = new ArrayList<>();
        ids.add(RailSegment.DEFAULT_STYLE);
        styles.keySet().stream().filter(id -> !id.equals(STANDARD)).sorted().forEach(ids::add);
        return ids;
    }

    static void reset(Map<String, RailStyle> loaded) {
        styles = Map.copyOf(loaded);
    }
}
