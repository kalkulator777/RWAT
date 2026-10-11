package com.muzhik17.trainsmod.client.sound;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

import com.google.gson.JsonParser;
import com.google.gson.JsonSyntaxException;
import com.muzhik17.trainsmod.client.render.model.WagonModelDecl;

/** A wagon's sounds as its model declaration names them (SPEC §10), and the Ogg facts read from the files. */
class SoundSetTest {

    private static SoundSet parse(String text) {
        return SoundSet.parse("mvp", JsonParser.parseString(text).getAsJsonObject());
    }

    @Test
    void parsesLoopsSignalsDoorsAndControls() {
        SoundSet sounds = parse("""
                {
                  "idle": { "main": "stock/sounds/idle.ogg", "pitch": [1.0, 1.5], "volume": [0.5, 1.0] },
                  "horn": { "start": "stock/sounds/h1.ogg", "main": "stock/sounds/h2.ogg", "stop": "stock/sounds/h3.ogg" },
                  "bell": "stock/sounds/bell.ogg",
                  "wheels": "minecraft:entity.minecart.riding",
                  "clack": "other:sounds/clack.ogg",
                  "doors": { "Door1": "stock/sounds/door.ogg" },
                  "controls": { "throttle_1": { "move": "stock/sounds/notch.ogg" },
                                "TRAIN_BRAKE_1": { "engage": "stock/sounds/hiss.ogg" } }
                }""");
        assertEquals("mvp:stock/sounds/idle.ogg", sounds.idle().main());
        assertArrayEquals(new float[] {1.0F, 1.5F}, sounds.idle().pitch());
        assertArrayEquals(new float[] {0.5F, 1.0F}, sounds.idle().volume());
        assertEquals("mvp:stock/sounds/h1.ogg", sounds.horn().start());
        assertEquals("mvp:stock/sounds/h3.ogg", sounds.horn().stop());
        assertEquals("mvp:stock/sounds/bell.ogg", sounds.bell().main());
        assertNull(sounds.bell().start());
        assertNull(sounds.bell().pitch());
        assertEquals("minecraft:entity.minecart.riding", sounds.wheels().main());
        assertFalse(SoundSet.isFile(sounds.wheels().main()));
        assertEquals("other:sounds/clack.ogg", sounds.clack());
        assertTrue(SoundSet.isFile(sounds.clack()));
        assertEquals("mvp:stock/sounds/door.ogg", sounds.doors().get("door1"));
        assertEquals("mvp:stock/sounds/notch.ogg", sounds.controls().get("THROTTLE_1").move());
        assertEquals("mvp:stock/sounds/hiss.ogg", sounds.controls().get("TRAIN_BRAKE_1").engage());
    }

    @Test
    void aDeclarationWithoutSoundsHasNone() {
        WagonModelDecl decl = WagonModelDecl.parse("mvp",
                JsonParser.parseString("{ \"obj\": \"a.obj\" }").getAsJsonObject());
        assertSame(SoundSet.NONE, decl.sounds());
    }

    @Test
    void aLoopNeedsItsMainAndRangesTwoEnds() {
        assertThrows(JsonSyntaxException.class, () -> parse("{ \"horn\": { \"start\": \"a.ogg\" } }"));
        assertThrows(JsonSyntaxException.class,
                () -> parse("{ \"idle\": { \"main\": \"a.ogg\", \"pitch\": [1.0] } }"));
    }

    /** A minimal Ogg Vorbis file: identification page, then a last page whose granule position counts the samples. */
    private static byte[] ogg(int channels, int rate, long samples) {
        byte[] data = new byte[27 + 1 + 30 + 27 + 1 + 4];
        int at = page(data, 0, 0L, 30);
        data[at] = 1;
        System.arraycopy("vorbis".getBytes(), 0, data, at + 1, 6);
        data[at + 11] = (byte) channels;
        for (int i = 0; i < 4; i++) {
            data[at + 12 + i] = (byte) (rate >>> 8 * i);
        }
        page(data, at + 30, samples, 4);
        return data;
    }

    private static int page(byte[] data, int at, long granule, int size) {
        System.arraycopy("OggS".getBytes(), 0, data, at, 4);
        for (int i = 0; i < 8; i++) {
            data[at + 6 + i] = (byte) (granule >>> 8 * i);
        }
        data[at + 26] = 1;
        data[at + 27] = (byte) size;
        return at + 28;
    }

    @Test
    void readsLengthAndChannelsFromTheOggHeaders() {
        byte[] stereo = ogg(2, 44100, 88200);
        assertEquals(2.0, OggLength.seconds(stereo), 1e-9);
        assertEquals(2, OggLength.channels(stereo));
        assertEquals(1, OggLength.channels(ogg(1, 48000, 4800)));
        assertTrue(Double.isNaN(OggLength.seconds("not an ogg file at all, just text".getBytes())));
        assertEquals(0, OggLength.channels(new byte[10]));
    }

    /**
     * Every sound the generated packs declare is a file that is there and
     * reads as Ogg Vorbis (SPEC §10) — the converter copies them byte for byte.
     */
    @Test
    void everySoundOfTheGeneratedPacksIsThere() throws IOException {
        Path packs = Path.of("run/rwat_packs");
        assumeTrue(Files.isDirectory(packs), "no generated packs in " + packs);
        List<Path> models;
        try (Stream<Path> files = Files.walk(packs)) {
            models = files.filter(p -> p.toString().replace('\\', '/').contains("/wagon_models/")
                    && p.toString().endsWith(".json")).toList();
        }
        assumeTrue(!models.isEmpty(), "no wagon models in " + packs);
        int checked = 0;
        for (Path model : models) {
            Path assets = model.getParent().getParent().getParent(); // <pack>/assets
            String namespace = model.getParent().getParent().getFileName().toString();
            WagonModelDecl decl;
            try (Reader reader = Files.newBufferedReader(model)) {
                decl = WagonModelDecl.parse(namespace, JsonParser.parseReader(reader).getAsJsonObject());
            }
            for (String ref : refs(decl.sounds())) {
                if (!SoundSet.isFile(ref)) {
                    continue;
                }
                int colon = ref.indexOf(':');
                Path file = assets.resolve(ref.substring(0, colon)).resolve(ref.substring(colon + 1));
                assertTrue(Files.isRegularFile(file), model + ": " + ref + " missing");
                byte[] data = Files.readAllBytes(file);
                assertTrue(OggLength.seconds(data) > 0.05, model + ": " + ref + " doesn't read as Ogg Vorbis");
                checked++;
            }
        }
        assertTrue(checked > 100, "only " + checked + " sounds referenced");
    }

    private static List<String> refs(SoundSet sounds) {
        List<String> refs = new ArrayList<>();
        for (SoundSet.Loop loop : new SoundSet.Loop[] {sounds.idle(), sounds.horn(), sounds.bell(), sounds.wheels()}) {
            if (loop != null) {
                refs.add(loop.main());
                if (loop.start() != null) {
                    refs.add(loop.start());
                }
                if (loop.stop() != null) {
                    refs.add(loop.stop());
                }
            }
        }
        if (sounds.clack() != null) {
            refs.add(sounds.clack());
        }
        refs.addAll(sounds.doors().values());
        for (SoundSet.Control control : sounds.controls().values()) {
            if (control.move() != null) {
                refs.add(control.move());
            }
            if (control.engage() != null) {
                refs.add(control.engage());
            }
        }
        return refs;
    }
}
