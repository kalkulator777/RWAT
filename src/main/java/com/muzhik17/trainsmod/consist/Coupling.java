package com.muzhik17.trainsmod.consist;

import java.util.ArrayList;
import java.util.List;

import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RoutePath;
import com.muzhik17.trainsmod.stock.ConsistComposition;

/**
 * Coupling and uncoupling math (SPEC §6.12): when do two consists touch,
 * and what single consist do they become — or what two consists does one
 * become when it is split at a coupler. Pure, no MC imports (SPEC principle
 * #4): {@code ConsistManager} is the thin adapter that feeds it materialized
 * routes and applies the resulting plan to the consists and their wagon
 * entities.
 *
 * <p><b>Frames.</b> A consist lives in its own route frame: path distance
 * {@code s} along its route, the head at the front bogie of wagon 0, wagons
 * nose-to-tail towards lower {@code s}. Two consists can only be compared once
 * both are expressed on <i>one</i> route: a {@link Placement} maps a consist's
 * own coordinate onto a candidate route ({@code σ = offset + dir·s}), and
 * exists only if every leg the consist's frames occupy is a leg of that route
 * — world-space proximity alone would couple parallel tracks 1.5 blocks apart,
 * and a route through a switch set against the other consist doesn't contain
 * its legs.
 *
 * <p><b>Contact.</b> On the shared route each consist spans from the front
 * coupler of wagon 0 to the rear coupler of the last wagon (coupler points:
 * the frame ends moved by the type's coupler offsets). The facing ends touch
 * when the gap between them is at most {@link ConsistComposition#COUPLER_GAP}
 * (+ float slack) — the spacing of coupled wagons — and the two are closing
 * faster than {@link #MIN_CLOSING_SPEED}. The speed condition is the
 * hysteresis: two halves just uncoupled sit at exactly the coupler gap with
 * equal speed and stay apart; push them together again and they couple.
 */
public final class Coupling {

    /** Facing coupler points this far past the coupler gap still touch (float noise). */
    public static final double CONTACT_SLACK = 0.05;
    /** Below this closing speed (blocks/tick, ≈0.07 km/h) touching consists don't couple. */
    public static final double MIN_CLOSING_SPEED = 1.0e-3;
    /**
     * Facing ends overlapping deeper than this <i>plus the closing speed</i>
     * aren't a contact: one tick of closing overlaps them by at most the
     * closing speed (contact is checked every tick), so a run-in is caught at
     * any speed; deeper means the two were put on top of each other, and
     * they stay ghosts to each other.
     */
    public static final double MAX_OVERLAP = 4.0;
    /**
     * Coefficient of restitution of a bump (buffers and draft gear spring
     * back): 0 would leave the two rolling together, 1 bounce them apart
     * losslessly.
     */
    public static final double RESTITUTION = 0.3;
    /** Placements of different legs must agree to this (summed arc lengths). */
    private static final double PLACE_EPS = 1.0e-4;

    private Coupling() {
    }

    /**
     * A consist as the coupling math sees it: its route (legs + the path
     * materialized from them), make-up, head {@code s} and speed (blocks/tick,
     * + = towards higher {@code s}), all in its own route frame.
     */
    public record Train(List<RailGraph.RouteLeg> legs, RoutePath path,
            ConsistComposition composition, double headS, double v) {
    }

    /** A consist's own coordinate on another route: {@code σ = offset + dir·s}. */
    public record Placement(double offset, int dir) {

        public double map(double s) {
            return offset + dir * s;
        }
    }

    /**
     * One wagon of a merged consist: which source it came from ({@link #KEPT}
     * or {@link #ABSORBED}), its index there, and whether it now runs turned
     * (its consist ran against the merged route, so its flipped flag toggles).
     */
    public record Member(int source, int index, boolean turned) {

        public static final int KEPT = 0;
        public static final int ABSORBED = 1;
    }

    /**
     * The consist two touching consists become. The kept consist keeps its
     * direction of travel ({@code legs} are oriented so it runs +s), so its
     * driver handles keep their meaning and its own wagons don't move:
     * {@code frameShift} is the constant that carries its old head {@code s}
     * values into the new frame ({@code s_new = s_old + frameShift}) — the
     * client re-expresses its interpolation buffer with it. The absorbed side
     * snaps to exactly the coupler gap. {@code contactS} is the coupler between
     * them on the merged route (for the clank).
     */
    public record Merge(List<RailGraph.RouteLeg> legs, ConsistComposition composition,
            double headS, double v, List<Member> members, double frameShift, double contactS)
            implements Contact {
    }

