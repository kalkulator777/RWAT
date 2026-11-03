package com.muzhik17.trainsmod.convention;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.muzhik17.trainsmod.stock.ObjFrame;

/**
 * What every part of a wagon's OBJ is to the engine (SPEC §5.2, §6.12, §8–§9.5),
 * in the Immersive Railroading convention — the rules the model loader
 * ({@code client.render.model.IrStockModel}) builds its meshes by, here
 * without Minecraft so they can be tested and ported. Pure.
 *
 * <p><b>In:</b> the OBJ's parts as {@code ObjLoader} reads them ({@link Part}:
 * the object, the material, whether the material has a texture, the corners
 * of the faces in the OBJ frame) and what the model's declaration adds
 * ({@link Declaration}: {@code bogies}, {@code skip}, the objects its
 * {@code animations} move, {@code handbrake}).
 *
 * <p><b>Out:</b> for each part, its {@link Role} — where it is drawn, or why
 * not, what it belongs to and how it is lit — and the model's moving things:
 * the two bogies with their wheelsets, the cab controls and the door leaves
 * moved by name with their hinges, the doors animated by {@code .anim}, the
 * coupler heads with their pivots, the light groups, the cabin lamps and the
 * headlights. Geometry comes out in the model frame ({@link ObjFrame}: the
 * OBJ turned a quarter about Y and lifted by {@link #Y_LIFT}), in
 * {@code float}, as the loader places the meshes; a bogie's wheelsets are
 * bogie-local.
 *
 * <p><b>Each part, in file order, goes to the first that takes it:</b>
 * <ol>
 *   <li>{@code HIDE} anywhere in the raw name drops it ({@link Place#HIDDEN}),
 *       unless it is a {@code WIDGET} control (shown by its value) or a coupler
 *       head (shown by coupling); a name starting with a skipped prefix —
 *       {@link #DEFAULT_SKIP_PREFIXES} and the declaration's {@code skip} —
 *       drops it too ({@link Place#SKIPPED});</li>
 *   <li>a coupler head ({@link ObjectRole#coupled}) is no bogie's; else a raw
 *       name starting {@code BOGEY_FRONT} or {@code BOGEY_REAR} is that bogie's,
 *       and with {@code _WHEEL_} in it one of its wheelsets (one per object
 *       name, textured or not — every corner counts for the axle);</li>
 *   <li>an object an {@code .anim} names (exactly, copy suffix and all), not a
 *       bogie's or a coupler head, moves with that animation's door;</li>
 *   <li>a door leaf moved by name ({@link DoorLeaves#leaf}) is built like a
 *       control, under its {@code DOOR_<n>}; else a non-bogie, non-animated
 *       object of a control ({@link ObjectRole#control}) is that control's —
 *       every object with the key, flags merged, the first {@code …_ROT…}
 *       object the hinge ({@link PivotAxis}), whatever its material;</li>
 *   <li>a part whose material has no texture is not drawn ({@link Place#UNTEXTURED});</li>
 *   <li>the rest: an animated door's piece, the control's or leaf's mesh, the
 *       coupler head's, the bogie frame's, the interior ({@code INTERIOR} raw
 *       prefix) or the body.</li>
 * </ol>
 * Then the light rules, for every drawn part but a wheelset: {@code _LCG_}
 * gives a light group (numbered in the order the parts first name them),
 * {@code FULLBRIGHT} glows, the raw {@code INTERIOR} token puts the faces in
 * the cabin lamps' light and makes the group a cabin group, {@code LINVERT}
 * inverts ({@link Light}). A part that is no bogie's and no animation's makes
 * a headlight ({@code HEADLIGHT_<n>}) or, glowing and no control's, cabin
 * lamp candidates ({@link LampIslands}); a candidate of a cabin group is a
 * cabin lamp. A control or light group named longer than the wire takes is
 * dropped first ({@link GroupName#fit}).
 *
 * <p>Ported: {@code editor/src/ports/modelParts.ts} (M3); golden:
 * {@code fixtures/golden/model_parts/}.
 */
public final class ModelParts {

