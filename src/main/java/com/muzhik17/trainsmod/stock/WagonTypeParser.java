package com.muzhik17.trainsmod.stock;

import java.util.ArrayList;
import java.util.List;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonSyntaxException;

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
 * <p>Uses GSON only (ships with the game, not an MC class) so the stock
 * package stays engine-free and the parser unit-testable.
 */
public final class WagonTypeParser {

    private WagonTypeParser() {
    }

    /**
     * Parse one declaration. {@code id} comes from the file's resource
     * location, not the JSON body — files can't lie about their identity.
     *
     * @throws JsonSyntaxException on a missing required field or a bad shape
     */
    public static WagonType parse(String id, JsonObject json) {
        double length = requiredDouble(json, "length");
        double[] bogies = bogies(json);
        double massT = requiredDouble(json, "mass_t");
        if (!(massT > 0.0) || Double.isInfinite(massT)) {
            throw new JsonSyntaxException("'mass_t' must be a positive number");
        }
        double maxSpeedKmh = amount(json, "max_speed_kmh", 0.0);

        WagonType.Resistance resistance = StockDefaults.resistance(massT);
        if (json.has("resistance")) {
            JsonObject r = json.getAsJsonObject("resistance");
            resistance = new WagonType.Resistance(
                    amount(r, "a", resistance.a()), amount(r, "b", resistance.b()),
                    amount(r, "c", resistance.c()), amount(r, "c_front", resistance.cFront()));
        }

        WagonType.Traction traction = null;
        if (json.has("traction")) {
            JsonObject t = json.getAsJsonObject("traction");
            traction = new WagonType.Traction(
                    amount(t, "power_kw", Double.NaN),
                    amount(t, "max_tractive_effort_kn", Double.NaN),
                    amount(t, "adhesion", StockDefaults.ADHESION),
                    amount(t, "ramp_s", StockDefaults.TRACTION_RAMP_S));
        }

        WagonType.Cab cab = json.has("cab") ? cab(json.getAsJsonObject("cab")) : null;

        JsonObject b = json.has("brakes") ? json.getAsJsonObject("brakes") : new JsonObject();
        WagonType.Brakes defaults = StockDefaults.brakes(brakeSystem(b), massT, cab != null);
        WagonType.Brakes brakes = new WagonType.Brakes(
                amount(b, "train_kn", defaults.trainKn()),
                amount(b, "independent_kn", defaults.independentKn()),
                amount(b, "dynamic_kn", defaults.dynamicKn()),
                amount(b, "dynamic_fade_kmh", defaults.dynamicFadeKmh()),
                amount(b, "parking_kn", defaults.parkingKn()),
                amount(b, "apply_s", defaults.applyS()),
                amount(b, "release_s", defaults.releaseS()));

        WagonType.Interior interior = interior(json);
        List<WagonType.Door> doors = doors(json);

        WagonType.Couplers couplers = WagonType.Couplers.AT_ENDS;
        if (json.has("couplers")) {
            JsonObject c = json.getAsJsonObject("couplers");
            couplers = new WagonType.Couplers(optionalDouble(c, "front"), optionalDouble(c, "rear"));
        }

        return new WagonType(id, length, bogies, massT, maxSpeedKmh,
                resistance, traction, cab, brakes, interior, doors, couplers);
    }

    /** The {@code brakes.system} named, or the default one. */
    private static StockDefaults.BrakeSystem brakeSystem(JsonObject brakes) {
        if (!brakes.has("system")) {
            return StockDefaults.DEFAULT_BRAKE_SYSTEM;
        }
        String name = brakes.get("system").getAsString();
        StockDefaults.BrakeSystem system = StockDefaults.BrakeSystem.byName(name);
        if (system == null) {
            throw new JsonSyntaxException("unknown brake system '" + name
                    + "' (passenger, freight or ep)");
        }
        return system;
    }

    /**
     * A physical amount: {@code fallback} if absent (NaN fallback = required),
     * else a finite number ≥ 0 — a negative force or speed is a typo that
     * would otherwise reach the physics.
     */
    private static double amount(JsonObject json, String field, double fallback) {
        if (!json.has(field)) {
            if (Double.isNaN(fallback)) {
                throw new JsonSyntaxException("missing required field '" + field + "'");
            }
            return fallback;
        }
        double value = json.get(field).getAsDouble();
        if (!(value >= 0.0) || Double.isInfinite(value)) {
            throw new JsonSyntaxException("'" + field + "' must be a number ≥ 0, got " + value);
        }
        return value;
    }

