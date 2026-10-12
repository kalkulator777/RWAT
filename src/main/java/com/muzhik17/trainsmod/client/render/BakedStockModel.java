package com.muzhik17.trainsmod.client.render;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.joml.Matrix4f;

import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.kinematics.EdgeOutline;

import net.minecraft.client.renderer.LightTexture;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.resources.ResourceLocation;

/**
 * A {@link StockModel} baked into GPU buffers (SPEC §2.4): one {@link GpuMesh}
 * per texture bucket, with the part split preserved — body, interior, each
 * bogie frame, each wheel, each door piece, door leaf and cab control —
 * because each part is drawn with its own per-frame transform (articulation, wheel spin,
 * door swing, lever travel) or only within some distance (interior). Light
 * and livery are baked per instance; the renderer keeps a bounded LRU set of
 * instances, one per (livery, packed light, lit light groups) it actually
 * sees.
 *
 * <p>Light (SPEC §8) is per vertex: a quad of a lit {@code FULLBRIGHT} group
 * glows at full brightness; a quad inside the car is lit by the cabin lamps
 * of the lit groups — {@code 15 − distance} from each lamp it faces — but
 * never darker than the world; everything else takes the world light.
 */
public final class BakedStockModel implements AutoCloseable {

    public record BakedWheel(float centerY, float centerZ, float radius, List<GpuMesh> meshes) {
    }

    public record BakedBogie(List<GpuMesh> frame, List<BakedWheel> wheels) {
    }

    /** One animated object of a door: its buffers, model-space frames (SPEC v1.5) and hover outline (§9.3). */
    public record BakedPiece(List<GpuMesh> meshes, Matrix4f[] frames, EdgeOutline outline) {
    }

    /** An animated door, by the id the wagon type declares it under. */
    public record BakedDoor(String id, List<BakedPiece> pieces) {
    }

    /** A cab control's buffers (SPEC §9.3); the control says how its value moves them. */
    public record BakedControl(StockModel.Control control, List<GpuMesh> meshes) {
    }

    /** Block light a lamp gives right beside it; it falls off by one per block, like MC's. */
    private static final float LAMP_LEVEL = 15.0F;
    private static final float LAMP_FALLOFF = 1.0F;
    /**
     * An inside part whose own light group is on is never darker than this
     * (IR lights a whole {@code INTERIOR} group at its "interior light level"
     * whether or not a lamp is near).
     */
    private static final int LIT_INTERIOR_MIN = 11;

    private final List<GpuMesh> body;
    private final List<GpuMesh> interior;
    private final List<BakedDoor> doors;
    private final List<BakedControl> controls;
    private final List<BakedControl> doorLeaves;
    private final BakedBogie front;
    private final BakedBogie rear;

    private BakedStockModel(List<GpuMesh> body, List<GpuMesh> interior, List<BakedDoor> doors,
            List<BakedControl> controls, List<BakedControl> doorLeaves, BakedBogie front,
            BakedBogie rear) {
        this.body = body;
        this.interior = interior;
        this.doors = doors;
        this.controls = controls;
        this.doorLeaves = doorLeaves;
        this.front = front;
        this.rear = rear;
    }

    public List<GpuMesh> body() {
        return body;
    }

    public List<GpuMesh> interior() {
        return interior;
    }

    public List<BakedDoor> doors() {
        return doors;
    }

    public List<BakedControl> controls() {
        return controls;
    }

    /** Door leaves moved by name (SPEC §9.5), baked like controls. */
    public List<BakedControl> doorLeaves() {
        return doorLeaves;
    }

    public BakedBogie front() {
        return front;
    }

    public BakedBogie rear() {
        return rear;
    }

    /**
     * Bake every part of the model at one world light value and one set of lit
     * light groups (render thread only), each texture bucket bound to its
     * livery replacement if the livery has one.
     *
     * @param litMask bit {@code i} = {@code model.lightGroups().get(i)} is on
     */
    public static BakedStockModel bake(StockModel model, String livery, int packedLight,
            long litMask) {
        Map<ResourceLocation, ResourceLocation> swaps = model.livery(livery);
        Mesh.VertexLight light = light(model, packedLight, litMask);
        return new BakedStockModel(
                bakeBuckets(model.body(), swaps, light),
                bakeBuckets(model.interior(), swaps, light),
                bakeDoors(model.doors(), swaps, light),
                bakeControls(model.controls(), swaps, light),
                bakeControls(model.doorLeaves(), swaps, light),
                bakeBogie(model.frontBogie(), swaps, light),
                bakeBogie(model.rearBogie(), swaps, light));
    }

    /** The per-vertex light of a bake (SPEC §8). */
    private static Mesh.VertexLight light(StockModel model, int packedLight, long litMask) {
        int worldBlock = LightTexture.block(packedLight);
        int sky = LightTexture.sky(packedLight);
        List<StockModel.Lamp> lit = new ArrayList<>();
        for (StockModel.Lamp lamp : model.lamps()) {
            if (StockModel.tagLit(StockModel.tag(lamp.group(), false, false, false), litMask)) {
                lit.add(lamp);
            }
        }
        return (quad, vertex) -> {
            int tag = quad.tag();
            if (tag == 0) {
                return packedLight;
            }
            boolean groupLit = StockModel.tagLit(tag, litMask);
            if ((tag & StockModel.TAG_FULLBRIGHT) != 0 && groupLit) {
                return LightTexture.FULL_BRIGHT;
            }
            if ((tag & StockModel.TAG_INTERIOR) == 0) {
                return packedLight;
            }
            float field = lampField(vertex, lit);
            if (groupLit && StockModel.tagGroup(tag) >= 0) {
                field = Math.max(field, LIT_INTERIOR_MIN);
            }
            int block = Math.max(worldBlock, Math.min(15, Math.round(field)));
            return block == worldBlock ? packedLight : LightTexture.pack(block, sky);
        };
    }

