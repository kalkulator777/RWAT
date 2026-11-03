package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.google.gson.JsonParser;
import com.muzhik17.trainsmod.kinematics.FloorFinding.Code;
import com.muzhik17.trainsmod.kinematics.FloorFinding.Subject;
import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypeParser;

/**
 * Each kind of thing {@link FloorCheck} finds, on a type that has it and
 * nothing else: its code, what it is about and which one (the zone, door
 * or chair the editor points at), the params its line is made of — places
 * and sizes in the OBJ frame the type is written in — and the line, which
 * {@link FloorCheck#problems} gives word for word. The types are written as
 * a pack writes them (format 1, OBJ frame: x along the car, y up, z
 * across) and read by the loader's parser.
 */
class FloorFindingTest {

    /** A car's floor in the OBJ frame: 10 long, 2 wide, its floor at y 1.37375 (1.81 in the model frame). */
    private static final String ZONE = "{\"min\": [-5.0, 1.37375, -1.0], \"max\": [5.0, 3.87375, 1.0]}";
    /** A door on the car's left side (+z) where its floor ends, a block wide: its box, OBJ frame. */
    private static final String SIDE_DOOR = "\"min\": [-1.0, 1.37375, 1.0], \"max\": [0.0, 3.5, 1.06]";

    /** A type of length 25 with the given markup (the JSON members after the physics), as the loader reads it. */
    private static WagonType type(String markup) {
        return WagonTypeParser.parse("test:car", JsonParser.parseString(
                "{\"length\": 25.0, \"bogies\": [8.5, -8.5], \"mass_t\": 50.0, " + markup + "}").getAsJsonObject());
    }

    /** The type's findings, after checking that its lines are their texts. */
    private static List<FloorFinding> findings(WagonType type) {
        List<FloorFinding> findings = FloorCheck.findings(type);
        assertEquals(findings.stream().map(FloorFinding::text).toList(), FloorCheck.problems(type));
        return findings;
    }

    /** The one finding a type has. */
    private static FloorFinding only(WagonType type) {
        List<FloorFinding> findings = findings(type);
        assertEquals(1, findings.size(), findings.stream().map(FloorFinding::text).toList().toString());
        return findings.get(0);
    }

    /**
     * {@code finding} is of {@code code}, about {@code subject} {@code index},
     * with these params (name, value, …: numbers to 1e-9, NaN and the
     * infinities as such, in this order) and this line.
     */
    private static void assertFinding(FloorFinding finding, Code code, Subject subject, int index, String text,
            Object... params) {
        assertEquals(code, finding.code(), finding.text());
        assertEquals(subject, finding.subject(), finding.text());
        assertEquals(index, finding.index(), finding.text());
        List<String> names = new ArrayList<>();
        for (int i = 0; i < params.length; i += 2) {
            names.add((String) params[i]);
            Object expected = params[i + 1];
            Object actual = finding.params().get((String) params[i]);
            if (expected instanceof Double e) {
                double a = ((Number) actual).doubleValue();
                assertTrue(Double.isNaN(e) ? Double.isNaN(a) : e.isInfinite() ? e == a : Math.abs(e - a) <= 1.0e-9,
                        params[i] + ": " + a + ", not " + e);
            } else {
                assertEquals(expected, actual, (String) params[i]);
            }
        }
        assertEquals(names, List.copyOf(finding.params().keySet()), "the params, in the line's order");
        assertEquals(text, finding.text());
    }

    @Test
    void chairsWithoutAFloor() {
        WagonType type = type("\"cab\": {\"seats\": [{\"at\": [-9.0, 1.86375, 0.0], \"yaw\": 0}]}");
        assertFinding(only(type), Code.SEATS_WITHOUT_INTERIOR, Subject.CAB, -1,
                "cab.seats without an interior: a chair needs a floor to walk to it");
    }

