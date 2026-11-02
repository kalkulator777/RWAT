package com.muzhik17.trainsmod.rail;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

/**
 * The switch stands' redstone (SPEC §2.2 v1): a rising edge throws, and a
 * stand whose chunk isn't loaded is never read — a read would load the
 * chunk, and a read every tick would keep it loaded for good.
 */
class SwitchStandPollTest {

    /** A world of named stands: which are loaded, which are powered, which were read. */
    private static final class World implements SwitchStandPoll.Signals<String> {
        final Set<String> loaded = new HashSet<>();
        final Set<String> powered = new HashSet<>();
        final Set<String> read = new HashSet<>();

        @Override
        public boolean loaded(String stand) {
            return loaded.contains(stand);
        }

        @Override
        public boolean powered(String stand) {
            read.add(stand);
            return powered.contains(stand);
        }
    }

    private final SwitchStandPoll<String> poll = new SwitchStandPoll<>();
    private final World world = new World();
    private final Map<String, Integer> stands = new LinkedHashMap<>(Map.of("a", 1));

    private List<String> tick() {
        return poll.poll(stands, node -> true, world);
    }

    @Test
    void aRisingEdgeThrowsOnceAndAHeldSignalDoesNot() {
        world.loaded.add("a");
        assertEquals(List.of(), tick(), "the first read takes the signal as it is");
        world.powered.add("a");
        assertEquals(List.of("a"), tick());
        assertEquals(List.of(), tick(), "still on: no edge");
        world.powered.remove("a");
        assertEquals(List.of(), tick(), "falling edge");
        world.powered.add("a");
        assertEquals(List.of("a"), tick());
    }

    @Test
    void aStandWhoseChunkIsNotLoadedIsNotRead() {
        for (int i = 0; i < 5; i++) {
            assertEquals(List.of(), tick());
        }
        assertFalse(world.read.contains("a"), "reading it would load its chunk");
        world.loaded.add("a");
        tick();
        assertTrue(world.read.contains("a"));
    }

    @Test
    void aStandLoadedAgainTakesItsSignalWithoutAThrow() {
        world.loaded.add("a");
        tick();
        world.loaded.remove("a"); // the player went away
        tick();
        world.powered.add("a"); // found powered when back: no rise was seen
        world.loaded.add("a");
        assertEquals(List.of(), tick(), "no edge seen: as after a restart");
        world.powered.remove("a");
        tick();
        world.powered.add("a");
        assertEquals(List.of("a"), tick(), "and the next one throws");
    }

    @Test
    void standsOfADemolishedJunctionAreDroppedUnread() {
        stands.put("b", 2);
        world.loaded.addAll(List.of("a", "b"));
        world.powered.addAll(List.of("a", "b"));
        poll.poll(stands, node -> true, world);
        world.read.clear();
        world.powered.clear();
        poll.poll(stands, node -> node != 2, world);
        assertEquals(Map.of("a", 1), stands);
        assertFalse(world.read.contains("b"));
    }

    @Test
    void theRisenStandsComeInTheStandsOrder() {
        stands.put("b", 1);
        stands.put("c", 3);
        world.loaded.addAll(List.of("a", "b", "c"));
        tick();
        world.powered.addAll(List.of("c", "a"));
        assertEquals(List.of("a", "c"), tick());
    }
}
