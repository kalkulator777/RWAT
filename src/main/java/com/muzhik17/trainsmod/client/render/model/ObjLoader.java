package com.muzhik17.trainsmod.client.render.model;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Minimal Wavefront {@code .obj} → {@link Mesh} loader (SPEC §2.4: the model
 * source is swappable behind {@link Mesh}). Reads {@code v}/{@code vt}/{@code vn}
 * and triangular/quad {@code f} faces, splitting by {@code o} object and
 * {@code usemtl} material into {@link Part}s, and records {@code mtllib}
 * references. The {@code .mtl} file itself is read by {@link MtlParser}.
 *
 * <p>Quad faces are kept as quads; triangles are stored as degenerate quads
 * (4th vertex = 3rd) since the render type draws quads; larger n-gons are
 * fanned into triangles. Only positive 1-based indices are
 * supported (what the dev assets use).
 */
public final class ObjLoader {

    /** One contiguous run of faces: which object it belongs to and its {@code usemtl}. */
    public record Part(String object, String material, Mesh mesh) {
    }

    /**
     * A whole file: its parts plus the {@code mtllib} references (paths
     * relative to the OBJ, as written) that map its materials to textures.
     */
    public record Model(List<Part> parts, List<String> materialLibraries) {
    }

    private ObjLoader() {
    }

    /**
     * Object-keyed view for material-less models ({@code rail.obj}): all of an
     * object's faces merged into one mesh, flat-coloured by object name.
     *
     * @param colorByObject object name → {r,g,b}; used as the flat colour of
     *                      every face of that object
     * @return per-object meshes, in file order
     */
    public static Map<String, Mesh> load(InputStream in, Function<String, float[]> colorByObject)
            throws IOException {
        Map<String, Mesh> objects = new LinkedHashMap<>();
        for (Part part : loadParts(in, name -> colorByObject.apply(name)).parts()) {
            objects.computeIfAbsent(part.object(), n -> new Mesh()).merge(part.mesh());
        }
        return objects;
    }

    /** Loads all parts with white vertex colour (textured models — the map carries the colour). */
    public static List<Part> loadParts(InputStream in) throws IOException {
        return loadModel(in).parts();
    }

    /** Loads a textured model: white-vertex-coloured parts plus its {@code mtllib} references. */
    public static Model loadModel(InputStream in) throws IOException {
        float[] white = {1.0F, 1.0F, 1.0F};
        return loadParts(in, name -> white);
    }

    private static Model loadParts(InputStream in, Function<String, float[]> colorByObject)
            throws IOException {
        List<float[]> positions = new ArrayList<>();
        List<float[]> uvs = new ArrayList<>();
        List<float[]> normals = new ArrayList<>();

        List<Part> parts = new ArrayList<>();
        List<String> materialLibraries = new ArrayList<>();
        String object = "default";
        String material = "";
        Mesh current = new Mesh();
        float[] color = colorByObject.apply(object);

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.charAt(0) == '#') {
                    continue;
                }
                String[] t = line.split("\\s+");
                switch (t[0]) {
                    case "v" -> positions.add(new float[]{
                            Float.parseFloat(t[1]), Float.parseFloat(t[2]), Float.parseFloat(t[3])});
                    case "vt" -> uvs.add(new float[]{
                            Float.parseFloat(t[1]), Float.parseFloat(t[2])});
                    case "vn" -> normals.add(new float[]{
                            Float.parseFloat(t[1]), Float.parseFloat(t[2]), Float.parseFloat(t[3])});
                    case "o", "g" -> {
                        if (!current.quads().isEmpty()) {
                            parts.add(new Part(object, material, current));
                            current = new Mesh();
                        }
                        object = t.length > 1 ? t[1] : "default";
                        color = colorByObject.apply(object);
                    }
                    case "usemtl" -> {
                        if (!current.quads().isEmpty()) {
                            parts.add(new Part(object, material, current));
                            current = new Mesh();
                        }
                        material = t.length > 1 ? t[1] : "";
                    }
                    case "f" -> face(t, positions, uvs, normals, current, color);
                    // the file name may contain spaces: take the rest of the line
                    case "mtllib" -> materialLibraries.add(line.substring("mtllib".length()).trim());
                    default -> { /* s, etc. — ignored */ }
                }
            }
        }
        if (!current.quads().isEmpty()) {
            parts.add(new Part(object, material, current));
        }
        return new Model(parts, materialLibraries);
    }

    /**
     * Append a face: a quad face as one quad, anything else fanned into
     * triangles (tri → degenerate quad). Quads must stay quads — the IR
     * models are ~85% quad faces, and fanning them as well doubled their
     * vertex count (8 per face instead of 4). A QUADS draw splits a quad into
     * (0,1,2)+(2,3,0), the very triangles the fan produced, so nothing on
     * screen changes.
     */
    private static void face(String[] t, List<float[]> positions, List<float[]> uvs,
            List<float[]> normals, Mesh mesh, float[] color) {
        int corners = t.length - 1;
        Mesh.Vertex[] v = new Mesh.Vertex[corners];
        for (int i = 0; i < corners; i++) {
            v[i] = vertex(t[i + 1], positions, uvs, normals);
        }
        if (corners == 4) {
            mesh.add(new Mesh.Quad(v[0], v[1], v[2], v[3],
                    color[0], color[1], color[2], 1.0F));
            return;
        }
        // fan: (0, i, i+1); a triangle is a single fan step → degenerate quad
        for (int i = 1; i < corners - 1; i++) {
            mesh.add(new Mesh.Quad(v[0], v[i], v[i + 1], v[i + 1],
                    color[0], color[1], color[2], 1.0F));
        }
    }

    private static Mesh.Vertex vertex(String token, List<float[]> positions,
            List<float[]> uvs, List<float[]> normals) {
        String[] idx = token.split("/");
        float[] p = positions.get(Integer.parseInt(idx[0]) - 1);
        float u = 0.0F;
        float vv = 0.0F;
        if (idx.length > 1 && !idx[1].isEmpty()) {
            float[] uv = uvs.get(Integer.parseInt(idx[1]) - 1);
            u = uv[0];
            vv = 1.0F - uv[1]; // OBJ's V origin is bottom-left; MC samples V from the top

        }
        float nx = 0.0F;
        float ny = 1.0F;
        float nz = 0.0F;
        if (idx.length > 2 && !idx[2].isEmpty()) {
            float[] n = normals.get(Integer.parseInt(idx[2]) - 1);
            nx = n[0];
            ny = n[1];
            nz = n[2];
        }
        return new Mesh.Vertex(p[0], p[1], p[2], u, vv, nx, ny, nz);
    }
}
