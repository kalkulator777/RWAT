package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import com.google.gson.JsonParser;

/**
 * The pack-fed stock registry (SPEC §6.4/§6.5): aliases, placeholders, the
 * default consist; the server's load and its own client's sync sharing it in
 * single player (D2).
 */
class WagonTypesTest {

    private static WagonType type(String id, boolean cab, boolean boardable) {
        return new WagonType(id, 20.0, new double[]{7.0, -7.0}, 40.0, 100.0,
                WagonType.Resistance.NONE,
                cab ? new WagonType.Traction(1000.0, 200.0) : null,
                cab ? new WagonType.Cab() : null,
                WagonType.Brakes.NONE,
                boardable ? new WagonType.Interior(-1, 1, -9, 1, 4, 9) : null);
    }

    /** A full declaration: every section a type can have, so a copy has to match field by field. */
    private static final String FULL = """
            {
              "length": 18.125,
              "bogies": [4.4375, -4.4375],
              "mass_t": 123.0,
              "max_speed_kmh": 95.0,
              "resistance": { "a": 2500.0, "b": 100.0, "c": 12.0 },
              "traction": { "power_kw": 994.0, "max_tractive_effort_kn": 226.0 },
              "cab": { "seats": [ { "at": [-0.84, 2.937, 7.5] }, { "at": [0.856, 2.937, -7.512], "yaw": 180 } ] },
              "brakes": { "train_kn": 160.0, "independent_kn": 90.0, "parking_kn": 30.0 },
              "interior": [
                { "min": [-1.44, 2.311, -5.5], "max": [1.44, 4.37, -4.45] },
                { "min": [0.875, 2.311, -3.44], "max": [1.625, 5.0, 8.312] }
              ],
              "doors": [
                { "id": "door1", "min": [1.47, 2.3, 7.0], "max": [1.56, 4.3, 7.8], "group": "DrR" },
                { "id": "door2", "min": [0.938, 2.374, -3.562], "max": [1.5, 4.382, -3.438], "inner": true },
                { "id": "step1", "min": [1.56, 1.0, 7.6], "max": [1.66, 3.0, 8.31], "fixed": true }
              ],
              "couplers": { "front": -0.12, "rear": -0.337 }
            }""";

    /** A declaration read anew each call: equal values, none of the same objects — as a decoded sync. */
    private static WagonType parse(String id, String json) {
        return WagonTypeParser.parse(id, JsonParser.parseString(json).getAsJsonObject());
    }

    /** A walkable car with these doors, in this order. */
    private static WagonType withDoors(String id, String... doorIds) {
        List<WagonType.Door> doors = new ArrayList<>();
        for (int i = 0; i < doorIds.length; i++) {
            doors.add(new WagonType.Door(doorIds[i], 1.4, 1.0, i, 1.5, 3.0, i + 0.8));
        }
        return new WagonType(id, 20.0, new double[]{7.0, -7.0}, 40.0, 100.0, WagonType.Resistance.NONE,
                null, null, WagonType.Brakes.NONE, new WagonType.Interior(-1, 1, -9, 1, 4, 9), doors);
    }

    @AfterEach
    void clear() {
        WagonTypes.load(Map.of(), Map.of());
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

    // --- D2: the integrated server and its own client share the registry ---

    /**
     * Single player: the server loads its types with their aliases, then its
     * own client's sync brings the same types decoded anew and no aliases.
     * The alias must still resolve — an item or a save with the old id is
     * used on that very server — and the server keeps its own instances.
     */
    @Test
    void ownClientsSyncKeepsTheServersAliasesAndInstances() {
        WagonType loco = parse("mvp:chme3", FULL);
        WagonTypes.load(Map.of(loco.id(), loco), Map.of("rwat:chme3", "mvp:chme3"));

        WagonType synced = parse("mvp:chme3", FULL);
        assertNotSame(loco, synced);
        WagonTypes.load(Map.of(synced.id(), synced));

        assertSame(loco, WagonTypes.byId("rwat:chme3"), "the old id still finds the type");
        assertSame(loco, WagonTypes.byId("mvp:chme3"), "the server's instance, not the decoded copy");
    }

    /**
     * A sync that isn't this JVM's server's layer — a remote server, or one
     * that declares otherwise — replaces the types; it brings no aliases and
     * takes none away that can still resolve.
     */
    @Test
    void anotherServersSyncReplacesTheTypes_aliasesStayWhileTheirTypeDoes() {
        WagonType loco = type("mvp:chme3", true, false);
        WagonType coach = type("mvp:coach", false, true);
        WagonTypes.load(Map.of(loco.id(), loco, coach.id(), coach),
                Map.of("rwat:chme3", "mvp:chme3", "rwat:plazkart", "mvp:coach"));

        WagonType otherLoco = new WagonType("mvp:chme3", 19.0, new double[]{5.0, -5.0}, 120.0, 95.0,
                WagonType.Resistance.NONE, null, new WagonType.Cab(), WagonType.Brakes.NONE, null);
        WagonTypes.load(Map.of(otherLoco.id(), otherLoco));

        assertSame(otherLoco, WagonTypes.byId("mvp:chme3"));
        assertSame(otherLoco, WagonTypes.byId("rwat:chme3"), "an alias whose type is there stays");
        assertNull(WagonTypes.byId("mvp:coach"));
        assertNull(WagonTypes.byId("rwat:plazkart"), "an alias whose type is gone goes with it");
    }

    /** A sync the server's next load overtook (two quick /reloads) is put right by the sync after it. */
    @Test
    void aStaleSyncIsPutRightByTheNext() {
        WagonType first = type("a:car", false, true);
        WagonTypes.load(Map.of(first.id(), first), Map.of("old:car", "a:car"));
        WagonType second = withDoors("a:car", "door1");
        WagonTypes.load(Map.of(second.id(), second), Map.of("old:car", "a:car"));

        WagonTypes.load(Map.of(first.id(), type("a:car", false, true))); // the first load's sync, late
        WagonTypes.load(Map.of(second.id(), withDoors("a:car", "door1"))); // the second's
        assertSame(second, WagonTypes.byId("old:car"));
    }

    @Test
    void declarationsCompareByValue() {
        assertTrue(WagonTypes.sameDeclaration(parse("x:y", FULL), parse("x:y", FULL)));
        assertFalse(WagonTypes.sameDeclaration(parse("x:y", FULL), parse("x:z", FULL)));
        assertFalse(WagonTypes.sameDeclaration(parse("x:y", FULL),
                parse("x:y", FULL.replace("[4.4375, -4.4375]", "[4.5, -4.4375]"))));
        assertFalse(WagonTypes.sameDeclaration(parse("x:y", FULL),
                parse("x:y", FULL.replace("\"DrR\"", "\"DrL\""))));
        assertFalse(WagonTypes.sameDeclaration(parse("x:y", FULL), null));
        assertTrue(WagonTypes.sameTypes(Map.of("x:y", parse("x:y", FULL)), Map.of("x:y", parse("x:y", FULL))));
        assertFalse(WagonTypes.sameTypes(Map.of("x:y", parse("x:y", FULL)), Map.of()));
    }

    /** What the server syncs to a joining player is what it loaded, whatever its own client's sync left. */
    @Test
    void theServerSyncsWhatItLoaded() {
        WagonType car = type("a:car", false, true);
        WagonTypes.load(Map.of(car.id(), car), Map.of());
        WagonTypes.load(Map.of("b:other", type("b:other", false, false)));
        assertEquals(Map.of(car.id(), car), WagonTypes.loadedTypes());
    }
}
