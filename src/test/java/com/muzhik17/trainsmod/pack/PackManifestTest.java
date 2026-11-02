package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;

/** The check of a client's packs against the server's (roadmap R15). */
class PackManifestTest {

    private static final String A = "a".repeat(64);
    private static final String B = "b".repeat(64);
    private static final String C = "c".repeat(64);

    private static PackManifest.Entry entry(String id, String name, String hash) {
        return new PackManifest.Entry(id, name, "", hash);
    }

    @Test
    void samePacksMatch() {
        List<PackManifest.Entry> packs = List.of(entry("MVP", "Matoi Vanilla Pack", A), entry("Ex", "Example", B));

        assertEquals(List.of(), PackManifest.compare(packs, packs));
    }

    /** The hash decides: zipped here, unzipped there, renamed — the same files are the same pack. */
    @Test
    void sameHashMatchesWhateverTheName() {
        List<PackManifest.Entry> server = List.of(entry("MatoiVanillaPack", "Matoi Vanilla Pack", A));
        List<PackManifest.Entry> client = List.of(entry("mvp-copy.zip", "Something Else", A));

        assertEquals(List.of(), PackManifest.compare(server, client));
    }

    @Test
    void packTheClientLacksIsMissing() {
        PackManifest.Entry mvp = entry("MVP", "Matoi Vanilla Pack", A);

        List<PackManifest.Mismatch> mismatches = PackManifest.compare(List.of(mvp), List.of(entry("Ex", "Example", B)));

        assertEquals(1, mismatches.size());
        assertSame(mvp, mismatches.get(0).server());
        assertEquals(PackManifest.Kind.MISSING, mismatches.get(0).kind());
        assertNull(mismatches.get(0).local());
        assertTrue(mismatches.get(0).describe().contains("not installed"), mismatches.get(0).describe());
    }

    /** The client's pack of the same file name (zip or not) or the same name, with other files. */
    @Test
    void packOfTheSameNameWithOtherFilesIsDifferent() {
        PackManifest.Entry server = entry("MatoiVanillaPack", "Matoi Vanilla Pack", A);
        PackManifest.Entry byFile = entry("matoivanillapack.ZIP", "Renamed In Mcmeta", B);
        PackManifest.Entry byName = entry("mvp-old", "matoi vanilla pack", C);

        PackManifest.Mismatch fileMatch = PackManifest.compare(List.of(server), List.of(byName, byFile)).get(0);
        assertEquals(PackManifest.Kind.DIFFERENT, fileMatch.kind());
        assertSame(byFile, fileMatch.local(), "the file name is the closer match");

        PackManifest.Mismatch nameMatch = PackManifest.compare(List.of(server), List.of(byName)).get(0);
        assertEquals(PackManifest.Kind.DIFFERENT, nameMatch.kind());
        assertSame(byName, nameMatch.local());
        assertTrue(nameMatch.describe().contains(C), nameMatch.describe());
    }

    /** Packs only the client has do no harm; the mismatches come in the server's order. */
    @Test
    void extraClientPacksDontCountAndOrderIsTheServers() {
        List<PackManifest.Entry> server = List.of(entry("Z", "Zed", A), entry("Y", "Why", B));
        List<PackManifest.Entry> client = List.of(entry("Extra", "Extra", C));

        List<PackManifest.Mismatch> mismatches = PackManifest.compare(server, client);

        assertEquals(List.of("Z", "Y"), mismatches.stream().map(m -> m.server().id()).toList());
        assertEquals(List.of(), PackManifest.compare(List.of(), client));
    }

    @Test
    void labelHasTheVersionWhenGiven() {
        assertEquals("Example", entry("Ex", "Example", A).label());
        assertEquals("Example 1.2", new PackManifest.Entry("Ex", "Example", "1.2", A).label());
    }

    @Test
    void baseNameDropsZip() {
        assertEquals("Pack", PackManifest.baseName("Pack.zip"));
        assertEquals("Pack", PackManifest.baseName("Pack.ZIP"));
        assertEquals("Pack", PackManifest.baseName("Pack"));
        assertEquals("Pack.zip.d", PackManifest.baseName("Pack.zip.d"));
    }

