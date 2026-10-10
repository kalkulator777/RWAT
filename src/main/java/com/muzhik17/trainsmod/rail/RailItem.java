package com.muzhik17.trainsmod.rail;

import java.util.ArrayList;
import java.util.List;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientItemScreens;
import com.muzhik17.trainsmod.path.RailSegment;

import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;

/**
 * The rails (SPEC §2.2 UX). Clicking a plain {@link RailMarkerBlock} connects
 * it to the nearest other plain marker — a segment is built between the two
 * with tangents taken from the markers' directions, and both marker blocks are
 * consumed.
 *
 * <p>Clicking a {@link RailSwitchMarkerBlock} builds a junction instead: with
 * three more switch markers in range — a diamond crossing (two independent
 * segments between opposite pairs); otherwise — a Y-switch from this marker
 * (the toe) to the two nearest plain markers (the branch ends), two segments
 * sharing the toe node and its tangent. All involved markers are consumed.
 *
 * <p>Right-clicking into the air opens the rail style picker (SPEC §6.10):
 * the chosen style and bed material (SPEC §2.2) are stored on the stack, and
 * every segment this item builds is drawn in that style on that bed.
 * Sneak-right-clicking existing track repaints its whole structure in the
 * held style and bed.
 */
public class RailItem extends Item {

    private static final double MIN_SEGMENT_LENGTH = 2.0;
    private static final double MAX_SEGMENT_LENGTH = 512.0;
    /**
     * Min |cos| between a flat-crossing chord and its end markers' axes: the
     * markers must face each other along the chord. 8 marker rotations put the
     * worst honest misalignment at 22.5° (cos ≈ 0.92); 45° tolerance separates
     * that cleanly from perpendicular strays.
     */
    private static final double FACING_MIN = 0.7;

    public RailItem(Properties properties) {
        super(properties);
    }

    /** The rail style a rails stack builds with; {@link RailSegment#DEFAULT_STYLE} if none was chosen. */
    public static String style(ItemStack stack) {
        return stack.getOrDefault(RailsWheelsAndTrains.RAIL_STYLE.get(), RailSegment.DEFAULT_STYLE);
    }

    /** The bed material id a rails stack lays; {@link RailSegment#DEFAULT_BED} if none was chosen. */
    public static String bed(ItemStack stack) {
        return stack.getOrDefault(RailsWheelsAndTrains.RAIL_BED.get(), RailSegment.DEFAULT_BED);
    }

    /** The rail style and bed a rails stack builds with. */
    public static RailSegment.Look look(ItemStack stack) {
        return new RailSegment.Look(style(stack), bed(stack));
    }

    @Override
    public InteractionResult useOn(UseOnContext context) {
        Player player = context.getPlayer();
        if (player == null) {
            return InteractionResult.PASS;
        }
        RailSegment.Look look = look(context.getItemInHand());
        BlockState state = context.getLevel().getBlockState(context.getClickedPos());
        if (player.isSecondaryUseActive() && state.getBlock() instanceof TrackBedBlock) {
            if (context.getLevel() instanceof ServerLevel level) {
                int restyled = RailNetwork.get(level)
                        .restyleStructureAt(level, context.getClickedPos(), look);
                if (restyled > 0) {
                    player.displayClientMessage(Component.translatable(
                            "message.railswheelsandtrains.rail.restyled", restyled,
                            styleName(look.style()), BedMaterial.of(look.bed()).displayName()), true);
                }
            }
            return InteractionResult.sidedSuccess(context.getLevel().isClientSide);
        }
        if (!(state.getBlock() instanceof RailMarkerBlock)) {
            if (!context.getLevel().isClientSide) {
                player.displayClientMessage(
                        Component.translatable("message.railswheelsandtrains.rail.click_marker"), true);
            }
            return InteractionResult.CONSUME;
        }
        if (!(context.getLevel() instanceof ServerLevel level)) {
            return InteractionResult.SUCCESS;
        }
        if (state.getBlock() instanceof RailSwitchMarkerBlock) {
            buildJunction(level, player, look, context.getClickedPos(), state);
        } else {
            buildPlainSegment(level, player, look, context.getClickedPos(), state);
        }
        return InteractionResult.CONSUME;
    }

