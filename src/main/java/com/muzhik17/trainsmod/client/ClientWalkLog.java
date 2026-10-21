package com.muzhik17.trainsmod.client;

import java.util.ArrayDeque;
import java.util.Deque;

import org.joml.Vector3d;

/**
 * The local player's walk inputs the server hasn't acknowledged yet (SPEC
 * v1.5-б), each with the feet the prediction had after it. The client numbers
 * every walk input it sends ({@code WalkInputPayload}); each rider sync says
 * which of them the server's feet are after ({@code RiderSyncPayload}), and
 * the two are compared there — the server's feet against the prediction
 * after the same input, never against one a round trip ahead of them. If
 * they differ (a door shut a tick earlier on one side, an input the server
 * dropped), the server's win and the inputs still on their way are walked
 * again from them, so the correction keeps the steps the server hasn't seen
 * yet. Before, a rider standing still for 10 ticks was put on the server's
 * feet: with a round trip over half a second the server hadn't run the last
 * steps yet, and a lagging player was pulled back when they stopped.
 *
 * <p>The numbers keep counting across cars: an acknowledgement of an input
 * walked on another car matches nothing here. Free of Minecraft classes, so
 * the bookkeeping is unit-tested; the step the inputs are walked again with
 * is given ({@link Replay}: {@code RiderWalk.step} on the car as it is now).
 */
public final class ClientWalkLog {

    /** How far the server's feet may be from the prediction after the same input and still agree, blocks. */
    static final double TOLERANCE = 1.0e-3;
    /** Inputs kept at most: older ones are forgotten (a round trip of ten seconds). */
    static final int MAX_PENDING = 200;

    /** One walk input as sent: its number and what the player pressed and looked at. */
    public record Input(int seq, float forward, float strafe, float relativeYaw, boolean sneak) {
    }

    /** Walks one input from {@code from}: the step the server runs ({@code RiderWalk.step}). */
    @FunctionalInterface
    public interface Replay {
        Vector3d step(Vector3d from, Input input);
    }

    /** An input and the feet predicted after it. */
    private static final class Entry {
        final Input input;
        Vector3d after;

        Entry(Input input, Vector3d after) {
            this.input = input;
            this.after = new Vector3d(after);
        }
    }

    private final Deque<Entry> pending = new ArrayDeque<>();
    /** The newest input the server acknowledged that this log knew, or null. */
    private Entry acked;
    private int nextSeq;

    /**
     * Number an input about to be sent and keep it with the feet predicted
     * after it ({@code after}); returns its number.
     */
    public int sent(float forward, float strafe, float relativeYaw, boolean sneak, Vector3d after) {
        int seq = nextSeq++;
        pending.addLast(new Entry(new Input(seq, forward, strafe, relativeYaw, sneak), after));
        while (pending.size() > MAX_PENDING) {
            pending.removeFirst();
        }
        return seq;
    }

    /**
     * The server's feet after input {@code ack}, on the car this log walks:
     * the inputs it has taken in are forgotten; if its feet aren't where the
     * prediction had them after that input, they win and the inputs still on
     * their way are walked again from them ({@code replay}).
     *
     * @return the feet now predicted after the newest input, or null if the
     *         prediction stands — the feet agree, or there is nothing to
     *         compare with (no input of this car acknowledged yet, or one
     *         this log forgot)
     */
    public Vector3d acknowledged(Vector3d server, int ack, Replay replay) {
        while (!pending.isEmpty() && pending.peekFirst().input.seq() <= ack) {
            Entry entry = pending.removeFirst();
            if (entry.input.seq() == ack) {
                acked = entry;
            }
        }
        if (acked == null || acked.input.seq() != ack || acked.after.distance(server) <= TOLERANCE) {
            return null;
        }
        acked.after = new Vector3d(server);
        Vector3d feet = new Vector3d(server);
        for (Entry entry : pending) {
            feet = replay.step(feet, entry.input);
            entry.after = new Vector3d(feet);
        }
        return feet;
    }

    /** The car turned round in its consist (SPEC §6.12): every prediction mirrored, as the feet are. */
    public void mirror() {
        if (acked != null) {
            acked.after.set(-acked.after.x, acked.after.y, -acked.after.z);
        }
        for (Entry entry : pending) {
            entry.after.set(-entry.after.x, entry.after.y, -entry.after.z);
        }
    }

    /** Forget every input (off the car, or onto another); the numbers go on. */
    public void clear() {
        pending.clear();
        acked = null;
    }

    /** Inputs sent and not yet acknowledged (test hook). */
    int pending() {
        return pending.size();
    }
}
