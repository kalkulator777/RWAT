package com.muzhik17.trainsmod.convention;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** IR object-name convention (SPEC §8–§9), on real ChME3 names from the MVP pack. */
class ObjectRoleTest {

    @Test
    void throttleLever_andItsPivot() {
        ObjectRole lever = ObjectRole.parse("THROTTLE_1_INTERIOR_LCG_IL_mvp_chme3");
        assertEquals(ObjectRole.Kind.THROTTLE, lever.control().kind());
        assertEquals("THROTTLE_1", lever.control().key());
        assertEquals("THROTTLE_1", lever.control().group());
        assertFalse(lever.pivot());
        assertEquals("IL", lever.lightGroup());

        ObjectRole pivot = ObjectRole.parse("THROTTLE_1_ROT_-120_INTERIOR_LCG_IL_mvp_chme3");
        assertEquals("THROTTLE_1", pivot.control().key());
        assertTrue(pivot.pivot());
        assertEquals(-120.0F, pivot.pivotDegrees());
    }

    @Test
    void gaugeIsNotTheLeverItNames() {
        ObjectRole gauge = ObjectRole.parse("GAUGE_THROTTLE_1_FULLBRIGHT_LCG_IL_mvp_chme3");
        assertEquals(ObjectRole.Kind.GAUGE_THROTTLE, gauge.control().kind());
        assertEquals("GAUGE_THROTTLE_1", gauge.control().key());
        assertTrue(gauge.fullbright());

        ObjectRole needle = ObjectRole.parse("GAUGE_SPEED_1_ROT_-270_mvp_chme3");
        assertEquals(ObjectRole.Kind.GAUGE_SPEED, needle.control().kind());
        assertEquals(-270.0F, needle.pivotDegrees());
        assertEquals("Speed", ObjectRole.parse("GAUGE_SPEED_1_FULLBRIGHT_LCG_IL_LABEL_Speed")
                .control().label());
    }

    @Test
    void independentBrake_shortName() {
        ObjectRole ind = ObjectRole.parse("IND_BRAKE_2_ROT_-90_mvp_chme3");
        assertEquals(ObjectRole.Kind.INDEPENDENT_BRAKE, ind.control().kind());
        assertEquals(2, ind.control().id());
        assertEquals(ObjectRole.Kind.TRAIN_BRAKE,
                ObjectRole.parse("TRAIN_BRAKE_1_ROT_129_mvp_chme3").control().kind());
    }

    @Test
    void toggleSwitch_drivesItsControlGroup() {
        ObjectRole sw = ObjectRole.parse("WIDGET_6_TOGGLE_INTERIOR_CG_FHL_LCG_IL_LABEL_Front^HeadLight");
        assertEquals(ObjectRole.Kind.WIDGET, sw.control().kind());
        assertEquals("WIDGET_6", sw.control().key());
        assertEquals("FHL", sw.control().group());
        assertTrue(sw.control().toggle());
        assertEquals("Front HeadLight", sw.control().label());
        // its pivot names the same widget, not WIDGET_60 or WIDGET_1
        assertEquals("WIDGET_6", ObjectRole.parse("WIDGET_6_ROT_80_INTERIOR_LCG_IL_mvp_chme3")
                .control().key());
        assertEquals("WIDGET_16", ObjectRole.parse("WIDGET_16_TOGGLE_INTERIOR_CG_BgL_LCG_IL_LABEL_Bogie^Light")
                .control().key());
    }

    @Test
    void tailLamp_isShownWhileItsGroupIsOn() {
        ObjectRole tail = ObjectRole.parse("WIDGET_17_HIDE_INVERT_FULLBRIGHT_CG_FEL_LABEL_^");
        assertTrue(tail.control().hide());
        assertTrue(tail.control().invert());
        assertEquals("FEL", tail.control().group());
        assertTrue(tail.fullbright());
    }

    @Test
    void headlight_colourAndGroup() {
        ObjectRole lamp = ObjectRole.parse("HEADLIGHT_1_0XFFF0CC_FULLBRIGHT_LCG_FHL_mvp_chme3");
        assertNull(lamp.control());
        assertTrue(lamp.headlight());
        assertTrue(lamp.fullbright());
        assertEquals(0xFFF0CC, lamp.rgb());
        assertEquals("FHL", lamp.lightGroup());
    }

    @Test
    void slidingWindow() {
        ObjectRole window = ObjectRole.parse("WINDOW_1_TL_-0.4375_X_INTERIOR_LCG_IL_mvp_chme3");
        assertEquals(ObjectRole.Kind.WINDOW, window.control().kind());
        assertEquals(-0.4375F, window.control().slideX());
        assertEquals(0.0F, window.control().slideZ());
    }

    @Test
    void plainObjects_haveNoRole() {
        assertSame(ObjectRole.NONE, ObjectRole.parse("FRAME_mvp_chme3"));
        assertSame(ObjectRole.NONE, ObjectRole.parse("BOGEY_FRONT_WHEEL_1_mvp_chme3"));
        assertSame(ObjectRole.NONE, ObjectRole.parse("DOOR_1_TOGGLE_CG_Door1_mvp_chme3"));
        // the cab interior lights with IL but is no control
        ObjectRole interior = ObjectRole.parse("INTERIOR_1_LCG_IL_mvp_chme3");
        assertNull(interior.control());
        assertEquals("IL", interior.lightGroup());
    }
}
