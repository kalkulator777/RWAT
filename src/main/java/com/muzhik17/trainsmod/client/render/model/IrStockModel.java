package com.muzhik17.trainsmod.client.render.model;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.joml.Matrix4f;
import org.joml.Vector3f;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.convention.GroupName;
import com.muzhik17.trainsmod.convention.ModelParts;
import com.muzhik17.trainsmod.stock.ObjFrame;

import net.minecraft.resources.ResourceLocation;

/**
 * Loader for rolling-stock assets in the Immersive Railroading OBJ convention
 * (SPEC §5.2): one OBJ per stock type, ~100 named objects, real scale
 * 1&nbsp;unit = 1&nbsp;block, travel axis X with the <b>front towards −X</b>.
 * Quads are bucketed per material texture so the renderer can emit each bucket
 * with its own render type; vertex colour stays white — the maps carry the
 * colour. Each asset is described by a {@link WagonModelDecl}; the declarations
 * live in content packs (SPEC §6.3) and everything is read through
 * the resource manager, so OBJ, MTL, textures and animations may come from
 * any pack.
 *
 * <p>What each part of the OBJ is — dropped, body, interior, a bogie frame or
 * wheelset, an animated door's piece, a door leaf moved by name, a cab
 * control, a coupler head, and how it is lit — is decided by
 * {@link ModelParts}, the IR object-name convention without Minecraft; this
 * loader reads the files, hands it the parts and builds the meshes by its
 * answer: {@code BOGEY_FRONT*}/{@code BOGEY_REAR*} frames re-centred on their
 * pivots so the renderer can articulate them, wheelsets re-centred on their
 * axles so they can spin, the {@code INTERIOR*} shell as the
 * {@link StockModel#interior} the renderer drops at a distance, controls and
 * leaves (SPEC §9.3, §9.5) and coupler heads (SPEC §6.12) split out to move,
 * pieces of the doors the declaration's {@code animations} move with their
 * {@code .anim} frames ({@link IrAnim}), every quad tagged with its light
 * ({@link StockModel#tag}).
 *
 * <p>Render model space is +Z forward (see {@link WagonModel}), so vertices
 * and normals are rotated +90° about Y at load, the OBJ frame into the model
 * frame of {@link ObjFrame}: {@code (x,y,z) → (z,y,−x)}.
 * (The first articulation play-test caught the sign: assuming +X front swapped
 * the bogie pivots, so each bogie orbited the other one's point.) Y is lifted
 * so the wheel <b>tread</b> — not the flange tip — sits on the railhead: the
 * common IR wheel profile measured from the meshes is tread radius 0.53,
 * flange radius 0.5625 around the axle at source y = 0.5, so the contact
 * circle bottoms out at source y = −0.03 and the flange dips 0.0325 below the
 * railhead, inside the gauge, like the real thing. Railhead = path centre
 * (where the wagon body sits) + {@code RailRenderer.RAIL_Y_OFFSET} (0.0) +
 * rail model height 0.40625.
 *
 * <p>Textures come from the OBJ's {@code mtllib} ({@link MtlParser}): each
 * material's {@code map_Kd}, relative to the OBJ; a material without one is
 * not drawn.
 */
public final class IrStockModel {

    /**
     * The lift of the source onto the railhead, {@link ModelParts#Y_LIFT}: the
     * wheel tread (source y = −0.03) onto the railhead (0.40625 above the path
     * spline) — the same lift that puts a pack's markup, written in the OBJ
     * frame, into this model space.
     */
    private static final float Y_LIFT = ModelParts.Y_LIFT;

    /**
     * Where the loader reads pack files from (the client resource manager in
     * game). An interface so the loader doesn't hold on to MC's manager.
     */
    public interface ResourceAccess {
        InputStream open(ResourceLocation location) throws IOException;

        boolean exists(ResourceLocation location);
    }

    /** One object an animation moves: which door it belongs to and its model-space frames. */
    private record AnimTrack(String doorId, Matrix4f[] frames) {
    }

    private IrStockModel() {
    }

