package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The {@code "rwat"} block of {@code pack.mcmeta}, format v1 (roadmap R5, phase 1 item 4). */
class RwatPackMetaTest {

    private static final String PACK = "\"pack\": { \"pack_format\": 34, \"description\": \"x\" }";

    private static RwatPackMeta.Result parse(String rwat) {
        return RwatPackMeta.parse("{ " + PACK + ", \"rwat\": " + rwat + " }");
    }

    private static PackProblem only(RwatPackMeta.Result result) {
        assertEquals(1, result.problems().size(), result.problems().toString());
        return result.problems().get(0);
    }

    /** Every field of v1, as the schema describes it: no problem at all. */
    @Test
    void readsTheFullBlock() {
        RwatPackMeta.Result result = parse("""
                { "format": 1, "name": "Example Pack", "version": "1.2.0",
                  "authors": ["Ann", "Bob"], "license": "CC0-1.0", "description": "Two cars" }""");

        assertTrue(result.accepted());
        assertEquals(List.of(), result.problems());
        assertEquals(new RwatPackMeta(1, "Example Pack", "1.2.0", List.of("Ann", "Bob"), "CC0-1.0", "Two cars"),
                result.meta());
    }

    /** Only the format is needed; the rest stays unset. */
    @Test
    void readsAFormatOnlyBlock() {
        RwatPackMeta.Result result = parse("{ \"format\": 1 }");

        assertTrue(result.accepted());
        assertEquals(List.of(), result.problems());
        assertEquals(new RwatPackMeta(1, null, null, List.of(), null, null), result.meta());
    }

    /** A pack from before the block: loaded as format 1, with a warning. */
    @Test
    void noBlockIsFormatOneWithAWarning() {
        RwatPackMeta.Result result = RwatPackMeta.parse("{ " + PACK + " }");

        assertTrue(result.accepted());
        assertEquals(1, result.meta().format());
        PackProblem problem = only(result);
        assertFalse(problem.isError());
        assertTrue(problem.message().contains("assuming format 1"), problem.message());
    }

    @Test
    void blockWithoutFormatIsFormatOneWithAWarning() {
        RwatPackMeta.Result result = parse("{ \"name\": \"Old Pack\" }");

        assertTrue(result.accepted());
        assertEquals(1, result.meta().format());
        assertEquals("Old Pack", result.meta().name());
        PackProblem problem = only(result);
        assertFalse(problem.isError());
        assertTrue(problem.message().contains("assuming format 1"), problem.message());
    }

    /** A pack made for a newer RWAT is not loaded: this one can't know what its keys mean. */
    @Test
    void newerFormatIsRefused() {
        RwatPackMeta.Result result = parse("{ \"format\": 2, \"name\": \"Future Pack\" }");

        assertFalse(result.accepted());
        assertNull(result.meta());
        PackProblem problem = only(result);
        assertTrue(problem.isError());
        assertTrue(problem.message().contains("format 2"), problem.message());
        assertTrue(problem.message().contains("up to " + RwatPackMeta.SUPPORTED_FORMAT), problem.message());
    }

    /** A number past any int is still "newer", not a crash. */
    @Test
    void hugeFormatIsRefusedAsNewer() {
        RwatPackMeta.Result result = parse("{ \"format\": 1e30 }");

        assertFalse(result.accepted());
        assertTrue(only(result).message().contains("newer"), only(result).message());
    }

    /** Not a number — a string of digits included — is an error, and the pack is not loaded. */
    @Test
    void formatThatIsNotANumberIsRefused() {
        for (String format : List.of("\"1\"", "true", "null", "[1]", "{ \"v\": 1 }")) {
            RwatPackMeta.Result result = parse("{ \"format\": " + format + " }");

            assertFalse(result.accepted(), format);
            PackProblem problem = only(result);
            assertTrue(problem.isError(), format);
            assertTrue(problem.message().contains("must be a number"), problem.message());
        }
    }

    @Test
    void formatThatIsNotAWholePositiveNumberIsRefused() {
        for (String format : List.of("1.5", "0", "-1")) {
            RwatPackMeta.Result result = parse("{ \"format\": " + format + " }");

            assertFalse(result.accepted(), format);
            assertTrue(only(result).message().contains("whole number of 1 or more"), only(result).message());
        }
    }

    /** {@code 1.0} is the number one. */
    @Test
    void formatOnePointZeroIsOne() {
        RwatPackMeta.Result result = parse("{ \"format\": 1.0 }");

        assertTrue(result.accepted());
        assertEquals(1, result.meta().format());
    }

    @Test
    void blockThatIsNotAnObjectIsRefused() {
        for (String block : List.of("1", "\"mvp\"", "null", "[]")) {
            RwatPackMeta.Result result = parse(block);

            assertFalse(result.accepted(), block);
            assertTrue(only(result).message().contains("must be an object"), only(result).message());
        }
    }

    /** Descriptive fields of the wrong type are warnings: the pack loads, the value is dropped. */
    @Test
    void wrongTypedFieldsAreIgnoredWithWarnings() {
        RwatPackMeta.Result result = parse("""
                { "format": 1, "name": 5, "version": 1.2, "license": ["MIT"], "description": {},
                  "authors": { "main": "Ann" } }""");

        assertTrue(result.accepted());
        assertEquals(new RwatPackMeta(1, null, null, List.of(), null, null), result.meta());
        assertEquals(5, result.problems().size(), result.problems().toString());
        assertTrue(result.problems().stream().noneMatch(PackProblem::isError));
        assertTrue(result.problems().get(0).message().contains("\"rwat.name\" must be a string"),
                result.problems().get(0).message());
    }

