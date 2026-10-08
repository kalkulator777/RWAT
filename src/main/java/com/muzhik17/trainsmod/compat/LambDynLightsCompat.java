package com.muzhik17.trainsmod.compat;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.stock.ConsistComposition;

import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Entity;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.common.NeoForge;

/**
 * Optional LambDynamicLights support (SPEC §8): a lit train lights the world
 * around it — the cabin lamps glow out of the windows, a headlight throws a
 * line of light down the track. One {@code DynamicLightBehavior} per lit wagon,
 * re-placed every client tick.
 *
 * <p>No compile-time dependency: LDL loads {@link #INITIALIZER} through the
 * Yumi entrypoint declared in {@code neoforge.mods.toml}, and the LDL
 * interfaces are implemented with {@link Proxy} at runtime. Without LDL this
 * class is never loaded. The API ({@code DynamicLightsInitializer},
 * {@code DynamicLightBehavior}, {@code DynamicLightBehaviorManager}) is the
 * same from LDL 4.8 (MC 1.21.1) to 4.13 (26.3) on both loaders (SPEC §7).
 */
public final class LambDynLightsCompat {

    private static final String API = "dev.lambdaurora.lambdynlights.api.";
    /** Light of a cabin lamp, and of a headlight's beam. */
    private static final int CABIN_LUMINANCE = 12;
    private static final int BEAM_LUMINANCE = 15;
    private static final double BEAM_LENGTH = 12.0;
    /** Wagons farther than this from the player light nothing (LDL's own range is short). */
    private static final double RANGE = 96.0;
    /** A light that moved less than this isn't re-sent (no needless chunk rebuilds). */
    private static final double MOVE_EPS = 0.05;

    /** The entrypoint object LDL calls: a {@code DynamicLightsInitializer} made at runtime. */
    public static final Object INITIALIZER = initializer();

    private static Object manager;
    private static Method add;
    private static Method remove;
    private static Constructor<?> boundingBox;
    private static Class<?> behaviorType;
    /** Wagon entity id → its light. */
    private static final Map<Integer, WagonLight> LIGHTS = new HashMap<>();

    private LambDynLightsCompat() {
    }

