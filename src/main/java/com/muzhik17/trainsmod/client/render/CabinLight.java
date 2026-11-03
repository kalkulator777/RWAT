package com.muzhik17.trainsmod.client.render;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientWagonRay;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.stock.ConsistComposition;

import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;

/**
 * The cabin lamps' light on a wagon's riders (SPEC §8): the same field the
 * interior is baked with, sampled at the rider's chest — so a passenger, and
 * the player's own hand in first person, are lit like the saloon around them.
 * The chest is taken into the car's model frame as the car is drawn
 * ({@link ClientWagonRay#drawn}: the render pose, its sway and its turn) —
 * the lamps are where the saloon is drawn; the entity's lerped position with
 * this tick's rotation, unswayed, parts from that on a curve and at speed.
 */
public final class CabinLight {

    private CabinLight() {
    }

    /** Block light 0..15 the lit cabin lamps of {@code wagon} give {@code rider}. */
    public static int levelAt(WagonEntity wagon, Entity rider, float partialTick) {
        ConsistComposition.Slot slot = ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
        if (slot == null) {
            return 0;
        }
        StockModel model = StockModels.model(slot.type().id());
        if (model == null || model.lamps().isEmpty()) {
            return 0;
        }
        long litMask = model.litMask(wagon::controlValue);
        Vec3 at = rider.getPosition(partialTick).add(0.0, rider.getBbHeight() * 0.6, 0.0);
        Vector3d local = ClientWagonRay.drawn(wagon, partialTick).invertAffine()
                .transformPosition(new Vector3d(at.x, at.y, at.z));
        return BakedStockModel.lampLevelAt(model, litMask, (float) local.x, (float) local.y,
                (float) local.z);
    }
}