    /**
     * Plain marker clicked: one segment to the nearest other plain marker —
     * unless the three nearest plain markers form a crossing with it (paired
     * chords cross and the markers face along their chords), then it's a flat
     * crossing (SPEC §2.2, 2026-06-11): two independent segments crossing
     * визуально, no junction node — there is no switch in a plain crossing,
     * so plain markers build it. The geometry test is the gate — stray
     * markers elsewhere in range must not block (or trigger) the crossing.
     */
    private static void buildPlainSegment(ServerLevel level, Player player, RailSegment.Look look,
            BlockPos posA, BlockState stateA) {
        RailNetwork network = RailNetwork.get(level);
        Vector3d dirA = RailMarkerBlock.direction(stateA.getValue(RailMarkerBlock.ROTATION));
        List<BlockPos> nearest = network.nearestMarkers(level, posA, MAX_SEGMENT_LENGTH, false, 3);
        if (nearest.isEmpty()) {
            player.displayClientMessage(Component.literal(
                    "Rails: no second marker within " + (int) MAX_SEGMENT_LENGTH + " blocks."), true);
            return;
        }
        if (nearest.size() == 3 && buildFlatCrossing(level, player, look, network, posA, dirA, nearest)) {
            return;
        }
        BlockPos posB = nearest.get(0);

        // node points: the markers' cell centres at their base — the spline runs
        // through block centres, symmetric under the 3-wide bed (same convention
        // the old planner used for the clicked block's top face)
        Vector3d a = cellCentre(posA);
        Vector3d b = cellCentre(posB);
        double length = a.distance(b);
        if (length < MIN_SEGMENT_LENGTH) {
            player.displayClientMessage(Component.literal(
                    "Rails: markers too close (min " + (int) MIN_SEGMENT_LENGTH + " blocks)."), true);
            return;
        }

        Vector3d dirB = markerDirection(level, posB);

        // consume the markers first so the bed can occupy their cells
        level.removeBlock(posA, false);
        level.removeBlock(posB, false);
        RailSegment segment = network.createSegment(level, a, dirA, b, dirB, look);
        player.displayClientMessage(Component.literal(String.format(
                "Track segment #%d built (%.1f blocks).", segment.id(), length)), true);
    }

    /**
     * Try a flat crossing from four plain markers: pair them like the switch
     * builders do (clicked with the best-aligned, the rest together) and, if
     * the paired chords cross strictly between the markers and every marker
     * faces along its chord ({@link #FACING_MIN}), build the two independent
     * segments (no shared node — nothing to switch). Returns false when the
     * layout is not a crossing, so the caller falls back to the plain
     * nearest-pair build.
     */
    private static boolean buildFlatCrossing(ServerLevel level, Player player, RailSegment.Look look,
            RailNetwork network, BlockPos posA, Vector3d dirA, List<BlockPos> others) {
        Vector3d a = cellCentre(posA);
        BlockPos posB = bestAligned(others, a, dirA);
        List<BlockPos> rest = new ArrayList<>(others);
        rest.remove(posB);
        BlockPos posC = rest.get(0);
        BlockPos posD = rest.get(1);
        Vector3d b = cellCentre(posB);
        Vector3d c = cellCentre(posC);
        Vector3d d = cellCentre(posD);

        double[] tu = chordCrossing(a, b, c, d);
        if (tu == null) {
            return false;
        }
        if (a.distance(b) < MIN_SEGMENT_LENGTH || c.distance(d) < MIN_SEGMENT_LENGTH) {
            return false;
        }
        Vector3d dirB = markerDirection(level, posB);
        Vector3d dirC = markerDirection(level, posC);
        Vector3d dirD = markerDirection(level, posD);
        // every marker must face along its chord — marker axes are horizontal,
        // so the chords are compared in the horizontal plane too
        Vector3d ab = new Vector3d(b.x - a.x, 0.0, b.z - a.z).normalize();
        Vector3d cd = new Vector3d(d.x - c.x, 0.0, d.z - c.z).normalize();
        if (Math.abs(ab.dot(dirA)) < FACING_MIN || Math.abs(ab.dot(dirB)) < FACING_MIN
                || Math.abs(cd.dot(dirC)) < FACING_MIN || Math.abs(cd.dot(dirD)) < FACING_MIN) {
            return false;
        }

        level.removeBlock(posA, false);
        level.removeBlock(posB, false);
        level.removeBlock(posC, false);
        level.removeBlock(posD, false);
        RailSegment first = network.createSegment(level, a, dirA, b, dirB, look);
        RailSegment second = network.createSegment(level, c, dirC, d, dirD, look);
        network.groupSegments(level, List.of(first, second));
        player.displayClientMessage(Component.literal(String.format(
                "Flat crossing built: segments #%d and #%d (independent paths, no switch).",
                first.id(), second.id())), true);
        return true;
    }

