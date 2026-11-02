package com.muzhik17.trainsmod.stock;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonSyntaxException;
import com.muzhik17.trainsmod.pack.PackJson;

/**
 * JSON → {@link WagonType} (SPEC §5.5 step 5). The declaration format is the
 * 1:1 JSON of §5.1 — human units (tonnes, kW, km/h, kN, seconds), optional
 * {@code traction}/{@code cab} sections whose <i>presence</i> is the
 * capability. Physics the pack leaves out takes the engine's defaults
 * ({@link StockDefaults}, SPEC §6.4): an omitted field is the default, an
 * explicit {@code 0} is zero. The smallest wagon is
 *
 * <pre>{@code
 * { "length": 17.75, "bogies": [5.86, -5.86], "mass_t": 24.0 }
 * }</pre>
 *
 * and everything a pack may say:
 *
 * <pre>{@code
 * {
 *   "length": 18.125,
 *   "bogies": [4.4375, -4.4375],
 *   "mass_t": 123.0,
 *   "max_speed_kmh": 95.0,
 *   "resistance": { "a": 1060.0, "b": 14.0, "c": 1.3, "c_front": 5.0 },
 *   "traction": { "power_kw": 994.0, "max_tractive_effort_kn": 226.0,
 *                 "adhesion": 1.0, "ramp_s": 4.0 },
 *   "cab": {},
 *   "brakes": { "system": "passenger", "train_kn": 160.0, "independent_kn": 90.0,
 *               "parking_kn": 30.0, "apply_s": 4.0, "release_s": 8.0 },
 *   "couplers": { "front": -0.14, "rear": -0.14 }
 * }
 * }</pre>
 *
 * <p>{@code max_speed_kmh} (optional): the design speed; without it the
 * wagon doesn't limit the train. {@code brakes.system} — {@code passenger}
 * (default), {@code freight} or {@code ep} — sets the train brake's force per
 * tonne and timing; the other brake fields override it.
 * {@code couplers} (optional, default 0): where each coupler engages
 * relative to its frame end, + outward (SPEC §6.12).
 *
 * <p><b>Strict reading</b> ({@link PackJson}): each section's keys are the
 * public {@code *_KEYS} sets below; a key a section doesn't know is a warning
 * with the nearest known one as a hint, never an error. A JSON {@code null}
 * or a value of the wrong type is an error naming the field and the type
 * expected; only {@code doors[].group} takes {@code null} (= no group, as
 * {@code ""} does). The geometry must make a wagon: {@code length > 0}, the
 * {@code bogies} strictly front to back and inside {@code ±length/2},
 * each coupler offset under {@code length/2} in size. An error throws
 * {@link JsonSyntaxException} and the loader skips the whole file.
 *
 * <p>Uses GSON only (ships with the game, not an MC class) so the stock
 * package stays engine-free and the parser unit-testable.
 */
public final class WagonTypeParser {

    /** Driver's chairs a cab may have at most (network sanity: each is synced as who sits there). */
    public static final int MAX_SEATS = 16;

