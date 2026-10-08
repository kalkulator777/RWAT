package com.muzhik17.trainsmod.rail;

import org.joml.Vector3d;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * The rail marker (SPEC §2.2 UX): a placeable stake that marks one end of a
 * future segment. On placement it captures the player's horizontal look,
 * rounded to 45° ({@link #ROTATION}, 8 steps) — that becomes the spline
 * tangent <em>axis</em> at this node (the sign is resolved toward the other
 * end when the segment is built, so 180° apart is the same axis).
 *
 * <p>Markers are consumed in pairs by the rail item: clicking one with rails
 * connects it to the nearest other marker and removes both blocks. The
 * server-side marker registry lives in {@link RailNetwork}; this block only
 * reports its own place/remove. Junctions are built via the
 * {@link RailSwitchMarkerBlock} subtype.
 */
public class RailMarkerBlock extends Block {

    /** Horizontal look direction in 45° steps: 0 = south, counted clockwise (MC yaw). */
    public static final IntegerProperty ROTATION = IntegerProperty.create("rotation", 0, 7);

    private static final VoxelShape SHAPE = Block.box(6, 0, 6, 10, 12, 10);

    public RailMarkerBlock(Properties properties) {
        super(properties);
        registerDefaultState(stateDefinition.any().setValue(ROTATION, 0));
    }

    /** The horizontal tangent axis a rotation value encodes (unit, sign = the look at placement). */
    public static Vector3d direction(int rotation) {
        double yaw = Math.toRadians(rotation * 45.0);
        return new Vector3d(-Math.sin(yaw), 0.0, Math.cos(yaw));
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(ROTATION);
    }

    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        int rotation = Math.floorMod(Math.round(context.getRotation() / 45.0F), 8);
        return defaultBlockState().setValue(ROTATION, rotation);
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return SHAPE;
    }

    @Override
    protected void onPlace(BlockState state, Level level, BlockPos pos, BlockState oldState, boolean movedByPiston) {
        super.onPlace(state, level, pos, oldState, movedByPiston);
        if (level instanceof ServerLevel serverLevel && !oldState.is(this)) {
            RailNetwork.get(serverLevel).addMarker(pos, state.getValue(ROTATION));
        }
    }

    @Override
    protected void onRemove(BlockState state, Level level, BlockPos pos, BlockState newState, boolean movedByPiston) {
        if (level instanceof ServerLevel serverLevel && !newState.is(this)) {
            RailNetwork.get(serverLevel).removeMarker(pos);
        }
        super.onRemove(state, level, pos, newState, movedByPiston);
    }
}
