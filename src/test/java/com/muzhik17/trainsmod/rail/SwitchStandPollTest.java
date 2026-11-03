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
 * stand whose chunk doesn't tick is never read — a read would load the
 * chunk or hold it a tick longer, and a read every tick would keep it
 * loaded for good.
 */
class SwitchStandPollTest {

    /** A world of named stands: which are live (their chunk ticks), which are powered, which were read. */
    private static final class World implements SwitchStandPoll.Signals<String> {
        final Set<String> live = new HashSet<>();
        final Set<String> powered = new HashSet<>();
        final Set<String> read = new HashSet<>();

        @Override
        public boolean live(String stand) {
            return live.contains(stand);
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
        world.live.add("a");
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
    void aStandWhoseChunkDoesntTickIsNotRead() {
        for (int i = 0; i < 5; i++) {
            assertEquals(List.of(), tick());
        }
        assertFalse(world.read.contains("a"), "reading it would load its chunk, or keep it");
        world.live.add("a");
        tick();
        assertTrue(world.read.contains("a"));
    }

    @Test
    void aStandLiveAgainTakesItsSignalWithoutAThrow() {
        world.live.add("a");
        tick();
        world.live.remove("a"); // the player went away
        tick();
        world.powered.add("a"); // found powered when back: no rise was seen
        world.live.add("a");
        assertEquals(List.of(), tick(), "no edge seen: as after a restart");
        world.powered.remove("a");
        tick();
        world.powered.add("a");
        assertEquals(List.of("a"), tick(), "and the next one throws");
    }

    @Test
    void standsOfADemolishedJunctionAreDroppedUnread() {
        stands.put("b", 2);
        world.live.addAll(List.of("a", "b"));
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
        world.live.addAll(List.of("a", "b", "c"));
        tick();
        world.powered.addAll(List.of("c", "a"));
        assertEquals(List.of("a", "c"), tick());
    }
}
