package com.muzhik17.trainsmod.convention;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What an OBJ object's name says the object does, in the Immersive Railroading
 * convention the packs use (SPEC §5.2, §8–§9). Pure string parsing — no MC
 * imports, unit-tested — shared by the model loader (levers, gauges, lamps)
 * and anything else that reads the convention.
 *
 * <p>The rules mirror IR's own ({@code ModelComponentType}, {@code Control},
 * {@code LightFlare}, {@code ModelState}):
 * <ul>
 *   <li>a <b>control</b> is {@code <KIND>_<n>} anywhere in the name
 *       ({@code THROTTLE_1}, {@code GAUGE_SPEED_2}, {@code WIDGET_7}); every
 *       object with the same kind and number is one control;</li>
 *   <li>flags are {@code _FLAG_}, {@code FLAG_…} or {@code …_FLAG} tokens:
 *       {@code TOGGLE}, {@code PRESS}, {@code INVERT}, {@code HIDE},
 *       {@code NOTOUCH}/{@code NOINTERACT};</li>
 *   <li>{@code _CG_<name>} binds a control to a named control group (else it
 *       is its own group, {@code <KIND>_<n>}); {@code _LABEL_<text>} names it;
 *       {@code _OFFSET_<f>} shifts its value; {@code _RANGE_<min>_<max>} maps a
 *       gauge's reading; {@code TL_<amount>_<axis>} slides it;</li>
 *   <li>{@code <KIND>_<n>_ROT[_<degrees>]} is the control's <b>pivot</b>: a
 *       flat marker whose centre is the hinge and whose normal the axis;</li>
 *   <li>lights: {@code _LCG_<name>} lights with control group {@code name}
 *       ({@code LINVERT} inverts), {@code FULLBRIGHT} glows when lit,
 *       {@code HEADLIGHT_<n>} is a lamp with a flare, {@code _0X<RRGGBB>} its
 *       colour.</li>
 *   <li>a <b>door leaf</b> is {@code DOOR_<n>}, read by {@link #door} only:
 *       doors open by the wagon type's door boxes, they are no cab controls.</li>
 * </ul>
 *
 * <p>A Blender copy suffix ({@code .001}) at the end of a name is dropped
 * first: {@code DOOR_3_INTERIOR_LCG_IL.001} lights with {@code IL}.
 *
 * @param control      the control this object belongs to, or null
 * @param pivotDegrees if this object is its control's pivot marker: the swing
 *                     at full travel, degrees (0 if the name gives none); NaN
 *                     if it isn't a pivot
 * @param lightGroup   {@code LCG_} control group, or null
 * @param lightInvert  lit while the group is <i>off</i> ({@code LINVERT})
 * @param fullbright   glows at full brightness while lit
 * @param headlight    a headlight lamp ({@code HEADLIGHT_<n>}): flare, beam
 * @param rgb          the lamp colour {@code 0xRRGGBB} (white if not given)
 */
public record ObjectRole(Control control, float pivotDegrees, String lightGroup,
        boolean lightInvert, boolean fullbright, boolean headlight, int rgb) {

    /** What a control drives or shows. Order matters: more specific names first. */
    public enum Kind {
        GAUGE_SPEED("GAUGE_SPEED", true),
        GAUGE_THROTTLE("GAUGE_THROTTLE", true),
        GAUGE_REVERSER("GAUGE_REVERSER", true),
        GAUGE_TRAIN_BRAKE("GAUGE_TRAIN_BRAKE", true),
        GAUGE_INDEPENDENT_BRAKE("GAUGE_(?:INDEPENDENT|IND)_BRAKE", true),
        BRAKE_PRESSURE("BRAKE_PRESSURE", true),
        /** Readouts the mod has no value for (liquid, temperature, boiler, coupled): drawn at rest. */
        GAUGE_OTHER("(?:GAUGE_(?:LIQUID|TEMPERATURE|BOILER_PRESSURE)|COUPLED)", true),
        THROTTLE_BRAKE("THROTTLE_BRAKE", false),
        THROTTLE("THROTTLE", false),
        REVERSER("REVERSER", false),
        TRAIN_BRAKE("TRAIN_BRAKE", false),
        INDEPENDENT_BRAKE("(?:INDEPENDENT|IND)_BRAKE", false),
        BELL("BELL_CONTROL", false),
        WHISTLE("WHISTLE_CONTROL", false),
        HORN("HORN_CONTROL", false),
        ENGINE_START("ENGINE_START", false),
        WIDGET("WIDGET", false),
        WINDOW("WINDOW", false),
        /** A door leaf the asset moves by {@code ROT_}/{@code TL_} (SPEC §9.5); only {@link #door} reads it. */
        DOOR("DOOR", false);

        private final Pattern pattern;
        private final boolean gauge;

        Kind(String prefix, boolean gauge) {
            // IR: ".*<prefix>_#ID#.*" with #ID# = digits; not preceded by a
            // letter so GAUGE_THROTTLE never reads as THROTTLE
            this.pattern = Pattern.compile("(?:^|_)(" + prefix + ")_(\\d+)(?=_|$)");
            this.gauge = gauge;
        }

        /** True for a readout (moves by itself), false for something a player works. */
        public boolean gauge() {
            return gauge;
        }
    }

    /**
     * One control, as its objects' names declare it.
     *
     * @param key    {@code <KIND>_<n>} as written, e.g. {@code THROTTLE_1} — the
     *               identity shared by all of the control's objects
     * @param group  the control group it sets/reads: {@code _CG_<name>}, else {@code key}
     * @param slideX source-space slide at full travel ({@code TL_<f>_X}), blocks; same for Y/Z
     */
    public record Control(Kind kind, int id, String key, String group, String label,
            boolean toggle, boolean press, boolean invert, boolean hide, boolean noTouch,
            float offset, float rangeMin, float rangeMax,
            float slideX, float slideY, float slideZ) {
    }

    private static final Pattern CG = Pattern.compile("_CG_([^_]+)");
    private static final Pattern LABEL = Pattern.compile("_LABEL_([^_]+)");
    private static final Pattern OFFSET = Pattern.compile("_OFFSET_([^_]+)");
    private static final Pattern RANGE = Pattern.compile("_RANGE_([^_]*)_([^_]*)");
    private static final Pattern SLIDE = Pattern.compile("TL_([^_]*)_([XYZ])");
    private static final Pattern LCG = Pattern.compile("_LCG_([^_]+)");
    private static final Pattern RGB = Pattern.compile("_0[xX]([0-9A-Fa-f]{6})(?=_|$)");
    private static final Pattern HEADLIGHT = Pattern.compile("(?:^|_)HEADLIGHT_\\d+(?=_|$)");
    /** Blender's suffix on a duplicated object, {@code .001}. */
    private static final Pattern COPY_SUFFIX = Pattern.compile("\\.\\d{3}$");

    /** An object with no role in the convention. */
    public static final ObjectRole NONE = new ObjectRole(null, Float.NaN, null, false, false, false,
            0xFFFFFF);

    /** True if the object is its control's hinge marker ({@code …_ROT…}). */
    public boolean pivot() {
        return !Float.isNaN(pivotDegrees);
    }

    /** True if this object lights up with a control group (or always, if it has none). */
    public boolean lit() {
        return fullbright || headlight;
    }

    /** Read one object name. */
    public static ObjectRole parse(String objectName) {
        return parse(objectName, false);
    }

    /**
     * Read an object name as a door leaf (SPEC §9.5): its {@code DOOR_<n>}
     * key, flags, hinge ({@code DOOR_<n>_ROT_<degrees>}) and slide
     * ({@code TL_<f>_<axis>}), the way {@link #parse} reads a cab control;
     * null if the name isn't a door's. {@link #parse} never returns a door —
     * a leaf is worked through its wagon type's door, not as a control.
     */
    public static ObjectRole door(String objectName) {
        ObjectRole role = parse(objectName, true);
        return role.control() != null ? role : null;
    }

    private static ObjectRole parse(String objectName, boolean door) {
        // case matters, as in IR (group names like BgL, Door1)
        String name = COPY_SUFFIX.matcher(objectName).replaceFirst("");
        Control control = control(name, door);
        float pivot = Float.NaN;
        if (control != null && name.contains(control.key() + "_ROT")) {
            pivot = degreesAfterRot(name);
        }
        Matcher lcg = LCG.matcher(name);
        String lightGroup = lcg.find() ? lcg.group(1) : null;
        Matcher rgb = RGB.matcher(name);
        int colour = rgb.find() ? Integer.parseInt(rgb.group(1), 16) : 0xFFFFFF;
        boolean headlight = HEADLIGHT.matcher(name).find();
        boolean fullbright = hasToken(name, "FULLBRIGHT");
        if (control == null && lightGroup == null && !headlight && !fullbright) {
            return NONE;
        }
        return new ObjectRole(control, pivot, lightGroup, hasToken(name, "LINVERT"),
                fullbright, headlight, colour);
    }

    private static Control control(String name, boolean door) {
        for (Kind kind : Kind.values()) {
            if ((kind == Kind.DOOR) != door) {
                continue;
            }
            Matcher m = kind.pattern.matcher(name);
            if (!m.find()) {
                continue;
            }
            String key = m.group(1) + "_" + m.group(2);
            Matcher cg = CG.matcher(name);
            Matcher label = LABEL.matcher(name);
            Matcher offset = OFFSET.matcher(name);
            float rangeMin = 0.0F;
            float rangeMax = 1.0F;
            Matcher range = RANGE.matcher(name);
            while (range.find()) {
                rangeMin = parseFloat(range.group(1), 0.0F);
                rangeMax = parseFloat(range.group(2), 1.0F);
            }
            float[] slide = new float[3];
            Matcher tl = SLIDE.matcher(name);
            while (tl.find()) {
                slide[tl.group(2).charAt(0) - 'X'] = parseFloat(tl.group(1), 0.0F);
            }
            return new Control(kind, Integer.parseInt(m.group(2)), key,
                    cg.find() ? cg.group(1) : key,
                    label.find() ? label.group(1).replace('^', ' ') : null,
                    hasToken(name, "TOGGLE"), hasToken(name, "PRESS"), hasToken(name, "INVERT"),
                    hasToken(name, "HIDE"), hasToken(name, "NOTOUCH") || hasToken(name, "NOINTERACT"),
                    offset.find() ? parseFloat(offset.group(1), 0.0F) : 0.0F,
                    rangeMin, rangeMax, slide[0], slide[1], slide[2]);
        }
        return null;
    }

    /** The number after the {@code ROT} token ({@code …_ROT_90} → 90), 0 if none. */
    private static float degreesAfterRot(String name) {
        String[] tokens = name.split("_");
        for (int i = 0; i < tokens.length - 1; i++) {
            if (tokens[i].equals("ROT")) {
                return parseFloat(tokens[i + 1], 0.0F);
            }
        }
        return 0.0F;
    }

    /** IR's flag test: {@code _T_} inside, {@code T_} at the start or {@code _T} at the end. */
    public static boolean hasToken(String name, String token) {
        return name.contains("_" + token + "_") || name.startsWith(token + "_")
                || name.endsWith("_" + token) || name.equals(token);
    }

    private static float parseFloat(String text, float fallback) {
        try {
            return Float.parseFloat(text);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