    /**
     * Two consists that ran together too fast to couple (SPEC §6.12, the
     * profile's coupling speed): they bump — momentum is kept, the buffers
     * give back {@link #RESTITUTION} of the closing speed — and are pushed
     * apart to touching, each by the other's share of the mass. Speeds and
     * shifts are in each consist's own frame; {@code keptContactS} is the
     * point of contact in the kept consist's frame (for the bang),
     * {@code closing} how fast they ran together, blocks/tick.
     */
    public record Bump(double keptV, double absorbedV, double keptShift, double absorbedShift,
            double keptContactS, double closing) implements Contact {
    }

    /** What two consists that touch and close do: {@link Merge} or {@link Bump}. */
    public sealed interface Contact permits Merge, Bump {
    }

    /**
     * A consist cut at a coupler: the front part keeps the head (its wagons
     * don't move), the rear part starts at its first wagon's front bogie.
     */
    public record Split(ConsistComposition front, ConsistComposition rear, double rearHeadS) {
    }

    // --- consist ends: the outermost coupler points ---

    /** Path distance of wagon 0's front coupler point. */
    public static double frontEndS(ConsistComposition composition, double headS) {
        return composition.bodyCenterS(headS, 0) + composition.slot(0).frontCouplerReach();
    }

    /** Path distance of the last wagon's rear coupler point. */
    public static double rearEndS(ConsistComposition composition, double headS) {
        int last = composition.wagonCount() - 1;
        return composition.bodyCenterS(headS, last) - composition.slot(last).rearCouplerReach();
    }

    /**
     * Path distance of the coupler behind wagon {@code index} — the middle of
     * the gap between its rear coupler point and the next wagon's front one.
     */
    public static double couplerS(ConsistComposition composition, double headS, int index) {
        return composition.bodyCenterS(headS, index)
                - composition.slot(index).rearCouplerReach()
                - ConsistComposition.COUPLER_GAP * 0.5;
    }

    // --- placement on a route ---

    /**
     * Express {@code train} on the route {@code legs}/{@code path}: the map
     * from its own coordinate to the route's, or null if any leg under its
     * frames is not on that route (another track, or a switch set against it).
     * Its own route maps by identity.
     */
    public static Placement place(Train train, List<RailGraph.RouteLeg> legs, RoutePath path) {
        if (train.legs().equals(legs)) {
            return new Placement(0.0, 1);
        }
        RoutePath own = train.path();
        double lo = rearEndS(train.composition(), train.headS());
        double hi = frontEndS(train.composition(), train.headS());
        if (!own.loop()) {
            // the frame overhang past an end has no leg of its own: the end leg's map extends to it
            lo = Math.clamp(lo, 0.0, own.length());
            hi = Math.clamp(hi, 0.0, own.length());
        }
        Placement found = null;
        double x = lo;
        for (int guard = 0; guard <= own.partCount() + 1; guard++) {
            int part = own.partIndexAt(x);
            double legStart = x - (wrap(own, x) - own.partStartS(part));
            Placement leg = placeLeg(train.legs().get(part), legStart, legs, path);
            if (leg == null) {
                return null;
            }
            if (found == null) {
                found = leg;
            } else if (!samePlacement(found, leg, path)) {
                return null; // the span leaves the route and rejoins it elsewhere
            }
            double legEnd = legStart + own.partLength(part);
            if (legEnd >= hi - PLACE_EPS) {
                return found;
            }
            x = legEnd + PLACE_EPS; // nudge into the next leg (loop wrap rounding)
        }
        return found;
    }

    /** The placement implied by one leg of the train starting at own {@code legStart}, or null. */
    private static Placement placeLeg(RailGraph.RouteLeg leg, double legStart,
            List<RailGraph.RouteLeg> legs, RoutePath path) {
        for (int j = 0; j < legs.size(); j++) {
            RailGraph.RouteLeg other = legs.get(j);
            if (other.segmentId() != leg.segmentId()) {
                continue;
            }
            double start = path.partStartS(j);
            if (other.reversed() == leg.reversed()) {
                return new Placement(start - legStart, 1);
            }
            // walked the other way: own distance u into the leg sits at start + len − u
            return new Placement(start + path.partLength(j) + legStart, -1);
        }
        return null;
    }

