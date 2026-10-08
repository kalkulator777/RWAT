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
 * <p>No MC imports — paths are plain strings, unit-tested; turning them into
 * resource locations is the loader's job.
 */
public final class MtlParser {

    private MtlParser() {
    }

    /** Material → {@code map_Kd} path; materials without a diffuse map are absent. */
    public static Map<String, String> parse(InputStream in) throws IOException {
        Map<String, String> maps = new LinkedHashMap<>();
        BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        String material = null;
        String line;
        while ((line = reader.readLine()) != null) {
            line = line.trim();
            if (line.startsWith("newmtl ")) {
                material = line.substring("newmtl ".length()).trim();
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
