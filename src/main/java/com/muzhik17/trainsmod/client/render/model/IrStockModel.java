package com.muzhik17.trainsmod.client.render.model;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.joml.Matrix4f;
import org.joml.Vector3f;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.convention.ObjectRole;
import com.muzhik17.trainsmod.convention.PivotAxis;

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
 * <p>Parts are split by the IR object-name convention: {@code BOGEY_FRONT*}/
 * {@code BOGEY_REAR*} objects become the two bogie components of the
 * {@link StockModel}, re-centred on their pivots (the declaration's
 * {@code bogies}, else the centre of the bogie frame meshes) so the renderer
 * can articulate them; {@code *_WHEEL_n} objects inside a
 * bogie become {@link StockModel.Wheel}s, re-centred on their axles (centre
 * measured from the mesh) so they can spin; objects named {@code INTERIOR*}
 * (the IR interior shell: seats, partitions, cab fittings) become the
 * {@link StockModel#interior} — rigid with the body, but a separate component
 * the renderer drops at a distance; everything else is the rigid body. Only the
 * name <i>prefix</i> counts: other objects carry an {@code _INTERIOR_} token
 * too, some of them seen from outside (the ChME3 cab windows
 * {@code WINDOW_n_…_INTERIOR_…}), and those must not vanish with distance.
 *
 * <p>Render model space is +Z forward (see {@link WagonModel}), so vertices
 * and normals are rotated +90° about Y at load: {@code (x,y,z) → (z,y,−x)}.
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
 * material's {@code map_Kd}, relative to the OBJ. Skipped at load: objects
 * whose name contains {@code HIDE} (shown only in coupled/special states the
 * mod doesn't model yet), the convention's marker prefixes
 * {@link #DEFAULT_SKIP_PREFIXES} plus the declaration's own {@code skip}, and
 * materials without a diffuse map. Groups listed under the declaration's
 * {@code animations} are animated from their IR {@code .anim} ({@link IrAnim});
 * cab controls ({@code THROTTLE_*}, {@code WIDGET_*}, {@code GAUGE_*}…) and
 * door leaves moved by name ({@code DOOR_<n>} with {@code ROT_}/{@code TL_})
 * are split out to move by their values (SPEC §9.3, §9.5).
 */
public final class IrStockModel {

    /** Railhead height above the path spline: RailRenderer.RAIL_Y_OFFSET (0.0) + rail 0.40625. */
    private static final float RAIL_TOP = 0.0F + 0.40625F;
    /**
     * Source y where the wheel tread (rolling circle, r = 0.53 around the axle
     * at y = 0.5) bottoms out. The meshes' lowest wheel point is the flange tip
     * at −0.0625; seating THAT on the railhead floated the whole train by the
     * flange height 0.0325 (second ChME3 play-test fix).
     */
    private static final float TREAD_BOTTOM = -0.03F;
    private static final float Y_LIFT = RAIL_TOP - TREAD_BOTTOM;

    /** Rolling (tread) radius, blocks — wheel spin angle = rolled distance / radius. */
    private static final float WHEEL_RADIUS = 0.53F;

    /**
     * Object-name prefixes that are never geometry in the IR convention:
     * {@code CARGO_FILL} — the cargo at each load level (1/20/…/100 %), all
     * overlapping; cargo isn't modelled, so the wagon renders empty. IR draws
     * its {@code SEAT_} objects like the rest of the model, and so do we: in
     * MVP the textured ones are cushions (the DR1's seats, its cab chairs),
     * the flat passenger-seat markers have no material and drop out with
     * every untextured part.
     */
    private static final List<String> DEFAULT_SKIP_PREFIXES = List.of("CARGO_FILL");

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

    /** Accumulates one door's animated pieces, one per object, in file order. */
    private static final class DoorBuilder {
        final Map<String, Map<ResourceLocation, Mesh>> meshes = new LinkedHashMap<>();
        final Map<String, Matrix4f[]> frames = new LinkedHashMap<>();

        StockModel.Door build(String id) {
            List<StockModel.Piece> pieces = new ArrayList<>();
            for (Map.Entry<String, Map<ResourceLocation, Mesh>> entry : meshes.entrySet()) {
                pieces.add(new StockModel.Piece(entry.getValue(), frames.get(entry.getKey()),
                        StockModel.outline(entry.getValue())));
            }
            return new StockModel.Door(id, pieces);
        }
    }

    private IrStockModel() {
    }

    /**
     * Accumulates one cab control (SPEC §9.3): the objects sharing its IR key,
     * the merged naming flags, and its pivot marker's points (source space).
     */
    private static final class ControlBuilder {
        ObjectRole.Control role;
        final Map<ResourceLocation, Mesh> meshes = new LinkedHashMap<>();
        boolean interior;
        boolean hasPivot;
        float degrees;
        final List<float[]> pivotPoints = new ArrayList<>();
        final float[] box = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
                -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};

        void add(ObjectRole objectRole, String object, ObjLoader.Part part) {
            role = role == null ? objectRole.control() : merge(role, objectRole.control());
            interior |= ObjectRole.hasToken(object, "INTERIOR");
            if (objectRole.pivot() && !hasPivot) {
                // IR takes the first object of the control named …_ROT…
                hasPivot = true;
                degrees = objectRole.pivotDegrees();
                Set<Long> seen = new HashSet<>();
                for (Mesh.Quad q : part.mesh().quads()) {
                    for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                        long key = (long) Math.round(v.x() * 1.0e4F) * 73856093L
                                ^ (long) Math.round(v.y() * 1.0e4F) * 19349663L
                                ^ (long) Math.round(v.z() * 1.0e4F) * 83492791L;
                        if (seen.add(key)) {
                            pivotPoints.add(new float[]{v.x(), v.y(), v.z()});
                        }
                    }
                }
            }
        }

        void bound(Mesh placed) {
            float[] b = bounds(placed);
            for (int i = 0; i < 3; i++) {
                box[i] = Math.min(box[i], b[i]);
                box[i + 3] = Math.max(box[i + 3], b[i + 3]);
            }
        }

        /** The built control, or null if it has nothing to draw. */
        StockModel.Control build() {
            if (meshes.isEmpty() || box[0] > box[3]) {
                return null;
            }
            Vector3f pivot = null;
            Vector3f axis = new Vector3f(0.0F, 1.0F, 0.0F);
            if (hasPivot && !pivotPoints.isEmpty()) {
                float[][] pa = PivotAxis.of(pivotPoints);
                // source → model space: (x, y, z) → (z, y + lift, −x); axes turn alike
                pivot = new Vector3f(pa[0][2], pa[0][1] + Y_LIFT, -pa[0][0]);
                axis = new Vector3f(pa[1][2], pa[1][1], -pa[1][0]);
            }
            Vector3f slide = new Vector3f(role.slideZ(), role.slideY(), -role.slideX());
            return new StockModel.Control(role, meshes, interior, pivot, axis, degrees, slide,
                    new Vector3f(box[0], box[1], box[2]), new Vector3f(box[3], box[4], box[5]),
                    StockModel.outline(meshes));
        }

        /** One control's flags spread over its objects: IR reads them from any of them. */
        private static ObjectRole.Control merge(ObjectRole.Control a, ObjectRole.Control b) {
            return new ObjectRole.Control(a.kind(), a.id(), a.key(),
                    a.group().equals(a.key()) ? b.group() : a.group(),
                    a.label() != null ? a.label() : b.label(),
                    a.toggle() || b.toggle(), a.press() || b.press(), a.invert() || b.invert(),
                    a.hide() || b.hide(), a.noTouch() || b.noTouch(), a.global() || b.global(),
                    a.offset() != 0.0F ? a.offset() : b.offset(),
                    b.rangeMin() != 0.0F || b.rangeMax() != 1.0F ? b.rangeMin() : a.rangeMin(),
                    b.rangeMin() != 0.0F || b.rangeMax() != 1.0F ? b.rangeMax() : a.rangeMax(),
                    b.slideX() != 0.0F ? b.slideX() : a.slideX(),
                    b.slideY() != 0.0F ? b.slideY() : a.slideY(),
                    b.slideZ() != 0.0F ? b.slideZ() : a.slideZ());
        }
    }

    /** Accumulates one bogie: frame parts plus per-object wheel groups. */
    private static final class BogieBuilder {
        final float pivotZ;
        final Map<ResourceLocation, Mesh> frame = new LinkedHashMap<>();
        final Map<String, WheelBuilder> wheels = new LinkedHashMap<>();

        BogieBuilder(double pivot) {
            this.pivotZ = (float) pivot;
        }

        StockModel.Bogie build(Map<String, ResourceLocation> textures) {
            List<StockModel.Wheel> built = new ArrayList<>(wheels.size());
            for (WheelBuilder wheel : wheels.values()) {
                built.add(wheel.build(textures, pivotZ));
            }
            return new StockModel.Bogie(frame, built);
        }
    }

    /** One wheelset: raw source-space parts + the axle centre measured from them. */
    private static final class WheelBuilder {
        final List<ObjLoader.Part> parts = new ArrayList<>();
        float minX = Float.MAX_VALUE;
        float maxX = -Float.MAX_VALUE;
        float minY = Float.MAX_VALUE;
        float maxY = -Float.MAX_VALUE;

        void add(ObjLoader.Part part) {
            parts.add(part);
            for (Mesh.Quad q : part.mesh().quads()) {
                for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                    minX = Math.min(minX, v.x());
                    maxX = Math.max(maxX, v.x());
                    minY = Math.min(minY, v.y());
                    maxY = Math.max(maxY, v.y());
                }
            }
        }

        StockModel.Wheel build(Map<String, ResourceLocation> textures, float bogiePivotZ) {
            float axleX = (minX + maxX) / 2.0F; // source axle position along travel
            float axleY = (minY + maxY) / 2.0F; // source axle height
            Map<ResourceLocation, Mesh> meshes = new LinkedHashMap<>();
            for (ObjLoader.Part part : parts) {
                ResourceLocation tex = textures.get(part.material());
                if (tex == null) {
                    continue;
                }
                Mesh target = meshes.computeIfAbsent(tex, t -> new Mesh());
                for (Mesh.Quad q : part.mesh().quads()) {
                    target.add(new Mesh.Quad(
                            wheelSpace(q.v0(), axleX, axleY), wheelSpace(q.v1(), axleX, axleY),
                            wheelSpace(q.v2(), axleX, axleY), wheelSpace(q.v3(), axleX, axleY),
                            q.r(), q.g(), q.b(), q.a()));
                }
            }
            return new StockModel.Wheel(
                    axleY + Y_LIFT,                 // bogie-local axle height
                    -axleX - bogiePivotZ,           // bogie-local axle position along +Z
                    WHEEL_RADIUS, meshes);
        }
    }

    /**
     * Load and split one declared model; an empty model (logged) if its OBJ is
     * missing or unreadable — a broken asset must not take the renderer down.
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
        double[] pivots = decl.bogies() != null ? decl.bogies() : measurePivots(obj.parts());
        List<String> skipPrefixes = new ArrayList<>(DEFAULT_SKIP_PREFIXES);
        skipPrefixes.addAll(decl.skip());

        Map<ResourceLocation, Mesh> body = new LinkedHashMap<>();
        Map<ResourceLocation, Mesh> interior = new LinkedHashMap<>();
        Map<String, AnimTrack> animated = loadAnimations(name, decl, access);
        Map<String, DoorBuilder> doors = new LinkedHashMap<>();
        Map<String, ControlBuilder> controls = new LinkedHashMap<>();
        Map<String, ControlBuilder> leaves = new LinkedHashMap<>();
        Set<String> movingDoors = movingDoors(obj.parts(), skipPrefixes, animated);
        List<String> lightGroups = new ArrayList<>();
        Set<Integer> interiorGroups = new HashSet<>();
        List<StockModel.Lamp> lampCandidates = new ArrayList<>();
        List<StockModel.Headlight> headlights = new ArrayList<>();
        // bogie pivots: front first, +forward = model +Z
        BogieBuilder front = new BogieBuilder(pivots[0]);
        BogieBuilder rear = new BogieBuilder(pivots[pivots.length - 1]);
        int skipped = 0;
        for (ObjLoader.Part part : obj.parts()) {
            String object = part.object();
            ObjectRole role = ObjectRole.parse(object);
            // a hidden switch-driven part (the ChME3 tail lamps) shows by its group;
            // other HIDE objects stay out (coupled-state geometry isn't modelled)
            boolean widget = role.control() != null && role.control().kind() == ObjectRole.Kind.WIDGET;
            if ((object.contains("HIDE") && !widget) || startsWithAny(object, skipPrefixes)) {
                skipped++;
                continue;
            }
            BogieBuilder bogie = object.startsWith("BOGEY_FRONT") ? front
                    : object.startsWith("BOGEY_REAR") ? rear : null;
            if (bogie != null && object.contains("_WHEEL_")) {
                bogie.wheels.computeIfAbsent(object, n -> new WheelBuilder()).add(part);
                continue;
            }
            AnimTrack track = bogie == null ? animated.get(object) : null;
            // a door leaf moved by name is built like a control (SPEC §9.5)
            ObjectRole leafRole = bogie == null && track == null ? ObjectRole.door(object) : null;
            if (leafRole != null && !movingDoors.contains(leafRole.control().key())) {
                leafRole = null; // a door the asset doesn't move: part of the body
            }
            ControlBuilder control = leafRole != null
                    ? leaves.computeIfAbsent(leafRole.control().key(), k -> new ControlBuilder())
                    : bogie == null && track == null && role.control() != null
                            ? controls.computeIfAbsent(role.control().key(), k -> new ControlBuilder())
                            : null;
            if (control != null) {
                // a pivot marker counts even without a texture
                control.add(leafRole != null ? leafRole : role, object, part);
            }
            ResourceLocation tex = textures.get(part.material());
            if (tex == null) {
                skipped++;
                continue;
            }
            int group = -1;
            if (role.lightGroup() != null) {
                group = lightGroups.indexOf(role.lightGroup());
                if (group < 0) {
                    group = lightGroups.size();
                    lightGroups.add(role.lightGroup());
                }
            }
            boolean interiorLit = ObjectRole.hasToken(object, "INTERIOR");
            if (interiorLit && group >= 0) {
                interiorGroups.add(group);
            }
            int tag = StockModel.tag(group, role.fullbright(), interiorLit, role.lightInvert());
            Map<ResourceLocation, Mesh> component;
            if (track != null) {
                DoorBuilder door = doors.computeIfAbsent(track.doorId(), id -> new DoorBuilder());
                door.frames.put(object, track.frames());
                component = door.meshes.computeIfAbsent(object, n -> new LinkedHashMap<>());
            } else if (control != null) {
                component = control.meshes;
            } else {
                component = bogie != null ? bogie.frame
                        : object.startsWith("INTERIOR") ? interior : body;
            }
            float pivotZ = bogie != null ? bogie.pivotZ : 0.0F;
            Mesh target = component.computeIfAbsent(tex, t -> new Mesh());
            Mesh placed = new Mesh();
            for (Mesh.Quad q : part.mesh().quads()) {
                Mesh.Quad quad = new Mesh.Quad(
                        toModelSpace(q.v0(), pivotZ), toModelSpace(q.v1(), pivotZ),
                        toModelSpace(q.v2(), pivotZ), toModelSpace(q.v3(), pivotZ),
                        q.r(), q.g(), q.b(), q.a(), tag);
                target.add(quad);
                placed.add(quad);
            }
            if (control != null) {
                control.bound(placed);
            }
            if (bogie == null && track == null) {
                if (role.headlight()) {
                    headlights.add(headlight(placed, role, group));
                } else if (role.fullbright() && control == null) {
                    lampCandidates.addAll(LampIslands.of(placed, group));
                }
            }
        }
        List<StockModel.Door> builtDoors = new ArrayList<>();
        doors.forEach((id, door) -> builtDoors.add(door.build(id)));
        List<StockModel.Control> builtControls = new ArrayList<>();
        controls.forEach((key, control) -> {
            StockModel.Control built = control.build();
            if (built != null && decl.handbrake().contains(key)) {
                // the declaration says this widget is the handbrake wheel (SPEC §5.3)
                built = built.withRole(built.role().withKind(ObjectRole.Kind.HANDBRAKE));
            }
            if (built != null) {
                builtControls.add(built);
            }
        });
        List<StockModel.Control> builtLeaves = new ArrayList<>();
        leaves.forEach((key, leaf) -> {
            StockModel.Control built = leaf.build();
            if (built != null) {
                builtLeaves.add(built);
            }
        });
        // cabin lamps light the inside only if their group lights something inside
        // (ChME3/platzkart IL); buffer and bogie lamps (FBL, BgL) stay outdoors
        List<StockModel.Lamp> lamps = new ArrayList<>();
        for (StockModel.Lamp lamp : lampCandidates) {
            if (lamp.group() >= 0 && interiorGroups.contains(lamp.group())) {
                lamps.add(lamp);
            }
        }
        StockModel built = new StockModel(body, interior, builtDoors, List.copyOf(builtControls),
                List.copyOf(builtLeaves), front.build(textures), rear.build(textures),
                liveries(name, decl, objLocation, textures, access),
                List.copyOf(lightGroups), List.copyOf(lamps), List.copyOf(headlights));
        RailsWheelsAndTrains.LOGGER.info(
                "Loaded {}: {} parts ({} skipped) — {} textures, interior {} quads,"
                        + " {} animated doors, {} door leaves, {} controls, light groups {},"
                        + " {} cabin lamps, {} headlights, bogies with {}+{} wheelsets, {} liveries",
                name, obj.parts().size(), skipped, textures.size(),
                interior.values().stream().mapToInt(m -> m.quads().size()).sum(),
                builtDoors.size(), builtLeaves.size(), builtControls.size(), lightGroups, lamps.size(),
                headlights.size(),
                built.frontBogie().wheels().size(), built.rearBogie().wheels().size(),
                built.liveries().size());
        return built;
    }

    /**
     * A headlight from its lens object (IR {@code LightFlare}): a front lamp
     * (model +Z half) shines forward from its front face, a rear one back.
     */
    private static StockModel.Headlight headlight(Mesh placed, ObjectRole role, int group) {
        float[] box = bounds(placed);
        float cz = (box[2] + box[5]) * 0.5F;
        boolean forward = cz >= 0.0F;
        return new StockModel.Headlight((box[0] + box[3]) * 0.5F, (box[1] + box[4]) * 0.5F,
                forward ? box[5] + 0.02F : box[2] - 0.02F, forward ? 1.0F : -1.0F,
                Math.max(box[3] - box[0], box[4] - box[1]) * 0.5F, role.rgb(), group);
    }

    /** {minX, minY, minZ, maxX, maxY, maxZ} of a mesh. */
    static float[] bounds(Mesh mesh) {
        float[] box = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
                -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
        for (Mesh.Quad q : mesh.quads()) {
            for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                box[0] = Math.min(box[0], v.x());
                box[1] = Math.min(box[1], v.y());
                box[2] = Math.min(box[2], v.z());
                box[3] = Math.max(box[3], v.x());
                box[4] = Math.max(box[4], v.y());
                box[5] = Math.max(box[5], v.z());
            }
        }
        return box;
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
     * Bogie pivots when the declaration gives none: the centre, along travel,
     * of each bogie's frame meshes (wheels excluded), as +forward offsets. A
     * model without bogie objects gets 0 — there is nothing to re-centre.
     */
    private static double[] measurePivots(List<ObjLoader.Part> parts) {
        float[] frontX = {Float.MAX_VALUE, -Float.MAX_VALUE};
        float[] rearX = {Float.MAX_VALUE, -Float.MAX_VALUE};
        for (ObjLoader.Part part : parts) {
            String object = part.object();
            float[] range = object.startsWith("BOGEY_FRONT") ? frontX
                    : object.startsWith("BOGEY_REAR") ? rearX : null;
            if (range == null || object.contains("_WHEEL_") || object.contains("HIDE")) {
                continue;
            }
            for (Mesh.Quad q : part.mesh().quads()) {
                for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                    range[0] = Math.min(range[0], v.x());
                    range[1] = Math.max(range[1], v.x());
                }
            }
        }
        // source front is −X: a bogie centred at source x sits at −x along +forward
        double front = frontX[0] <= frontX[1] ? -(frontX[0] + frontX[1]) / 2.0 : 0.0;
        double rear = rearX[0] <= rearX[1] ? -(rearX[0] + rearX[1]) / 2.0 : 0.0;
        return new double[]{front, rear};
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
     * The {@code DOOR_<n>} keys the asset moves by name: any object of the
     * door, drawn and not animated by an {@code .anim}, is its hinge
     * ({@code DOOR_<n>_ROT…}) or slides ({@code TL_<f>_<axis>}). IR reads a
     * door's flags from any of its objects, so the whole door moves.
     */
    private static Set<String> movingDoors(List<ObjLoader.Part> parts, List<String> skipPrefixes,
            Map<String, AnimTrack> animated) {
        Set<String> moving = new HashSet<>();
        for (ObjLoader.Part part : parts) {
            String object = part.object();
            if (object.contains("HIDE") || startsWithAny(object, skipPrefixes)
                    || object.startsWith("BOGEY_") || animated.containsKey(object)) {
                continue;
            }
            ObjectRole leaf = ObjectRole.door(object);
            if (leaf != null && (leaf.pivot() || leaf.control().slideX() != 0.0F
                    || leaf.control().slideY() != 0.0F || leaf.control().slideZ() != 0.0F)) {
                moving.add(leaf.control().key());
            }
        }
        return moving;
    }

    private static boolean startsWithAny(String name, List<String> prefixes) {
        for (String prefix : prefixes) {
            if (name.startsWith(prefix)) {
                return true;
            }
        }
        return false;
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