    /**
     * Optional {@code aliases} (SPEC §6.4): old type ids this declaration
     * takes over, e.g. {@code "aliases": ["rwat:chme3"]} — saves that reference
     * an old id load as this type. A registry concern, not part of the type.
     */
    public static List<String> aliases(JsonObject json) {
        if (!json.has("aliases")) {
            return List.of();
        }
        List<String> aliases = new ArrayList<>();
        for (JsonElement alias : json.getAsJsonArray("aliases")) {
            aliases.add(alias.getAsString());
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
     * open and close together.
     */
    private static List<WagonType.Door> doors(JsonObject json) {
        if (!json.has("doors")) {
            return List.of();
        }
        List<WagonType.Door> doors = new ArrayList<>();
        for (JsonElement element : json.getAsJsonArray("doors")) {
            JsonObject door = element.getAsJsonObject();
            if (!door.has("id")) {
                throw new JsonSyntaxException("every door needs an 'id'");
            }
            double[] min = vec3(door, "min");
            double[] max = vec3(door, "max");
            doors.add(new WagonType.Door(door.get("id").getAsString(),
                    min[0], min[1], min[2], max[0], max[1], max[2],
                    door.has("inner") && door.get("inner").getAsBoolean(),
                    door.has("fixed") && door.get("fixed").getAsBoolean(),
                    door.has("connecting") && door.get("connecting").getAsBoolean(),
                    door.has("group") && !door.get("group").isJsonNull()
                            ? door.get("group").getAsString() : null));
        }
        return doors;
    }

    /**
     * The {@code cab} section (SPEC §5.1, §9): presence = drivable; an
     * optional driver's chair {@code "seat": [x,y,z]} (top of the cushion,
     * model space) facing {@code "seat_yaw"} degrees (0 = forward).
     */
    private static WagonType.Cab cab(JsonObject cab) {
        if (!cab.has("seat")) {
            return new WagonType.Cab();
        }
        double[] seat = vec3(cab, "seat");
        return new WagonType.Cab(new WagonType.Seat(seat[0], seat[1], seat[2],
                (float) optionalDouble(cab, "seat_yaw")));
    }

    /**
     * Optional {@code interior} (SPEC v1.5-б, §9.1): one box
     * {@code "interior": { "min": [x,y,z], "max": [x,y,z] }} or a list of
     * floor zones {@code "interior": [ {min,max}, … ]}, in model space.
     * Absent → not walk-boardable.
     */
    private static WagonType.Interior interior(JsonObject json) {
        if (!json.has("interior")) {
            return null;
        }
        JsonElement element = json.get("interior");
        List<WagonType.Interior.Zone> zones = new ArrayList<>();
        if (element.isJsonArray()) {
            for (JsonElement zone : element.getAsJsonArray()) {
                zones.add(zone(zone.getAsJsonObject()));
            }
            if (zones.isEmpty()) {
                throw new JsonSyntaxException("'interior' lists no zones");
            }
        } else {
            zones.add(zone(element.getAsJsonObject()));
        }
        return new WagonType.Interior(zones);
    }

    private static WagonType.Interior.Zone zone(JsonObject box) {
        double[] min = vec3(box, "min");
        double[] max = vec3(box, "max");
        return new WagonType.Interior.Zone(min[0], min[1], min[2], max[0], max[1], max[2]);
    }

    private static double[] vec3(JsonObject json, String field) {
        if (!json.has(field)) {
            throw new JsonSyntaxException("missing required field '" + field + "'");
        }
        JsonArray array = json.getAsJsonArray(field);
        if (array.size() != 3) {
            throw new JsonSyntaxException("'" + field + "' must be a 3-element array");
        }
        return new double[]{array.get(0).getAsDouble(), array.get(1).getAsDouble(),
                array.get(2).getAsDouble()};
    }

    private static double[] bogies(JsonObject json) {
        if (!json.has("bogies")) {
            throw new JsonSyntaxException("missing required field 'bogies'");
        }
        JsonArray array = json.getAsJsonArray("bogies");
        if (array.isEmpty()) {
            throw new JsonSyntaxException("'bogies' must list at least one pivot offset");
        }
        double[] bogies = new double[array.size()];
        for (int i = 0; i < bogies.length; i++) {
            bogies[i] = array.get(i).getAsDouble();
        }
        return bogies;
    }

    private static double requiredDouble(JsonObject json, String field) {
        if (!json.has(field)) {
            throw new JsonSyntaxException("missing required field '" + field + "'");
        }
        return json.get(field).getAsDouble();
    }

    private static double optionalDouble(JsonObject json, String field) {
        return json.has(field) ? json.get(field).getAsDouble() : 0.0;
    }
}
