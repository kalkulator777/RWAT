package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Pack hashes are kept until the pack's files change (by size and time of change). */
class PackHashCacheTest {

    @Test
    void unchangedPackIsNotReadAgain(@TempDir Path temp) throws IOException {
        Path pack = Files.createDirectories(temp.resolve("p"));
        Files.writeString(pack.resolve("pack.mcmeta"), "{}");
        Files.createDirectories(pack.resolve("assets/t"));
        Path asset = Files.writeString(pack.resolve("assets/t/a.txt"), "hi");
        Files.setLastModifiedTime(asset, FileTime.fromMillis(1_000_000L));
        PackHashCache cache = new PackHashCache();

        String first = cache.hash(pack);
        assertEquals(first, cache.hash(pack));
        assertEquals(first, cache.hash(temp.resolve("p/../p")));
        assertEquals(1, cache.computed());

        Files.writeString(asset, "ho");
        Files.setLastModifiedTime(asset, FileTime.fromMillis(2_000_000L));
        String changed = cache.hash(pack);
        assertNotEquals(first, changed);
        assertEquals(PackHasher.hash(pack), changed);
        assertEquals(2, cache.computed());
    }
}
