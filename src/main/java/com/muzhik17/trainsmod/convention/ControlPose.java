package com.muzhik17.trainsmod.convention;

import org.joml.Matrix4f;
import org.joml.Vector3fc;

/**
 * How a cab control or a door leaf moved by name is moved by its value (SPEC
 * §9.3, §9.5), the way Immersive Railroading moves it: a slide of
 * {@code value × slide} ({@code TL_<f>_<axis>}), then a turn of
 * {@code value × degrees} ({@code …_ROT_<degrees>}) about {@code axis}
 * through {@code pivot} ({@link PivotAxis}). The value is the control's
 * ({@link ControlValue#value}); a leaf's is its door's openness. The
 * transform is the same in any frame, the hinge and the slide given in it.
 * Pure.
 *
 * <p>Ported: {@code editor/src/ports/controlPose.ts}; golden:
 * {@code fixtures/golden/control_pose/}.
 */
public final class ControlPose {

    private ControlPose() {
    }

    /**
     * The transform at {@code value} into {@code dest}: identity, then the
     * slide, then — if there is a hinge and a swing — the turn about it.
     *
     * @param slide   the slide at full travel
     * @param pivot   the hinge, or null for none (no turn)
     * @param axis    the hinge axis (unit)
     * @param degrees the swing at full travel
     * @return {@code dest}
     */
    public static Matrix4f transform(float value, Vector3fc slide, Vector3fc pivot, Vector3fc axis,
            float degrees, Matrix4f dest) {
        dest.identity().translate(slide.x() * value, slide.y() * value, slide.z() * value);
        if (pivot != null && degrees != 0.0F) {
            dest.translate(pivot)
                    .rotate((float) Math.toRadians(value * degrees), axis)
                    .translate(-pivot.x(), -pivot.y(), -pivot.z());
        }
        return dest;
    }
}