    private static boolean samePlacement(Placement a, Placement b, RoutePath path) {
        if (a.dir() != b.dir()) {
            return false;
        }
        double diff = a.offset() - b.offset();
        if (path.loop()) {
            // on a loop offsets agree modulo one lap
            diff -= Math.rint(diff / path.length()) * path.length();
        }
        return Math.abs(diff) < PLACE_EPS;
    }

    /** {@code s} as the path samples it: wrapped on a loop, clamped otherwise. */
    private static double wrap(RoutePath path, double s) {
        if (path.loop()) {
            double wrapped = s % path.length();
            return wrapped < 0.0 ? wrapped + path.length() : wrapped;
        }
        return Math.clamp(s, 0.0, path.length());
    }

    // --- coupling ---

    /**
     * Couple {@code kept} and {@code absorbed} if they touch: both lie on one
     * route (the kept consist's, else the absorbed one's), their facing frame
     * ends are within the coupler gap and they are closing. Null if not.
     *
     * <p>The merged speed is a perfectly inelastic collision: momentum
     * {@code Σ m·v} (signs in the merged frame, masses from
     * {@link ConsistComposition#totalMassT()}) is conserved.
     */
    public static Merge tryCouple(Train kept, Train absorbed) {
        return (Merge) contact(kept, absorbed, Double.POSITIVE_INFINITY);
    }

    /**
     * What happens when {@code kept} and {@code absorbed} touch (see
     * {@link #tryCouple}): they couple if they close no faster than
     * {@code maxCouplingClosing} (blocks/tick), else they {@link Bump}. Null
     * if they don't touch and close.
     */
    public static Contact contact(Train kept, Train absorbed, double maxCouplingClosing) {
        Contact contact = contactOn(kept.legs(), kept.path(), kept, absorbed, maxCouplingClosing);
        if (contact == null && !absorbed.legs().equals(kept.legs())) {
            contact = contactOn(absorbed.legs(), absorbed.path(), kept, absorbed, maxCouplingClosing);
        }
        return contact;
    }

    private static Contact contactOn(List<RailGraph.RouteLeg> legs, RoutePath path,
            Train kept, Train absorbed, double maxCouplingClosing) {
        Placement pk = place(kept, legs, path);
        Placement pa = pk == null ? null : place(absorbed, legs, path);
        if (pa == null) {
            return null;
        }
        double length = path.length();

        // orient the merged route so the kept consist keeps running +s:
        // the inverted route puts σ at length − σ
        boolean invert = pk.dir() < 0;
        List<RailGraph.RouteLeg> mergedLegs = invert ? inverted(legs) : legs;
        if (invert) {
            pk = new Placement(length - pk.offset(), -pk.dir());
            pa = new Placement(length - pa.offset(), -pa.dir());
        }

        double[] k = span(kept, pk);
        double[] a = span(absorbed, pa);
        double halfK = (k[1] - k[0]) * 0.5;
        double halfA = (a[1] - a[0]) * 0.5;
        double dc = (a[0] + a[1]) * 0.5 - (k[0] + k[1]) * 0.5;
        if (path.loop()) {
            dc -= Math.rint(dc / length) * length; // the nearer way round
            if (2.0 * (halfK + halfA) + ConsistComposition.COUPLER_GAP >= length) {
                return null; // together they wouldn't fit on the loop
            }
        }
        double gap = Math.abs(dc) - halfK - halfA;
        boolean absorbedAhead = dc > 0.0;
        double vk = kept.v(); // pk.dir() == +1 now
        double va = pa.dir() * absorbed.v();
        double closing = absorbedAhead ? vk - va : va - vk;
        if (gap > ConsistComposition.COUPLER_GAP + CONTACT_SLACK
                || gap < -(MAX_OVERLAP + Math.max(closing, 0.0))
                || closing <= MIN_CLOSING_SPEED) {
            return null;
        }
        double massK = kept.composition().totalMassT();
        double massA = absorbed.composition().totalMassT();
        double contactSigma = absorbedAhead
                ? k[1] + ConsistComposition.COUPLER_GAP * 0.5
                : k[0] - ConsistComposition.COUPLER_GAP * 0.5;
        if (closing > maxCouplingClosing) {
            return bump(vk, va, massK, massA, absorbedAhead, Math.max(0.0, -gap), pa.dir(),
                    contactSigma - pk.offset(), closing);
        }

        // merged order: front (higher σ) first; a consist running −s joins turned
        List<Member> members = new ArrayList<>();
        List<ConsistComposition.Slot> slots = new ArrayList<>();
        if (absorbedAhead) {
            addMembers(members, slots, Member.ABSORBED, absorbed.composition(), pa.dir());
        }
        int keptFirst = members.size();
        addMembers(members, slots, Member.KEPT, kept.composition(), 1);
        if (!absorbedAhead) {
            addMembers(members, slots, Member.ABSORBED, absorbed.composition(), pa.dir());
        }
        ConsistComposition composition = new ConsistComposition(List.copyOf(slots));

        // the kept wagons stay put: anchor the head on kept wagon 0's body centre
        double keptCentre = pk.map(kept.composition().bodyCenterS(kept.headS(), 0));
        double headS = keptCentre - composition.bodyCenterS(0.0, keptFirst);

        double v = massK + massA > 0.0
                ? (massK * vk + massA * va) / (massK + massA)
                : (vk + va) * 0.5;

        return new Merge(mergedLegs, composition, headS, v, List.copyOf(members),
                headS - kept.headS(), contactSigma);
    }

