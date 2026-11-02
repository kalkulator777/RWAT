package com.muzhik17.trainsmod.consist;

/**
 * Who may touch a wagon, and from where (SPEC §9.2–§9.3): the one rule the
 * server decides every player's click, drag and step by, and the client
 * hints by — it outlines red, names the reason and doesn't send what the
 * server would refuse. Each side gathers the {@link Facts} its own way
 * ({@link WagonTouch}); the rule is the same. Pure.
 *
 * <ul>
 * <li><b>In the game:</b> a spectator or a dead player touches nothing.
 * <li><b>Where from:</b> a door, a coupler (the crowbar in hand) or a bogie
 *     within reach of that part — a bogie never from aboard a car (aboard,
 *     the world is out of reach); a switch aboard its car or within reach of
 *     the car; a driver's chair aboard and within sitting reach; a lever, the
 *     driver's panel and the walk only aboard. The handbrake by its wheel
 *     only aboard its car, by the crowbar within reach of the car's body —
 *     never a wheel across the yard.
 * <li><b>What changes the world</b> — uncoupling a train, a blow at a bogie —
 *     wants the right to build there: not in adventure mode, not under spawn
 *     protection.
 * <li><b>The driver's key</b>, when the server wants it ({@code cab_access =
 *     KEY}): a door into a cab; a switch, chair, lever, the panel or the
 *     handbrake wheel of a car with a cab. The crowbar is a tool of its own:
 *     uncoupling and the handbrake by crowbar want no key.
 * </ul>
 *
 * <p>Checked in that order, so a refusal names the first thing in the way:
 * where to go before the key.
 */
public final class TouchRules {

    private TouchRules() {
    }

    /** What a player does to a wagon. */
    public enum Action {
        /** Open or close a door by its leaf. */
        DOOR,
        /** Cut the train at a coupler with the crowbar. */
        UNCOUPLE,
        /** Set or release the car's handbrake: its wheel, or the crowbar on its body. */
        HANDBRAKE,
        /** Flip a switch, a window, a button of the car: its control group. */
        SWITCH,
        /** A {@code GLOBAL} switch: its group on every car of the train. */
        GLOBAL_SWITCH,
        /** Sit down in a driver's chair. */
        SEAT,
        /** Move a handle lever (or drive by the keys). */
        LEVER,
        /** The driver's panel: the doors and lights of the whole train. */
        PANEL,
        /** A walk step about the car's floor. */
        WALK,
        /** A blow at a bogie (it wears the car down, then breaks it). */
        STRIKE
    }

    /** Why not; the first thing in the way. */
    public enum Refusal {
        /** A spectator or a dead player: out of the game. */
        SPECTATOR,
        /** Uncoupling without the crowbar in hand. */
        NO_TOOL,
        /** Not where the action is done from (aboard, within reach). */
        OUT_OF_REACH,
        /** The action changes the world where the player may not build. */
        MAY_NOT_BUILD,
        /** The driver's key is needed. */
        NEED_KEY
    }

    /**
     * What holds of the player and the wagon they touch.
     *
     * @param present     alive and not a spectator
     * @param mayBuild    may change the world here (not adventure mode; on
     *                    the server, not under spawn protection where the part is)
     * @param keyed       may work a cab: the driver's key, or no key wanted
     *                    ({@code CabAccess.mayWork})
     * @param crowbar     the crowbar in the main hand
     * @param aboard      riding this car
     * @param aboardWagon riding any car
     * @param inReach     the touched part within reach (a chair: within sitting reach)
     * @param cabCar      the car has a cab
     * @param cabDoor     the door touched leads into a cab
     */
    public record Facts(boolean present, boolean mayBuild, boolean keyed, boolean crowbar,
            boolean aboard, boolean aboardWagon, boolean inReach,
            boolean cabCar, boolean cabDoor) {

        /** The player's own facts; aboard nothing, nothing in reach, no cab. */
        public static Facts of(boolean present, boolean mayBuild, boolean keyed, boolean crowbar) {
            return new Facts(present, mayBuild, keyed, crowbar, false, false, false, false, false);
        }

        /** Riding this car ({@code car}) or any car ({@code anyWagon}; riding this one is riding one). */
        public Facts aboard(boolean car, boolean anyWagon) {
            return new Facts(present, mayBuild, keyed, crowbar, car, car || anyWagon, inReach,
                    cabCar, cabDoor);
        }

        /** The touched part within reach. */
        public Facts inReach(boolean reach) {
            return new Facts(present, mayBuild, keyed, crowbar, aboard, aboardWagon, reach,
                    cabCar, cabDoor);
        }

        /** And may change the world just here (spawn protection, a claimed region) — on top of {@link #mayBuild}. */
        public Facts mayBuildHere(boolean here) {
            return new Facts(present, mayBuild && here, keyed, crowbar, aboard, aboardWagon, inReach,
                    cabCar, cabDoor);
        }

        /** The car has a cab. */
        public Facts cab(boolean car) {
            return new Facts(present, mayBuild, keyed, crowbar, aboard, aboardWagon, inReach,
                    car, cabDoor);
        }

        /** The door touched leads into a cab. */
        public Facts cabDoor(boolean door) {
            return new Facts(present, mayBuild, keyed, crowbar, aboard, aboardWagon, inReach,
                    cabCar, door);
        }
    }

    /** True if the player may do {@code action}. */
    public static boolean allows(Action action, Facts facts) {
        return check(action, facts) == null;
    }

    /** Why the player may not do {@code action} — the first thing in the way; null if they may. */
    public static Refusal check(Action action, Facts facts) {
        if (!facts.present()) {
            return Refusal.SPECTATOR;
        }
        if (action == Action.UNCOUPLE && !facts.crowbar()) {
            return Refusal.NO_TOOL;
        }
        if (!reaches(action, facts)) {
            return Refusal.OUT_OF_REACH;
        }
        if (changesWorld(action) && !facts.mayBuild()) {
            return Refusal.MAY_NOT_BUILD;
        }
        if (needsKey(action, facts) && !facts.keyed()) {
            return Refusal.NEED_KEY;
        }
        return null;
    }

    /** True if the action is done from where the player is. */
    private static boolean reaches(Action action, Facts facts) {
        return switch (action) {
            case DOOR, UNCOUPLE -> facts.inReach();
            case HANDBRAKE -> facts.crowbar() ? facts.inReach() : facts.aboard();
            case SWITCH, GLOBAL_SWITCH -> facts.aboard() || facts.inReach();
            case SEAT -> facts.aboard() && facts.inReach();
            case LEVER, PANEL, WALK -> facts.aboard();
            case STRIKE -> !facts.aboardWagon() && facts.inReach();
        };
    }

    /** True if the action changes the world: a train cut in two, a car worn down and broken. */
    public static boolean changesWorld(Action action) {
        return action == Action.UNCOUPLE || action == Action.STRIKE;
    }

    /** True if the action wants the driver's key (when the server wants one at all). */
    private static boolean needsKey(Action action, Facts facts) {
        return switch (action) {
            case DOOR -> facts.cabDoor();
            case SWITCH, GLOBAL_SWITCH, SEAT, LEVER, PANEL -> facts.cabCar();
            case HANDBRAKE -> !facts.crowbar() && facts.cabCar();
            case UNCOUPLE, WALK, STRIKE -> false;
        };
    }
}
