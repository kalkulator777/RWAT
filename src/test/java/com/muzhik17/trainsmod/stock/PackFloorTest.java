package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.muzhik17.trainsmod.kinematics.FloorCheck;

/**
 * Every stock type of the generated packs in {@code run/rwat_packs} parses
 * and has a floor a player can actually walk (SPEC §9.6, {@link FloorCheck}):
 * one test per type, each listing all of its problems. The packs are not in
 * the repository (their content is third-party): generate them first with
 * {@code python tools/ir2rwat.py packs/mvp.json}, or this is skipped.
 */
class PackFloorTest {

    private static final Path PACKS = Path.of("run/rwat_packs");

    @TestFactory
    Stream<DynamicTest> everyTypeHasAWalkableFloor() throws IOException {
        assumeTrue(Files.isDirectory(PACKS), "no generated packs in " + PACKS);
        List<Path> types;
        try (Stream<Path> files = Files.walk(PACKS)) {
            types = files.filter(p -> p.toString().replace('\\', '/').matches(".*/data/[^/]+/wagon_types/[^/]+\\.json"))
                    .sorted().toList();
        }
        assumeTrue(!types.isEmpty(), "no wagon types in " + PACKS);
        return types.stream().map(path -> DynamicTest.dynamicTest(id(path), () -> {
            JsonObject json = JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8))
                    .getAsJsonObject();
            WagonType type = WagonTypeParser.parse(id(path), json);
            List<String> problems = FloorCheck.problems(type);
            assertTrue(problems.isEmpty(), id(path) + ":\n  " + String.join("\n  ", problems));
        }));
    }

    /** {@code <ns>:<id>} from {@code …/data/<ns>/wagon_types/<id>.json}. */
    private static String id(Path path) {
        String namespace = path.getParent().getParent().getFileName().toString();
        String file = path.getFileName().toString();
        return namespace + ":" + file.substring(0, file.length() - ".json".length());
    }
}
