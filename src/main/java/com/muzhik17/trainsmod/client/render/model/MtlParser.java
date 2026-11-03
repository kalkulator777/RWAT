package com.muzhik17.trainsmod.client.render.model;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Minimal Wavefront {@code .mtl} reader (SPEC §6.3): material name → its
 * diffuse map ({@code map_Kd}) path, as written — relative to the MTL's
 * folder, {@code ../} allowed (the IR packs share textures through
 * {@code ../../common/}). Colours, specular and the rest are ignored: the
 * stock renders flat-lit textures, vertex colour white.
 *
 * <p>A material's name is the whole rest of its line, spaces included
 * ({@link #materialName}), in the MTL's {@code newmtl} and in the OBJ's
 * {@code usemtl} alike ({@link ObjLoader}): that is how Blender reads and
 * writes them, and the two files must agree or the material finds no texture.
 *
 * <p>No MC imports — paths are plain strings, unit-tested; turning them into
 * resource locations is the loader's job.
 *
 * <p>Ported: {@code editor/src/ports/mtl.ts}, {@code tools/ir2rwat.py}
 * ({@code material_name}, {@code parse_mtl}); golden:
 * {@code fixtures/golden/mtl/}.
 */
public final class MtlParser {

    private MtlParser() {
    }

    /**
     * The material a {@code newmtl} or {@code usemtl} line names: everything
     * after the keyword and the whitespace behind it, trimmed, with the
     * spaces inside kept ({@code usemtl Dark Wood} is {@code Dark Wood}).
     * Blender, which writes the names of its materials as they are, reads
     * both keywords so (current importer: the rest of the line, trimmed),
     * and so does the converter's port of this rule ({@code ir2rwat.material_name}).
     * The first-word reading the OBJ loader once had made {@code Dark} of it,
     * while the MTL entry stayed {@code Dark Wood}: no texture. The old
     * Wavefront text says names hold no blanks; for those names every reading
     * is the same.
     *
     * @return the name, or null if the line isn't a {@code keyword} line or names nothing
     */
    public static String materialName(String line, String keyword) {
        String trimmed = line.trim();
        if (!trimmed.startsWith(keyword) || trimmed.length() == keyword.length()
                || !Character.isWhitespace(trimmed.charAt(keyword.length()))) {
            return null;
        }
        String name = trimmed.substring(keyword.length()).trim();
        return name.isEmpty() ? null : name;
    }

    /** Material → {@code map_Kd} path; materials without a diffuse map are absent. */
    public static Map<String, String> parse(InputStream in) throws IOException {
        Map<String, String> maps = new LinkedHashMap<>();
        BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        String material = null;
        String line;
        while ((line = reader.readLine()) != null) {
            line = line.trim();
            String named = materialName(line, "newmtl");
            if (named != null) {
                material = named;
            } else if (line.startsWith("map_Kd ") && material != null) {
                // options (-s, -o, …) aren't used by the assets; the path is the last token run
                maps.put(material, line.substring("map_Kd ".length()).trim());
            }
        }
        return maps;
    }

    /**
     * Join a relative path onto a folder and normalise it: backslashes become
     * slashes, {@code .} segments drop, {@code ..} pops a folder. Returns null
     * if the path climbs above the root (it would leave the namespace).
     *
     * @param folder   folder path without a trailing slash, may be empty
     * @param relative the path as written in the file
     */
    public static String resolve(String folder, String relative) {
        Deque<String> segments = new ArrayDeque<>();
        String joined = (folder.isEmpty() ? "" : folder + "/") + relative.replace('\\', '/');
        for (String segment : joined.split("/")) {
            if (segment.isEmpty() || segment.equals(".")) {
                continue;
            }
            if (segment.equals("..")) {
                if (segments.isEmpty()) {
                    return null;
                }
                segments.removeLast();
            } else {
                segments.addLast(segment);
            }
        }
        return String.join("/", segments);
    }

    /** The folder part of a path ({@code a/b/c.obj → a/b}), empty for a bare name. */
    public static String folderOf(String path) {
        int slash = path.lastIndexOf('/');
        return slash < 0 ? "" : path.substring(0, slash);
    }

    /** The file-name part of a path ({@code a/b/c.png → c.png}). */
    public static String fileNameOf(String path) {
        return path.substring(path.lastIndexOf('/') + 1);
    }
}
