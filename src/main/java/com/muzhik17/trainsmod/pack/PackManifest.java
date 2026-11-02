package com.muzhik17.trainsmod.pack;

import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * The check of a client's RWAT packs against the server's (roadmap R15). The
 * server tells a joining player its packs — file name, name, version, content
 * hash ({@link PackHasher}) — and the client looks for each among its own: a
 * pack the client lacks or holds different files of means wagons without
 * models, other rail styles, missing sounds. The client is warned, not kicked;
 * a pack only the client has does no harm and is not reported.
 *
 * <p>Packs are matched by hash first, so the same pack zipped on one side and
 * unzipped on the other, or renamed, is the same pack. A server pack no
 * client pack has the hash of is reported as {@link Kind#DIFFERENT} when the
 * client has a pack of the same file name (without {@code .zip}) or the same
 * name, else as {@link Kind#MISSING}.
 *
 * <p>Pure Java: the limits the network payload keeps to live here and are
 * unit-tested with the comparison.
 */
public final class PackManifest {

    /** At most this many packs go in one manifest; the server sends the first ones. */
    public static final int MAX_PACKS = 256;
    /** Longest pack file name sent, in chars. */
    public static final int MAX_ID_LENGTH = 128;
    /** Longest pack name sent, in chars. */
    public static final int MAX_NAME_LENGTH = 128;
    /** Longest pack version sent, in chars. */
    public static final int MAX_VERSION_LENGTH = 64;
    /** A hash is lowercase hex SHA-256: always this many chars. */
    public static final int HASH_LENGTH = 64;

    private PackManifest() {
    }

    /**
     * One pack: {@code id} — its file or folder name in {@code rwat_packs};
     * {@code name} — {@code rwat.name}, else the file name; {@code version} —
     * {@code rwat.version}, {@code ""} if not given; {@code hash} — the content
     * hash.
     */
    public record Entry(String id, String name, String version, String hash) {

        public Entry {
            Objects.requireNonNull(id, "id");
            Objects.requireNonNull(name, "name");
            Objects.requireNonNull(version, "version");
            Objects.requireNonNull(hash, "hash");
        }

        /** The entry cut to the lengths the payload carries. */
        public Entry clipped() {
            return new Entry(clip(id, MAX_ID_LENGTH), clip(name, MAX_NAME_LENGTH),
                    clip(version, MAX_VERSION_LENGTH), hash);
        }

        /** How a person reads it: the name, and the version if there is one. */
        public String label() {
            return version.isEmpty() ? name : name + " " + version;
        }
    }

    public enum Kind {
        /** The client has no pack like it. */
        MISSING,
        /** The client has a pack of that file name or name, with other files. */
        DIFFERENT
    }

    /**
     * A server pack the client doesn't have as the server does; {@code local}
     * is the client's pack taken for it ({@link Kind#DIFFERENT}), {@code null}
     * for {@link Kind#MISSING}.
     */
    public record Mismatch(Entry server, Kind kind, Entry local) {

        /** One line for the log. */
        public String describe() {
            String theirs = "'" + server.label() + "' (" + server.id() + ", hash " + server.hash() + ")";
            return kind == Kind.MISSING
                    ? "server pack " + theirs + " is not installed here"
                    : "server pack " + theirs + " differs from the one here: '" + local.label()
                            + "' (" + local.id() + ", hash " + local.hash() + ")";
        }
    }

    /** The server's packs the client doesn't have as the server does, in the server's order. */
    public static List<Mismatch> compare(List<Entry> server, List<Entry> client) {
        List<Mismatch> mismatches = new ArrayList<>();
        for (Entry theirs : server) {
            if (client.stream().anyMatch(mine -> mine.hash().equalsIgnoreCase(theirs.hash()))) {
                continue;
            }
            Entry local = client.stream()
                    .filter(mine -> baseName(mine.id()).equalsIgnoreCase(baseName(theirs.id())))
                    .findFirst()
                    .or(() -> client.stream()
                            .filter(mine -> !theirs.name().isEmpty() && mine.name().equalsIgnoreCase(theirs.name()))
                            .findFirst())
                    .orElse(null);
            mismatches.add(new Mismatch(theirs, local == null ? Kind.MISSING : Kind.DIFFERENT, local));
        }
        return mismatches;
    }

    /** A pack's file name without {@code .zip}: a folder and its zip are one pack by name. */
    public static String baseName(String fileName) {
        return fileName.toLowerCase(Locale.ROOT).endsWith(".zip")
                ? fileName.substring(0, fileName.length() - ".zip".length()) : fileName;
    }

    /** Lowercase hex of {@link #HASH_LENGTH} chars, as {@link PackHasher} writes. */
    public static boolean validHash(String hash) {
        if (hash.length() != HASH_LENGTH) {
            return false;
        }
        for (int i = 0; i < hash.length(); i++) {
            char c = hash.charAt(i);
            if (!HexFormat.isHexDigit(c) || Character.isUpperCase(c)) {
                return false;
            }
        }
        return true;
    }

    /** The text cut to at most {@code max} chars, never between the two halves of a surrogate pair. */
    static String clip(String text, int max) {
        if (text.length() <= max) {
            return text;
        }
        int end = Character.isHighSurrogate(text.charAt(max - 1)) ? max - 1 : max;
        return text.substring(0, end);
    }
}
