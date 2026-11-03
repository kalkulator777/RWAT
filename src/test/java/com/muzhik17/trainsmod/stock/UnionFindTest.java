package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import org.junit.jupiter.api.Test;

/** The one union–find of the core: sets joined pair by pair, a set known by its root. */
class UnionFindTest {

    @Test
    void everyNumberStartsAloneAndJoinsBySetsNotPairs() {
        int[] parent = UnionFind.of(6);
        assertArrayEquals(new int[]{0, 1, 2, 3, 4, 5}, parent);
        UnionFind.union(parent, 0, 1);
        UnionFind.union(parent, 2, 3);
        UnionFind.union(parent, 1, 3); // joins {0, 1} and {2, 3}
        UnionFind.union(parent, 4, 4); // nothing to join
        int root = UnionFind.find(parent, 0);
        for (int i : new int[]{1, 2, 3}) {
            assertEquals(root, UnionFind.find(parent, i), "of " + i);
        }
        assertNotEquals(root, UnionFind.find(parent, 4));
        assertEquals(4, UnionFind.find(parent, 4));
        assertEquals(5, UnionFind.find(parent, 5));
    }

    @Test
    void aSetIsKnownByTheRootOfItsSecondNumber_andAFindHalvesItsPath() {
        int[] parent = UnionFind.of(4);
        UnionFind.union(parent, 0, 1);
        UnionFind.union(parent, 1, 2);
        UnionFind.union(parent, 2, 3);
        assertArrayEquals(new int[]{1, 2, 3, 3}, parent);
        assertEquals(3, UnionFind.find(parent, 0));
        assertArrayEquals(new int[]{2, 2, 3, 3}, parent); // 0 now points at its grandparent, 2
    }
}
