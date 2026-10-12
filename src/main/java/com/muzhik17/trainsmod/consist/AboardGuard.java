package com.muzhik17.trainsmod.consist;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ChorusFruitItem;
import net.minecraft.world.item.Equipable;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.WritableBookItem;
import net.minecraft.world.item.WrittenBookItem;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.AttackEntityEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.event.level.BlockEvent;

/**
 * Aboard a train, the world outside is out of reach (SPEC v1.5-б, «в вагоне
 * мир недоступен»): a player riding a wagon — walking its floor, in a
 * driver's chair or on a cab's vanilla seat — breaks and places no blocks,
 * uses no block (doors, levers, chests outside), uses no item on a block
 * (buckets, flint and steel, hoes…) and touches no entity but the train's own
 * cars and the people aboard it. The train's floor isn't blocks: a click that
 * misses a car's door or lever lands on the ground under the car, and a stray
 * click on the way to a door used to dig the track bed or set a block in
 * the world.
 *
 * <p>What stays: everything the mod does with the train itself — doors,
 * levers, chairs, couplers (they are picked by the mod before vanilla sees
 * the click), the wagon entity's own interaction — and using an item into the
 * air when that doesn't reach the world either ({@link #harmlessInHand}):
 * eating, drinking, a shield, a spyglass, a horn, putting armour on, a book,
 * the mod's own tools. Throwing, shooting, buckets and the like stay out.
 *
 * <p>Both sides: the client so nothing is swung or predicted (no ghost blocks;
 * {@code ClientAboardInput} also keeps the arm still and the cracks away),
 * the server because it decides. A cancelled right-click on a block goes on
 * to the item in the air ({@code PASS}), so food still works looking down.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class AboardGuard {

    private AboardGuard() {
    }

    /** True if the player rides a wagon of the mod — on its floor, in a chair or on its seat. */
    public static boolean aboard(Player player) {
        return player.getVehicle() instanceof WagonEntity;
    }

    /**
     * True if {@code target} is part of the train the player rides: any
     * wagon (its own interactions decide what a click does), or someone
     * aboard a car of the same consist.
     */
    public static boolean ownTrain(Player player, Entity target) {
        if (target instanceof WagonEntity) {
            return true;
        }
        return player.getVehicle() instanceof WagonEntity own
                && target.getVehicle() instanceof WagonEntity theirs
                && theirs.getConsistId() == own.getConsistId();
    }

    /**
     * True if using this item into the air leaves the world alone: it is
     * eaten or drunk, held up (a shield, a spyglass, a horn), worn, read, or
     * one of the mod's own (pickers and hints). Not a chorus fruit — that
     * throws its eater about.
     */
    public static boolean harmlessInHand(ItemStack stack) {
        if (stack.isEmpty()) {
            return true;
        }
        if (stack.getItem() instanceof ChorusFruitItem) {
            return false;
        }
        if (RailsWheelsAndTrains.MODID.equals(BuiltInRegistries.ITEM.getKey(stack.getItem()).getNamespace())) {
            return true;
        }
        return switch (stack.getUseAnimation()) {
            case EAT, DRINK, BLOCK, SPYGLASS, TOOT_HORN -> true;
            default -> Equipable.get(stack) != null
                    || stack.getItem() instanceof WritableBookItem
                    || stack.getItem() instanceof WrittenBookItem;
        };
    }

    @SubscribeEvent
    static void onLeftClickBlock(PlayerInteractEvent.LeftClickBlock event) {
        if (aboard(event.getEntity())) {
            event.setCanceled(true);
        }
    }

    @SubscribeEvent
    static void onRightClickBlock(PlayerInteractEvent.RightClickBlock event) {
        if (aboard(event.getEntity())) {
            event.setCanceled(true); // PASS: the item may still be used into the air
        }
    }

    @SubscribeEvent
    static void onRightClickItem(PlayerInteractEvent.RightClickItem event) {
        if (aboard(event.getEntity()) && !harmlessInHand(event.getItemStack())) {
            event.setCanceled(true);
        }
    }

    @SubscribeEvent
    static void onEntityInteract(PlayerInteractEvent.EntityInteract event) {
        if (aboard(event.getEntity()) && !ownTrain(event.getEntity(), event.getTarget())) {
            event.setCanceled(true);
        }
    }

    @SubscribeEvent
    static void onEntityInteractSpecific(PlayerInteractEvent.EntityInteractSpecific event) {
        if (aboard(event.getEntity()) && !ownTrain(event.getEntity(), event.getTarget())) {
            event.setCanceled(true);
        }
    }

    @SubscribeEvent
    static void onAttackEntity(AttackEntityEvent event) {
        if (aboard(event.getEntity()) && !ownTrain(event.getEntity(), event.getTarget())) {
            event.setCanceled(true);
        }
    }

    /** The last word on the server: no block a rider breaks … */
    @SubscribeEvent
    static void onBreak(BlockEvent.BreakEvent event) {
        if (aboard(event.getPlayer())) {
            event.setCanceled(true);
        }
    }

    /** … or places. */
    @SubscribeEvent
    static void onPlace(BlockEvent.EntityPlaceEvent event) {
        if (event.getEntity() instanceof Player player && aboard(player)) {
            event.setCanceled(true);
        }
    }
}
