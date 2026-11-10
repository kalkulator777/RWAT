package com.muzhik17.trainsmod.pack;

/**
 * Which {@code ns:path} strings Minecraft takes for a resource location —
 * {@code net.minecraft.resources.ResourceLocation.tryParse} of 1.21.1
 * ({@code tryBySeparator}, {@code isValidPath}, {@code isValidNamespace}),
 * written out for the tests, whose classpath has no Minecraft: the game's
 * {@link ModelCheck.Files} ({@code StockModels.checkFiles}) asks Minecraft
 * itself, the tests' stand-ins ask this.
 *
 * <p>The path is what follows the first colon, or the whole string with no
 * colon; it may hold {@code a-z 0-9 / . _ -} and may be empty. The
 * namespace is what precedes the colon: {@code a-z 0-9 . _ -}, or, empty or
 * absent, {@code minecraft} ({@link ModelCheck#namespace}). Ported:
 * {@code editor/src/ports/modelCheck.ts} ({@code validLocation}); golden:
 * {@code fixtures/golden/model_check/locations.json}.
 */
public final class ResourceLocations {

    private ResourceLocations() {
    }

    /** True if Minecraft takes {@code location} for a resource location. */
    public static boolean valid(String location) {
        int colon = location.indexOf(':');
        String path = location.substring(colon + 1);
        for (int i = 0; i < path.length(); i++) {
            char c = path.charAt(i);
            if (!(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '/' || c == '.' || c == '_' || c == '-')) {
                return false;
            }
        }
        for (int i = 0; i < colon; i++) {
            char c = location.charAt(i);
            if (!(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '.' || c == '_' || c == '-')) {
                return false;
            }
        }
        return true;
    }

    /** The location as Minecraft names it once taken: {@code namespace:path}, the namespace never left out. */
    public static String normal(String location) {
        return ModelCheck.namespace(location) + ":" + ModelCheck.path(location);
    }
}