    /**
     * Intersection parameters of the chords A→B and C→D in the horizontal
     * plane: {@code {t, u}} with both strictly inside (0, 1), or null if the
     * chords are parallel or cross outside the markers.
     */
    private static double[] chordCrossing(Vector3d a, Vector3d b, Vector3d c, Vector3d d) {
        double rx = b.x - a.x, rz = b.z - a.z;
        double sx = d.x - c.x, sz = d.z - c.z;
        double denom = rx * sz - rz * sx;
        if (Math.abs(denom) < 1.0e-6) {
            return null;
        }
        double t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / denom;
        double u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / denom;
        if (t <= 0.0 || t >= 1.0 || u <= 0.0 || u >= 1.0) {
            return null;
        }
        return new double[] {t, u};
    }

    /**
     * Switch marker clicked — the junction kind is picked by how many other
     * switch markers are in range: three → X-crossing, exactly one →
     * N-crossover (a diagonal between two parallel tracks), none → Y-switch
     * to the two nearest plain markers.
     */
    private static void buildJunction(ServerLevel level, Player player, RailSegment.Look look,
            BlockPos posA, BlockState stateA) {
        RailNetwork network = RailNetwork.get(level);
        Vector3d a = cellCentre(posA);
        Vector3d dirA = RailMarkerBlock.direction(stateA.getValue(RailMarkerBlock.ROTATION));

        List<BlockPos> switchMates = network.nearestMarkers(level, posA, MAX_SEGMENT_LENGTH, true, 3);
        if (switchMates.size() == 3) {
            buildCrossing(level, player, look, network, posA, a, dirA, switchMates);
            return;
        }
        if (switchMates.size() == 1) {
            buildCrossover(level, player, look, network, posA, a, dirA, switchMates.get(0));
            return;
        }
        if (switchMates.size() == 2) {
            player.displayClientMessage(Component.literal(
                    "Switch: 2 other switch markers in range is ambiguous — use 1 (N-crossover)"
                            + " or 3 (X-crossing)."), true);
            return;
        }

        List<BlockPos> branches = network.nearestMarkers(level, posA, MAX_SEGMENT_LENGTH, false, 2);
        if (branches.size() < 2) {
            player.displayClientMessage(Component.literal(
                    "Switch: needs two rail markers (branch ends) in range — or more"
                            + " switch markers (1 → N-crossover, 3 → X-crossing)."), true);
            return;
        }
        BlockPos posB = branches.get(0);
        BlockPos posC = branches.get(1);
        Vector3d b = cellCentre(posB);
        Vector3d c = cellCentre(posC);
        if (a.distance(b) < MIN_SEGMENT_LENGTH || a.distance(c) < MIN_SEGMENT_LENGTH) {
            player.displayClientMessage(Component.literal(
                    "Switch: a branch marker is too close (min " + (int) MIN_SEGMENT_LENGTH + " blocks)."), true);
            return;
        }
        Vector3d dirB = markerDirection(level, posB);
        Vector3d dirC = markerDirection(level, posC);

        level.removeBlock(posA, false);
        level.removeBlock(posB, false);
        level.removeBlock(posC, false);
        // both branches start at the same point → the second call snaps to the
        // first one's node, so the toe node (and its tangent) is shared
        RailSegment first = network.createSegment(level, a, dirA, b, dirB, look);
        RailSegment second = network.createSegment(level, a, dirA, c, dirC, look);
        network.groupSegments(level, List.of(first, second));
        network.registerSwitchStand(posA, a);
        player.displayClientMessage(Component.literal(String.format(
                "Switch built: segments #%d (%.1f blocks) and #%d (%.1f blocks).",
                first.id(), a.distance(b), second.id(), a.distance(c))), true);
    }

