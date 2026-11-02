package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * The pack format's schemas ({@code schema/}, roadmap R4) and the parsers know
 * the same keys. Each object of a schema names, in {@code x-keys}, the constant
 * of the code that lists its keys ({@code "stock/WagonTypeParser.java#DOOR_KEYS"});
 * the parser warns about any key that constant doesn't list. This test holds
 * the two equal both ways, so a key added or renamed on one side only fails
 * the build:
 * <ul>
 * <li>every closed object of a pack file's schema (the files of
 *     {@code schema/pack-layout.json}) names its constant — a new section
 *     can't slip past;</li>
 * <li>the object's properties are exactly the constant's keys;</li>
 * <li>the properties marked {@code x-status: reserved} are exactly the
 *     constant's {@code RESERVED_} companion ({@code RESERVED_BRAKES_KEYS}), the
 *     keys the loader warns about when they are set (R7);</li>
 * <li>every {@code *KEYS} constant of a class a schema names is named by some
 *     object (or is such a companion) — a new key set can't slip past either.</li>
 * </ul>
 * The converter's constants ({@code tools/…}) are held to the recipe schemas
 * by {@code tools/validate_pack.py --self-check}, which reads the same
 * {@code x-keys}.
 */
class SchemaKeysTest {

    private static final Path SCHEMA_DIR = Path.of("schema");
    private static final String CODE_PACKAGE = "com.muzhik17.trainsmod.";
    private static final String RESERVED = "RESERVED_";

    /** An object of a schema document: the file, its JSON pointer, the schema node. */
    private record Section(String file, String pointer, JsonObject schema) {

        String where() {
            return file + "#" + pointer;
        }

        boolean closed() {
            JsonElement extra = schema.get("additionalProperties");
            return extra != null && extra.isJsonPrimitive() && !extra.getAsBoolean();
        }
    }

    @Test
    void everySectionHasTheKeysOfItsParser() throws IOException, ReflectiveOperationException {
        List<String> problems = new ArrayList<>();
        Set<String> packFiles = packFileSchemas();
        Map<String, Set<String>> named = new LinkedHashMap<>(); // class → the constants the schemas name

        for (Section section : sections()) {
            String ref = section.schema().has("x-keys") ? section.schema().get("x-keys").getAsString() : null;
            if (ref == null) {
                if (packFiles.contains(section.file()) && section.closed()) {
                    problems.add(section.where() + ": a closed object of a pack file without x-keys"
                            + " (name the constant of the parser that lists its keys)");
                }
                continue;
            }
            if (ref.startsWith("tools/")) {
                continue; // the converter's: validate_pack.py --self-check
            }
            int hash = ref.indexOf('#');
            String className = className(ref.substring(0, hash));
            String constant = ref.substring(hash + 1);
            Class<?> owner = Class.forName(className);
            named.computeIfAbsent(className, c -> new LinkedHashSet<>()).add(constant);

            Set<String> code = keys(owner, constant);
            Set<String> schema = section.schema().getAsJsonObject("properties").keySet();
            compare(problems, section.where() + " ↔ " + owner.getSimpleName() + "." + constant, schema, code);

            Set<String> reservedInSchema = new TreeSet<>();
            for (Map.Entry<String, JsonElement> property : section.schema().getAsJsonObject("properties").entrySet()) {
                JsonElement status = property.getValue().getAsJsonObject().get("x-status");
                if (status != null && "reserved".equals(status.getAsString())) {
                    reservedInSchema.add(property.getKey());
                }
            }
            String companion = RESERVED + constant;
            if (hasField(owner, companion)) {
                Set<String> reserved = keys(owner, companion);
                compare(problems, section.where() + " x-status reserved ↔ " + owner.getSimpleName() + "."
                        + companion, reservedInSchema, reserved);
                if (!code.containsAll(reserved)) {
                    problems.add(owner.getSimpleName() + "." + companion + " lists keys " + constant + " doesn't");
                }
            } else if (!reservedInSchema.isEmpty()) {
                problems.add(section.where() + ": " + reservedInSchema + " marked reserved, but "
                        + owner.getSimpleName() + " has no " + companion + " to warn about them");
            }
        }

        for (Map.Entry<String, Set<String>> entry : named.entrySet()) {
            Class<?> owner = Class.forName(entry.getKey());
            for (Field field : owner.getDeclaredFields()) {
                String name = field.getName();
                if (!Modifier.isStatic(field.getModifiers()) || !name.endsWith("KEYS")
                        || !Collection.class.isAssignableFrom(field.getType())) {
                    continue;
                }
                boolean companion = name.startsWith(RESERVED) && entry.getValue().contains(name.substring(RESERVED.length()));
                if (!entry.getValue().contains(name) && !companion) {
                    problems.add(owner.getSimpleName() + "." + name + " is named by no x-keys of the schemas");
                }
            }
        }

        assertTrue(named.containsKey(CODE_PACKAGE + "stock.WagonTypeParser"), "no schema names WagonTypeParser");
        assertEquals(List.of(), problems);
    }