    @Test
    void validHashIsLowercaseHexOfSixtyFour() {
        assertTrue(PackManifest.validHash(A));
        assertTrue(PackManifest.validHash("0123456789abcdef".repeat(4)));
        assertFalse(PackManifest.validHash("A".repeat(64)));
        assertFalse(PackManifest.validHash("g".repeat(64)));
        assertFalse(PackManifest.validHash("a".repeat(63)));
        assertFalse(PackManifest.validHash(""));
    }

    /** What the payload carries is cut to its limits, never inside a surrogate pair; the hash is left as is. */
    @Test
    void clippedEntryKeepsToTheLimits() {
        PackManifest.Entry long_ = new PackManifest.Entry("i".repeat(500), "n".repeat(500), "v".repeat(500), A);

        PackManifest.Entry clipped = long_.clipped();

        assertEquals(PackManifest.MAX_ID_LENGTH, clipped.id().length());
        assertEquals(PackManifest.MAX_NAME_LENGTH, clipped.name().length());
        assertEquals(PackManifest.MAX_VERSION_LENGTH, clipped.version().length());
        assertEquals(A, clipped.hash());

        String emoji = "x".repeat(PackManifest.MAX_NAME_LENGTH - 1) + "🚂"; // a train past the limit
        String cut = PackManifest.clip(emoji, PackManifest.MAX_NAME_LENGTH);
        assertEquals(PackManifest.MAX_NAME_LENGTH - 1, cut.length());
        assertFalse(Character.isHighSurrogate(cut.charAt(cut.length() - 1)));
        assertEquals("short", PackManifest.clip("short", 10));
    }

    /** A pack's entry: the block's name and version, else the file name without .zip and no version. */
    @Test
    void packInfoMakesTheEntry() {
        RwatPackMeta meta = new RwatPackMeta(1, "Example", "2.0", List.of(), null, null);
        PackInfo named = new PackInfo("example.zip", Path.of("example.zip"), meta, List.of(), true);
        PackInfo bare = new PackInfo("bare.zip", Path.of("bare.zip"),
                new RwatPackMeta(1, null, null, List.of(), null, null), List.of(), true);

        assertEquals(new PackManifest.Entry("example.zip", "Example", "2.0", A), named.manifestEntry(A));
        assertEquals(new PackManifest.Entry("bare.zip", "bare", "", B), bare.manifestEntry(B));
        assertEquals("rwat/example.zip", named.id());
    }

    /** What /rwat packs lists of a pack: the block's name and version if it gives any, its problems counted. */
    @Test
    void packInfoForTheListing() {
        PackProblem warning = PackProblem.warning("rwat/a", "pack.mcmeta", "w");
        PackProblem error = PackProblem.error("rwat/b", "pack.mcmeta", "e");
        PackInfo named = new PackInfo("a", Path.of("a"),
                new RwatPackMeta(1, "Example", "2.0", List.of(), null, null), List.of(warning), true);
        PackInfo versionOnly = new PackInfo("v.zip", Path.of("v.zip"),
                new RwatPackMeta(1, null, "3", List.of(), null, null), List.of(), true);
        PackInfo bare = new PackInfo("c", Path.of("c"),
                new RwatPackMeta(1, null, null, List.of(), null, null), List.of(), true);
        PackInfo refused = new PackInfo("b", Path.of("b"), null, List.of(warning, error), false);

        assertEquals("Example 2.0", named.label());
        assertEquals("v 3", versionOnly.label());
        assertNull(bare.label());
        assertNull(refused.label());
        assertEquals(0, named.errors());
        assertEquals(1, named.warnings());
        assertEquals(1, refused.errors());
        assertEquals(1, refused.warnings());
        assertEquals(List.of(warning, warning, error), PackInfo.problems(List.of(named, bare, refused)));
        assertEquals("rwat/b", PackInfo.idOf("b"));
    }

    @Test
    void shortHashIsItsFirstEightChars() {
        assertEquals("01234567", PackManifest.shortHash("0123456789abcdef".repeat(4)));
        assertEquals("abc", PackManifest.shortHash("abc"));
    }
}