    @Test
    void aFloorNobodyFitsOn() {
        WagonType type = type("\"interior\": [{\"min\": [-5.0, 1.37375, -0.2], \"max\": [0.0, 3.87375, 0.2]}]");
        assertFinding(only(type), Code.FLOOR_TOO_NARROW, Subject.FLOOR, -1,
                "a player fits nowhere on the floor: every part of it is narrower than 0.6",
                "player_width", 0.6);
    }

    @Test
    void aZoneNobodyFitsIn() {
        // 5 along the car, 0.4 across: the second zone, apart from the first
        WagonType type = type("\"interior\": [" + ZONE + ","
                + " {\"min\": [-5.0, 1.37375, 1.2], \"max\": [0.0, 3.87375, 1.6]}]");
        assertFinding(only(type), Code.ZONE_TOO_NARROW, Subject.ZONE, 1,
                "zone 1 holds no place a player fits (5.00 x 0.40): widen it to 0.6 or join it to a wider zone",
                "size_x", 5.0, "size_z", 0.4, "player_width", 0.6);
    }

    @Test
    void aDoorBoxThickerThanALeaf() {
        WagonType type = type("\"interior\": [" + ZONE + "], \"doors\": [{\"id\": \"leaf\", \"min\": [-1.0, 1.37375,"
                + " 1.0], \"max\": [0.0, 3.5, 1.8]}]");
        assertFinding(only(type), Code.DOOR_TOO_THICK, Subject.DOOR, 0,
                "door 0 'leaf' is 0.80 thick: is the box the door leaf?",
                "id", "leaf", "thickness", 0.8);
    }

    @Test
    void aDoorTooNarrowToWalkThrough_isNotWalkedThroughEither() {
        // 0.15 wide: no room left inside its span once the inset is off both ends
        WagonType type = type("\"interior\": [" + ZONE + "], \"doors\": [" + door("ok", SIDE_DOOR) + ", {\"id\":"
                + " \"slot\", \"min\": [2.0, 1.37375, 1.0], \"max\": [2.15, 3.5, 1.06]}]");
        List<FloorFinding> findings = findings(type);
        assertEquals(List.of(Code.DOOR_TOO_NARROW, Code.DOOR_NOT_AT_FLOOR_END),
                findings.stream().map(FloorFinding::code).toList());
        assertFinding(findings.get(0), Code.DOOR_TOO_NARROW, Subject.DOOR, 1,
                "door 1 'slot' is too narrow to walk through",
                "id", "slot");
        assertEquals(1, findings.get(1).index());
    }

    @Test
    void aGangwayInTheSideWall() {
        WagonType type = type("\"interior\": [" + ZONE + "], \"doors\": [{\"id\": \"gangway\", " + SIDE_DOOR
                + ", \"connecting\": true}]");
        assertFinding(only(type), Code.GANGWAY_NOT_IN_END_WALL, Subject.DOOR, 0,
                "door 0 'gangway' is a gangway (connecting) door but not in an end wall",
                "id", "gangway");
    }

    @Test
    void anInnerDoorOffTheFloor() {
        // across the car 2 past the floor's front end
        WagonType type = type("\"interior\": [" + ZONE + "], \"doors\": [" + door("ok", SIDE_DOOR) + ", {\"id\":"
                + " \"lost\", \"min\": [-7.03, 1.37375, -0.45], \"max\": [-6.97, 3.5, 0.45], \"inner\": true}]");
        assertFinding(only(type), Code.INNER_DOOR_NO_FLOOR, Subject.DOOR, 1,
                "door 1 'lost' (inner) touches no floor",
                "id", "lost");
    }

