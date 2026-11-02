package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonSyntaxException;

/** The JSON declaration format of SPEC §5.1 / §5.5 step 5. */
class WagonTypeParserTest {

    private static JsonObject json(String text) {
        return JsonParser.parseString(text).getAsJsonObject();
    }

    /** The MVP pack's chme3.json shape: every section present. */
    @Test
    void parsesFullLocomotiveDeclaration() {
        WagonType type = WagonTypeParser.parse("rwat:chme3", json("""
                {
                  "length": 18.125,
                  "bogies": [4.4375, -4.4375],
                  "mass_t": 123.0,
                  "max_speed_kmh": 95.0,
                  "resistance": { "a": 2500.0, "b": 100.0, "c": 12.0 },
                  "traction": { "power_kw": 994.0, "max_tractive_effort_kn": 226.0 },
                  "cab": {},
                  "brakes": { "train_kn": 160.0, "independent_kn": 90.0, "parking_kn": 30.0 }
                }"""));

        assertEquals("rwat:chme3", type.id());
        assertEquals(18.125, type.length());
        assertArrayEquals(new double[]{4.4375, -4.4375}, type.bogieOffsets());
        assertEquals(123.0, type.massT());
        assertEquals(95.0, type.maxSpeedKmh());
        // the declared Davis terms; the nose drag nobody declared is the engine's
        assertEquals(new WagonType.Resistance(2500.0, 100.0, 12.0,
                StockDefaults.resistance(123.0).cFront()), type.resistance());
        assertNotNull(type.traction());
        assertEquals(994.0, type.traction().powerKw());
        assertEquals(226.0, type.traction().maxTractiveEffortKn());
        assertTrue(type.powered());
        assertTrue(type.drivable());
        // declared forces kept; no dynamic brake; the passenger system's timing
        assertEquals(new WagonType.Brakes(160.0, 90.0, 0.0, 0.0, 30.0), type.brakes());
        assertEquals(1.0, type.traction().adhesion());
        assertEquals(StockDefaults.TRACTION_RAMP_S, type.traction().rampS());
    }

    /** Coupler offsets (SPEC §6.12): optional, each end defaults to the frame end. */
    @Test
    void parsesCouplerOffsets() {
        String base = """
                  "length": 25.125,
                  "bogies": [8.0, -8.0],
                  "mass_t": 50.0,
                  "max_speed_kmh": 120.0""";
        WagonType declared = WagonTypeParser.parse("test:car", json(
                "{" + base + ", \"couplers\": { \"front\": -0.12, \"rear\": -0.337 } }"));
        assertEquals(new WagonType.Couplers(-0.12, -0.337), declared.couplers());
        assertEquals(12.4425, declared.couplerReach(true), 1.0e-9);
        assertEquals(12.2255, declared.couplerReach(false), 1.0e-9);

        WagonType oneEnd = WagonTypeParser.parse("test:car", json(
                "{" + base + ", \"couplers\": { \"rear\": -0.2 } }"));
        assertEquals(new WagonType.Couplers(0.0, -0.2), oneEnd.couplers());

        WagonType none = WagonTypeParser.parse("test:car", json("{" + base + "}"));
        assertEquals(WagonType.Couplers.AT_ENDS, none.couplers());
        assertEquals(12.5625, none.couplerReach(true), 1.0e-9);
    }

    /** Capabilities are section presence: a freight car declares neither. */
    @Test
    void minimalDeclarationIsUnpoweredUndrivable() {
        WagonType type = WagonTypeParser.parse("test:boxcar", json("""
                {
                  "length": 14.0,
                  "bogies": [5.0, -5.0],
                  "mass_t": 22.0,
                  "max_speed_kmh": 100.0
                }"""));

        assertFalse(type.powered());
        assertFalse(type.drivable());
        // physics the pack left out is the engine's, not zero (SPEC §6.4)
        assertEquals(StockDefaults.resistance(22.0), type.resistance());
        assertEquals(StockDefaults.brakes(StockDefaults.BrakeSystem.PASSENGER, 22.0, false),
                type.brakes());
    }