    /** The keys of a declaration's top level. */
    public static final Set<String> KEYS = PackJson.keys("length", "bogies", "mass_t", "max_speed_kmh",
            "resistance", "traction", "brakes", "cab", "interior", "doors", "couplers", "aliases");
    /** The keys of {@code resistance}. */
    public static final Set<String> RESISTANCE_KEYS = PackJson.keys("a", "b", "c", "c_front");
    /** The keys of {@code traction}. */
    public static final Set<String> TRACTION_KEYS =
            PackJson.keys("power_kw", "max_tractive_effort_kn", "adhesion", "ramp_s");
    /** The keys of {@code brakes}. */
    public static final Set<String> BRAKES_KEYS = PackJson.keys("system", "train_kn", "independent_kn",
            "parking_kn", "apply_s", "release_s", "dynamic_kn", "dynamic_fade_kmh");
    /**
     * Brake keys read and synced but not modelled yet (roadmap R7): the
     * dynamic brake has no control and no force in the physics. A pack that
     * sets them is warned, so its author doesn't count on them.
     */
    public static final Set<String> RESERVED_BRAKES_KEYS = PackJson.keys("dynamic_kn", "dynamic_fade_kmh");
    /** The keys of {@code cab}; {@code seat}/{@code seat_yaw} are the older one-chair form. */
    public static final Set<String> CAB_KEYS = PackJson.keys("seats", "seat", "seat_yaw");
    /** The keys of each {@code cab.seats[]} chair. */
    public static final Set<String> SEAT_KEYS = PackJson.keys("at", "yaw");
    /** The keys of each {@code interior} zone. */
    public static final Set<String> ZONE_KEYS = PackJson.keys("min", "max");
    /** The keys of each {@code doors[]} door. */
    public static final Set<String> DOOR_KEYS =
            PackJson.keys("id", "min", "max", "inner", "fixed", "connecting", "group");
    /** The keys of {@code couplers}. */
    public static final Set<String> COUPLERS_KEYS = PackJson.keys("front", "rear");

    private WagonTypeParser() {
    }

    /** {@link #parse(String, JsonObject, Consumer)} with the warnings dropped. */
    public static WagonType parse(String id, JsonObject json) {
        return parse(id, json, warning -> {
        });
    }

    /**
     * Parse one declaration. {@code id} comes from the file's resource
     * location, not the JSON body — files can't lie about their identity.
     *
     * @param warnings told what the declaration says that the engine ignores
     *                 (unknown keys, reserved fields) — the type still loads
     * @throws JsonSyntaxException on a missing required field, a {@code null}
     *                             or wrongly typed value, or impossible geometry
     */
    public static WagonType parse(String id, JsonObject json, Consumer<String> warnings) {
        PackJson.checkKeys(json, KEYS, "", warnings);
        double length = PackJson.requiredNumber(json, "length", "");
        double[] bogies = bogies(json);
        double massT = PackJson.requiredNumber(json, "mass_t", "");
        if (!(massT > 0.0)) {
            throw new JsonSyntaxException("'mass_t' must be a positive number, got " + format(massT));
        }
        double maxSpeedKmh = amount(json, "max_speed_kmh", "", 0.0);

        WagonType.Resistance resistance = StockDefaults.resistance(massT);
        JsonObject r = section(json, "resistance", RESISTANCE_KEYS, warnings);
        if (r != null) {
            resistance = new WagonType.Resistance(
                    amount(r, "a", "resistance", resistance.a()),
                    amount(r, "b", "resistance", resistance.b()),
                    amount(r, "c", "resistance", resistance.c()),
                    amount(r, "c_front", "resistance", resistance.cFront()));
        }

        WagonType.Traction traction = null;
        JsonObject t = section(json, "traction", TRACTION_KEYS, warnings);
        if (t != null) {
            traction = new WagonType.Traction(
                    amount(t, "power_kw", "traction", Double.NaN),
                    amount(t, "max_tractive_effort_kn", "traction", Double.NaN),
                    amount(t, "adhesion", "traction", StockDefaults.ADHESION),
                    amount(t, "ramp_s", "traction", StockDefaults.TRACTION_RAMP_S));
        }

        JsonObject c = section(json, "cab", CAB_KEYS, warnings);
        WagonType.Cab cab = c != null ? cab(c, warnings) : null;

        JsonObject b = section(json, "brakes", BRAKES_KEYS, warnings);
        if (b == null) {
            b = new JsonObject();
        }
        for (String reserved : RESERVED_BRAKES_KEYS) {
            if (b.has(reserved)) {
                warnings.accept("'brakes." + reserved + "' is reserved: the dynamic brake isn't modelled"
                        + " yet, the value is kept but does nothing");
            }
        }
        WagonType.Brakes defaults = StockDefaults.brakes(brakeSystem(b), massT, cab != null);
        WagonType.Brakes brakes = new WagonType.Brakes(
                amount(b, "train_kn", "brakes", defaults.trainKn()),
                amount(b, "independent_kn", "brakes", defaults.independentKn()),
                amount(b, "dynamic_kn", "brakes", defaults.dynamicKn()),
                amount(b, "dynamic_fade_kmh", "brakes", defaults.dynamicFadeKmh()),
                amount(b, "parking_kn", "brakes", defaults.parkingKn()),
                amount(b, "apply_s", "brakes", defaults.applyS()),
                amount(b, "release_s", "brakes", defaults.releaseS()));

        WagonType.Interior interior = interior(json, warnings);
        List<WagonType.Door> doors = doors(json, warnings);

        WagonType.Couplers couplers = WagonType.Couplers.AT_ENDS;
        JsonObject k = section(json, "couplers", COUPLERS_KEYS, warnings);
        if (k != null) {
            couplers = new WagonType.Couplers(PackJson.optionalNumber(k, "front", "couplers", 0.0),
                    PackJson.optionalNumber(k, "rear", "couplers", 0.0));
        }
        checkGeometry(length, bogies, couplers);

        return new WagonType(id, length, bogies, massT, maxSpeedKmh,
                resistance, traction, cab, brakes, interior, doors, couplers);
    }

