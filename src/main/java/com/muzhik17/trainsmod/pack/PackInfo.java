package com.muzhik17.trainsmod.pack;

import java.nio.file.Path;
import java.util.List;
import java.util.Objects;

/**
 * What a scan of the pack folders found about one RWAT pack
 * ({@code RwatPacks.infos()}): for {@code /rwat packs} and the client check.
 *
 * @param fileName its folder or zip name in the pack folder
 * @param path     where it lies
 * @param meta     its {@code "rwat"} block as read ({@link RwatPackMeta.Result#meta}),
 *                 also when the block's {@code format} keeps the pack out, so the
 *                 list still names it; a {@code pack.mcmeta} without the block
 *                 reads as format 1 with nothing else given. {@code null} only
 *                 when there is no block to read: no readable {@code pack.mcmeta},
 *                 an {@code "rwat"} that is no object, or a pack of the same name
 *                 found first (an error in {@code problems} says which)
 * @param problems what was found wrong, warnings and errors, in order
 * @param loaded   the game loads it: no error, and Minecraft read it as a pack
 */
public record PackInfo(String fileName, Path path, RwatPackMeta meta, List<PackProblem> problems,
        boolean loaded) {

    public PackInfo {
        Objects.requireNonNull(fileName, "fileName");
        Objects.requireNonNull(path, "path");
        problems = List.copyOf(problems);
    }

    /** Its id among the game's packs. */
    public String id() {
        return idOf(fileName);
    }

    /** The id among the game's packs of the RWAT pack of that folder or zip name. */
    public static String idOf(String fileName) {
        return "rwat/" + fileName;
    }

    /** {@code rwat.name}, else the file name without {@code .zip}. */
    public String displayName() {
        return meta != null && meta.name() != null ? meta.name() : PackManifest.baseName(fileName);
    }

    /** {@code rwat.version}, {@code ""} if not given. */
    public String version() {
        return meta != null && meta.version() != null ? meta.version() : "";
    }

    public boolean hasErrors() {
        return problems.stream().anyMatch(PackProblem::isError);
    }

    /** How many of its problems are errors. */
    public int errors() {
        return (int) problems.stream().filter(PackProblem::isError).count();
    }

    /** How many of its problems are warnings. */
    public int warnings() {
        return problems.size() - errors();
    }

    /** {@code rwat.name} and {@code version} as a person reads them; {@code null} if the block gives neither. */
    public String label() {
        if (meta == null || meta.name() == null && meta.version() == null) {
            return null;
        }
        return version().isEmpty() ? displayName() : displayName() + " " + version();
    }

    /** Every problem of a scan, pack by pack in the scan's order: what the scan puts in the pack report. */
    public static List<PackProblem> problems(List<PackInfo> scan) {
        return scan.stream().flatMap(info -> info.problems().stream()).toList();
    }

    /** The pack in a manifest, with the given content hash. */
    public PackManifest.Entry manifestEntry(String hash) {
        return new PackManifest.Entry(fileName, displayName(), version(), hash).clipped();
    }
}
