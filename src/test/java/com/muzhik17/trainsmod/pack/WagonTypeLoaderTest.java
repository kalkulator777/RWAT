package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.google.gson.JsonParser;

/** The wagon types of a pack set: whole files or nothing, aliases resolved the same way every time. */
class WagonTypeLoaderTest {

    private static final String CAR = "\"length\": 14.0, \"bogies\": [5.0, -5.0], \"mass_t\": 20.0";

    private static WagonTypeLoader.Declaration file(String id, String body) {
        String path = id.substring(id.indexOf(':') + 1);
        return new WagonTypeLoader.Declaration(id,
                new PackOrigin("rwat/Test", "data/" + id.substring(0, id.indexOf(':')) + "/wagon_types/" + path + ".json"),
                JsonParser.parseString(body));
    }

    private static List<String> messages(WagonTypeLoader.Result result) {
        return result.problems().stream().map(PackProblem::toString).toList();
    }

    /**
     * A broken {@code aliases} used to leave its type loaded without them
     * (logged as "Skipping bad wagon type"): the file now loads whole or not at all.
     */
    @Test
    void brokenAliases_skipTheWholeFile() {
        WagonTypeLoader.Result result = WagonTypeLoader.load(List.of(
                file("t:car", "{" + CAR + ", \"aliases\": [\"old:car\", 7] }"),
                file("t:other", "{" + CAR + "}")));
        assertEquals(List.of("t:other"), new ArrayList<>(result.types().keySet()));
        assertTrue(result.aliases().isEmpty());
        assertEquals(List.of("error rwat/Test data/t/wagon_types/car.json: wagon type t:car not loaded:"
                + " 'aliases[1]' must be a string, got the number 7"), messages(result));
        assertEquals(Map.of("rwat/Test", 1), result.loaded());
    }

    /**
     * An alias two types claim used to go to whichever the HashMap met
     * first; now to the lower id, whatever the file order, with an error on
     * both files.
     */
    @Test
    void contestedAlias_goesToTheLowerId_bothTold() {
        List<WagonTypeLoader.Declaration> files = new ArrayList<>(List.of(
                file("t:b", "{" + CAR + ", \"aliases\": [\"old:car\"] }"),
                file("t:a", "{" + CAR + ", \"aliases\": [\"old:car\", \"old:a\"] }"),
                file("t:c", "{" + CAR + ", \"aliases\": [\"old:car\"] }")));
        WagonTypeLoader.Result first = WagonTypeLoader.load(files);
        Collections.reverse(files);
        WagonTypeLoader.Result reversed = WagonTypeLoader.load(files);
        assertEquals(Map.of("old:car", "t:a", "old:a", "t:a"), first.aliases());
        assertEquals(first.aliases(), reversed.aliases());
        assertEquals(messages(first), messages(reversed));
        assertEquals(List.of(
                "error rwat/Test data/t/wagon_types/b.json: alias 'old:car' is also claimed by wagon type t:a,"
                        + " which keeps it (the lower id): ignored here",
                "error rwat/Test data/t/wagon_types/a.json: alias 'old:car' is also claimed by wagon type t:b:"
                        + " this type keeps it (the lower id)",
                "error rwat/Test data/t/wagon_types/c.json: alias 'old:car' is also claimed by wagon type t:a,"
                        + " which keeps it (the lower id): ignored here",
                "error rwat/Test data/t/wagon_types/a.json: alias 'old:car' is also claimed by wagon type t:c:"
                        + " this type keeps it (the lower id)"), messages(first));
        assertEquals(3, first.types().size(), "a lost alias doesn't cost the type");
    }

    @Test
    void aliasThatIsATypeId_isRefused() {
        WagonTypeLoader.Result result = WagonTypeLoader.load(List.of(
                file("t:a", "{" + CAR + ", \"aliases\": [\"t:b\", \"old:a\", \"old:a\"] }"),
                file("t:b", "{" + CAR + "}")));
        assertEquals(Map.of("old:a", "t:a"), result.aliases());
        assertEquals(List.of(
                "error rwat/Test data/t/wagon_types/a.json: alias 't:b' is the id of a loaded wagon type, ignored",
                "warning rwat/Test data/t/wagon_types/a.json: alias 'old:a' is listed twice"), messages(result));
    }

    /** What the parser tolerated and what the floor check finds are warnings: the type loads. */
    @Test
    void warningsKeepTheType() {
        WagonTypeLoader.Result result = WagonTypeLoader.load(List.of(file("t:car", "{" + CAR + """
                , "max_speed": 95,
                  "interior": { "min": [-0.2, 1, -4], "max": [0.2, 3, 4] } }""")));
        assertTrue(result.types().containsKey("t:car"));
        List<String> messages = messages(result);
        assertEquals("warning rwat/Test data/t/wagon_types/car.json: unknown key 'max_speed' (ignored)"
                + " — did you mean 'max_speed_kmh'?", messages.get(0));
        assertTrue(messages.size() > 1 && messages.get(1).startsWith("warning "), "the floor nobody fits on");
    }

    @Test
    void aFileThatIsNoObject_isAnError() {
        WagonTypeLoader.Result result = WagonTypeLoader.load(List.of(file("t:car", "[1, 2]")));
        assertTrue(result.types().isEmpty());
        assertEquals(List.of("error rwat/Test data/t/wagon_types/car.json: wagon type t:car not loaded:"
                + " the file must be a JSON object {…}, got an array"), messages(result));
        assertTrue(result.loaded().isEmpty());
    }
}
