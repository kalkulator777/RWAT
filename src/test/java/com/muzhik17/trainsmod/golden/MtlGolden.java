package com.muzhik17.trainsmod.golden;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.client.render.model.MtlParser;

/**
 * {@code fixtures/golden/mtl/}: what an MTL and the paths in it say
 * ({@link MtlParser}: {@code materialName}, {@code parse}, {@code resolve},
 * {@code folderOf}, {@code fileNameOf}). Ported: {@code editor/src/ports/mtl.ts};
 * the material name and the reading of an MTL also {@code tools/ir2rwat.py}
 * ({@code material_name}, {@code parse_mtl}).
 */
class MtlGolden {

    static final String FOLDER = "mtl";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            if (in.has("line")) {
                return Golden.string(MtlParser.materialName(in.get("line").getAsString(),
                        in.get("keyword").getAsString()));
            }
            if (in.has("text")) {
                JsonObject maps = new JsonObject();
                MtlParser.parse(new ByteArrayInputStream(in.get("text").getAsString()
                        .getBytes(StandardCharsets.UTF_8))).forEach(maps::addProperty);
                return maps;
            }
            if (in.has("resolve")) {
                JsonArray args = in.getAsJsonArray("resolve");
                return Golden.string(MtlParser.resolve(args.get(0).getAsString(), args.get(1).getAsString()));
            }
            if (in.has("folder_of")) {
                return Golden.string(MtlParser.folderOf(in.get("folder_of").getAsString()));
            }
            return Golden.string(MtlParser.fileNameOf(in.get("file_name_of").getAsString()));
        });
    }
}