    @Test
    void anInnerDoorTheFloorRunsThrough() {
        // the platzkart's compartment, 0.025 into the aisle at its door (ShutDoorTest), in the OBJ frame
        WagonType type = type("""
                "interior": [
                  {"min": [-9.25, 1.37375, 0.35], "max": [10.78, 3.87375, 1.0]},
                  {"min": [-7.55, 1.37375, -0.65], "max": [-6.78, 3.87375, 0.375]}],
                "doors": [{"id": "DoorKupe", "min": [-7.5, 1.37375, 0.375], "max": [-6.875, 3.46375, 0.5],
                  "inner": true}]""");
        assertFinding(only(type), Code.INNER_DOOR_FLOOR_THROUGH, Subject.DOOR, 0,
                "door 0 'DoorKupe' (inner): the floor runs through its doorway — the zones on its two sides"
                        + " touch or overlap in it, and a player stands half in the shut leaf: part them"
                        + " (any gap is wall; open, the door bridges it)",
                "id", "DoorKupe");
    }

    @Test
    void anInnerDoorTheFloorRunsRound() {
        // two rooms 0.1 apart at the partition, its door in the gap, and a passage beside the door joining them
        WagonType type = type("""
                "interior": [
                  {"min": [-5.0, 1.37375, -1.4], "max": [0.0, 3.87375, 1.4]},
                  {"min": [0.1, 1.37375, -1.4], "max": [5.0, 3.87375, 1.4]},
                  {"min": [-1.0, 1.37375, 0.75], "max": [1.0, 3.87375, 1.4]}],
                "doors": [{"id": "partition", "min": [0.02, 1.37375, -0.45], "max": [0.08, 3.5, 0.45],
                  "inner": true}]""");
        assertFinding(only(type), Code.INNER_DOOR_FLOOR_ROUND, Subject.DOOR, 0,
                "door 0 'partition' (inner): its two sides are one floor without it — the floor runs round it"
                        + " or through the wall beside it, so shut it is no wall",
                "id", "partition");
    }

    /**
     * Where an inner door's bridge meets the floor, all doors between zones
     * shut — on both sides of its leaf, one or none — is one rule, which the
     * findings above are made by and the editor's doors tool shows: a door
     * between two rooms reaches both, one on the floor's end or beside the
     * aisle one, one off the floor none.
     */
    @Test
    void anInnerDoorsBridgeMeetsTheFloorOnBothSidesOneOrNone() {
        WagonType type = type("""
                "interior": [
                  {"min": [-5.0, 1.37375, -1.4], "max": [0.0, 3.87375, 1.4]},
                  {"min": [0.1, 1.37375, -1.4], "max": [5.0, 3.87375, 1.4]}],
                "doors": [
                  {"id": "partition", "min": [0.02, 1.37375, -0.45], "max": [0.08, 3.5, 0.45], "inner": true},
                  {"id": "end", "min": [5.0, 1.37375, -0.45], "max": [5.06, 3.5, 0.45], "inner": true},
                  {"id": "lost", "min": [-7.03, 1.37375, -0.45], "max": [-6.97, 3.5, 0.45], "inner": true}]""");
        FloorRegion shut = type.interior().region(RiderWalk.PLAYER_HALF_WIDTH, type.doors(), 0);
        List<FloorCheck.BridgeSides.Reach> reach = new ArrayList<>();
        for (WagonType.Door door : type.doors()) {
            reach.add(FloorCheck.bridgeSides(door, shut).reach());
        }
        assertEquals(List.of(FloorCheck.BridgeSides.Reach.BOTH, FloorCheck.BridgeSides.Reach.ONE,
                FloorCheck.BridgeSides.Reach.NONE), reach);
        // the partition, an end-wall door: the rear room's parts before its leaf (−Z of the model frame, the OBJ's +x)
        FloorCheck.BridgeSides partition = FloorCheck.bridgeSides(type.doors().get(0), shut);
        assertTrue(!partition.before().isEmpty() && !partition.behind().isEmpty(), partition.toString());
        for (int p : partition.before()) {
            assertTrue(shut.pieces().get(p).maxZ() <= shut.pieces().get(partition.behind().get(0)).minZ(), partition.toString());
        }
        List<Integer> all = new ArrayList<>(partition.before());
        all.addAll(partition.behind());
        all.sort(null);
        assertEquals(all, partition.parts());
        assertEquals(List.of("both", "one", "none"),
                List.of(FloorCheck.BridgeSides.Reach.values()).stream().map(r -> r.key).toList());
    }