    /**
     * Object-name prefixes that are never geometry in the IR convention:
     * {@code CARGO_FILL} — the cargo at each load level (1/20/…/100 %), all
     * overlapping; cargo isn't modelled, so the wagon renders empty. IR draws
     * its {@code SEAT_} objects like the rest of the model, and so do we: in
     * MVP the textured ones are cushions (the DR1's seats, its cab chairs),
     * the flat passenger-seat markers have no material and drop out with
     * every untextured part.
     */
    public static final List<String> DEFAULT_SKIP_PREFIXES = List.of("CARGO_FILL");

    /** Rolling (tread) radius of every wheelset, blocks — wheel spin angle = rolled distance / radius. */
    public static final float WHEEL_RADIUS = 0.53F;

    /**
     * The lift of the OBJ onto the railhead in {@code float}, as the geometry
     * is placed: {@link ObjFrame#Y_LIFT}, the wheel tread (OBJ y = −0.03) onto
     * the railhead (0.40625 above the path spline).
     */
    public static final float Y_LIFT = (float) ObjFrame.Y_LIFT;

    /**
     * One run of faces of the OBJ, as {@code ObjLoader} reads it.
     *
     * @param object   the object it belongs to ({@code o}/{@code g}), raw
     * @param material its {@code usemtl}
     * @param textured the material has a texture ({@code map_Kd}): the part can be drawn
     * @param corners  its faces, four corners each (a triangle repeats its
     *                 last), {@code x, y, z} per corner, in file order, OBJ frame
     */
    public record Part(String object, String material, boolean textured, float[] corners) {
    }

    /**
     * What the model's declaration adds to its OBJ.
     *
     * @param bogies    the bogie pivots, +forward, front first; null — measured from the bogie frames
     * @param skip      name prefixes dropped besides {@link #DEFAULT_SKIP_PREFIXES}
     * @param animated  object → the id of the door whose {@code .anim} moves it
     * @param handbrake control keys ({@code <KIND>_<n>}) that are the wagon's handbrake wheel
     */
    public record Declaration(double[] bogies, List<String> skip, Map<String, String> animated,
            Collection<String> handbrake) {

        /** A model declaring nothing but its OBJ. */
        public static final Declaration NONE = new Declaration(null, List.of(), Map.of(), List.of());
    }

    /** Where a part is drawn, or why it isn't. */
    public enum Place {
        /** Dropped: {@code HIDE} in its name. */
        HIDDEN,
        /** Dropped: a skipped name prefix. */
        SKIPPED,
        /** Not drawn: its material has no texture (a control's hinge marker still counts). */
        UNTEXTURED,
        /** Rigid body. */
        BODY,
        /** The interior shell: rigid with the body, drawn only near. */
        INTERIOR,
        /** A bogie frame ({@link Role#front} says which). */
        BOGIE,
        /** A wheelset of a bogie: {@link Role#owner} is its object, {@link Role#index} its place in the bogie. */
        WHEEL,
        /** A piece of an animated door: {@link Role#owner} is the door's id, {@link Role#index} its place in {@link #doors}. */
        ANIMATED,
        /** A door leaf moved by name: {@link Role#owner} is its {@code DOOR_<n>}, index in {@link #doorLeaves}. */
        DOOR_LEAF,
        /** A cab control: {@link Role#owner} is its key, index in {@link #controls}. */
        CONTROL,
        /** A coupler head: index in {@link #couplers}. */
        COUPLER;

        /** True if the part is drawn. */
        public boolean drawn() {
            return compareTo(BODY) >= 0;
        }
    }

    /**
     * How a drawn part's faces are lit (SPEC §8).
     *
     * @param group      light group, an index into {@link #lightGroups}; −1 none
     * @param fullbright glows at full brightness while lit
     * @param interior   in the cabin lamps' light (the raw {@code INTERIOR} token)
     * @param invert     lit while the group is off ({@code LINVERT})
     */
    public record Light(int group, boolean fullbright, boolean interior, boolean invert) {

        /** Lit as the world lights it. */
        public static final Light NONE = new Light(-1, false, false, false);
    }

