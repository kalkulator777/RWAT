package com.muzhik17.trainsmod.pack;

/**
 * One thing wrong with a content pack, as a loader found it: which pack,
 * which file in it, how bad and what. An {@link Severity#ERROR} means the
 * file (or the part named) was not loaded; a {@link Severity#WARNING} that
 * it loaded but the pack likely says something it doesn't mean — an unknown
 * key, a floor nobody can stand on, a model with no type.
 *
 * <p>Plain data, no MC types: the loaders and their tests share it, and the
 * {@link PackReport} keeps it for {@code /rwat packs}.
 *
 * @param pack    the pack's id as the pack list knows it ({@code rwat/<folder>},
 *                {@code mod/<modid>}, …)
 * @param file    the file inside the pack, e.g. {@code data/mvp/wagon_types/chme3.json}
 * @param message what is wrong, in English, naming the field
 */
public record PackProblem(Severity severity, String pack, String file, String message) {

    /** How bad a problem is. */
    public enum Severity {
        /** The file, or the part named, was not loaded. */
        ERROR,
        /** Loaded, but probably not as the author meant. */
        WARNING
    }

    public boolean error() {
        return severity == Severity.ERROR;
    }

    /** {@code pack file: message}, the form the log and the chat show. */
    @Override
    public String toString() {
        return (error() ? "error " : "warning ") + pack + " " + file + ": " + message;
    }
}