    /**
     * The geometry must make a wagon (fix list D3): a positive length; bogie
     * pivots strictly front to back (the first is the front one, SPEC §5.1)
     * and inside the body, {@code |pivot| < length/2}; each coupler offset
     * under {@code length/2} in size — a coupler can't engage past the body's
     * middle, nor stick out further than half a body.
     */
    private static void checkGeometry(double length, double[] bogies, WagonType.Couplers couplers) {
        if (!(length > 0.0)) {
            throw new JsonSyntaxException("'length' must be a positive number of blocks, got " + format(length));
        }
        double half = length / 2.0;
        for (int i = 0; i < bogies.length; i++) {
            if (!(Math.abs(bogies[i]) < half)) {
                throw new JsonSyntaxException("'bogies[" + i + "]' = " + format(bogies[i])
                        + " is outside the body: a pivot must lie within ±length/2 = ±" + format(half));
            }
            if (i > 0 && !(bogies[i] < bogies[i - 1])) {
                throw new JsonSyntaxException("'bogies' must run front to back, each pivot behind the one"
                        + " before: 'bogies[" + i + "]' = " + format(bogies[i]) + " is not behind 'bogies["
                        + (i - 1) + "]' = " + format(bogies[i - 1]));
            }
        }
        checkCoupler("front", couplers.front(), half);
        checkCoupler("rear", couplers.rear(), half);
    }

    private static void checkCoupler(String end, double offset, double half) {
        if (!(Math.abs(offset) < half)) {
            throw new JsonSyntaxException("'couplers." + end + "' = " + format(offset)
                    + " must be under length/2 = " + format(half) + " in size");
        }
    }

    /** The section object {@code key} with its keys checked, or null when absent. */
    private static JsonObject section(JsonObject json, String key, Set<String> keys, Consumer<String> warnings) {
        JsonObject section = PackJson.optionalObject(json, key, "");
        if (section != null) {
            PackJson.checkKeys(section, keys, key, warnings);
        }
        return section;
    }

    /** The {@code brakes.system} named, or the default one. */
    private static StockDefaults.BrakeSystem brakeSystem(JsonObject brakes) {
        String name = PackJson.optionalString(brakes, "system", "brakes");
        if (name == null) {
            return StockDefaults.DEFAULT_BRAKE_SYSTEM;
        }
        StockDefaults.BrakeSystem system = StockDefaults.BrakeSystem.byName(name);
        if (system == null) {
            throw new JsonSyntaxException("unknown brake system 'brakes.system' = '" + name
                    + "' (passenger, freight or ep)");
        }
        return system;
    }

