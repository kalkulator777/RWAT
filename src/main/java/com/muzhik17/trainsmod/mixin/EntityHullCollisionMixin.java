package com.muzhik17.trainsmod.mixin;

import java.util.List;

import org.joml.Vector3d;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.HullCollision;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/**
 * Hard outer-hull collision (SPEC v1.5-а): the wagon corpus is a moving solid an
 * entity can't walk or fly through — only (later) an open door. Vanilla collision
 * is AABB-only and a wagon is an oriented box, so we clamp the entity's
 * already-block-collided movement against each nearby wagon's hull in the wagon's
 * own local frame ({@link HullCollision}).
 *
 * <p><b>Common</b> mixin on purpose: the local player's movement is resolved
 * client-side, mobs' server-side — so both sides clamp. Not a player on the
 * server, though: its {@code handleMovePlayer} replays the client's move
 * through {@code collide} and checks it against what the client claimed, and
 * the server's hull runs a couple of ticks plus the ping ahead of the one the
 * client drew and walked by — clamped there, a player by a moving train was
 * "moved wrongly" and set back. The client's own clamp keeps a player out; one
 * the server finds overlapping a hull anyway is pushed out by the shove. A
 * passenger doesn't collide with the hull of its own vehicle. The "wagon
 * overtakes a standing entity" case can't be caught here (it's the wagon that
 * moves, not the entity) — the server-side shove in {@code ConsistManager}
 * covers it.
 *
 * <p>Open doors (SPEC v1.5): a <b>player</b> is let through an open doorway
 * ({@link WagonEntity#openPortals}) and boarded by the server once inside;
 * mobs still meet a solid hull — only players ride.
 */
@Mixin(Entity.class)
public abstract class EntityHullCollisionMixin {

    /** Inflate the wagon search box by the longest stock half-length so far-centred wagons are found. */
    private static final double SEARCH_REACH = 14.0;

    @Inject(method = "collide", at = @At("RETURN"), cancellable = true)
    private void rwat$collideHull(Vec3 movement, CallbackInfoReturnable<Vec3> cir) {
        Entity self = (Entity) (Object) this;
        if (self instanceof WagonEntity || self.isSpectator()
                || self instanceof Player && !self.level().isClientSide()) {
            return; // a player is clamped by its own client (see above)
        }
        Vec3 allowed = cir.getReturnValue();
        if (allowed.lengthSqr() < 1.0e-12) {
            return;
        }
        AABB box = self.getBoundingBox();
        AABB search = box.expandTowards(allowed).inflate(SEARCH_REACH);
        List<WagonEntity> wagons = self.level().getEntitiesOfClass(WagonEntity.class, search);
        if (wagons.isEmpty()) {
            return;
        }

        Entity vehicle = self.getVehicle();
        double ehx = (box.maxX - box.minX) * 0.5;
        double ehy = (box.maxY - box.minY) * 0.5;
        double ehz = (box.maxZ - box.minZ) * 0.5;
        Vector3d center = new Vector3d(
                (box.minX + box.maxX) * 0.5,
                (box.minY + box.maxY) * 0.5,
                (box.minZ + box.maxZ) * 0.5);

        Vector3d move = new Vector3d(allowed.x, allowed.y, allowed.z);
        boolean changed = false;
        for (WagonEntity wagon : wagons) {
            if (wagon == vehicle) {
                continue;
            }
            WagonType.Hull hull = wagon.collisionHull();
            if (hull == null) {
                continue;
            }
            Vector3d clamped = HullCollision.clampMove(
                    new Vector3d(hull.minX(), hull.minY(), hull.minZ()),
                    new Vector3d(hull.maxX(), hull.maxY(), hull.maxZ()),
                    new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                    wagon.getYRot(), wagon.getXRot(),
                    center, ehx, ehy, ehz, move,
                    self instanceof Player ? wagon.openPortals() : List.of());
            if (clamped != move) { // clampMove returns the same instance when nothing clamped
                move = clamped;
                changed = true;
            }
        }
        if (changed) {
            cir.setReturnValue(new Vec3(move.x, move.y, move.z));
        }
    }
}
