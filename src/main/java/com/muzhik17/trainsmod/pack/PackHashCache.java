package com.muzhik17.trainsmod.pack;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Pack hashes kept by the pack's size and time of change
 * ({@link PackHasher#fingerprint}): hashing MVP reads ~170 MB, a fingerprint
 * a few hundred file times. A pack whose files didn't change since its last
 * hash is not read again — the server answers every joining player, a client
 * every server it joins.
 *
 * <p>Thread-safe; {@link #hash} blocks while it reads a pack, so it is called
 * off the game threads ({@code RwatPacks} runs it on its own thread).
 * {@link #known} never blocks: what a command shows on a game thread.
 */
public final class PackHashCache {

    private record Entry(String fingerprint, String hash) {
    }

    /** Written under the lock by {@link #hash}; read without it by {@link #known}. */
    private final Map<Path, Entry> entries = new ConcurrentHashMap<>();
    private int computed;

    /** The pack's hash: the cached one if its files didn't change, else read anew. */
    public synchronized String hash(Path pack) throws IOException {
        Path key = pack.toAbsolutePath().normalize();
        String fingerprint = PackHasher.fingerprint(key);
        Entry entry = entries.get(key);
        if (entry != null && entry.fingerprint().equals(fingerprint)) {
            return entry.hash();
        }
        // a pack changing while it's read is kept under the fingerprint taken before:
        // the next call sees the new fingerprint and reads it again
        String hash = PackHasher.hash(key);
        entries.put(key, new Entry(fingerprint, hash));
        computed++;
        return hash;
    }

    /**
     * The hash last worked out for the pack, or {@code null} if it never was;
     * without looking at its files, so it may predate a change the next
     * {@link #hash} will see. Doesn't wait for a hash being worked out.
     */
    public String known(Path pack) {
        Entry entry = entries.get(pack.toAbsolutePath().normalize());
        return entry != null ? entry.hash() : null;
    }

    /** How many times a pack was actually read (for the tests and the log). */
    synchronized int computed() {
        return computed;
    }
}
