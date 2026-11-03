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
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.client.render.model.WagonModelDecl;
import com.muzhik17.trainsmod.pack.ModelCheck;
import com.muzhik17.trainsmod.pack.PackOrigin;
import com.muzhik17.trainsmod.pack.PackProblem;

/**
 * {@code fixtures/golden/model_check/}: a wagon model declaration and the
 * files of a pack → what the check of {@code /rwatc packs validate} says of
 * them ({@link ModelCheck#check} after {@link WagonModelDecl#parse}), in its
 * order: each problem's severity and, as the editor reads it, the finding
 * {@code {code, subject, index, params, text}} — the engine gives only the
 * text yet ({@link Golden#finding(String)}). Ported:
 * {@code editor/src/ports/modelCheck.ts}.
 *
 * <p>The input: {@code namespace} (the declaring file's, for unqualified
 * paths), {@code declaration} (its JSON), {@code files} ({@code ns:path} →
 * text), {@code present} (locations that are there, their contents unread:
 * textures), and any other key with a colon — what {@code input_file} reads of
 * the example pack — a file too. A location is valid as Minecraft's
 * {@code ResourceLocation} takes it: {@code [a-z0-9_.-]+:[a-z0-9/._-]+}.
 */
class ModelCheckGolden {

    static final String FOLDER = "model_check";

    private static final PackOrigin ORIGIN = new PackOrigin("golden", "wagon_models/case.json");

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            WagonModelDecl decl = WagonModelDecl.parse(in.get("namespace").getAsString(),
                    in.getAsJsonObject("declaration"));
            JsonArray out = new JsonArray();
            for (PackProblem problem : ModelCheck.check(decl, ORIGIN, files(in))) {
                JsonObject found = new JsonObject();
                found.addProperty("severity", problem.isError() ? "error" : "warning");
                found.add("finding", Golden.finding(problem.message()));
                out.add(found);
            }
            return out;
        });
    }

    /** The case's pack: its files with their text, and the ones only there. */
    private static ModelCheck.Files files(JsonObject in) {
        Map<String, String> texts = new LinkedHashMap<>();
        if (in.has("files")) {
            in.getAsJsonObject("files").entrySet().forEach(file -> texts.put(file.getKey(), file.getValue().getAsString()));
        }
        for (Map.Entry<String, JsonElement> entry : in.entrySet()) {
            if (entry.getKey().contains(":")) {
                texts.put(entry.getKey(), entry.getValue().getAsString());
            }
        }
        Set<String> present = new HashSet<>(Golden.strings(in, "present"));
        return new ModelCheck.Files() {
            @Override
            public boolean valid(String location) {
                return location.matches("[a-z0-9_.-]+:[a-z0-9/._-]+");
            }

            @Override
            public boolean exists(String location) {
                return texts.containsKey(location) || present.contains(location);
            }

            @Override
            public InputStream open(String location) throws IOException {
                String text = texts.containsKey(location) ? texts.get(location) : present.contains(location) ? "" : null;
                if (text == null) {
                    throw new FileNotFoundException(location);
                }
                return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
            }
        };
    }
}
