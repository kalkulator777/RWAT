package com.muzhik17.trainsmod.golden;

import java.io.ByteArrayInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.muzhik17.trainsmod.client.render.model.WagonModelDecl;
import com.muzhik17.trainsmod.pack.ModelCheck;
import com.muzhik17.trainsmod.pack.ModelFinding;
import com.muzhik17.trainsmod.pack.PackProblem;
import com.muzhik17.trainsmod.pack.ResourceLocations;

/**
 * {@code fixtures/golden/model_check/}: a wagon model declaration and the
 * files of a pack → what the check of {@code /rwatc packs validate} says of
 * them ({@link ModelCheck#findings} after {@link WagonModelDecl#parse}), in
 * its order: each finding's severity and the finding as the editor reads it,
 * {@code {code, subject, index, params, text}} ({@link ModelFinding}: the
 * code's key, no subject or index — null —, the params in the order of the
 * line, the line). Ported: {@code editor/src/ports/modelCheck.ts}.
 *
 * <p>The input: {@code namespace} (the declaring file's, for unqualified
 * paths), {@code declaration} (its JSON), {@code files} ({@code ns:path} →
 * text), {@code present} (locations that are there, their contents unread:
 * textures), and any other key with a colon — what {@code input_file} reads of
 * the example pack — a file too. A location is valid as Minecraft's
 * {@code ResourceLocation.tryParse} takes it ({@link ResourceLocations}, its
 * rule written out), and names the file of its namespace and path as
 * {@link ModelCheck#namespace} and {@link ModelCheck#path} split it
 * ({@code :a} and {@code a} are {@code minecraft:a}).
 *
 * <p>Or the input is a {@code location} alone → how the check takes it:
 * {@code {valid, namespace, path}}.
 */
class ModelCheckGolden {

    static final String FOLDER = "model_check";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            if (in.has("location")) {
                String location = in.get("location").getAsString();
                JsonObject out = new JsonObject();
                out.addProperty("valid", ResourceLocations.valid(location));
                out.addProperty("namespace", ModelCheck.namespace(location));
                out.addProperty("path", ModelCheck.path(location));
                return out;
            }
            WagonModelDecl decl = WagonModelDecl.parse(in.get("namespace").getAsString(),
                    in.getAsJsonObject("declaration"));
            JsonArray out = new JsonArray();
            for (ModelFinding finding : ModelCheck.findings(decl, files(in))) {
                JsonObject found = new JsonObject();
                found.addProperty("severity", finding.severity() == PackProblem.Severity.ERROR ? "error" : "warning");
                found.add("finding", finding(finding));
                out.add(found);
            }
            return out;
        });
    }

    /** A finding: its code's key, its params (strings and whole numbers) in the line's order, its line. */
    private static JsonObject finding(ModelFinding finding) {
        JsonObject params = new JsonObject();
        finding.params().forEach((name, value) -> params.add(name,
                value instanceof Integer number ? new JsonPrimitive(number) : Golden.string((String) value)));
        JsonObject out = new JsonObject();
        out.addProperty("code", finding.code().key());
        out.add("subject", JsonNull.INSTANCE);
        out.add("index", JsonNull.INSTANCE);
        out.add("params", params);
        out.addProperty("text", finding.text());
        return out;
    }

    /** The case's pack: its files with their text, and the ones only there, each by the location Minecraft names it. */
    private static ModelCheck.Files files(JsonObject in) {
        Map<String, String> texts = new LinkedHashMap<>();
        if (in.has("files")) {
            in.getAsJsonObject("files").entrySet().forEach(file -> texts.put(ResourceLocations.normal(file.getKey()),
                    file.getValue().getAsString()));
        }
        for (Map.Entry<String, JsonElement> entry : in.entrySet()) {
            if (entry.getKey().contains(":")) {
                texts.put(ResourceLocations.normal(entry.getKey()), entry.getValue().getAsString());
            }
        }
        Set<String> present = new HashSet<>();
        Golden.strings(in, "present").forEach(location -> present.add(ResourceLocations.normal(location)));
        return new ModelCheck.Files() {
            @Override
            public boolean valid(String location) {
                return ResourceLocations.valid(location);
            }

            @Override
            public boolean exists(String location) {
                String file = ResourceLocations.normal(location);
                return valid(location) && (texts.containsKey(file) || present.contains(file));
            }

            @Override
            public InputStream open(String location) throws IOException {
                String file = ResourceLocations.normal(location);
                String text = !valid(location) ? null : texts.containsKey(file) ? texts.get(file)
                        : present.contains(file) ? "" : null;
                if (text == null) {
                    throw new FileNotFoundException(location);
                }
                return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
            }
        };
    }
}
