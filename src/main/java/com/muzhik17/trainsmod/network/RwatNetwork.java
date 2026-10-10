package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientRailGraph;
import com.muzhik17.trainsmod.client.ClientRiderSync;
import com.muzhik17.trainsmod.client.ClientWalk;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.ConsistManager;
import com.muzhik17.trainsmod.consist.RollingStockItem;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypes;

import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;

/**
 * Payload registration. Wired from the main mod class constructor
 * (mod event bus).
 */
public final class RwatNetwork {

    private RwatNetwork() {
    }

    public static void register(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar registrar = event.registrar("1");
        registrar.playToClient(ConsistSnapshotPayload.TYPE, ConsistSnapshotPayload.STREAM_CODEC,
                (payload, context) -> ClientConsists.handleSnapshot(payload));
        registrar.playToClient(RailGraphSyncPayload.TYPE, RailGraphSyncPayload.STREAM_CODEC,
                (payload, context) -> ClientRailGraph.handleSync(payload));
        registrar.playToClient(WagonTypesPayload.TYPE, WagonTypesPayload.STREAM_CODEC,
                (payload, context) -> WagonTypes.load(payload.types()));
        registrar.playToClient(RiderSyncPayload.TYPE, RiderSyncPayload.STREAM_CODEC,
                (payload, context) -> ClientRiderSync.apply(payload.consistId(), payload.riders()));
        registrar.playToClient(RiderPlacePayload.TYPE, RiderPlacePayload.STREAM_CODEC,
                (payload, context) -> ClientWalk.place(payload.wagonId(),
                        new org.joml.Vector3d(payload.x(), payload.y(), payload.z())));
        registrar.playToServer(DriveInputPayload.TYPE, DriveInputPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> handleDriveInput(payload, context)));
        registrar.playToServer(WalkInputPayload.TYPE, WalkInputPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> handleWalkInput(payload, context)));
        registrar.playToServer(DoorTogglePayload.TYPE, DoorTogglePayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> handleDoorToggle(payload, context)));
        registrar.playToServer(SelectRailStylePayload.TYPE, SelectRailStylePayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> handleSelectRailStyle(payload, context)));
        registrar.playToServer(SelectStockPayload.TYPE, SelectStockPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> handleSelectStock(payload, context)));
        registrar.playToServer(UncouplePayload.TYPE, UncouplePayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> handleUncouple(payload, context)));
        registrar.playToServer(CabLeverPayload.TYPE, CabLeverPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> handleCabLever(payload, context)));
        registrar.playToServer(ControlGroupPayload.TYPE, ControlGroupPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> handleControlGroup(payload, context)));
        registrar.playToServer(SeatPayload.TYPE, SeatPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> handleSeat(payload, context)));
    }

    /**
     * A cab lever dragged, or a handle set from the driver's panel, by a
     * player (SPEC §9, §9.7): only by the consist's driver — at the controls
     * of its front-most manned cab — so a passenger, someone walking about
     * the cab or a second cab can't fight the driver.
     */
    private static void handleCabLever(CabLeverPayload payload, IPayloadContext context) {
        Consist.Handle handle = Consist.Handle.byOrdinal(payload.handle());
        if (handle == null || !(context.player() instanceof ServerPlayer player)
                || !(player.getVehicle() instanceof WagonEntity wagon)
                || wagon.getId() != payload.wagonId()
                || !(player.level() instanceof ServerLevel level)) {
            return;
        }
        Consist consist = ConsistManager.get(level).byId(wagon.getConsistId());
        ConsistManager.Driver driver = consist == null ? null : ConsistManager.driverOf(level, consist);
        if (driver != null && driver.player() == player) {
            consist.setHandle(handle, payload.value());
        }
    }

    /**
     * A control group set by a player (SPEC §8–§9). One wagon's switch: the
     * player rides it or stands within reach of it. A light group for the
     * whole train (the driver's panel): only by its driver (SPEC §9.7).
     */
    private static void handleControlGroup(ControlGroupPayload payload, IPayloadContext context) {
        if (!(context.player() instanceof ServerPlayer player)
                || !(player.level() instanceof ServerLevel level)) {
            return;
        }
        if (!payload.wholeTrain()) {
            if (level.getEntity(payload.targetId()) instanceof WagonEntity wagon
                    && (player.getVehicle() == wagon || wagon.withinReach(player))) {
                wagon.setControl(payload.group(), payload.value());
            }
            return;
        }
        Consist consist = ConsistManager.get(level).byId(payload.targetId());
        ConsistManager.Driver driver = consist == null ? null : ConsistManager.driverOf(level, consist);
        if (driver == null || driver.player() != player) {
            return;
        }
        for (java.util.UUID id : consist.wagonIds()) {
            if (level.getEntity(id) instanceof WagonEntity wagon) {
                wagon.setControl(payload.group(), payload.value());
            }
        }
    }

    /** Sit down in / stand up from a cab's driver's chair (SPEC §9). */
    private static void handleSeat(SeatPayload payload, IPayloadContext context) {
        if (context.player() instanceof ServerPlayer player
                && player.getVehicle() instanceof WagonEntity wagon
                && wagon.getId() == payload.wagonId()) {
            if (payload.sit()) {
                wagon.sitDriver(player);
            } else {
                wagon.standDriver(player);
            }
        }
    }

    /**
     * Store the picked rail style on the rails in the player's hand (SPEC
     * §6.10). Only a well-formed resource location (or {@code ""}, the mod's
     * own rail) is accepted; whether it exists is the client's business.
     */
    private static void handleSelectRailStyle(SelectRailStylePayload payload, IPayloadContext context) {
        if (!(context.player() instanceof ServerPlayer player)) {
            return;
        }
        ItemStack stack = player.getItemInHand(payload.hand());
        if (!stack.is(RailsWheelsAndTrains.RAIL_ITEM.get())) {
            return;
        }
        if (payload.style().isEmpty()) {
            stack.remove(RailsWheelsAndTrains.RAIL_STYLE.get());
        } else if (ResourceLocation.tryParse(payload.style()) != null) {
            stack.set(RailsWheelsAndTrains.RAIL_STYLE.get(), payload.style());
        }
    }

    /** Store the picked wagon type + livery on the rolling stock item in the player's hand (SPEC §6.11). */
    private static void handleSelectStock(SelectStockPayload payload, IPayloadContext context) {
        if (!(context.player() instanceof ServerPlayer player)) {
            return;
        }
        ItemStack stack = player.getItemInHand(payload.hand());
        WagonType type = WagonTypes.byId(payload.typeId());
        if (stack.is(RailsWheelsAndTrains.ROLLING_STOCK_ITEM.get()) && type != null) {
            stack.set(RailsWheelsAndTrains.STOCK_SELECTION.get(),
                    new RollingStockItem.Selection(type.id(), payload.livery()));
        }
    }

    /**
     * Uncouple at the coupler a crowbar was used on (SPEC §6.12). Only with
     * the crowbar in hand, and the consist checks the coupler is within the
     * player's reach — a client can't cut trains across the map.
     */
    private static void handleUncouple(UncouplePayload payload, IPayloadContext context) {
        if (context.player() instanceof ServerPlayer player
                && player.level() instanceof ServerLevel level
                && player.getMainHandItem().is(RailsWheelsAndTrains.CROWBAR.get())
                && level.getEntity(payload.wagonId()) instanceof WagonEntity wagon) {
            ConsistManager.get(level).uncoupleBy(level, player, wagon, payload.front());
        }
    }

    /**
     * Toggle a wagon door for a player (SPEC v1.5, doors). The wagon checks
     * the player is within reach of that door's leaf, so a client can't
     * operate doors across the map.
     */
    private static void handleDoorToggle(DoorTogglePayload payload, IPayloadContext context) {
        if (context.player() instanceof ServerPlayer player
                && player.level().getEntity(payload.wagonId()) instanceof WagonEntity wagon) {
            wagon.toggleDoorBy(player, payload.door());
        }
    }

    /**
     * Apply a driver throttle on the server, but only if the sender is the
     * consist's driver — at the controls of its front-most manned cab (SPEC
     * §6.12: any cab wagon, not just the head; §9.7: in a walkable cab, the
     * driver's chair) — basic anti-cheat so a client can't drive a train it
     * isn't in, nor fight the driver from a second cab.
     */
    private static void handleDriveInput(DriveInputPayload payload, IPayloadContext context) {
        if (!(context.player() instanceof ServerPlayer player)
                || !(player.getVehicle() instanceof WagonEntity wagon)
                || wagon.getConsistId() != payload.consistId()
                || !(player.level() instanceof ServerLevel level)) {
            return;
        }
        Consist consist = ConsistManager.get(level).byId(payload.consistId());
        ConsistManager.Driver driver = consist == null ? null : ConsistManager.driverOf(level, consist);
        if (driver != null && driver.player() == player) {
            consist.setDriveInput(payload.throttleDir(), payload.brakeDir(),
                    payload.reverserToggle());
        }
    }

    /**
     * Apply a walking rider's input (SPEC v1.5-б), but only if the sender is
     * actually riding a wagon — the wagon is authoritative over the resulting
     * local position (it clamps against the interior). The wagon is taken from
     * the player's vehicle, so a client can't move a rider it isn't.
     */
    private static void handleWalkInput(WalkInputPayload payload, IPayloadContext context) {
        if (context.player() instanceof ServerPlayer player
                && player.getVehicle() instanceof WagonEntity wagon) {
            wagon.setWalkInput(player, payload.forward(), payload.strafe(),
                    payload.yaw(), payload.exit());
        }
    }
}
