package com.muzhik17.trainsmod.pack;

import java.util.Objects;

/**
 * One thing found wrong with an RWAT pack: a warning (the pack still loads)
 * or an error (it doesn't). The message is English, as the log is; it names
 * the key it is about the way the author wrote it ({@code "rwat.format"}).
 */
public record PackProblem(Severity severity, String message) {

    public enum Severity {
        WARNING,
        ERROR
    }

    public PackProblem {
        Objects.requireNonNull(severity, "severity");
        Objects.requireNonNull(message, "message");
    }

    public static PackProblem warning(String message) {
        return new PackProblem(Severity.WARNING, message);
    }

    public static PackProblem error(String message) {
        return new PackProblem(Severity.ERROR, message);
    }

    public boolean isError() {
        return severity == Severity.ERROR;
    }
}