    /**
     * What one part is.
     *
     * @param place where it is drawn, or why not
     * @param front of the front bogie or end (a {@code BOGIE}, {@code WHEEL} or
     *              {@code COUPLER} part, or an untextured wheelset part)
     * @param owner what it belongs to, by name: a control's or leaf's key, an
     *              animated door's id, a wheelset's object — an untextured
     *              part too (a control's hinge marker); else null
     * @param index where that is in its list ({@link #controls},
     *              {@link #doorLeaves}, {@link #doors}, {@link #couplers}, the
     *              bogie's wheelsets); −1 if it isn't in one
     * @param light how its faces are lit; {@link Light#NONE} if not drawn, or a wheelset
     */
    public record Role(Place place, boolean front, String owner, int index, Light light) {
    }

    /**
     * A wheelset: its axle in the OBJ frame (the middle of all its corners'
     * x and y) and bogie-local, where the loader re-centres its mesh to spin.
     *
     * @param axleX   OBJ x of the axle (along the car)
     * @param axleY   OBJ y of the axle
     * @param centerY bogie-local height of the axle: {@code axleY + Y_LIFT}
     * @param centerZ bogie-local place of the axle along +Z: {@code −axleX − pivotZ}
     * @param radius  rolling radius, {@link #WHEEL_RADIUS}
     */
    public record Wheel(String object, float axleX, float axleY, float centerY, float centerZ, float radius) {
    }

    /** A bogie: its pivot along the car (+forward, model frame) and its wheelsets, in the order they come. */
    public record Bogie(float pivotZ, List<Wheel> wheels) {
    }

    /**
     * A cab control or a door leaf moved by name (SPEC §9.3, §9.5), model frame.
     *
     * @param role     the control as all its objects' names together declare it
     * @param interior one of its objects has the raw {@code INTERIOR} token: drawn only near
     * @param pivot    the hinge, {@code {x, y, z}}; null if no object is its {@code …_ROT…} marker
     * @param axis     the hinge axis (unit), +Y without a marker
     * @param degrees  the swing at full travel
     * @param slide    the slide at full travel ({@code TL_}), turned into the model frame
     * @param boxMin   the least corner of its drawn faces at rest
     * @param boxMax   the greatest corner
     */
    public record Control(ObjectRole.Control role, boolean interior, float[] pivot, float[] axis, float degrees,
            float[] slide, float[] boxMin, float[] boxMax) {
    }

    /** A door its {@code .anim} moves: its id and its drawn objects, in the order they come. */
    public record Door(String id, List<String> objects) {
    }

    /**
     * A coupler head in one state (SPEC §6.12): its end, when it shows, and
     * the pivot all of its end's heads turn on — on the centre line, at
     * mid-height of the end's heads, at their inner end (model frame).
     */
    public record Coupler(boolean front, ObjectRole.Coupled.Shown shown, float[] pivot) {
    }

    /** A cabin lamp: the centre of a glowing island (model frame), its light group, {@code LINVERT}. */
    public record Lamp(float x, float y, float z, int group, boolean invert) {
    }

    /**
     * A headlight (IR {@code LightFlare}): the centre of its lens face (model
     * frame), which way it shines along the model ({@code dirZ} = +1 forward,
     * −1 back: a lamp in the front half shines forward), the lens radius, its
     * colour, light group (−1 none) and {@code LINVERT}.
     */
    public record Headlight(float x, float y, float z, float dirZ, float radius, int rgb, int group,
            boolean invert) {
    }

    private final List<Role> roles;
    private final List<String> lightGroups;
    private final Bogie front;
    private final Bogie rear;
    private final List<Control> controls;
    private final List<Control> doorLeaves;
    private final List<Door> doors;
    private final List<Coupler> couplers;
    private final List<Lamp> lamps;
    private final List<Headlight> headlights;
    private final Set<String> droppedGroups;
    private final int skipped;

    private ModelParts(Builder b) {
        this.roles = List.copyOf(b.roles);
        this.lightGroups = List.copyOf(b.lightGroups);
        this.front = b.front.build();
        this.rear = b.rear.build();
        this.controls = List.copyOf(b.builtControls);
        this.doorLeaves = List.copyOf(b.builtLeaves);
        this.doors = List.copyOf(b.builtDoors);
        this.couplers = List.copyOf(b.builtCouplers);
        this.lamps = List.copyOf(b.lamps);
        this.headlights = List.copyOf(b.headlights);
        this.droppedGroups = Collections.unmodifiableSet(new LinkedHashSet<>(b.droppedGroups));
        this.skipped = b.skipped;
    }

