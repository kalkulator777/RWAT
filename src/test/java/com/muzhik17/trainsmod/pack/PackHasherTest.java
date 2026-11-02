package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The content hash of a pack (roadmap R15): a folder and its zip agree, every byte and name counts. */
class PackHasherTest {

    private static final String MCMETA = "{\"pack\":{\"pack_format\":34,\"description\":\"t\"},\"rwat\":{\"format\":1}}";

    /** A small pack: the pack.mcmeta, an asset, a data file. */
    private static Map<String, String> pack() {
        Map<String, String> files = new LinkedHashMap<>();
        files.put("pack.mcmeta", MCMETA);
        files.put("assets/t/a.txt", "hi");
        files.put("data/t/wagon_types/x.json", "{}");
        return files;
    }

    private static Path folder(Path at, Map<String, String> files) throws IOException {
        Files.createDirectories(at);
        for (Map.Entry<String, String> file : files.entrySet()) {
            Path path = at.resolve(file.getKey());
            Files.createDirectories(path.getParent());
            Files.writeString(path, file.getValue());
        }
        return at;
    }

    /** A zip of the files in the given order, with folder entries before their files if asked. */
    private static Path zip(Path at, Map<String, String> files, boolean folderEntries, int level) throws IOException {
        try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(at))) {
            out.setLevel(level);
            List<String> written = new ArrayList<>();
            for (Map.Entry<String, String> file : files.entrySet()) {
                if (folderEntries) {
                    String name = file.getKey();
                    for (int slash = name.indexOf('/'); slash >= 0; slash = name.indexOf('/', slash + 1)) {
                        String dir = name.substring(0, slash + 1);
                        if (!written.contains(dir)) {
                            written.add(dir);
                            out.putNextEntry(new ZipEntry(dir));
                            out.closeEntry();
                        }
                    }
                }
                ZipEntry entry = new ZipEntry(file.getKey());
                entry.setTime(1_000_000L * written.size());
                out.putNextEntry(entry);
                out.write(file.getValue().getBytes(StandardCharsets.UTF_8));
                out.closeEntry();
            }
        }
        return at;
    }

    /**
     * The algorithm pinned: SHA-256 over the files sorted by path, each its
     * UTF-8 path, a zero byte and the SHA-256 of its bytes. The value is
     * worked out apart from this code (Python's hashlib); a change here means
     * clients and servers of different mod versions stop agreeing.
     */
    @Test
    void hashOfASmallPackIsPinned(@TempDir Path temp) throws IOException {
        assertEquals("22276db502fd248656adb01b14ed6216ed1de041afe1d1821b6b17120ade328c",
                PackHasher.hash(folder(temp.resolve("p"), pack())));
    }

    /** Unzipped on one side, zipped on the other — however the zip was made — is the same pack. */
    @Test
    void folderAndZipHashTheSame(@TempDir Path temp) throws IOException {
        String expected = PackHasher.hash(folder(temp.resolve("p"), pack()));

        Map<String, String> reversed = new LinkedHashMap<>();
        List<String> keys = new ArrayList<>(pack().keySet());
        Collections.reverse(keys);
        keys.forEach(key -> reversed.put(key, pack().get(key)));

        assertEquals(expected, PackHasher.hash(zip(temp.resolve("a.zip"), pack(), false, 9)));
        assertEquals(expected, PackHasher.hash(zip(temp.resolve("b.zip"), reversed, true, 0)));
        assertEquals(expected, PackHasher.hash(zip(temp.resolve("c.zip"), pack(), true, 1)));
    }

    @Test
    void hashIsDeterministic(@TempDir Path temp) throws IOException {
        Path folder = folder(temp.resolve("p"), pack());
        assertEquals(PackHasher.hash(folder), PackHasher.hash(folder));
        Path zip = zip(temp.resolve("p.zip"), pack(), false, 6);
        assertEquals(PackHasher.hash(zip), PackHasher.hash(zip));
    }

    /** One byte, a renamed file, an added empty file, bytes moved between files: each another pack. */
    @Test
    void anyContentChangeChangesTheHash(@TempDir Path temp) throws IOException {
        String base = PackHasher.hash(folder(temp.resolve("base"), pack()));

        Map<String, String> oneByte = pack();
        oneByte.put("assets/t/a.txt", "ho");
        Map<String, String> renamed = pack();
        renamed.put("assets/t/b.txt", renamed.remove("assets/t/a.txt"));
        Map<String, String> added = pack();
        added.put("assets/t/empty.txt", "");
        Map<String, String> split = pack();
        split.put("assets/t/a.txt", "h");
        split.put("assets/t/b.txt", "i");
        Map<String, String> joined = pack();
        joined.put("assets/t/a.txt", "hi");
        joined.put("assets/t/b.txt", "");

        List<String> hashes = new ArrayList<>(List.of(base));
        int n = 0;
        for (Map<String, String> files : List.of(oneByte, renamed, added, split, joined)) {
            hashes.add(PackHasher.hash(folder(temp.resolve("v" + n++), files)));
        }
        assertEquals(hashes.size(), hashes.stream().distinct().count(), hashes.toString());
    }

    /** What an OS or git leaves in a pack is not content: the pack is the same without it. */
    @Test
    void osAndToolLeftoversDontCount(@TempDir Path temp) throws IOException {
        String clean = PackHasher.hash(folder(temp.resolve("clean"), pack()));

        Map<String, String> littered = pack();
        littered.put(".DS_Store", "finder");
        littered.put("assets/t/.DS_Store", "finder");
        littered.put(".git/HEAD", "ref: refs/heads/main");
        littered.put("__MACOSX/assets/t/._a.txt", "resource fork");
        littered.put("assets/t/Thumbs.db", "thumbs");
        littered.put("desktop.ini", "[.ShellClassInfo]");

        assertEquals(clean, PackHasher.hash(folder(temp.resolve("littered"), littered)));
        assertEquals(clean, PackHasher.hash(zip(temp.resolve("littered.zip"), littered, true, 6)));
    }

    @Test
    void ignoredPaths() {
        assertTrue(PackHasher.ignored(".git/config"));
        assertTrue(PackHasher.ignored("assets/.DS_Store"));
        assertTrue(PackHasher.ignored("__MACOSX/pack.mcmeta"));
        assertTrue(PackHasher.ignored("assets/x/THUMBS.DB"));
        assertFalse(PackHasher.ignored("pack.mcmeta"));
        assertFalse(PackHasher.ignored("assets/mvp/textures/a.b.png"));
        assertFalse(PackHasher.ignored("assets/mvp/sounds/thumbs.ogg"));
    }

    /** The fingerprint follows a file's size and time of change, in a folder and of a zip. */
    @Test
    void fingerprintFollowsSizeAndTime(@TempDir Path temp) throws IOException {
        Path folder = folder(temp.resolve("p"), pack());
        Path asset = folder.resolve("assets/t/a.txt");
        Files.setLastModifiedTime(asset, FileTime.fromMillis(1_000_000L));
        String before = PackHasher.fingerprint(folder);
        assertEquals(before, PackHasher.fingerprint(folder));

        Files.setLastModifiedTime(asset, FileTime.fromMillis(2_000_000L));
        String touched = PackHasher.fingerprint(folder);
        assertNotEquals(before, touched);

        Files.writeString(asset, "hello");
        Files.setLastModifiedTime(asset, FileTime.fromMillis(2_000_000L));
        assertNotEquals(touched, PackHasher.fingerprint(folder));

        Path zip = zip(temp.resolve("p.zip"), pack(), false, 6);
        Files.setLastModifiedTime(zip, FileTime.fromMillis(1_000_000L));
        String zipBefore = PackHasher.fingerprint(zip);
        Files.setLastModifiedTime(zip, FileTime.fromMillis(3_000_000L));
        assertNotEquals(zipBefore, PackHasher.fingerprint(zip));
    }
}
