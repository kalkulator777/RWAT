package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.google.gson.JsonParser;
import com.google.gson.JsonSyntaxException;

/** The rail style declaration both sides read (fix list D5): one reading, a floor under the tile length. */
class RailStyleDeclTest {

    private static RailStyleDecl parse(String text, List<String> warnings) {
        return RailStyleDecl.parse("mvp", JsonParser.parseString(text).getAsJsonObject(), warnings::add);
    }

    private static String error(String text) {
        return assertThrows(JsonSyntaxException.class, () -> parse(text, new ArrayList<>())).getMessage();
    }

    @Test
    void objIsQualifiedAndTheTileRepeatsEveryBlockByDefault() {
        List<String> warnings = new ArrayList<>();
        assertEquals(new RailStyleDecl("mvp:stock/tracks/rail.obj", 1.0),
                parse("{ \"obj\": \"stock/tracks/rail.obj\" }", warnings));
        assertEquals(new RailStyleDecl("other:rail.obj", 1.625),
                parse("{ \"obj\": \"other:rail.obj\", \"tile_length\": 1.625 }", warnings));
        assertEquals(List.of(), warnings);
    }

    /**
     * A tile near zero long used to pass (only {@code > 0} was asked) and
     * cost a tile per hair of every segment on both sides; the floor is a
     * quarter block.
     */
    @Test
    void tileLengthHasAFloor() {
        assertEquals(RailStyleDecl.MIN_TILE_LENGTH,
                parse("{ \"obj\": \"a.obj\", \"tile_length\": 0.25 }", new ArrayList<>()).tileLength());
        assertEquals("'tile_length' must be at least 0.25 blocks, got 0.001",
                error("{ \"obj\": \"a.obj\", \"tile_length\": 0.001 }"));
        assertEquals("'tile_length' must be at least 0.25 blocks, got 0.0",
                error("{ \"obj\": \"a.obj\", \"tile_length\": 0 }"));
        assertEquals("'tile_length' must be at least 0.25 blocks, got -1.0",
                error("{ \"obj\": \"a.obj\", \"tile_length\": -1 }"));
    }

    @Test
    void nullsAndWrongTypesAreNamedErrors() {
        assertEquals("missing required field 'obj'", error("{ \"tile_length\": 1 }"));
        assertEquals("'obj' must be a string, got null", error("{ \"obj\": null }"));
        assertEquals("'tile_length' must be a finite number, got the string \"1\"",
                error("{ \"obj\": \"a.obj\", \"tile_length\": \"1\" }"));
    }

    @Test
    void unknownKeyWarnsWithAHint() {
        List<String> warnings = new ArrayList<>();
        assertEquals(1.0, parse("{ \"obj\": \"a.obj\", \"tile_lenght\": 2 }", warnings).tileLength());
        assertEquals(List.of("unknown key 'tile_lenght' (ignored) — did you mean 'tile_length'?"), warnings);
    }
}
