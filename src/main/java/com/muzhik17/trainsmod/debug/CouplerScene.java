package com.muzhik17.trainsmod.debug;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.joml.Matrix3d;
import org.joml.Matrix4d;
import org.joml.Vector3d;
import org.joml.Vector3f;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientWagonRay;
import com.muzhik17.trainsmod.client.render.WagonRenderer;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.CouplerAim;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.rail.RailNetwork;
import com.muzhik17.trainsmod.stock.ConsistComposition;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.world.entity.player.ChatVisiblity;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;

/**
 * Dev tool (SPEC §6.12): {@code -Pautoscene=couplers} on a throwaway save
 * copy — three coupled platzkarts standing on a half circle of radius 80.
 * At each of the two couplings the heads are shot from the outside of the
 * curve, close in ({@code rwat-couplers-<n>-close.png}) and from further
 * up ({@code -angle.png}), each once more with the heads drawn
 * straight, as before they turned ({@code …-straight.png}); then the free
 * head at the tail ({@code rwat-couplers-tail.png}). The log has the angle
 * between the cars at each coupling. Quits the game at the end.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class CouplerScene {

    /** Radius of the half circle, blocks. */
    private static final double RADIUS = 80.0;
    /** Ticks per view: placed, shot turned, shot straight. */
    private static final int VIEW_TICKS = 50;

    private static int ticks;
    private static Vec3 origin;

    private CouplerScene() {
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (!"couplers".equals(System.getProperty("rwat.autoscene")) || mc.player == null || mc.level == null) {
            return;
        }
        ticks++;
        switch (ticks) {
            case 100 -> {
                origin = mc.player.position().add(4000.0, 0.0, 0.0);
                mc.options.chatVisibility().set(ChatVisiblity.HIDDEN);
                mc.options.hideGui = true;
                command(mc, "gamemode creative");
                command(mc, "gamerule doDaylightCycle false");
                command(mc, "time set noon");
                command(mc, "effect give @s minecraft:night_vision infinite 0 true");
                command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0", origin.x, origin.y, origin.z));
            }
            case 140 -> layHalfCircle(mc);
            case 170 -> command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0",
                    origin.x + RADIUS, origin.y, origin.z + RADIUS));
            case 180 -> command(mc, "rwat spawn with amendorf amendorf amendorf");
            case 200 -> command(mc, "gamemode spectator");
            default -> {
            }
        }
        // four views of the two couplings, then the tail
        int view = (ticks - 220) / VIEW_TICKS;
        int step = (ticks - 220) % VIEW_TICKS;
        if (ticks < 220 || view > 4) {
            if (ticks == 220 + 5 * VIEW_TICKS) {
                mc.stop();
            }
            return;
        }
        String name = view == 4 ? "rwat-couplers-tail"
                : "rwat-couplers-" + (view / 2 + 1) + (view % 2 == 0 ? "-close" : "-angle");
        switch (step) {
            case 0 -> look(mc, view == 4 ? 2 : view / 2, view % 2 == 0 && view < 4);
            case 30 -> shot(mc, name + ".png");
            case 31 -> straight(true);
            case 40 -> shot(mc, name + "-straight.png");
            case 41 -> straight(false);
            default -> {
            }
        }
    }

    /** Lead-in straight, two quarter circles (a half circle), lead-out straight — on the server. */
    private static void layHalfCircle(Minecraft mc) {
        var server = mc.getSingleplayerServer();
        if (server == null) {
            return;
        }
        Vector3d o = new Vector3d(origin.x, origin.y, origin.z);
        UUID playerId = mc.player.getUUID();
        server.execute(() -> {
            var level = server.overworld();
            var player = server.getPlayerList().getPlayer(playerId);
            RailNetwork network = RailNetwork.get(level);
            Vector3d a0 = new Vector3d(o).add(0.0, 0.0, -60.0);
            Vector3d a = new Vector3d(o);
            Vector3d b = new Vector3d(o).add(RADIUS, 0.0, RADIUS);
            Vector3d c = new Vector3d(o).add(2.0 * RADIUS, 0.0, 0.0);
            Vector3d d = new Vector3d(o).add(2.0 * RADIUS, 0.0, -60.0);
            Vector3d north = new Vector3d(0.0, 0.0, 1.0);
            Vector3d east = new Vector3d(1.0, 0.0, 0.0);
            Vector3d south = new Vector3d(0.0, 0.0, -1.0);
            network.build(level, player, List.of(new RailNetwork.SegmentSpec(a0, north, a, north),
                    new RailNetwork.SegmentSpec(a, north, b, east), new RailNetwork.SegmentSpec(b, east, c, south),
                    new RailNetwork.SegmentSpec(c, south, d, south)), RailSegment.Look.DEFAULT, List.of());
            RailsWheelsAndTrains.LOGGER.info("[couplers] laid the half circle, {} segments",
                    network.graph().segments().size());
        });
    }

    /**
     * The camera on the rear coupler of car {@code n} (the coupling with car
     * n+1; for the last car, its free end), from the outside of the curve,
     * looking down at it — {@code close} in or from further up. Logs the
     * angle between the two cars and how their heads turn.
     */
    private static void look(Minecraft mc, int n, boolean close) {
        WagonEntity car = carAt(mc, n);
        WagonEntity next = carAt(mc, n + 1);
        ConsistComposition.Slot slot = car == null ? null : ClientConsists.slot(car.getConsistId(), n);
        if (slot == null) {
            RailsWheelsAndTrains.LOGGER.warn("[couplers] no car {}", n);
            return;
        }
        Vector3d point = PoseMath.localToWorld(new Vector3d(car.getX(), car.getY(), car.getZ()),
                car.getYRot(), car.getXRot(), new Vector3d(0.0, 1.1, -slot.rearCouplerReach()));
        RailsWheelsAndTrains.LOGGER.info("[couplers] car {} rear coupler at ({}, {}), cars turned {}° to each other",
                n, String.format(Locale.ROOT, "%.2f", point.x), String.format(Locale.ROOT, "%.2f", point.z),
                next == null ? "-" : String.format(Locale.ROOT, "%.1f", wrap(next.getYRot() - car.getYRot())));
        if (next != null) {
            tips(car.getConsistId(), n);
        }
        double feetBelowEye = 1.62;
        // from the outside of the curve (away from its centre), looking down at it: close in
        // (1.5 out, 0.7 above) or further (2 out, 1.6 above) — the gangway plates hide it from above
        Vector3d centre = new Vector3d(origin.x + RADIUS, point.y, origin.z);
        Vector3d out = new Vector3d(point).sub(centre).normalize();
        double away = close ? 1.5 : 2.0;
        Vector3d eye = new Vector3d(point).add(out.x * away, close ? 0.7 : 1.6, out.z * away);
        float yaw = (float) Math.toDegrees(Math.atan2(out.x, -out.z));
        command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f %.1f %d", eye.x, eye.y - feetBelowEye, eye.z,
                yaw, close ? 25 : 38));
    }

    /**
     * The two heads of the coupling behind car {@code n} (both cars facing
     * ahead, as spawned), worked out as the renderer turns them: each head's
     * turn and how far apart the heads' tips (0.6 out of the pivot) are,
     * turned and straight.
     */
    private static void tips(int consistId, int n) {
        Matrix4d ahead = ClientWagonRay.drawnAt(consistId, n, 1.0F);
        Matrix4d behind = ClientWagonRay.drawnAt(consistId, n + 1, 1.0F);
        ConsistComposition.Slot slot = ClientConsists.slot(consistId, n);
        StockModel model = slot == null ? null : StockModels.model(slot.type().id());
        if (ahead == null || behind == null || model == null || model.couplers().isEmpty()) {
            return;
        }
        Vector3f rearPivot = null;
        Vector3f frontPivot = null;
        for (StockModel.Coupler coupler : model.couplers()) {
            if (coupler.front()) {
                frontPivot = coupler.pivot();
            } else {
                rearPivot = coupler.pivot();
            }
        }
        Vector3d a = ahead.transformPosition(new Vector3d(rearPivot));
        Vector3d b = behind.transformPosition(new Vector3d(frontPivot));
        Vector3d meet = new Vector3d(a).add(b).mul(0.5);
        Vector3d inAhead = ahead.invertAffine(new Matrix4d()).transformPosition(new Vector3d(meet));
        Vector3d inBehind = behind.invertAffine(new Matrix4d()).transformPosition(new Vector3d(meet));
        double[] turnA = CouplerAim.angles(rearPivot.x, rearPivot.y, rearPivot.z, inAhead.x, inAhead.y, inAhead.z,
                false, CouplerAim.LIMIT_DEGREES);
        double[] turnB = CouplerAim.angles(frontPivot.x, frontPivot.y, frontPivot.z, inBehind.x, inBehind.y,
                inBehind.z, true, CouplerAim.LIMIT_DEGREES);
        double[] none = {0.0, 0.0};
        double turned = kink(ahead, turnA, behind, turnB);
        double straight = kink(ahead, none, behind, none);
        RailsWheelsAndTrains.LOGGER.info("[couplers] coupling {}: pivots {} apart; heads turned {}° and {}°;"
                + " the heads' axes meet at {}° turned, {}° straight", n, f(a.distance(b)),
                f(Math.toDegrees(turnA[0])), f(Math.toDegrees(turnB[0])), f(turned), f(straight));
    }

    /** The angle between the two heads' outward axes, world, degrees (0: in one line, facing). */
    private static double kink(Matrix4d ahead, double[] turnA, Matrix4d behind, double[] turnB) {
        Vector3d rear = ahead.transformDirection(new Matrix3d().rotateY(turnA[0]).rotateX(turnA[1])
                .transform(new Vector3d(0.0, 0.0, -1.0))).normalize();
        Vector3d front = behind.transformDirection(new Matrix3d().rotateY(turnB[0]).rotateX(turnB[1])
                .transform(new Vector3d(0.0, 0.0, 1.0))).normalize();
        return Math.toDegrees(rear.angle(front.negate()));
    }

    private static String f(double value) {
        return String.format(Locale.ROOT, "%.3f", value);
    }

    /** Heads drawn straight (as before they turned) or turned — the renderer's debug switch. */
    private static void straight(boolean on) {
        try {
            var field = WagonRenderer.class.getDeclaredField("debugStraightCouplers");
            field.setAccessible(true);
            field.setBoolean(null, on);
        } catch (ReflectiveOperationException e) {
            RailsWheelsAndTrains.LOGGER.warn("[couplers] no debug switch", e);
        }
    }

    private static double wrap(double degrees) {
        double w = degrees % 360.0;
        return w > 180.0 ? w - 360.0 : w < -180.0 ? w + 360.0 : w;
    }

    private static WagonEntity carAt(Minecraft mc, int index) {
        for (var entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity car && car.getWagonIndex() == index) {
                return car;
            }
        }
        return null;
    }

    private static void command(Minecraft mc, String command) {
        RailsWheelsAndTrains.LOGGER.info("[couplers] /{}", command);
        var server = mc.getSingleplayerServer();
        if (server == null) {
            mc.player.connection.sendCommand(command);
            return;
        }
        UUID id = mc.player.getUUID();
        server.execute(() -> {
            var player = server.getPlayerList().getPlayer(id);
            if (player != null) {
                server.getCommands().performPrefixedCommand(
                        player.createCommandSourceStack().withPermission(4), command);
            }
        });
    }

    private static void shot(Minecraft mc, String name) {
        Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(),
                message -> RailsWheelsAndTrains.LOGGER.info("[couplers] {}", message.getString()));
    }
}