    /**
     * N-crossover from two switch markers and two plain ones (SPEC §2.2,
     * 2026-06-11): the switch markers A and C are the junction points on two
     * (typically parallel) tracks, each looking along its own track; the
     * plain markers B and D are the tracks' continuations. Builds three
     * segments — the through legs A–B and C–D plus the diagonal A–C, which
     * leaves A tangent to track 1 and joins C tangent to track 2 (a smooth
     * S-curve; both junction nodes keep their track's axis, so the through
     * tracks stay straight and later extensions snap on smoothly). Each plain
     * marker is matched to the junction it lies most along (max |cos| between
     * the junction's axis and the chord to the marker).
     */
    private static void buildCrossover(ServerLevel level, Player player, RailSegment.Look look, RailNetwork network,
            BlockPos posA, Vector3d a, Vector3d dirA, BlockPos posC) {
        Vector3d c = cellCentre(posC);
        Vector3d dirC = markerDirection(level, posC);

        List<BlockPos> plains = network.nearestMarkers(level, posA, MAX_SEGMENT_LENGTH, false, 8);
        if (plains.size() < 2) {
            player.displayClientMessage(Component.literal(
                    "Crossover: needs two rail markers (the tracks' continuations) in range."), true);
            return;
        }
        BlockPos posB = bestAligned(plains, a, dirA);
        List<BlockPos> rest = new ArrayList<>(plains);
        rest.remove(posB);
        BlockPos posD = bestAligned(rest, c, dirC);

        Vector3d b = cellCentre(posB);
        Vector3d d = cellCentre(posD);
        if (a.distance(b) < MIN_SEGMENT_LENGTH || c.distance(d) < MIN_SEGMENT_LENGTH
                || a.distance(c) < MIN_SEGMENT_LENGTH) {
            player.displayClientMessage(Component.literal(
                    "Crossover: markers are too close (min " + (int) MIN_SEGMENT_LENGTH + " blocks)."), true);
            return;
        }
        Vector3d dirB = markerDirection(level, posB);
        Vector3d dirD = markerDirection(level, posD);

        level.removeBlock(posA, false);
        level.removeBlock(posB, false);
        level.removeBlock(posC, false);
        level.removeBlock(posD, false);
        // through legs first create the junction nodes with their track axes;
        // the diagonal then snaps to both and curves smoothly between them
        RailSegment throughA = network.createSegment(level, a, dirA, b, dirB, look);
        RailSegment throughC = network.createSegment(level, c, dirC, d, dirD, look);
        RailSegment diagonal = network.createSegment(level, a, dirA, c, dirC, look);
        network.groupSegments(level, List.of(throughA, throughC, diagonal));
        network.registerSwitchStand(posA, a);
        network.registerSwitchStand(posC, c);
        player.displayClientMessage(Component.literal(String.format(
                "Crossover built: through legs #%d and #%d, diagonal #%d (%.1f blocks).",
                throughA.id(), throughC.id(), diagonal.id(), a.distance(c))), true);
    }