    /**
     * The parts of one model.
     *
     * @param parts the OBJ's parts, in file order
     * @param decl  what its declaration adds
     */
    public static ModelParts of(List<Part> parts, Declaration decl) {
        return new Builder(parts, decl).run();
    }

    /** Each part's role, in the order of the parts given. */
    public List<Role> roles() {
        return roles;
    }

    /** The light groups, in the order the drawn parts first name them: a {@link Light#group} indexes here. */
    public List<String> lightGroups() {
        return lightGroups;
    }

    public Bogie frontBogie() {
        return front;
    }

    public Bogie rearBogie() {
        return rear;
    }

    /** The cab controls with something drawn, in the order their objects first come. */
    public List<Control> controls() {
        return controls;
    }

    /** The door leaves moved by name with something drawn, in the order their objects first come. */
    public List<Control> doorLeaves() {
        return doorLeaves;
    }

    /** The doors their {@code .anim}s move, with a drawn piece, in the order those first come. */
    public List<Door> doors() {
        return doors;
    }

    /** The coupler heads drawn: the front end's, then the rear's, each in the order they first come. */
    public List<Coupler> couplers() {
        return couplers;
    }

    /** The cabin lamps: the glowing islands of a group that also lights something inside. */
    public List<Lamp> lamps() {
        return lamps;
    }

    public List<Headlight> headlights() {
        return headlights;
    }

    /** The control and light groups named too long to travel ({@link GroupName#tooLong}), dropped; in order. */
    public Set<String> droppedGroups() {
        return droppedGroups;
    }

    /** How many parts aren't drawn: hidden, skipped, or untextured (a wheelset's aside). */
    public int skipped() {
        return skipped;
    }