    /**
     * A physical amount: {@code fallback} if absent (NaN fallback = required),
     * else a finite number ≥ 0 — a negative force or speed is a typo that
     * would otherwise reach the physics.
     */
    private static double amount(JsonObject json, String field, String where, double fallback) {
        if (!json.has(field)) {
            if (Double.isNaN(fallback)) {
                throw new JsonSyntaxException("missing required field '" + PackJson.at(where, field) + "'");
            }
            return fallback;
        }
        double value = PackJson.number(json.get(field), PackJson.at(where, field));
        if (!(value >= 0.0)) {
            throw new JsonSyntaxException("'" + PackJson.at(where, field) + "' must be a number ≥ 0, got "
                    + format(value));
        }
        return value;
    }

    /**
     * Optional {@code aliases} (SPEC §6.4): old type ids this declaration
     * takes over, e.g. {@code "aliases": ["rwat:chme3"]} — saves that reference
     * an old id load as this type. A registry concern, not part of the type.
     *
     * @throws JsonSyntaxException if it isn't an array of strings
     */
    public static List<String> aliases(JsonObject json) {
        JsonArray array = PackJson.optionalArray(json, "aliases", "");
        if (array == null) {
            return List.of();
        }
        List<String> aliases = new ArrayList<>();
        for (int i = 0; i < array.size(); i++) {
            aliases.add(PackJson.string(array.get(i), PackJson.at("aliases", i)));
        }
        return aliases;
    }

    /**
     * Optional {@code doors} list (SPEC v1.5, doors):
     * {@code "doors": [ { "id": "door1", "min": [x,y,z], "max": [x,y,z] } ]} —
     * each door leaf's box in model space. Order = door index. Optional flags
     * (SPEC §9.1): {@code "inner": true} — a door between floor zones,
     * {@code "fixed": true} — an always-open opening without a leaf;
     * {@code "connecting": true} (SPEC §9.5) — an end door onto the gangway
     * to the coupled neighbour; {@code "group": "<name>"} — doors of one group
     * open and close together, the name matched case aside; {@code ""} or
     * {@code null} is no group.
     */
    private static List<WagonType.Door> doors(JsonObject json, Consumer<String> warnings) {
        JsonArray array = PackJson.optionalArray(json, "doors", "");
        if (array == null) {
            return List.of();
        }
        List<WagonType.Door> doors = new ArrayList<>();
        for (int i = 0; i < array.size(); i++) {
            String where = PackJson.at("doors", i);
            JsonObject door = PackJson.object(array.get(i), where);
            PackJson.checkKeys(door, DOOR_KEYS, where, warnings);
            String id = PackJson.requiredString(door, "id", where);
            double[] min = vec3(door, "min", where);
            double[] max = vec3(door, "max", where);
            JsonElement group = door.get("group");
            doors.add(new WagonType.Door(id, min[0], min[1], min[2], max[0], max[1], max[2],
                    PackJson.optionalBool(door, "inner", where, false),
                    PackJson.optionalBool(door, "fixed", where, false),
                    PackJson.optionalBool(door, "connecting", where, false),
                    group == null || group.isJsonNull() ? null
                            : PackJson.string(group, PackJson.at(where, "group"))));
        }
        return doors;
    }

