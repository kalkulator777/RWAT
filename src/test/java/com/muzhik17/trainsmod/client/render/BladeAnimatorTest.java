package com.muzhik17.trainsmod.client.render;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

/**
 * The switch blades' throw (SPEC §2.2 v1, audit M27): one switch thrown in a
 * network of many is the only one swept again while its blades move, and
 * only while it is drawn; when the throw ends it is swept once more, at
 * rest, and then never until its next throw.
 */
class BladeAnimatorTest {

    private static final int SWITCHES = 50;
    private static final List<Integer> LEGS = List.of(10, 11);

    /** Every switch set once, so the animator knows them all. */
    private static Map<Integer, Integer> allSet() {
        Map<Integer, Integer> selections = new HashMap<>();
        for (int node = 1; node <= SWITCHES; node++) {
            selections.put(node, 1);
        }
        return selections;
    }

    @Test
    void onlyTheThrownSwitchIsSweptWhileItMoves() {
        BladeAnimator animator = new BladeAnimator();
        Map<Integer, Integer> selections = allSet();
        assertEquals(Set.of(), animator.adopt(selections, 0, true), "the first sync adopts, nothing moves");
        assertEquals(Set.of(), animator.due(16, node -> true));

        selections.put(7, 2);
        assertEquals(Set.of(7), animator.adopt(selections, 1000, false));
        for (long t = 1000; t < 1000 + BladeAnimator.DURATION_MS; t += 16) {
            assertEquals(Set.of(7), animator.due(t, node -> true), "frame at " + t);
        }
        assertEquals(Set.of(7), animator.due(1000 + BladeAnimator.DURATION_MS, node -> true),
                "once more at rest");
        assertFalse(animator.moving(7));
        assertEquals(Set.of(), animator.due(1000 + BladeAnimator.DURATION_MS + 16, node -> true));
    }

    @Test
    void aThrowOutOfSightIsSweptOnlyAtRest() {
        BladeAnimator animator = new BladeAnimator();
        Map<Integer, Integer> selections = allSet();
        animator.adopt(selections, 0, true);
        selections.put(3, 2);
        animator.adopt(selections, 100, false);

        assertTrue(animator.moving(3));
        assertEquals(Set.of(), animator.due(150, node -> false));
        assertEquals(Set.of(), animator.due(400, node -> false));
        assertEquals(Set.of(3), animator.due(700, node -> false), "the end of the throw, drawn or not");
        assertEquals(Set.of(), animator.due(716, node -> false));
    }

    @Test
    void bladesEaseFromTheOldSettingToTheNew() {
        BladeAnimator animator = new BladeAnimator();
        animator.adopt(Map.of(), 0, true);
        // leg 10 selected (counter 0), then thrown to leg 11 (counter 1)
        assertEquals(0.0, animator.open(5, 10, LEGS, 0, 0), 1.0e-12);
        assertEquals(1.0, animator.open(5, 11, LEGS, 0, 0), 1.0e-12);

        animator.adopt(Map.of(5, 1), 1000, false);
        assertEquals(0.0, animator.open(5, 10, LEGS, 1, 1000), 1.0e-12, "still closed as the throw starts");
        assertEquals(0.5, animator.open(5, 10, LEGS, 1, 1250), 1.0e-12, "halfway");
        assertEquals(0.5, animator.open(5, 11, LEGS, 1, 1250), 1.0e-12);
        assertEquals(1.0, animator.open(5, 10, LEGS, 1, 1500), 1.0e-12);
        assertEquals(0.0, animator.open(5, 11, LEGS, 1, 1500), 1.0e-12);

        animator.due(1500, node -> true);
        assertEquals(1.0, animator.open(5, 10, LEGS, 1, 1600), 1.0e-12, "at rest after the throw");
    }

    @Test
    void aSwitchSetBackToZeroMoves() {
        BladeAnimator animator = new BladeAnimator();
        animator.adopt(Map.of(4, 1), 0, true);
        assertEquals(Set.of(4), animator.adopt(Map.of(), 100, false), "a counter back to 0 drops out of the map");
    }

    @Test
    void clearForgetsEverySwitch() {
        BladeAnimator animator = new BladeAnimator();
        animator.adopt(Map.of(), 0, true);
        animator.adopt(Map.of(9, 1), 10, false);
        assertTrue(animator.moving(9));

        animator.clear();
        assertFalse(animator.moving(9));
        assertEquals(Set.of(), animator.due(20, node -> true));
        assertEquals(Set.of(), animator.adopt(Map.of(9, 1), 30, true), "a new first sync after the clear");
        assertEquals(Set.of(), animator.adopt(Map.of(9, 1), 40, false), "and 9 is known as set");
    }
}