    /** {minX, minY, minZ, maxX, maxY, maxZ} of nothing yet. */
    private static float[] emptyBox() {
        return new float[]{Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
            -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
    }

    /** Grow {@code box} by every corner of {@code corners}. */
    private static void bound(float[] box, float[] corners) {
        for (int i = 0; i + 2 < corners.length; i += 3) {
            box[0] = Math.min(box[0], corners[i]);
            box[1] = Math.min(box[1], corners[i + 1]);
            box[2] = Math.min(box[2], corners[i + 2]);
            box[3] = Math.max(box[3], corners[i]);
            box[4] = Math.max(box[4], corners[i + 1]);
            box[5] = Math.max(box[5], corners[i + 2]);
        }
    }

    /** Corners of the OBJ frame in the model frame: {@code (z, y + Y_LIFT, −x)}, in {@code float}. */
    private static float[] toModel(float[] corners) {
        float[] model = new float[corners.length];
        for (int i = 0; i + 2 < corners.length; i += 3) {
            model[i] = corners[i + 2];
            model[i + 1] = corners[i + 1] + Y_LIFT;
            model[i + 2] = -corners[i];
        }
        return model;
    }

    private static boolean startsWithAny(String name, List<String> prefixes) {
        for (String prefix : prefixes) {
            if (name.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Bogie pivots when the declaration gives none: the centre, along travel,
     * of each bogie's frame (wheelsets and {@code HIDE} objects aside, any
     * material), as +forward offsets. A model without bogie objects gets 0 —
     * there is nothing to re-centre.
     */
    private static double[] measurePivots(List<Part> parts) {
        float[] frontX = {Float.MAX_VALUE, -Float.MAX_VALUE};
        float[] rearX = {Float.MAX_VALUE, -Float.MAX_VALUE};
        for (Part part : parts) {
            String object = part.object();
            float[] range = object.startsWith("BOGEY_FRONT") ? frontX
                    : object.startsWith("BOGEY_REAR") ? rearX : null;
            if (range == null || object.contains("_WHEEL_") || object.contains("HIDE")) {
                continue;
            }
            float[] c = part.corners();
            for (int i = 0; i + 2 < c.length; i += 3) {
                range[0] = Math.min(range[0], c[i]);
                range[1] = Math.max(range[1], c[i]);
            }
        }
        // the OBJ front is −X: a bogie centred at OBJ x sits at −x along +forward
        double frontPivot = frontX[0] <= frontX[1] ? -(frontX[0] + frontX[1]) / 2.0 : 0.0;
        double rearPivot = rearX[0] <= rearX[1] ? -(rearX[0] + rearX[1]) / 2.0 : 0.0;
        return new double[]{frontPivot, rearPivot};
    }

    /** A cab control or door leaf being gathered: its objects' flags, its hinge marker's corners, its drawn box. */
    private static final class ControlBuilder {
        final String key;
        ObjectRole.Control role;
        boolean interior;
        /** The control's hinge marker: its first object named …_ROT…, all of whose faces count. */
        String pivotObject;
        float degrees;
        final List<float[]> pivotCorners = new ArrayList<>();
        final float[] box = emptyBox();
        boolean drawn;
        int index = -1;

        ControlBuilder(String key) {
            this.key = key;
        }

        void add(ObjectRole objectRole, String object, float[] corners) {
            role = role == null ? objectRole.control() : merge(role, objectRole.control());
            interior |= ObjectRole.hasToken(object, "INTERIOR");
            if (objectRole.pivot() && pivotObject == null) {
                // IR takes the first object of the control named …_ROT…
                pivotObject = object;
                degrees = objectRole.pivotDegrees();
            }
            if (object.equals(pivotObject)) {
                // every face of it, whatever its material: the corners in file order (PivotAxis)
                for (int i = 0; i + 2 < corners.length; i += 3) {
                    pivotCorners.add(new float[]{corners[i], corners[i + 1], corners[i + 2]});
                }
            }
        }

        /** The built control, or null if it has nothing drawn. */
        Control build() {
            if (!drawn || box[0] > box[3]) {
                return null;
            }
            float[] pivot = null;
            float[] axis = {0.0F, 1.0F, 0.0F};
            if (!pivotCorners.isEmpty()) {
                double[][] pa = PivotAxis.of(pivotCorners);
                // OBJ → model frame: (x, y, z) → (z, y + lift, −x); axes turn alike
                pivot = new float[]{(float) pa[0][2], (float) (pa[0][1] + ObjFrame.Y_LIFT), (float) -pa[0][0]};
                axis = new float[]{(float) pa[1][2], (float) pa[1][1], (float) -pa[1][0]};
            }
            float[] slide = {role.slideZ(), role.slideY(), -role.slideX()};
            return new Control(role, interior, pivot, axis, degrees, slide,
                    new float[]{box[0], box[1], box[2]}, new float[]{box[3], box[4], box[5]});
        }

        /** One control's flags spread over its objects: IR reads them from any of them. */
        private static ObjectRole.Control merge(ObjectRole.Control a, ObjectRole.Control b) {
            return new ObjectRole.Control(a.kind(), a.id(), a.key(),
                    a.group().equals(a.key()) ? b.group() : a.group(),
                    a.label() != null ? a.label() : b.label(),
                    a.toggle() || b.toggle(), a.press() || b.press(), a.invert() || b.invert(),
                    a.hide() || b.hide(), a.noTouch() || b.noTouch(), a.global() || b.global(),
                    a.offset() != 0.0F ? a.offset() : b.offset(),
                    b.rangeMin() != 0.0F || b.rangeMax() != 1.0F ? b.rangeMin() : a.rangeMin(),
                    b.rangeMin() != 0.0F || b.rangeMax() != 1.0F ? b.rangeMax() : a.rangeMax(),
                    b.slideX() != 0.0F ? b.slideX() : a.slideX(),
                    b.slideY() != 0.0F ? b.slideY() : a.slideY(),
                    b.slideZ() != 0.0F ? b.slideZ() : a.slideZ());
        }
    }

    /** One coupler head state being gathered: the box of its drawn faces, whether it draws any itself. */
    private static final class CouplerBuilder {
        final ObjectRole.Coupled coupled;
        final float[] box = emptyBox();
        boolean drawn;
        int index = -1;

        CouplerBuilder(ObjectRole.Coupled coupled) {
            this.coupled = coupled;
        }
    }

    /** One bogie being gathered: its pivot and its wheelsets by object. */
    private static final class BogieBuilder {
        final float pivotZ;
        final Map<String, WheelBuilder> wheels = new LinkedHashMap<>();

        BogieBuilder(double pivot) {
            this.pivotZ = (float) pivot;
        }

        Bogie build() {
            List<Wheel> built = new ArrayList<>(wheels.size());
            for (WheelBuilder wheel : wheels.values()) {
                float axleX = (wheel.minX + wheel.maxX) / 2.0F; // OBJ axle position along travel
                float axleY = (wheel.minY + wheel.maxY) / 2.0F; // OBJ axle height
                built.add(new Wheel(wheel.object, axleX, axleY, axleY + Y_LIFT, -axleX - pivotZ, WHEEL_RADIUS));
            }
            return new Bogie(pivotZ, List.copyOf(built));
        }
    }

    /** One wheelset: the span of all its corners, textured or not. */
    private static final class WheelBuilder {
        final String object;
        final int index;
        float minX = Float.MAX_VALUE;
        float maxX = -Float.MAX_VALUE;
        float minY = Float.MAX_VALUE;
        float maxY = -Float.MAX_VALUE;

        WheelBuilder(String object, int index) {
            this.object = object;
            this.index = index;
        }

        void add(float[] corners) {
            for (int i = 0; i + 2 < corners.length; i += 3) {
                minX = Math.min(minX, corners[i]);
                maxX = Math.max(maxX, corners[i]);
                minY = Math.min(minY, corners[i + 1]);
                maxY = Math.max(maxY, corners[i + 1]);
            }
        }
    }

    /** A part's role before the lists are numbered: what it belongs to is still a builder. */
    private record Pending(Place place, boolean front, String owner, Object target, Light light) {
    }

    /** One run over the parts. */
    private static final class Builder {
        final List<Part> parts;
        final Declaration decl;
        final List<String> skipPrefixes = new ArrayList<>(DEFAULT_SKIP_PREFIXES);
        final BogieBuilder front;
        final BogieBuilder rear;
        final Map<String, ControlBuilder> controlBuilders = new LinkedHashMap<>();
        final Map<String, ControlBuilder> leafBuilders = new LinkedHashMap<>();
        final Map<ObjectRole.Coupled, CouplerBuilder> couplerBuilders = new LinkedHashMap<>();
        final Map<String, Set<String>> doorObjects = new LinkedHashMap<>();
        final List<Pending> pending = new ArrayList<>();
        final List<String> lightGroups = new ArrayList<>();
        final Set<Integer> interiorGroups = new HashSet<>();
        final List<Lamp> lampCandidates = new ArrayList<>();
        final List<Headlight> headlights = new ArrayList<>();
        final Set<String> droppedGroups = new LinkedHashSet<>();
        int skipped;

        final List<Role> roles = new ArrayList<>();
        final List<Control> builtControls = new ArrayList<>();
        final List<Control> builtLeaves = new ArrayList<>();
        final List<Door> builtDoors = new ArrayList<>();
        final List<Coupler> builtCouplers = new ArrayList<>();
        final List<Lamp> lamps = new ArrayList<>();

        Builder(List<Part> parts, Declaration decl) {
            this.parts = parts;
            this.decl = decl;
            skipPrefixes.addAll(decl.skip());
            double[] pivots = decl.bogies() != null ? decl.bogies() : measurePivots(parts);
            // bogie pivots: front first, +forward = model +Z
            this.front = new BogieBuilder(pivots[0]);
            this.rear = new BogieBuilder(pivots[pivots.length - 1]);
        }

        ModelParts run() {
            DoorLeaves doorLeaves = DoorLeaves.of(parts.stream().map(Part::object).toList(), skipPrefixes,
                    decl.animated().keySet());
            for (Part part : parts) {
                pending.add(place(part, doorLeaves));
            }
            number();
            return new ModelParts(this);
        }

        /** Where one part goes, gathering what it adds to the model's controls, lights and lamps. */
        private Pending place(Part part, DoorLeaves doorLeaves) {
            String object = part.object();
            ObjectRole parsed = ObjectRole.parse(object);
            droppedGroups.addAll(GroupName.tooLong(parsed));
            ObjectRole role = GroupName.fit(parsed);
            // a hidden switch-driven part (the ChME3 tail lamps) shows by its group, a coupler
            // head by its end's coupling (SPEC §6.12); other HIDE objects stay out
            boolean widget = role.control() != null && role.control().kind() == ObjectRole.Kind.WIDGET;
            ObjectRole.Coupled coupled = ObjectRole.coupled(object);
            if (object.contains("HIDE") && !widget && coupled == null) {
                skipped++;
                return new Pending(Place.HIDDEN, false, null, null, Light.NONE);
            }
            if (startsWithAny(object, skipPrefixes)) {
                skipped++;
                return new Pending(Place.SKIPPED, false, null, null, Light.NONE);
            }
            BogieBuilder bogie = coupled != null ? null : object.startsWith("BOGEY_FRONT") ? front
                    : object.startsWith("BOGEY_REAR") ? rear : null;
            CouplerBuilder coupler = coupled != null ? couplerBuilders.computeIfAbsent(coupled, CouplerBuilder::new)
                    : null;
            if (bogie != null && object.contains("_WHEEL_")) {
                WheelBuilder wheel = bogie.wheels.computeIfAbsent(object,
                        n -> new WheelBuilder(n, bogie.wheels.size()));
                wheel.add(part.corners());
                return new Pending(part.textured() ? Place.WHEEL : Place.UNTEXTURED, bogie == front, object,
                        wheel, Light.NONE);
            }
            String doorId = bogie == null && coupler == null ? decl.animated().get(object) : null;
            // a door leaf moved by name is built like a control (SPEC §9.5); a DOOR_<n>
            // object the asset doesn't move is part of the body
            ObjectRole leafRole = doorLeaves.leaf(object);
            ControlBuilder control = leafRole != null
                    ? leafBuilders.computeIfAbsent(leafRole.control().key(), ControlBuilder::new)
                    : bogie == null && doorId == null && role.control() != null
                            ? controlBuilders.computeIfAbsent(role.control().key(), ControlBuilder::new)
                            : null;
            if (control != null) {
                // a pivot marker counts even without a texture
                control.add(leafRole != null ? leafRole : role, object, part.corners());
            }
            if (!part.textured()) {
                skipped++;
                return new Pending(Place.UNTEXTURED, false, control != null ? control.key : doorId,
                        control, Light.NONE);
            }
            Light light = light(object, role);
            float[] model = bogie == null ? toModel(part.corners()) : null;
            if (control != null) {
                control.drawn = true;
                bound(control.box, model);
            }
            if (coupler != null) {
                bound(coupler.box, model);
            }
            if (bogie == null && doorId == null) {
                if (role.headlight()) {
                    headlights.add(headlight(model, role, light.group()));
                } else if (role.fullbright() && control == null) {
                    for (float[] lamp : LampIslands.of(model)) {
                        lampCandidates.add(new Lamp(lamp[0], lamp[1], lamp[2], light.group(), light.invert()));
                    }
                }
            }
            if (doorId != null) {
                doorObjects.computeIfAbsent(doorId, id -> new LinkedHashSet<>()).add(object);
                return new Pending(Place.ANIMATED, false, doorId, doorId, light);
            }
            if (control != null) {
                return new Pending(leafRole != null ? Place.DOOR_LEAF : Place.CONTROL, false, control.key,
                        control, light);
            }
            if (coupler != null) {
                coupler.drawn = true;
                return new Pending(Place.COUPLER, coupled.front(), null, coupler, light);
            }
            if (bogie != null) {
                return new Pending(Place.BOGIE, bogie == front, null, null, light);
            }
            return new Pending(object.startsWith("INTERIOR") ? Place.INTERIOR : Place.BODY, false, null, null, light);
        }

        /** A drawn part's light, its group numbered on first sight. */
        private Light light(String object, ObjectRole role) {
            int group = -1;
            if (role.lightGroup() != null) {
                group = lightGroups.indexOf(role.lightGroup());
                if (group < 0) {
                    group = lightGroups.size();
                    lightGroups.add(role.lightGroup());
                }
            }
            boolean interiorLit = ObjectRole.hasToken(object, "INTERIOR");
            if (interiorLit && group >= 0) {
                interiorGroups.add(group);
            }
            return new Light(group, role.fullbright(), interiorLit, role.lightInvert());
        }

        /** Build the lists and give every part its place in them. */
        private void number() {
            controlBuilders.values().forEach(builder -> {
                Control built = builder.build();
                if (built != null && decl.handbrake().contains(builder.key)) {
                    // the declaration says this widget is the handbrake wheel (SPEC §5.3)
                    built = new Control(built.role().withKind(ObjectRole.Kind.HANDBRAKE), built.interior(),
                            built.pivot(), built.axis(), built.degrees(), built.slide(), built.boxMin(),
                            built.boxMax());
                }
                if (built != null) {
                    builder.index = builtControls.size();
                    builtControls.add(built);
                }
            });
            leafBuilders.values().forEach(builder -> {
                Control built = builder.build();
                if (built != null) {
                    builder.index = builtLeaves.size();
                    builtLeaves.add(built);
                }
            });
            List<String> doorIds = new ArrayList<>(doorObjects.keySet());
            doorObjects.forEach((id, objects) -> builtDoors.add(new Door(id, List.copyOf(objects))));
            buildCouplers();
            // cabin lamps light the inside only if their group lights something inside
            // (ChME3/platzkart IL); buffer and bogie lamps (FBL, BgL) stay outdoors
            for (Lamp lamp : lampCandidates) {
                if (lamp.group() >= 0 && interiorGroups.contains(lamp.group())) {
                    lamps.add(lamp);
                }
            }
            for (Pending p : pending) {
                int index = -1;
                if (p.target() instanceof ControlBuilder control) {
                    index = control.index;
                } else if (p.target() instanceof CouplerBuilder coupler) {
                    index = coupler.index;
                } else if (p.target() instanceof WheelBuilder wheel) {
                    index = wheel.index;
                } else if (p.target() instanceof String doorId) {
                    index = doorIds.indexOf(doorId);
                }
                roles.add(new Role(p.place(), p.front(), p.owner(), index, p.light()));
            }
        }

        /**
         * The coupler heads (SPEC §6.12), each state of each end, all of an end
         * turning on one pivot: on the centre line (the shank's), at mid-height
         * of the end's heads, at their inner end — where the shank comes out of
         * the frame.
         */
        private void buildCouplers() {
            for (boolean atFront : new boolean[]{true, false}) {
                float[] box = emptyBox();
                for (CouplerBuilder coupler : couplerBuilders.values()) {
                    if (coupler.coupled.front() == atFront && coupler.drawn) {
                        for (int i = 0; i < 3; i++) {
                            box[i] = Math.min(box[i], coupler.box[i]);
                            box[i + 3] = Math.max(box[i + 3], coupler.box[i + 3]);
                        }
                    }
                }
                if (box[0] > box[3]) {
                    continue; // no head at this end
                }
                float[] pivot = {0.0F, (box[1] + box[4]) * 0.5F, atFront ? box[2] : box[5]};
                for (CouplerBuilder coupler : couplerBuilders.values()) {
                    if (coupler.coupled.front() == atFront && coupler.drawn) {
                        coupler.index = builtCouplers.size();
                        builtCouplers.add(new Coupler(atFront, coupler.coupled.shown(), pivot.clone()));
                    }
                }
            }
        }

        /** A headlight from its lens object's faces (model frame): a front lamp (model +Z half) shines forward. */
        private static Headlight headlight(float[] model, ObjectRole role, int group) {
            float[] box = emptyBox();
            bound(box, model);
            float cz = (box[2] + box[5]) * 0.5F;
            boolean forward = cz >= 0.0F;
            return new Headlight((box[0] + box[3]) * 0.5F, (box[1] + box[4]) * 0.5F,
                    forward ? box[5] + 0.02F : box[2] - 0.02F, forward ? 1.0F : -1.0F,
                    Math.max(box[3] - box[0], box[4] - box[1]) * 0.5F, role.rgb(), group, role.lightInvert());
        }
    }
}