    /** The smallest wagon: geometry and mass; no design speed = it limits nothing. */
    @Test
    void smallestDeclaration_takesEveryPhysicsDefault() {
        WagonType type = WagonTypeParser.parse("test:car", json("""
                { "length": 17.75, "bogies": [5.86, -5.86], "mass_t": 24.0 }"""));

        assertEquals(0.0, type.maxSpeedKmh(), "no design speed declared");
        assertTrue(type.resistance().a() > 0.0 && type.resistance().c() > 0.0);
        assertTrue(type.resistance().cFront() > 0.0, "a nose to lead with");
        assertEquals(24.0 * StockDefaults.BrakeSystem.PASSENGER.knPerTonne(),
                type.brakes().trainKn(), 1.0e-9);
        assertTrue(type.brakes().parkingKn() > 0.0, "a handbrake");
        assertEquals(0.0, type.brakes().independentKn(), "no cab, no loco brake");
    }

    /** A brake system sets force per tonne and timing; declared fields override it. */
    @Test
    void brakeSystem_presetsAndOverrides() {
        WagonType freight = WagonTypeParser.parse("test:car", json("""
                { "length": 14.0, "bogies": [5.0, -5.0], "mass_t": 20.0,
                  "brakes": { "system": "freight", "apply_s": 20.0 } }"""));
        StockDefaults.BrakeSystem system = StockDefaults.BrakeSystem.FREIGHT;
        assertEquals(20.0 * system.knPerTonne(), freight.brakes().trainKn(), 1.0e-9);
        assertEquals(20.0, freight.brakes().applyS(), "declared timing wins");
        assertEquals(system.releaseS(), freight.brakes().releaseS());

        WagonType loco = WagonTypeParser.parse("test:loco", json("""
                { "length": 14.0, "bogies": [5.0, -5.0], "mass_t": 80.0, "cab": {},
                  "traction": { "power_kw": 500, "max_tractive_effort_kn": 150,
                                "adhesion": 1.2, "ramp_s": 2.0 } }"""));
        assertTrue(loco.brakes().independentKn() > 0.0, "a cab gets a loco brake");
        assertEquals(1.2, loco.traction().adhesion());
        assertEquals(2.0, loco.traction().rampS());
    }

    /** An explicit zero stays zero: the way to declare an unbraked wagon or a frictionless one. */
    @Test
    void explicitZero_isNotTheDefault() {
        WagonType type = WagonTypeParser.parse("test:car", json("""
                { "length": 14.0, "bogies": [5.0, -5.0], "mass_t": 20.0,
                  "brakes": { "train_kn": 0, "parking_kn": 0 },
                  "resistance": { "c_front": 0 } }"""));
        assertEquals(0.0, type.brakes().trainKn());
        assertEquals(0.0, type.brakes().parkingKn());
        assertEquals(0.0, type.resistance().cFront());
        assertEquals(StockDefaults.resistance(20.0).a(), type.resistance().a(), "the rest defaulted");
    }

    /** Typos that would reach the physics are refused with the field named. */
    @Test
    void badPhysicsValues_areRejected() {
        String base = "\"length\": 14.0, \"bogies\": [5.0, -5.0]";
        assertThrows(JsonSyntaxException.class, () -> WagonTypeParser.parse("test:car",
                json("{" + base + ", \"mass_t\": 0}")));
        assertThrows(JsonSyntaxException.class, () -> WagonTypeParser.parse("test:car",
                json("{" + base + ", \"mass_t\": 20, \"max_speed_kmh\": -1}")));
        assertThrows(JsonSyntaxException.class, () -> WagonTypeParser.parse("test:car",
                json("{" + base + ", \"mass_t\": 20, \"brakes\": {\"system\": \"magnetic\"}}")));
        assertThrows(JsonSyntaxException.class, () -> WagonTypeParser.parse("test:car",
                json("{" + base + ", \"mass_t\": 20, \"traction\": {\"power_kw\": 100}}")));
    }

    /** The shipped plazkart.json door list: order is the door index, ids kept. */
    @Test
    void parsesDoorsInOrder() {
        WagonType type = WagonTypeParser.parse("rwat:plazkart", json("""
                {
                  "length": 25.125,
                  "bogies": [8.5, -8.5],
                  "mass_t": 53.0,
                  "max_speed_kmh": 120.0,
                  "interior": { "min": [-1.35, 1.81, -11.75], "max": [1.35, 4.55, 11.75] },
                  "doors": [
                    { "id": "door1", "min": [1.47, 1.81, 10.87], "max": [1.56, 3.81, 11.69] },
                    { "id": "door3", "min": [-1.56, 1.81, -11.69], "max": [-1.47, 3.81, -10.87] }
                  ]
                }
                """));
        assertEquals(2, type.doors().size());
        assertEquals("door1", type.doors().get(0).id());
        assertEquals("door3", type.doors().get(1).id());
        assertEquals(-11.69, type.doors().get(1).minZ(), 1.0e-9);
        assertTrue(type.doorsOnly());
    }

