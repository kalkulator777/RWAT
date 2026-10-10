package com.muzhik17.trainsmod.consist;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.ServerConfig;
import com.muzhik17.trainsmod.kinematics.ConsistKinematics;
import com.muzhik17.trainsmod.kinematics.HullCollision;
import com.muzhik17.trainsmod.kinematics.WagonPose;
import com.muzhik17.trainsmod.network.ConsistSnapshotPayload;
import com.muzhik17.trainsmod.network.RiderLocal;
import com.muzhik17.trainsmod.network.RiderSyncPayload;
import com.muzhik17.trainsmod.network.TrackPathSpec;
import com.muzhik17.trainsmod.path.RoutePath;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.physics.PhysicsTuning;
import com.muzhik17.trainsmod.physics.TrainPhysics;
import com.muzhik17.trainsmod.rail.RailNetwork;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundSetEntityMotionPacket;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.phys.AABB;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Owns all consists of one server level: SavedData persistence + the per-tick
 * drive (SPEC §2.1, decision 0.2). The consist exists here always; whether it
 * ticks is the chunkloading stub's call: v0 rule — tick only if the
 * <b>head's chunk</b> is loaded, otherwise freeze in place.
 *
 * <p>Each tick, for every ticking consist: advance {@code s += v}, push the
 * resulting pose into the consist's wagon entities (re-attached by UUID), and
 * broadcast a state snapshot to clients tracking the wagon.
 *
 * <p><b>Coupling (SPEC §6.12):</b> before that, consists on one track whose
 * facing ends run into each other merge into one ({@link Coupling} decides,
 * this applies it to the consists and their wagon entities); a crowbar or
 * {@code /rwat uncouple} cuts one at a coupler ({@link #split}). The consist's
 * wagon list is authoritative over which wagon is which: every tick re-asserts
 * each loaded wagon's consist id and index, so a wagon that sat in an unloaded
 * chunk through a coupling is put right as soon as it loads.
 */
public final class ConsistManager extends SavedData {

    private static final String DATA_NAME = RailsWheelsAndTrains.MODID + "_consists";

    private final Map<Integer, Consist> consists = new LinkedHashMap<>();
    private int nextId = 1;
    /** Consists that sent a non-empty rider sync last tick, so we send one empty packet when the last rider leaves. */
    private final Set<Integer> consistsWithRiders = new HashSet<>();

    public static ConsistManager get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(
                new SavedData.Factory<>(ConsistManager::new, ConsistManager::load), DATA_NAME);
    }

    public Consist create(TrackPathSpec pathSpec, ConsistComposition composition, double startS) {
        Consist consist = new Consist(nextId++, pathSpec, composition, startS, 0.0);
        consists.put(consist.id(), consist);
        setDirty();
        return consist;
    }

    /**
     * Create a consist and spawn its wagon entities posed on {@code path}
     * (the resolved {@code pathSpec}) with the head at {@code headS}. The
     * caller keeps the whole train on the path.
     */
    public Consist spawn(ServerLevel level, TrackPathSpec pathSpec, TrackPath path,
            ConsistComposition composition, double headS) {
        Consist consist = create(pathSpec, composition, headS);
        for (int i = 0; i < composition.wagonCount(); i++) {
            WagonEntity wagon = new WagonEntity(RailsWheelsAndTrains.WAGON_ENTITY.get(), level);
            wagon.setConsistId(consist.id());
            wagon.setWagonIndex(i);
            WagonPose pose = ConsistKinematics.wagonPose(path, headS, i, composition);
            wagon.moveTo(pose.body().x, pose.body().y, pose.body().z, pose.yaw(), pose.pitch());
            level.addFreshEntity(wagon);
            consist.wagonIds().add(wagon.getUUID());
        }
        // new stock is delivered parked: it holds on a grade until released
        // (by hand, or by the auto handbrakes when a driver opens the throttle)
        consist.setAllHandbrakes(true);
        setDirty();
        return consist;
    }

    /** @return the removed consist, or null if the id is unknown */
    public Consist remove(int id) {
        Consist removed = consists.remove(id);
        if (removed != null) {
            consistsWithRiders.remove(id);
            setDirty();
        }
        return removed;
    }

    public Consist byId(int id) {
        return consists.get(id);
    }

    public Collection<Consist> all() {
        return consists.values();
    }

    /** The consist whose wagon list holds this wagon, or null (an orphan). */
    public Consist ownerOf(UUID wagon) {
        for (Consist consist : consists.values()) {
            if (consist.wagonIds().contains(wagon)) {
                return consist;
            }
        }
        return null;
    }

    public void tick(ServerLevel level) {
        RailNetwork network = RailNetwork.get(level);
        PhysicsTuning tuning = ServerConfig.tuning();
        boolean dirty = coupleTouching(level, network, tuning);
        // "last rider left" clears go out after every consist's rider list of
        // this tick: a rider whose wagon just changed consists (coupling,
        // uncoupling) is claimed by the new consist before the old one lets go
        // of them on the clients (ClientRiderSync)
        List<Runnable> riderClears = new ArrayList<>();
        for (Consist consist : consists.values()) {
            TrackPathSpec specBefore = consist.pathSpec();
            TrackPath path = consist.resolvePath(network.graph(), network.revision());
            if (consist.pathSpec() != specBefore) {
                dirty = true; // re-anchored onto a re-walked route (SPEC §2.2 v1)
            }
            if (path == null) {
                continue; // nothing of the route survived — frozen (SPEC §2.1)
            }
            Vector3d head = path.samplePosition(consist.s());
            // chunkloading stub v0: head's chunk loaded or the consist freezes
            if (!level.isPositionEntityTicking(BlockPos.containing(head.x, head.y, head.z))) {
                continue;
            }
            // input only counts while a cab has a driver; the handles
            // themselves stay where they were left (a parked train keeps its
            // notch and brake — SPEC §5.3). The driver's cab sets which way
            // "forward" is (SPEC §6.12: drive from any cab).
            Driver driver = driverOf(level, consist);
            if (driver == null) {
                consist.setDriveInput(0, 0, false);
            } else {
                consist.takeControl(driver.cab().getUUID(), driver.facing());
            }
            // the handles reach the driver's panel with the snapshot (SPEC §9.7)
            if (consist.advance(path, tuning)) {
                dirty = true;
            }
            if (consist.endImpactKmh() > IMPACT_SOUND_KMH) {
                // ran into the end of the track: the rail ends, the train stops dead
                boolean front = consist.s() >= path.length() - 1.0e-6;
                ConsistComposition composition = consist.composition();
                impactSound(level, path.samplePosition(front
                        ? Coupling.frontEndS(composition, consist.s())
                        : Coupling.rearEndS(composition, consist.s())), consist.endImpactKmh());
            }

            List<WagonEntity> wagons = new ArrayList<>();
            List<RiderLocal> riders = new ArrayList<>();
            List<UUID> wagonIds = consist.wagonIds();
            int[] entityIds = new int[wagonIds.size()];
            for (int i = 0; i < wagonIds.size(); i++) {
                entityIds[i] = -1;
                if (i < consist.composition().wagonCount()
                        && level.getEntity(wagonIds.get(i)) instanceof WagonEntity wagon) {
                    // the consist's list is authoritative (a no-op unless the
                    // wagon missed a coupling/uncoupling while unloaded)
                    wagon.setConsistId(consist.id());
                    wagon.setWagonIndex(i);
                    entityIds[i] = wagon.getId();
                    wagons.add(wagon);
                    WagonPose pose = ConsistKinematics.wagonPose(
                            path, consist.s(), i, consist.composition());
                    wagon.setPos(pose.body().x, pose.body().y, pose.body().z);
                    wagon.setYRot(pose.yaw());
                    wagon.setXRot(pose.pitch());
                    // the body pose is set after entity ticks, so re-place riders
                    // now or they trail a tick behind the car (SPEC v1.5-б)
                    wagon.repositionRiders();
                    // players who stepped into an open doorway board onto the
                    // vestibule floor (SPEC v1.5, doors) — before the shove,
                    // which would otherwise push them back out mid-step
                    wagon.boardThroughDoors(level);
                    // shove outside entities the freshly-moved hull overran
                    // (SPEC v1.5-а part 2: the case the entity-move clamp can't
                    // catch, because here it's the wagon that moved)
                    shoveOutsiders(level, wagon);
                    wagon.walkingRiderLocals().forEach((id, local) ->
                            riders.add(new RiderLocal(id, local.x, local.y, local.z)));
                }
            }

            if (!wagons.isEmpty()) {
                // snapshot every tick (SPEC §2.1, 0.2) to everyone tracking ANY of
                // the consist's wagons — per wagon, because tracking is per entity
                // and an observer can track the tail without the head (or vice
                // versa); sending only via one wagon starved such observers of
                // snapshots. A player tracking several wagons gets duplicates;
                // the client drops them by gameTime (handleSnapshot).
                ConsistSnapshotPayload snapshot =
                        ConsistSnapshotPayload.of(consist, level.getGameTime(), entityIds);
                for (WagonEntity wagon : wagons) {
                    PacketDistributor.sendToPlayersTrackingEntity(wagon, snapshot);
                }
                consist.frameSent();
                // walking-rider local feet (SPEC v1.5-б): sent while anyone is
                // aboard so observers place them at their interior spot, not the
                // cab seat. One empty packet the tick the last rider leaves clears
                // the clients' cache; a rider-less train then costs nothing.
                // Same per-wagon fan-out; ClientRiderSync.apply is idempotent.
                boolean hadRiders = consistsWithRiders.contains(consist.id());
                if (!riders.isEmpty()) {
                    RiderSyncPayload payload = new RiderSyncPayload(consist.id(), riders);
                    for (WagonEntity wagon : wagons) {
                        PacketDistributor.sendToPlayersTrackingEntity(wagon, payload);
                    }
                    consistsWithRiders.add(consist.id());
                } else if (hadRiders) {
                    RiderSyncPayload payload = new RiderSyncPayload(consist.id(), List.of());
                    riderClears.add(() -> {
                        for (WagonEntity wagon : wagons) {
                            PacketDistributor.sendToPlayersTrackingEntity(wagon, payload);
                        }
                    });
                    consistsWithRiders.remove(consist.id());
                }
            }
        }
        riderClears.forEach(Runnable::run);
        if (dirty) {
            setDirty();
        }
    }

    // --- coupling (SPEC §6.12) ---

    /** At most this many couplings per tick (a pile-up resolves over a few ticks). */
    private static final int MAX_COUPLINGS_PER_TICK = 8;
    /**
     * World-space prefilter between facing consist ends: chord ≤ arc, so ends
     * that touch along the track (up to the allowed overlap) are at least
     * this close in the world.
     */
    private static final double CONTACT_PREFILTER = ConsistComposition.COUPLER_GAP
            + Coupling.CONTACT_SLACK + Coupling.MAX_OVERLAP;
    /** Reach past the player's block reach for a coupler (the client pick box is generous). */
    private static final double COUPLER_REACH_SLACK = 3.0;

    /** A consist that may couple this tick, as the coupling math sees it, plus its outer couplers in the world. */
    private record Candidate(Consist consist, Coupling.Train train, Vector3d front, Vector3d rear) {
    }

    /**
     * Merge every pair of consists that ran into each other on one track
     * (SPEC §6.12). Only rail routes couple (the {@code Straight} debug path
     * doesn't), and only ticking ones — a frozen consist's far wagons may not
     * even be loaded.
     *
     * @return true if anything changed (needs saving)
     */
    private boolean coupleTouching(ServerLevel level, RailNetwork network, PhysicsTuning tuning) {
        boolean dirty = false;
        List<Candidate> candidates = new ArrayList<>();
        for (Consist consist : consists.values()) {
            TrackPathSpec specBefore = consist.pathSpec();
            Candidate candidate = candidate(level, network, consist);
            dirty |= consist.pathSpec() != specBefore; // re-anchored while resolving
            if (candidate != null) {
                candidates.add(candidate);
            }
        }
        int couplings = 0;
        search:
        while (couplings < MAX_COUPLINGS_PER_TICK) {
            for (int i = 0; i < candidates.size(); i++) {
                for (int j = i + 1; j < candidates.size(); j++) {
                    Candidate a = candidates.get(i);
                    Candidate b = candidates.get(j);
                    if (!endsNear(a, b)) {
                        continue;
                    }
                    Driver driverA = driverOf(level, a.consist());
                    Driver driverB = driverOf(level, b.consist());
                    boolean keepA = keepFirst(a.consist(), driverA, b.consist(), driverB);
                    Candidate kept = keepA ? a : b;
                    Candidate absorbed = keepA ? b : a;
                    Coupling.Contact contact = Coupling.contact(kept.train(), absorbed.train(),
                            tuning.couplingMaxClosing());
                    if (contact == null) {
                        continue;
                    }
                    couplings++;
                    dirty = true;
                    if (contact instanceof Coupling.Bump bump) {
                        bump(level, network, kept, absorbed, bump, tuning);
                        refresh(level, network, candidates, kept);
                        refresh(level, network, candidates, absorbed);
                        continue search;
                    }
                    merge(level, network, kept.consist(), absorbed.consist(), (Coupling.Merge) contact);
                    candidates.remove(absorbed);
                    refresh(level, network, candidates, kept);
                    continue search; // the grown consist may touch a third one
                }
            }
            break;
        }
        return dirty;
    }

    /** Re-read a candidate after its consist changed (or drop it if it can't couple now). */
    private static void refresh(ServerLevel level, RailNetwork network, List<Candidate> candidates,
            Candidate stale) {
        int at = candidates.indexOf(stale);
        if (at < 0) {
            return;
        }
        Candidate fresh = candidate(level, network, stale.consist());
        if (fresh == null) {
            candidates.remove(at);
        } else {
            candidates.set(at, fresh);
        }
    }

    /**
     * Apply a bump (SPEC §6.12): two consists ran together faster than the
     * profile couples — they spring apart, the drivers hear and are told why
     * they didn't couple.
     */
    private void bump(ServerLevel level, RailNetwork network, Candidate kept, Candidate absorbed,
            Coupling.Bump bump, PhysicsTuning tuning) {
        TrackPath keptPath = kept.consist().resolvePath(network.graph(), network.revision());
        TrackPath absorbedPath = absorbed.consist().resolvePath(network.graph(), network.revision());
        kept.consist().bump(bump.keptShift(), bump.keptV(), keptPath);
        absorbed.consist().bump(bump.absorbedShift(), bump.absorbedV(), absorbedPath);
        if (keptPath != null) {
            impactSound(level, keptPath.samplePosition(bump.keptContactS()),
                    TrainPhysics.kmh(bump.closing()));
        }
        Component message = Component.translatable("message.railswheelsandtrains.bump",
                String.format("%.0f", tuning.couplingMaxSpeedKmh()));
        for (Consist consist : new Consist[] {kept.consist(), absorbed.consist()}) {
            Driver driver = driverOf(level, consist);
            if (driver != null) {
                driver.player().displayClientMessage(message, true);
            }
        }
    }

    /** Below this (km/h) running into something makes no bang. */
    private static final double IMPACT_SOUND_KMH = 2.0;

    /** The bang of a bump or of running into a track end, louder the harder. */
    private static void impactSound(ServerLevel level, Vector3d at, double kmh) {
        float volume = (float) Math.clamp(kmh / 20.0, 0.3, 2.0);
        level.playSound(null, at.x, at.y + 1.0, at.z, SoundEvents.ANVIL_LAND,
                SoundSource.NEUTRAL, volume, 0.6F);
    }

    /** The consist as a coupling candidate, or null if it can't couple now. */
    private static Candidate candidate(ServerLevel level, RailNetwork network, Consist consist) {
        if (!(consist.pathSpec() instanceof TrackPathSpec.Route)) {
            return null; // the v0 straight debug path doesn't couple
        }
        TrackPath path = consist.resolvePath(network.graph(), network.revision());
        if (!(path instanceof RoutePath routePath)
                || !(consist.pathSpec() instanceof TrackPathSpec.Route route)
                || consist.wagonIds().size() != consist.composition().wagonCount()) {
            return null;
        }
        Vector3d head = path.samplePosition(consist.s());
        if (!level.isPositionEntityTicking(BlockPos.containing(head.x, head.y, head.z))) {
            return null; // frozen by the chunkloading stub
        }
        ConsistComposition composition = consist.composition();
        return new Candidate(consist,
                new Coupling.Train(route.legs(), routePath, composition, consist.s(), consist.speed()),
                path.samplePosition(Coupling.frontEndS(composition, consist.s())),
                path.samplePosition(Coupling.rearEndS(composition, consist.s())));
    }

    /**
     * Cheap world-space prefilter: some end of one is near some end of the
     * other — within the overlap a tick of their closing can make.
     */
    private static boolean endsNear(Candidate a, Candidate b) {
        double reach = CONTACT_PREFILTER + Math.abs(a.train().v()) + Math.abs(b.train().v());
        double max = reach * reach;
        return a.front().distanceSquared(b.front()) <= max
                || a.front().distanceSquared(b.rear()) <= max
                || a.rear().distanceSquared(b.front()) <= max
                || a.rear().distanceSquared(b.rear()) <= max;
    }

    /** Which consist survives a coupling (keeps its id): the driven one, else the heavier, else the older. */
    private static boolean keepFirst(Consist a, Driver driverA, Consist b, Driver driverB) {
        if ((driverA != null) != (driverB != null)) {
            return driverA != null;
        }
        double massA = a.composition().totalMassT();
        double massB = b.composition().totalMassT();
        if (massA != massB) {
            return massA > massB;
        }
        return a.id() < b.id();
    }

    /**
     * Apply a coupling: the kept consist takes the merged route, make-up, head
     * and speed (its own frame direction is preserved, so its handles stay
     * valid), every wagon entity gets the kept id and its new index, and the
     * absorbed consist is dropped. Riders stay aboard — they ride wagon
     * entities, which don't change; the clank sounds at the closed coupler.
     */
    private void merge(ServerLevel level, RailNetwork network, Consist kept, Consist absorbed,
            Coupling.Merge plan) {
        Driver keptDriver = driverOf(level, kept);
        Driver absorbedDriver = driverOf(level, absorbed);
        List<UUID> ids = new ArrayList<>(plan.members().size());
        for (Coupling.Member member : plan.members()) {
            Consist source = member.source() == Coupling.Member.KEPT ? kept : absorbed;
            UUID uuid = source.wagonIds().get(member.index());
            ids.add(uuid);
            if (member.turned() && level.getEntity(uuid) instanceof WagonEntity wagon) {
                wagon.turnAround(); // its pose frame turns with it: riders keep their spot
            }
        }
        kept.rebase(TrackPathSpec.Route.of(plan.legs()), plan.composition(), plan.headS(), plan.v());
        kept.shiftFrame(plan.frameShift());
        kept.wagonIds().clear();
        kept.wagonIds().addAll(ids);
        kept.takeHandbrakes(absorbed);
        remove(absorbed.id());
        for (int i = 0; i < ids.size(); i++) {
            if (level.getEntity(ids.get(i)) instanceof WagonEntity wagon) {
                wagon.setConsistId(kept.id());
                wagon.setWagonIndex(i);
            }
        }
        TrackPath path = kept.resolvePath(network.graph(), network.revision());
        if (path != null) {
            Vector3d at = path.samplePosition(plan.contactS());
            level.playSound(null, at.x, at.y + 1.0, at.z, SoundEvents.ANVIL_LAND,
                    SoundSource.NEUTRAL, 0.5F, 1.6F);
        }
        // the front-most manned cab drives the merged train; a driver left in
        // another cab is told their handles went dead
        Driver driver = driverOf(level, kept);
        if (driver != null) {
            driver.player().displayClientMessage(Component.translatable(
                    "message.railswheelsandtrains.coupled", kept.composition().wagonCount()), true);
        }
        for (Driver before : new Driver[] {keptDriver, absorbedDriver}) {
            if (before != null && (driver == null || before.player() != driver.player())) {
                before.player().displayClientMessage(Component.translatable(
                        "message.railswheelsandtrains.drive_other_cab"), true);
            }
        }
        setDirty();
    }

    /**
     * Uncouple {@code consist} in front of wagon {@code cut}
     * ({@code 1 ≤ cut < wagonCount}, SPEC §6.12): wagons {@code [0, cut)}
     * stay this consist (id, route, head — nothing moves), {@code [cut, n)}
     * become a new consist on the same route with its own head and the same
     * speed. The handles go with the part the driver sits in (no driver: the
     * front part); the other part keeps the reverser and brake setting with
     * the throttle shut. Halves left at exactly the coupler gap with equal
     * speed don't re-couple ({@link Coupling}).
     *
     * @return the new rear consist, or null if {@code cut} isn't one of its couplers
     */
    public Consist split(ServerLevel level, Consist consist, int cut) {
        int count = consist.composition().wagonCount();
        if (cut < 1 || cut >= count || consist.wagonIds().size() != count) {
            return null;
        }
        Coupling.Split plan = Coupling.split(consist.composition(), consist.s(), cut);
        Driver driver = driverOf(level, consist);
        boolean driverInRear = driver != null
                && consist.wagonIds().indexOf(driver.cab().getUUID()) >= cut;
        RailNetwork network = RailNetwork.get(level);
        TrackPath path = consist.resolvePath(network.graph(), network.revision());
        Vector3d coupler = path == null ? null
                : path.samplePosition(Coupling.couplerS(consist.composition(), consist.s(), cut - 1));

        Consist rear = new Consist(nextId++, consist.pathSpec(), plan.rear(), plan.rearHeadS(),
                consist.speed());
        rear.copyHandlesFrom(consist, driverInRear);
        if (driverInRear) {
            consist.closeThrottle();
        }
        List<UUID> tail = consist.wagonIds().subList(cut, count);
        rear.wagonIds().addAll(tail);
        tail.clear();
        rear.takeHandbrakes(consist);
        consist.setComposition(plan.front());
        // clients seed the new consist's interpolation from this one's
        rear.inheritFrame(consist.id(), plan.rearHeadS() - consist.s());
        consists.put(rear.id(), rear);
        for (int i = 0; i < rear.wagonIds().size(); i++) {
            if (level.getEntity(rear.wagonIds().get(i)) instanceof WagonEntity wagon) {
                wagon.setConsistId(rear.id());
                wagon.setWagonIndex(i);
            }
        }
        if (coupler != null) {
            level.playSound(null, coupler.x, coupler.y + 1.0, coupler.z, SoundEvents.CHAIN_BREAK,
                    SoundSource.NEUTRAL, 1.0F, 0.8F);
        }
        setDirty();
        return rear;
    }

    /**
     * A player used the crowbar on the coupler at the front ({@code front}) or
     * rear end of {@code wagon} (SPEC §6.12): uncouple there if the coupler
     * is within reach, with actionbar feedback.
     *
     * @return true if the consist was split
     */
    public boolean uncoupleBy(ServerLevel level, ServerPlayer player, WagonEntity wagon,
            boolean front) {
        Consist consist = byId(wagon.getConsistId());
        if (consist == null) {
            return false;
        }
        int index = consist.wagonIds().indexOf(wagon.getUUID());
        int cut = front ? index : index + 1;
        if (index < 0 || cut < 1 || cut >= consist.composition().wagonCount()) {
            return false;
        }
        RailNetwork network = RailNetwork.get(level);
        TrackPath path = consist.resolvePath(network.graph(), network.revision());
        if (path == null) {
            return false;
        }
        Vector3d at = path.samplePosition(
                Coupling.couplerS(consist.composition(), consist.s(), cut - 1));
        double reach = player.blockInteractionRange() + COUPLER_REACH_SLACK;
        if (player.getEyePosition().distanceToSqr(at.x, at.y + 1.0, at.z) > reach * reach) {
            return false;
        }
        Consist rear = split(level, consist, cut);
        if (rear == null) {
            return false;
        }
        player.displayClientMessage(Component.translatable("message.railswheelsandtrains.uncoupled",
                consist.composition().wagonCount(), rear.composition().wagonCount()), true);
        return true;
    }

    /**
     * A player turned a wagon's handbrake wheel with the crowbar (SPEC §5.3):
     * set it if released, release it if set — if the wagon is within reach.
     * Under a profile whose handbrakes set themselves the wheel isn't the
     * player's: they are told so, nothing turns.
     *
     * @return true if the handbrake moved
     */
    public boolean toggleHandbrakeBy(ServerPlayer player, WagonEntity wagon) {
        Consist consist = byId(wagon.getConsistId());
        int index = consist == null ? -1 : consist.wagonIds().indexOf(wagon.getUUID());
        if (index < 0 || index >= consist.composition().wagonCount()) {
            return false;
        }
        double reach = player.blockInteractionRange()
                + consist.composition().slot(index).type().length() * 0.5 + 1.0;
        if (player.getEyePosition().distanceToSqr(wagon.position()) > reach * reach) {
            return false;
        }
        if (ServerConfig.tuning().autoHandbrake()) {
            player.displayClientMessage(Component.translatable(
                    "message.railswheelsandtrains.handbrake_auto"), true);
            return false;
        }
        boolean set = !consist.handbrake(wagon.getUUID());
        consist.setHandbrake(wagon.getUUID(), set);
        wagon.level().playSound(null, wagon.getX(), wagon.getY() + 1.0, wagon.getZ(),
                SoundEvents.CHAIN_PLACE, SoundSource.NEUTRAL, 0.8F, set ? 0.8F : 1.2F);
        player.displayClientMessage(Component.translatable(set
                        ? "message.railswheelsandtrains.handbrake_set"
                        : "message.railswheelsandtrains.handbrake_released",
                consist.handbrakesSet(), consist.wagonIds().size()), true);
        setDirty();
        return true;
    }

    /** Inflate the wagon AABB by the longest stock half-length when looking for entities to shove. */
    private static final double SHOVE_REACH = 14.0;
    /** Cap a player's per-tick shove so a deep overlap ejects over a few ticks, not a launch. */
    private static final double SHOVE_PUSH_SPEED = 0.5;

    /**
     * Push living entities the wagon's hull has overrun out its nearest face
     * (SPEC v1.5-а part 2). The entity-move clamp in {@code EntityHullCollisionMixin}
     * stops things walking <i>into</i> the car, but a moving car running into a
     * standing entity is the wagon's motion, not the entity's — so we resolve it
     * here, after the pose is set. Mobs are teleported clear (server-authoritative);
     * a player gets an outward velocity impulse via a motion packet instead, so we
     * never {@code setPos} a client-authoritative player (no rubber-band / "moved
     * wrongly"). Riders (passengers) are skipped — they ride the car by design.
     */
    private static void shoveOutsiders(ServerLevel level, WagonEntity wagon) {
        WagonType.Hull hull = wagon.collisionHull();
        if (hull == null) {
            return;
        }
        AABB search = wagon.getBoundingBox().inflate(SHOVE_REACH);
        List<Entity> nearby = level.getEntities(wagon, search,
                e -> e instanceof LivingEntity && !e.isSpectator() && !e.isPassenger());
        if (nearby.isEmpty()) {
            return;
        }
        Vector3d hullMin = new Vector3d(hull.minX(), hull.minY(), hull.minZ());
        Vector3d hullMax = new Vector3d(hull.maxX(), hull.maxY(), hull.maxZ());
        Vector3d body = new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ());
        for (Entity e : nearby) {
            AABB box = e.getBoundingBox();
            if (e instanceof Player && wagon.inOpenDoorway(box.getCenter())) {
                continue; // stepping through a door — boarding takes it from here
            }
            Vector3d center = new Vector3d(
                    (box.minX + box.maxX) * 0.5,
                    (box.minY + box.maxY) * 0.5,
                    (box.minZ + box.maxZ) * 0.5);
            Vector3d disp = HullCollision.shove(hullMin, hullMax, body,
                    wagon.getYRot(), wagon.getXRot(), center,
                    (box.maxX - box.minX) * 0.5,
                    (box.maxY - box.minY) * 0.5,
                    (box.maxZ - box.minZ) * 0.5);
            if (disp.lengthSquared() < 1.0e-12) {
                continue;
            }
            if (e instanceof ServerPlayer player) {
                double len = disp.length();
                double scale = len > SHOVE_PUSH_SPEED ? SHOVE_PUSH_SPEED / len : 1.0;
                player.setDeltaMovement(disp.x * scale, disp.y * scale, disp.z * scale);
                player.hasImpulse = true;
                player.connection.send(new ClientboundSetEntityMotionPacket(player));
            } else {
                e.setPos(e.getX() + disp.x, e.getY() + disp.y, e.getZ() + disp.z);
            }
        }
    }

    /**
     * Who drives a consist: the player seated in a cab, the cab wagon, and
     * which way along the path that cab faces (+1 = +s; a cab in a flipped
     * slot faces −s).
     */
    public record Driver(ServerPlayer player, WagonEntity cab, int facing) {
    }

    /**
     * The consist's driver (SPEC §6.12: any cab, not just the head wagon):
     * the player at the controls of the first {@linkplain WagonType#drivable()
     * cab} wagon, by index, that has one — with several manned cabs the
     * front-most is in control. At the controls (SPEC §9.7) means in the
     * driver's chair of a walkable cab, or riding a cab without a walkable
     * interior: someone walking about a cab — or the saloon of an EMU's head
     * car — never drives, the chair decides, not the kind of wagon. Null if
     * no cab is manned.
     */
    public static Driver driverOf(ServerLevel level, Consist consist) {
        List<UUID> ids = consist.wagonIds();
        ConsistComposition composition = consist.composition();
        for (int i = 0; i < ids.size() && i < composition.wagonCount(); i++) {
            ConsistComposition.Slot slot = composition.slot(i);
            if (!slot.type().drivable() || !(level.getEntity(ids.get(i)) instanceof WagonEntity wagon)) {
                continue;
            }
            for (Entity passenger : wagon.getPassengers()) {
                if (passenger instanceof ServerPlayer player && atControls(wagon, player)) {
                    return new Driver(player, wagon, slot.flipped() ? -1 : 1);
                }
            }
        }
        return null;
    }

    /**
     * True if {@code player} riding {@code cab} is at its controls: in the
     * driver's chair, or on the vehicle's own seat of a cab without a
     * walkable interior (SPEC §9.7; the client's {@code ClientDriveInput.atControls}).
     */
    public static boolean atControls(WagonEntity cab, ServerPlayer player) {
        return cab.isSeated(player) || !cab.isWalkingRider(player);
    }

    // --- SavedData ---

    @Override
    public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
        tag.putInt("NextId", nextId);
        ListTag list = new ListTag();
        for (Consist consist : consists.values()) {
            list.add(consist.save(new CompoundTag()));
        }
        tag.put("Consists", list);
        return tag;
    }

    private static ConsistManager load(CompoundTag tag, HolderLookup.Provider registries) {
        ConsistManager manager = new ConsistManager();
        manager.nextId = Math.max(1, tag.getInt("NextId"));
        for (Tag entry : tag.getList("Consists", Tag.TAG_COMPOUND)) {
            Consist consist = Consist.load((CompoundTag) entry);
            manager.consists.put(consist.id(), consist);
        }
        return manager;
    }
}
