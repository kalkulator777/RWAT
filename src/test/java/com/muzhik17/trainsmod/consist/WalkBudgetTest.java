package com.muzhik17.trainsmod.consist;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * One walk step a tick (M5): a client that sent N walk inputs a tick walked
 * N steps a tick. The budget keeps the pace to a step a tick, and lets an
 * honest client's inputs through when the network bunches them.
 */
class WalkBudgetTest {

    /** How many of {@code perTick[t]} inputs arriving in tick t are stepped. */
    private static int stepped(int... perTick) {
        WalkBudget budget = new WalkBudget();
        int taken = 0;
        for (int tick = 0; tick < perTick.length; tick++) {
            for (int i = 0; i < perTick[tick]; i++) {
                if (budget.take(tick)) {
                    taken++;
                }
            }
        }
        return taken;
    }

    @Test
    void tenInputsInOneTick_stepOnce() {
        assertEquals(1, stepped(10));
    }

    @Test
    void oneInputATick_everyOneSteps() {
        int[] steady = new int[200];
        java.util.Arrays.fill(steady, 1);
        assertEquals(200, stepped(steady));
    }

    @Test
    void inputsTheNetworkBunched_allStep() {
        // none, then two; three late ones at once; one a tick again
        assertEquals(12, stepped(1, 0, 2, 1, 0, 0, 0, 4, 1, 1, 0, 2));
    }

    @Test
    void aFlood_walksNoFasterThanATick() {
        int ticks = 100;
        int[] flood = new int[ticks];
        java.util.Arrays.fill(flood, 20);
        assertEquals(ticks, stepped(flood));
    }

    @Test
    void stepsSavedUp_keepOnlyForAFewTicks() {
        int[] idleThenFlood = new int[51];
        idleThenFlood[0] = 1;
        idleThenFlood[50] = 20;
        assertEquals(1 + WalkBudget.BURST, stepped(idleThenFlood));
    }

    @Test
    void overAnyStretch_noMoreThanItsTicksPlusTheBurst() {
        WalkBudget budget = new WalkBudget();
        java.util.Random random = new java.util.Random(7);
        int taken = 0;
        int ticks = 1000;
        for (int tick = 0; tick < ticks; tick++) {
            for (int i = random.nextInt(4); i > 0; i--) {
                if (budget.take(tick)) {
                    taken++;
                }
            }
        }
        assertTrue(taken <= ticks + WalkBudget.BURST, "taken " + taken);
    }
}
