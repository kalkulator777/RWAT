package com.muzhik17.trainsmod.client.render.model;

import java.util.List;
import java.util.Map;

import org.joml.Matrix4f;
import org.joml.Vector3f;

import com.muzhik17.trainsmod.convention.ObjectRole;
import com.muzhik17.trainsmod.kinematics.EdgeOutline;

import net.minecraft.resources.ResourceLocation;

/**
 * A rolling-stock model split into renderable components (SPEC §5.2): the body,
 * the interior, one {@link Bogie} per bogie, and per-bogie {@link Wheel}s, each
 * bucketed by texture. Bogie meshes are in <b>their own local space</b> —
 * re-centred on the bogie pivot at load — so the renderer places each one at
 * its bogie's path sample point with the local tangent orientation
 * (articulation through curves), while the body follows the chord pose. Wheels
 * are further re-centred on their axles (bogie-local {@code centerY}/
 * {@code centerZ}) so they can spin about the axle by rolled distance /
 * {@code radius}.
 *
 * <p>The {@code interior} rides the body pose but is a separate component so
 * the renderer can skip it at a distance (SPEC §2.4): a passenger car's
 * interior is over a third of its geometry and only shows through windows.
 *
 * <p>The {@code doors} are animated groups (SPEC v1.5): every object one
 * door's IR animation moves — leaf, handles, step trap — split out of the body
 * into {@link Piece}s that carry their per-frame model-space transforms; the
 * renderer picks the frame from the door's open/close progress.
 *
 * <p>The {@code controls} are the cab's levers, switches and gauges (SPEC
 * §9.3), each moved by its own value about its own pivot.
 *
 * <p>The {@code doorLeaves} are doors the asset swings or slides by name
 * ({@code DOOR_<n>_ROT_<degrees>}, {@code TL_<f>_<axis>}) rather than by an
 * animation (SPEC §9.5): built like controls, each moved by the openness of
 * the wagon type's door whose box holds it ({@code WagonType.doorHolding}).
 *
 * <p>Light (SPEC §8): every quad's {@code tag} says how it is lit —
 * {@link #tag}; {@code lightGroups} are the model's light groups (a tag's group
 * index points here), {@code lamps} the cabin lamps that light the interior,
 * {@code headlights} the lamps that throw a flare and a beam.
 *
 * <p>{@code liveries} are paint schemes (SPEC §6.7): livery id → which base
 * textures it replaces with which. The meshes are shared — a livery is the
 * same geometry baked against other textures.
 *
 * <p>Every loader returns this shape; the renderer doesn't know the source.
 */
