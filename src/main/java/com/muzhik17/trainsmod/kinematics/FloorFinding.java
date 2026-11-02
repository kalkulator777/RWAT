package com.muzhik17.trainsmod.kinematics;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * One thing {@link FloorCheck} finds wrong with a type's floor, doors or
 * driver's chairs, as data: what kind of thing ({@link Code}, a stable name
 * the pack editor words and links by), which of the type's zones, doors or
 * chairs it is about ({@link #subject}, {@link #index}), the numbers and
 * names its line is made of ({@link #params}), and the line itself
 * ({@link #text}) — built from those by the one function here, word for word
 * the line the type registry logs and {@code /rwat packs} shows.
 *
 * <p>Places and sizes are the OBJ frame's, where the author measured them
 * ({@link com.muzhik17.trainsmod.stock.ObjFrame}): a chair at its {@code at},
 * a zone's extent along x (the car) and z (across). A number may be
 * infinite or NaN where the line says so (a chair with no floor at all to
 * stand on). The engine's limits a line quotes (a player's width, how far a
 * seated player reaches) are params too, so the line needs nothing else.
 * Pure.
 *
 * @param code   what kind of thing is wrong
 * @param index  the zone, door or chair (its index in the type's
 *               {@code interior}, {@code doors} or {@code cab.seats}), or −1
 *               for the floor or the cab as a whole and for zones in the
 *               plural ({@link Code#ZONES_UNREACHABLE}, which lists them)
 * @param params name → value, in the order the line uses them: a
 *               {@link Double}, a {@link String} (a door's id) or a list of
 *               {@link Integer} (zone indices); each code's are listed on it
 */
public record FloorFinding(Code code, int index, Map<String, Object> params) {

    /** What a finding is about: the type's floor or cab as a whole, or one of its zones, doors or chairs. */
    public enum Subject {
        FLOOR("floor"),
        ZONE("zone"),
        DOOR("door"),
        SEAT("seat"),
        CAB("cab");

        /** Lower-case name, as the editor's links and the golden data write it. */
        public final String key;

        Subject(String key) {
            this.key = key;
        }
    }

    /**
     * The kinds of thing {@link FloorCheck} finds: stable names (the editor
     * translates by them, the golden data compares them), each about one
     * {@link Subject}. Params are given as {@code name: what}.
     */
    public enum Code {
        /**
         * A type with chairs but no floor to walk to them. No params.
         */
        SEATS_WITHOUT_INTERIOR(Subject.CAB),
        /**
         * No part of the floor is as wide as a player.
         * {@code player_width}: how wide a part must be.
         */
        FLOOR_TOO_NARROW(Subject.FLOOR),
        /**
         * A zone with no place a player fits in, the zones it touches
         * aside. {@code size_x}, {@code size_z}: its extent along the car
         * and across; {@code player_width}.
         */
        ZONE_TOO_NARROW(Subject.ZONE),
        /**
         * A door box too thick to be its leaf. {@code id}: the door's;
         * {@code thickness}: the box across its wall.
         */
        DOOR_TOO_THICK(Subject.DOOR),
        /**
         * A door with no room to walk through its span. {@code id}.
         */
        DOOR_TOO_NARROW(Subject.DOOR),
        /**
         * A gangway (connecting) door not in an end wall. {@code id}.
         */
        GANGWAY_NOT_IN_END_WALL(Subject.DOOR),
        /**
         * An inner door no floor reaches on either side. {@code id}.
         */
        INNER_DOOR_NO_FLOOR(Subject.DOOR),
        /**
         * An inner door the floor runs through: the zones on its two sides
         * touch or overlap in its doorway. {@code id}.
         */
        INNER_DOOR_FLOOR_THROUGH(Subject.DOOR),
        /**
         * An inner door whose two sides are one floor without it, joined
         * round it or through the wall beside it. {@code id}.
         */
        INNER_DOOR_FLOOR_ROUND(Subject.DOOR),
        /**
         * A hull or gangway door the floor doesn't end at, so nobody walks
         * through it. {@code id}; {@code slack}: how near its inner face the
         * floor must end.
         */
        DOOR_NOT_AT_FLOOR_END(Subject.DOOR),
        /**
         * Zones nobody can walk to from zone 0 or a way in. {@code zones}:
         * the zones, in order; the finding's index is −1.
         */
        ZONES_UNREACHABLE(Subject.ZONE),
        /**
         * A cab with a floor but no driver's chair. No params.
         */
        CAB_WITHOUT_SEAT(Subject.CAB),
        /**
         * A chair with no place to stand within reach, or its cushion too
         * low or too high above the floor there. {@code x}, {@code y},
         * {@code z}: the chair's {@code at}; {@code reach}: how far the
         * nearest place to stand is (infinite with no floor); {@code
         * sit_reach}: how far sitting down reaches; {@code height}: the
         * cushion above the floor there (NaN with no floor); {@code
         * min_height}, {@code max_height}: the heights allowed.
         */
        SEAT_NOT_SITTABLE(Subject.SEAT);

        private final Subject subject;

        Code(Subject subject) {
            this.subject = subject;
        }

        /** What a finding of this kind is about. */
        public Subject subject() {
            return subject;
        }
    }

    public FloorFinding {
        Objects.requireNonNull(code, "code");
        params = Collections.unmodifiableMap(new LinkedHashMap<>(params));
    }

    /** A finding with its params given as name, value, name, value, … in the line's order. */
    static FloorFinding of(Code code, int index, Object... params) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < params.length; i += 2) {
            map.put((String) params[i], params[i + 1]);
        }
        return new FloorFinding(code, index, map);
    }

    /** What this finding is about: its code's subject. */
    public Subject subject() {
        return code.subject();
    }

    /**
     * The line the type registry logs and {@code /rwat packs} shows, in
     * English, made of the code, the index and the params alone. Numbers
     * are written as the lines always were: {@code %.2f} and {@code %.1f}
     * in {@link Locale#ROOT} (half up), the doorway slack as Java writes a
     * double ({@code 0.4}), zone lists as {@code [1, 2]}.
     */
    public String text() {
        return switch (code) {
            case SEATS_WITHOUT_INTERIOR -> "cab.seats without an interior: a chair needs a floor to walk to it";
            case FLOOR_TOO_NARROW -> format("a player fits nowhere on the floor: every part of it is narrower than %.1f",
                    number("player_width"));
            case ZONE_TOO_NARROW -> format("zone %d holds no place a player fits (%.2f x %.2f):"
                    + " widen it to %.1f or join it to a wider zone",
                    index, number("size_x"), number("size_z"), number("player_width"));
            case DOOR_TOO_THICK -> format("%s is %.2f thick: is the box the door leaf?", door(), number("thickness"));
            case DOOR_TOO_NARROW -> door() + " is too narrow to walk through";
            case GANGWAY_NOT_IN_END_WALL -> door() + " is a gangway (connecting) door but not in an end wall";
            case INNER_DOOR_NO_FLOOR -> door() + " (inner) touches no floor";
            case INNER_DOOR_FLOOR_THROUGH -> door() + " (inner): the floor runs through its doorway — the zones on"
                    + " its two sides touch or overlap in it, and a player stands half in the shut leaf: part them"
                    + " (any gap is wall; open, the door bridges it)";
            case INNER_DOOR_FLOOR_ROUND -> door() + " (inner): its two sides are one floor without it — the floor"
                    + " runs round it or through the wall beside it, so shut it is no wall";
            case DOOR_NOT_AT_FLOOR_END -> door() + " isn't where the floor ends: nobody can walk through it"
                    + " (a player must fit in front of it, inside its span, with the floor ending within "
                    + number("slack") + " of its inner face)";
            case ZONES_UNREACHABLE -> "floor zones " + params.get("zones") + " can't be walked to from zone 0 or a"
                    + " way in: join them (zones that touch join), put an inner door between them, or a door out"
                    + " of them";
            case CAB_WITHOUT_SEAT -> "a walkable cab needs a driver's chair (cab.seats): in a cab with a floor the"
                    + " keys drive only from a chair";
            case SEAT_NOT_SITTABLE -> format("cab.seats[%d] (%.2f, %.2f, %.2f): the nearest place to stand is %.2f"
                    + " off (sitting reaches %.1f), its floor %.2f below the cushion (%.1f..%.1f; the seat is the"
                    + " top of the cushion)", index, number("x"), number("y"), number("z"), number("reach"),
                    number("sit_reach"), number("height"), number("min_height"), number("max_height"));
        };
    }

    /** {@code door <index> '<id>'}, as a door's lines name it. */
    private String door() {
        return "door " + index + " '" + params.get("id") + "'";
    }

    private double number(String name) {
        return ((Number) params.get(name)).doubleValue();
    }

    private static String format(String format, Object... args) {
        return String.format(Locale.ROOT, format, args);
    }
}
