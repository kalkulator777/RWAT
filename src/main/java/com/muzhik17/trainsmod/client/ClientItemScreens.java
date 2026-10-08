package com.muzhik17.trainsmod.client;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.gui.RailStyleScreen;
import com.muzhik17.trainsmod.client.gui.StockPickerScreen;
import com.muzhik17.trainsmod.rail.RailItem;

import net.minecraft.client.Minecraft;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;

/**
 * Opens the item pickers (SPEC §6.10/§6.11). Called from the items'
 * {@code use} on the logical client only — the one door from common item
 * code into client screens, so a dedicated server never loads them.
 */
public final class ClientItemScreens {

    private ClientItemScreens() {
    }

    public static void openRailStylePicker(InteractionHand hand) {
        Player player = Minecraft.getInstance().player;
        if (player != null) {
            ItemStack stack = player.getItemInHand(hand);
            Minecraft.getInstance().setScreen(new RailStyleScreen(hand, RailItem.style(stack)));
        }
    }

    public static void openStockPicker(InteractionHand hand) {
        Player player = Minecraft.getInstance().player;
        if (player != null) {
            ItemStack stack = player.getItemInHand(hand);
            Minecraft.getInstance().setScreen(new StockPickerScreen(hand,
                    stack.get(RailsWheelsAndTrains.STOCK_SELECTION.get())));
        }
    }
}
