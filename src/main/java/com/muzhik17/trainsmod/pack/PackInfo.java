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
 * @param meta     its {@code "rwat"} block; {@code null} when the block kept the
 *                 pack out (an error in {@code problems} says why)
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

    /** The pack in a manifest, with the given content hash. */
    public PackManifest.Entry manifestEntry(String hash) {
        return new PackManifest.Entry(fileName, displayName(), version(), hash).clipped();
    }
}
