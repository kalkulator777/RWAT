package com.muzhik17.trainsmod.client.render.model;

import java.io.IOException;
import java.io.InputStream;
import java.io.Reader;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.render.RailRenderer;

import net.minecraft.resources.FileToIdConverter;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.server.packs.resources.SimplePreparableReloadListener;
import net.minecraft.util.GsonHelper;
import net.minecraft.util.profiling.ProfilerFiller;

/**
 * Reads the rail styles of all resource packs (SPEC §6.10): every
 * {@code assets/<ns>/rail_models/<name>.json} declares style
 * {@code <ns>:<name>}:
 *
 * <pre>{@code { "obj": "tracks/mvp_ir_rail.obj", "tile_length": 1.0 }}</pre>
 *
 * {@code obj} without a namespace is in the declaring pack's namespace;
 * {@code tile_length} (default 1) is how far apart the tile repeats: the rail
 * objects ({@code RAIL_LEFT}/{@code RAIL_RIGHT}) are stretched to fill each
 * tile end to end, everything else ({@code RAIL_BASE}: sleepers, ballast,
 * embankment) keeps its size, centred in the tile — so an embankment piece
 * longer than the rails can repeat at its own length without overlapping
 * itself. With the IR norm (rails 1 long, {@code tile_length} 1) nothing is
 * stretched. Textures
 * come from the OBJ's MTL ({@code map_Kd}, relative to the OBJ), like stock
 * models. Unlike stock, rail tiles are small (a few hundred KB for all of MVP)
 * and every segment needs one the moment it is seen, so they load here, off
 * thread with the rest of the reload, not lazily.
 *
 * <p>Applying swaps the registry and drops the rail renderer's caches, so
 * F3+T re-sweeps the network with the new tiles.
 */
