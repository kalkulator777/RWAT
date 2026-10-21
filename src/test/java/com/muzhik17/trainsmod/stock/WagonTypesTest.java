package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** The pack-fed stock registry (SPEC §6.4/§6.5): aliases, placeholders, the default consist. */
class WagonTypesTest {

    private static WagonType type(String id, boolean cab, boolean boardable) {
        return new WagonType(id, 20.0, new double[]{7.0, -7.0}, 40.0, 100.0,
                WagonType.Resistance.NONE,
                cab ? new WagonType.Traction(1000.0, 200.0) : null,
                cab ? new WagonType.Cab() : null,
                WagonType.Brakes.NONE,
                boardable ? new WagonType.Interior(-1, 1, -9, 1, 4, 9) : null);
    }

    @AfterEach
    void clear() {
        WagonTypes.load(Map.of());
    }

    @Test
    void aliasResolvesToTheTypeThatTookItOver() {
        WagonType loco = type("mvp:chme3", true, false);
        WagonTypes.load(Map.of(loco.id(), loco), Map.of("rwat:chme3", "mvp:chme3"));
        assertSame(loco, WagonTypes.byId("rwat:chme3"));
        assertTrue(WagonTypes.isKnown("rwat:chme3"));
    }

    @Test
    void unknownIdResolvesToAPlaceholderKeepingTheId() {
        assertNull(WagonTypes.byId("gone:wagon"));
        WagonType placeholder = WagonTypes.resolve("gone:wagon");
        // the id survives, so a save writes it back unchanged until the pack returns
        assertEquals("gone:wagon", placeholder.id());
        assertFalse(placeholder.powered());
        assertFalse(placeholder.drivable());
        assertTrue(placeholder.length() > 0.0);
        assertFalse(WagonTypes.isKnown("gone:wagon"));
    }

    @Test
    void longestFollowsTheLoadedLayer_neverUnderThePlaceholder() {
        double placeholder = WagonTypes.missing("gone:wagon").length();
        assertEquals(placeholder, WagonTypes.longest());
        WagonType coach = new WagonType("b:coach", 32.5, new double[]{12.0, -12.0}, 40.0, 100.0,
                WagonType.Resistance.NONE, null, null, WagonType.Brakes.NONE, null);
        WagonType shunter = type("a:shunter", true, false);
        WagonTypes.load(Map.of(coach.id(), coach, shunter.id(), shunter));
        assertEquals(32.5, WagonTypes.longest());
        // a reload without the long car shrinks it back
        WagonTypes.load(Map.of(shunter.id(), shunter));
        assertEquals(placeholder, WagonTypes.longest());
    }

    @Test
    void noPacksMeansNoDefaultConsist() {
        assertNull(WagonTypes.defaultConsist());
    }

    @Test
    void defaultConsistIsTheFirstLocoHaulingTheFirstBoardableCar() {
        WagonType boxcar = type("a:boxcar", false, false);
        WagonType coach = type("b:coach", false, true);
        WagonType loco = type("c:loco", true, false);
        WagonTypes.load(Map.of(boxcar.id(), boxcar, coach.id(), coach, loco.id(), loco));
        ConsistComposition consist = WagonTypes.defaultConsist();
        assertEquals(2, consist.wagonCount());
        assertSame(loco, consist.slot(0).type());
        assertSame(coach, consist.slot(1).type());
    }
}
