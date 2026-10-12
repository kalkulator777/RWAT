package com.muzhik17.trainsmod.consist;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.ServerConfig;

import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Player;

/**
 * Who may get into a locomotive's cab and work it (SPEC §9.2): anyone, or,
 * with the server's {@code cab_access = KEY}, a player carrying the driver's
 * key ({@link DriverKeyItem}) — anywhere in the inventory, the other hand
 * included: a driver carries the key on them and keeps the hands for the
 * levers — and operators and creative players without one. Asked alike on
 * both sides: the server decides, the client predicts and doesn't send what
 * would be refused.
 */
public final class CabAccess {

    /** Operators from this permission level need no key (vanilla's command level). */
    private static final int OPERATOR_LEVEL = 2;

    private CabAccess() {
    }

    /** True if {@code player} may open the doors into a cab, sit at its controls and work them. */
    public static boolean mayWork(Player player) {
        return !ServerConfig.cabsLocked() || player.isCreative() || player.hasPermissions(OPERATOR_LEVEL)
                || holdsKey(player);
    }

    /** True if the driver's key is anywhere in the player's inventory (the other hand too). */
    public static boolean holdsKey(Player player) {
        return player.getInventory().contains(stack -> stack.is(RailsWheelsAndTrains.DRIVER_KEY.get()));
    }

    /** "The driver's key is needed", on the action bar. */
    public static void refuse(Player player) {
        player.displayClientMessage(Component.translatable("message.railswheelsandtrains.need_key"), true);
    }

    /** True if {@code player} may work the cab; else tells them the key is needed. */
    public static boolean check(Player player) {
        if (mayWork(player)) {
            return true;
        }
        refuse(player);
        return false;
    }
}