    /** One line per direction a key set and a schema object differ in. */
    private static void compare(List<String> problems, String what, Set<String> schema, Set<String> code) {
        Set<String> onlySchema = new TreeSet<>(schema);
        onlySchema.removeAll(code);
        Set<String> onlyCode = new TreeSet<>(code);
        onlyCode.removeAll(schema);
        if (!onlySchema.isEmpty()) {
            problems.add(what + ": in the schema, not in the code: " + onlySchema);
        }
        if (!onlyCode.isEmpty()) {
            problems.add(what + ": in the code, not in the schema: " + onlyCode);
        }
    }

    /** "stock/WagonTypeParser.java" → its class name. */
    private static String className(String file) {
        return CODE_PACKAGE + file.substring(0, file.length() - ".java".length()).replace('/', '.');
    }

    private static boolean hasField(Class<?> owner, String name) {
        return Stream.of(owner.getDeclaredFields()).anyMatch(f -> f.getName().equals(name));
    }

    /** The keys a static constant lists (a Set or List of strings, public or not). */
    private static Set<String> keys(Class<?> owner, String name) throws ReflectiveOperationException {
        Field field = owner.getDeclaredField(name);
        field.setAccessible(true);
        Set<String> keys = new TreeSet<>();
        for (Object key : (Collection<?>) field.get(null)) {
            keys.add((String) key);
        }
        return keys;
    }

    /** The schemas of the files a pack holds (pack-layout.json's files). */
    private static Set<String> packFileSchemas() throws IOException {
        JsonObject layout = JsonParser.parseString(Files.readString(SCHEMA_DIR.resolve("pack-layout.json")))
                .getAsJsonObject();
        Set<String> schemas = new TreeSet<>();
        for (JsonElement file : layout.getAsJsonArray("files")) {
            JsonElement schema = file.getAsJsonObject().get("schema");
            if (schema != null) {
                schemas.add(schema.getAsString());
            }
        }
        assertTrue(schemas.contains("wagon_type.schema.json"), "pack-layout.json lists no wagon type schema");
        return schemas;
    }

    /** Every object with properties in every schema file. */
    private static List<Section> sections() throws IOException {
        List<Section> sections = new ArrayList<>();
        try (Stream<Path> files = Files.list(SCHEMA_DIR)) {
            for (Path path : files.filter(p -> p.getFileName().toString().endsWith(".schema.json")).sorted().toList()) {
                String file = path.getFileName().toString();
                walk(file, "", JsonParser.parseString(Files.readString(path)), sections);
            }
        }
        return sections;
    }

    private static void walk(String file, String pointer, JsonElement node, List<Section> out) {
        if (!node.isJsonObject()) {
            return;
        }
        JsonObject schema = node.getAsJsonObject();
        if (schema.has("properties") && schema.get("properties").isJsonObject()) {
            out.add(new Section(file, pointer, schema));
        }
        for (String key : List.of("properties", "$defs", "patternProperties")) {
            if (schema.has(key) && schema.get(key).isJsonObject()) {
                for (Map.Entry<String, JsonElement> entry : schema.getAsJsonObject(key).entrySet()) {
                    walk(file, pointer + "/" + key + "/" + escape(entry.getKey()), entry.getValue(), out);
                }
            }
        }
        for (String key : List.of("items", "additionalProperties", "propertyNames", "not")) {
            if (schema.has(key)) {
                walk(file, pointer + "/" + key, schema.get(key), out);
            }
        }
        for (String key : List.of("anyOf", "oneOf", "allOf")) {
            if (schema.has(key) && schema.get(key).isJsonArray()) {
                JsonArray branches = schema.getAsJsonArray(key);
                for (int i = 0; i < branches.size(); i++) {
                    walk(file, pointer + "/" + key + "/" + i, branches.get(i), out);
                }
            }
        }
    }

    /** A key as a JSON pointer token. */
    private static String escape(String key) {
        return key.replace("~", "~0").replace("/", "~1");
    }
}
