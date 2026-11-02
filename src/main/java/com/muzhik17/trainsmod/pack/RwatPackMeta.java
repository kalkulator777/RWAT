package com.muzhik17.trainsmod.pack;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;

/**
 * The {@code "rwat"} block of a pack's {@code pack.mcmeta}, format v1:
 * <pre>
 * "rwat": { "format": 1, "name": "…", "version": "…", "authors": ["…"],
 *           "license": "…", "description": "…" }
 * </pre>
 * Only {@code format} is required by the format; the rest describes the pack
 * for people ({@code /rwat packs}, the client check against the server's packs).
 *
 * <p>The rules of reading it:
 * <ul>
 * <li>no block, or a block without {@code format}: a warning, the pack is read
 *     as format 1 (packs made before the block existed);</li>
 * <li>{@code format} newer than {@link #SUPPORTED_FORMAT}: an error, the pack
 *     is not loaded — this RWAT can't know what it means;</li>
 * <li>{@code format} not a whole number of 1 or more, or the block not an
 *     object: an error, the pack is not loaded;</li>
 * <li>a descriptive field of the wrong type, or a key the format doesn't know:
 *     a warning, the value is ignored.</li>
 * </ul>
 * The problems name the pack ({@code rwat/<folder>}) and {@code pack.mcmeta},
 * as every loader's do: they go to the pack report ({@link PackReport}) with
 * the rest. Pure Java (Gson only), so the rules are unit-tested.
 */
