package com.muzhik17.trainsmod.consist;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;

/**
 * A player touching a wagon (SPEC §9.2–§9.3): the facts of {@link
 * TouchRules} as either side has them, and the server's verdict. Every
 * click, drag and step of a player on a wagon goes through here on the
 * server — doors, the coupler, the handbrake, switches, chairs, levers, the
 * driver's panel, the walk, a blow at a bogie — and the client's picks ask
 * the same rule before they send, so what the server would refuse isn't sent.
 *
 * <p>The facts common to both sides come from {@link #facts}: in the game,
 * may build, the key, the crowbar, aboard, the cabs. What only the caller
 * knows it adds: whether the part is within reach (the server measures it
 * against the car where the player's client drew it, SPEC §9.3; a client's
 * pick is within reach by itself), whether a door leads into a cab, whether
 * the world may be changed just there.
 */
public final class WagonTouch {

    private WagonTouch() {
    }

    /** True if the player is in the game: alive and not a spectator. */
    public static boolean present(Player player) {
        return player.isAlive() && !player.isSpectator();
    }

    /** What holds of {@code player} touching {@code wagon} on either side; nothing in reach yet. */
    public static TouchRules.Facts facts(Player player, WagonEntity wagon) {
        WagonType type = wagon.typeNow();
        return TouchRules.Facts.of(present(player), player.mayBuild(), CabAccess.mayWork(player),
                        player.getMainHandItem().is(RailsWheelsAndTrains.CROWBAR.get()))
                .aboard(player.getVehicle() == wagon, player.getVehicle() instanceof WagonEntity)
                .cab(type != null && type.drivable());
    }

    /**
     * Server: may {@code player} do {@code action} to {@code wagon}, on these
     * facts. A refusal is quiet — logged at DEBUG, nothing thrown, nobody
     * cut off; only the driver's key is named on the action bar, as the
     * player can do something about it (the client says so itself and
     * doesn't send: a packet that still comes is a race or a hacked client).
     */
    public static boolean allows(ServerPlayer player, WagonEntity wagon, TouchRules.Action action,
            TouchRules.Facts facts) {
        TouchRules.Refusal refusal = TouchRules.check(action, facts);
        if (refusal == null) {
            return true;
        }
        if (refusal == TouchRules.Refusal.NEED_KEY) {
            CabAccess.refuse(player);
        }
        RailsWheelsAndTrains.LOGGER.debug("{} may not {} wagon {}: {}", player.getGameProfile().getName(),
                action, wagon.getId(), refusal);
        return false;
    }
}
