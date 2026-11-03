package com.muzhik17.trainsmod.convention;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.convention.ModelParts.Place;

/**
 * What a wagon model's parts are ({@link ModelParts}): the order of the
 * steps, controls and leaves with their merged flags and hinges, wheelsets,
 * bogie pivots, coupler heads, light groups, cabin lamps and headlights —
 * and when a light shines ({@link ModelParts#lit}), {@code LINVERT} included.
 */
class ModelPartsTest {

    private static final float EPS = 1.0e-6F;
    private static final float LIFT = ModelParts.Y_LIFT;

    /** A textured (or not) box part, OBJ frame: six quads, corners in a fixed order. */
    private static ModelParts.Part box(String object, boolean textured, float x0, float y0, float z0,
            float x1, float y1, float z1) {
        float[][] c = {{x0, y0, z0}, {x1, y0, z0}, {x1, y1, z0}, {x0, y1, z0},
            {x0, y0, z1}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1}};
        int[][] faces = {{0, 1, 2, 3}, {4, 5, 6, 7}, {0, 1, 5, 4}, {3, 2, 6, 7}, {0, 3, 7, 4}, {1, 2, 6, 5}};
        float[] corners = new float[faces.length * 12];
        int n = 0;
        for (int[] face : faces) {
            for (int i : face) {
                corners[n++] = c[i][0];
                corners[n++] = c[i][1];
                corners[n++] = c[i][2];
            }
        }
        return new ModelParts.Part(object, textured ? "paint" : "", textured, corners);
    }

    private static ModelParts.Part box(String object, float x0, float y0, float z0, float x1, float y1, float z1) {
        return box(object, true, x0, y0, z0, x1, y1, z1);
    }

    private static ModelParts read(ModelParts.Declaration decl, ModelParts.Part... parts) {
        return ModelParts.of(List.of(parts), decl);
    }

    private static ModelParts read(ModelParts.Part... parts) {
        return read(ModelParts.Declaration.NONE, parts);
    }

    private static List<Place> places(ModelParts parts) {
        return parts.roles().stream().map(ModelParts.Role::place).toList();
    }

    @Test
    void hiddenPartsAreDroppedButSwitchesAndCouplerHeads() {
        ModelParts parts = read(
                box("WINDOW_HIDE_GLASS", 0, 0, 0, 1, 1, 1),
                box("WIDGET_2_HIDE_CG_TL", 0, 0, 0, 1, 1, 1),
                box("COUPLED_FRONT_1_HIDE", -7, 0, -0.2F, -6.5F, 0.5F, 0.2F),
                box("CARGO_FILL_20", 0, 0, 0, 1, 1, 1),
                box("GUIDE_RAIL", 0, 0, 0, 1, 1, 1),
                box("ROOF", 0, 0, 0, 1, 1, 1));
        assertEquals(List.of(Place.HIDDEN, Place.CONTROL, Place.COUPLER, Place.SKIPPED, Place.BODY, Place.BODY),
                places(parts));
        ModelParts skipping = read(new ModelParts.Declaration(null, List.of("GUIDE_"), Map.of(), List.of()),
                box("GUIDE_RAIL", 0, 0, 0, 1, 1, 1));
        assertEquals(List.of(Place.SKIPPED), places(skipping), "the declaration's skip");
        assertEquals(2, parts.skipped());
    }

    @Test
    void bogiePivotsAreMeasuredFromTheFramesAndWheelsetsSpinRoundTheirAxles() {
        ModelParts parts = read(
                box("BOGEY_FRONT", -6, 0.2F, -1, -4, 0.8F, 1),
                box("BOGEY_FRONT_WHEEL_1", -5.7F, -0.03F, -0.8F, -4.64F, 1.03F, 0.8F),
                box("BOGEY_FRONT_WHEEL_1", false, -5.8F, 0, -0.1F, -4.54F, 1, 0.1F),
                box("BOGEY_REAR_FRAME", 3, 0.2F, -1, 7, 0.8F, 1),
                box("BOGEY_REAR_HIDE_X", 30, 0, 0, 31, 1, 1));
        assertEquals(5.0F, parts.frontBogie().pivotZ(), EPS, "the frame's middle, front at −X");
        assertEquals(-5.0F, parts.rearBogie().pivotZ(), EPS);
        ModelParts.Wheel wheel = parts.frontBogie().wheels().get(0);
        // the untextured part of the wheelset counts for its axle too
        assertEquals((-5.8F + -4.54F) / 2.0F, wheel.axleX(), EPS);
        assertEquals(0.5F, wheel.axleY(), EPS);
        assertEquals(0.5F + LIFT, wheel.centerY(), EPS);
        assertEquals(-wheel.axleX() - 5.0F, wheel.centerZ(), EPS);
        assertEquals(ModelParts.WHEEL_RADIUS, wheel.radius());
        assertEquals(List.of(Place.BOGIE, Place.WHEEL, Place.UNTEXTURED, Place.BOGIE, Place.HIDDEN), places(parts));
        assertEquals("BOGEY_FRONT_WHEEL_1", parts.roles().get(2).owner(), "an untextured wheelset part");
        assertTrue(parts.roles().get(0).front());
        assertFalse(parts.roles().get(3).front());
        assertEquals(1, parts.skipped(), "the hidden part only: a wheelset's untextured part isn't counted");
    }

    @Test
    void declaredPivotsWinTheFirstAndLast() {
        ModelParts parts = read(new ModelParts.Declaration(new double[]{4.44, 0.0, -4.44}, List.of(), Map.of(),
                List.of()), box("BOGEY_FRONT", -6, 0, -1, -4, 1, 1));
        assertEquals(4.44F, parts.frontBogie().pivotZ());
        assertEquals(-4.44F, parts.rearBogie().pivotZ());
    }

    @Test
    void anAnimatedObjectMovesWithItsDoorUnlessABogiesOrACouplerHead() {
        ModelParts parts = read(new ModelParts.Declaration(null, List.of(),
                Map.of("DOOR_1_LEAF", "door1", "DOOR_1_HANDLE", "door1", "BOGEY_FRONT_X", "door2",
                        "TRAP", "trap"), List.of()),
                box("DOOR_1_HANDLE", 0, 1, 1, 0.1F, 1.1F, 1.1F),
                box("TRAP", false, 0, 0, 0, 1, 1, 1),
                box("BOGEY_FRONT_X", -6, 0, -1, -4, 1, 1),
                box("DOOR_1_LEAF", 0, 0, 1, 1, 2, 1.05F));
        assertEquals(List.of(Place.ANIMATED, Place.UNTEXTURED, Place.BOGIE, Place.ANIMATED), places(parts));
        assertEquals(1, parts.doors().size(), "an untextured object makes no door");
        assertEquals(List.of("DOOR_1_HANDLE", "DOOR_1_LEAF"), parts.doors().get(0).objects());
        assertEquals("trap", parts.roles().get(1).owner());
        assertEquals(-1, parts.roles().get(1).index());
    }

    @Test
    void aControlsObjectsMergeTheirFlagsAndItsFirstRotMarkerIsTheHinge() {
        ModelParts parts = read(
                box("THROTTLE_1_ROT_-50", false, 1, 2, -0.5F, 1, 2, 0.5F),
                box("THROTTLE_1_LEVER_LABEL_Controller", 0.9F, 2, -0.1F, 1.1F, 2.6F, 0.1F),
                box("THROTTLE_1_KNOB_INVERT_INTERIOR", 0.95F, 2.6F, -0.05F, 1.05F, 2.7F, 0.05F),
                box("THROTTLE_1_ROT_30_SECOND", false, 0, 0, 0, 5, 0, 0));
        assertEquals(List.of(Place.UNTEXTURED, Place.CONTROL, Place.CONTROL, Place.UNTEXTURED), places(parts));
        assertEquals("THROTTLE_1", parts.roles().get(0).owner(), "the untextured hinge marker is the control's");
        ModelParts.Control c = parts.controls().get(0);
        assertEquals(ObjectRole.Kind.THROTTLE, c.role().kind());
        assertEquals("Controller", c.role().label());
        assertTrue(c.role().invert(), "a flag on any object counts for all");
        assertTrue(c.interior());
        assertEquals(-50.0F, c.degrees(), "the first marker's degrees");
        // the marker from (1,2,−0.5) to (1,2,0.5): hinge its middle, axis along OBJ +Z = model +X
        assertArrayEquals(new float[]{0.0F, 2.0F + (float) com.muzhik17.trainsmod.stock.ObjFrame.Y_LIFT, -1.0F},
                c.pivot(), EPS);
        assertArrayEquals(new float[]{1.0F, 0.0F, 0.0F}, c.axis(), EPS);
        // the box of the drawn faces only, model frame
        assertArrayEquals(new float[]{-0.1F, 2.0F + LIFT, -1.1F}, c.boxMin(), EPS);
        assertArrayEquals(new float[]{0.1F, 2.7F + LIFT, -0.9F}, c.boxMax(), EPS);
    }

    @Test
    void aControlWithNothingDrawnIsNoControlAndADeclaredWidgetIsTheHandbrake() {
        ModelParts parts = read(new ModelParts.Declaration(null, List.of(), Map.of(), List.of("WIDGET_5")),
                box("REVERSER_1_ROT", false, 0, 0, 0, 1, 1, 1),
                box("WIDGET_5_LABEL_Hand^Brake", 0, 0, 0, 1, 1, 1),
                box("WINDOW_1_TL_0.8_Y", 0, 0, 0, 1, 1, 1));
        assertEquals(2, parts.controls().size());
        assertEquals(ObjectRole.Kind.HANDBRAKE, parts.controls().get(0).role().kind());
        assertEquals(-1, parts.roles().get(0).index());
        assertEquals(0, parts.roles().get(1).index());
        assertEquals(1, parts.roles().get(2).index());
        assertArrayEquals(new float[]{0.0F, 0.8F, 0.0F}, parts.controls().get(1).slide(), EPS);
        assertNull(parts.controls().get(1).pivot());
        assertArrayEquals(new float[]{0.0F, 1.0F, 0.0F}, parts.controls().get(1).axis());
    }

    @Test
    void aDoorMovedByNameIsALeafAndOneThatIsntIsBody() {
        ModelParts parts = read(
                box("DOOR_1_ROT_90", false, 2, 0, 1.4F, 2, 2, 1.4F),
                box("DOOR_1_EXTERNAL", 2, 0, 1.35F, 3, 2, 1.4F),
                box("DOOR_2_EXTERNAL", 5, 0, 1.35F, 6, 2, 1.4F),
                box("DOOR_3_TL_0.6_X", 8, 0, 1.35F, 9, 2, 1.4F));
        assertEquals(List.of(Place.UNTEXTURED, Place.DOOR_LEAF, Place.BODY, Place.DOOR_LEAF), places(parts));
        assertEquals(List.of("DOOR_1", "DOOR_3"), parts.doorLeaves().stream().map(c -> c.role().key()).toList());
        assertEquals(90.0F, parts.doorLeaves().get(0).degrees());
        assertArrayEquals(new float[]{0.0F, 0.0F, -0.6F}, parts.doorLeaves().get(1).slide(), EPS);
    }

    @Test
    void couplerHeadsOfAnEndTurnOnOnePivot() {
        ModelParts parts = read(
                box("COUPLED_FRONT_1_HIDE", -7, 0.4F, -0.2F, -6.6F, 0.8F, 0.2F),
                box("COUPLED_FRONT_2_HIDE_INVERT", -7.2F, 0.5F, -0.2F, -6.6F, 0.9F, 0.2F),
                box("COUPLED_REAR_1", 6.6F, 0.4F, -0.2F, 7, 0.8F, 0.2F));
        assertEquals(3, parts.couplers().size());
        ModelParts.Coupler a = parts.couplers().get(0);
        assertTrue(a.front());
        assertEquals(ObjectRole.Coupled.Shown.UNCOUPLED, a.shown());
        assertEquals(ObjectRole.Coupled.Shown.COUPLED, parts.couplers().get(1).shown());
        // the front heads span OBJ y 0.4…0.9 and x −7.2…−6.6: model z 6.6…7.2, the inner end 6.6
        assertArrayEquals(new float[]{0.0F, (0.4F + LIFT + 0.9F + LIFT) * 0.5F, 6.6F}, a.pivot(), EPS);
        assertArrayEquals(a.pivot(), parts.couplers().get(1).pivot());
        assertEquals(-6.6F, parts.couplers().get(2).pivot()[2], EPS);
        assertEquals(List.of(0, 1, 2), parts.roles().stream().map(ModelParts.Role::index).toList());
    }

    @Test
    void lightGroupsAreNumberedAsTheDrawnPartsFirstNameThem() {
        ModelParts parts = read(
                box("LAMP_LCG_FHL", false, 0, 0, 0, 1, 1, 1),
                box("PANEL_FULLBRIGHT_LCG_DeskL", 0, 0, 0, 1, 1, 1),
                box("BUFFER_FULLBRIGHT_LCG_FBL_LINVERT", 0, 0, 0, 1, 1, 1),
                box("PANEL_2_LCG_DeskL", 0, 0, 0, 1, 1, 1));
        assertEquals(List.of("DeskL", "FBL"), parts.lightGroups(), "an untextured part names no group");
        assertEquals(new ModelParts.Light(0, true, false, false), parts.roles().get(1).light());
        assertEquals(new ModelParts.Light(1, true, false, true), parts.roles().get(2).light());
        assertEquals(ModelParts.Light.NONE, parts.roles().get(0).light());
    }

    @Test
    void aGlowingIslandOfAGroupLightingSomethingInsideIsACabinLamp() {
        ModelParts parts = read(
                box("CEILING_LAMPS_FULLBRIGHT_LCG_IL", -1, 2.4F, -0.2F, -0.6F, 2.5F, 0.2F),
                box("INTERIOR_SEATS_LCG_IL", 0, 0.5F, -1, 3, 1, 1),
                box("BUFFER_LAMP_FULLBRIGHT_LCG_FBL", -7, 1, 1, -6.9F, 1.4F, 1.4F),
                box("DIAL_FULLBRIGHT_LCG_IL", 0, 2, 0, 0.05F, 2.05F, 0.05F),
                box("WIDGET_1_FULLBRIGHT_LCG_IL", 0, 0, 0, 1, 1, 1));
        assertEquals(1, parts.lamps().size(), "the buffer lamp's group lights nothing inside, the dial is tiny,"
                + " a control's glow is no lamp");
        ModelParts.Lamp lamp = parts.lamps().get(0);
        assertEquals(0.0F, lamp.x(), EPS);
        assertEquals(2.45F + LIFT, lamp.y(), EPS);
        assertEquals(0.8F, lamp.z(), EPS);
        assertEquals(0, lamp.group());
        assertTrue(parts.roles().get(1).light().interior());
    }

    @Test
    void aHeadlightShinesOutOfItsHalfFromItsLensFace() {
        ModelParts parts = read(
                box("HEADLIGHT_1_0XFFF0CC_FULLBRIGHT_LCG_FHL", -7.0F, 2.8F, -0.2F, -6.9F, 3.2F, 0.2F),
                box("HEADLIGHT_2_LCG_RHL_LINVERT", 6.9F, 2.8F, -0.1F, 7.0F, 3.0F, 0.1F));
        ModelParts.Headlight front = parts.headlights().get(0);
        assertEquals(1.0F, front.dirZ());
        assertEquals(7.0F + 0.02F, front.z(), EPS);
        assertEquals(3.0F + LIFT, front.y(), EPS);
        assertEquals(0.2F, front.radius(), EPS);
        assertEquals(0xFFF0CC, front.rgb());
        assertEquals(0, front.group());
        assertFalse(front.invert());
        ModelParts.Headlight rear = parts.headlights().get(1);
        assertEquals(-1.0F, rear.dirZ());
        assertEquals(-7.0F - 0.02F, rear.z(), EPS);
        assertEquals(0xFFFFFF, rear.rgb());
        assertTrue(rear.invert());
        assertTrue(parts.lamps().isEmpty(), "a glowing headlight is no cabin lamp");
    }

    /** One rule for every light: a glowing face, a cabin lamp, a headlight (IR's LightFlare honours LINVERT). */
    @Test
    void aLightShinesWithItsGroupAndAnInvertedOneWithout() {
        long fhlOn = 1L << 1;
        assertTrue(ModelParts.lit(-1, false, 0L), "no group: always");
        assertTrue(ModelParts.lit(-1, true, -1L), "no group: always, LINVERT or not");
        assertTrue(ModelParts.lit(1, false, fhlOn));
        assertFalse(ModelParts.lit(1, false, 0L));
        assertTrue(ModelParts.lit(1, true, 0L), "LINVERT: while the group is off");
        assertFalse(ModelParts.lit(1, true, fhlOn));
        assertFalse(ModelParts.lit(64, false, -1L), "past the 64th group never on");
        assertTrue(ModelParts.lit(64, true, -1L));
        ModelParts parts = read(box("HEADLIGHT_2_LCG_RHL_LINVERT", 6.9F, 2.8F, -0.1F, 7.0F, 3.0F, 0.1F));
        assertTrue(parts.headlights().get(0).lit(0L), "an LINVERT headlight shines with its group off");
        assertFalse(parts.headlights().get(0).lit(1L));
    }

    @Test
    void aGroupIsOnAboveZero() {
        List<String> groups = new ArrayList<>(List.of("IL", "FHL", "NL", "X"));
        Map<String, Double> values = Map.of("IL", 1.0, "FHL", 0.0, "NL", 0.25, "X", Double.NaN);
        assertEquals(0b101L, ModelParts.litMask(groups, g -> values.getOrDefault(g, 0.0)));
        for (int i = 0; i < 70; i++) {
            groups.add("G" + i);
        }
        assertEquals(-1L, ModelParts.litMask(groups, g -> 1.0), "the first 64 groups only");
    }

    @Test
    void aGroupNamedTooLongIsDroppedAndOnlyAnInvertedHeadlightStays() {
        String longName = "A".repeat(GroupName.MAX_LENGTH + 1);
        ModelParts parts = read(
                box("HEADLIGHT_1_LCG_" + longName, -7.0F, 2.8F, -0.2F, -6.9F, 3.2F, 0.2F),
                box("HEADLIGHT_2_LCG_" + longName + "_LINVERT", 6.9F, 2.8F, -0.1F, 7.0F, 3.0F, 0.1F));
        assertEquals(List.of(longName), List.copyOf(parts.droppedGroups()));
        assertEquals(1, parts.headlights().size());
        assertEquals(-1, parts.headlights().get(0).group(), "a group never switched: always on, inverted");
        assertFalse(parts.headlights().get(0).invert());
        assertTrue(parts.lightGroups().isEmpty());
    }

    @Test
    void theInteriorPrefixAndTokenReadTheRawName() {
        ModelParts parts = read(
                box("INTERIOR_1", 0, 0, 0, 1, 1, 1),
                box("WINDOW_GLASS_INTERIOR", 0, 0, 0, 1, 1, 1),
                box("PANEL_LCG_IL_INTERIOR.001", 0, 0, 0, 1, 1, 1));
        assertEquals(List.of(Place.INTERIOR, Place.BODY, Place.BODY), places(parts));
        assertTrue(parts.roles().get(1).light().interior(), "the token makes no interior part");
        ModelParts.Light copy = parts.roles().get(2).light();
        assertEquals(0, copy.group(), "the light group reads the name without its copy suffix");
        assertFalse(copy.interior(), "the INTERIOR token reads the raw name: …_INTERIOR.001 doesn't end with it");
    }

    /** The example pack's shunter, as the loader reads it (pack files, CC0). */
    @Test
    void theExampleShunter() throws IOException {
        PackModels.Model shunter = PackModels.of(Path.of("run/rwat_packs/RwatExamplePack")).stream()
                .filter(m -> m.id().equals("rwat_example:shunter")).findFirst().orElseThrow();
        ModelParts parts = ModelParts.of(shunter.parts(), shunter.declaration());
        assertEquals(2, parts.headlights().size());
        assertEquals(1.0F, parts.headlights().get(0).dirZ(), "HEADLIGHT_1 at the front shines forward");
        assertEquals(-1.0F, parts.headlights().get(1).dirZ());
        assertEquals(List.of("FHL", "RHL"), Arrays.asList(parts.lightGroups().get(parts.headlights().get(0).group()),
                parts.lightGroups().get(parts.headlights().get(1).group())));
        int indicator = shunter.obj().parts().stream().map(p -> p.object()).toList()
                .indexOf("IND_LAMP_FULLBRIGHT_LCG_FHL_LINVERT");
        ModelParts.Light light = parts.roles().get(indicator).light();
        assertTrue(light.invert() && light.fullbright());
        long fhl = 1L << parts.lightGroups().indexOf("FHL");
        assertTrue(light.lit(0L) && !light.lit(fhl), "the indicator glows while the headlight is off");
        assertTrue(parts.controls().stream().anyMatch(c -> c.role().kind() == ObjectRole.Kind.HANDBRAKE));
        assertEquals(1, parts.lamps().size(), "the cab lamp");
        assertTrue(parts.controls().stream().anyMatch(c -> c.role().key().equals("WIDGET_7") && c.role().hide()),
                "the hidden headlight widget is kept: it shows by its group");
    }
}
