package com.muzhik17.trainsmod.pack;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.muzhik17.trainsmod.client.render.model.IrAnim;
import com.muzhik17.trainsmod.client.render.model.MtlParser;
import com.muzhik17.trainsmod.client.render.model.ObjLoader;
import com.muzhik17.trainsmod.client.render.model.WagonModelDecl;
import com.muzhik17.trainsmod.convention.GroupName;
import com.muzhik17.trainsmod.convention.ModelParts;
import com.muzhik17.trainsmod.convention.ObjectRole;

/**
 * The files a wagon model declaration names, checked all at once (the
 * offline validator of the pack review, {@code /rwatc packs validate}): the
 * game loads models lazily, the first time a type is on screen, so a broken
 * OBJ otherwise shows only when that wagon first comes into view.
 *
 * <p>Read by the same readers the game draws with ({@link ObjLoader},
 * {@link MtlParser}, {@link IrAnim}). Errors: the OBJ path is invalid or the
 * file missing, a face index points at no vertex, the model has no faces or
 * none that draws (no textured material), a material library, texture or
 * animation is missing or unreadable. Warnings: drawn faces whose material
 * has no texture ({@code map_Kd}) — they aren't drawn — a livery that
 * replaces no texture, and a control group named longer than {@link
 * GroupName#MAX_LENGTH} characters, which the model loader drops. A hinge marker ({@code <KEY>_ROT…} of a control or a
 * door leaf) is no such face: the model loader reads its axis with or
 * without a texture, and IR's packs leave it untextured, drawn by nothing.
 * A material is known by its whole name, spaces included, in the OBJ's
 * {@code usemtl} and the MTL's {@code newmtl} alike ({@link MtlParser#materialName}).
 *
 * <p>Plain Java over {@link Files}, so tests run it over a pack on disk; the
 * client hands it the resource manager. Client-side only (the readers live
 * with the renderer).
 */
public final class ModelCheck {

    private ModelCheck() {
    }

    /** Where the files are read from: locations are {@code ns:path} strings. */
    public interface Files {
        /** True if {@code location} is a valid resource location at all. */
        boolean valid(String location);

        boolean exists(String location);

        InputStream open(String location) throws IOException;
    }

    /** Every problem of the files {@code decl} names, reported against {@code origin} (its declaration). */
    public static List<PackProblem> check(WagonModelDecl decl, PackOrigin origin, Files files) {
        List<PackProblem> problems = new ArrayList<>();
        String obj = decl.obj();
        if (!files.valid(obj)) {
            problems.add(origin.error("model path '" + obj + "' is not a valid resource location"));
            return problems;
        }
        if (!files.exists(obj)) {
            problems.add(origin.error("model file " + obj + " not found"));
            return problems;
        }
        ObjLoader.Model model;
        try (InputStream in = files.open(obj)) {
            model = ObjLoader.loadModel(in);
        } catch (IndexOutOfBoundsException e) {
            problems.add(origin.error("model " + obj + ": a face refers to a vertex, texture coordinate or"
                    + " normal that isn't there (" + e.getMessage() + "); indices count from 1, negative ones"
                    + " aren't supported"));
            return problems;
        } catch (IOException | RuntimeException e) {
            problems.add(origin.error("model " + obj + " can't be read: " + e));
            return problems;
        }
        if (model.parts().isEmpty()) {
            problems.add(origin.error("model " + obj + " has no faces"));
            return problems;
        }
        Map<String, String> textures = textures(obj, model, files, origin, problems);
        checkDrawn(decl, obj, model, textures, origin, problems);
        checkGroups(obj, model, origin, problems);
        checkAnimations(decl, files, origin, problems);
        checkLiveries(decl, obj, textures, files, origin, problems);
        return problems;
    }

    /** Material → texture location, every library and texture checked on the way. */
    private static Map<String, String> textures(String obj, ObjLoader.Model model, Files files,
            PackOrigin origin, List<PackProblem> problems) {
        String namespace = namespace(obj);
        String folder = MtlParser.folderOf(path(obj));
        Map<String, String> textures = new LinkedHashMap<>();
        for (String library : model.materialLibraries()) {
            String mtl = relative(namespace, folder, library);
            if (mtl == null || !files.valid(mtl)) {
                problems.add(origin.error("model " + obj + ": material library path '" + library + "' is invalid"));
                continue;
            }
            if (!files.exists(mtl)) {
                problems.add(origin.error("model " + obj + ": material library " + mtl + " not found"));
                continue;
            }
            Map<String, String> maps;
            try (InputStream in = files.open(mtl)) {
                maps = MtlParser.parse(in);
            } catch (IOException | RuntimeException e) {
                problems.add(origin.error("model " + obj + ": material library " + mtl + " can't be read: " + e));
                continue;
            }
            maps.forEach((material, map) -> {
                String texture = relative(namespace, folder, map);
                if (texture == null || !files.valid(texture)) {
                    problems.add(origin.error("model " + obj + ": material " + material
                            + " has an invalid texture path '" + map + "'"));
                    return;
                }
                if (!files.exists(texture)) {
                    problems.add(origin.error("model " + obj + ": texture " + texture + " of material "
                            + material + " not found"));
                }
                textures.putIfAbsent(material, texture);
            });
        }
        return textures;
    }

