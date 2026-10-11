package com.muzhik17.trainsmod.client.sound;

/**
 * What a sound engine won't say about an Ogg Vorbis file, read from its bytes
 * (SPEC §10): how long it plays — the sample rate from the Vorbis
 * identification header on the first page, the sample count from the
 * granule position of the last page — and how many channels it has. A
 * loop's lead-in must hand over to the loop the moment it ends, and a stereo
 * file isn't faded by distance (OpenAL places only mono sounds in the world).
 * Pure, no MC types.
 */
public final class OggLength {

    /** Bytes from the start of a file that hold the identification header. */
    public static final int HEADER_BYTES = 64;

    private OggLength() {
    }

    /** Seconds of audio in {@code data} (the whole file), or NaN if it isn't readable Ogg Vorbis. */
    public static double seconds(byte[] data) {
        int packet = identification(data);
        if (packet < 0) {
            return Double.NaN;
        }
        long rate = le(data, packet + 12, 4);
        if (rate <= 0) {
            return Double.NaN;
        }
        for (int at = data.length - 27; at >= 0; at--) {
            if (capture(data, at)) {
                long samples = le(data, at + 6, 8);
                return samples > 0 ? samples / (double) rate : Double.NaN;
            }
        }
        return Double.NaN;
    }

    /** Channels of the file whose first {@link #HEADER_BYTES} (or more) are {@code head}; 0 if unreadable. */
    public static int channels(byte[] head) {
        int packet = identification(head);
        return packet < 0 ? 0 : head[packet + 11] & 0xFF;
    }

    /**
     * Where the Vorbis identification packet starts — 0x01 "vorbis", version
     * (4), channels (1), sample rate (4) after the first page's 27-byte header
     * and segment table — or −1.
     */
    private static int identification(byte[] data) {
        if (data.length < 27 || !capture(data, 0)) {
            return -1;
        }
        int packet = 27 + (data[26] & 0xFF);
        if (packet + 16 > data.length || data[packet] != 1
                || data[packet + 1] != 'v' || data[packet + 6] != 's') {
            return -1;
        }
        return packet;
    }

    /** True if an Ogg page ("OggS") starts at {@code at}. */
    private static boolean capture(byte[] data, int at) {
        return data[at] == 'O' && data[at + 1] == 'g' && data[at + 2] == 'g' && data[at + 3] == 'S';
    }

    private static long le(byte[] data, int at, int bytes) {
        long value = 0;
        for (int i = bytes - 1; i >= 0; i--) {
            value = value << 8 | (data[at + i] & 0xFF);
        }
        return value;
    }
}
