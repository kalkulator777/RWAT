package com.muzhik17.trainsmod.consist;

import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/**
 * The crowbar ("монтировка", SPEC §6.12): right-click the coupler between
 * two wagons to uncouple the consist there. A wagon's own pick box is a small
 * cube at the body centre, so the coupler is aimed at client-side
 * ({@code ClientCouplerInteract}: the look ray against coupler gaps and hull
 * ends in each wagon's local frame) and the server re-checks reach before
 * {@link ConsistManager#uncoupleBy cutting} the consist. A click that hits no
 * coupler ends up here and just says what the tool is for.
 */
public class CrowbarItem extends Item {

    public CrowbarItem(Properties properties) {
        super(properties);
    }

    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        if (!level.isClientSide) {
            player.displayClientMessage(
                    Component.translatable("message.railswheelsandtrains.crowbar_hint"), true);
        }
        return InteractionResultHolder.pass(player.getItemInHand(hand));
    }
}
