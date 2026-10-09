package com.muzhik17.trainsmod.client.gui;

import java.util.Map;

import com.mojang.blaze3d.platform.Lighting;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.RailStyle;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.consist.Handles;
import com.muzhik17.trainsmod.convention.ControlValue;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.Util;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.LightTexture;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.resources.ResourceLocation;

/**
 * Turntable 3D previews for the item pickers (SPEC §6.11): the chosen wagon
 * (body, bogies, wheels, doors at rest, in the chosen livery) or a straight
 * run of the chosen rail style, slowly spinning inside a panel. Drawn the way
 * the inventory draws the player: entity render types through the GUI's
 * buffer source, inventory lighting, full brightness. The meshes are emitted
 * from the CPU every frame — a few milliseconds for the biggest MVP models,
 * fine for a menu, and it needs no baking or GPU buffers to manage.
 */
final class ModelPreview {

    /** One full turn of the turntable, ms. */
    private static final long TURN_MS = 16_000;
    /** Camera tilt: looking slightly down onto the model, degrees. */
    private static final float TILT = -22.0F;
    /** Panel-relative depth the model is drawn at, clear of the GUI drawn before it. */
    private static final float DEPTH = 300.0F;
    /** Typical stock height, blocks — the vertical framing of the panel. */
    private static final float STOCK_HEIGHT = 5.0F;
    /** Tiles of rail shown. */
    private static final int RAIL_TILES = 7;
    /** Gauges read nothing on the turntable. */
    private static final ControlValue.Readings STILL = new ControlValue.Readings(0.0, 0.0);

    private ModelPreview() {
    }

    /** Draw the panel frame (background + border). */
    static void panel(GuiGraphics graphics, int x0, int y0, int x1, int y1) {
        graphics.fill(x0, y0, x1, y1, 0x80000000);
        graphics.renderOutline(x0, y0, x1 - x0, y1 - y0, 0x40FFFFFF);
    }

    /**
     * A wagon on the turntable, sized so its length fits the panel. Bogies sit
     * rigidly at the type's pivots (there is no track to articulate on).
     */
    static void stock(GuiGraphics graphics, int x0, int y0, int x1, int y1,
            StockModel model, WagonType type, String livery) {
        float length = (float) Math.max(type.length(), 4.0);
        float scale = Math.min((x1 - x0) * 0.85F / length, (y1 - y0) * 0.75F / STOCK_HEIGHT);
        Map<ResourceLocation, ResourceLocation> swaps = model.livery(livery);
        begin(graphics, x0, y0, x1, y1, scale, STOCK_HEIGHT * 0.4F);
        PoseStack pose = graphics.pose();
        MultiBufferSource buffers = graphics.bufferSource();
        draw(model.body(), swaps, pose, buffers);
        for (StockModel.Door door : model.doors()) {
            for (StockModel.Piece piece : door.pieces()) {
                draw(piece.meshes(), swaps, pose, buffers);
            }
        }
        for (StockModel.Control leaf : model.doorLeaves()) {
            draw(leaf.meshes(), swaps, pose, buffers); // shut: at rest
        }
        // cab controls at rest (SPEC §9.3): levers shut, the reverser in neutral, switches off
        for (StockModel.Control control : model.controls()) {
            float rest = ControlValue.position(control.role(), Handles.REST, false, 0.0F, STILL);
            if (ControlValue.visible(control.role(), rest)) {
                pose.pushPose();
                pose.mulPose(control.transform(ControlValue.value(control.role(), rest),
                        new org.joml.Matrix4f()));
                draw(control.meshes(), swaps, pose, buffers);
                pose.popPose();
            }
        }
        double[] pivots = type.bogieOffsets();
        bogie(model.frontBogie(), pivots[0], swaps, pose, buffers);
        bogie(model.rearBogie(), pivots[pivots.length - 1], swaps, pose, buffers);
        end(graphics);
    }

    /** A straight run of rail in the given style. */
    static void rail(GuiGraphics graphics, int x0, int y0, int x1, int y1, RailStyle style) {
        float length = (float) (style.tileLength() * RAIL_TILES);
        float scale = Math.min((x1 - x0) * 0.8F / length, (y1 - y0) * 0.5F / 3.0F);
        begin(graphics, x0, y0, x1, y1, scale, 0.2F);
        PoseStack pose = graphics.pose();
        MultiBufferSource buffers = graphics.bufferSource();
        // the tile runs along X; turn it so the track lies along the turntable's Z like a wagon
        pose.mulPose(Axis.YP.rotationDegrees(90.0F));
        for (int i = 0; i < RAIL_TILES; i++) {
            pose.pushPose();
            pose.translate((i - (RAIL_TILES - 1) / 2.0) * style.tileLength(), 0.0, 0.0);
            for (RailStyle.Part part : style.parts()) {
                part.full().emit(pose.last(), buffers.getBuffer(RenderType.entityCutoutNoCull(part.texture())),
                        LightTexture.FULL_BRIGHT);
            }
            pose.popPose();
        }
        end(graphics);
    }

    /** Clip to the panel, centre, scale, tilt and spin; {@code centreY} is the model height put at the middle. */
    private static void begin(GuiGraphics graphics, int x0, int y0, int x1, int y1, float scale,
            float centreY) {
        graphics.enableScissor(x0 + 1, y0 + 1, x1 - 1, y1 - 1);
        PoseStack pose = graphics.pose();
        pose.pushPose();
        pose.translate((x0 + x1) / 2.0F, (y0 + y1) / 2.0F, DEPTH);
        // the inventory's entity transform: GUI y grows down, so flip into a y-up model frame
        pose.scale(scale, scale, -scale);
        pose.mulPose(Axis.ZP.rotationDegrees(180.0F));
        pose.mulPose(Axis.XP.rotationDegrees(TILT));
        pose.mulPose(Axis.YP.rotationDegrees((Util.getMillis() % TURN_MS) * 360.0F / TURN_MS));
        pose.translate(0.0F, -centreY, 0.0F);
        Lighting.setupForEntityInInventory();
    }

    private static void end(GuiGraphics graphics) {
        graphics.flush();
        graphics.pose().popPose();
        Lighting.setupFor3DItems();
        graphics.disableScissor();
    }

    private static void bogie(StockModel.Bogie bogie, double pivotZ,
            Map<ResourceLocation, ResourceLocation> swaps, PoseStack pose, MultiBufferSource buffers) {
        pose.pushPose();
        pose.translate(0.0, 0.0, pivotZ);
        draw(bogie.meshes(), swaps, pose, buffers);
        for (StockModel.Wheel wheel : bogie.wheels()) {
            pose.pushPose();
            pose.translate(0.0F, wheel.centerY(), wheel.centerZ());
            draw(wheel.meshes(), swaps, pose, buffers);
            pose.popPose();
        }
        pose.popPose();
    }

    private static void draw(Map<ResourceLocation, Mesh> meshes, Map<ResourceLocation, ResourceLocation> swaps,
            PoseStack pose, MultiBufferSource buffers) {
        for (Map.Entry<ResourceLocation, Mesh> entry : meshes.entrySet()) {
            ResourceLocation texture = swaps.getOrDefault(entry.getKey(), entry.getKey());
            entry.getValue().emit(pose.last(), buffers.getBuffer(RenderType.entityCutoutNoCull(texture)),
                    LightTexture.FULL_BRIGHT);
        }
    }
}