public final class RailModelReloadListener
        extends SimplePreparableReloadListener<Map<String, RailStyle>> {

    private static final FileToIdConverter DECLARATIONS = FileToIdConverter.json("rail_models");

    @Override
    protected Map<String, RailStyle> prepare(ResourceManager resources, ProfilerFiller profiler) {
        IrStockModel.ResourceAccess access = new IrStockModel.ResourceAccess() {
            @Override
            public InputStream open(ResourceLocation location) throws IOException {
                return resources.open(location);
            }

            @Override
            public boolean exists(ResourceLocation location) {
                return resources.getResource(location).isPresent();
            }
        };
        Map<String, RailStyle> styles = new HashMap<>();
        for (Map.Entry<ResourceLocation, Resource> file
                : DECLARATIONS.listMatchingResources(resources).entrySet()) {
            ResourceLocation id = DECLARATIONS.fileToId(file.getKey());
            try (Reader reader = file.getValue().openAsReader()) {
                RailStyle style = load(id, GsonHelper.parse(reader), access);
                if (style != null) {
                    styles.put(id.toString(), style);
                }
            } catch (IOException | RuntimeException e) {
                RailsWheelsAndTrains.LOGGER.error("Skipping bad rail model {}: {}", id, e.getMessage());
            }
        }
        RailsWheelsAndTrains.LOGGER.info("{} rail style(s) declared by resource packs", styles.size());
        return styles;
    }

    @Override
    protected void apply(Map<String, RailStyle> styles, ResourceManager resources,
            ProfilerFiller profiler) {
        RailStyles.reset(styles);
        RailRenderer.clear();
    }

    /** One style from its declaration; null (logged) if the OBJ has nothing to draw. */
    private static RailStyle load(ResourceLocation id, JsonObject json, IrStockModel.ResourceAccess access)
            throws IOException {
        String objPath = GsonHelper.getAsString(json, "obj");
        ResourceLocation objLocation = ResourceLocation.tryParse(
                objPath.contains(":") ? objPath : id.getNamespace() + ":" + objPath);
        if (objLocation == null) {
            RailsWheelsAndTrains.LOGGER.error("{}: invalid rail model path {}", id, objPath);
            return null;
        }
        double tileLength = GsonHelper.getAsDouble(json, "tile_length", 1.0);
        if (!(tileLength > 0.0)) {
            RailsWheelsAndTrains.LOGGER.error("{}: tile_length must be positive", id);
            return null;
        }
        ObjLoader.Model obj;
        try (InputStream in = access.open(objLocation)) {
            obj = ObjLoader.loadModel(in);
        }
        Map<String, ResourceLocation> textures =
                IrStockModel.materialTextures(id.toString(), objLocation, obj, access);
        float[] railExtent = railExtent(obj);
        Map<ResourceLocation, Mesh> full = new LinkedHashMap<>();
        Map<ResourceLocation, Mesh> railsOnly = new LinkedHashMap<>();
        for (ObjLoader.Part part : obj.parts()) {
            ResourceLocation texture = textures.get(part.material());
            if (texture == null || part.object().contains("HIDE")) {
                continue;
            }
            Mesh mesh = isRail(part.object())
                    ? stretched(part.mesh(), railExtent, tileLength)
                    : part.mesh();
            full.computeIfAbsent(texture, t -> new Mesh()).merge(mesh);
            Mesh rails = railsOnly.computeIfAbsent(texture, t -> new Mesh());
            if (!part.object().toUpperCase(Locale.ROOT).contains("BASE")) {
                rails.merge(mesh);
            }
        }
        List<RailStyle.Part> parts = new ArrayList<>();
        for (Map.Entry<ResourceLocation, Mesh> entry : full.entrySet()) {
            parts.add(new RailStyle.Part(entry.getKey(), entry.getValue(), railsOnly.get(entry.getKey())));
        }
        if (parts.isEmpty()) {
            RailsWheelsAndTrains.LOGGER.error("{}: rail model {} has no textured faces", id, objLocation);
            return null;
        }
        return new RailStyle(id.toString(), List.copyOf(parts), tileLength);
    }

    /** A rail object: {@code RAIL_LEFT*}/{@code RAIL_RIGHT*} — not the {@code RAIL_BASE} sleepers. */
    private static boolean isRail(String object) {
        String name = object.toUpperCase(Locale.ROOT);
        return name.startsWith("RAIL_") && !name.contains("BASE");
    }

    /** Along-track (X) extent {min, max} of all rail objects; null if the model has none. */
    private static float[] railExtent(ObjLoader.Model obj) {
        float min = Float.POSITIVE_INFINITY;
        float max = Float.NEGATIVE_INFINITY;
        for (ObjLoader.Part part : obj.parts()) {
            if (!isRail(part.object())) {
                continue;
            }
            for (Mesh.Quad q : part.mesh().quads()) {
                for (Mesh.Vertex v : new Mesh.Vertex[] {q.v0(), q.v1(), q.v2(), q.v3()}) {
                    min = Math.min(min, v.x());
                    max = Math.max(max, v.x());
                }
            }
        }
        return max > min ? new float[] {min, max} : null;
    }

    /** Rail faces stretched along X so the rails span the tile {@code [-len/2, len/2]} exactly. */
    private static Mesh stretched(Mesh mesh, float[] extent, double tileLength) {
        if (extent == null || Math.abs((extent[1] - extent[0]) - tileLength) < 1.0e-4
                && Math.abs(extent[0] + tileLength / 2.0) < 1.0e-4) {
            return mesh; // already one tile long and centred (the IR norm)
        }
        float scale = (float) (tileLength / (extent[1] - extent[0]));
        float shift = (float) (-tileLength / 2.0);
        Mesh out = new Mesh();
        for (Mesh.Quad q : mesh.quads()) {
            out.add(new Mesh.Quad(stretch(q.v0(), extent[0], scale, shift),
                    stretch(q.v1(), extent[0], scale, shift),
                    stretch(q.v2(), extent[0], scale, shift),
                    stretch(q.v3(), extent[0], scale, shift),
                    q.r(), q.g(), q.b(), q.a()));
        }
        return out;
    }

    private static Mesh.Vertex stretch(Mesh.Vertex v, float min, float scale, float shift) {
        return new Mesh.Vertex((v.x() - min) * scale + shift, v.y(), v.z(), v.u(), v.v(),
                v.nx(), v.ny(), v.nz());
    }
}
