package com.muzhik17.trainsmod.client;

import net.minecraft.client.resources.language.I18n;

/**
 * What a light group is called — in the driver's light menu and over a cab
 * switch (SPEC §8). Group names come from the models ({@code ER2L},
 * {@code HBL}…) and mean different things on different stock, so a pack names
 * them per type: {@code light.<ns>.<type>.<group>} in its lang files (the
 * converter writes them from a type's {@code "lights"}, SPEC §9.6). The mod's
 * own {@code light.railswheelsandtrains.<group>} covers the common ones.
 */
public final class LightNames {

    private LightNames() {
    }

    /** The translated name of {@code group} on type {@code typeId} ({@code ns:id}), or null if none. */
    public static String of(String typeId, String group) {
        if (group == null) {
            return null;
        }
        if (typeId != null) {
            String own = "light." + typeId.replace(':', '.') + "." + group;
            if (I18n.exists(own)) {
                return I18n.get(own);
            }
        }
        String common = "light.railswheelsandtrains." + group;
        return I18n.exists(common) ? I18n.get(common) : null;
    }
}
