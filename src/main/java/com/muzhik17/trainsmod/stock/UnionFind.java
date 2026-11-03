package com.muzhik17.trainsmod.stock;

/**
 * Sets of the numbers {@code 0…n−1} joined pair by pair — a union–find
 * forest in an {@code int[]}, each entry its number's parent, a root its own:
 * the parts of a floor joined where they touch and where an open door
 * bridges them ({@code kinematics.FloorCheck}, {@code kinematics.CabArea}),
 * the faces of a glowing mesh joined at shared corners
 * ({@code convention.LampIslands}). The one union–find of the core. Pure.
 *
 * <p>Ported: {@code editor/src/ports/unionFind.ts}.
 */
public final class UnionFind {

    private UnionFind() {
    }

    /** {@code n} sets of one each: every number its own root. */
    public static int[] of(int n) {
        int[] parent = new int[n];
        for (int i = 0; i < n; i++) {
            parent[i] = i;
        }
        return parent;
    }

    /** The root of {@code i}'s set, halving the path on the way (each number visited then points at its grandparent). */
    public static int find(int[] parent, int i) {
        while (parent[i] != i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    }

    /** Joins the sets of {@code a} and {@code b}: the root of {@code a}'s set under the root of {@code b}'s. */
    public static void union(int[] parent, int a, int b) {
        parent[find(parent, a)] = find(parent, b);
    }
}
