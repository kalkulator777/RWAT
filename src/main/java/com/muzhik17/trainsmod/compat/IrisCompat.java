package com.muzhik17.trainsmod.compat;

import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;

/**
 * What the Iris shader loader is doing, if it is installed (SPEC §8): read
 * through its public {@code net.irisshaders.iris.api.v0.IrisApi} by
 * reflection — no compile dependency, like {@link LambDynLightsCompat}.
 * Without Iris both answers are false.
 */
public final class IrisCompat {

    private static final MethodHandle SHADER_PACK_IN_USE;
    private static final MethodHandle SHADOW_PASS;

    static {
        MethodHandle inUse = null;
        MethodHandle shadow = null;
        try {
            Class<?> api = Class.forName("net.irisshaders.iris.api.v0.IrisApi");
            Object instance = api.getMethod("getInstance").invoke(null);
            MethodHandles.Lookup lookup = MethodHandles.publicLookup();
            inUse = lookup.findVirtual(api, "isShaderPackInUse", MethodType.methodType(boolean.class))
                    .bindTo(instance);
            shadow = lookup.findVirtual(api, "isRenderingShadowPass", MethodType.methodType(boolean.class))
                    .bindTo(instance);
        } catch (ReflectiveOperationException | LinkageError e) {
            // no Iris (or an API we don't know): vanilla rendering
        }
        SHADER_PACK_IN_USE = inUse;
        SHADOW_PASS = shadow;
    }

    private IrisCompat() {
    }

    /** True while a shader pack renders the world. */
    public static boolean shaderPackInUse() {
        return ask(SHADER_PACK_IN_USE);
    }

    /**
     * True during a shader pack's shadow pass — entities are drawn again
     * then, from the light's point of view; screen-facing effects queued
     * there would face the sun.
     */
    public static boolean renderingShadowPass() {
        return ask(SHADOW_PASS);
    }

    private static boolean ask(MethodHandle question) {
        if (question == null) {
            return false;
        }
        try {
            return (boolean) question.invokeExact();
        } catch (Throwable e) {
            return false;
        }
    }
}
