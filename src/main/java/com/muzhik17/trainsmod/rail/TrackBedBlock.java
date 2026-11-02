package com.muzhik17.trainsmod.rail;

import com.muzhik17.trainsmod.path.RailSegment;

import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.RenderShape;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Track bed: the rails' collision (SPEC §2.2, 0.3) — a real block laid along
 * the spline by {@link RailNetwork}. Its {@link BedMaterial} (what it looks
 * like — gravel, stone, planks… or nothing at all) is picked with the rail
 * style; every material is a block of this class of its own. Height is
 * {@link #LAYERS} eighths of a block (2px each): 1 on flat ground (a thin
 * frame at the foot of the sleeper), more on slopes so the bed top tracks the
 * rising rail.
 *
 * <p>Dumb block: stores nothing about the graph; the graph in SavedData is
 * the source of truth. A structure's bed is one unit though — breaking any
 * bed block removes the whole structure (and the rest of its bed) via
 * {@link RailNetwork#removeSegmentContaining}, if the player may break in
 * every cell of it. The broken block itself stays when track still wants
 * it: the neighbour's bed at a joint or a crossing, or the structure the
 * player was not allowed to take down.
 */
public class TrackBedBlock extends Block {

    /** Bed height in eighths of a block (2px per layer). */
    public static final IntegerProperty LAYERS = IntegerProperty.create("layers", 1, 8);

    private static final VoxelShape[] SHAPE_BY_LAYERS = new VoxelShape[9];
    static {
        for (int layers = 1; layers <= 8; layers++) {
            SHAPE_BY_LAYERS[layers] = Block.box(0, 0, 0, 16, 2 * layers, 16);
        }
    }

    private final BedMaterial material;

    public TrackBedBlock(Properties properties, BedMaterial material) {
        super(properties);
        this.material = material;
        registerDefaultState(stateDefinition.any().setValue(LAYERS, 1));
    }

    public BedMaterial material() {
        return material;
    }

    /** The invisible bed draws nothing; it still has its shape, so it is walked on and can be broken. */
    @Override
    protected RenderShape getRenderShape(BlockState state) {
        return material.invisible() ? RenderShape.INVISIBLE : RenderShape.MODEL;
    }

    /** Nor does it shade: a full-height invisible bed (steep slopes) would cast AO and sky shadow. */
    @Override
    protected float getShadeBrightness(BlockState state, BlockGetter level, BlockPos pos) {
        return material.invisible() ? 1.0F : super.getShadeBrightness(state, level, pos);
    }

    @Override
    protected boolean propagatesSkylightDown(BlockState state, BlockGetter level, BlockPos pos) {
        return material.invisible() || super.propagatesSkylightDown(state, level, pos);
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(LAYERS);
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return SHAPE_BY_LAYERS[state.getValue(LAYERS)];
    }

    /**
     * Breaking one bed block dismantles the whole structure it belongs to —
     * or nothing, if the player may not break somewhere along it (they are
     * told where).
     */
    @Override
    public BlockState playerWillDestroy(Level level, BlockPos pos, BlockState state, Player player) {
        if (level instanceof ServerLevel serverLevel && player instanceof ServerPlayer breaker) {
            RailSegment removed = RailNetwork.get(serverLevel).removeSegmentContaining(serverLevel, breaker, pos);
            if (removed != null) {
                player.displayClientMessage(Component.literal(
                        "Track segment #" + removed.id() + " removed."), true);
            }
        }
        return super.playerWillDestroy(level, pos, state, player);
    }

    /**
     * Vanilla takes the broken block out after {@link #playerWillDestroy}
     * whatever happened there. Not if some track still wants the cell: the
     * surviving neighbour at a joint or a crossing has just re-laid its bed
     * into it, or the structure stands because the player may not take it
     * down — air there would be a hole in that bed. The client, which took
     * the block out ahead of the server, gets it back with the server's
     * answer to the break.
     */
    @Override
    public boolean onDestroyedByPlayer(BlockState state, Level level, BlockPos pos, Player player,
            boolean willHarvest, FluidState fluid) {
        if (level instanceof ServerLevel serverLevel && RailNetwork.get(serverLevel).isTrackBed(pos)) {
            return false;
        }
        return super.onDestroyedByPlayer(state, level, pos, player, willHarvest, fluid);
    }
}