    @Test
    void aDoorTheFloorDoesNotEndAt() {
        // half a block out of the side wall
        WagonType type = type("\"interior\": [" + ZONE + "], \"doors\": [{\"id\": \"out\", \"min\": [-1.0, 1.37375,"
                + " 1.5], \"max\": [0.0, 3.5, 1.56]}]");
        assertFinding(only(type), Code.DOOR_NOT_AT_FLOOR_END, Subject.DOOR, 0,
                "door 0 'out' isn't where the floor ends: nobody can walk through it (a player must fit in front"
                        + " of it, inside its span, with the floor ending within 0.4 of its inner face)",
                "id", "out", "slack", 0.4);
    }

    @Test
    void zonesNobodyWalksTo_allNamedByOneFindingOfNoOneZone() {
        // the first zone, and one 0.05 behind it and one 0.05 ahead of it: no door anywhere
        WagonType type = type("""
                "interior": [
                  {"min": [-5.0, 1.37375, -1.0], "max": [0.0, 3.87375, 1.0]},
                  {"min": [-10.0, 1.37375, -1.0], "max": [-5.05, 3.87375, 1.0]},
                  {"min": [0.05, 1.37375, -1.0], "max": [5.0, 3.87375, 1.0]}]""");
        assertFinding(only(type), Code.ZONES_UNREACHABLE, Subject.ZONE, -1,
                "floor zones [1, 2] can't be walked to from zone 0 or a way in: join them (zones that touch join),"
                        + " put an inner door between them, or a door out of them",
                "zones", List.of(1, 2));
    }

    @Test
    void aCabFloorWithoutAChair() {
        WagonType type = type("\"cab\": {}, \"interior\": [" + ZONE + "], \"doors\": [" + door("ok", SIDE_DOOR) + "]");
        assertFinding(only(type), Code.CAB_WITHOUT_SEAT, Subject.CAB, -1,
                "a walkable cab needs a driver's chair (cab.seats): in a cab with a floor the keys drive only from"
                        + " a chair");
    }

    @Test
    void chairsOutOfReachOrAtTheWrongHeight_eachByItsIndex() {
        // the first sat in from the floor by it; the second 3.3 off the floor's edge; the third 1.7 above it
        WagonType type = type("""
                "cab": {"seats": [
                  {"at": [-2.0, 1.87375, 0.0], "yaw": 0},
                  {"at": [-2.0, 1.87375, 4.0], "yaw": 0},
                  {"at": [2.0, 3.07375, 0.0], "yaw": 180}]},
                "interior": [%s], "doors": [%s]""".formatted(ZONE, door("ok", SIDE_DOOR)));
        List<FloorFinding> findings = findings(type);
        assertEquals(2, findings.size(), findings.toString());
        assertFinding(findings.get(0), Code.SEAT_NOT_SITTABLE, Subject.SEAT, 1,
                "cab.seats[1] (-2.00, 1.87, 4.00): the nearest place to stand is 3.30 off (sitting reaches 2.5),"
                        + " its floor 0.50 below the cushion (0.2..1.5; the seat is the top of the cushion)",
                "x", -2.0, "y", 1.87375, "z", 4.0, "reach", 3.3, "sit_reach", 2.5, "height", 0.5,
                "min_height", 0.2, "max_height", 1.5);
        assertFinding(findings.get(1), Code.SEAT_NOT_SITTABLE, Subject.SEAT, 2,
                "cab.seats[2] (2.00, 3.07, 0.00): the nearest place to stand is 0.00 off (sitting reaches 2.5),"
                        + " its floor 1.70 below the cushion (0.2..1.5; the seat is the top of the cushion)",
                "x", 2.0, "y", 3.07375, "z", 0.0, "reach", 0.0, "sit_reach", 2.5, "height", 1.7,
                "min_height", 0.2, "max_height", 1.5);
    }