    @Test
    void doorWithoutIdThrows() {
        assertThrows(JsonSyntaxException.class, () -> WagonTypeParser.parse("test:bad", json("""
                { "length": 10, "bogies": [3, -3], "mass_t": 10, "max_speed_kmh": 60,
                  "doors": [ { "min": [0, 0, 0], "max": [1, 1, 1] } ] }
                """)));
    }

    @Test
    void missingRequiredFieldThrows() {
        // geometry and mass are required; the design speed no longer is (SPEC §6.4)
        assertThrows(JsonSyntaxException.class, () -> WagonTypeParser.parse("test:bad",
                json("""
                        { "length": 10.0, "bogies": [3.0, -3.0], "max_speed_kmh": 60.0 }""")));
    }

    @Test
    void aliasesAreReadSeparatelyFromTheType() {
        JsonObject declaration = json("""
                { "length": 10, "bogies": [3, -3], "mass_t": 10, "max_speed_kmh": 60,
                  "aliases": ["rwat:chme3", "old:loco"] }
                """);
        assertEquals(java.util.List.of("rwat:chme3", "old:loco"), WagonTypeParser.aliases(declaration));
        assertEquals("mvp:chme3", WagonTypeParser.parse("mvp:chme3", declaration).id());
        assertTrue(WagonTypeParser.aliases(json("{}")).isEmpty());
    }

    @Test
    void emptyBogieListThrows() {
        assertThrows(JsonSyntaxException.class, () -> WagonTypeParser.parse("test:bad",
                json("""
                        { "length": 10.0, "bogies": [], "mass_t": 20.0, "max_speed_kmh": 60.0 }""")));
    }

    /** A walkable loco (SPEC §9.1): floor zones, inner doors, fixed openings, the driver's chair. */
    @Test
    void parsesCabFloorDoorsAndSeat() {
        WagonType type = WagonTypeParser.parse("mvp:chme3", json("""
                {
                  "length": 18.125,
                  "bogies": [4.4375, -4.4375],
                  "mass_t": 123.0,
                  "max_speed_kmh": 95.0,
                  "cab": { "seat": [-1.062, 3.092, -4.654], "seat_yaw": 0 },
                  "interior": [
                    { "min": [-1.44, 2.311, -5.5], "max": [1.44, 4.37, -4.45] },
                    { "min": [0.875, 2.311, -3.44], "max": [1.625, 5.0, 8.312] }
                  ],
                  "doors": [
                    { "id": "door2", "min": [0.938, 2.374, -3.562], "max": [1.5, 4.382, -3.438], "inner": true },
                    { "id": "step1", "min": [1.56, 1.0, 7.6], "max": [1.66, 3.0, 8.31], "fixed": true }
                  ]
                }"""));

        assertEquals(2, type.interior().zones().size());
        assertEquals(-5.5, type.interior().minZ(), 1.0e-9);
        assertEquals(8.312, type.interior().maxZ(), 1.0e-9);
        assertTrue(type.doors().get(0).inner());
        assertFalse(type.doors().get(0).fixed());
        assertTrue(type.doors().get(1).fixed());
        assertTrue(type.doorsOnly(), "the steps are a way in");
        assertEquals(1, type.cab().seats().size(), "the one-chair form still reads");
        assertEquals(-4.654, type.cab().seats().get(0).z(), 1.0e-9);
        assertTrue(type.drivable() && type.boardable());
    }

