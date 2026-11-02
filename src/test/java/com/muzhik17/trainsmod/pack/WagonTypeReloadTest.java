package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import com.google.gson.JsonParser;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypes;

/**
 * The seam of the strict wagon type load and the registry's two writers:
 * what {@code data.WagonTypeReloadListener} hands {@link WagonTypes} on a
 * {@code /reload} moves the generation the consists catch up with (D1), and
 * the server's own client's sync of that load is still known for the
 * server's layer (D2) — also with a door the strict load read as having no
 * group from {@code "group": ""}.
 */
class WagonTypeReloadTest {

    private static final String CAR = """
            "length": 14.0, "bogies": [5.0, -5.0], "mass_t": 20.0,
            "interior": [ { "min": [-1, 1, -6], "max": [1, 3, 6] } ],
            "doors": [
              { "id": "door1", "min": [1.4, 1.0, 2.0], "max": [1.5, 3.0, 2.8], "group": "" },
              { "id": "door2", "min": [1.4, 1.0, -2.8], "max": [1.5, 3.0, -2.0], "group": "Left" }
            ]""";

    private static WagonTypeLoader.Declaration file(String id, String body) {
        String path = id.substring(id.indexOf(':') + 1);
        return new WagonTypeLoader.Declaration(id,
                new PackOrigin("rwat/Test", "data/t/wagon_types/" + path + ".json"), JsonParser.parseString(body));
    }

    /** What the reload listener's apply does with a load: the registry takes the types and their aliases. */
    private static WagonTypeLoader.Result reload(String carBody) {
        WagonTypeLoader.Result loaded = WagonTypeLoader.load(List.of(
                file("t:car", "{" + carBody + ", \"aliases\": [\"old:car\"] }"),
                file("t:loco", "{ \"length\": 16.0, \"bogies\": [5.0, -5.0], \"mass_t\": 80.0, \"cab\": {} }")));
        assertEquals(List.of(), loaded.problems());
        WagonTypes.load(loaded.types(), loaded.aliases());
        return loaded;
    }

    /**
     * The type as the client's sync decodes it ({@code network.WagonTypesPayload}):
     * every value anew, a door without a group written as {@code ""} and read
     * back as none.
     */
    private static WagonType decoded(WagonType type) {
        List<WagonType.Door> doors = type.doors().stream().map(d -> {
            String written = d.group() != null ? d.group() : "";
            return new WagonType.Door(d.id(), d.minX(), d.minY(), d.minZ(), d.maxX(), d.maxY(), d.maxZ(),
                    d.inner(), d.fixed(), d.connecting(), written.isEmpty() ? null : written);
        }).toList();
        return new WagonType(type.id(), type.length(), type.bogieOffsets().clone(), type.massT(),
                type.maxSpeedKmh(), type.resistance(), type.traction(), type.cab(), type.brakes(),
                type.interior(), doors, type.couplers());
    }

    @AfterEach
    void clear() {
        WagonTypes.load(Map.of(), Map.of());
    }

    /** A /reload moves the generation, and a train made of the old load takes the new one's types, by id. */
    @Test
    void reloadMovesTheGeneration_trainsTakeTheNewTypes() {
        reload(CAR);
        ConsistComposition train = new ConsistComposition(List.of(
                new ConsistComposition.Slot(WagonTypes.resolve("t:loco"), false),
                new ConsistComposition.Slot(WagonTypes.resolve("old:car"), true)));
        int generation = WagonTypes.generation();

        reload(CAR.replace("\"length\": 14.0", "\"length\": 15.0"));

        assertNotEquals(generation, WagonTypes.generation(), "the consists see the reload");
        ConsistComposition retyped = WagonTypes.rebind(train);
        assertNotSame(train, retyped);
        assertSame(WagonTypes.byId("t:loco"), retyped.slot(0).type(), "the same declaration, the new load's instance");
        assertSame(WagonTypes.byId("t:car"), retyped.slot(1).type(), "found by the id it carries");
        assertEquals(15.0, retyped.slot(1).type().length());
        assertEquals(true, retyped.slot(1).flipped());
    }

    /**
     * Single player: the own client's sync of what the strict load gave is
     * the server's layer coming back — the alias stays, the server's
     * instances stay and no generation is counted (no train is retyped to
     * decoded copies). {@code "group": ""} used to stay {@code ""} on the
     * server and come back as no group from the sync, so the two never
     * compared equal.
     */
    @Test
    void ownClientsSyncIsKnown_withADoorOfEmptyGroup() {
        WagonTypeLoader.Result loaded = reload(CAR);
        WagonType car = loaded.types().get("t:car");
        assertNull(car.doors().get(0).group(), "\"group\": \"\" is no group");
        int generation = WagonTypes.generation();

        WagonTypes.load(Map.of("t:car", decoded(car), "t:loco", decoded(loaded.types().get("t:loco"))));

        assertEquals(generation, WagonTypes.generation());
        assertSame(car, WagonTypes.byId("t:car"));
        assertSame(car, WagonTypes.byId("old:car"), "the server's alias");
        assertSame(car, WagonTypes.loadedTypes().get("t:car"), "the server syncs what it loaded");
    }
}
