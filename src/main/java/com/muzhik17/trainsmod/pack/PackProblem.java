package com.muzhik17.trainsmod.pack;

import java.util.Objects;

/**
 * One thing wrong with a content pack: which pack, which file in it, how bad
 * and what. An {@link Severity#ERROR} means the file (or the part named) was
 * not loaded — for the {@code "rwat"} block of {@code pack.mcmeta}, the whole
 * pack; a {@link Severity#WARNING} that it loaded but the pack likely says
 * something it doesn't mean — an unknown key, a floor nobody can stand on, a
 * model with no type, a pack without a format number.
 *
 * <p>Plain data, no MC types: every loader of a pack's files, the pack scan
 * ({@link RwatPacks}, {@link RwatPackMeta}) and their tests share it, and the
 * {@link PackReport} keeps it for {@code /rwat packs}. A loader that knows the
 * file makes it through its {@link PackOrigin}.
 *
 * @param pack    the pack's id as the pack list knows it ({@code rwat/<folder>},
 *                {@code mod/<modid>}, …)
 * @param file    the file inside the pack, e.g. {@code data/mvp/wagon_types/chme3.json}
 *                or {@code pack.mcmeta}; for a problem with the pack as a whole,
 *                where it lies
 * @param message what is wrong, in English, naming the field the way the
 *                author wrote it
 */
public record PackProblem(Severity severity, String pack, String file, String message) {

    /** How bad a problem is. */
    public enum Severity {
        /** The file, or the part named, was not loaded. */
        ERROR,
        /** Loaded, but probably not as the author meant. */
        WARNING
    }

    public PackProblem {
        Objects.requireNonNull(severity, "severity");
        Objects.requireNonNull(pack, "pack");
        Objects.requireNonNull(file, "file");
        Objects.requireNonNull(message, "message");
    }

    public static PackProblem error(String pack, String file, String message) {
        return new PackProblem(Severity.ERROR, pack, file, message);
    }

    public static PackProblem warning(String pack, String file, String message) {
        return new PackProblem(Severity.WARNING, pack, file, message);
    }

    public boolean isError() {
        return severity == Severity.ERROR;
    }

    /** {@code error|warning pack file: message}, the form the log and the chat show. */
    @Override
    public String toString() {
        return (isError() ? "error " : "warning ") + pack + " " + file + ": " + message;
    }
}
