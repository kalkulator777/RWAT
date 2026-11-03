package com.muzhik17.trainsmod.consist;

import java.util.List;

import org.joml.Vector3d;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientItemScreens;
import com.muzhik17.trainsmod.kinematics.ConsistKinematics;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.kinematics.WagonPose;
import com.muzhik17.trainsmod.network.TrackPathSpec;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.rail.RailNetwork;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypes;

import io.netty.buffer.ByteBuf;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/**
 * Rolling stock (SPEC §6.11): right-click into the air picks a wagon type and
 * livery from the installed packs (a client screen; the choice is stored on
 * the stack), right-click on the track places that wagon there as a consist of
 * one, facing where the player looks along the track. Trains are assembled by
 * running placed units into each other (auto-coupling).
 */
public class RollingStockItem extends Item {

    /** How far from the track centre line a click still counts as "on the track" (bed half-width + slack). */
    private static final double CLICK_REACH = 2.5;
    /** Spacing of the probes along a new wagon's axis when testing for overlap with placed stock. */
    private static final double OVERLAP_PROBE_STEP = 0.5;
    /** Height of those probes above the body origin — inside every hull, above the under-frame gap. */
    private static final double OVERLAP_PROBE_Y = 1.0;

    /** The chosen wagon type id and livery ({@code ""} = base textures). */
    public record Selection(String type, String livery) {

        public static final Codec<Selection> CODEC = RecordCodecBuilder.create(instance -> instance.group(
                Codec.STRING.fieldOf("type").forGetter(Selection::type),
                Codec.STRING.optionalFieldOf("livery", ConsistComposition.Slot.BASE_LIVERY)
                        .forGetter(Selection::livery))
                .apply(instance, Selection::new));

        public static final StreamCodec<ByteBuf, Selection> STREAM_CODEC = StreamCodec.composite(
                ByteBufCodecs.STRING_UTF8, Selection::type,
                ByteBufCodecs.STRING_UTF8, Selection::livery,
                Selection::new);
    }

    public RollingStockItem(Properties properties) {
        super(properties);
    }

