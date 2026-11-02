package com.muzhik17.trainsmod.pack;

/**
 * Where a declaration came from: the pack and the file inside it
 * ({@code data/<ns>/wagon_types/<id>.json}, {@code assets/<ns>/wagon_models/<id>.json}).
 * The loaders attach it to what they report ({@link PackProblem}).
 *
 * @param pack the pack's id in the pack list ({@code rwat/<folder>} for an RWAT pack)
 * @param file the file's path inside the pack
 */
public record PackOrigin(String pack, String file) {

    /** The file of a resource {@code namespace:path} in {@code root} ({@code data} or {@code assets}). */
    public static String file(String root, String namespace, String path) {
        return root + "/" + namespace + "/" + path;
    }

    public PackProblem error(String message) {
        return new PackProblem(PackProblem.Severity.ERROR, pack, file, message);
    }

    public PackProblem warning(String message) {
        return new PackProblem(PackProblem.Severity.WARNING, pack, file, message);
    }
}
