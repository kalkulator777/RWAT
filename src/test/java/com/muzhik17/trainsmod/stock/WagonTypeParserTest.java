package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
        assertEquals(new WagonType.Resistance(2500.0, 100.0, 12.0), type.resistance());
        assertNotNull(type.traction());
        assertEquals(994.0, type.traction().powerKw());
        assertEquals(226.0, type.traction().maxTractiveEffortKn());
        assertTrue(type.powered());
        assertTrue(type.drivable());
        // absent brake fields default to 0 (the ChME3 has no dynamic brake)
        assertEquals(new WagonType.Brakes(160.0, 90.0, 0.0, 0.0, 30.0), type.brakes());
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
        assertEquals(WagonType.Resistance.NONE, type.resistance());
        assertEquals(WagonType.Brakes.NONE, type.brakes());
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
        assertThrows(JsonSyntaxException.class, () -> WagonTypeParser.parse("test:bad",
                json("""
                        { "length": 10.0, "bogies": [3.0, -3.0], "mass_t": 20.0 }""")));
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
        assertNotNull(type.cab().seat());
        assertEquals(-4.654, type.cab().seat().z(), 1.0e-9);
        assertTrue(type.drivable() && type.boardable());
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
}