public record RwatPackMeta(int format, String name, String version, List<String> authors,
        String license, String description) {

    /** The newest pack format this RWAT reads. */
    public static final int SUPPORTED_FORMAT = 1;

    /** The block's key in {@code pack.mcmeta}. */
    public static final String BLOCK = "rwat";

    /** The pack's metadata file, at its root. */
    public static final String MCMETA = "pack.mcmeta";

    /** The keys of format v1, in the order they are listed to the author. */
    static final List<String> KEYS = List.of("format", "name", "version", "authors", "license", "description");

    /** How much of a wrong value a problem message quotes. */
    private static final int QUOTE_LENGTH = 40;

    /**
     * The block's fields; {@code name}, {@code version}, {@code license} and
     * {@code description} are {@code null} when not given (a blank string
     * counts as not given), {@code authors} is empty then.
     */
    public RwatPackMeta {
        authors = List.copyOf(authors);
    }

    /** What reading a pack's block gave: the block, or {@code null} when the pack must not load; and the problems found. */
    public record Result(RwatPackMeta meta, List<PackProblem> problems) {

        public Result {
            problems = List.copyOf(problems);
        }

        /** The pack may be loaded: no error was found. */
        public boolean accepted() {
            return meta != null;
        }

        private static Result rejected(PackOrigin origin, List<PackProblem> problems, String error) {
            List<PackProblem> all = new ArrayList<>(problems);
            all.add(origin.error(error));
            return new Result(null, all);
        }
    }

    /**
     * Reads {@code pack.mcmeta} of a pack folder or zip and its block.
     *
     * @param packId the pack's id in the pack list ({@code rwat/<folder>}), for the problems
     */
    public static Result read(Path pack, String packId) {
        PackOrigin origin = origin(packId);
        String text;
        try {
            text = Files.isDirectory(pack) ? readFromFolder(pack) : readFromZip(pack);
        } catch (IOException e) {
            return Result.rejected(origin, List.of(), "can't read it: " + e.getMessage());
        }
        if (text == null) {
            return Result.rejected(origin, List.of(), "no " + MCMETA + " at the pack's root");
        }
        return parse(text, packId);
    }

    /** Parses the text of a whole {@code pack.mcmeta} and reads its block. */
    public static Result parse(String mcmetaText, String packId) {
        PackOrigin origin = origin(packId);
        String text = mcmetaText.startsWith("﻿") ? mcmetaText.substring(1) : mcmetaText;
        JsonElement root;
        try {
            root = JsonParser.parseString(text);
        } catch (JsonParseException e) {
            return Result.rejected(origin, List.of(), "not valid JSON: " + e.getMessage());
        }
        if (!root.isJsonObject()) {
            return Result.rejected(origin, List.of(), "must hold a JSON object");
        }
        return parse(root.getAsJsonObject(), packId);
    }

    /** Reads the block of a parsed {@code pack.mcmeta}. */
    public static Result parse(JsonObject mcmeta, String packId) {
        PackOrigin origin = origin(packId);
        List<PackProblem> problems = new ArrayList<>();
        if (!mcmeta.has(BLOCK)) {
            problems.add(origin.warning("no \"" + BLOCK + "\" block in " + MCMETA
                    + ", assuming format " + SUPPORTED_FORMAT));
            return new Result(new RwatPackMeta(SUPPORTED_FORMAT, null, null, List.of(), null, null), problems);
        }
        JsonElement element = mcmeta.get(BLOCK);
        if (!element.isJsonObject()) {
            return Result.rejected(origin, problems, "\"" + BLOCK + "\" must be an object, not " + quote(element));
        }
        JsonObject block = element.getAsJsonObject();

        int format;
        if (!block.has("format")) {
            problems.add(origin.warning("\"" + BLOCK + "\" has no \"format\", assuming format "
                    + SUPPORTED_FORMAT));
            format = SUPPORTED_FORMAT;
        } else {
            JsonElement value = block.get("format");
            BigDecimal number = number(value);
            if (number == null) {
                return Result.rejected(origin, problems, "\"" + BLOCK + ".format\" must be a number, not "
                        + quote(value));
            }
            if (number.stripTrailingZeros().scale() > 0 || number.compareTo(BigDecimal.ONE) < 0) {
                return Result.rejected(origin, problems, "\"" + BLOCK
                        + ".format\" must be a whole number of 1 or more, not " + quote(value));
            }
            if (number.compareTo(BigDecimal.valueOf(SUPPORTED_FORMAT)) > 0) {
                return Result.rejected(origin, problems, "pack format " + number.toPlainString()
                        + " is newer than this version of RWAT reads (up to " + SUPPORTED_FORMAT
                        + "): update the mod");
            }
            format = number.intValueExact();
        }

        for (Map.Entry<String, JsonElement> entry : block.entrySet()) {
            if (!KEYS.contains(entry.getKey())) {
                problems.add(origin.warning("unknown key \"" + BLOCK + "." + entry.getKey()
                        + "\" ignored; known keys: " + String.join(", ", KEYS)));
            }
        }
        return new Result(new RwatPackMeta(format,
                string(block, "name", origin, problems),
                string(block, "version", origin, problems),
                authors(block, origin, problems),
                string(block, "license", origin, problems),
                string(block, "description", origin, problems)), problems);
    }

    /** Where the problems of a pack's block are: its {@code pack.mcmeta}. */
    private static PackOrigin origin(String packId) {
        return new PackOrigin(packId, MCMETA);
    }

    /** The value as a number, or {@code null} when it is anything else (a string holding digits too). */
    private static BigDecimal number(JsonElement value) {
        if (!(value instanceof JsonPrimitive primitive) || !primitive.isNumber()) {
            return null;
        }
        try {
            return primitive.getAsBigDecimal();
        } catch (NumberFormatException e) { // NaN, Infinity: lenient JSON lets them through
            return null;
        }
    }

    /** An optional text field: absent or blank = {@code null}; not a string = a warning and {@code null}. */
    private static String string(JsonObject block, String key, PackOrigin origin, List<PackProblem> problems) {
        if (!block.has(key) || block.get(key).isJsonNull()) {
            return null;
        }
        JsonElement value = block.get(key);
        if (!(value instanceof JsonPrimitive primitive) || !primitive.isString()) {
            problems.add(origin.warning("\"" + BLOCK + "." + key + "\" must be a string, not "
                    + quote(value) + "; ignored"));
            return null;
        }
        String text = primitive.getAsString();
        return text.isBlank() ? null : text;
    }

    /**
     * The authors: a list of strings. A lone string is taken as the one author
     * (with a warning: the format says a list); non-strings in the list are
     * skipped with a warning.
     */
    private static List<String> authors(JsonObject block, PackOrigin origin, List<PackProblem> problems) {
        if (!block.has("authors") || block.get("authors").isJsonNull()) {
            return List.of();
        }
        JsonElement value = block.get("authors");
        if (value instanceof JsonPrimitive primitive && primitive.isString()) {
            problems.add(origin.warning("\"" + BLOCK + ".authors\" must be a list: [\"…\"]; "
                    + "taking the string as the one author"));
            return primitive.getAsString().isBlank() ? List.of() : List.of(primitive.getAsString());
        }
        if (!(value instanceof JsonArray array)) {
            problems.add(origin.warning("\"" + BLOCK + ".authors\" must be a list of strings, not "
                    + quote(value) + "; ignored"));
            return List.of();
        }
        List<String> authors = new ArrayList<>();
        for (JsonElement author : array) {
            if (author instanceof JsonPrimitive primitive && primitive.isString()) {
                if (!primitive.getAsString().isBlank()) {
                    authors.add(primitive.getAsString());
                }
            } else {
                problems.add(origin.warning("\"" + BLOCK + ".authors\" must hold strings only, not "
                        + quote(author) + "; skipped"));
            }
        }
        return authors;
    }

    /** A wrong value as the message quotes it: its JSON, cut short. */
    private static String quote(JsonElement value) {
        String json = value.toString();
        return json.length() <= QUOTE_LENGTH ? json : json.substring(0, QUOTE_LENGTH) + "…";
    }

    /** {@code pack.mcmeta} of a pack folder, or {@code null} when there's none. */
    private static String readFromFolder(Path folder) throws IOException {
        Path file = folder.resolve(MCMETA);
        return Files.isRegularFile(file) ? new String(Files.readAllBytes(file), StandardCharsets.UTF_8) : null;
    }

    /** {@code pack.mcmeta} of a zipped pack, or {@code null} when there's none. */
    private static String readFromZip(Path zipFile) throws IOException {
        try (ZipFile zip = new ZipFile(zipFile.toFile())) {
            ZipEntry entry = zip.getEntry(MCMETA);
            if (entry == null || entry.isDirectory()) {
                return null;
            }
            try (InputStream in = zip.getInputStream(entry)) {
                return new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
        }
    }
}