    /**
     * Several driver's chairs (SPEC §9): the assistant's beside the driver's,
     * the other end's cab looking back — from there the train's forward is
     * the model's rear.
     */
    @Test
    void parsesSeveralChairs() {
        WagonType type = WagonTypeParser.parse("mvp:m62", json("""
                {
                  "length": 17.5, "bogies": [4.4, -4.4], "mass_t": 116,
                  "cab": { "seats": [
                    { "at": [-0.84, 2.937, 7.5] },
                    { "at": [1.106, 2.937, 7.487], "yaw": 0 },
                    { "at": [0.856, 2.937, -7.512], "yaw": 180 },
                    { "at": [1.074, 3.153, -3.942], "yaw": 90 }
                  ] }
                }"""));
        assertEquals(4, type.cab().seats().size());
        assertEquals(1.106, type.cab().seats().get(1).x(), 1.0e-9);
        assertFalse(type.cab().seats().get(0).facesBack());
        assertTrue(type.cab().seats().get(2).facesBack());
        assertFalse(type.cab().seats().get(3).facesBack(), "square to the side counts as forward");
        assertFalse(type.cab().seats().get(2).inFrame(true).facesBack(), "a flipped wagon turns it round");
        assertTrue(WagonTypeParser.parse("x:y", json("""
                { "length": 10, "bogies": [3, -3], "mass_t": 10, "cab": {} }""")).cab().seats().isEmpty());
        assertThrows(JsonSyntaxException.class, () -> WagonTypeParser.parse("x:y", json("""
                { "length": 10, "bogies": [3, -3], "mass_t": 10,
                  "cab": { "seat": [0, 2, 0], "seats": [ { "at": [0, 2, 1] } ] } }""")));
    }

    /** Doors between zones alone are no way in: the right-click board stays. */
    @Test
    void innerDoorsAlone_keepRightClickBoarding() {
        WagonType type = WagonTypeParser.parse("x:y", json("""
                {
                  "length": 10, "bogies": [3, -3], "mass_t": 10, "max_speed_kmh": 50,
                  "interior": { "min": [-1, 1, -4], "max": [1, 3, 4] },
                  "doors": [ { "id": "d", "min": [0.9, 1, 0], "max": [1.0, 3, 0.8], "inner": true } ]
                }"""));
        assertFalse(type.doorsOnly());
        assertEquals(1, type.interior().zones().size());
    }

    // ---- strict reading (fix list D3, D4) ----------------------------------------

    private static final String SMALL = "\"length\": 14.0, \"bogies\": [5.0, -5.0], \"mass_t\": 20.0";

    private static List<String> warnings(String body) {
        List<String> warnings = new ArrayList<>();
        WagonTypeParser.parse("test:car", json("{" + body + "}"), warnings::add);
        return warnings;
    }

    private static String error(String body) {
        return assertThrows(JsonSyntaxException.class,
                () -> WagonTypeParser.parse("test:car", json("{" + body + "}"))).getMessage();
    }

    /** A typo used to mean the engine's default without a word: now a warning naming the key it missed. */
    @Test
    void unknownKey_warnsWithTheNearestKnownOne() {
        assertEquals(List.of("unknown key 'max_speed' (ignored) — did you mean 'max_speed_kmh'?"),
                warnings(SMALL + ", \"max_speed\": 95"));
        assertEquals(List.of("unknown key 'colour' (ignored)"), warnings(SMALL + ", \"colour\": \"red\""));
        // the type still loads, the typo's field at its default
        assertEquals(0.0, WagonTypeParser.parse("test:car", json("{" + SMALL + ", \"max_speed\": 95}"))
                .maxSpeedKmh());
    }

    /** Every section knows its own keys, and the hint is a key of that section. */
    @Test
    void unknownKeysInEverySection_arePathed() {
        List<String> warnings = warnings(SMALL + """
                , "resistance": { "c_frnt": 1 },
                  "traction": { "power_kw": 100, "max_tractive_effort_kn": 50, "ramp": 2 },
                  "brakes": { "trian_kn": 10 },
                  "cab": { "seats": [ { "at": [0, 2, 0], "yaww": 90 } ], "chairs": [] },
                  "interior": [ { "min": [-1, 1, -4], "max": [1, 3, 4], "height": 2 } ],
                  "doors": [ { "id": "d", "min": [1, 1, 0], "max": [1.1, 3, 0.8], "gruop": "L" } ],
                  "couplers": { "front": 0, "back": 0 }""");
        assertEquals(List.of(
                "unknown key 'resistance.c_frnt' (ignored) — did you mean 'resistance.c_front'?",
                "unknown key 'traction.ramp' (ignored) — did you mean 'traction.ramp_s'?",
                "unknown key 'cab.chairs' (ignored)",
                "unknown key 'cab.seats[0].yaww' (ignored) — did you mean 'cab.seats[0].yaw'?",
                "unknown key 'brakes.trian_kn' (ignored) — did you mean 'brakes.train_kn'?",
                "unknown key 'interior[0].height' (ignored)",
                "unknown key 'doors[0].gruop' (ignored) — did you mean 'doors[0].group'?",
                "unknown key 'couplers.back' (ignored)"), warnings);
    }

