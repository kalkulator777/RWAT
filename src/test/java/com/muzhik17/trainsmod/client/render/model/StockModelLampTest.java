package com.muzhik17.trainsmod.client.render.model;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * A cabin lamp shines by the one rule of every fire ({@code ModelParts.lit}):
 * with no group always, with a group while it is on, with {@code LINVERT}
 * while it is off. The interior bake and a rider's light take lamps by it.
 */
class StockModelLampTest {

    @Test
    void aLampWithNoGroupAlwaysShinesEvenWhenEveryGroupIsOff() {
        assertTrue(new StockModel.Lamp(0, 0, 0, -1, false).lit(0L));
    }

    @Test
    void aLampOfAGroupShinesWhileItsGroupIsOn() {
        StockModel.Lamp lamp = new StockModel.Lamp(0, 0, 0, 1, false);
        assertTrue(lamp.lit(0b10L));
        assertFalse(lamp.lit(0b01L));
    }

    @Test
    void anInvertedLampShinesWhileItsGroupIsOff() {
        StockModel.Lamp lamp = new StockModel.Lamp(0, 0, 0, 1, true);
        assertTrue(lamp.lit(0L), "an all-dark car still lights an inverted lamp");
        assertFalse(lamp.lit(0b10L));
    }
}