    /**
     * Load and split one declared model; an empty model (logged) if its OBJ is
     * missing or unreadable — a broken asset must not take the renderer down.
     * A control group named longer than the wire takes is dropped, with a
     * warning ({@link GroupName#fit}): sending it cut the client off its server.
     *
     * @param name   the wagon type id, for logging
     * @param decl   the pack's declaration of the model
     * @param access where the pack files are read from
     */
    public static StockModel load(String name, WagonModelDecl decl, ResourceAccess access) {
        ResourceLocation objLocation = ResourceLocation.tryParse(decl.obj());
        if (objLocation == null) {
            RailsWheelsAndTrains.LOGGER.error("{}: invalid model path {}", name, decl.obj());
            return StockModel.empty();
        }
        ObjLoader.Model obj;
        try (InputStream in = access.open(objLocation)) {
            obj = ObjLoader.loadModel(in);
        } catch (IOException e) {
            RailsWheelsAndTrains.LOGGER.error("{}: cannot read model {}: {}", name, objLocation, e.toString());
            return StockModel.empty();
        }
        Map<String, ResourceLocation> textures = materialTextures(name, objLocation, obj, access);
        Map<String, AnimTrack> animated = loadAnimations(name, decl, access);
        Map<String, String> animatedDoors = new LinkedHashMap<>();
        animated.forEach((object, track) -> animatedDoors.put(object, track.doorId()));
        List<ModelParts.Part> input = new ArrayList<>(obj.parts().size());
        for (ObjLoader.Part part : obj.parts()) {
            input.add(new ModelParts.Part(part.object(), part.material(), textures.containsKey(part.material()),
                    corners(part.mesh())));
        }
        ModelParts parts = ModelParts.of(input, new ModelParts.Declaration(decl.bogies(), decl.skip(),
                animatedDoors, decl.handbrake()));

        Map<ResourceLocation, Mesh> body = new LinkedHashMap<>();
        Map<ResourceLocation, Mesh> interior = new LinkedHashMap<>();
        Map<ResourceLocation, Mesh> frontFrame = new LinkedHashMap<>();
        Map<ResourceLocation, Mesh> rearFrame = new LinkedHashMap<>();
        List<Map<ResourceLocation, Mesh>> controls = buckets(parts.controls().size());
        List<Map<ResourceLocation, Mesh>> leaves = buckets(parts.doorLeaves().size());
        List<Map<ResourceLocation, Mesh>> couplers = buckets(parts.couplers().size());
        List<Map<String, Map<ResourceLocation, Mesh>>> doorPieces = new ArrayList<>();
        for (ModelParts.Door door : parts.doors()) {
            Map<String, Map<ResourceLocation, Mesh>> pieces = new LinkedHashMap<>();
            door.objects().forEach(object -> pieces.put(object, new LinkedHashMap<>()));
            doorPieces.add(pieces);
        }
        for (int i = 0; i < obj.parts().size(); i++) {
            ModelParts.Role role = parts.roles().get(i);
            ObjLoader.Part part = obj.parts().get(i);
            Map<ResourceLocation, Mesh> component = switch (role.place()) {
                case BODY -> body;
                case INTERIOR -> interior;
                case BOGIE -> role.front() ? frontFrame : rearFrame;
                case ANIMATED -> doorPieces.get(role.index()).get(part.object());
                case CONTROL -> role.index() < 0 ? null : controls.get(role.index());
                case DOOR_LEAF -> role.index() < 0 ? null : leaves.get(role.index());
                case COUPLER -> role.index() < 0 ? null : couplers.get(role.index());
                // wheelsets are built round their axles, below; the rest isn't drawn
                default -> null;
            };
            if (component == null) {
                continue;
            }
            float pivotZ = role.place() != ModelParts.Place.BOGIE ? 0.0F
                    : role.front() ? parts.frontBogie().pivotZ() : parts.rearBogie().pivotZ();
            int tag = StockModel.tag(role.light());
            Mesh target = component.computeIfAbsent(textures.get(part.material()), t -> new Mesh());
            for (Mesh.Quad q : part.mesh().quads()) {
                target.add(new Mesh.Quad(
                        toModelSpace(q.v0(), pivotZ), toModelSpace(q.v1(), pivotZ),
                        toModelSpace(q.v2(), pivotZ), toModelSpace(q.v3(), pivotZ),
                        q.r(), q.g(), q.b(), q.a(), tag));
            }
        }
        if (!parts.droppedGroups().isEmpty()) {
            RailsWheelsAndTrains.LOGGER.warn("{}: control group(s) {} longer than {} characters dropped: their"
                    + " switches can't be worked, their lights stay off (an LINVERT one on)", name,
                    parts.droppedGroups(), GroupName.MAX_LENGTH);
        }
        List<StockModel.Door> builtDoors = new ArrayList<>();
        for (int d = 0; d < parts.doors().size(); d++) {
            List<StockModel.Piece> pieces = new ArrayList<>();
            doorPieces.get(d).forEach((object, meshes) -> pieces.add(
                    new StockModel.Piece(meshes, animated.get(object).frames(), StockModel.outline(meshes))));
            builtDoors.add(new StockModel.Door(parts.doors().get(d).id(), pieces));
        }
        List<StockModel.Lamp> lamps = new ArrayList<>();
        for (ModelParts.Lamp lamp : parts.lamps()) {
            lamps.add(new StockModel.Lamp(lamp.x(), lamp.y(), lamp.z(), lamp.group()));
        }
        List<StockModel.Headlight> headlights = new ArrayList<>();
        for (ModelParts.Headlight h : parts.headlights()) {
            headlights.add(new StockModel.Headlight(h.x(), h.y(), h.z(), h.dirZ(), h.radius(), h.rgb(), h.group()));
        }
        List<StockModel.Coupler> builtCouplers = new ArrayList<>();
        for (int c = 0; c < parts.couplers().size(); c++) {
            ModelParts.Coupler coupler = parts.couplers().get(c);
            builtCouplers.add(new StockModel.Coupler(coupler.front(), coupler.shown(), couplers.get(c),
                    vector(coupler.pivot())));
        }
        StockModel built = new StockModel(body, interior, builtDoors, controls(parts.controls(), controls),
                controls(parts.doorLeaves(), leaves),
                bogie(parts.frontBogie(), true, frontFrame, parts, obj, textures),
                bogie(parts.rearBogie(), false, rearFrame, parts, obj, textures),
                liveries(name, decl, objLocation, textures, access),
                parts.lightGroups(), List.copyOf(lamps), List.copyOf(headlights), List.copyOf(builtCouplers));
        RailsWheelsAndTrains.LOGGER.info(
                "Loaded {}: {} parts ({} skipped) — {} textures, interior {} quads,"
                        + " {} animated doors, {} door leaves, {} controls, light groups {},"
                        + " {} cabin lamps, {} headlights, bogies with {}+{} wheelsets, {} liveries,"
                        + " {} coupler heads",
                name, obj.parts().size(), parts.skipped(), textures.size(),
                interior.values().stream().mapToInt(m -> m.quads().size()).sum(),
                builtDoors.size(), built.doorLeaves().size(), built.controls().size(), parts.lightGroups(),
                lamps.size(), headlights.size(),
                built.frontBogie().wheels().size(), built.rearBogie().wheels().size(),
                built.liveries().size(), built.couplers().size());
        return built;
    }