    /**
     * The {@code cab} section (SPEC §5.1, §9): presence = drivable; optional
     * driver's chairs {@code "seats": [ {"at": [x,y,z], "yaw": deg}, … ]} —
     * {@code at} the top of the cushion (model space), facing {@code yaw}
     * degrees (0 = forward, 180 = the other end's cab; default 0). The older
     * one-chair form {@code "seat": [x,y,z], "seat_yaw": deg} still reads.
     */
    private static WagonType.Cab cab(JsonObject cab, Consumer<String> warnings) {
        if (cab.has("seat") && cab.has("seats")) {
            throw new JsonSyntaxException("'cab' has both 'seat' and 'seats': list every chair in 'seats'");
        }
        if (cab.has("seat")) {
            double[] seat = vec3(cab, "seat", "cab");
            return new WagonType.Cab(List.of(new WagonType.Seat(seat[0], seat[1], seat[2],
                    (float) PackJson.optionalNumber(cab, "seat_yaw", "cab", 0.0))));
        }
        JsonArray array = PackJson.optionalArray(cab, "seats", "cab");
        if (array == null) {
            return new WagonType.Cab();
        }
        if (array.size() > MAX_SEATS) {
            throw new JsonSyntaxException("'cab.seats' lists more than " + MAX_SEATS + " chairs");
        }
        List<WagonType.Seat> seats = new ArrayList<>();
        for (int i = 0; i < array.size(); i++) {
            String where = PackJson.at("cab.seats", i);
            JsonObject seat = PackJson.object(array.get(i), where);
            PackJson.checkKeys(seat, SEAT_KEYS, where, warnings);
            double[] at = vec3(seat, "at", where);
            seats.add(new WagonType.Seat(at[0], at[1], at[2],
                    (float) PackJson.optionalNumber(seat, "yaw", where, 0.0)));
        }
        return new WagonType.Cab(seats);
    }

    /**
     * Optional {@code interior} (SPEC v1.5-б, §9.1): one box
     * {@code "interior": { "min": [x,y,z], "max": [x,y,z] }} or a list of
     * floor zones {@code "interior": [ {min,max}, … ]}, in model space.
     * Absent → not walk-boardable.
     */
    private static WagonType.Interior interior(JsonObject json, Consumer<String> warnings) {
        JsonElement element = json.get("interior");
        if (element == null) {
            return null;
        }
        List<WagonType.Interior.Zone> zones = new ArrayList<>();
        if (element.isJsonArray()) {
            JsonArray array = element.getAsJsonArray();
            for (int i = 0; i < array.size(); i++) {
                zones.add(zone(PackJson.object(array.get(i), PackJson.at("interior", i)),
                        PackJson.at("interior", i), warnings));
            }
            if (zones.isEmpty()) {
                throw new JsonSyntaxException("'interior' lists no zones");
            }
        } else if (element.isJsonObject()) {
            zones.add(zone(element.getAsJsonObject(), "interior", warnings));
        } else {
            throw PackJson.wrongType("interior", "an object {min, max} or an array of them", element);
        }
        return new WagonType.Interior(zones);
    }

    private static WagonType.Interior.Zone zone(JsonObject box, String where, Consumer<String> warnings) {
        PackJson.checkKeys(box, ZONE_KEYS, where, warnings);
        double[] min = vec3(box, "min", where);
        double[] max = vec3(box, "max", where);
        return new WagonType.Interior.Zone(min[0], min[1], min[2], max[0], max[1], max[2]);
    }

    private static double[] vec3(JsonObject json, String field, String where) {
        String path = PackJson.at(where, field);
        JsonArray array = PackJson.requiredArray(json, field, where);
        if (array.size() != 3) {
            throw new JsonSyntaxException("'" + path + "' must be a 3-element array [x, y, z]");
        }
        return new double[]{PackJson.number(array.get(0), PackJson.at(path, 0)),
                PackJson.number(array.get(1), PackJson.at(path, 1)),
                PackJson.number(array.get(2), PackJson.at(path, 2))};
    }

    private static double[] bogies(JsonObject json) {
        JsonArray array = PackJson.requiredArray(json, "bogies", "");
        if (array.isEmpty()) {
            throw new JsonSyntaxException("'bogies' must list at least one pivot offset");
        }
        double[] bogies = new double[array.size()];
        for (int i = 0; i < bogies.length; i++) {
            bogies[i] = PackJson.number(array.get(i), PackJson.at("bogies", i));
        }
        return bogies;
    }

    /** A number as a pack author wrote it: {@code 9} rather than {@code 9.0}. */
    private static String format(double value) {
        return value == Math.rint(value) && Math.abs(value) < 1.0e15
                ? Long.toString((long) value) : Double.toString(value);
    }
}