    /** Right-click into the air: the stock picker. */
    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        if (level.isClientSide) {
            ClientItemScreens.openStockPicker(hand);
        }
        return InteractionResultHolder.sidedSuccess(player.getItemInHand(hand), level.isClientSide);
    }

    /** Right-click on the track: place the chosen wagon there. */
    @Override
    public InteractionResult useOn(UseOnContext context) {
        Player player = context.getPlayer();
        if (player == null) {
            return InteractionResult.PASS;
        }
        if (!(context.getLevel() instanceof ServerLevel level)) {
            return InteractionResult.SUCCESS;
        }
        ItemStack stack = context.getItemInHand();
        Selection selection = stack.get(RailsWheelsAndTrains.STOCK_SELECTION.get());
        if (selection == null) {
            player.displayClientMessage(Component.translatable(
                    "message.railswheelsandtrains.rolling_stock.choose_first"), true);
            return InteractionResult.CONSUME;
        }
        WagonType type = WagonTypes.byId(selection.type());
        if (type == null) {
            player.displayClientMessage(Component.translatable(
                    "message.railswheelsandtrains.rolling_stock.unknown", selection.type()), true);
            return InteractionResult.CONSUME;
        }
        Vec3 click = context.getClickLocation();
        Component problem = place(level, player, type, selection.livery(),
                new Vector3d(click.x, click.y, click.z));
        if (problem != null) {
            player.displayClientMessage(problem, true);
            return InteractionResult.CONSUME;
        }
        if (!player.getAbilities().instabuild) {
            stack.shrink(1);
        }
        level.playSound(null, context.getClickedPos(), SoundEvents.NETHERITE_BLOCK_PLACE,
                SoundSource.BLOCKS, 0.8F, 0.7F);
        return InteractionResult.CONSUME;
    }

    /**
     * Place one wagon of {@code type} with its body centre on the track point
     * nearest to {@code click}, its front toward where the player looks along
     * the track. Returns why it can't be placed, or null once it is.
     */
    private static Component place(ServerLevel level, Player player, WagonType type, String livery,
            Vector3d click) {
        RailGraph graph = RailNetwork.get(level).graph();
        RailGraph.SegmentHit hit = graph.nearestPoint(click, CLICK_REACH);
        if (hit == null) {
            return Component.translatable("message.railswheelsandtrains.rolling_stock.not_on_track");
        }
        RailGraph.Walk walk = graph.walkAround(List.of(new RailGraph.RouteLeg(hit.segment().id(), false)));
        TrackPathSpec.Route spec = TrackPathSpec.Route.of(walk.legs());
        TrackPath path = spec.resolve(graph);
        double centreS = graph.legS(walk.legs(), walk.keptStart(), hit.s());
        if (path == null || Double.isNaN(centreS)) {
            return Component.translatable("message.railswheelsandtrains.rolling_stock.not_on_track");
        }
        // the route's +s is the consist's forward: turn the route to the look
        Vector3d tangent = path.sampleTangent(centreS);
        Vec3 look = player.getLookAngle();
        if (tangent.x * look.x + tangent.z * look.z < 0.0) {
            spec = spec.inverted();
            path = spec.resolve(graph);
            centreS = path.length() - centreS;
        }

        ConsistComposition.Slot slot = new ConsistComposition.Slot(type, false, livery);
        ConsistComposition composition = new ConsistComposition(List.of(slot));
        double headS = centreS + slot.frontBogieOffset();
        if (!path.loop()) {
            double min = composition.totalLength();
            if (path.length() < min) {
                return Component.translatable("message.railswheelsandtrains.rolling_stock.track_too_short",
                        String.format("%.1f", type.length()));
            }
            headS = Math.clamp(headS, min, path.length());
        }
        WagonPose pose = ConsistKinematics.wagonPose(path, headS, 0, composition);
        if (overlapsStock(level, pose, type)) {
            return Component.translatable("message.railswheelsandtrains.rolling_stock.occupied");
        }
        if (ConsistManager.get(level).spawn(level, spec, path, composition, headS) == null) {
            return Component.translatable("message.railswheelsandtrains.rolling_stock.refused");
        }
        return null;
    }

    /**
     * Whether a new wagon at {@code pose} would sit inside stock already on the
     * rails: probes along its axis, frame end to frame end, tested against the
     * collision hull of every wagon nearby (each in its own local frame).
     */
    private static boolean overlapsStock(ServerLevel level, WagonPose pose, WagonType type) {
        Vector3d body = pose.body();
        AABB search = new AABB(body.x, body.y, body.z, body.x, body.y, body.z).inflate(type.length() + 16.0);
        List<WagonEntity> nearby = level.getEntitiesOfClass(WagonEntity.class, search);
        if (nearby.isEmpty()) {
            return false;
        }
        double half = type.length() / 2.0;
        for (double z = -half; z <= half + 1.0e-9; z += OVERLAP_PROBE_STEP) {
            Vector3d probe = PoseMath.localToWorld(body, pose.yaw(), pose.pitch(),
                    new Vector3d(0.0, OVERLAP_PROBE_Y, Math.min(z, half)));
            for (WagonEntity other : nearby) {
                WagonType.Hull hull = other.collisionHull();
                if (hull == null) {
                    continue;
                }
                Vector3d local = PoseMath.worldToLocal(
                        new Vector3d(other.getX(), other.getY(), other.getZ()),
                        other.getYRot(), other.getXRot(), probe);
                if (local.x >= hull.minX() && local.x <= hull.maxX()
                        && local.y >= hull.minY() && local.y <= hull.maxY()
                        && local.z >= hull.minZ() && local.z <= hull.maxZ()) {
                    return true;
                }
            }
        }
        return false;
    }

    /** "Rolling Stock (ChME3)" once a type is chosen; the bare item name before. */
    @Override
    public Component getName(ItemStack stack) {
        Selection selection = stack.get(RailsWheelsAndTrains.STOCK_SELECTION.get());
        if (selection == null) {
            return super.getName(stack);
        }
        return Component.translatable(getDescriptionId(stack) + ".named", stockName(selection.type()));
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip,
            TooltipFlag flag) {
        Selection selection = stack.get(RailsWheelsAndTrains.STOCK_SELECTION.get());
        if (selection != null) {
            tooltip.add(Component.literal(selection.type()).withStyle(ChatFormatting.DARK_GRAY));
            if (!selection.livery().isEmpty()) {
                tooltip.add(Component.translatable("tooltip.railswheelsandtrains.livery",
                        selection.livery()).withStyle(ChatFormatting.GRAY));
            }
        }
        tooltip.add(Component.translatable("tooltip.railswheelsandtrains.rolling_stock.usage")
                .withStyle(ChatFormatting.GRAY));
    }

    /** A wagon type's display name from the packs' lang files, the id if none. */
    public static Component stockName(String typeId) {
        return Component.translatableWithFallback("wagon." + typeId.replace(':', '.'), typeId);
    }
}
