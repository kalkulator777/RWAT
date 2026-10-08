package com.muzhik17.trainsmod.client.render.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;

import org.joml.Matrix4f;
import org.joml.Vector3f;
import org.junit.jupiter.api.Test;

/**
 * The IR {@code .anim} reader and its change into render-model space (SPEC
 * v1.5, doors), checked against the real platzkart door asset (a test
 * fixture copied from the MVP pack, not shipped): the leaf has to turn about
 * its hinge, not wander off.
 */
class IrAnimTest {

    /** IrStockModel's lift: railhead 0.40625 + tread offset 0.03. */
    private static final float Y_LIFT = 0.43625F;
    private static final String LEAF = "DOOR_1_TOGGLE_EXTERNAL_CG_Door1_mvp_amendorf";

    private static Map<String, List<float[]>> door1() throws IOException {
        try (InputStream in = IrAnimTest.class.getResourceAsStream(
                "/fixtures/mvp_ir_amendorf_door1.anim")) {
            assertNotNull(in, "door animation on the classpath");
            return IrAnim.parse(in);
        }
    }

    private static Vector3f apply(Matrix4f m, float x, float y, float z) {
        return m.transformPosition(new Vector3f(x, y, z));
    }

    @Test
    void parsesEveryObjectTrackOfTheGroup() throws IOException {
        Map<String, List<float[]>> tracks = door1();
        // leaf, inner leaf, two handles, step trap and its inner face — 81 frames each
        assertEquals(6, tracks.size());
        assertTrue(tracks.containsKey(LEAF));
        assertTrue(tracks.containsKey("TRAPDOOR_1_mvp_amendorf"));
        for (List<float[]> frames : tracks.values()) {
            assertEquals(81, frames.size());
        }
    }

    @Test
    void firstFrameIsTheRestPose() throws IOException {
        Matrix4f rest = IrAnim.toModelSpace(door1().get(LEAF).get(0), Y_LIFT);
        Vector3f p = apply(rest, 1.5F, 2.5F, 10.87F);
        assertEquals(1.5F, p.x, 1.0e-4F);
        assertEquals(2.5F, p.y, 1.0e-4F);
        assertEquals(10.87F, p.z, 1.0e-4F);
    }

    @Test
    void openLeafTurnsAboutItsHingeIntoTheVestibule() throws IOException {
        List<float[]> frames = door1().get(LEAF);
        Matrix4f open = IrAnim.toModelSpace(frames.get(frames.size() - 1), Y_LIFT);
        // the hinge (outer end of the leaf, measured from the mesh) stays put …
        Vector3f hinge = apply(open, 1.502F, 2.5F, 11.689F);
        assertEquals(1.502F, hinge.x, 0.01F);
        assertEquals(11.689F, hinge.z, 0.01F);
        // … the free edge swings ~0.8 inward (−X, into the car) against the end
        // wall, at the same height — a door turning on vertical hinges
        Vector3f edge = apply(open, 1.5F, 2.5F, 10.87F);
        assertTrue(edge.x < 0.8F, "free edge swung inward, x=" + edge.x);
        assertEquals(11.7F, edge.z, 0.05F);
        assertEquals(2.5F, edge.y, 1.0e-3F);
    }
}