    /**
     * Block light the lit cabin lamps give a vertex: the brightest lamp the
     * surface faces (normal · direction to the lamp ≥ 0 — outer walls and the
     * roof stay dark), {@code 15 − distance}.
     */
    static float lampField(Mesh.Vertex v, List<StockModel.Lamp> lamps) {
        float best = 0.0F;
        for (StockModel.Lamp lamp : lamps) {
            float dx = lamp.x() - v.x();
            float dy = lamp.y() - v.y();
            float dz = lamp.z() - v.z();
            float dist = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dx * v.nx() + dy * v.ny() + dz * v.nz() < -0.05F * dist) {
                continue; // the surface faces away from this lamp
            }
            best = Math.max(best, LAMP_LEVEL - dist * LAMP_FALLOFF);
        }
        return best;
    }

    /** The cabin-lamp light at a model-space point (passengers, SPEC §8), 0..15. */
    public static int lampLevelAt(StockModel model, long litMask, float x, float y, float z) {
        float best = 0.0F;
        for (StockModel.Lamp lamp : model.lamps()) {
            if (!StockModel.tagLit(StockModel.tag(lamp.group(), false, false, false), litMask)) {
                continue;
            }
            float dx = lamp.x() - x;
            float dy = lamp.y() - y;
            float dz = lamp.z() - z;
            best = Math.max(best, LAMP_LEVEL - (float) Math.sqrt(dx * dx + dy * dy + dz * dz) * LAMP_FALLOFF);
        }
        return Math.clamp(Math.round(best), 0, 15);
    }

    private static List<BakedDoor> bakeDoors(List<StockModel.Door> doors,
            Map<ResourceLocation, ResourceLocation> swaps, Mesh.VertexLight light) {
        List<BakedDoor> baked = new ArrayList<>(doors.size());
        for (StockModel.Door door : doors) {
            List<BakedPiece> pieces = new ArrayList<>(door.pieces().size());
            for (StockModel.Piece piece : door.pieces()) {
                pieces.add(new BakedPiece(bakeBuckets(piece.meshes(), swaps, light),
                        piece.frames(), piece.outline()));
            }
            baked.add(new BakedDoor(door.id(), List.copyOf(pieces)));
        }
        return List.copyOf(baked);
    }

    private static List<BakedControl> bakeControls(List<StockModel.Control> controls,
            Map<ResourceLocation, ResourceLocation> swaps, Mesh.VertexLight light) {
        List<BakedControl> baked = new ArrayList<>(controls.size());
        for (StockModel.Control control : controls) {
            baked.add(new BakedControl(control, bakeBuckets(control.meshes(), swaps, light)));
        }
        return List.copyOf(baked);
    }

    private static BakedBogie bakeBogie(StockModel.Bogie bogie,
            Map<ResourceLocation, ResourceLocation> swaps, Mesh.VertexLight light) {
        List<BakedWheel> wheels = new ArrayList<>();
        for (StockModel.Wheel wheel : bogie.wheels()) {
            wheels.add(new BakedWheel(wheel.centerY(), wheel.centerZ(), wheel.radius(),
                    bakeBuckets(wheel.meshes(), swaps, light)));
        }
        return new BakedBogie(bakeBuckets(bogie.meshes(), swaps, light), List.copyOf(wheels));
    }

    private static List<GpuMesh> bakeBuckets(Map<ResourceLocation, Mesh> buckets,
            Map<ResourceLocation, ResourceLocation> swaps, Mesh.VertexLight light) {
        List<GpuMesh> baked = new ArrayList<>(buckets.size());
        for (var entry : buckets.entrySet()) {
            ResourceLocation texture = swaps.getOrDefault(entry.getKey(), entry.getKey());
            baked.add(GpuMesh.upload(entry.getValue(),
                    RenderType.entityCutoutNoCull(texture), light));
        }
        return List.copyOf(baked);
    }

    @Override
    public void close() {
        body.forEach(GpuMesh::close);
        interior.forEach(GpuMesh::close);
        for (BakedDoor door : doors) {
            door.pieces().forEach(piece -> piece.meshes().forEach(GpuMesh::close));
        }
        for (BakedControl control : controls) {
            control.meshes().forEach(GpuMesh::close);
        }
        for (BakedControl leaf : doorLeaves) {
            leaf.meshes().forEach(GpuMesh::close);
        }
        closeBogie(front);
        closeBogie(rear);
    }

    private static void closeBogie(BakedBogie bogie) {
        bogie.frame().forEach(GpuMesh::close);
        for (BakedWheel wheel : bogie.wheels()) {
            wheel.meshes().forEach(GpuMesh::close);
        }
    }
}
