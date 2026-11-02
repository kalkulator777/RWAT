package com.muzhik17.trainsmod.network;

/**
 * The numbers a packet carries, checked before anything uses them: a
 * {@code float} or {@code double} off the wire may be NaN or infinite, and
 * clamping doesn't help — {@code Math.clamp(NaN, 0, 1)} is NaN. A control
 * group set to NaN was kept, saved, synced to every client and drawn (audit
 * M4); a walk input of infinity stepped the rider's feet to NaN. Such a
 * packet is dropped whole. Pure (no Minecraft), so it is tested as it is.
 */
public final class PacketNumbers {

    private PacketNumbers() {
    }

    /** True if every value is a number: not NaN, not infinite. */
    public static boolean finite(float... values) {
        for (float value : values) {
            if (!Float.isFinite(value)) {
                return false;
            }
        }
        return true;
    }

    /** True if every value is a number: not NaN, not infinite. */
    public static boolean finite(double... values) {
        for (double value : values) {
            if (!Double.isFinite(value)) {
                return false;
            }
        }
        return true;
    }
}