    /** Roadmap R7: the dynamic brake fields stay, but a pack setting them is told they do nothing. */
    @Test
    void reservedBrakeFields_warn() {
        List<String> warnings = warnings(SMALL + ", \"brakes\": { \"dynamic_kn\": 100, \"dynamic_fade_kmh\": 10 }");
        assertEquals(2, warnings.size());
        assertTrue(warnings.get(0).startsWith("'brakes.dynamic_kn' is reserved"), warnings.get(0));
        assertTrue(warnings.get(1).startsWith("'brakes.dynamic_fade_kmh' is reserved"), warnings.get(1));
    }

    /** A null used to throw a bare UnsupportedOperationException; now an error names field and type. */
    @Test
    void nullOrWrongType_isAnErrorNamingTheField() {
        assertEquals("'mass_t' must be a finite number, got null",
                error("\"length\": 14.0, \"bogies\": [5.0, -5.0], \"mass_t\": null"));
        assertEquals("'brakes.train_kn' must be a finite number, got null",
                error(SMALL + ", \"brakes\": { \"train_kn\": null }"));
        assertEquals("'traction' must be an object, got null", error(SMALL + ", \"traction\": null"));
        assertEquals("'max_speed_kmh' must be a finite number, got the string \"95\"",
                error(SMALL + ", \"max_speed_kmh\": \"95\""));
        assertEquals("'doors[0].inner' must be true or false, got the number 1", error(SMALL
                + ", \"doors\": [ { \"id\": \"d\", \"min\": [1, 1, 0], \"max\": [1.1, 3, 0.8], \"inner\": 1 } ]"));
        assertEquals("'doors[0].min[2]' must be a finite number, got null", error(SMALL
                + ", \"doors\": [ { \"id\": \"d\", \"min\": [1, 1, null], \"max\": [1.1, 3, 0.8] } ]"));
        assertEquals("'cab.seats[1]' must be an object, got the number 3",
                error(SMALL + ", \"cab\": { \"seats\": [ { \"at\": [0, 2, 0] }, 3 ] }"));
        assertEquals("'interior' must be an object {min, max} or an array of them, got null",
                error(SMALL + ", \"interior\": null"));
        assertEquals("'brakes.system' must be a string, got null", error(SMALL + ", \"brakes\": { \"system\": null }"));
        assertEquals("'bogies[1]' must be a finite number, got the number 1e999",
                error("\"length\": 14.0, \"bogies\": [5.0, 1e999], \"mass_t\": 20.0"));
    }

    /** Broken aliases are an error of the declaration, not an exception from deep in GSON. */
    @Test
    void aliasesMustBeStrings() {
        assertEquals("'aliases[1]' must be a string, got null",
                assertThrows(JsonSyntaxException.class, () -> WagonTypeParser.aliases(json(
                        "{ \"aliases\": [\"old:car\", null] }"))).getMessage());
        assertEquals("'aliases' must be an array, got the string \"old:car\"",
                assertThrows(JsonSyntaxException.class, () -> WagonTypeParser.aliases(json(
                        "{ \"aliases\": \"old:car\" }"))).getMessage());
    }

    /** D3: a length that makes no wagon. */
    @Test
    void lengthMustBePositive() {
        assertEquals("'length' must be a positive number of blocks, got 0",
                error("\"length\": 0, \"bogies\": [0.0], \"mass_t\": 20.0"));
        assertTrue(error("\"length\": -14, \"bogies\": [5.0, -5.0], \"mass_t\": 20.0")
                .startsWith("'length' must be a positive number"));
    }

