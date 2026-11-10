package com.muzhik17.trainsmod.pack;

import java.io.IOError;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The {@code rwat.packDirs} system property read: extra folders packs are
 * searched in, {@code separator}-separated ({@link RwatPacks}). An entry
 * that is no path on this system — a NUL character, on Windows also the
 * characters a file name can't have — is left out and reported, and the
 * other entries still count: {@code Path.of} throws for it, and unguarded
 * that took the whole search for packs down with one bad entry.
 *
 * <p>Plain Java, no MC types: the split is separated from {@link RwatPacks}
 * so a test can run it.
 */
public final class PackDirs {

    /** The system property the list is read from; also the pack id its problems are reported under. */
    public static final String PROPERTY = "rwat.packDirs";

    /** At most this many characters of an entry go into a message. */
    private static final int SHOWN = 80;

    private PackDirs() {
    }

    /**
     * The folders a list names and what was wrong with the entries it left out.
     *
     * @param folders  absolute, normalised, in list order, each once
     * @param problems a warning per entry that is no path, in list order
     */
    public record Parsed(List<Path> folders, List<PackProblem> problems) {

        public Parsed {
            folders = List.copyOf(folders);
            problems = List.copyOf(problems);
        }
    }

    /**
     * Read a {@code separator}-separated list of folders. Blank entries
     * (a trailing separator, two in a row) are nothing, not a problem; a
     * relative entry is taken from the working directory.
     */
    public static Parsed parse(String list, String separator) {
        Set<Path> folders = new LinkedHashSet<>();
        List<PackProblem> problems = new ArrayList<>();
        for (String entry : list.split(Pattern.quote(separator))) {
            if (entry.isBlank()) {
                continue;
            }
            try {
                // strip, not trim: trim would take a stray NUL off the ends and make a path of it
                folders.add(Path.of(entry.strip()).toAbsolutePath().normalize());
            } catch (InvalidPathException e) {
                problems.add(problem(entry.strip(), e.getReason()));
            } catch (SecurityException | IOError e) {
                problems.add(problem(entry.strip(), e.toString()));
            }
        }
        return new Parsed(new ArrayList<>(folders), problems);
    }

    private static PackProblem problem(String entry, String reason) {
        return PackProblem.warning(PROPERTY, shown(entry),
                "not a usable path (" + reason + "): the entry is skipped, the other folders are still searched");
    }

    /** The entry as a message can carry it: control characters written out, a long one cut. */
    static String shown(String entry) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < entry.length(); i++) {
            if (out.length() >= SHOWN) {
                return out + "...";
            }
            char c = entry.charAt(i);
            out.append(c < ' ' || c == 0x7F ? String.format("\\u%04x", (int) c) : String.valueOf(c));
        }
        return out.toString();
    }
}
