package com.muzhik17.trainsmod.golden;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.convention.ObjectRole;

/**
 * {@code fixtures/golden/object_role/}: an object's name → what the
 * convention reads in it ({@link ObjectRole}: {@code parse}, {@code door},
 * {@code coupled}, {@code hasToken(…, "INTERIOR")}). Ported:
 * {@code editor/src/ports/objectRole.ts}; in part {@code tools/ir2rwat.py}
 * (its {@code LIGHT_GROUP}, {@code DOOR_KEY}, {@code HEADLIGHT}).
 */
class ObjectRoleGolden {

    static final String FOLDER = "object_role";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            String name = input.getAsJsonObject().get("name").getAsString();
            ObjectRole role = ObjectRole.parse(name);
            JsonObject out = new JsonObject();
            out.add("control", control(role.control()));
            out.add("pivot_degrees", role.pivot() ? Golden.number(role.pivotDegrees()) : JsonNull.INSTANCE);
            out.add("light_group", Golden.string(role.lightGroup()));
            out.addProperty("light_invert", role.lightInvert());
            out.addProperty("fullbright", role.fullbright());
            out.addProperty("headlight", role.headlight());
            out.addProperty("rgb", String.format("%06X", role.rgb()));
            out.addProperty("interior_token", ObjectRole.hasToken(name, "INTERIOR"));
            ObjectRole door = ObjectRole.door(name);
            if (door == null) {
                out.add("door", JsonNull.INSTANCE);
            } else {
                JsonObject leaf = control(door.control()).getAsJsonObject();
                leaf.add("pivot_degrees", door.pivot() ? Golden.number(door.pivotDegrees()) : JsonNull.INSTANCE);
                out.add("door", leaf);
            }
            ObjectRole.Coupled coupled = ObjectRole.coupled(name);
            if (coupled == null) {
                out.add("coupled", JsonNull.INSTANCE);
            } else {
                JsonObject head = new JsonObject();
                head.addProperty("front", coupled.front());
                head.addProperty("shown", coupled.shown().name());
                out.add("coupled", head);
            }
            return out;
        });
    }

    private static JsonElement control(ObjectRole.Control c) {
        if (c == null) {
            return JsonNull.INSTANCE;
        }
        JsonObject out = new JsonObject();
        out.addProperty("kind", c.kind().name());
        out.addProperty("gauge", c.kind().gauge());
        out.addProperty("id", c.id());
        out.addProperty("key", c.key());
        out.addProperty("group", c.group());
        out.add("label", Golden.string(c.label()));
        out.addProperty("toggle", c.toggle());
        out.addProperty("press", c.press());
        out.addProperty("invert", c.invert());
        out.addProperty("hide", c.hide());
        out.addProperty("no_touch", c.noTouch());
        out.addProperty("global", c.global());
        out.add("offset", Golden.number(c.offset()));
        out.add("range", Golden.numbers(c.rangeMin(), c.rangeMax()));
        out.add("slide", Golden.numbers(c.slideX(), c.slideY(), c.slideZ()));
        return out;
    }

    /** Every example name of {@code schema/obj-conventions.json} is a case (editor.md 4.5, item 11). */
    @Test
    void everyExampleOfTheConventionsIsACase() throws IOException {
        Set<String> examples = new TreeSet<>();
        collect(Golden.read(Path.of("schema/obj-conventions.json")), examples);
        Set<String> names = new TreeSet<>();
        for (Path file : Golden.caseFiles(FOLDER)) {
            for (JsonElement c : Golden.read(file).getAsJsonArray("cases")) {
                JsonObject in = c.getAsJsonObject().getAsJsonObject("input");
                if (in != null && in.has("name")) {
                    names.add(in.get("name").getAsString());
                }
            }
        }
        List<String> missing = new ArrayList<>(examples);
        missing.removeAll(names);
        assertEquals(List.of(), missing, "examples of obj-conventions.json with no case in " + FOLDER);
    }

    private static void collect(JsonElement node, Set<String> examples) {
        if (node.isJsonObject()) {
            node.getAsJsonObject().entrySet().forEach(e -> {
                if (e.getKey().equals("examples") && e.getValue().isJsonArray()) {
                    e.getValue().getAsJsonArray().forEach(x -> examples.add(x.getAsString()));
                } else {
                    collect(e.getValue(), examples);
                }
            });
        } else if (node.isJsonArray()) {
            node.getAsJsonArray().forEach(item -> collect(item, examples));
        }
    }
}
