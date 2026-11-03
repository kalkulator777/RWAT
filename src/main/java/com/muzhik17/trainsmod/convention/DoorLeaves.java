package com.muzhik17.trainsmod.convention;

import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import com.muzhik17.trainsmod.stock.ObjFrame;
import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Which objects of a wagon model are door leaves the asset moves by name, and
 * which of the wagon type's doors each one is (SPEC §9.5) — the rule the model
 * loader builds the leaves by ({@link ModelParts}), which the pack checks and
 * the editor read too. Pure.
 *
 * <p>An object is a part of door {@code DOOR_<n>}'s leaf when
 * <ul>
 *   <li>its name reads as that door ({@link ObjectRole#door}: {@code DOOR_<n>}
 *       anywhere in it, a copy suffix aside);</li>
 *   <li>it is a part of its own: no {@code HIDE} in the name, no skipped
 *       prefix, not a bogie's ({@code BOGEY_FRONT…}, {@code BOGEY_REAR…}), not a
 *       coupler head, not moved by an {@code .anim} (named in one exactly). Its
 *       texture doesn't matter: a hinge marker of a material without one is not
 *       drawn and still makes the leaf;</li>
 *   <li>and the door moves by name: one of its objects so read is the hinge
 *       marker {@code DOOR_<n>_ROT[_<degrees>]} or slides ({@code TL_<f>_<axis>}).</li>
 * </ul>
 * Any other {@code DOOR_<n>} object is rigid body: a door the asset doesn't
 * move. A leaf swings with the type's door whose box holds the centre of its
 * drawn faces ({@link #door}).
 *
 * <p>Ported: {@code editor/src/ports/doorLeaves.ts}; golden:
 * {@code fixtures/golden/door_leaves/}.
 */
public final class DoorLeaves {

    /** The keys {@code DOOR_<n>} of the doors the asset moves by name. */
    private final Set<String> keys;
    private final List<String> skipPrefixes;
    private final Set<String> animated;

    private DoorLeaves(Set<String> keys, List<String> skipPrefixes, Set<String> animated) {
        this.keys = Collections.unmodifiableSet(new LinkedHashSet<>(keys));
        this.skipPrefixes = List.copyOf(skipPrefixes);
        this.animated = Set.copyOf(animated);
    }

    /**
     * The door leaves of a model.
     *
     * @param objects      the model's object names (order and repeats don't matter)
     * @param skipPrefixes the name prefixes the model drops: the convention's
     *                     ({@code CARGO_FILL}) and its declaration's {@code skip}
     * @param animated     the objects its declared {@code .anim}s move
     */
    public static DoorLeaves of(Collection<String> objects, List<String> skipPrefixes, Set<String> animated) {
        Set<String> keys = new LinkedHashSet<>();
        for (String object : objects) {
            ObjectRole door = doorPart(object, skipPrefixes, animated);
            if (door != null && moves(door)) {
                keys.add(door.control().key());
            }
        }
        return new DoorLeaves(keys, skipPrefixes, animated);
    }

    /** The keys {@code DOOR_<n>} of the doors the model moves by name, in the order their objects come. */
    public Set<String> keys() {
        return keys;
    }

    /**
     * The door leaf {@code object} is a part of, read as {@link ObjectRole#door}
     * (its hinge, slide, flags); null if it isn't one.
     */
    public ObjectRole leaf(String object) {
        ObjectRole door = doorPart(object, skipPrefixes, animated);
        return door != null && keys.contains(door.control().key()) ? door : null;
    }

    /**
     * The type's door a leaf is, by the box of its drawn faces in the OBJ frame:
     * the door whose box holds the box's centre ({@link WagonType#doorHolding});
     * −1 if none — the leaf is drawn shut.
     */
    public static int door(WagonType type, double[] minObj, double[] maxObj) {
        double[] centre = ObjFrame.point((minObj[0] + maxObj[0]) * 0.5, (minObj[1] + maxObj[1]) * 0.5,
                (minObj[2] + maxObj[2]) * 0.5);
        return type.doorHolding(centre[0], centre[1], centre[2]);
    }

    /** The object read as a door ({@link ObjectRole#door}) if it is a part of its own (drawn or not); else null. */
    private static ObjectRole doorPart(String object, List<String> skipPrefixes, Set<String> animated) {
        if (object.contains("HIDE") || object.startsWith("BOGEY_FRONT") || object.startsWith("BOGEY_REAR")
                || animated.contains(object) || ObjectRole.coupled(object) != null) {
            return null;
        }
        for (String prefix : skipPrefixes) {
            if (object.startsWith(prefix)) {
                return null;
            }
        }
        return ObjectRole.door(object);
    }

    /** True if this door object is its door's hinge marker or slides. */
    private static boolean moves(ObjectRole door) {
        ObjectRole.Control c = door.control();
        return door.pivot() || c.slideX() != 0.0F || c.slideY() != 0.0F || c.slideZ() != 0.0F;
    }
}
