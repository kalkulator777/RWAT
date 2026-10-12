package com.muzhik17.trainsmod.consist;

import java.util.List;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;

/**
 * The driver's key ("ключ машиниста", SPEC §9.2). On a server whose cabs
 * want it ({@code cab_access = KEY}) it opens the doors into a locomotive's
 * cab, lets its holder sit in a driver's chair and work the cab's controls.
 * One key fits every cab, and it works from anywhere in the inventory
 * ({@link CabAccess}); by itself it does nothing.
 */
public class DriverKeyItem extends Item {

    public DriverKeyItem(Properties properties) {
        super(properties);
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip,
            TooltipFlag flag) {
        tooltip.add(Component.translatable("tooltip.railswheelsandtrains.driver_key")
                .withStyle(ChatFormatting.GRAY));
    }
}
