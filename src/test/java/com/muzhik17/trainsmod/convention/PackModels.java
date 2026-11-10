package com.muzhik17.trainsmod.convention;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import com.google.gson.JsonParser;
import com.muzhik17.trainsmod.client.render.model.IrAnim;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.MtlParser;
import com.muzhik17.trainsmod.client.render.model.ObjLoader;
import com.muzhik17.trainsmod.client.render.model.WagonModelDecl;

/**
 * The wagon models of a pack folder, read from disk the way the model loader
 * ({@code IrStockModel}, which needs Minecraft) reads them from the resource
 * manager: the OBJ, which of its materials have a texture, the objects the
 * declared {@code .anim}s move — the input of {@link ModelParts}. For tests.
 */
final class PackModels {

    /** A resource path Minecraft takes ({@code ResourceLocation}): lower case, digits, {@code /._-}. */
    private static final Pattern PATH = Pattern.compile("[a-z0-9/._-]+");

    /** One declared model: its type id, its OBJ, its textured materials, its declaration and animated objects. */
    record Model(String id, ObjLoader.Model obj, Set<String> textured, WagonModelDecl decl,
            Map<String, String> animated) {

        /** The OBJ's parts as the loader hands them to {@link ModelParts}. */
        List<ModelParts.Part> parts() {
            return PackModels.parts(obj, textured);
        }

        ModelParts.Declaration declaration() {
            return new ModelParts.Declaration(decl.bogies(), decl.skip(), animated, decl.handbrake());
        }
    }

    private PackModels() {
    }

    /** Every {@code assets/<ns>/wagon_models/<id>.json} of the pack, by id. */
    static List<Model> of(Path pack) throws IOException {
        List<Model> models = new ArrayList<>();
        Path assets = pack.resolve("assets");
        try (Stream<Path> namespaces = Files.list(assets)) {
            for (Path namespace : namespaces.filter(Files::isDirectory).sorted().toList()) {
                Path folder = namespace.resolve("wagon_models");
                if (!Files.isDirectory(folder)) {
                    continue;
                }
                try (Stream<Path> files = Files.list(folder)) {
                    for (Path file : files.filter(f -> f.toString().endsWith(".json")).sorted().toList()) {
                        String name = file.getFileName().toString();
                        String ns = namespace.getFileName().toString();
                        WagonModelDecl decl = WagonModelDecl.parse(ns, JsonParser.parseString(
                                Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject());
                        models.add(model(assets, ns + ":" + name.substring(0, name.length() - 5), decl));
                    }
                }
            }
        }
        return models;
    }

    private static Model model(Path assets, String id, WagonModelDecl decl) throws IOException {
        Path objFile = file(assets, decl.obj());
        ObjLoader.Model obj;
        try (InputStream in = Files.newInputStream(objFile)) {
            obj = ObjLoader.loadModel(in);
        }
        String ns = decl.obj().substring(0, decl.obj().indexOf(':'));
        String folder = MtlParser.folderOf(decl.obj().substring(decl.obj().indexOf(':') + 1));
        Set<String> textured = new LinkedHashSet<>();
        for (String library : obj.materialLibraries()) {
            String mtl = MtlParser.resolve(folder, library);
            if (mtl == null || !PATH.matcher(mtl).matches() || !Files.isRegularFile(file(assets, ns + ":" + mtl))) {
                continue;
            }
            try (InputStream in = Files.newInputStream(file(assets, ns + ":" + mtl))) {
                MtlParser.parse(in).forEach((material, map) -> {
                    String texture = MtlParser.resolve(folder, map);
                    if (texture != null && PATH.matcher(texture).matches()) {
                        textured.add(material);
                    }
                });
            }
        }
        Map<String, String> animated = new LinkedHashMap<>();
        for (Map.Entry<String, String> animation : decl.animations().entrySet()) {
            Path anim = file(assets, animation.getValue());
            if (!Files.isRegularFile(anim)) {
                continue;
            }
            try (InputStream in = Files.newInputStream(anim)) {
                IrAnim.parse(in).forEach((object, frames) -> {
                    if (!frames.isEmpty()) {
                        animated.put(object, animation.getKey());
                    }
                });
            } catch (IOException | RuntimeException e) {
                // a broken animation moves nothing, as in the loader
            }
        }
        return new Model(id, obj, textured, decl, animated);
    }

    /** A resource {@code ns:path} of the pack's assets. */
    private static Path file(Path assets, String location) {
        int colon = location.indexOf(':');
        return assets.resolve(location.substring(0, colon)).resolve(location.substring(colon + 1));
    }

    /** The OBJ's parts as the loader hands them to {@link ModelParts}. */
    static List<ModelParts.Part> parts(ObjLoader.Model obj, Set<String> textured) {
        List<ModelParts.Part> parts = new ArrayList<>(obj.parts().size());
        for (ObjLoader.Part part : obj.parts()) {
            parts.add(new ModelParts.Part(part.object(), part.material(), textured.contains(part.material()),
                    corners(part.mesh())));
        }
        return parts;
    }

    /** The corners of a mesh's quads, {@code x, y, z} each, in order (as {@code IrStockModel.corners}). */
    static float[] corners(Mesh mesh) {
        float[] corners = new float[mesh.quads().size() * 12];
        int n = 0;
        for (Mesh.Quad q : mesh.quads()) {
            for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                corners[n++] = v.x();
                corners[n++] = v.y();
                corners[n++] = v.z();
            }
        }
        return corners;
    }
}
