package com.muzhik17.trainsmod.pack;

import java.util.Set;
import java.util.function.Consumer;

import com.google.gson.JsonObject;
import com.google.gson.JsonSyntaxException;

/**
 * A rail style's declaration (SPEC §6.10), {@code assets/<ns>/rail_models/<id>.json}:
 *
 * <pre>{@code { "obj": "tracks/mvp_ir_rail.obj", "tile_length": 1.0 }}</pre>
 *
 * The one reading of it for both sides: the client draws the tile
 * ({@code client.render.model.RailModelReloadListener}), the server lays the
 * track bed under the same tile ({@code data.RailFootprintReloadListener}),
 * so the two can't disagree on what a declaration says.
 *
 * <p>{@code obj} without a namespace is in the declaring pack's namespace.
 * {@code tile_length} (default 1) is how far apart the tile repeats, in
 * blocks, at least {@link #MIN_TILE_LENGTH}. Read strictly ({@link PackJson}):
 * an unknown key is a warning, a {@code null} or a wrong type an error.
 *
 * @param obj        the tile model, {@code ns:path}
 * @param tileLength the tile's repeat, blocks
 */
public record RailStyleDecl(String obj, double tileLength) {

    /** The keys of a declaration. */
    public static final Set<String> KEYS = PackJson.keys("obj", "tile_length");

    /**
     * The shortest tile a style may repeat at, blocks. Both sides do work per
     * tile — the client bends and draws every tile of every segment, the
     * server rasterises each into the track bed — so a segment costs
     * {@code length / tile_length} tiles, and a tile length near zero (a
     * units slip, a missing digit) would freeze both on the first segment
     * laid. A quarter block is shorter than any real sleeper spacing
     * (≈ 0.5–0.6 m) and keeps the cost at most four times the IR norm of
     * one tile per block.
     */
    public static final double MIN_TILE_LENGTH = 0.25;

    /** {@link #parse(String, JsonObject, Consumer)} with the warnings dropped. */
    public static RailStyleDecl parse(String namespace, JsonObject json) {
        return parse(namespace, json, warning -> {
        });
    }

    /**
     * Read a declaration.
     *
     * @param namespace the declaring file's namespace, for an unqualified {@code obj}
     * @param warnings  told about keys the declaration has that mean nothing
     * @throws JsonSyntaxException on a missing {@code obj}, a {@code null} or
     *                             wrongly typed value, or a tile shorter than
     *                             {@link #MIN_TILE_LENGTH}
     */
    public static RailStyleDecl parse(String namespace, JsonObject json, Consumer<String> warnings) {
        PackJson.checkKeys(json, KEYS, "", warnings);
        String obj = PackJson.requiredString(json, "obj", "");
        if (obj.isEmpty()) {
            throw new JsonSyntaxException("'obj' is empty");
        }
        double tileLength = PackJson.optionalNumber(json, "tile_length", "", 1.0);
        if (!(tileLength >= MIN_TILE_LENGTH)) {
            throw new JsonSyntaxException("'tile_length' must be at least " + MIN_TILE_LENGTH
                    + " blocks, got " + tileLength);
        }
        return new RailStyleDecl(obj.indexOf(':') >= 0 ? obj : namespace + ":" + obj, tileLength);
    }
}