    /** The marker whose chord from {@code from} lies most along {@code axis} (max |cos|). */
    private static BlockPos bestAligned(List<BlockPos> candidates, Vector3d from, Vector3d axis) {
        BlockPos best = candidates.get(0);
        double bestAlign = -1.0;
        for (BlockPos pos : candidates) {
            Vector3d chord = cellCentre(pos).sub(from);
            if (chord.lengthSquared() < 1.0e-6) {
                continue;
            }
            double align = Math.abs(chord.normalize().dot(axis));
            if (align > bestAlign) {
                bestAlign = align;
                best = pos;
            }
        }
        return best;
    }

    /**
     * Junction from four switch markers (SPEC §2.2): the clicked marker pairs
     * with the one that lies along its own tangent axis (max |cos| between
     * the axis and the chord), the remaining two pair with each other. The
     * kind is then decided by the geometry of the two paired chords:
     * <ul>
     * <li><b>chords cross between the markers</b> → an X-crossing through a
     * shared centre node (see below);</li>
     * <li><b>chords don't cross</b> (parallel tracks) → a scissors crossover
     * ({@link #buildScissors}), как в RTM — те же 4 стрелочных маркера.</li>
     * </ul>
     *
     * <p>X-crossing (переработано 2026-06-11 — был glухой diamond без узла,
     * по плей-тесту нужен настоящий узел): the chords' intersection becomes a
     * shared centre node M and each path is split through it — four segments
     * A–M, M–B, C–M, M–D, so the centre is a real junction (routes cross it
     * straight through — turning would need slip curves, a later feature, so
     * no switch stand is registered here). The node carries the first
     * path's tangent axis; the second path's segments carry their own axis
     * as a per-end override.
     */
    private static void buildCrossing(ServerLevel level, Player player, RailSegment.Look look, RailNetwork network,
            BlockPos posA, Vector3d a, Vector3d dirA, List<BlockPos> others) {
        int partner = 0;
        double bestAlign = -1.0;
        for (int i = 0; i < others.size(); i++) {
            Vector3d chord = cellCentre(others.get(i)).sub(a).normalize();
            double align = Math.abs(chord.dot(dirA));
            if (align > bestAlign) {
                bestAlign = align;
                partner = i;
            }
        }
        BlockPos posB = others.get(partner);
        List<BlockPos> rest = new ArrayList<>(others);
        rest.remove(partner);
        BlockPos posC = rest.get(0);
        BlockPos posD = rest.get(1);

        Vector3d b = cellCentre(posB);
        Vector3d c = cellCentre(posC);
        Vector3d d = cellCentre(posD);

        // intersection of the chords A→B and C→D in the horizontal plane;
        // no crossing between the markers → the tracks run side by side, the
        // player is building a scissors crossover, not an X-crossing
        double rx = b.x - a.x, rz = b.z - a.z;
        double sx = d.x - c.x, sz = d.z - c.z;
        double denom = rx * sz - rz * sx;
        double t = 0.0;
        double u = 0.0;
        boolean crosses = Math.abs(denom) >= 1.0e-6;
        if (crosses) {
            t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / denom;
            u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / denom;
            crosses = t > 0.0 && t < 1.0 && u > 0.0 && u < 1.0;
        }
        if (!crosses) {
            buildScissors(level, player, look, network, posA, posB, posC, posD);
            return;
        }
        double y1 = a.y + t * (b.y - a.y);
        double y2 = c.y + u * (d.y - c.y);
        if (Math.abs(y1 - y2) > 1.0) {
            player.displayClientMessage(Component.literal(
                    "Crossing: the paths cross at different heights — use plain markers for a flyover."), true);
            return;
        }
        Vector3d m = new Vector3d(a.x + t * (b.x - a.x), (y1 + y2) / 2.0, a.z + t * (b.z - a.z));
        if (a.distance(m) < MIN_SEGMENT_LENGTH || b.distance(m) < MIN_SEGMENT_LENGTH
                || c.distance(m) < MIN_SEGMENT_LENGTH || d.distance(m) < MIN_SEGMENT_LENGTH) {
            player.displayClientMessage(Component.literal(
                    "Crossing: a marker is too close to the crossing point (min "
                            + (int) MIN_SEGMENT_LENGTH + " blocks)."), true);
            return;
        }
        Vector3d axis1 = new Vector3d(b).sub(a).normalize();
        Vector3d axis2 = new Vector3d(d).sub(c).normalize();
        Vector3d dirB = markerDirection(level, posB);
        Vector3d dirC = markerDirection(level, posC);
        Vector3d dirD = markerDirection(level, posD);

        level.removeBlock(posA, false);
        level.removeBlock(posB, false);
        level.removeBlock(posC, false);
        level.removeBlock(posD, false);
        // first path creates the centre node M with axis1; the second path's
        // legs snap to M but force their own axis2 at that end
        network.groupSegments(level, List.of(
                network.createSegment(level, a, dirA, false, m, axis1, false, look),
                network.createSegment(level, m, axis1, false, b, dirB, false, look),
                network.createSegment(level, c, dirC, false, m, axis2, true, look),
                network.createSegment(level, m, axis2, true, d, dirD, false, look)));
        player.displayClientMessage(Component.literal(String.format(
                "Crossing switch built: 4 segments through the centre node (%.0f, %.0f, %.0f).",
                m.x, m.y, m.z)), true);
    }