public record StockModel(
        Map<ResourceLocation, Mesh> body,
        Map<ResourceLocation, Mesh> interior,
        List<Door> doors,
        List<Control> controls,
        List<Control> doorLeaves,
        Bogie frontBogie,
        Bogie rearBogie,
        Map<String, Map<ResourceLocation, ResourceLocation>> liveries,
        List<String> lightGroups,
        List<Lamp> lamps,
        List<Headlight> headlights) {

    /** Quad tag bits (SPEC §8): low byte = light group index + 1 (0 = none). */
    public static final int TAG_GROUP_MASK = 0xFF;
    /** The quad glows at full brightness while its group is lit. */
    public static final int TAG_FULLBRIGHT = 1 << 8;
    /** The quad is inside the car: the cabin lamps light it. */
    public static final int TAG_INTERIOR = 1 << 9;
    /** The quad's group lights it while <i>off</i> ({@code LINVERT}). */
    public static final int TAG_LINVERT = 1 << 10;

    /** A quad tag: light group index (−1 = none), glows, lit by the cabin lamps, inverted. */
    public static int tag(int group, boolean fullbright, boolean interior, boolean linvert) {
        return (group + 1 & TAG_GROUP_MASK) | (fullbright ? TAG_FULLBRIGHT : 0)
                | (interior ? TAG_INTERIOR : 0) | (linvert ? TAG_LINVERT : 0);
    }

    /** True if a quad with this tag is lit given the model's lit groups. */
    public static boolean tagLit(int tag, long litMask) {
        int group = tagGroup(tag);
        if (group < 0) {
            return true;
        }
        boolean on = group < 64 && (litMask >> group & 1L) != 0;
        return on != ((tag & TAG_LINVERT) != 0);
    }

    /** The light group index of a tag, −1 if none. */
    public static int tagGroup(int tag) {
        return (tag & TAG_GROUP_MASK) - 1;
    }

    /** Texture substitutions of a livery; empty (base textures) for an unknown or base livery. */
    public Map<ResourceLocation, ResourceLocation> livery(String livery) {
        return liveries.getOrDefault(livery, Map.of());
    }

    /** One animated door: its id (matching the wagon type's door) and moving pieces. */
    public record Door(String id, List<Piece> pieces) {
    }

    /**
     * One animated object of a door, in model space at rest; {@code frames}
     * are its model-space transforms over the animation (frame 0 = rest);
     * {@code outline} its hover outline at rest (SPEC §9.3).
     */
    public record Piece(Map<ResourceLocation, Mesh> meshes, Matrix4f[] frames, EdgeOutline outline) {
    }

    /**
     * A cab control (SPEC §9.3): every object of one IR control at rest, in
     * model space, and how its value moves them — a turn of
     * {@code value × degrees} about {@code axis} through {@code pivot} (none if
     * {@code pivot} is null) after a slide of {@code value × slide}. The rest
     * box ({@code boxMin}/{@code boxMax}) is what a click is tested against,
     * moved with the control; {@code outline} is the hover outline of its
     * meshes at rest, moved with it alike.
     *
     * @param interior inside the car: drawn only near, like the interior
     */
    public record Control(ObjectRole.Control role, Map<ResourceLocation, Mesh> meshes,
            boolean interior, Vector3f pivot, Vector3f axis, float degrees, Vector3f slide,
            Vector3f boxMin, Vector3f boxMax, EdgeOutline outline) {

        /** The same control doing another job (a declared handbrake wheel). */
        public Control withRole(ObjectRole.Control newRole) {
            return new Control(newRole, meshes, interior, pivot, axis, degrees, slide, boxMin, boxMax, outline);
        }

        /** The model-space transform at animation value {@code value} (IR order: slide, then turn). */
        public Matrix4f transform(float value, Matrix4f dest) {
            dest.identity().translate(slide.x * value, slide.y * value, slide.z * value);
            if (pivot != null && degrees != 0.0F) {
                dest.translate(pivot)
                        .rotate((float) Math.toRadians(value * degrees), axis)
                        .translate(-pivot.x, -pivot.y, -pivot.z);
            }
            return dest;
        }
    }

    /** A cabin lamp (SPEC §8): the centre of a glowing island of its group's mesh. */
    public record Lamp(float x, float y, float z, int group) {
    }

    /**
     * A headlight (SPEC §8): the centre of its lens face, which way it shines
     * along the model ({@code dirZ} = +1 forward, −1 back), the lens radius,
     * its colour and light group (−1 = always lit).
     */
    public record Headlight(float x, float y, float z, float dirZ, float radius, int rgb, int group) {
    }

    /** The non-spinning bogie frame plus its wheelsets. */
    public record Bogie(Map<ResourceLocation, Mesh> meshes, List<Wheel> wheels) {
    }

    /**
     * One wheelset, mesh re-centred on its axle. {@code centerY}/{@code centerZ}
     * place the axle in bogie-local space; {@code radius} is the rolling
     * (tread) radius the spin angle is derived from.
     */
    public record Wheel(float centerY, float centerZ, float radius,
            Map<ResourceLocation, Mesh> meshes) {
    }

    /**
     * The hover outline of a part's meshes (SPEC §9.3): its characteristic
     * edges ({@link EdgeOutline}) — creases past {@link #OUTLINE_CREASE}°,
     * the rest on the silhouette — corners within {@link #OUTLINE_WELD}
     * taken as one.
     */
    public static EdgeOutline outline(Map<ResourceLocation, Mesh> meshes) {
        int quads = 0;
        for (Mesh mesh : meshes.values()) {
            quads += mesh.quads().size();
        }
        float[] corners = new float[quads * 12];
        int n = 0;
        for (Mesh mesh : meshes.values()) {
            for (Mesh.Quad q : mesh.quads()) {
                for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                    corners[n++] = v.x();
                    corners[n++] = v.y();
                    corners[n++] = v.z();
                }
            }
        }
        return quads == 0 ? EdgeOutline.EMPTY : EdgeOutline.of(corners, OUTLINE_CREASE, OUTLINE_WELD);
    }

    /** Faces parting by more than this many degrees make a crease of the hover outline. */
    public static final double OUTLINE_CREASE = 35.0;
    /** Corners closer than this, blocks, are one corner for the hover outline. */
    public static final double OUTLINE_WELD = 1.0e-3;

    /** A model with no geometry — the renderer falls back to the debug box. */
    public static StockModel empty() {
        Bogie none = new Bogie(Map.of(), List.of());
        return new StockModel(Map.of(), Map.of(), List.of(), List.of(), List.of(), none, none,
                Map.of(), List.of(), List.of(), List.of());
    }

    public boolean isEmpty() {
        return body.isEmpty() && interior.isEmpty() && doors.isEmpty() && controls.isEmpty()
                && doorLeaves.isEmpty()
                && frontBogie.meshes().isEmpty() && frontBogie.wheels().isEmpty()
                && rearBogie.meshes().isEmpty() && rearBogie.wheels().isEmpty();
    }

    /** Bitmask of this model's light groups that are on, by {@link #lightGroups} index. */
    public long litMask(java.util.function.ToDoubleFunction<String> groupValue) {
        long mask = 0L;
        for (int i = 0; i < lightGroups.size() && i < 64; i++) {
            if (groupValue.applyAsDouble(lightGroups.get(i)) > 0.0) {
                mask |= 1L << i;
            }
        }
        return mask;
    }
}