    @Test
    void aChairWithNoFloorToStandOn_isInfinitelyFarAndAtNoHeight() {
        WagonType type = type("""
                "cab": {"seats": [{"at": [-2.0, 1.87375, 0.0], "yaw": 0}]},
                "interior": [{"min": [-5.0, 1.37375, -0.2], "max": [0.0, 3.87375, 0.2]}]""");
        List<FloorFinding> findings = findings(type);
        assertEquals(List.of(Code.FLOOR_TOO_NARROW, Code.SEAT_NOT_SITTABLE),
                findings.stream().map(FloorFinding::code).toList());
        assertFinding(findings.get(1), Code.SEAT_NOT_SITTABLE, Subject.SEAT, 0,
                "cab.seats[0] (-2.00, 1.87, 0.00): the nearest place to stand is Infinity off (sitting reaches"
                        + " 2.5), its floor NaN below the cushion (0.2..1.5; the seat is the top of the cushion)",
                "x", -2.0, "y", 1.87375, "z", 0.0, "reach", Double.POSITIVE_INFINITY, "sit_reach", 2.5,
                "height", Double.NaN, "min_height", 0.2, "max_height", 1.5);
    }

    @Test
    void aSoundCar_hasNoFindings() {
        assertEquals(List.of(), findings(type("\"cab\": {\"seats\": [{\"at\": [-2.0, 1.87375, 0.0], \"yaw\": 0}]},"
                + " \"interior\": [" + ZONE + "], \"doors\": [" + door("ok", SIDE_DOOR) + "]")));
    }

    @Test
    void everyCodeIsAboutOneSubject_andTestedHere() {
        Map<Subject, Set<Code>> bySubject = Map.of(
                Subject.FLOOR, EnumSet.of(Code.FLOOR_TOO_NARROW),
                Subject.ZONE, EnumSet.of(Code.ZONE_TOO_NARROW, Code.ZONES_UNREACHABLE),
                Subject.DOOR, EnumSet.of(Code.DOOR_TOO_THICK, Code.DOOR_TOO_NARROW, Code.GANGWAY_NOT_IN_END_WALL,
                        Code.INNER_DOOR_NO_FLOOR, Code.INNER_DOOR_FLOOR_THROUGH, Code.INNER_DOOR_FLOOR_ROUND,
                        Code.DOOR_NOT_AT_FLOOR_END),
                Subject.SEAT, EnumSet.of(Code.SEAT_NOT_SITTABLE),
                Subject.CAB, EnumSet.of(Code.SEATS_WITHOUT_INTERIOR, Code.CAB_WITHOUT_SEAT));
        Set<Code> all = EnumSet.noneOf(Code.class);
        bySubject.forEach((subject, codes) -> {
            codes.forEach(code -> assertEquals(subject, code.subject(), code.name()));
            all.addAll(codes);
        });
        assertEquals(EnumSet.allOf(Code.class), all, "a code this test doesn't know: give it a case above");
        for (Subject subject : Subject.values()) {
            assertEquals(subject.name().toLowerCase(Locale.ROOT), subject.key);
        }
    }

    @Test
    void aFindingsParamsCannotBeChanged() {
        FloorFinding finding = FloorCheck.findings(type("\"interior\": [{\"min\": [-5.0, 1.37375, -0.2],"
                + " \"max\": [0.0, 3.87375, 0.2]}]")).get(0);
        assertThrows(UnsupportedOperationException.class, () -> finding.params().put("player_width", 1.0));
    }

    private static String door(String id, String box) {
        return "{\"id\": \"" + id + "\", " + box + "}";
    }
}
