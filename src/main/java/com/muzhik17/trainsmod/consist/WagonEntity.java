package com.muzhik17.trainsmod.consist;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientRide;
import com.muzhik17.trainsmod.client.ClientWalk;
import com.muzhik17.trainsmod.kinematics.HullCollision;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.kinematics.WagonPose;
import com.muzhik17.trainsmod.network.RiderPlacePayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.Mth;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.gameevent.GameEvent;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * A wagon: the Entity half of the 0.2 split (logical {@link Consist} +
 * wagon entities, SPEC §2.1). Exists for chunk-based visibility tracking,
 * riding (Layer 2) and vanilla persistence; all motion state lives in the
 * consist, which re-attaches wagons by UUID and drives their position every
 * server tick.
 *
 * <p>Client side, vanilla position interpolation is disabled (SPEC §2.1, 0.2):
 * {@link #lerpTo} is a no-op and the client tick derives the position only
 * from the interpolated {@code s} of the snapshot buffer — otherwise two
 * interpolation systems fight and both jitter.
 *
 * <p><b>Riding (SPEC v1.5-б):</b> two kinds of passenger. The cab driver
 * (any {@linkplain WagonType#drivable() cab} wagon — SPEC §6.12) sits at
 * the vanilla seat offset and steers. A <i>walking
 * rider</i> boards a {@linkplain WagonType#boardable() boardable} wagon and
 * moves freely about its interior in the model's <b>local</b> frame: their
 * local feet position lives in {@link #riderLocal} (server) /
 * {@link ClientWalk} (client predicted), and {@link #positionRider} places
 * them at {@code bodyPose × local} every tick, so the body pose carries them
 * along — no world-coordinate fight with the movement anti-cheat, because a
 * passenger's position is dictated by its vehicle. Walking riders cannot just
 * step off: {@link ConsistEvents} cancels their sneak-dismount.
 *
 * <p><b>Doors (SPEC v1.5, IR-style):</b> a type that declares doors is entered
 * and left <i>only</i> through them. Each door is open or closed (a synced
 * bitmask, right-click on the leaf toggles it). Closed, it is wall from both
 * sides. Open, the outer hull has a walk-through opening there for players
 * ({@link #openPortals}) — stepping into it boards you onto the vestibule
 * floor ({@link #boardThroughDoors}) — and a rider walking into it from inside
 * steps out ({@link #setWalkInput}). Speed doesn't matter: an open door on a
 * moving train lets you out, as in IR.
 *
 * <p><b>Gangways (SPEC §9.5, IR's {@code CONNECTING} doors):</b> a rider
 * walking out through an open connecting door in an end wall goes on into the
 * coupled neighbour on that end, through its connecting door there (opened
 * as they pass), and walks on in its interior ({@link #passGangway}).
 */
public class WagonEntity extends Entity {

    private static final EntityDataAccessor<Integer> DATA_CONSIST_ID =
            SynchedEntityData.defineId(WagonEntity.class, EntityDataSerializers.INT);
    /** Position within the consist (0 = front); the client unrolls its pose from this. */
    private static final EntityDataAccessor<Integer> DATA_WAGON_INDEX =
            SynchedEntityData.defineId(WagonEntity.class, EntityDataSerializers.INT);
    /** Open doors: bit {@code i} = door {@code i} of the type's list (SPEC v1.5, doors); saved by id. */
    private static final EntityDataAccessor<Integer> DATA_DOORS =
            SynchedEntityData.defineId(WagonEntity.class, EntityDataSerializers.INT);
    /**
     * Who sits in the driver's chairs (SPEC §9): {@code "S"} = entity ids by
     * chair index, −1 = empty; chairs past its end are empty too.
     */
    private static final EntityDataAccessor<CompoundTag> DATA_SEATED =
            SynchedEntityData.defineId(WagonEntity.class, EntityDataSerializers.COMPOUND_TAG);
    /**
     * Control-group positions (SPEC §8–§9): group name → 0..1. The model's
     * light groups ({@code LCG_<name>}) and switches ({@code CG_<name>}) read
     * and set these; the server never needs to know which groups a model has.
     */
    private static final EntityDataAccessor<CompoundTag> DATA_CONTROLS =
            SynchedEntityData.defineId(WagonEntity.class, EntityDataSerializers.COMPOUND_TAG);
    /**
     * Blows at its bogies (SPEC §6.11), as a minecart's: ticks left of the
     * wobble, which way it rocks (±1), and the wear, which breaks it past
     * {@link #BREAK_DAMAGE}; wobble and wear run down a tick at a time.
     */
    private static final EntityDataAccessor<Integer> DATA_HURT_TIME =
            SynchedEntityData.defineId(WagonEntity.class, EntityDataSerializers.INT);
    private static final EntityDataAccessor<Integer> DATA_HURT_DIR =
            SynchedEntityData.defineId(WagonEntity.class, EntityDataSerializers.INT);
    private static final EntityDataAccessor<Float> DATA_DAMAGE =
            SynchedEntityData.defineId(WagonEntity.class, EntityDataSerializers.FLOAT);

    /** Reach past the player's block reach for toggling a door (the leaf is big). */
    private static final double DOOR_REACH_SLACK = 1.5;
    /** How far past the hull face a player must step into an open doorway to board. */
    private static final double BOARD_DEPTH = 0.05;
    /** Gap left between a player stepping out of a door and the hull face. */
    private static final double EXIT_CLEARANCE = 0.05;
    /** Client: door swing duration in ticks (the asset's 81-frame animation, ~2 s). */
    private static final float DOOR_ANIM_TICKS = 40.0F;
    /** Client: how long the handbrake wheel takes to wind on or off, ticks. */
    private static final float HANDBRAKE_ANIM_TICKS = 30.0F;
    /**
     * Seated feet below the top of the chair cushion: the sitting player
     * model's hips are 0.75 above its feet, its thighs ~0.15 thick. Tuned by
     * play-test, not gospel.
     */
    private static final double SIT_DROP = 0.6;
    /**
     * How far the seated driver may look round from the chair's facing,
     * degrees each way (vanilla's boat: 105) — the body stays to the desk, so
     * the head no longer spins all the way round (play-test).
     */
    public static final float SEAT_LOOK = 105.0F;
    /**
     * Wear that breaks the wagon, a minecart's: a blow adds 10 × its damage
     * and the wear runs down a point a tick — eight or nine punches in a row.
     */
    private static final float BREAK_DAMAGE = 40.0F;
    /** How long a blow rocks the car, ticks (a minecart's). */
    private static final int HURT_TICKS = 10;
    /**
     * The blow's rock as a share of a minecart's wobble: a car is long and
     * heavy, the minecart's degrees would swing its roof a block.
     */
    private static final double KNOCK_SHARE = 0.1;
    /** Control groups a wagon keeps at most, and the longest group name (network sanity). */
    private static final int MAX_CONTROL_GROUPS = 64;
    private static final int MAX_CONTROL_NAME = 32;

    /** Server-authoritative local feet of each walking rider (SPEC v1.5-б). */
    private final Map<UUID, Vector3d> riderLocal = new HashMap<>();
    /** Set true only while {@link #exitRider} runs, so the dismount guard lets it through. */
    private boolean dismountAllowed;
    /** Set true only while a gangway boards a rider here ({@link #boardAt}): see {@link #carryingOn()}. */
    private boolean carryingOn;
    /** Set true only while a blow at a bogie lands ({@link #strikeBy}): the body itself takes no harm. */
    private boolean bogieStruck;
    /** Where the rider leaving through a door lands; read by the dismount, then cleared. */
    private Vec3 doorExit;
    /**
     * Server: the ids of the doors a save had open, until the type is known
     * and they are open again (SPEC §9.8: saved by id, so a pack may reorder
     * or add doors); null once applied.
     */
    private List<String> savedOpenDoors;

    /** Client: door swing progress per door, this tick and last (0 closed … 1 open). */
    private float[] doorAnim = new float[0];
    private float[] doorAnimO = new float[0];
    /** Client: the first door state seen is adopted as-is, not animated. */
    private boolean doorAnimSeeded;
    /** Client: the handbrake wheel's turn, this tick and last (0 released … 1 set; SPEC §5.3). */
    private float handbrakeAnim;
    private float handbrakeAnimO;
    private boolean handbrakeAnimSeeded;

    public WagonEntity(EntityType<? extends WagonEntity> type, Level level) {
        super(type, level);
        this.noPhysics = true;
    }

    /**
     * The consist this wagon belongs to. On the client the newest snapshot's
     * wagon list wins over the synced value: it switches together with the
     * composition when consists couple or split, while entity data arrives a
     * tick later — reading the synced index against the new composition would
     * pose the wagon in another wagon's place for a tick (SPEC §6.12).
     */
    public int getConsistId() {
        int synced = this.entityData.get(DATA_CONSIST_ID);
        return level().isClientSide ? ClientConsists.memberConsist(getId(), synced) : synced;
    }

    public void setConsistId(int consistId) {
        this.entityData.set(DATA_CONSIST_ID, consistId);
    }

    /** Position within the consist (0 = front); client: see {@link #getConsistId}. */
    public int getWagonIndex() {
        int synced = this.entityData.get(DATA_WAGON_INDEX);
        return level().isClientSide ? ClientConsists.memberIndex(getId(), synced) : synced;
    }

    public void setWagonIndex(int index) {
        this.entityData.set(DATA_WAGON_INDEX, index);
    }

    @Override
    protected void defineSynchedData(SynchedEntityData.Builder builder) {
        builder.define(DATA_CONSIST_ID, -1);
        builder.define(DATA_WAGON_INDEX, 0);
        builder.define(DATA_DOORS, 0);
        builder.define(DATA_SEATED, new CompoundTag());
        builder.define(DATA_CONTROLS, new CompoundTag());
        builder.define(DATA_HURT_TIME, 0);
        builder.define(DATA_HURT_DIR, 1);
        builder.define(DATA_DAMAGE, 0.0F);
    }

    @Override
    public void tick() {
        super.tick();
        if (!level().isClientSide && savedOpenDoors != null) {
            reopenSavedDoors();
        }
        // a blow's wobble and wear run down (both sides, as a minecart's: no sync per tick needed)
        if (getHurtTime() > 0) {
            this.entityData.set(DATA_HURT_TIME, getHurtTime() - 1);
        }
        if (getDamage() > 0.0F) {
            this.entityData.set(DATA_DAMAGE, Math.max(getDamage() - 1.0F, 0.0F));
        }
        if (level().isClientSide) {
            clientTick();
        } else if (level() instanceof ServerLevel serverLevel
                && (tickCount % 100 == 0) && getConsistId() >= 0) {
            // a wagon belongs to the consist that lists it: one that sat in an
            // unloaded chunk through a coupling carries a stale id (put right
            // here); one no consist lists is an orphan
            Consist owner = ConsistManager.get(serverLevel).ownerOf(getUUID());
            if (owner == null) {
                discard();
            } else if (owner.id() != getConsistId()) {
                setConsistId(owner.id());
                setWagonIndex(owner.wagonIds().indexOf(getUUID()));
            }
        }
        // server position is driven by ConsistManager, not by the entity itself
    }

    private void clientTick() {
        WagonType type = typeNow();
        if (type != null) {
            tickDoorAnim(type);
        }
        tickHandbrakeAnim();
        WagonPose pose = ClientConsists.tickPose(getConsistId(), getWagonIndex());
        if (pose != null) {
            setPos(pose.body().x, pose.body().y, pose.body().z);
            setYRot(pose.yaw());
            setXRot(pose.pitch());
            ClientRide.step(getId(), getConsistId(), pose, knockRoll()); // the body on its springs (SPEC §10)
            // do NOT reposition riders here: vanilla ticks a passenger right
            // after its vehicle (setOldPosAndRot → rideTick → positionRider),
            // so it picks this fresh pose up by itself. Doing it inside the
            // vehicle tick lands BEFORE the rider's old-pos snapshot, so
            // xo == x and the camera lerp collapses — a 20 Hz rider stutter
            // while the car itself (renderPose-interpolated) stays smooth.
        }
    }

    // --- blows at the bogies (SPEC §6.11) ---

    public int getHurtTime() {
        return this.entityData.get(DATA_HURT_TIME);
    }

    public int getHurtDir() {
        return this.entityData.get(DATA_HURT_DIR);
    }

    public float getDamage() {
        return this.entityData.get(DATA_DAMAGE);
    }

    /**
     * A player's blow at one of this wagon's bogies (server, SPEC §6.11; the
     * manager has checked it can be there): taken as their attack on the
     * wagon — vanilla works out its strength from the weapon and the
     * cooldown, and lands it on {@link #hurt}.
     */
    void strikeBy(ServerPlayer player) {
        bogieStruck = true;
        try {
            player.attack(this);
        } finally {
            bogieStruck = false;
        }
    }

    /**
     * Only a blow at a bogie ({@link #strikeBy}) harms the wagon — never one
     * at its body (its small pick box sits under the floor in the middle):
     * nobody knocks down the car they walk about in by a stray click. Like a
     * minecart: each blow rocks it and adds ten times its damage to the wear;
     * past {@link #BREAK_DAMAGE} — or at once by a player in creative — it
     * breaks ({@link ConsistManager#breakWagon}), dropping its item unless in
     * creative.
     */
    @Override
    public boolean hurt(DamageSource source, float amount) {
        if (!bogieStruck || level().isClientSide || isRemoved() || isInvulnerableTo(source)
                || !(level() instanceof ServerLevel level)) {
            return false;
        }
        this.entityData.set(DATA_HURT_DIR, -getHurtDir());
        this.entityData.set(DATA_HURT_TIME, HURT_TICKS);
        this.entityData.set(DATA_DAMAGE, getDamage() + amount * 10.0F);
        gameEvent(GameEvent.ENTITY_DAMAGE, source.getEntity());
        boolean creative = source.getEntity() instanceof Player player && player.getAbilities().instabuild;
        if (creative || getDamage() > BREAK_DAMAGE) {
            ConsistManager.get(level).breakWagon(level, this, !creative);
        }
        return true;
    }

    /**
     * The blow's rock this tick, radians of roll (client): a minecart's
     * wobble ({@code sin(t)·t·wear/10}, degrees, swinging as it fades) at
     * {@link #KNOCK_SHARE} of its size.
     */
    private double knockRoll() {
        int time = getHurtTime();
        if (time <= 0) {
            return 0.0;
        }
        double degrees = Mth.sin(time) * time * getDamage() / 10.0 * getHurtDir();
        return Math.toRadians(degrees * KNOCK_SHARE);
    }

    /** A wagon isn't knocked about by blows or bumps: the consist alone moves it. */
    @Override
    public void push(double x, double y, double z) {
    }

    /**
     * Set every rider down where they stand (server): the wagon is about to go
     * ({@link ConsistManager#breakWagon}). From the floor it is a short drop
     * to the track; a seated or cab driver gets off at their seat.
     */
    void setDownRiders() {
        for (Entity passenger : List.copyOf(getPassengers())) {
            if (passenger instanceof ServerPlayer player) {
                doorExit = player.position();
                exitRider(player);
                doorExit = null;
            } else {
                passenger.stopRiding();
            }
        }
    }

    /** Vanilla position interpolation is disabled: render uses our own {@code s}. */
    @Override
    public void lerpTo(double x, double y, double z, float yRot, float xRot, int steps) {
        // no-op (SPEC §2.1, 0.2)
    }

    /**
     * Right-click to board (SPEC §2.3, v1.5-б): a {@linkplain WagonType#boardable()
     * boardable} wagon takes a walking rider; otherwise any cab wagon with a
     * free seat takes a driver (SPEC §6.12 — the front-most manned cab is
     * in control). Right-clicking the wagon you already ride exits. A crowbar
     * in hand isn't for boarding: the click goes on to the item.
     */
    @Override
    public InteractionResult interact(Player player, InteractionHand hand) {
        if (player.getItemInHand(hand).getItem() instanceof CrowbarItem) {
            return InteractionResult.PASS;
        }
        if (level().isClientSide) {
            return InteractionResult.sidedSuccess(true);
        }
        if (!(player instanceof ServerPlayer serverPlayer)) {
            return InteractionResult.PASS;
        }
        WagonType type = serverType();
        if (type != null && type.doorsOnly()) {
            return InteractionResult.PASS; // in and out through the doors only
        }
        if (player.getVehicle() == this) {
            exitRider(serverPlayer);
            return InteractionResult.CONSUME;
        }
        if (player.isPassenger()) {
            return InteractionResult.PASS;
        }
        if (type != null && type.boardable()) {
            board(serverPlayer, type);
            return InteractionResult.CONSUME;
        }
        if ((type == null || type.drivable()) && getPassengers().isEmpty()) {
            player.startRiding(this);
            player.displayClientMessage(Component.translatable(inControl(serverPlayer)
                    ? "message.railswheelsandtrains.drive_hint"
                    : "message.railswheelsandtrains.drive_other_cab"), true);
            return InteractionResult.CONSUME;
        }
        return InteractionResult.PASS;
    }

    /** True if this player, seated here, is the one driving the consist (no manned cab ahead). */
    private boolean inControl(ServerPlayer player) {
        if (!(level() instanceof ServerLevel level)) {
            return false;
        }
        Consist consist = ConsistManager.get(level).byId(getConsistId());
        ConsistManager.Driver driver = consist == null ? null : ConsistManager.driverOf(level, consist);
        return driver == null || driver.player() == player;
    }

    /** The wagon's type from its consist's composition (server side), or null. */
    private WagonType serverType() {
        return level().isClientSide ? null : typeNow();
    }

    /** This wagon's composition slot on either side (server consist / synced client copy), or null. */
    private ConsistComposition.Slot slotNow() {
        if (level().isClientSide) {
            return ClientConsists.slot(getConsistId(), getWagonIndex());
        }
        if (!(level() instanceof ServerLevel level)) {
            return null;
        }
        Consist consist = ConsistManager.get(level).byId(getConsistId());
        if (consist == null) {
            return null;
        }
        ConsistComposition composition = consist.composition();
        int index = getWagonIndex();
        return index >= 0 && index < composition.wagonCount() ? composition.slot(index) : null;
    }

    /** This wagon's type on either side: the server consist, or the synced client slot. */
    public WagonType typeNow() {
        ConsistComposition.Slot slot = slotNow();
        return slot != null ? slot.type() : null;
    }

    /** True if the wagon runs turned 180° in its consist (SPEC §5.5 step 3). */
    public boolean isFlipped() {
        ConsistComposition.Slot slot = slotNow();
        return slot != null && slot.flipped();
    }

    /**
     * True if this car's floor is walked (SPEC v1.5-б): its riders walk the
     * interior or sit in its driver's chairs — never on the vanilla seat —
     * so sneaking crouches them rather than getting them off. Either side.
     */
    public boolean walkable() {
        WagonType type = typeNow();
        return type != null && type.boardable();
    }

    /**
     * Walking riders <b>stand</b>, the cab driver <b>sits</b> (SPEC v1.5-б
     * cosmetic). Decided per wagon — a boardable interior carries walkers, a cab
     * the seated driver — and read on the client, where the renderer asks, via
     * the synced composition. {@code shouldRiderSit} is a per-vehicle answer
     * (NeoForge), which fits: each stock type is one kind or the other.
     */
    @Override
    public boolean shouldRiderSit() {
        WagonType type = typeNow();
        return type == null || !type.boardable();
    }

    /**
     * Per passenger (SPEC §9): in a walkable cab the player in the driver's
     * chair sits while everyone else stands. Vanilla asks the vehicle only
     * ({@link #shouldRiderSit()}); a client mixin on the living-entity
     * renderer asks this instead.
     */
    public boolean shouldRiderSit(Entity passenger) {
        return isSeated(passenger) || shouldRiderSit();
    }

    // --- the driver's chairs (SPEC §9) ---

    /** Entity ids in the driver's chairs by chair index, −1 = empty (may stop short of the last chair). */
    private int[] seatedIds() {
        return this.entityData.get(DATA_SEATED).getIntArray("S");
    }

    /** Entity id of whoever sits in chair {@code chair}, −1 if it's empty. */
    public int seatedIn(int chair) {
        int[] ids = seatedIds();
        return chair >= 0 && chair < ids.length ? ids[chair] : -1;
    }

    /** The chair this entity sits in here (its index in {@code cab.seats}), −1 if none. */
    public int chairOf(Entity passenger) {
        int[] ids = seatedIds();
        for (int i = 0; i < ids.length; i++) {
            if (ids[i] == passenger.getId()) {
                return i;
            }
        }
        return -1;
    }

    /** True if this entity sits in one of the driver's chairs here. */
    public boolean isSeated(Entity passenger) {
        return chairOf(passenger) >= 0;
    }

    /** Put {@code entityId} in chair {@code chair}, −1 to empty it (server). */
    private void setSeated(int chair, int entityId) {
        int[] ids = seatedIds();
        int[] next = Arrays.copyOf(ids, Math.max(ids.length, chair + 1));
        Arrays.fill(next, ids.length, next.length, -1);
        next[chair] = entityId;
        CompoundTag tag = new CompoundTag();
        tag.putIntArray("S", next);
        this.entityData.set(DATA_SEATED, tag);
    }

    /**
     * Driver's chair {@code chair} in the pose frame (mirrored for a flipped
     * wagon), or null if there's no such chair (or no walkable interior).
     */
    public WagonType.Seat seat(int chair) {
        WagonType type = typeNow();
        if (chair < 0 || type == null || type.cab() == null || type.interior() == null
                || chair >= type.cab().seats().size()) {
            return null;
        }
        return type.cab().seats().get(chair).inFrame(isFlipped());
    }

    /** The chair this passenger sits in, in the pose frame, or null if they don't sit. */
    public WagonType.Seat seatOf(Entity passenger) {
        return seat(chairOf(passenger));
    }

    /**
     * The chair the train is driven from here: the first manned one (the
     * one in control, {@code ConsistManager.driverOf}), else the first; pose
     * frame, null if there's none.
     */
    public WagonType.Seat deskSeat() {
        int[] ids = seatedIds();
        for (int i = 0; i < ids.length; i++) {
            if (ids[i] >= 0 && seat(i) != null) {
                return seat(i);
            }
        }
        return seat(0);
    }

    /** World yaw this passenger's chair faces (their body), or NaN if they don't sit. */
    public float seatFacing(Entity passenger) {
        WagonType.Seat seat = seatOf(passenger);
        return seat == null ? Float.NaN : getYRot() + seat.yaw();
    }

    /**
     * Keep a seated driver's look within {@link #SEAT_LOOK} of the chair's
     * facing, body square to the desk (vanilla {@code Boat.clampRotation}):
     * shifting {@code yRotO} with {@code yRot} keeps the frame lerp smooth.
     */
    public static void clampSeatedLook(Entity passenger, float facing) {
        passenger.setYBodyRot(facing);
        float off = Mth.wrapDegrees(passenger.getYRot() - facing);
        float clamped = Mth.clamp(off, -SEAT_LOOK, SEAT_LOOK);
        passenger.yRotO += clamped - off;
        passenger.setYRot(passenger.getYRot() + clamped - off);
        passenger.setYHeadRot(passenger.getYRot());
    }

    /** The mouse turned a passenger (client): the seated driver's look stays within the chair's. */
    @Override
    public void onPassengerTurned(Entity passenger) {
        float facing = seatFacing(passenger);
        if (!Float.isNaN(facing)) {
            clampSeatedLook(passenger, facing);
        }
    }

    /** Local feet of a driver sitting in {@code seat}. */
    public static Vector3d seatedFeet(WagonType.Seat seat) {
        return new Vector3d(seat.x(), seat.y() - SIT_DROP, seat.z());
    }

    /**
     * A walking rider sits down in driver's chair {@code chair} (server, SPEC
     * §9): only a rider of this wagon not seated already, near the chair, and
     * only if it is free. Seated, the keys drive the train (as in a cab
     * without an interior) if theirs is the chair in control; sneaking stands
     * back up.
     */
    public void sitDriver(ServerPlayer player, int chair) {
        WagonType.Seat seat = seat(chair);
        Vector3d local = riderLocal.get(player.getUUID());
        if (seat == null || local == null || player.getVehicle() != this || isSeated(player)
                || occupied(chair)
                || Math.hypot(local.x - seat.x(), local.z - seat.z()) > RiderWalk.SEAT_REACH) {
            return;
        }
        setSeated(chair, player.getId());
        player.displayClientMessage(Component.translatable(inControl(player)
                ? "message.railswheelsandtrains.seat_hint"
                : "message.railswheelsandtrains.drive_other_cab_seated"), true);
    }

    /** True if someone aboard sits in chair {@code chair} (the id of a rider long gone doesn't count). */
    private boolean occupied(int chair) {
        int id = seatedIn(chair);
        if (id < 0) {
            return false;
        }
        for (Entity passenger : getPassengers()) {
            if (passenger.getId() == id) {
                return true;
            }
        }
        return false;
    }

    /**
     * The seated driver stands up beside their chair, back to walking
     * (server): from where they sat down from, a walk at the chair as far as
     * the floor goes ({@link #standingFeet}).
     */
    public void standDriver(ServerPlayer player) {
        int chair = chairOf(player);
        if (chair < 0) {
            return;
        }
        setSeated(chair, -1);
        WagonType.Seat seat = seat(chair);
        Vector3d feet = seat == null ? null : standingFeet(riderLocal.get(player.getUUID()), seat);
        if (feet != null) {
            riderLocal.put(player.getUUID(), feet);
        }
    }

    /**
     * Where a driver standing up from {@code seat} (pose frame) lands, both
     * sides alike (the client predicts it): walked from {@code satFrom} — the
     * feet they sat down from — straight at the chair as far as the floor
     * lets them ({@link RiderWalk#toward}), so a chair with no floor under it
     * (the assistant's, beside the desk) leaves them beside it, never through
     * the wall behind it. Without {@code satFrom}, the floor nearest the chair.
     * Null if this wagon has no walkable floor.
     */
    public Vector3d standingFeet(Vector3d satFrom, WagonType.Seat seat) {
        WagonType type = typeNow();
        if (type == null || type.interior() == null) {
            return null;
        }
        WagonType.Interior interior = type.interior().inFrame(isFlipped());
        Vector3d from = satFrom != null ? satFrom
                : interior.clampFeet(new Vector3d(seat.x(), seat.y(), seat.z()), RiderWalk.PLAYER_HALF_WIDTH);
        return RiderWalk.toward(from, seat.x(), seat.z(), interior, framedDoors(), doorMask());
    }

    /**
     * True if the player's eyes are within block reach (plus slack) of this
     * car's hull — near enough to work a switch on it from outside (server
     * check for {@code ControlGroupPayload}).
     */
    public boolean withinReach(ServerPlayer player) {
        WagonType.Hull hull = collisionHull();
        if (hull == null) {
            return false;
        }
        Vector3d eye = PoseMath.worldToLocal(new Vector3d(getX(), getY(), getZ()),
                getYRot(), getXRot(), new Vector3d(player.getEyePosition().x,
                        player.getEyePosition().y, player.getEyePosition().z));
        double dx = Math.max(Math.max(hull.minX() - eye.x, eye.x - hull.maxX()), 0.0);
        double dy = Math.max(Math.max(hull.minY() - eye.y, eye.y - hull.maxY()), 0.0);
        double dz = Math.max(Math.max(hull.minZ() - eye.z, eye.z - hull.maxZ()), 0.0);
        double reach = player.blockInteractionRange() + DOOR_REACH_SLACK;
        return dx * dx + dy * dy + dz * dz <= reach * reach;
    }

    // --- control groups (SPEC §8–§9) ---

    /** A control group's position, 0..1 (0 if never set — switches start off). */
    public float controlValue(String group) {
        return this.entityData.get(DATA_CONTROLS).getFloat(group);
    }

    /** Every set control group (the synced tag — read only). */
    public CompoundTag controls() {
        return this.entityData.get(DATA_CONTROLS);
    }

    /**
     * Set a control group (server): a cab switch, a light toggled from the
     * driver's menu. Names are the model's ({@code CG_<name>}/{@code LCG_<name>});
     * the server only bounds their number and length. The doors the group
     * works ({@link WagonType#doorsWorkedBy}) open at 0.5 and over, else close.
     */
    public void setControl(String group, float value) {
        CompoundTag current = this.entityData.get(DATA_CONTROLS);
        if (group.isEmpty() || group.length() > MAX_CONTROL_NAME
                || (!current.contains(group) && current.size() >= MAX_CONTROL_GROUPS)) {
            return;
        }
        float clamped = Math.clamp(value, 0.0F, 1.0F);
        if (current.contains(group) && current.getFloat(group) == clamped) {
            return;
        }
        CompoundTag next = current.copy(); // a new instance, or the sync sees no change
        next.putFloat(group, clamped);
        this.entityData.set(DATA_CONTROLS, next);
        // IR opens a door by its control group: the group's doors follow (SPEC §9.5)
        WagonType type = typeNow();
        int worked = type == null ? 0 : type.doorsWorkedBy(group);
        if (worked != 0) {
            int mask = doorMask();
            this.entityData.set(DATA_DOORS, clamped >= 0.5F ? mask | worked : mask & ~worked);
        }
    }

    /** Seat a walking rider, anchored at the interior point under where they stood. */
    private void board(ServerPlayer player, WagonType type) {
        Vector3d body = new Vector3d(getX(), getY(), getZ());
        Vector3d localFeet = PoseMath.worldToLocal(body, getYRot(), getXRot(),
                new Vector3d(player.getX(), player.getY(), player.getZ()));
        Vector3d clamped = type.interior().inFrame(isFlipped())
                .clampFeet(localFeet, RiderWalk.PLAYER_HALF_WIDTH);
        riderLocal.put(player.getUUID(), clamped);
        if (player.startRiding(this, true)) {
            repositionRiders();
            player.displayClientMessage(Component.translatable(type.drivable()
                    ? "message.railswheelsandtrains.board_hint_cab"
                    : type.doorsOnly()
                            ? "message.railswheelsandtrains.board_hint_doors"
                            : "message.railswheelsandtrains.board_hint"), true);
        } else {
            riderLocal.remove(player.getUUID());
        }
    }

    /** Sanctioned dismount (right-click): the guard in {@link ConsistEvents} lets it through. */
    private void exitRider(ServerPlayer player) {
        dismountAllowed = true;
        player.stopRiding();
        dismountAllowed = false;
        riderLocal.remove(player.getUUID());
    }

    /**
     * Apply one tick of walk input from a rider (server-authoritative, SPEC
     * v1.5-б): the exit edge dismounts; otherwise step the rider's local feet
     * along the floor and clamp inside the interior walls.
     */
    public void setWalkInput(ServerPlayer player, float forward, float strafe, float yaw,
            boolean exit) {
        if (isSeated(player)) {
            return; // seated: the keys drive (DriveInputPayload), sneaking stands up
        }
        WagonType type = serverType();
        if (exit && (type == null || !type.doorsOnly())) {
            exitRider(player); // door-less types keep the right-click exit
            return;
        }
        if (type == null || type.interior() == null) {
            return;
        }
        WagonType.Interior interior = type.interior().inFrame(isFlipped());
        Vector3d local = riderLocal.get(player.getUUID());
        if (local == null) {
            // ride relationship survived but the anchor was lost — re-seed from world
            Vector3d body = new Vector3d(getX(), getY(), getZ());
            local = interior.clampFeet(
                    PoseMath.worldToLocal(body, getYRot(), getXRot(),
                            new Vector3d(player.getX(), player.getY(), player.getZ())),
                    RiderWalk.PLAYER_HALF_WIDTH);
        }
        List<WagonType.Door> doors = framedDoors();
        if (!doors.isEmpty()) {
            int door = RiderWalk.exitDoor(local, forward, strafe, yaw, getYRot(),
                    interior, doors, doorMask());
            if (door >= 0) {
                WagonType.Door through = doors.get(door);
                if (!through.connecting()) {
                    exitThroughDoor(player, type, through, local);
                    return;
                }
                if (passGangway(player, through, local)) {
                    return;
                }
                // no neighbour there to go on into: that door is wall, the step keeps them in
            }
        }
        riderLocal.put(player.getUUID(),
                RiderWalk.step(local, forward, strafe, yaw, getYRot(), interior, doors, doorMask()));
    }

    /**
     * Step a rider out through an open door: they land just outside the hull
     * face in front of it, at the vestibule floor height, and drop to whatever
     * is below (a platform, or the ground ~1.8 blocks down — no fall damage).
     */
    private void exitThroughDoor(ServerPlayer player, WagonType type, WagonType.Door door,
            Vector3d local) {
        WagonType.Hull hull = type.collidableHull();
        int out = door.outward();
        double face = door.axis() == 0
                ? (out > 0 ? hull.maxX() : -hull.minX())
                : (out > 0 ? hull.maxZ() : -hull.minZ());
        double clear = face + RiderWalk.PLAYER_HALF_WIDTH + EXIT_CLEARANCE;
        double along = spanClamp(door.axis() == 0 ? local.z : local.x, door);
        Vector3d outside = door.axis() == 0
                ? new Vector3d(out * clear, door.minY(), along)
                : new Vector3d(along, door.minY(), out * clear);
        Vector3d world = PoseMath.localToWorld(new Vector3d(getX(), getY(), getZ()),
                getYRot(), getXRot(), outside);
        doorExit = new Vec3(world.x, world.y, world.z);
        exitRider(player);
        doorExit = null;
    }

    /**
     * Walk a rider through an open connecting door into the coupled neighbour
     * on that end (SPEC §9.5): the wagon ahead for a door in the front (+Z)
     * end wall, the one behind for the rear. Both pose frames point the same
     * way along the train, so the rider keeps their place across the car.
     * False (the door stays wall) if no wagon is coupled there, it has no
     * connecting door facing back, or that door is shut.
     */
    private boolean passGangway(ServerPlayer player, WagonType.Door door, Vector3d local) {
        if (door.axis() != 2 || !(level() instanceof ServerLevel level)) {
            return false;
        }
        Consist consist = ConsistManager.get(level).byId(getConsistId());
        if (consist == null) {
            return false;
        }
        int index = consist.wagonIds().indexOf(getUUID());
        int other = index - door.outward(); // index 0 is the front: +Z faces index - 1
        if (index < 0 || other < 0 || other >= consist.wagonIds().size()
                || !(level.getEntity(consist.wagonIds().get(other)) instanceof WagonEntity next)) {
            return false;
        }
        Vector3d arrival = next.gangwayArrival(door.outward(), local.x);
        if (arrival == null) {
            return false;
        }
        Vector3d world = PoseMath.localToWorld(new Vector3d(next.getX(), next.getY(), next.getZ()),
                next.getYRot(), next.getXRot(), arrival);
        doorExit = new Vec3(world.x, world.y, world.z);
        exitRider(player);
        doorExit = null;
        next.boardAt(player, arrival);
        return true;
    }

    /**
     * Where a rider coming through the gangway lands here (SPEC §9.5): just
     * inside this wagon's connecting door in the end wall facing them, at
     * their place across the car (within the door), on the floor. Null if
     * there is no such door, it is shut (the rider opens it themselves) or
     * there is no floor.
     *
     * @param travel the way they walk along the train: +1 forward (they enter
     *               through this wagon's rear end), -1 back
     * @param across their local X in the wagon they leave
     */
    Vector3d gangwayArrival(int travel, double across) {
        WagonType type = serverType();
        if (type == null || type.interior() == null) {
            return null;
        }
        RiderWalk.Arrival arrival = RiderWalk.gangwayArrival(framedDoors(),
                type.interior().inFrame(isFlipped()), travel, across, doorMask());
        return arrival == null ? null : arrival.feet();
    }

    /**
     * Take a player on as a walking rider at a given local spot (server) and
     * tell their client where: its prediction would otherwise start from the
     * world position, which the vanilla dismount from the last wagon moved.
     * Vanilla's mount teleport is left out ({@link #carryingOn()}).
     */
    private void boardAt(ServerPlayer player, Vector3d local) {
        riderLocal.put(player.getUUID(), local);
        carryingOn = true;
        boolean boarded;
        try {
            boarded = player.startRiding(this, true);
        } finally {
            carryingOn = false;
        }
        if (boarded) {
            repositionRiders();
            PacketDistributor.sendToPlayer(player, new RiderPlacePayload(getId(), local.x, local.y, local.z));
        } else {
            riderLocal.remove(player.getUUID());
        }
    }

    /** A body-width point along a door's span: clamped inside it, or its middle if too narrow. */
    private static double spanClamp(double value, WagonType.Door door) {
        return RiderWalk.along(value, door);
    }

    // --- doors (SPEC v1.5) ---

    /** Bitmask of open doors (bit {@code i} = door {@code i}), synced to clients. */
    public int doorMask() {
        return this.entityData.get(DATA_DOORS);
    }

    public boolean isDoorOpen(int index) {
        return (doorMask() >> index & 1) != 0;
    }

    /** The type's doors in the pose frame — mirrored for a flipped wagon. Empty if none/unknown. */
    public List<WagonType.Door> framedDoors() {
        WagonType type = typeNow();
        if (type == null || type.doors().isEmpty()) {
            return List.of();
        }
        boolean flipped = isFlipped();
        List<WagonType.Door> doors = new ArrayList<>(type.doors().size());
        for (WagonType.Door door : type.doors()) {
            doors.add(door.inFrame(flipped));
        }
        return doors;
    }

    /**
     * The open doorways the outer hull lets a <b>player</b> through (SPEC
     * v1.5): one {@link HullCollision.Portal} per open door, read on both
     * sides — the local player's movement is resolved client-side.
     */
    public List<HullCollision.Portal> openPortals() {
        List<WagonType.Door> doors = framedDoors();
        if (doors.isEmpty()) {
            return List.of();
        }
        int mask = doorMask();
        List<HullCollision.Portal> portals = new ArrayList<>();
        for (int i = 0; i < doors.size() && i < 32; i++) {
            // a door between floor zones is inside the hull and a gangway door
            // is no way in from the ground: they cut nothing (SPEC §9.1, §9.5)
            if (doors.get(i).external() && doors.get(i).open(mask, i)) {
                WagonType.Door door = doors.get(i);
                portals.add(new HullCollision.Portal(door.axis(),
                        door.spanMin() + RiderWalk.DOOR_SPAN_INSET,
                        door.spanMax() - RiderWalk.DOOR_SPAN_INSET,
                        door.maxY()));
            }
        }
        return portals;
    }

    /**
     * Open or close a door on a player's right-click (server): only within
     * reach of the leaf, with the door's sound. Anyone may operate any door —
     * from the platform or from inside.
     */
    public void toggleDoorBy(ServerPlayer player, int index) {
        List<WagonType.Door> doors = framedDoors();
        if (index < 0 || index >= doors.size() || index >= 32) {
            return;
        }
        WagonType.Door door = doors.get(index);
        if (door.fixed()) {
            return; // an opening without a leaf (SPEC §9.1)
        }
        Vector3d centre = PoseMath.localToWorld(new Vector3d(getX(), getY(), getZ()),
                getYRot(), getXRot(), new Vector3d((door.minX() + door.maxX()) * 0.5,
                        (door.minY() + door.maxY()) * 0.5, (door.minZ() + door.maxZ()) * 0.5));
        double reach = player.blockInteractionRange() + DOOR_REACH_SLACK;
        if (player.getEyePosition().distanceToSqr(centre.x, centre.y, centre.z) > reach * reach) {
            return;
        }
        setDoorOpen(index, !isDoorOpen(index));
    }

    /**
     * Open or close door {@code index} (server) — and the other doors of its
     * group (SPEC §9.5: IR works a control group's doors together). Each
     * client sounds the doors that changed, with the pack's own sound (SPEC §10).
     */
    private void setDoorOpen(int index, boolean open) {
        List<WagonType.Door> doors = framedDoors();
        if (index < 0 || index >= doors.size() || index >= 32 || isDoorOpen(index) == open) {
            return;
        }
        WagonType.Door door = doors.get(index);
        int mask = doorMask();
        for (int i = 0; i < doors.size() && i < 32; i++) {
            if (i == index || doors.get(i).groupedWith(door)) {
                mask = open ? mask | 1 << i : mask & ~(1 << i);
            }
        }
        this.entityData.set(DATA_DOORS, mask);
    }

    /**
     * Board players who stepped into an open doorway (server, each tick after
     * the pose is set): the hull let them into the opening ({@link #openPortals}),
     * and once they are past the hull face they become walking riders on the
     * vestibule floor. Entering from the ground works — the step well under a
     * real vestibule door is what you'd climb.
     */
    public void boardThroughDoors(ServerLevel level) {
        WagonType type = serverType();
        if (type == null || !type.doorsOnly()) {
            return;
        }
        List<HullCollision.Portal> portals = openPortals();
        if (portals.isEmpty()) {
            return;
        }
        WagonType.Hull hull = type.collidableHull();
        Vector3d body = new Vector3d(getX(), getY(), getZ());
        double reach = type.length() / 2.0 + 4.0;
        for (ServerPlayer player : level.players()) {
            if (player.isPassenger() || player.isSpectator() || !player.isAlive()
                    || player.distanceToSqr(getX(), getY(), getZ()) > reach * reach) {
                continue;
            }
            Vec3 c = player.getBoundingBox().getCenter();
            Vector3d local = PoseMath.worldToLocal(body, getYRot(), getXRot(),
                    new Vector3d(c.x, c.y, c.z));
            for (HullCollision.Portal portal : portals) {
                if (!portal.contains(local.x, local.y, local.z)) {
                    continue;
                }
                double across = portal.axis() == 0 ? local.x : local.z;
                double face = portal.axis() == 0
                        ? (across > 0 ? hull.maxX() : -hull.minX())
                        : (across > 0 ? hull.maxZ() : -hull.minZ());
                if (Math.abs(across) - RiderWalk.PLAYER_HALF_WIDTH < face - BOARD_DEPTH) {
                    board(player, type);
                    break;
                }
            }
        }
    }

    /**
     * Whether a point (an entity centre) is in one of this wagon's open
     * doorways — the server's hull shove leaves a player there be, or it
     * would push them back out mid-step.
     */
    public boolean inOpenDoorway(Vec3 centre) {
        List<HullCollision.Portal> portals = openPortals();
        return !portals.isEmpty() && HullCollision.portalAt(portals,
                new Vector3d(getX(), getY(), getZ()), getYRot(), getXRot(),
                new Vector3d(centre.x, centre.y, centre.z)) != null;
    }

    /** Client: advance each door's swing toward its synced state. */
    private void tickDoorAnim(WagonType type) {
        int n = Math.min(type.doors().size(), 32);
        if (doorAnim.length != n) {
            doorAnim = new float[n];
            doorAnimO = new float[n];
            doorAnimSeeded = false;
        }
        int mask = doorMask();
        float step = 1.0F / DOOR_ANIM_TICKS;
        for (int i = 0; i < n; i++) {
            float target = (mask >> i & 1) != 0 ? 1.0F : 0.0F;
            if (!doorAnimSeeded) {
                doorAnim[i] = target;
            }
            doorAnimO[i] = doorAnim[i];
            doorAnim[i] += Math.clamp(target - doorAnim[i], -step, step);
        }
        doorAnimSeeded = true;
    }

    /** Client: wind the handbrake wheel toward the synced handbrake state. */
    private void tickHandbrakeAnim() {
        float target = ClientConsists.handbrake(getConsistId(), getWagonIndex()) ? 1.0F : 0.0F;
        if (!handbrakeAnimSeeded) {
            // the first state seen is taken as it is — once the consist is known
            handbrakeAnim = target;
            handbrakeAnimSeeded = ClientConsists.slot(getConsistId(), getWagonIndex()) != null;
        }
        handbrakeAnimO = handbrakeAnim;
        float step = 1.0F / HANDBRAKE_ANIM_TICKS;
        handbrakeAnim += Math.clamp(target - handbrakeAnim, -step, step);
    }

    /** Client: the handbrake wheel's turn at {@code partialTick}, 0 released … 1 set. */
    public float handbrakeAnim(float partialTick) {
        return handbrakeAnimO + (handbrakeAnim - handbrakeAnimO) * partialTick;
    }

    /** Client: door {@code index}'s swing at {@code partialTick}, 0 closed … 1 open. */
    public float doorAnim(int index, float partialTick) {
        if (index < 0 || index >= doorAnim.length) {
            return 0.0F;
        }
        return doorAnimO[index] + (doorAnim[index] - doorAnimO[index]) * partialTick;
    }

    /**
     * Place a passenger: a walking rider at {@code bodyPose × localFeet}, anyone
     * else (the cab driver) at the vanilla seat. Called by vanilla each tick via
     * the passenger's {@code rideTick}, and again by {@link #repositionRiders}
     * after the body pose is refreshed.
     *
     * <p>On a client, only feet known <b>on this wagon</b> place a walking
     * rider ({@link ClientWalk#on}); until they are known — a gangway has just
     * carried the rider here (SPEC §9.5), an observer's sync hasn't caught up
     * — the rider holds where they are for the tick, rather than being put at
     * the old car's spot in this car's frame (a car length off) or on the
     * vanilla seat.
     */
    @Override
    protected void positionRider(Entity passenger, Entity.MoveFunction move) {
        if (!hasPassenger(passenger)) {
            return;
        }
        WagonType.Seat seat = seatOf(passenger);
        Vector3d local = seat != null ? seatedFeet(seat)
                : level().isClientSide
                        ? ClientWalk.on(passenger.getId(), getId())
                        : riderLocal.get(passenger.getUUID());
        if (local == null) {
            if (level().isClientSide && walkable()) {
                return; // a walking rider whose feet on this car aren't known yet: hold
            }
            super.positionRider(passenger, move);
            return;
        }
        if (level().isClientSide) {
            // riders rock with the body (SPEC §10) — the camera is part of
            // the car; cosmetic, so the server keeps the plain pose
            local = ClientRide.current(getId()).apply(local);
        }
        Vector3d world = PoseMath.localToWorld(new Vector3d(getX(), getY(), getZ()),
                getYRot(), getXRot(), local);
        move.accept(passenger, world.x, world.y, world.z);
        if (seat != null) {
            // every side, every tick: the body square to the desk, the look within reach of it
            clampSeatedLook(passenger, getYRot() + seat.yaw());
        }
    }

    /**
     * Re-place every passenger from the current body pose. <b>Server only</b>:
     * there the wagon pose is set after entity ticks (in {@code ConsistManager}),
     * so riders would otherwise trail one tick behind the body. The client must
     * NOT call this — vanilla positions a passenger right after its vehicle's
     * tick, after the rider's old-pos snapshot; calling it from the vehicle tick
     * collapses the camera's interpolation window (see {@link #clientTick}).
     */
    public void repositionRiders() {
        for (Entity passenger : getPassengers()) {
            positionRider(passenger, Entity::setPos);
        }
    }

    /**
     * This wagon's solid collision hull in model space (SPEC v1.5-а), or null if
     * the type is unknown. Read on <b>both sides</b> (via {@link #typeNow}) so
     * the {@code EntityHullCollisionMixin} can clamp the local player on the
     * client and mobs on the server against the same envelope.
     */
    public WagonType.Hull collisionHull() {
        WagonType type = typeNow();
        return type != null ? type.collidableHull() : null;
    }

    /** True if this player is a free-walking rider (not the seated cab driver). */
    public boolean isWalkingRider(Player player) {
        return riderLocal.containsKey(player.getUUID());
    }

    /**
     * The wagon now runs turned in its consist (SPEC §6.12: it joined a
     * consist running the other way along the track, so its {@code flipped}
     * flag toggled): its pose frame turned 180° about Y while the car itself
     * stood still. Walking riders' feet live in the pose frame — mirror them,
     * or they would jump to the opposite spot of the car. Server.
     */
    void turnAround() {
        for (Vector3d local : riderLocal.values()) {
            local.set(-local.x, local.y, -local.z);
        }
    }

    /**
     * This wagon's walking riders as (passenger entity id → local feet), for the
     * server→client {@code RiderSyncPayload} (SPEC v1.5-б). Keyed by the network
     * entity id (the same on every client), not UUID, so observers can match it
     * to the rider entity. Empty when no one walks here — the common case.
     */
    public Map<Integer, Vector3d> walkingRiderLocals() {
        if (riderLocal.isEmpty()) {
            return Map.of();
        }
        Map<Integer, Vector3d> out = new HashMap<>();
        for (Entity passenger : getPassengers()) {
            Vector3d local = riderLocal.get(passenger.getUUID());
            if (local != null) {
                out.put(passenger.getId(), local);
            }
        }
        return out;
    }

    /** True only while a sanctioned {@link #exitRider} is in progress. */
    public boolean dismountAllowed() {
        return dismountAllowed;
    }

    /**
     * True only while a gangway carries a rider on into this car (SPEC §9.5,
     * server). Vanilla teleports a player it mounts — a position-and-look
     * packet that puts the client where the server has them: here a tick
     * or two ahead of the client's interpolated train, with a look a tick
     * old — and that snap was part of the jolt at the gangway. The rider's
     * client places them on the car itself ({@code RiderPlacePayload}), so
     * {@code ServerPlayerMountMixin} leaves the teleport out for them.
     */
    public boolean carryingOn() {
        return carryingOn;
    }

    /** Drop a walking rider out the nearer side of the car, by their floor spot. */
    @Override
    public Vec3 getDismountLocationForPassenger(LivingEntity passenger) {
        if (doorExit != null) {
            return doorExit;
        }
        WagonType type = serverType();
        WagonType.Interior interior = type != null && type.interior() != null
                ? type.interior().inFrame(isFlipped()) : null;
        if (interior != null) {
            Vector3d local = riderLocal.getOrDefault(passenger.getUUID(),
                    new Vector3d(0.0, interior.floorY(), 0.0));
            double side = local.x >= 0.0 ? interior.maxX() + 1.0 : interior.minX() - 1.0;
            Vector3d world = PoseMath.localToWorld(new Vector3d(getX(), getY(), getZ()),
                    getYRot(), getXRot(), new Vector3d(side, interior.floorY(), local.z));
            return new Vec3(world.x, world.y, world.z);
        }
        return super.getDismountLocationForPassenger(passenger);
    }

    @Override
    protected void removePassenger(Entity passenger) {
        super.removePassenger(passenger);
        riderLocal.remove(passenger.getUUID());
        int chair = chairOf(passenger);
        if (!level().isClientSide && chair >= 0) {
            setSeated(chair, -1);
        }
    }

    /** Selectable by the cursor so the cab can be right-clicked; still no collision (noPhysics). */
    @Override
    public boolean isPickable() {
        return !isRemoved();
    }

    @Override
    public boolean isPushable() {
        return false;
    }

    /** Long wagons get culled by their tight AABB otherwise (SPEC §2.4, 0.2). */
    @Override
    public AABB getBoundingBoxForCulling() {
        // half the longest stock frame (platzkart ~12.6) plus curve slack
        return getBoundingBox().inflate(16.0);
    }

    /** Server: open the doors a save had open, once this wagon's type is known (SPEC §9.8). */
    private void reopenSavedDoors() {
        WagonType type = serverType();
        if (type == null) {
            return; // the consist isn't there yet
        }
        int mask = 0;
        for (int i = 0; i < type.doors().size() && i < 32; i++) {
            if (savedOpenDoors.contains(type.doors().get(i).id())) {
                mask |= 1 << i;
            }
        }
        this.entityData.set(DATA_DOORS, doorMask() | mask);
        savedOpenDoors = null;
    }

    @Override
    protected void readAdditionalSaveData(CompoundTag tag) {
        setConsistId(tag.getInt("ConsistId"));
        setWagonIndex(tag.getInt("WagonIndex"));
        // open doors by id (SPEC §9.8); the old index mask "Doors" is dropped — those doors start shut
        ListTag open = tag.getList("OpenDoors", Tag.TAG_STRING);
        savedOpenDoors = new ArrayList<>(open.size());
        for (int i = 0; i < open.size(); i++) {
            savedOpenDoors.add(open.getString(i));
        }
        this.entityData.set(DATA_DOORS, 0);
        this.entityData.set(DATA_CONTROLS, tag.getCompound("Controls").copy());
    }

    @Override
    protected void addAdditionalSaveData(CompoundTag tag) {
        tag.putInt("ConsistId", getConsistId());
        tag.putInt("WagonIndex", getWagonIndex());
        ListTag open = new ListTag();
        WagonType type = typeNow();
        if (savedOpenDoors != null) {
            savedOpenDoors.forEach(id -> open.add(StringTag.valueOf(id))); // not applied yet: keep them
        } else if (type != null) {
            for (int i = 0; i < type.doors().size() && i < 32; i++) {
                if (isDoorOpen(i)) {
                    open.add(StringTag.valueOf(type.doors().get(i).id()));
                }
            }
        }
        tag.put("OpenDoors", open);
        tag.put("Controls", controls().copy());
    }
}
