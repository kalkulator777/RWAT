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

    /** The files a set names, each once, sound events left out: what the sound engine is told about (SPEC §10.3). */
    @Test
    void listsItsFilesOnceAndNoSoundEvents() {
        SoundSet sounds = parse("""
                {
                  "idle": { "start": "s/start.ogg", "main": "s/idle.ogg", "stop": "s/stop.ogg" },
                  "wheels": "minecraft:entity.minecart.riding",
                  "clack": "s/clack.ogg",
                  "doors": { "door1": "s/door.ogg", "door2": "s/door.ogg" },
                  "controls": { "THROTTLE_1": { "move": "s/notch.ogg", "engage": "other:s/hiss.ogg" } }
                }""");
        assertEquals(List.of("mvp:s/start.ogg", "mvp:s/idle.ogg", "mvp:s/stop.ogg", "mvp:s/clack.ogg",
                "mvp:s/door.ogg", "mvp:s/notch.ogg", "other:s/hiss.ogg"), List.copyOf(sounds.files()));
        assertTrue(SoundSet.NONE.files().isEmpty());
    }

    /**
     * A cab control of a kind is the first the pack declares, the same on
     * every run (the maps used to lose the order, and with it which of
     * {@code _1}/{@code _2} a notch played).
     */
    @Test
    void controlsAndDoorsKeepTheDeclaredOrder() {
        SoundSet sounds = parse("""
                {
                  "controls": { "WIDGET_9": { "move": "w.ogg" }, "WIDGET_8": { "move": "w.ogg" },
                                "WIDGET_7": { "move": "w.ogg" }, "WIDGET_6": { "move": "w.ogg" },
                                "WIDGET_5": { "move": "w.ogg" }, "WIDGET_4": { "move": "w.ogg" },
                                "THROTTLE_2": { "move": "t2.ogg" }, "THROTTLE_1": { "move": "t1.ogg" },
                                "IND_BRAKE_1": { "engage": "ind.ogg" } },
                  "doors": { "d9": "d.ogg", "d8": "d.ogg", "d7": "d.ogg", "d6": "d.ogg", "d5": "d.ogg",
                             "d4": "d.ogg", "d3": "d.ogg", "d2": "d.ogg", "d1": "d.ogg", "d0": "d.ogg" }
                }""");
        assertEquals(List.of("WIDGET_9", "WIDGET_8", "WIDGET_7", "WIDGET_6", "WIDGET_5", "WIDGET_4",
                "THROTTLE_2", "THROTTLE_1", "IND_BRAKE_1"), List.copyOf(sounds.controls().keySet()));
        assertEquals(List.of("d9", "d8", "d7", "d6", "d5", "d4", "d3", "d2", "d1", "d0"),
                List.copyOf(sounds.doors().keySet()));
        assertEquals("mvp:t2.ogg", sounds.control("THROTTLE_", null).move());
        assertEquals("mvp:ind.ogg", sounds.control("INDEPENDENT_BRAKE_", "IND_BRAKE_").engage());
        assertNull(sounds.control("REVERSER_", null));
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
            for (String ref : decl.sounds().files()) {
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
}
