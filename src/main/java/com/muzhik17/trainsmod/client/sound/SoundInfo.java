package com.muzhik17.trainsmod.client.sound;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

import net.minecraft.client.Minecraft;
import net.minecraft.resources.ResourceLocation;

/**
 * What the sound engine won't tell about a pack sound file (SPEC §10), read
 * once per file ({@link OggLength}): how many ticks it plays — so a loop's
 * lead-in hands over to the loop on time — and whether it is stereo, which
 * OpenAL doesn't fade by distance. Sound events and unreadable files: length
 * unknown (−1), mono.
 */
final class SoundInfo {

    private static final Map<String, Integer> TICKS = new HashMap<>();
    private static final Map<String, Boolean> STEREO = new HashMap<>();

    private SoundInfo() {
    }

    /** Ticks the file plays, or −1 if unknown. */
    static int ticks(String ref) {
        return TICKS.computeIfAbsent(ref, SoundInfo::readTicks);
    }

    /** True if the file has more than one channel. */
    static boolean stereo(String ref) {
        return STEREO.computeIfAbsent(ref, SoundInfo::readStereo);
    }

    private static int readTicks(String ref) {
        byte[] data = read(ref, Integer.MAX_VALUE);
        double seconds = data == null ? Double.NaN : OggLength.seconds(data);
        return Double.isNaN(seconds) ? -1 : (int) Math.ceil(seconds * 20.0);
    }

    private static boolean readStereo(String ref) {
        byte[] head = read(ref, OggLength.HEADER_BYTES);
        return head != null && OggLength.channels(head) > 1;
    }

    private static byte[] read(String ref, int limit) {
        ResourceLocation location = ResourceLocation.tryParse(ref);
        if (location == null || !SoundSet.isFile(ref)) {
            return null;
        }
        try (InputStream in = Minecraft.getInstance().getResourceManager().open(location)) {
            return in.readNBytes(limit);
        } catch (IOException e) {
            return null;
        }
    }

    /** Forget everything (resource reload: the files may have changed). */
    static void clear() {
        TICKS.clear();
        STEREO.clear();
    }
}