    /** A lone author written as a string is taken, with a warning; non-strings in the list are skipped. */
    @Test
    void authorsAreReadLeniently() {
        RwatPackMeta.Result lone = parse("{ \"format\": 1, \"authors\": \"Ann\" }");
        assertEquals(List.of("Ann"), lone.meta().authors());
        assertFalse(only(lone).isError());

        RwatPackMeta.Result mixed = parse("{ \"format\": 1, \"authors\": [\"Ann\", 7, \" \", \"Bob\"] }");
        assertEquals(List.of("Ann", "Bob"), mixed.meta().authors());
        assertTrue(only(mixed).message().contains("strings only"), only(mixed).message());
    }

    /** Blank and null text is the same as not given, and no problem. */
    @Test
    void blankFieldsAreUnset() {
        RwatPackMeta.Result result = parse("{ \"format\": 1, \"name\": \"  \", \"version\": null, \"authors\": null }");

        assertEquals(List.of(), result.problems());
        assertEquals(new RwatPackMeta(1, null, null, List.of(), null, null), result.meta());
    }

    /** A key format v1 doesn't have is a warning naming the known ones (a typo shows). */
    @Test
    void unknownKeysAreWarnings() {
        RwatPackMeta.Result result = parse("{ \"format\": 1, \"autors\": [\"Ann\"] }");

        assertTrue(result.accepted());
        PackProblem problem = only(result);
        assertFalse(problem.isError());
        assertTrue(problem.message().contains("\"rwat.autors\""), problem.message());
        assertTrue(problem.message().contains("authors"), problem.message());
    }

    /** The block the converter writes today (before format v1): loaded, with warnings only. */
    @Test
    void readsTheConvertersOldBlock() {
        RwatPackMeta.Result result = parse("""
                { "name": "Matoi Vanilla Pack", "namespace": "mvp",
                  "converted_from": ["MVP-IR-1.8-mc1.12.2-by-FrozeRain.zip"],
                  "license": "CC BY-NC-ND 4.0" }""");

        assertTrue(result.accepted());
        assertEquals("Matoi Vanilla Pack", result.meta().name());
        assertEquals("CC BY-NC-ND 4.0", result.meta().license());
        assertEquals(3, result.problems().size(), result.problems().toString());
        assertTrue(result.problems().stream().noneMatch(PackProblem::isError));
    }

    @Test
    void brokenMcmetaIsRefused() {
        assertFalse(RwatPackMeta.parse("{ \"pack\": ").accepted());
        assertFalse(RwatPackMeta.parse("[]").accepted());
        assertFalse(RwatPackMeta.parse("").accepted());
    }

    /** A UTF-8 byte order mark before the JSON doesn't matter. */
    @Test
    void byteOrderMarkIsSkipped() {
        RwatPackMeta.Result result = RwatPackMeta.parse("﻿{ " + PACK + ", \"rwat\": { \"format\": 1 } }");

        assertTrue(result.accepted());
        assertEquals(List.of(), result.problems());
    }

    /** The same pack.mcmeta reads the same from a folder and a zip; a pack without one is refused. */
    @Test
    void readsFromAFolderAndAZip(@TempDir Path temp) throws IOException {
        String mcmeta = "{ " + PACK + ", \"rwat\": { \"format\": 1, \"name\": \"Zipped\", \"version\": \"3\" } }";
        Path folder = Files.createDirectories(temp.resolve("Pack"));
        Files.writeString(folder.resolve("pack.mcmeta"), mcmeta);
        Path zip = temp.resolve("Pack.zip");
        try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(zip))) {
            out.putNextEntry(new ZipEntry("pack.mcmeta"));
            out.write(mcmeta.getBytes(StandardCharsets.UTF_8));
            out.closeEntry();
        }

        RwatPackMeta.Result fromFolder = RwatPackMeta.read(folder);
        RwatPackMeta.Result fromZip = RwatPackMeta.read(zip);
        assertTrue(fromFolder.accepted());
        assertEquals("Zipped", fromFolder.meta().name());
        assertEquals(fromFolder, fromZip);

        Path empty = Files.createDirectories(temp.resolve("Empty"));
        assertFalse(RwatPackMeta.read(empty).accepted());
        Path emptyZip = temp.resolve("Empty.zip");
        try (OutputStream out = new ZipOutputStream(Files.newOutputStream(emptyZip))) {
            out.flush();
        }
        assertFalse(RwatPackMeta.read(emptyZip).accepted());
        assertFalse(RwatPackMeta.read(temp.resolve("absent.zip")).accepted());
    }

    /** The generated MVP pack, when present: loaded as format 1. */
    @Test
    void readsTheGeneratedMvpPack() {
        Path mvp = Path.of("run/rwat_packs/MatoiVanillaPack");
        assumeTrue(Files.isDirectory(mvp), "the generated MVP pack is not here");

        RwatPackMeta.Result result = RwatPackMeta.read(mvp);
        assertTrue(result.accepted(), result.problems().toString());
        assertEquals(1, result.meta().format());
        assertEquals("Matoi Vanilla Pack", result.meta().name());
    }
}
