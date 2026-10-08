package com.muzhik17.trainsmod.convention;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.Handles;

/** Control positions and values (SPEC §9.3), IR semantics. */
class ControlValueTest {

    private static final ControlValue.Readings STILL = new ControlValue.Readings(0.0, 95.0);

    private static ObjectRole.Control control(String name) {
        return ObjectRole.parse(name).control();
    }

    @Test
    void lever_followsItsHandle_inTheActiveCabOnly() {
        ObjectRole.Control throttle = control("THROTTLE_1_INTERIOR_LCG_IL_mvp_chme3");
        Handles handles = new Handles(1, 4, 0, 0, 0);
        assertEquals(0.5F, ControlValue.position(throttle, handles, true, 0.0F, STILL));
        assertEquals(0.0F, ControlValue.position(throttle, handles, false, 0.0F, STILL));
    }

    @Test
    void reverser_restsInNeutral() {
        ObjectRole.Control reverser = control("REVERSER_1_INTERIOR_LCG_IL_mvp_chme3");
        // another cab drives: this lever is in neutral, the model's own pose
        float rest = ControlValue.position(reverser, new Handles(1, 0, 0, 0, 3), false, 0.0F, STILL);
        assertEquals(0.0F, ControlValue.value(reverser, rest));
        Handles back = new Handles(-1, 0, 0, 0, 0);
        assertEquals(-0.5F, ControlValue.value(reverser,
                ControlValue.position(reverser, back, true, 0.0F, STILL)));
    }

    @Test
    void handleTravel_roundTripsThroughNotches() {
        for (int notch = 0; notch <= Consist.NOTCHES; notch++) {
            Handles h = new Handles(0, notch, 0, 0, 0);
            assertEquals(notch, Handles.fromTravel(Consist.Handle.THROTTLE, h.travel(Consist.Handle.THROTTLE)));
        }
        for (int r = -1; r <= 1; r++) {
            Handles h = new Handles(r, 0, 0, 0, 0);
            assertEquals(r, Handles.fromTravel(Consist.Handle.REVERSER, h.travel(Consist.Handle.REVERSER)));
        }
        Handles packed = Handles.unpack(new Handles(-1, 8, 3, 7, 2).pack(), 2);
        assertEquals(new Handles(-1, 8, 3, 7, 2), packed);
    }

    @Test
    void switch_readsItsGroup() {
        ObjectRole.Control sw = control("WIDGET_6_TOGGLE_INTERIOR_CG_FHL_LCG_IL_LABEL_Front^HeadLight");
        assertEquals(1.0F, ControlValue.position(sw, Handles.REST, false, 1.0F, STILL));
        assertEquals(0.0F, ControlValue.position(sw, Handles.REST, false, 0.0F, STILL));
    }

    @Test
    void hiddenInvertedLamp_showsOnlyWhileOn() {
        ObjectRole.Control tail = control("WIDGET_17_HIDE_INVERT_FULLBRIGHT_CG_FEL_LABEL_^");
        assertFalse(ControlValue.visible(tail, 0.0F));
        assertTrue(ControlValue.visible(tail, 1.0F));
    }

    @Test
    void speedometer_scalesByTheTypeTopSpeed() {
        ObjectRole.Control gauge = control("GAUGE_SPEED_1_FULLBRIGHT_LCG_IL_LABEL_Speed");
        float pos = ControlValue.position(gauge, Handles.REST, false, 0.0F,
                new ControlValue.Readings(-47.5, 95.0));
        assertEquals(0.5F, pos, 1.0e-6F);
    }
}