    /**
     * The corners of a mesh's quads, {@code x, y, z} each, in order — a part
     * as {@link ModelParts.Part} takes it.
     */
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

    /** {@code count} empty texture buckets. */
    private static List<Map<ResourceLocation, Mesh>> buckets(int count) {
        List<Map<ResourceLocation, Mesh>> buckets = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            buckets.add(new LinkedHashMap<>());
        }
        return buckets;
    }

    /** The controls (or leaves) as drawn: each with its meshes and their hover outline. */
    private static List<StockModel.Control> controls(List<ModelParts.Control> controls,
            List<Map<ResourceLocation, Mesh>> meshes) {
        List<StockModel.Control> built = new ArrayList<>(controls.size());
        for (int i = 0; i < controls.size(); i++) {
            ModelParts.Control c = controls.get(i);
            built.add(new StockModel.Control(c.role(), meshes.get(i), c.interior(), vector(c.pivot()),
                    vector(c.axis()), c.degrees(), vector(c.slide()), vector(c.boxMin()), vector(c.boxMax()),
                    StockModel.outline(meshes.get(i))));
        }
        return List.copyOf(built);
    }

    /**
     * A bogie as drawn: its frame (already re-centred on its pivot) and its
     * wheelsets, each the textured parts of its object re-centred on its axle.
     */
    private static StockModel.Bogie bogie(ModelParts.Bogie bogie, boolean front, Map<ResourceLocation, Mesh> frame,
            ModelParts parts, ObjLoader.Model obj, Map<String, ResourceLocation> textures) {
        List<Map<ResourceLocation, Mesh>> wheelMeshes = buckets(bogie.wheels().size());
        for (int i = 0; i < obj.parts().size(); i++) {
            ModelParts.Role role = parts.roles().get(i);
            if (role.place() != ModelParts.Place.WHEEL || role.front() != front) {
                continue;
            }
            ObjLoader.Part part = obj.parts().get(i);
            ModelParts.Wheel wheel = bogie.wheels().get(role.index());
            Mesh target = wheelMeshes.get(role.index()).computeIfAbsent(textures.get(part.material()),
                    t -> new Mesh());
            for (Mesh.Quad q : part.mesh().quads()) {
                target.add(new Mesh.Quad(
                        wheelSpace(q.v0(), wheel.axleX(), wheel.axleY()), wheelSpace(q.v1(), wheel.axleX(), wheel.axleY()),
                        wheelSpace(q.v2(), wheel.axleX(), wheel.axleY()), wheelSpace(q.v3(), wheel.axleX(), wheel.axleY()),
                        q.r(), q.g(), q.b(), q.a()));
            }
        }
        List<StockModel.Wheel> wheels = new ArrayList<>(bogie.wheels().size());
        for (int i = 0; i < bogie.wheels().size(); i++) {
            ModelParts.Wheel wheel = bogie.wheels().get(i);
            wheels.add(new StockModel.Wheel(wheel.centerY(), wheel.centerZ(), wheel.radius(), wheelMeshes.get(i)));
        }
        return new StockModel.Bogie(frame, wheels);
    }

    /** A point or direction of {@link ModelParts} as a vector; null for none. */
    private static Vector3f vector(float[] v) {
        return v == null ? null : new Vector3f(v[0], v[1], v[2]);
    }

    /**
     * Material → texture, from every {@code mtllib} of the OBJ. Paths are
     * relative to the OBJ's folder ({@code ../} allowed); a material whose
     * map is missing still maps — MC draws its missing-texture checker, which
     * is the signal a pack author needs — but it is logged.
     */
    static Map<String, ResourceLocation> materialTextures(String name,
            ResourceLocation objLocation, ObjLoader.Model obj, ResourceAccess access) {
        String folder = MtlParser.folderOf(objLocation.getPath());
        Map<String, ResourceLocation> textures = new LinkedHashMap<>();
        for (String library : obj.materialLibraries()) {
            ResourceLocation mtl = relative(objLocation.getNamespace(), folder, library);
            if (mtl == null) {
                RailsWheelsAndTrains.LOGGER.warn("{}: bad material library path {}", name, library);
                continue;
            }
            Map<String, String> maps;
            try (InputStream in = access.open(mtl)) {
                maps = MtlParser.parse(in);
            } catch (IOException e) {
                RailsWheelsAndTrains.LOGGER.warn("{}: cannot read material library {}: {}",
                        name, mtl, e.toString());
                continue;
            }
            for (Map.Entry<String, String> map : maps.entrySet()) {
                ResourceLocation texture = relative(objLocation.getNamespace(), folder, map.getValue());
                if (texture == null) {
                    RailsWheelsAndTrains.LOGGER.warn("{}: material {} has a bad texture path {}",
                            name, map.getKey(), map.getValue());
                    continue;
                }
                if (!access.exists(texture)) {
                    RailsWheelsAndTrains.LOGGER.warn("{}: material {} texture {} is missing",
                            name, map.getKey(), texture);
                }
                textures.putIfAbsent(map.getKey(), texture);
            }
        }
        return textures;
    }

    /**
     * Livery id → (base texture → livery texture): a texture with the same
     * file name inside the livery's folder (next to the OBJ) replaces the base
     * one; textures the livery doesn't carry stay base (IR {@code tex_variants}).
     */
    private static Map<String, Map<ResourceLocation, ResourceLocation>> liveries(String name,
            WagonModelDecl decl, ResourceLocation objLocation,
            Map<String, ResourceLocation> textures, ResourceAccess access) {
        String folder = MtlParser.folderOf(objLocation.getPath());
        Map<String, Map<ResourceLocation, ResourceLocation>> liveries = new LinkedHashMap<>();
        for (Map.Entry<String, String> livery : decl.liveries().entrySet()) {
            Map<ResourceLocation, ResourceLocation> swaps = new LinkedHashMap<>();
            for (ResourceLocation base : textures.values()) {
                ResourceLocation swap = relative(objLocation.getNamespace(), folder,
                        livery.getValue() + "/" + MtlParser.fileNameOf(base.getPath()));
                if (swap != null && access.exists(swap)) {
                    swaps.put(base, swap);
                }
            }
            if (swaps.isEmpty()) {
                RailsWheelsAndTrains.LOGGER.warn("{}: livery {} replaces no texture (folder {})",
                        name, livery.getKey(), livery.getValue());
            }
            liveries.put(livery.getKey(), Map.copyOf(swaps));
        }
        return Map.copyOf(liveries);
    }

    /** A path relative to a folder of {@code namespace} as a location; null if it's not a valid one. */
    private static ResourceLocation relative(String namespace, String folder, String path) {
        String resolved = MtlParser.resolve(folder, path);
        return resolved == null ? null : ResourceLocation.tryBuild(namespace, resolved);
    }

    /**
     * Read every declared animation: object name → (group, model-space frames).
     * A missing or broken animation is logged and its objects simply stay part
     * of the static body (closed, no swing).
     */
    private static Map<String, AnimTrack> loadAnimations(String name, WagonModelDecl decl,
            ResourceAccess access) {
        Map<String, AnimTrack> tracks = new LinkedHashMap<>();
        for (Map.Entry<String, String> group : decl.animations().entrySet()) {
            ResourceLocation location = ResourceLocation.tryParse(group.getValue());
            if (location == null) {
                RailsWheelsAndTrains.LOGGER.error("{}: invalid animation path {}", name, group.getValue());
                continue;
            }
            try (InputStream in = access.open(location)) {
                for (Map.Entry<String, List<float[]>> track : IrAnim.parse(in).entrySet()) {
                    Matrix4f[] frames = new Matrix4f[track.getValue().size()];
                    for (int i = 0; i < frames.length; i++) {
                        frames[i] = IrAnim.toModelSpace(track.getValue().get(i), Y_LIFT);
                    }
                    if (frames.length > 0) {
                        tracks.put(track.getKey(), new AnimTrack(group.getKey(), frames));
                    }
                }
            } catch (IOException | RuntimeException e) {
                RailsWheelsAndTrains.LOGGER.error("{}: bad animation {}: {}", name, location, e.toString());
            }
        }
        return tracks;
    }

    /**
     * Rotate +90° about Y (source −X front → model +Z forward), lift onto the
     * railhead, and re-centre on the component pivot ({@code pivotZ} = 0 for
     * the body, the bogie pivot offset for bogie parts).
     */
    private static Mesh.Vertex toModelSpace(Mesh.Vertex v, float pivotZ) {
        return new Mesh.Vertex(
                v.z(), v.y() + Y_LIFT, -v.x() - pivotZ,
                v.u(), v.v(),
                v.nz(), v.ny(), -v.nx());
    }

    /** Same rotation as {@link #toModelSpace}, but re-centred on the wheel's axle. */
    private static Mesh.Vertex wheelSpace(Mesh.Vertex v, float axleX, float axleY) {
        return new Mesh.Vertex(
                v.z(), v.y() - axleY, -(v.x() - axleX),
                v.u(), v.v(),
                v.nz(), v.ny(), -v.nx());
    }
}
