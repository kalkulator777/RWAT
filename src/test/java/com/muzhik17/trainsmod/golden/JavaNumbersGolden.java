package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.Locale;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;

/**
 * {@code fixtures/golden/java_numbers/}: the number rules of the JDK the
 * engine leans on, which JavaScript has otherwise — {@link Float#parseFloat}
 * (how {@code ObjectRole} reads {@code OFFSET}, {@code RANGE}, {@code TL},
 * {@code ROT_<degrees>} and the OBJ loader its coordinates; a refused text is
 * the reader's fallback), {@code String.format(Locale.ROOT, "%.<n>f")} (the
 * numbers in {@code FloorCheck}'s texts) and {@link Double#toString(double)}
 * (a number in {@code WagonTypeParser}'s errors that is not whole, the slack
 * in {@code FloorCheck}'s) and {@link Integer#parseInt(String)} (the OBJ
 * loader's face indices, whose refusal {@code ModelCheck} words). A case with
 * {@code input.text} is a parse, one with {@code input.digits} a format, one
 * with {@code input.double} a {@code toString}, one with {@code input.int} an
 * int's parse (null: refused). Ported: {@code editor/src/ports/javaNumbers.ts}
 * ({@code parseJavaFloat}, {@code formatFixed}, {@code javaDoubleToString},
 * {@code parseJavaInt}).
 */
class JavaNumbersGolden {

    static final String FOLDER = "java_numbers";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            if (in.has("text")) {
                try {
                    return Golden.exactFloat(Float.parseFloat(in.get("text").getAsString()));
                } catch (NumberFormatException e) {
                    return JsonNull.INSTANCE;
                }
            }
            if (in.has("double")) {
                return new JsonPrimitive(Double.toString(Golden.toDouble(in.get("double"))));
            }
            if (in.has("int")) {
                try {
                    return new JsonPrimitive(Integer.parseInt(in.get("int").getAsString()));
                } catch (NumberFormatException e) {
                    return JsonNull.INSTANCE;
                }
            }
            int digits = in.get("digits").getAsInt();
            return new JsonPrimitive(String.format(Locale.ROOT, "%." + digits + "f", Golden.toDouble(in.get("value"))));
        });
    }
}