    /**
     * Scissors crossover from four switch markers on two parallel tracks
     * (SPEC §2.2, 2026-06-11, RTM-style): A–B is one track's chord, C–D the
     * other's (the pairing already grouped them). Builds the two through legs
     * plus both diagonals; each diagonal connects opposite ends (so the two
     * cross mid-way) and leaves/joins tangent to its track — smooth S-curves,
     * crossing each other без общего узла (diamond is visual only: a
     * diagonal-to-diagonal transfer is never a valid route anyway). All four
     * junction nodes carry their track's axis — later track extensions snap
     * on smoothly and each node is a 3-way switch.
     */
    private static void buildScissors(ServerLevel level, Player player, RailSegment.Look look, RailNetwork network,
            BlockPos posA, BlockPos posB, BlockPos posC, BlockPos posD) {
        Vector3d a = cellCentre(posA);
        Vector3d b = cellCentre(posB);
        Vector3d c = cellCentre(posC);
        Vector3d d = cellCentre(posD);

        // horizontal unit axis of track 1 and the other track's offset from it
        Vector3d u1 = new Vector3d(b.x - a.x, 0.0, b.z - a.z);
        if (u1.lengthSquared() < 1.0e-6) {
            player.displayClientMessage(Component.literal(
                    "Crossover: track markers coincide — rearrange them."), true);
            return;
        }
        u1.normalize();
        double offC = Math.abs((c.x - a.x) * u1.z - (c.z - a.z) * u1.x);
        double offD = Math.abs((d.x - a.x) * u1.z - (d.z - a.z) * u1.x);
        if (offC < 1.5 || offD < 1.5) {
            player.displayClientMessage(Component.literal(
                    "Crossover: the two tracks are too close together (need ≥ 1.5 blocks apart)."), true);
            return;
        }

        // diagonals connect opposite ends so they cross: A (start of track 1)
        // pairs with whichever of C/D lies further along track 1's axis
        double projC = (c.x - a.x) * u1.x + (c.z - a.z) * u1.z;
        double projD = (d.x - a.x) * u1.x + (d.z - a.z) * u1.z;
        BlockPos posFarFromA = projC >= projD ? posC : posD;
        BlockPos posNearA = projC >= projD ? posD : posC;
        Vector3d farFromA = cellCentre(posFarFromA);
        Vector3d nearA = cellCentre(posNearA);

        if (a.distance(b) < MIN_SEGMENT_LENGTH || c.distance(d) < MIN_SEGMENT_LENGTH
                || a.distance(farFromA) < MIN_SEGMENT_LENGTH
                || b.distance(nearA) < MIN_SEGMENT_LENGTH) {
            player.displayClientMessage(Component.literal(
                    "Crossover: markers are too close (min " + (int) MIN_SEGMENT_LENGTH + " blocks)."), true);
            return;
        }

        Vector3d dirA = markerDirection(level, posA);
        Vector3d dirB = markerDirection(level, posB);
        Vector3d dirC = markerDirection(level, posC);
        Vector3d dirD = markerDirection(level, posD);
        Vector3d dirFarFromA = posFarFromA.equals(posC) ? dirC : dirD;
        Vector3d dirNearA = posNearA.equals(posC) ? dirC : dirD;

        level.removeBlock(posA, false);
        level.removeBlock(posB, false);
        level.removeBlock(posC, false);
        level.removeBlock(posD, false);
        // through legs first create the four junction nodes with their track
        // axes; the diagonals then snap to them and S-curve in between
        network.groupSegments(level, List.of(
                network.createSegment(level, a, dirA, b, dirB, look),
                network.createSegment(level, c, dirC, d, dirD, look),
                network.createSegment(level, a, dirA, farFromA, dirFarFromA, look),
                network.createSegment(level, b, dirB, nearA, dirNearA, look)));
        network.registerSwitchStand(posA, a);
        network.registerSwitchStand(posB, b);
        network.registerSwitchStand(posC, c);
        network.registerSwitchStand(posD, d);
        player.displayClientMessage(Component.literal(
                "Scissors crossover built: 2 through legs + 2 crossing diagonals."), true);
    }

