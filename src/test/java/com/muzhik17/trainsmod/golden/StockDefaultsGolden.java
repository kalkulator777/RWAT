package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.stock.StockDefaults;
import com.muzhik17.trainsmod.stock.WagonType;

/**
 * {@code fixtures/golden/stock_defaults/}: what a type gets for the physics
 * its pack leaves out ({@link StockDefaults}): the running resistance of a
 * mass, the brakes of a system, a mass and a cab or none, a system by its
 * name, and the engine's constants. Ported:
 * {@code editor/src/ports/stockDefaults.ts}.
 */
class StockDefaultsGolden {

    static final String FOLDER = "stock_defaults";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            JsonObject out = new JsonObject();
            if (in.has("system_name")) {
                StockDefaults.BrakeSystem system = StockDefaults.BrakeSystem.byName(in.get("system_name").getAsString());
                return Golden.string(system == null ? null : system.jsonName());
            }
            if (in.has("constants")) {
                out.add("adhesion", Golden.number(StockDefaults.ADHESION));
                out.add("traction_ramp_s", Golden.number(StockDefaults.TRACTION_RAMP_S));
                out.addProperty("default_brake_system", StockDefaults.DEFAULT_BRAKE_SYSTEM.jsonName());
                JsonObject systems = new JsonObject();
                for (StockDefaults.BrakeSystem system : StockDefaults.BrakeSystem.values()) {
                    JsonObject s = new JsonObject();
                    s.add("kn_per_tonne", Golden.number(system.knPerTonne()));
                    s.add("apply_s", Golden.number(system.applyS()));
                    s.add("release_s", Golden.number(system.releaseS()));
                    systems.add(system.jsonName(), s);
                }
                out.add("systems", systems);
                return out;
            }
            double massT = Golden.toDouble(in.get("mass_t"));
            out.add("resistance", resistance(StockDefaults.resistance(massT)));
            StockDefaults.BrakeSystem system = StockDefaults.BrakeSystem.byName(in.get("system").getAsString());
            out.add("brakes", brakes(StockDefaults.brakes(system, massT, in.get("drivable").getAsBoolean())));
            return out;
        });
    }

    /** Running resistance as the cases write it (here and in {@code wagon_type/}). */
    static JsonObject resistance(WagonType.Resistance r) {
        JsonObject out = new JsonObject();
        out.add("a", Golden.number(r.a()));
        out.add("b", Golden.number(r.b()));
        out.add("c", Golden.number(r.c()));
        out.add("c_front", Golden.number(r.cFront()));
        return out;
    }

    /** Brakes as the cases write them (here and in {@code wagon_type/}). */
    static JsonObject brakes(WagonType.Brakes b) {
        JsonObject out = new JsonObject();
        out.add("train_kn", Golden.number(b.trainKn()));
        out.add("independent_kn", Golden.number(b.independentKn()));
        out.add("dynamic_kn", Golden.number(b.dynamicKn()));
        out.add("dynamic_fade_kmh", Golden.number(b.dynamicFadeKmh()));
        out.add("parking_kn", Golden.number(b.parkingKn()));
        out.add("apply_s", Golden.number(b.applyS()));
        out.add("release_s", Golden.number(b.releaseS()));
        return out;
    }
}
