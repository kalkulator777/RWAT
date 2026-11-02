package com.muzhik17.trainsmod.pack;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * A content hash of a whole RWAT pack, for the check of a client's packs
 * against the server's (roadmap R15): both sides hash their own copy and
 * compare. The whole pack counts, not only its data half — the client needs
 * the models, rail styles and sounds the server doesn't.
 *
 * <p>The hash is the same for a pack folder and the same pack zipped:
 * SHA-256 over the pack's files sorted by their path inside the pack
 * ({@code /}-separated, as in a zip; {@link String} order), each file adding
 * its path in UTF-8, a zero byte and the SHA-256 of its bytes. How the files
 * are stored (folder or zip, compression, timestamps, zip directory entries)
 * doesn't count, nor do the files an OS or a tool leaves next to the content
 * and the game never reads ({@link #ignored}).
 *
 * <p><b>Changing what goes into the hash changes it for every pack</b>: a
 * client and a server of different mod versions would then never agree. The
 * test pins the hash of a small pack.
 */
public final class PackHasher {

    private static final int BUFFER = 1 << 16;

    private PackHasher() {
    }

    /** One file of a pack: its path inside the pack and where to read it. */
    private record PackFile(String path, Path source, long size, long modified) {
    }

    /** Lowercase hex SHA-256 of a pack folder or zip (see the class comment). */
    public static String hash(Path pack) throws IOException {
        MessageDigest digest = sha256();
        byte[] buffer = new byte[BUFFER];
        if (Files.isDirectory(pack)) {
            for (PackFile file : folderFiles(pack)) {
                try (InputStream in = Files.newInputStream(file.source())) {
                    add(digest, file.path(), in, buffer);
                }
            }
        } else {
            try (ZipFile zip = new ZipFile(pack.toFile())) {
                List<ZipEntry> entries = new ArrayList<>();
                zip.stream().filter(entry -> !entry.isDirectory() && !ignored(entry.getName()))
                        .forEach(entries::add);
                entries.sort(Comparator.comparing(ZipEntry::getName));
                for (ZipEntry entry : entries) {
                    try (InputStream in = zip.getInputStream(entry)) {
                        add(digest, entry.getName(), in, buffer);
                    }
                }
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    /**
     * What changes when the pack's files may have: a zip's size and time of
     * change; for a folder, the path, size and time of change of every file
     * the hash reads. Equal fingerprints let a cached hash stand.
     */
    public static String fingerprint(Path pack) throws IOException {
        if (!Files.isDirectory(pack)) {
            BasicFileAttributes attributes = Files.readAttributes(pack, BasicFileAttributes.class);
            return "zip:" + attributes.size() + ":" + attributes.lastModifiedTime().toMillis();
        }
        MessageDigest digest = sha256();
        for (PackFile file : folderFiles(pack)) {
            digest.update(file.path().getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update((file.size() + ":" + file.modified()).getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
        }
        return "dir:" + HexFormat.of().formatHex(digest.digest());
    }

    /**
     * A file no pack content is in: anything under a folder or named with a
     * leading dot ({@code .git/}, {@code .DS_Store}, {@code .gitignore}),
     * macOS's {@code __MACOSX/} in zips, Windows' {@code Thumbs.db} and
     * {@code desktop.ini}. A pack zipped on a Mac or kept in git is still the
     * pack the other side has unzipped.
     */
    static boolean ignored(String path) {
        for (String part : path.split("/")) {
            if (part.startsWith(".") || part.equals("__MACOSX")) {
                return true;
            }
        }
        String name = path.substring(path.lastIndexOf('/') + 1).toLowerCase(Locale.ROOT);
        return name.equals("thumbs.db") || name.equals("desktop.ini");
    }

    private static void add(MessageDigest digest, String path, InputStream in, byte[] buffer) throws IOException {
        MessageDigest content = sha256();
        int read;
        while ((read = in.read(buffer)) > 0) {
            content.update(buffer, 0, read);
        }
        digest.update(path.getBytes(StandardCharsets.UTF_8));
        digest.update((byte) 0);
        digest.update(content.digest());
    }

    /** The files of a pack folder the hash reads, sorted by path. Links are not followed (the game refuses packs with them). */
    private static List<PackFile> folderFiles(Path root) throws IOException {
        List<PackFile> files = new ArrayList<>();
        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attributes) {
                return dir.equals(root) || !ignored(dir.getFileName().toString())
                        ? FileVisitResult.CONTINUE : FileVisitResult.SKIP_SUBTREE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attributes) {
                String path = packPath(root, file);
                if (attributes.isRegularFile() && !ignored(path)) {
                    files.add(new PackFile(path, file, attributes.size(), attributes.lastModifiedTime().toMillis()));
                }
                return FileVisitResult.CONTINUE;
            }
        });
        files.sort(Comparator.comparing(PackFile::path));
        return files;
    }

    /** A file's path inside the pack, {@code /}-separated whatever the OS. */
    private static String packPath(Path root, Path file) {
        StringBuilder path = new StringBuilder();
        for (Path part : root.relativize(file)) {
            if (!path.isEmpty()) {
                path.append('/');
            }
            path.append(part);
        }
        return path.toString();
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("every Java has SHA-256", e);
        }
    }
}