    /** Right-click into the air: the rail style and bed picker (SPEC §6.10, §2.2). */
    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        if (level.isClientSide) {
            ClientItemScreens.openRailStylePicker(hand);
        }
        return InteractionResultHolder.sidedSuccess(player.getItemInHand(hand), level.isClientSide);
    }

    /** "Rails (MVP Rail)" once a pack style is chosen; the bare item name for the mod's own rail. */
    @Override
    public Component getName(ItemStack stack) {
        String style = style(stack);
        if (style.isEmpty()) {
            return super.getName(stack);
        }
        return Component.translatable(getDescriptionId(stack) + ".named", styleName(style));
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip,
            TooltipFlag flag) {
        tooltip.add(Component.translatable("tooltip.railswheelsandtrains.rail.bed",
                BedMaterial.of(bed(stack)).displayName()).withStyle(ChatFormatting.GRAY));
        tooltip.add(Component.translatable("tooltip.railswheelsandtrains.rail.usage")
                .withStyle(ChatFormatting.GRAY));
    }

    /** A rail style's display name from the packs' lang files ({@code rail.<ns>.<id>}), the id if none. */
    public static Component styleName(String style) {
        if (style.isEmpty()) {
            return Component.translatable("rail.railswheelsandtrains.standard");
        }
        return Component.translatableWithFallback("rail." + style.replace(':', '.'), style);
    }

    /** A marker's tangent axis read back from its block state. */
    private static Vector3d markerDirection(ServerLevel level, BlockPos pos) {
        return RailMarkerBlock.direction(
                level.getBlockState(pos).getValue(RailMarkerBlock.ROTATION));
    }

    /** A marker cell's horizontal centre at its base — the node point it marks. */
    private static Vector3d cellCentre(BlockPos pos) {
        return new Vector3d(pos.getX() + 0.5, pos.getY(), pos.getZ() + 0.5);
    }
}