    private static Object initializer() {
        try {
            Class<?> type = Class.forName(API + "DynamicLightsInitializer");
            Class<?> context = Class.forName(API + "DynamicLightsContext");
            return Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (proxy, method, args) -> {
                if (method.getName().equals("onInitializeDynamicLights") && args != null
                        && args.length == 1 && context.isInstance(args[0])) {
                    start(context.getMethod("dynamicLightBehaviorManager").invoke(args[0]));
                    return null;
                }
                return objectMethod(proxy, method, args, "RWAT dynamic lights");
            });
        } catch (ReflectiveOperationException | LinkageError e) {
            RailsWheelsAndTrains.LOGGER.warn("LambDynamicLights API not found: {}", e.toString());
            return null;
        }
    }

    private static void start(Object behaviorManager) throws ReflectiveOperationException {
        Class<?> managerType = Class.forName(API + "behavior.DynamicLightBehaviorManager");
        behaviorType = Class.forName(API + "behavior.DynamicLightBehavior");
        Class<?> box = Class.forName(API + "behavior.DynamicLightBehavior$BoundingBox");
        add = managerType.getMethod("add", behaviorType);
        remove = managerType.getMethod("remove", behaviorType);
        boundingBox = box.getConstructor(int.class, int.class, int.class, int.class, int.class, int.class);
        manager = behaviorManager;
        NeoForge.EVENT_BUS.addListener(ClientTickEvent.Post.class, event -> tick());
        RailsWheelsAndTrains.LOGGER.info("LambDynamicLights found: lit trains light the world");
    }

    /** Re-place every lit wagon's light; drop the ones gone dark or out of range. */
    private static void tick() {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null || mc.player == null) {
            clear();
            return;
        }
        Map<Integer, Shape> shapes = new HashMap<>();
        for (Entity entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity wagon && wagon.distanceToSqr(mc.player) < RANGE * RANGE) {
                Shape shape = shape(wagon);
                if (shape != null) {
                    shapes.put(wagon.getId(), shape);
                }
            }
        }
        Iterator<Map.Entry<Integer, WagonLight>> it = LIGHTS.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<Integer, WagonLight> entry = it.next();
            if (!shapes.containsKey(entry.getKey())) {
                entry.getValue().removed = true;
                call(remove, entry.getValue().proxy);
                it.remove();
            }
        }
        shapes.forEach((id, shape) -> {
            WagonLight light = LIGHTS.get(id);
            if (light == null) {
                light = new WagonLight(shape);
                LIGHTS.put(id, light);
                call(add, light.proxy);
            } else {
                light.update(shape);
            }
        });
    }

    private static void clear() {
        for (WagonLight light : LIGHTS.values()) {
            light.removed = true;
            call(remove, light.proxy);
        }
        LIGHTS.clear();
    }

    /** A wagon's lit lamps and beams in world space, or null if it is dark. */
    private static Shape shape(WagonEntity wagon) {
        ConsistComposition.Slot slot = ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
        StockModel model = slot == null ? null : StockModels.model(slot.type().id());
        if (model == null || (model.lamps().isEmpty() && model.headlights().isEmpty())) {
            return null;
        }
        long litMask = model.litMask(wagon::controlValue);
        if (litMask == 0L) {
            return null;
        }
        Vector3d body = new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ());
        double flip = slot.flipped() ? -1.0 : 1.0;
        List<double[]> points = new ArrayList<>();
        for (StockModel.Lamp lamp : model.lamps()) {
            if (StockModel.tagLit(StockModel.tag(lamp.group(), false, false, false), litMask)) {
                Vector3d w = PoseMath.localToWorld(body, wagon.getYRot(), wagon.getXRot(),
                        new Vector3d(lamp.x() * flip, lamp.y(), lamp.z() * flip));
                points.add(new double[]{w.x, w.y, w.z, w.x, w.y, w.z, CABIN_LUMINANCE});
            }
        }
        for (StockModel.Headlight lamp : model.headlights()) {
            if (StockModel.tagLit(StockModel.tag(lamp.group(), false, false, false), litMask)) {
                Vector3d a = PoseMath.localToWorld(body, wagon.getYRot(), wagon.getXRot(),
                        new Vector3d(lamp.x() * flip, lamp.y(), lamp.z() * flip));
                Vector3d b = PoseMath.localToWorld(body, wagon.getYRot(), wagon.getXRot(),
                        new Vector3d(lamp.x() * flip, lamp.y() - 1.0,
                                (lamp.z() + lamp.dirZ() * BEAM_LENGTH) * flip));
                points.add(new double[]{a.x, a.y, a.z, b.x, b.y, b.z, BEAM_LUMINANCE});
            }
        }
        return points.isEmpty() ? null : new Shape(points);
    }

    /** Light segments {x0,y0,z0,x1,y1,z1,luminance} (a point is a zero-length segment). Immutable. */
    private record Shape(List<double[]> segments) {

        double lightAt(double x, double y, double z, double falloff) {
            double best = 0.0;
            for (double[] s : segments) {
                best = Math.max(best, s[6] - distance(s, x, y, z) * falloff);
            }
            return Math.clamp(best, 0.0, 15.0);
        }

        boolean near(Shape other) {
            if (other.segments.size() != segments.size()) {
                return false;
            }
            for (int i = 0; i < segments.size(); i++) {
                double[] a = segments.get(i);
                double[] b = other.segments.get(i);
                for (int k = 0; k < 7; k++) {
                    if (Math.abs(a[k] - b[k]) > MOVE_EPS) {
                        return false;
                    }
                }
            }
            return true;
        }

        int[] bounds() {
            double[] lo = {Double.MAX_VALUE, Double.MAX_VALUE, Double.MAX_VALUE};
            double[] hi = {-Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE};
            for (double[] s : segments) {
                for (int k = 0; k < 3; k++) {
                    lo[k] = Math.min(lo[k], Math.min(s[k], s[k + 3]));
                    hi[k] = Math.max(hi[k], Math.max(s[k], s[k + 3]));
                }
            }
            return new int[]{(int) Math.floor(lo[0]), (int) Math.floor(lo[1]), (int) Math.floor(lo[2]),
                    (int) Math.ceil(hi[0]), (int) Math.ceil(hi[1]), (int) Math.ceil(hi[2])};
        }

        /** Distance from a point to a segment. */
        private static double distance(double[] s, double x, double y, double z) {
            double dx = s[3] - s[0];
            double dy = s[4] - s[1];
            double dz = s[5] - s[2];
            double len2 = dx * dx + dy * dy + dz * dz;
            double t = len2 < 1.0e-9 ? 0.0
                    : Math.clamp(((x - s[0]) * dx + (y - s[1]) * dy + (z - s[2]) * dz) / len2, 0.0, 1.0);
            double px = s[0] + dx * t - x;
            double py = s[1] + dy * t - y;
            double pz = s[2] + dz * t - z;
            return Math.sqrt(px * px + py * py + pz * pz);
        }
    }

    /** One wagon's {@code DynamicLightBehavior}: LDL may read it from its own threads. */
    private static final class WagonLight implements InvocationHandler {
        final Object proxy;
        volatile Shape shape;
        volatile boolean changed = true;
        volatile boolean removed;

        WagonLight(Shape shape) {
            this.shape = shape;
            this.proxy = Proxy.newProxyInstance(behaviorType.getClassLoader(),
                    new Class<?>[]{behaviorType}, this);
        }

        void update(Shape next) {
            if (!next.near(shape)) {
                shape = next;
                changed = true;
            }
        }

        @Override
        public Object invoke(Object self, Method method, Object[] args) throws Throwable {
            switch (method.getName()) {
                case "lightAtPos" -> {
                    BlockPos pos = (BlockPos) args[0];
                    return shape.lightAt(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5,
                            (Double) args[1]);
                }
                case "getBoundingBox" -> {
                    int[] b = shape.bounds();
                    return boundingBox.newInstance(b[0], b[1], b[2], b[3], b[4], b[5]);
                }
                case "hasChanged" -> {
                    boolean was = changed;
                    changed = false;
                    return was;
                }
                case "isRemoved" -> {
                    return removed;
                }
                default -> {
                    return objectMethod(self, method, args, "RWAT wagon light");
                }
            }
        }
    }

    /** equals/hashCode/toString of a proxy, and a no-op for anything else. */
    private static Object objectMethod(Object proxy, Method method, Object[] args, String name) {
        return switch (method.getName()) {
            case "equals" -> args != null && args.length == 1 && proxy == args[0];
            case "hashCode" -> System.identityHashCode(proxy);
            case "toString" -> name;
            default -> method.getReturnType() == boolean.class ? Boolean.FALSE : null;
        };
    }

    private static void call(Method method, Object behavior) {
        try {
            method.invoke(manager, behavior);
        } catch (ReflectiveOperationException e) {
            RailsWheelsAndTrains.LOGGER.warn("LambDynamicLights call failed: {}", e.toString());
        }
    }
}
