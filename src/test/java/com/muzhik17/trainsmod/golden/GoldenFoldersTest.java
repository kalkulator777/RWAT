package com.muzhik17.trainsmod.golden;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/**
 * The meta-test of the Java golden runners (editor.md 4.4, item 4): every
 * folder of {@code fixtures/golden/} says in its {@code ports.json} who reads
 * it, and every folder that names Java is read by its runner — the class
 * {@code <Logic>Golden} of this package ({@code floor_check} →
 * {@code FloorCheckGolden}) with a test factory. The Python suite checks the
 * same of its runners and the files' format by {@code fixtures/golden/schema.json}
 * ({@code tools/tests/test_golden_folders.py}).
 */
class GoldenFoldersTest {

    private static final Set<String> LANGUAGES = Set.of("java", "python", "ts");

    static List<String> folders() throws IOException {
        try (Stream<Path> entries = Files.list(Golden.ROOT)) {
            return entries.filter(Files::isDirectory).map(p -> p.getFileName().toString()).sorted().toList();
        }
    }

    /** {@code floor_check} → {@code FloorCheckGolden}. */
    static String runner(String folder) {
        StringBuilder name = new StringBuilder();
        for (String word : folder.split("_")) {
            name.append(word.substring(0, 1).toUpperCase(Locale.ROOT)).append(word.substring(1));
        }
        return Golden.class.getPackageName() + "." + name + "Golden";
    }

    @Test
    void everyFolderSaysWhoReadsIt() throws IOException {
        List<String> folders = folders();
        assertTrue(folders.size() >= 10, "folders: " + folders);
        for (String folder : folders) {
            assertTrue(folder.matches("[a-z0-9]+(?:_[a-z0-9]+)*"), "folder name " + folder);
            JsonObject ports = Golden.ports(folder);
            assertEquals(Set.of("reference", "ports"), ports.keySet(), folder + "/ports.json");
            String reference = ports.get("reference").getAsString();
            assertTrue(Set.of("java", "python").contains(reference), folder + ": reference " + reference);
            Set<String> seen = new TreeSet<>();
            for (JsonElement port : ports.getAsJsonArray("ports")) {
                String language = port.getAsString();
                assertTrue(LANGUAGES.contains(language) && !language.equals(reference) && seen.add(language),
                        folder + ": port " + language);
            }
            assertTrue(!Golden.caseFiles(folder).isEmpty(), folder + " has no case file");
        }
    }

    @TestFactory
    Stream<DynamicTest> everyFolderNamingJavaHasItsRunner() throws IOException {
        List<DynamicTest> tests = new ArrayList<>();
        for (String folder : folders()) {
            if (!Golden.reads(Golden.ports(folder), "java")) {
                continue;
            }
            tests.add(DynamicTest.dynamicTest(folder, () -> {
                Class<?> runner = Class.forName(runner(folder));
                Field field = runner.getDeclaredField("FOLDER");
                field.setAccessible(true);
                assertEquals(folder, field.get(null), runner.getSimpleName() + ".FOLDER");
                boolean factory = false;
                for (Method method : runner.getDeclaredMethods()) {
                    factory |= method.isAnnotationPresent(TestFactory.class);
                }
                assertTrue(factory, runner.getSimpleName() + " has no @TestFactory");
            }));
        }
        assertTrue(!tests.isEmpty());
        return tests.stream();
    }
}