    /** Something must draw; faces left untextured are named, but for hinge markers. */
    private static void checkDrawn(WagonModelDecl decl, String obj, ObjLoader.Model model,
            Map<String, String> textures, PackOrigin origin, List<PackProblem> problems) {
        boolean anyDrawn = false;
        List<String> skip = new ArrayList<>(ModelParts.DEFAULT_SKIP_PREFIXES);
        skip.addAll(decl.skip());
        Set<String> untextured = new LinkedHashSet<>();
        for (ObjLoader.Part part : model.parts()) {
            if (hidden(skip, part.object())) {
                continue;
            }
            if (textures.containsKey(part.material())) {
                anyDrawn = true;
            } else if (!hingeMarker(part.object())) {
                untextured.add(part.material().isEmpty() ? "(none)" : part.material());
            }
        }
        if (!anyDrawn) {
            problems.add(origin.error("model " + obj + " draws nothing: no face has a textured material"));
        } else if (!untextured.isEmpty()) {
            problems.add(origin.warning("model " + obj + ": faces with no texture (map_Kd) aren't drawn,"
                    + " material(s) " + String.join(", ", untextured)));
        }
    }

    /**
     * A control group named longer than the wire takes ({@link GroupName}):
     * the model loader drops it — its switches can't be worked, its lights
     * stay as an unswitched group leaves them. Each name once, in the order
     * the objects come.
     */
    private static void checkGroups(String obj, ObjLoader.Model model, PackOrigin origin,
            List<PackProblem> problems) {
        Set<String> names = new LinkedHashSet<>();
        for (ObjLoader.Part part : model.parts()) {
            names.addAll(GroupName.tooLong(ObjectRole.parse(part.object())));
        }
        for (String name : names) {
            problems.add(origin.warning("model " + obj + ": control group '" + name + "' is longer than "
                    + GroupName.MAX_LENGTH + " characters and is dropped: its switches can't be worked,"
                    + " its lights stay off (an LINVERT one on)"));
        }
    }

    private static void checkAnimations(WagonModelDecl decl, Files files, PackOrigin origin,
            List<PackProblem> problems) {
        decl.animations().forEach((group, anim) -> {
            if (!files.valid(anim)) {
                problems.add(origin.error("animation '" + group + "': path '" + anim
                        + "' is not a valid resource location"));
            } else if (!files.exists(anim)) {
                problems.add(origin.error("animation '" + group + "': file " + anim + " not found"));
            } else {
                try (InputStream in = files.open(anim)) {
                    IrAnim.parse(in);
                } catch (IOException | RuntimeException e) {
                    problems.add(origin.error("animation '" + group + "': " + anim + " can't be read: " + e));
                }
            }
        });
    }

    /** A livery should swap at least one texture: one with the same file name in its folder. */
    private static void checkLiveries(WagonModelDecl decl, String obj, Map<String, String> textures,
            Files files, PackOrigin origin, List<PackProblem> problems) {
        String namespace = namespace(obj);
        String folder = MtlParser.folderOf(path(obj));
        decl.liveries().forEach((livery, liveryFolder) -> {
            boolean swaps = false;
            for (String base : new LinkedHashSet<>(textures.values())) {
                String swap = relative(namespace, folder, liveryFolder + "/" + MtlParser.fileNameOf(path(base)));
                if (swap != null && files.valid(swap) && files.exists(swap)) {
                    swaps = true;
                    break;
                }
            }
            if (!swaps) {
                problems.add(origin.warning("livery '" + livery + "' replaces no texture (folder "
                        + liveryFolder + " next to the model)"));
            }
        });
    }

    /**
     * True if the object is the hinge marker of a control or a door leaf
     * ({@code <KEY>_ROT…}, as {@link ObjectRole} reads it): untextured, it
     * still gives the hinge (the model loader counts a pivot marker without a
     * texture), so drawing nothing is what it is for.
     */
    private static boolean hingeMarker(String object) {
        ObjectRole leaf = ObjectRole.door(object);
        return ObjectRole.parse(object).pivot() || leaf != null && leaf.pivot();
    }

    /** Never drawn, by the model loader's own rule ({@link ModelParts#dropped}): {@code HIDE} (widgets and coupler heads aside), {@code CARGO_FILL} and the declaration's {@code skip}. */
    private static boolean hidden(List<String> skip, String object) {
        return ModelParts.dropped(object, skip) != null;
    }

    /** {@code relative} resolved against {@code folder} of {@code namespace}; null if it climbs out. */
    private static String relative(String namespace, String folder, String relative) {
        String resolved = MtlParser.resolve(folder, relative);
        return resolved == null ? null : namespace + ":" + resolved;
    }

    private static String namespace(String location) {
        int colon = location.indexOf(':');
        return colon < 0 ? "minecraft" : location.substring(0, colon);
    }

    private static String path(String location) {
        return location.substring(location.indexOf(':') + 1);
    }
}
