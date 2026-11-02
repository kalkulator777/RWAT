package com.muzhik17.trainsmod.convention;

import java.util.ArrayList;
import java.util.List;

/**
 * A control group's name as it travels between client and server (SPEC
 * §8–§9): a switch's {@code _CG_<name>} (else its own key) when it is worked,
 * a light's {@code _LCG_<name>} when the driver's panel switches it. A name
 * is at most {@link #MAX_LENGTH} characters on the wire; the client used to
 * write a longer one into the packet as the model named it, and the packet
 * codec threw — the player was cut off their server (audit M9). So the
 * model loader drops a longer group as the model is loaded, with a warning,
 * and the pack check names it ({@code ModelCheck}): such a switch is drawn
 * but can't be worked, and such a light is as a group never switched leaves
 * it — off, or on for an {@code LINVERT} one. Pure.
 */
public final class GroupName {

    /** The longest group name sent or kept: the server keeps groups by name. */
    public static final int MAX_LENGTH = 32;

    private GroupName() {
    }

    /** True if {@code name} can be a control group on the wire: not empty, at most {@link #MAX_LENGTH} characters. */
    public static boolean fits(String name) {
        return name != null && !name.isEmpty() && name.length() <= MAX_LENGTH;
    }

    /**
     * True if working the control sets its group (a switch, a window, a
     * button — what {@code ControlGroupPayload} carries): not a handle lever,
     * which moves the train's handles, nor the handbrake wheel, a gauge or a
     * door leaf, whose groups never travel.
     */
    public static boolean worksGroup(ObjectRole.Control control) {
        ObjectRole.Kind kind = control.kind();
        return !kind.gauge() && kind != ObjectRole.Kind.HANDBRAKE && kind != ObjectRole.Kind.DOOR
                && ControlValue.handle(kind) == null;
    }

    /** The groups of an object's role too long to travel, in order — its control's, its light's; empty if none. */
    public static List<String> tooLong(ObjectRole role) {
        List<String> names = new ArrayList<>(2);
        ObjectRole.Control control = role.control();
        if (control != null && worksGroup(control) && !fits(control.group())) {
            names.add(control.group());
        }
        if (role.lightGroup() != null && !fits(role.lightGroup())) {
            names.add(role.lightGroup());
        }
        return names;
    }

    /**
     * {@code role} without the groups too long to travel ({@link #tooLong}):
     * a control keeps its own key for a group and can't be worked ({@code
     * NO_TOUCH}) — its group would never reach the server; a light lit by a
     * group that is never switched is off, an inverted one ({@code LINVERT})
     * always on. The role itself if every group fits.
     */
    public static ObjectRole fit(ObjectRole role) {
        ObjectRole.Control control = role.control();
        if (control != null && worksGroup(control) && !fits(control.group())) {
            control = new ObjectRole.Control(control.kind(), control.id(), control.key(), control.key(),
                    control.label(), control.toggle(), control.press(), control.invert(), control.hide(), true,
                    control.global(), control.offset(), control.rangeMin(), control.rangeMax(),
                    control.slideX(), control.slideY(), control.slideZ());
        }
        String light = role.lightGroup();
        boolean invert = role.lightInvert();
        boolean fullbright = role.fullbright();
        boolean headlight = role.headlight();
        if (light != null && !fits(light)) {
            light = null; // no group: lit always — so an inverted light only, the rest never
            fullbright &= invert;
            headlight &= invert;
            invert = false;
        }
        if (control == role.control() && light == role.lightGroup()) {
            return role;
        }
        return new ObjectRole(control, role.pivotDegrees(), light, invert, fullbright, headlight, role.rgb());
    }
}
