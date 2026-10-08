package com.muzhik17.trainsmod.rail;

import com.muzhik17.trainsmod.path.RailSegment;

import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Track bed: the rails' collision (SPEC §2.2, 0.3) — a real, visible block laid
 * along the spline by {@link RailNetwork}. Its <em>material</em> (what it looks
 * like — air, gravel, dirt…) is a future rail-editor choice; for now it is a
 * fixed gravel-textured block. Height is {@link #LAYERS} eighths of a block
 * (2px each): 1 on flat ground (a thin frame at the foot of the sleeper),
 * more on slopes so the bed top tracks the rising rail.
 *
 * <p>Dumb block: stores nothing about the graph; the graph in SavedData is
 * the source of truth. A segment's bed is one unit though — breaking any bed
 * block removes the whole segment (and the rest of its bed) via
 * {@link RailNetwork#removeSegmentContaining}.
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

    public TrackBedBlock(Properties properties) {
        super(properties);
        registerDefaultState(stateDefinition.any().setValue(LAYERS, 1));
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(LAYERS);
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return SHAPE_BY_LAYERS[state.getValue(LAYERS)];
    }

    /** Breaking one bed block dismantles the whole segment it belongs to. */
    @Override
    public BlockState playerWillDestroy(Level level, BlockPos pos, BlockState state, Player player) {
        if (level instanceof ServerLevel serverLevel) {
            RailSegment removed = RailNetwork.get(serverLevel).removeSegmentContaining(serverLevel, pos);
            if (removed != null) {
                player.displayClientMessage(Component.literal(
                        "Track segment #" + removed.id() + " removed."), true);
            }
        }
        return super.playerWillDestroy(level, pos, state, player);
    }
}
