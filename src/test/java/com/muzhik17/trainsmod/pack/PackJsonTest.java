package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonSyntaxException;

/** Strict reading of pack JSON: unknown keys warn with a hint, nulls and wrong types are named errors. */
class PackJsonTest {

    private static final Set<String> TYPE_KEYS = PackJson.keys("length", "bogies", "mass_t", "max_speed_kmh",
            "resistance", "traction", "brakes", "cab", "interior", "doors", "couplers", "aliases");

    private static JsonObject json(String text) {
        return JsonParser.parseString(text).getAsJsonObject();
    }

    /** The hints a pack author most likely needs: a cut-off unit, a swapped letter, a wrong case. */
    @Test
    void nearest_findsTheKeyATypoMissed() {
        assertEquals("max_speed_kmh", PackJson.nearest("max_speed", TYPE_KEYS));
        assertEquals("mass_t", PackJson.nearest("mass", TYPE_KEYS));
        assertEquals("length", PackJson.nearest("lenght", TYPE_KEYS));
        assertEquals("length", PackJson.nearest("Length", TYPE_KEYS));
        assertEquals("bogies", PackJson.nearest("bogie", TYPE_KEYS));
        assertEquals("max_speed_kmh", PackJson.nearest("maxspeed", TYPE_KEYS), "underscores aside");
        assertEquals("tile_length", PackJson.nearest("tile_lenght", Set.of("obj", "tile_length")));
        assertEquals("power_kw", PackJson.nearest("power", Set.of("power_kw", "max_tractive_effort_kn")));
    }

    /** Nothing close, no hint — and a one-letter key doesn't attract every short typo. */
    @Test
    void nearest_givesNoHintWhenNothingIsClose() {
        assertNull(PackJson.nearest("colour", TYPE_KEYS));
        assertNull(PackJson.nearest("foo", Set.of("obj", "tile_length")));
        assertNull(PackJson.nearest("d", Set.of("a", "b", "c", "c_front")));
        assertEquals("a", PackJson.nearest("A", Set.of("a", "b", "c")), "case aside, even one letter");
    }

    @Test
    void checkKeys_warnsAboutEachUnknownKeyByItsPath() {
        List<String> warnings = new ArrayList<>();
        PackJson.checkKeys(json("{ \"min\": [0,0,0], \"max\": [1,1,1], \"hieght\": 2, \"note\": \"x\" }"),
                Set.of("min", "max"), "interior[3]", warnings::add);
        assertEquals(List.of("unknown key 'interior[3].hieght' (ignored)",
                "unknown key 'interior[3].note' (ignored)"), warnings);
        warnings.clear();
        PackJson.checkKeys(json("{ \"lenght\": 2 }"), TYPE_KEYS, "", warnings::add);
        assertEquals(List.of("unknown key 'lenght' (ignored) — did you mean 'length'?"), warnings);
    }

    @Test
    void wrongTypes_nameTheFieldAndTheTypeExpected() {
        JsonObject o = json("{ \"n\": null, \"s\": \"95\", \"b\": true, \"a\": [1], \"o\": {}, \"x\": 1e999 }");
        assertEquals("'w.n' must be a finite number, got null",
                assertThrows(JsonSyntaxException.class, () -> PackJson.requiredNumber(o, "n", "w")).getMessage());
        assertEquals("'s' must be a finite number, got the string \"95\"",
                assertThrows(JsonSyntaxException.class, () -> PackJson.requiredNumber(o, "s", "")).getMessage());
        assertEquals("'x' must be a finite number, got the number 1e999",
                assertThrows(JsonSyntaxException.class, () -> PackJson.optionalNumber(o, "x", "", 0)).getMessage());
        assertEquals("'b' must be a string, got true",
                assertThrows(JsonSyntaxException.class, () -> PackJson.requiredString(o, "b", "")).getMessage());
        assertEquals("'a' must be an object, got an array",
                assertThrows(JsonSyntaxException.class, () -> PackJson.optionalObject(o, "a", "")).getMessage());
        assertEquals("'o' must be an array, got an object",
                assertThrows(JsonSyntaxException.class, () -> PackJson.optionalArray(o, "o", "")).getMessage());
        assertEquals("'s' must be true or false, got the string \"95\"",
                assertThrows(JsonSyntaxException.class, () -> PackJson.optionalBool(o, "s", "", false)).getMessage());
        assertEquals("missing required field 'w.gone'",
                assertThrows(JsonSyntaxException.class, () -> PackJson.required(o, "gone", "w")).getMessage());
    }

    @Test
    void absentOptionalFields_takeTheFallback() {
        JsonObject o = json("{}");
        assertEquals(1.5, PackJson.optionalNumber(o, "n", "", 1.5));
        assertNull(PackJson.optionalString(o, "s", ""));
        assertTrue(PackJson.optionalBool(o, "b", "", true));
        assertNull(PackJson.optionalObject(o, "o", ""));
        assertNull(PackJson.optionalArray(o, "a", ""));
    }

    @Test
    void keysKeepTheirOrder() {
        assertEquals(List.of("b", "a", "c"), new ArrayList<>(PackJson.keys("b", "a", "c")));
        assertEquals("doors[2].min", PackJson.at(PackJson.at("doors", 2), "min"));
        assertEquals(1, PackJson.distance("tile_length", "tile_lenght"), "a swap is one edit");
    }
}
