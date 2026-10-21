package com.muzhik17.trainsmod.client;

import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

import org.joml.Matrix4d;
import org.joml.Matrix4f;
import org.joml.Vector3d;
import org.joml.Vector3f;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.HullCollision;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.kinematics.RayGrid;
import com.muzhik17.trainsmod.kinematics.Sway;
import com.muzhik17.trainsmod.kinematics.WagonPose;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.InputEvent;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;

/**
 * Picking on a wagon's model (SPEC §9.3, §9.5): the look ray in the wagon's
 * model frame, the nearest wall of the model it hits — body and interior
 * meshes, not the doors and controls, which are what gets picked — and where
 * a door's leaves are now, so a click takes the leaf where it is drawn (an
 * open door is closed by clicking its leaf, not the empty doorway) and never
 * reaches through a wall. Client thread only; a model's triangle grid is
 * built the first time it is asked for.
 *
 * <p><b>Picking runs in the frame</b> (SPEC §9.3): once per frame, before the
 * entities are drawn, the frame's crosshair ray ({@link Look}: the camera, or
 * the eye at the frame's partial tick) goes into each wagon's model frame
 * <b>as the wagon is drawn in that frame</b> ({@link #drawn}: the render pose
 * of the tick window, the body's sway, the turn of a flipped car) — the
 * doors first, then the cab's controls (a nearer door keeps the click), then
 * the crowbar's couplers. Clicks and drags in the tick use what the last
 * frame picked, as vanilla clicks what its last pick hit; a click a pick
 * took keeps the use button till it is released ({@link #onUseHeld}).
 * Picking against the wagon's <i>tick</i> pose (its entity position) put the
 * hit boxes up to a tick's travel ahead of the model, which is drawn a tick
 * behind the clock (SPEC §2.1): on a fast train they ran off the parts in the
 * direction of travel (play-test, 2026-10-12).
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientWagonRay {

    /** Grid cube size for the model's walls, blocks. */
    private static final double CELL = 0.25;
    /**
     * How far behind the wall the ray hits a pick may still be: a leaf or a
     * control flush with the wall, or a static leaf that is itself part of
     * the body (a door the asset doesn't move).
     */
    static final double WALL_SLACK = 0.05;
    /** Click padding around a moving leaf's box, in its own frame. */
    private static final float LEAF_PAD = 0.05F;

    /** A model's walls and its door pieces' rest boxes, for the model they were built from. */
    private record Built(StockModel model, RayGrid walls, Map<StockModel.Piece, float[]> boxes) {
    }

    private static final Map<String, Built> BUILT = new HashMap<>();

    /**
     * The crosshair ray of one frame: from {@code eye} along the unit
     * {@code dir}, at the frame's {@code partialTick}.
     */
    public record Look(Vec3 eye, Vec3 dir, float partialTick) {

        /** The point {@code t} blocks along the ray. */
        public Vec3 at(double t) {
            return eye.add(dir.scale(t));
        }
    }

    /** A ray in a wagon's model (or pose) frame: origin and unit direction. */
    public record LocalRay(Vector3d origin, Vector3d dir) {
    }

    /** Model → world of each wagon as drawn this frame, by entity id (render thread only). */
    private static final Map<Integer, Matrix4d> DRAWN = new HashMap<>();
    /** The partial tick {@link #DRAWN} holds the wagons at. */
    private static float drawnAt = Float.NaN;

    private ClientWagonRay() {
    }

    /** Forget the wagons as drawn (logout, another level): entity ids don't outlive their level. */
    public static void clear() {
        DRAWN.clear();
        drawnAt = Float.NaN;
    }

    /**
     * Every frame, before the terrain and the entities: the frame's look,
     * then the picks in their order — a door nearer than a control keeps the
     * click, so the doors go first.
     */
    @SubscribeEvent
    static void onRenderStage(RenderLevelStageEvent event) {
        if (event.getStage() != RenderLevelStageEvent.Stage.AFTER_SKY) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null || mc.level == null) {
            return;
        }
        float partialTick = event.getPartialTick().getGameTimeDeltaPartialTick(true);
        DRAWN.clear();
        drawnAt = partialTick;
        Look look = look(event.getCamera(), player, partialTick);
        ClientDoorInteract.frame(mc, player, look);
        ClientCabInteract.frame(mc, player, look);
        ClientCouplerInteract.frame(mc, player, look);
        ClientBogieHit.frame(mc, player, look);
    }

    /**
     * The use button held since a click one of the picks took — a door, a
     * control or a chair, a coupler; worked or refused: vanilla repeats the
     * use every 4 ticks while it is held, and a repeat is no new click. It
     * goes nowhere, wherever the crosshair has gone since: not to another
     * pick, not to the item in hand (rails opened their style picker, blocks
     * were set), not to the wagon's own hitbox ({@code WagonEntity.interact}
     * boarded an outsider or let a rider off). First of the use listeners, so
     * no pick sees it.
     */
    @SubscribeEvent(priority = EventPriority.HIGHEST)
    static void onUseHeld(InputEvent.InteractionKeyMappingTriggered event) {
        if (event.isUseItem() && (ClientCabInteract.holdsUse() || ClientDoorInteract.holdsUse()
                || ClientCouplerInteract.holdsUse())) {
            event.setCanceled(true);
            event.setSwingHand(false);
        }
    }

    /**
     * Where the crosshair points this frame: in first person the camera — its
     * place, and its direction after the view's sway (SPEC §10), which is
     * where the crosshair is; otherwise the player's eye and view at the
     * frame's partial tick, as vanilla picks.
     */
    public static Look look(Camera camera, LocalPlayer player, float partialTick) {
        if (camera.isInitialized() && camera.getEntity() == player && !camera.isDetached()) {
            Vector3f f = camera.getLookVector();
            return new Look(camera.getPosition(), new Vec3(f.x, f.y, f.z), partialTick);
        }
        return new Look(player.getEyePosition(partialTick), player.getViewVector(partialTick), partialTick);
    }

    /**
     * A wagon's model frame → world as {@code WagonRenderer} draws it at
     * {@code partialTick}: the render pose (the tick window behind the clock,
     * SPEC §2.1), the body's sway (SPEC §10), the 180° turn of a flipped car
     * ({@link PoseMath#drawnBody}); without a pose yet, at the entity, as the
     * renderer falls back to. A fresh matrix.
     */
    public static Matrix4d drawn(WagonEntity wagon, float partialTick) {
        Matrix4d cached = partialTick == drawnAt ? DRAWN.get(wagon.getId()) : null;
        if (cached != null) {
            return new Matrix4d(cached);
        }
        ConsistComposition.Slot slot = ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
        Matrix4d m = bodyAt(wagon, partialTick, slot != null ? slot.flipped() : wagon.isFlipped());
        if (partialTick == drawnAt) {
            DRAWN.put(wagon.getId(), new Matrix4d(m));
        }
        return m;
    }

    /**
     * Wagon {@code index} of a consist as drawn at {@code partialTick}, model
     * frame → world, without its entity — the next car a coupler head turns
     * to (SPEC §6.12); null if its pose or slot isn't known yet.
     */
    public static Matrix4d drawnAt(int consistId, int index, float partialTick) {
        WagonPose pose = ClientConsists.renderPose(consistId, index, partialTick);
        ConsistComposition.Slot slot = ClientConsists.slot(consistId, index);
        if (pose == null || slot == null) {
            return null;
        }
        int entityId = ClientConsists.entityIdAt(consistId, index);
        return PoseMath.drawnBody(new Vector3d(pose.body()), pose.yaw(), pose.pitch(),
                entityId >= 0 ? ClientRide.sway(entityId, partialTick) : Sway.ZERO, slot.flipped());
    }

    /**
     * The wagon's <b>pose</b> frame as drawn — {@link #drawn} without the
     * flip: +Z is the path-forward end, whichever way the model is turned.
     */
    public static Matrix4d drawnPose(WagonEntity wagon, float partialTick) {
        return bodyAt(wagon, partialTick, false);
    }

    private static Matrix4d bodyAt(WagonEntity wagon, float partialTick, boolean flipped) {
        WagonPose pose = ClientConsists.renderPose(wagon.getConsistId(), wagon.getWagonIndex(), partialTick);
        Vec3 lerped = pose == null ? wagon.getPosition(partialTick) : null;
        Vector3d body = pose != null ? new Vector3d(pose.body()) : new Vector3d(lerped.x, lerped.y, lerped.z);
        return PoseMath.drawnBody(body, pose != null ? pose.yaw() : wagon.getYRot(),
                pose != null ? pose.pitch() : wagon.getXRot(),
                ClientRide.sway(wagon.getId(), partialTick), flipped);
    }

    /** The look ray in the frame {@code toWorld} maps to the world. */
    public static LocalRay into(Matrix4d toWorld, Look look) {
        Matrix4d inverse = toWorld.invertAffine(new Matrix4d());
        Vector3d origin = inverse.transformPosition(new Vector3d(look.eye().x, look.eye().y, look.eye().z));
        Vector3d dir = inverse.transformDirection(new Vector3d(look.dir().x, look.dir().y, look.dir().z))
                .normalize();
        return new LocalRay(origin, dir);
    }

    /** The look ray in the wagon's model frame, the wagon as drawn at the look's partial tick. */
    public static LocalRay inModel(WagonEntity wagon, Look look) {
        return into(drawn(wagon, look.partialTick()), look);
    }

    /**
     * The nearest wall of the model the ray {@code o + t·d} (model frame,
     * {@code d} a unit vector) hits within {@code maxT}, or +∞.
     */
    static double wall(String typeId, StockModel model, Vector3d o, Vector3d d, double maxT) {
        double t = built(typeId, model).walls().nearest(o.x, o.y, o.z, d.x, d.y, d.z, maxT);
        return t < 0.0 ? Double.POSITIVE_INFINITY : t;
    }

    /**
     * Where the ray first hits door {@code index}'s leaves as drawn now — the
     * pieces its IR animation moves (by the type door named like the
     * animation's group), and the leaves moved by name whose centre lies in
     * the door's box — or −1 if it misses them; NaN if the model moves no
     * leaf for this door (the leaf, if any, is drawn in place: the caller
     * takes the door's box).
     */
    static double leaves(WagonEntity wagon, String typeId, StockModel model, WagonType type, int index,
            Vector3d o, Vector3d d, float partialTick) {
        WagonType.Door door = type.doors().get(index);
        float progress = wagon.doorAnim(index, partialTick);
        boolean any = false;
        double best = -1.0;
        Matrix4f frame = new Matrix4f();
        for (StockModel.Door animated : model.doors()) {
            if (!animated.id().equalsIgnoreCase(door.id()) || firstNamed(type, animated.id()) != index) {
                continue;
            }
            for (StockModel.Piece piece : animated.pieces()) {
                float[] box = built(typeId, model).boxes().get(piece);
                if (box == null) {
                    continue;
                }
                Matrix4f[] frames = piece.frames();
                float f = progress * (frames.length - 1);
                int i0 = Math.min((int) f, frames.length - 1);
                int i1 = Math.min(i0 + 1, frames.length - 1);
                frames[i0].lerp(frames[i1], f - i0, frame);
                any = true;
                best = nearer(best, throughBox(frame, box, o, d));
            }
        }
        for (StockModel.Control leaf : model.doorLeaves()) {
            Vector3f lo = leaf.boxMin();
            Vector3f hi = leaf.boxMax();
            if (type.doorHolding((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5, (lo.z + hi.z) * 0.5) != index) {
                continue;
            }
            any = true;
            best = nearer(best, throughBox(leaf.transform(progress, frame),
                    new float[]{lo.x, lo.y, lo.z, hi.x, hi.y, hi.z}, o, d));
        }
        return any ? best : Double.NaN;
    }

    /**
     * The model-frame centre of door {@code index}'s first leaf the model
     * moves, as drawn now — where to aim to click it (the debug scenes); null
     * if the model moves none.
     */
    public static Vector3d leafCentre(WagonEntity wagon, StockModel model, WagonType type, int index,
            float partialTick) {
        String id = type.doors().get(index).id();
        float progress = wagon.doorAnim(index, partialTick);
        for (StockModel.Door animated : model.doors()) {
            if (!animated.id().equalsIgnoreCase(id) || firstNamed(type, id) != index) {
                continue;
            }
            for (StockModel.Piece piece : animated.pieces()) {
                float[] box = built(type.id(), model).boxes().get(piece);
                if (box != null) {
                    Matrix4f[] frames = piece.frames();
                    float f = progress * (frames.length - 1);
                    int i0 = Math.min((int) f, frames.length - 1);
                    Matrix4f frame = frames[i0].lerp(frames[Math.min(i0 + 1, frames.length - 1)], f - i0,
                            new Matrix4f());
                    Vector3f c = frame.transformPosition(new Vector3f((box[0] + box[3]) * 0.5F,
                            (box[1] + box[4]) * 0.5F, (box[2] + box[5]) * 0.5F));
                    return new Vector3d(c);
                }
            }
        }
        return null;
    }

    /** The first type door named like {@code id} (the renderer animates that one), −1 if none. */
    private static int firstNamed(WagonType type, String id) {
        List<WagonType.Door> doors = type.doors();
        for (int i = 0; i < doors.size(); i++) {
            if (doors.get(i).id().equalsIgnoreCase(id)) {
                return i;
            }
        }
        return -1;
    }

    /** t of the ray through a box {@code {minX…maxZ}} moved by {@code m}, padded, or −1. */
    private static double throughBox(Matrix4f m, float[] box, Vector3d o, Vector3d d) {
        Matrix4f inverse = new Matrix4f(m).invert();
        Vector3f lo = inverse.transformPosition(new Vector3f((float) o.x, (float) o.y, (float) o.z));
        Vector3f dir = inverse.transformDirection(new Vector3f((float) d.x, (float) d.y, (float) d.z));
        return HullCollision.rayBox(new Vector3d(lo), new Vector3d(dir),
                box[0] - LEAF_PAD, box[1] - LEAF_PAD, box[2] - LEAF_PAD,
                box[3] + LEAF_PAD, box[4] + LEAF_PAD, box[5] + LEAF_PAD);
    }

    private static double nearer(double best, double t) {
        return t >= 0.0 && (best < 0.0 || t < best) ? t : best;
    }

    private static Built built(String typeId, StockModel model) {
        Built built = BUILT.get(typeId);
        if (built == null || built.model() != model) {
            built = new Built(model, RayGrid.of(triangles(model), CELL), pieceBoxes(model));
            BUILT.put(typeId, built);
        }
        return built;
    }

    /** The body's and the interior's quads as triangles, model frame. */
    private static float[] triangles(StockModel model) {
        int quads = 0;
        for (Map<ResourceLocation, Mesh> part : List.of(model.body(), model.interior())) {
            for (Mesh mesh : part.values()) {
                quads += mesh.quads().size();
            }
        }
        float[] out = new float[quads * 18];
        int n = 0;
        for (Map<ResourceLocation, Mesh> part : List.of(model.body(), model.interior())) {
            for (Mesh mesh : part.values()) {
                for (Mesh.Quad q : mesh.quads()) {
                    n = put(out, n, q.v0(), q.v1(), q.v2());
                    n = put(out, n, q.v0(), q.v2(), q.v3());
                }
            }
        }
        return out;
    }

    private static int put(float[] out, int n, Mesh.Vertex a, Mesh.Vertex b, Mesh.Vertex c) {
        out[n++] = a.x();
        out[n++] = a.y();
        out[n++] = a.z();
        out[n++] = b.x();
        out[n++] = b.y();
        out[n++] = b.z();
        out[n++] = c.x();
        out[n++] = c.y();
        out[n++] = c.z();
        return n;
    }

    /** Each animated door piece's rest box {@code {minX…maxZ}}, model frame. */
    private static Map<StockModel.Piece, float[]> pieceBoxes(StockModel model) {
        Map<StockModel.Piece, float[]> boxes = new IdentityHashMap<>();
        for (StockModel.Door door : model.doors()) {
            for (StockModel.Piece piece : door.pieces()) {
                float[] box = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
                        -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
                for (Mesh mesh : piece.meshes().values()) {
                    for (Mesh.Quad q : mesh.quads()) {
                        for (Mesh.Vertex v : List.of(q.v0(), q.v1(), q.v2(), q.v3())) {
                            box[0] = Math.min(box[0], v.x());
                            box[1] = Math.min(box[1], v.y());
                            box[2] = Math.min(box[2], v.z());
                            box[3] = Math.max(box[3], v.x());
                            box[4] = Math.max(box[4], v.y());
                            box[5] = Math.max(box[5], v.z());
                        }
                    }
                }
                if (box[0] <= box[3]) {
                    boxes.put(piece, box);
                }
            }
        }
        return boxes;
    }
}
