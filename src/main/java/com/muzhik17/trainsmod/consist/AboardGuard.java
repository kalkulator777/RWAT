package com.muzhik17.trainsmod.consist;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.tags.DamageTypeTags;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.projectile.Projectile;
import net.minecraft.world.item.BoatItem;
import net.minecraft.world.item.BottleItem;
import net.minecraft.world.item.BrushItem;
import net.minecraft.world.item.BucketItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.PlaceOnWaterBlockItem;
import net.minecraft.world.item.SpawnEggItem;
import net.minecraft.world.phys.EntityHitResult;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.ProjectileImpactEvent;
import net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent;
import net.neoforged.neoforge.event.entity.living.MobEffectEvent;
import net.neoforged.neoforge.event.entity.player.AttackEntityEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.event.level.BlockEvent;

/**
 * A train is cut off from the world outside (SPEC v1.5-б, «в вагоне мир
 * недоступен»), both ways.
 *
 * <p><b>Blocks.</b> A player riding a wagon — walking its floor, in a
 * driver's chair or on a cab's vanilla seat — breaks and places no blocks,
 * uses no block (doors, levers, chests outside), uses no item on a block
 * (flint and steel, a hoe, bone meal, a spawn egg…) and no item that reaches
 * out to blocks or fluids by itself ({@link #touchesTheWorld}: buckets,
 * boats, lily pads, bottles, spawn eggs, the brush). The train's floor isn't
 * blocks: a click that missed a car's door or lever landed on the ground
 * under the car, and dug the track bed or set a block there. Anything else
 * into the air stays — eating, a bow, a shield, a pearl, other mods' items:
 * the user's rule is "no changing the world", not a list of what's allowed.
 *
 * <p><b>Entities</b>, both ways (the user's decision): who is in a train and
 * who isn't don't touch each other — no blow, no right-click, no damage
 * caused by an entity (a mob's bite, an arrow, a trident; shot from inside
 * out, the shot is fine, the hit isn't), no potion effect thrown across.
 * "In a train" is the whole consist: aboard one train everything goes as in
 * vanilla; two passing trains are cut off from each other too. Damage from
 * the surroundings (a fall, fire, drowning, an explosion) isn't the guard's
 * business. The train itself — its cars — is no one's side: the mod decides
 * what a click on a door, a coupler or a bogie does, from inside or out.
 *
 * <p>Both sides: the client so nothing is swung or predicted (no ghost
 * blocks; {@code ClientAboardInput} also keeps the arm still and the cracks
 * away), the server because it decides. A cancelled right-click on a block
 * goes on to the item in the air ({@code PASS}), so food still works looking
 * down.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class AboardGuard {

    /** {@link #trainOf} for an entity in no train. */
    private static final int OUTSIDE = Integer.MIN_VALUE;

    private AboardGuard() {
    }

    /** True if the player rides a wagon of the mod — on its floor, in a chair or on its seat. */
    public static boolean aboard(Player player) {
        return player.getVehicle() instanceof WagonEntity;
    }

    /** The consist whose car this entity rides (by its root vehicle), {@link #OUTSIDE} if none. */
    private static int trainOf(Entity entity) {
        return entity.getRootVehicle() instanceof WagonEntity wagon ? wagon.getConsistId() : OUTSIDE;
    }

    /**
     * True if these two are on different sides of a train's walls: one in a
     * train and the other outside it, or in another train. A wagon itself is
     * on no side — its own interactions decide (a door, a coupler, a bogie).
     */
    public static boolean isolated(Entity a, Entity b) {
        if (a == null || b == null || a == b || a instanceof WagonEntity || b instanceof WagonEntity) {
            return false;
        }
        return trainOf(a) != trainOf(b);
    }

    /**
     * True if using this item into the air reaches out to the world's blocks
     * or fluids by itself — the vanilla items whose {@code use} looks along
     * the view for a block or fluid (1.21.1): every bucket (fill, empty, a
     * fish), a boat, a lily pad or frogspawn, a glass bottle (fills from
     * water), a spawn egg (into water), and the brush (brushes the block it
     * looks at while held).
     */
    public static boolean touchesTheWorld(ItemStack stack) {
        Item item = stack.getItem();
        return item instanceof BucketItem || item instanceof BoatItem || item instanceof PlaceOnWaterBlockItem
                || item instanceof BottleItem || item instanceof SpawnEggItem || item instanceof BrushItem;
    }

    /** The entity behind a blow: who caused it, or an ownerless projectile; null for the surroundings. */
    private static Entity attackerOf(DamageSource source) {
        if (source.is(DamageTypeTags.IS_EXPLOSION)) {
            return null; // an explosion hits all around, train or not
        }
        if (source.getEntity() != null) {
            return source.getEntity();
        }
        return source.getDirectEntity() instanceof Projectile projectile ? projectile : null;
    }

    // --- blocks, from aboard ---

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
        if (aboard(event.getEntity()) && touchesTheWorld(event.getItemStack())) {
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

    // --- entities, both ways ---

    @SubscribeEvent
    static void onEntityInteract(PlayerInteractEvent.EntityInteract event) {
        if (isolated(event.getEntity(), event.getTarget())) {
            event.setCanceled(true);
        }
    }

    @SubscribeEvent
    static void onEntityInteractSpecific(PlayerInteractEvent.EntityInteractSpecific event) {
        if (isolated(event.getEntity(), event.getTarget())) {
            event.setCanceled(true);
        }
    }

    @SubscribeEvent
    static void onAttackEntity(AttackEntityEvent event) {
        if (isolated(event.getEntity(), event.getTarget())) {
            event.setCanceled(true);
        }
    }

    /** Damage an entity on the other side caused: a mob's blow, an arrow, a trident … */
    @SubscribeEvent
    static void onIncomingDamage(LivingIncomingDamageEvent event) {
        if (isolated(attackerOf(event.getSource()), event.getEntity())) {
            event.setCanceled(true);
        }
    }

    /** A projectile flies on through what is on the other side (the fishing hook too — no pulling across). */
    @SubscribeEvent
    static void onProjectileImpact(ProjectileImpactEvent event) {
        if (event.getRayTraceResult() instanceof EntityHitResult hit) {
            Projectile projectile = event.getProjectile();
            Entity shooter = projectile.getOwner() != null ? projectile.getOwner() : projectile;
            if (isolated(shooter, hit.getEntity())) {
                event.setCanceled(true);
            }
        }
    }

    /** No potion effect thrown or shot across (a splash potion, a tipped arrow). */
    @SubscribeEvent
    static void onEffectApplicable(MobEffectEvent.Applicable event) {
        if (isolated(event.getEffectSource(), event.getEntity())) {
            event.setResult(MobEffectEvent.Applicable.Result.DO_NOT_APPLY);
        }
    }
}
