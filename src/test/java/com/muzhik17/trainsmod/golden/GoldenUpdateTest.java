package com.muzhik17.trainsmod.golden;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;

/**
 * The update of the golden data ({@code -Pgolden.update}, {@link Golden#run})
 * rewrites the {@code expected} of the cases and nothing else of a case file:
 * an input keeps its numbers as written ({@code 2.5e1}, {@code 1E1},
 * {@code -0.0}), its escapes and its line breaks, a case whose logic fails
 * keeps its expected, and a file the code agrees with is not touched.
 */
class GoldenUpdateTest {

    /** A file not as the writer would lay it: numbers in exponent form, an escape, an input over two lines. */
    private static final String FILE = """
            {
              "description": "numbers as a pack writes them \\u2014 and a case to fill in",
              "frame": "none",
              "tolerance": 0,
              "cases": [
                {
                  "id": "exponents",
                  "note": "2.5e1 and 1E1 are numbers",
                  "input": {"type": {"length": 2.5e1, "bogies": [1E1, -1E1],
                            "mass_t": 100.0}},
                  "expected": [1, 2]
                },
                {
                  "id": "a-new-case",
                  "note": "written with expected null",
                  "input": {"length": -0.0, "bogies": []},
                  "expected": null
                },
                {
                  "id": "fails",
                  "note": "the logic throws: the expected stays",
                  "input": {"fail": true},
                  "expected": {"kept":   true}
                }
              ]
            }
            """;

    /** The engine's stand-in: the length and the bogies it reads, or a failure. */
    private static JsonElement logic(JsonElement input) {
        JsonObject in = input.getAsJsonObject();
        if (in.has("fail")) {
            throw new IllegalStateException("no logic for this case");
        }
        JsonObject type = in.has("type") ? in.getAsJsonObject("type") : in;
        JsonObject out = new JsonObject();
        out.add("length", Golden.number(type.get("length").getAsDouble()));
        List<Double> bogies = new ArrayList<>();
        type.getAsJsonArray("bogies").forEach(b -> bogies.add(b.getAsDouble()));
        out.add("bogies", Golden.numbers(bogies.stream().mapToDouble(Double::doubleValue).toArray()));
        return out;
    }

    private static Path folder(Path root, String text) throws IOException {
        Path dir = Files.createDirectories(root.resolve("numbers"));
        Files.writeString(dir.resolve("ports.json"), "{\"reference\": \"java\", \"ports\": [\"ts\"]}\n");
        Path file = dir.resolve("cases.json");
        Files.writeString(file, text, StandardCharsets.UTF_8);
        return file;
    }

    @Test
    void theUpdateRewritesOnlyTheExpected(@TempDir Path root) throws IOException {
        Path file = folder(root, FILE);
        Golden.run(root, "numbers", GoldenUpdateTest::logic, true).count();
        String want = FILE
                .replace("\"expected\": [1, 2]", "\"expected\": {\"length\": 25.0, \"bogies\": [10.0, -10.0]}")
                .replace("\"expected\": null", "\"expected\": {\"length\": 0.0, \"bogies\": []}");
        assertEquals(want, Files.readString(file, StandardCharsets.UTF_8));
    }

    @Test
    void aFileTheCodeAgreesWithStaysAsItIs(@TempDir Path root) throws IOException {
        String agreed = FILE
                .replace("\"expected\": [1, 2]", "\"expected\": {\"length\": 25.0, \"bogies\": [10.0, -10.0]}")
                .replace("\"expected\": null", "\"expected\": {\"length\": 0.0, \"bogies\": []}");
        Path file = folder(root, agreed);
        Golden.run(root, "numbers", GoldenUpdateTest::logic, true).count();
        assertEquals(agreed, Files.readString(file, StandardCharsets.UTF_8));
    }

    @Test
    void withoutTheFlagNothingIsWritten(@TempDir Path root) throws IOException {
        Path file = folder(root, FILE);
        Golden.run(root, "numbers", GoldenUpdateTest::logic, false).count();
        assertEquals(FILE, Files.readString(file, StandardCharsets.UTF_8));
    }

    @Test
    void aLongExpectedIsLaidOutAtTheIndentOfItsKey() {
        String text = "{\"cases\": [\n    {\"id\": \"a\",\n      \"expected\": 0}\n]}\n";
        JsonElement value = JsonParser.parseString("[\"" + "x".repeat(60) + "\", \"" + "y".repeat(60) + "\"]");
        assertEquals("{\"cases\": [\n    {\"id\": \"a\",\n      \"expected\": [\n        \"" + "x".repeat(60)
                + "\",\n        \"" + "y".repeat(60) + "\"\n      ]}\n]}\n",
                Golden.withExpected(text, List.of(value)));
    }

    @Test
    void keysAndStringsAreReadWithTheirEscapes() {
        String text = "{\"no\\u0074e\": \"a \\\"cases\\\": [] \\\\\", \"cases\": [{\"expected\": 1, \"x\": {\"expected\": 2}}]}";
        assertEquals(text.replace("\"expected\": 1", "\"expected\": 3"),
                Golden.withExpected(text, List.of(new JsonPrimitive(3))));
    }

    @Test
    void theCasesOfTheTextAreTheCasesGiven() {
        String text = "{\"cases\": [{\"expected\": 1}, {\"expected\": 2}]}";
        assertThrows(IllegalArgumentException.class,
                () -> Golden.withExpected(text, Arrays.asList(new JsonPrimitive(1))));
        assertThrows(IllegalArgumentException.class,
                () -> Golden.withExpected(text + " x", Arrays.<JsonElement>asList(null, null)));
    }
}
