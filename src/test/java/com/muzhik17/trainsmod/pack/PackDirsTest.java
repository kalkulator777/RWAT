package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;

/** The {@code rwat.packDirs} list: one entry that is no path leaves the others standing. */
class PackDirsTest {

    private static Path abs(String path) {
        return Path.of(path).toAbsolutePath().normalize();
    }

    @Test
    void entriesAreFoldersInListOrderEachOnce() {
        PackDirs.Parsed parsed = PackDirs.parse("/a/packs;/b/./packs/ ; /a/packs;;", ";");
        assertEquals(List.of(abs("/a/packs"), abs("/b/packs")), parsed.folders());
        assertEquals(List.of(), parsed.problems(), "blank entries and repeats are nothing to report");
        assertEquals(List.of(), PackDirs.parse("", ";").folders());
        assertEquals(List.of(), PackDirs.parse("  ", ";").folders());
    }

    @Test
    void theSeparatorIsTheOneGiven_noRegexInIt() {
        assertEquals(List.of(abs("/a"), abs("/b")), PackDirs.parse("/a:/b", ":").folders());
        assertEquals(List.of(abs("/a"), abs("/b")), PackDirs.parse("/a|/b", "|").folders());
        assertEquals(List.of(abs("/a:b")), PackDirs.parse("/a:b", ";").folders());
    }

    @Test
    void aRelativeEntryIsTakenFromTheWorkingDirectory() {
        assertEquals(List.of(abs("run/rwat_packs")), PackDirs.parse("run/rwat_packs", ";").folders());
    }

    /**
     * A NUL character is no path on any system. {@code Path.of} threw
     * InvalidPathException for it, out of the pack search, and no pack was found.
     */
    @Test
    void anEntryThatIsNoPathIsSkippedWithAWarningAndTheRestStand() {
        PackDirs.Parsed parsed = PackDirs.parse("/a/packs;/b\0bad/packs;/c/packs", ";");
        assertEquals(List.of(abs("/a/packs"), abs("/c/packs")), parsed.folders());
        assertEquals(1, parsed.problems().size());
        PackProblem problem = parsed.problems().get(0);
        assertFalse(problem.isError(), "the other folders are searched: a warning, not an error");
        assertEquals("rwat.packDirs", problem.pack());
        assertEquals("/b\\u0000bad/packs", problem.file(), "the entry, its control character written out");
        assertTrue(problem.message().contains("not a usable path"), problem.message());
        assertTrue(problem.message().contains("skipped"), problem.message());
        assertFalse(problem.toString().contains("\0"));
    }

    @Test
    void everyEntryThatIsNoPathIsReportedInListOrder() {
        PackDirs.Parsed parsed = PackDirs.parse("\0one;/ok;two\0", ";");
        assertEquals(List.of(abs("/ok")), parsed.folders());
        assertEquals(List.of("\\u0000one", "two\\u0000"), parsed.problems().stream().map(PackProblem::file).toList());
    }

    @Test
    void aLongEntryIsCutInTheMessage() {
        String file = PackDirs.parse("x".repeat(500) + "\0", ";").problems().get(0).file();
        assertTrue(file.endsWith("..."), file);
        assertTrue(file.length() < 100, file);
    }
}
