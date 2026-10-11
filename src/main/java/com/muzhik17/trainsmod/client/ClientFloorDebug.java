package com.muzhik17.trainsmod.client;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RegisterClientCommandsEvent;

/**
 * Debug view of the walkable floor (SPEC §2.4a, §9.6): {@code /rwatc floors}
 * toggles wireframes of every wagon's floor zones (green: the zone, a player
 * high; bright green at the floor: where a player's centre can stand), its
 * doors — way in/out cyan, between zones yellow, gangway magenta, opening
 * without a leaf grey — and the driver's chair (red). The way to check a
 * pack's measured {@code interior}/{@code doors}/{@code cab.seats} against the
 * model in game. Client-only, nothing is sent to the server.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientFloorDebug {

    /** How high the zone frames are drawn above their floor: a player's height. */
    private static final double ZONE_HEIGHT = 1.8;

    private static boolean shown;

    private ClientFloorDebug() {
    }

    /** True while the floor wireframes are on. */
    public static boolean shown() {
        return shown;
    }

    /** Turn the floor wireframes on or off (the debug scenes). */
    public static void setShown(boolean on) {
        shown = on;
    }

    @SubscribeEvent
    static void onRegisterCommands(RegisterClientCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("rwatc")
                .then(Commands.literal("floors").executes(context -> {
                    shown = !shown;
                    context.getSource().sendSuccess(() -> Component.translatable(shown
                            ? "commands.railswheelsandtrains.floors.on"
                            : "commands.railswheelsandtrains.floors.off"), false);
                    return 1;
                })));
    }

    /** A type's floor, doors and chair, in the model frame the pose stack is in (the wagon's body). */
    public static void draw(PoseStack pose, MultiBufferSource buffers, WagonType type) {
        VertexConsumer lines = buffers.getBuffer(RenderType.lines());
        double m = RiderWalk.PLAYER_HALF_WIDTH;
        if (type.interior() != null) {
            WagonType.Interior interior = type.interior();
            for (WagonType.Interior.Zone zone : interior.zones()) {
                LevelRenderer.renderLineBox(pose, lines, zone.minX(), zone.minY(), zone.minZ(),
                        zone.maxX(), zone.minY() + ZONE_HEIGHT, zone.maxZ(), 0.2F, 0.8F, 0.2F, 0.6F);
            }
            // where a centre fits: the zones' union shrunk by a half-width (SPEC §9.8)
            for (FloorRegion.Piece p : interior.region(m).pieces()) {
                double y = interior.floorAt((p.minX() + p.maxX()) * 0.5, (p.minZ() + p.maxZ()) * 0.5, m);
                y = Double.isNaN(y) ? interior.floorY() : y;
                LevelRenderer.renderLineBox(pose, lines, p.minX(), y, p.minZ(),
                        p.maxX(), y + 0.02, p.maxZ(), 0.4F, 1.0F, 0.4F, 1.0F);
            }
        }
        for (WagonType.Door door : type.doors()) {
            float r = 0.2F;
            float g = 0.9F;
            float b = 1.0F; // a way in and out
            if (door.connecting()) {
                r = 1.0F;
                g = 0.3F;
                b = 1.0F;
            } else if (door.inner()) {
                r = 1.0F;
                g = 0.9F;
                b = 0.2F;
            } else if (door.fixed()) {
                r = 0.7F;
                g = 0.7F;
                b = 0.7F;
            }
            LevelRenderer.renderLineBox(pose, lines, door.minX(), door.minY(), door.minZ(),
                    door.maxX(), door.maxY(), door.maxZ(), r, g, b, 1.0F);
        }
        if (type.cab() != null) {
            for (WagonType.Seat seat : type.cab().seats()) {
                double[] box = ClientCabInteract.seatBox(seat);
                LevelRenderer.renderLineBox(pose, lines, box[0], box[1], box[2], box[3], box[4], box[5],
                        1.0F, 0.2F, 0.2F, 1.0F);
            }
        }
    }
}
