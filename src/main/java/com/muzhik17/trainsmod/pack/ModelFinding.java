package com.muzhik17.trainsmod.pack;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * One thing {@link ModelCheck} finds wrong with the files a wagon model
 * declaration names, as data: what kind of thing ({@link Code}, a stable
 * name the pack editor words and links by), how bad (its code's {@link
 * PackProblem.Severity}), the names and numbers its line is made of
 * ({@link #params}), and the line itself ({@link #text}) — built from those
 * by the one function here, word for word the line {@code /rwatc packs
 * validate} shows. Where the line carries why a file doesn't read, that is
 * a param too: the JVM's words of the exception the reader threw
 * ({@code detail}: its message, {@code error}: the exception as Java writes
 * it). Pure.
 *
 * <p>Ported: {@code editor/src/ports/modelCheck.ts} ({@code MODEL_CODES},
 * {@code modelFindingText}); golden: {@code fixtures/golden/model_check/}.
 *
 * @param code   what kind of thing is wrong
 * @param params name → value, in the order the line uses them: a
 *               {@link String} (a location, a name, a reason) or an
 *               {@link Integer} ({@code limit}); each code's are listed on it
 */
public record ModelFinding(Code code, Map<String, Object> params) {

    /**
     * The kinds of thing {@link ModelCheck} finds, in the order it looks for
     * them: stable names (the editor translates by {@link #key}, the golden
     * data compares it), each an error (the model, or the part named, does
     * not load as meant) or a warning. Params are given as {@code name: what};
     * {@code path} is the OBJ's location unless said otherwise.
     */
    public enum Code {
        /** The OBJ's path is no resource location. {@code path}. */
        BAD_PATH(PackProblem.Severity.ERROR),
        /** The OBJ isn't there. {@code path}. */
        MISSING(PackProblem.Severity.ERROR),
        /**
         * A face names a vertex, texture coordinate or normal that isn't
         * there. {@code path}; {@code detail}: the index error's message.
         */
        BAD_FACE_INDEX(PackProblem.Severity.ERROR),
        /** The OBJ doesn't read. {@code path}; {@code error}: why, as Java writes the exception. */
        UNREADABLE(PackProblem.Severity.ERROR),
        /** The OBJ has no faces. {@code path}. */
        NO_FACES(PackProblem.Severity.ERROR),
        /** An {@code mtllib} path climbs out or is no resource location. {@code path}; {@code library}: as written. */
        BAD_LIBRARY_PATH(PackProblem.Severity.ERROR),
        /** A material library isn't there. {@code path}; {@code library}: its location. */
        MISSING_LIBRARY(PackProblem.Severity.ERROR),
        /** A material library doesn't read. {@code path}; {@code library}: its location; {@code error}. */
        UNREADABLE_LIBRARY(PackProblem.Severity.ERROR),
        /**
         * A material's {@code map_Kd} climbs out or is no resource location.
         * {@code path}; {@code material}; {@code texture}: as written.
         */
        BAD_TEXTURE_PATH(PackProblem.Severity.ERROR),
        /** A material's texture isn't there. {@code path}; {@code texture}: its location; {@code material}. */
        MISSING_TEXTURE(PackProblem.Severity.ERROR),
        /** No face of the model has a textured material. {@code path}. */
        DRAWS_NOTHING(PackProblem.Severity.ERROR),
        /**
         * Faces whose material has no texture, hinge markers aside: they
         * aren't drawn. {@code path}; {@code materials}: their names, each
         * once in the order the parts come, {@code (none)} for no material,
         * joined by {@code ", "}.
         */
        UNTEXTURED_FACES(PackProblem.Severity.WARNING),
        /**
         * A control group named longer than the wire takes: the model loader
         * drops it. {@code path}; {@code group}: its name; {@code limit}: the
         * longest a name may be.
         */
        GROUP_TOO_LONG(PackProblem.Severity.WARNING),
        /**
         * An animation's path is no resource location. {@code door}: its key,
         * lower case as the engine keeps it; {@code path}: the {@code .anim}'s.
         */
        BAD_ANIMATION_PATH(PackProblem.Severity.ERROR),
        /** An animation's {@code .anim} isn't there. {@code door}; {@code path}. */
        MISSING_ANIMATION(PackProblem.Severity.ERROR),
        /** An animation's {@code .anim} doesn't read. {@code door}; {@code path}; {@code error}. */
        UNREADABLE_ANIMATION(PackProblem.Severity.ERROR),
        /**
         * A livery whose folder holds no texture of the model's file names.
         * {@code livery}: its id; {@code folder}: its folder next to the OBJ.
         */
        LIVERY_REPLACES_NOTHING(PackProblem.Severity.WARNING);

        private final PackProblem.Severity severity;

        Code(PackProblem.Severity severity) {
            this.severity = severity;
        }

        /** How bad a finding of this kind is. */
        public PackProblem.Severity severity() {
            return severity;
        }

        /**
         * The name the editor and the golden data know the code by: lower
         * case, words by hyphens ({@code MISSING_TEXTURE} is
         * {@code missing-texture}; the editor's {@code model.missing-texture}).
         */
        public String key() {
            return name().toLowerCase(Locale.ROOT).replace('_', '-');
        }
    }

    public ModelFinding {
        Objects.requireNonNull(code, "code");
        params = Collections.unmodifiableMap(new LinkedHashMap<>(params));
    }

    /** A finding with its params given as name, value, name, value, … in the line's order. */
    static ModelFinding of(Code code, Object... params) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < params.length; i += 2) {
            map.put((String) params[i], params[i + 1]);
        }
        return new ModelFinding(code, map);
    }

    /** How bad this finding is: its code's. */
    public PackProblem.Severity severity() {
        return code.severity();
    }

    /** This finding as a problem of the declaration at {@code origin}, its line the message. */
    public PackProblem problem(PackOrigin origin) {
        return new PackProblem(severity(), origin.pack(), origin.file(), text());
    }

    /**
     * The line {@code /rwatc packs validate} shows, in English, made of the
     * code and the params alone.
     */
    public String text() {
        String path = string("path");
        return switch (code) {
            case BAD_PATH -> "model path '" + path + "' is not a valid resource location";
            case MISSING -> "model file " + path + " not found";
            case BAD_FACE_INDEX -> "model " + path + ": a face refers to a vertex, texture coordinate or normal that"
                    + " isn't there (" + string("detail") + "); indices count from 1, negative ones aren't supported";
            case UNREADABLE -> "model " + path + " can't be read: " + string("error");
            case NO_FACES -> "model " + path + " has no faces";
            case BAD_LIBRARY_PATH -> "model " + path + ": material library path '" + string("library") + "' is invalid";
            case MISSING_LIBRARY -> "model " + path + ": material library " + string("library") + " not found";
            case UNREADABLE_LIBRARY -> "model " + path + ": material library " + string("library") + " can't be read: "
                    + string("error");
            case BAD_TEXTURE_PATH -> "model " + path + ": material " + string("material")
                    + " has an invalid texture path '" + string("texture") + "'";
            case MISSING_TEXTURE -> "model " + path + ": texture " + string("texture") + " of material "
                    + string("material") + " not found";
            case DRAWS_NOTHING -> "model " + path + " draws nothing: no face has a textured material";
            case UNTEXTURED_FACES -> "model " + path + ": faces with no texture (map_Kd) aren't drawn, material(s) "
                    + string("materials");
            case GROUP_TOO_LONG -> "model " + path + ": control group '" + string("group") + "' is longer than "
                    + string("limit") + " characters and is dropped: its switches can't be worked, its lights stay"
                    + " off (an LINVERT one on)";
            case BAD_ANIMATION_PATH -> "animation '" + string("door") + "': path '" + path
                    + "' is not a valid resource location";
            case MISSING_ANIMATION -> "animation '" + string("door") + "': file " + path + " not found";
            case UNREADABLE_ANIMATION -> "animation '" + string("door") + "': " + path + " can't be read: "
                    + string("error");
            case LIVERY_REPLACES_NOTHING -> "livery '" + string("livery") + "' replaces no texture (folder "
                    + string("folder") + " next to the model)";
        };
    }

    private String string(String name) {
        return String.valueOf(params.get(name));
    }
}