    /**
     * The bump of two consists on a shared route where the kept one runs
     * +σ: speeds {@code vk}/{@code va} along σ, {@code overlap} to undo.
     */
    private static Bump bump(double vk, double va, double massK, double massA,
            boolean absorbedAhead, double overlap, int absorbedDir, double keptContactS,
            double closing) {
        double total = massK + massA;
        double shareK = total > 0.0 ? massA / total : 0.5; // the lighter one moves more
        double shareA = 1.0 - shareK;
        double momentum = total > 0.0 ? massK * vk + massA * va : (vk + va) * 0.5;
        double mean = total > 0.0 ? momentum / total : momentum;
        // each leaves with the common speed plus the restitution of its own approach
        double uk = mean - RESTITUTION * shareK * (vk - va);
        double ua = mean + RESTITUTION * shareA * (vk - va);
        double away = absorbedAhead ? 1.0 : -1.0; // the absorbed side's direction from the kept one
        return new Bump(uk, absorbedDir * ua,
                -away * overlap * shareK, absorbedDir * away * overlap * shareA, keptContactS,
                closing);
    }

    /** {@code [lo, hi]} of a train's coupler span on a route, unwrapped. */
    private static double[] span(Train train, Placement placement) {
        double front = placement.map(frontEndS(train.composition(), train.headS()));
        double rear = placement.map(rearEndS(train.composition(), train.headS()));
        return new double[] {Math.min(front, rear), Math.max(front, rear)};
    }

    /** Append a consist's wagons in merged-route order: as is, or reversed and turned. */
    private static void addMembers(List<Member> members, List<ConsistComposition.Slot> slots,
            int source, ConsistComposition composition, int dir) {
        int n = composition.wagonCount();
        for (int k = 0; k < n; k++) {
            int index = dir > 0 ? k : n - 1 - k;
            ConsistComposition.Slot slot = composition.slot(index);
            boolean turned = dir < 0;
            members.add(new Member(source, index, turned));
            slots.add(turned
                    ? new ConsistComposition.Slot(slot.type(), !slot.flipped(), slot.livery())
                    : slot);
        }
    }

    /**
     * The same track walked the other way (legs reversed, each traversed
     * backwards) — the leg-list twin of {@code TrackPathSpec.Route.inverted()}.
     */
    public static List<RailGraph.RouteLeg> inverted(List<RailGraph.RouteLeg> legs) {
        List<RailGraph.RouteLeg> out = new ArrayList<>(legs.size());
        for (int i = legs.size() - 1; i >= 0; i--) {
            RailGraph.RouteLeg leg = legs.get(i);
            out.add(new RailGraph.RouteLeg(leg.segmentId(), !leg.reversed()));
        }
        return out;
    }

    // --- uncoupling ---

    /**
     * Cut a consist at the coupler in front of wagon {@code cut}
     * ({@code 1 ≤ cut < wagonCount}): wagons {@code [0, cut)} stay with the
     * head, {@code [cut, n)} become a consist of their own on the same route,
     * its head on the front bogie of (old) wagon {@code cut} — nobody moves.
     */
    public static Split split(ConsistComposition composition, double headS, int cut) {
        int n = composition.wagonCount();
        if (cut < 1 || cut >= n) {
            throw new IllegalArgumentException("cut " + cut + " outside 1.." + (n - 1));
        }
        return new Split(
                new ConsistComposition(List.copyOf(composition.slots().subList(0, cut))),
                new ConsistComposition(List.copyOf(composition.slots().subList(cut, n))),
                composition.frontBogieS(headS, cut));
    }
}
