package com.muzhik17.trainsmod.convention;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * A control group's name on the wire (M9): a model's {@code CG_}/{@code LCG_}
 * name longer than 32 characters cut the client off its server when it was
 * sent. The model loader drops such a group as it loads the model.
 */
class GroupNameTest {

    /** 40 characters, no underscore: one group token. */
    private static final String LONG = "ThisSwitchNameIsFarTooLongToEverBeSentXY";
    private static final String MAX = "A".repeat(GroupName.MAX_LENGTH);

    @Test
    void aNameFits_upToThirtyTwoCharacters() {
        assertEquals(40, LONG.length());
        assertTrue(GroupName.fits("IL"));
        assertTrue(GroupName.fits(MAX));
        assertFalse(GroupName.fits(MAX + "B"));
        assertFalse(GroupName.fits(""));
        assertFalse(GroupName.fits(null));
    }

    @Test
    void aSwitchWithALongGroup_isNamed_andCantBeWorked() {
        ObjectRole role = ObjectRole.parse("WIDGET_3_CG_" + LONG + "_TOGGLE");
        assertEquals(List.of(LONG), GroupName.tooLong(role));
        ObjectRole fit = GroupName.fit(role);
        assertTrue(fit.control().noTouch());
        assertEquals("WIDGET_3", fit.control().group());
        assertTrue(fit.control().toggle(), "the rest of the switch stays");
        assertEquals(List.of(), GroupName.tooLong(fit));
    }

    @Test
    void aLeverWithALongGroup_keepsIt_itsGroupNeverTravels() {
        ObjectRole lever = ObjectRole.parse("THROTTLE_1_CG_" + LONG);
        assertEquals(List.of(), GroupName.tooLong(lever));
        assertSame(lever, GroupName.fit(lever));
        assertFalse(GroupName.fit(lever).control().noTouch());
    }

    @Test
    void aLightWithALongGroup_isNeverLit() {
        ObjectRole lamp = ObjectRole.parse("LAMP_LCG_" + LONG + "_FULLBRIGHT");
        assertEquals(List.of(LONG), GroupName.tooLong(lamp));
        ObjectRole fit = GroupName.fit(lamp);
        assertNull(fit.lightGroup());
        assertFalse(fit.lit(), "no group would mean lit always");
        ObjectRole headlight = GroupName.fit(ObjectRole.parse("HEADLIGHT_1_LCG_" + LONG + "_FULLBRIGHT"));
        assertFalse(headlight.headlight());
        assertFalse(headlight.lit());
    }

    @Test
    void anInvertedLightWithALongGroup_isAlwaysLit() {
        ObjectRole fit = GroupName.fit(ObjectRole.parse("LAMP_LCG_" + LONG + "_LINVERT_FULLBRIGHT"));
        assertNull(fit.lightGroup());
        assertFalse(fit.lightInvert());
        assertTrue(fit.lit());
    }

    @Test
    void groupsThatFit_leaveTheRoleAsItIs() {
        ObjectRole role = ObjectRole.parse("WIDGET_2_CG_" + MAX + "_LCG_IL_FULLBRIGHT");
        assertEquals(List.of(), GroupName.tooLong(role));
        assertSame(role, GroupName.fit(role));
    }

    @Test
    void aSwitchAndItsLightBothTooLong_areBothNamed() {
        ObjectRole role = ObjectRole.parse("WIDGET_2_CG_" + LONG + "_LCG_" + LONG + "Z_FULLBRIGHT");
        assertEquals(List.of(LONG, LONG + "Z"), GroupName.tooLong(role));
    }
}
