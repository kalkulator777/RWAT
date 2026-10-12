package com.muzhik17.trainsmod.client.render.model;

import java.io.IOException;
import java.io.InputStream;
import java.io.Reader;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.render.RailRenderer;
import com.muzhik17.trainsmod.path.SwitchThroat;
import com.muzhik17.trainsmod.path.TileFootprint;

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
 * <p>The tile is also kept split for switch throats (SPEC §2.2 v1): the rail
 * objects by side, everything else apart — a leg bends one of its rails into
 * a blade and nothing else. Only a style whose rail objects are its running
 * rails gets blades ({@link SwitchThroat#gaugeFace}).
 *
 * <p>Applying swaps the registry and drops the rail renderer's caches, so
 * F3+T re-sweeps the network with the new tiles. The object rules (hidden
 * objects, which ones are rails, the stretch) are {@link TileFootprint}'s —
 * the server reads the same OBJ by them for the track bed.
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
        float[] stretch = TileFootprint.railStretch(railExtent(obj), tileLength);
        Map<ResourceLocation, Mesh> full = new LinkedHashMap<>();
        Map<ResourceLocation, Mesh> base = new LinkedHashMap<>();
        Map<ResourceLocation, Mesh> plusRails = new LinkedHashMap<>();
        Map<ResourceLocation, Mesh> minusRails = new LinkedHashMap<>();
        Mesh plusAll = new Mesh();
        Mesh minusAll = new Mesh();
        for (ObjLoader.Part part : obj.parts()) {
            ResourceLocation texture = textures.get(part.material());
            if (texture == null || TileFootprint.isHiddenObject(part.object())) {
                continue;
            }
            boolean rail = TileFootprint.isRailObject(part.object());
            Mesh mesh = stretch != null && rail ? stretched(part.mesh(), stretch) : part.mesh();
            full.computeIfAbsent(texture, t -> new Mesh()).merge(mesh);
            Mesh plus = plusRails.computeIfAbsent(texture, t -> new Mesh());
            Mesh minus = minusRails.computeIfAbsent(texture, t -> new Mesh());
            Mesh rest = base.computeIfAbsent(texture, t -> new Mesh());
            if (!rail) {
                rest.merge(mesh);
                continue;
            }
            // a rail object's faces by side (centroid z): one side of a leg is
            // bent into a switch blade, the other stays put (SPEC §2.2 v1)
            for (Mesh.Quad q : mesh.quads()) {
                boolean plusSide = q.v0().z() + q.v1().z() + q.v2().z() + q.v3().z() >= 0.0F;
                (plusSide ? plus : minus).add(q);
                (plusSide ? plusAll : minusAll).add(q);
            }
        }
        List<RailStyle.Part> parts = new ArrayList<>();
        for (Map.Entry<ResourceLocation, Mesh> entry : full.entrySet()) {
            ResourceLocation texture = entry.getKey();
            parts.add(new RailStyle.Part(texture, entry.getValue(), base.get(texture),
                    plusRails.get(texture), minusRails.get(texture)));
        }
        if (parts.isEmpty()) {
            RailsWheelsAndTrains.LOGGER.error("{}: rail model {} has no textured faces", id, objLocation);
            return null;
        }
        RailStyle.Blades blades = blades(plusAll, minusAll);
        if (blades == null) {
            RailsWheelsAndTrains.LOGGER.info("{}: its rail objects are no running rails, "
                    + "switches in it are drawn without blades", id);
        }
        return new RailStyle(id.toString(), List.copyOf(parts), tileLength, blades);
    }

    /**
     * The style's switch blade profile from its rail faces on either side, or
     * null unless both sides are running rails ({@link SwitchThroat#gaugeFace}).
     */
    private static RailStyle.Blades blades(Mesh plus, Mesh minus) {
        double plusFace = gaugeFace(plus);
        double minusFace = gaugeFace(minus);
        return Double.isNaN(plusFace) || Double.isNaN(minusFace) ? null : new RailStyle.Blades(plusFace, minusFace);
    }

    private static double gaugeFace(Mesh rails) {
        int count = rails.quads().size() * 4;
        float[] across = new float[count];
        float[] height = new float[count];
        int i = 0;
        for (Mesh.Quad q : rails.quads()) {
            for (Mesh.Vertex v : new Mesh.Vertex[] {q.v0(), q.v1(), q.v2(), q.v3()}) {
                across[i] = v.z();
                height[i++] = v.y();
            }
        }
        return SwitchThroat.gaugeFace(across, height);
    }

    /** Along-track (X) extent {min, max} of all rail objects; null if the model has none. */
    private static float[] railExtent(ObjLoader.Model obj) {
        float min = Float.POSITIVE_INFINITY;
        float max = Float.NEGATIVE_INFINITY;
        for (ObjLoader.Part part : obj.parts()) {
            if (!TileFootprint.isRailObject(part.object())) {
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

    /**
     * Rail faces stretched along X so the rails span the tile {@code [-len/2, len/2]}
     * exactly ({@link TileFootprint#railStretch}).
     */
    private static Mesh stretched(Mesh mesh, float[] stretch) {
        Mesh out = new Mesh();
        for (Mesh.Quad q : mesh.quads()) {
            out.add(new Mesh.Quad(stretched(q.v0(), stretch), stretched(q.v1(), stretch),
                    stretched(q.v2(), stretch), stretched(q.v3(), stretch),
                    q.r(), q.g(), q.b(), q.a()));
        }
        return out;
    }

    private static Mesh.Vertex stretched(Mesh.Vertex v, float[] stretch) {
        return new Mesh.Vertex(TileFootprint.stretchX(v.x(), stretch), v.y(), v.z(), v.u(), v.v(),
                v.nx(), v.ny(), v.nz());
    }
}
