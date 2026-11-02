package com.muzhik17.trainsmod.consist;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.consist.TouchRules.Action;
import com.muzhik17.trainsmod.consist.TouchRules.Facts;
import com.muzhik17.trainsmod.consist.TouchRules.Refusal;

/**
 * Who may touch a wagon (SPEC §9.2–§9.3): the rule the server decides by and
 * the client hints by. The cases of the audit are here as they were played:
 * a spectator opening doors and cutting trains (M1), a handbrake wheel
 * turned from 15 blocks away, outside the car (M3).
 */
class TouchRulesTest {

    /** A player in survival with the key, nothing in hand, aboard nothing. */
    private static Facts player() {
        return Facts.of(true, true, true, false);
    }

    /** A player in survival without the driver's key the server wants. */
    private static Facts keyless() {
        return Facts.of(true, true, false, false);
    }

    @Test
    void aSpectatorTouchesNothing_evenWithEverythingElseInPlace() {
        Facts spectator = Facts.of(false, true, true, true).aboard(true, true).inReach(true);
        for (Action action : Action.values()) {
            assertEquals(Refusal.SPECTATOR, TouchRules.check(action, spectator), action.name());
        }
    }

    /** M1: a spectator in reach of a coach's door and coupler, the crowbar in hand. */
    @Test
    void aSpectatorNeitherOpensADoorNorUncouples() {
        Facts spectator = Facts.of(false, true, true, true).inReach(true);
        assertFalse(TouchRules.allows(Action.DOOR, spectator));
        assertFalse(TouchRules.allows(Action.UNCOUPLE, spectator));
        assertFalse(TouchRules.allows(Action.HANDBRAKE, spectator));
    }

    /**
     * M3: the wheel was turned by anyone within the car's half-length plus
     * reach of its centre — 15 blocks off a long coach, outside it. Now the
     * wheel only from aboard.
     */
    @Test
    void theHandbrakeWheel_onlyFromAboardTheCar() {
        assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(Action.HANDBRAKE, player().inReach(true)));
        assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(Action.HANDBRAKE,
                player().aboard(false, true).inReach(true)), "aboard another car of the train");
        assertNull(TouchRules.check(Action.HANDBRAKE, player().aboard(true, true)));
    }

    @Test
    void theHandbrakeByCrowbar_withinReachOfTheBody_withoutTheKey() {
        Facts crowbar = Facts.of(true, true, false, true).cab(true);
        assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(Action.HANDBRAKE, crowbar));
        assertNull(TouchRules.check(Action.HANDBRAKE, crowbar.inReach(true)), "the crowbar wants no key");
    }

    @Test
    void theHandbrakeWheelOfACarWithACab_wantsTheKey() {
        assertEquals(Refusal.NEED_KEY, TouchRules.check(Action.HANDBRAKE,
                keyless().aboard(true, true).cab(true)));
        assertNull(TouchRules.check(Action.HANDBRAKE, keyless().aboard(true, true)), "a coach's wheel");
    }

    @Test
    void aSwitch_aboardItsCarOrWithinReach() {
        assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(Action.SWITCH, player()));
        assertNull(TouchRules.check(Action.SWITCH, player().aboard(true, true)));
        assertNull(TouchRules.check(Action.SWITCH, player().inReach(true)));
        assertEquals(Refusal.NEED_KEY, TouchRules.check(Action.SWITCH, keyless().inReach(true).cab(true)));
    }

    @Test
    void aDoor_withinReach_theKeyOnlyForADoorIntoACab() {
        assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(Action.DOOR, player().aboard(true, true)),
                "aboard, but the leaf at the other end of the car");
        Facts byALocosDoor = keyless().inReach(true).cab(true);
        assertNull(TouchRules.check(Action.DOOR, byALocosDoor), "a passengers' door of a car with a cab");
        assertEquals(Refusal.NEED_KEY, TouchRules.check(Action.DOOR, byALocosDoor.cabDoor(true)));
    }

    @Test
    void uncoupling_wantsTheCrowbar_theReach_andTheRightToBuild_butNoKey() {
        Facts crowbar = Facts.of(true, true, false, true).cab(true);
        assertEquals(Refusal.NO_TOOL, TouchRules.check(Action.UNCOUPLE, player().inReach(true)));
        assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(Action.UNCOUPLE, crowbar));
        assertNull(TouchRules.check(Action.UNCOUPLE, crowbar.inReach(true)));
        assertEquals(Refusal.MAY_NOT_BUILD, TouchRules.check(Action.UNCOUPLE,
                Facts.of(true, false, true, true).inReach(true)), "adventure mode");
        assertEquals(Refusal.MAY_NOT_BUILD, TouchRules.check(Action.UNCOUPLE,
                crowbar.inReach(true).mayBuildHere(false)), "spawn protection at the coupler");
    }

    @Test
    void aBlowAtABogie_neverFromAboard_andOnlyWhereThePlayerMayBuild() {
        assertNull(TouchRules.check(Action.STRIKE, player().inReach(true)));
        assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(Action.STRIKE, player().inReach(true).aboard(false, true)),
                "riding another car");
        assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(Action.STRIKE, player()));
        assertEquals(Refusal.MAY_NOT_BUILD, TouchRules.check(Action.STRIKE,
                Facts.of(true, false, true, false).inReach(true)));
        assertNull(TouchRules.check(Action.STRIKE, keyless().inReach(true).cab(true)), "no key for a blow");
    }

    @Test
    void aChair_aboardAndWithinSittingReach_withTheKey() {
        assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(Action.SEAT, player().aboard(true, true)));
        assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(Action.SEAT, player().inReach(true)));
        assertNull(TouchRules.check(Action.SEAT, player().aboard(true, true).inReach(true).cab(true)));
        assertEquals(Refusal.NEED_KEY, TouchRules.check(Action.SEAT,
                keyless().aboard(true, true).inReach(true).cab(true)));
    }

    @Test
    void leversThePanelAndTheWalk_onlyFromAboard() {
        for (Action action : new Action[] {Action.LEVER, Action.PANEL, Action.WALK}) {
            assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(action, player().inReach(true)), action.name());
            assertNull(TouchRules.check(action, player().aboard(true, true).cab(true)), action.name());
        }
        assertEquals(Refusal.NEED_KEY, TouchRules.check(Action.LEVER, keyless().aboard(true, true).cab(true)));
        assertNull(TouchRules.check(Action.WALK, keyless().aboard(true, true).cab(true)),
                "walking a cab wants no key: its doors keep the keyless out");
    }

    @Test
    void whereToGoIsNamedBeforeTheKey() {
        assertEquals(Refusal.OUT_OF_REACH, TouchRules.check(Action.LEVER, keyless().cab(true)));
    }

    @Test
    void onlyUncouplingAndBlowsChangeTheWorld() {
        for (Action action : Action.values()) {
            assertEquals(action == Action.UNCOUPLE || action == Action.STRIKE, TouchRules.changesWorld(action),
                    action.name());
        }
        // adventure mode works doors, switches and chairs, as vanilla's doors and buttons
        Facts adventure = Facts.of(true, false, true, false).aboard(true, true).inReach(true);
        assertTrue(TouchRules.allows(Action.DOOR, adventure));
        assertTrue(TouchRules.allows(Action.SWITCH, adventure));
        assertTrue(TouchRules.allows(Action.SEAT, adventure));
        assertTrue(TouchRules.allows(Action.WALK, adventure));
    }
}