    /** D3: the bogies run front to back (the front one first) and stand inside the body. */
    @Test
    void bogiesRunFrontToBack_insideTheBody() {
        assertEquals("'bogies' must run front to back, each pivot behind the one before:"
                + " 'bogies[1]' = 5 is not behind 'bogies[0]' = -5",
                error("\"length\": 14.0, \"bogies\": [-5.0, 5.0], \"mass_t\": 20.0"));
        assertTrue(error("\"length\": 14.0, \"bogies\": [5.0, 5.0], \"mass_t\": 20.0")
                .startsWith("'bogies' must run front to back"), "two pivots in one place");
        assertEquals("'bogies[1]' = -7.5 is outside the body: a pivot must lie within ±length/2 = ±7",
                error("\"length\": 14.0, \"bogies\": [5.0, -7.5], \"mass_t\": 20.0"));
        assertTrue(error("\"length\": 14.0, \"bogies\": [7.0, -5.0], \"mass_t\": 20.0")
                .startsWith("'bogies[0]' = 7 is outside the body"), "a pivot on the coupler point");
        // one bogie, and three, are fine as long as they keep the order
        WagonTypeParser.parse("test:car", json("{ \"length\": 14.0, \"bogies\": [0.0], \"mass_t\": 20.0 }"));
        WagonTypeParser.parse("test:car", json("{ \"length\": 30.0, \"bogies\": [12, 0, -12], \"mass_t\": 20.0 }"));
    }

    /** D3: a coupler can't engage past the body's middle nor stick out further than half a body. */
    @Test
    void couplerOffsetsStayUnderHalfTheLength() {
        assertEquals("'couplers.front' = -7 must be under length/2 = 7 in size",
                error(SMALL + ", \"couplers\": { \"front\": -7 }"));
        assertEquals("'couplers.rear' = 8.5 must be under length/2 = 7 in size",
                error(SMALL + ", \"couplers\": { \"rear\": 8.5 }"));
        assertEquals(new WagonType.Couplers(-6.9, 6.9), WagonTypeParser.parse("test:car",
                json("{" + SMALL + ", \"couplers\": { \"front\": -6.9, \"rear\": 6.9 } }")).couplers());
    }

    /**
     * {@code "group": ""} is no group: the server used to keep "" and group
     * every such door together, while the client's sync read null.
     */
    @Test
    void emptyDoorGroup_isNoGroup() {
        WagonType type = WagonTypeParser.parse("test:car", json("{" + SMALL + """
                , "doors": [
                    { "id": "a", "min": [1, 1, 0], "max": [1.1, 3, 0.8], "group": "" },
                    { "id": "b", "min": [1, 1, 2], "max": [1.1, 3, 2.8], "group": "" },
                    { "id": "c", "min": [1, 1, 4], "max": [1.1, 3, 4.8], "group": null } ] }"""));
        for (WagonType.Door door : type.doors()) {
            assertNull(door.group(), door.id());
        }
        assertFalse(type.doors().get(0).groupedWith(type.doors().get(1)));
        assertNull(new WagonType.Door("x", 0, 0, 0, 1, 1, 1, false, false, false, "").group());
    }

    /** {@code "group": null} still reads as no group, but format v1 has no null there: a warning says to leave it out. */
    @Test
    void nullDoorGroup_isWarnedAsObsolete() {
        String door = ", \"doors\": [ { \"id\": \"c\", \"min\": [1, 1, 4], \"max\": [1.1, 3, 4.8], \"group\": %s } ]";
        assertEquals(List.of("'doors[0].group' is null: obsolete, leave the field out for a door on its own"),
                warnings(SMALL + door.formatted("null")));
        assertEquals(List.of(), warnings(SMALL + door.formatted("\"\"")));
        assertEquals(List.of(), warnings(SMALL + door.formatted("\"L\"")));
    }

    /** A door group matches case aside everywhere, as the control group working it does. */
    @Test
    void doorGroups_matchCaseAside() {
        WagonType.Door left = new WagonType.Door("d1", 1, 1, 0, 1.1, 3, 0.8, false, false, false, "DrL");
        WagonType.Door other = new WagonType.Door("d2", 1, 1, 2, 1.1, 3, 2.8, false, false, false, "drl");
        WagonType.Door right = new WagonType.Door("d3", -1.1, 1, 2, -1, 3, 2.8, false, false, false, "DrR");
        assertTrue(left.groupedWith(other) && other.groupedWith(left));
        assertFalse(left.groupedWith(right));
    }
}
