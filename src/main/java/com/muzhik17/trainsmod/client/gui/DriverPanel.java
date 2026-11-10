package com.muzhik17.trainsmod.client.gui;

import java.util.ArrayList;
import java.util.List;

import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.convention.DriverReadout;
import com.muzhik17.trainsmod.stock.ConsistComposition;

import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;

/**
 * The driver's instruments (SPEC §9.7), drawn alike on the HUD and in the
 * driver's panel screen: the speed with an arrow for the way the train rolls
 * (as seen from this cab), a speedometer bar up to the train's top speed, the
 * reverser, and the throttle and brakes as rows of notch lamps. In the screen
 * they are the controls too: {@link #targetAt} says which handle position a
 * point stands for.
 */
public final class DriverPanel {

    /** Narrow enough to sit beside the hotbar at 1080p with the automatic GUI scale (4). */
    public static final int WIDTH = 140;

    private static final int PAD = 5;
    /** The speed digits (drawn twice the font size) and the reverser above the bar. */
    private static final int SPEED_ROW = 22;
    private static final int BAR_H = 4;
    private static final int TICK_H = 2;
    private static final int ROW = 12;
    private static final int LAMP_H = 7;
    private static final int LAMP_GAP = 1;
    /** The brake pressure bar under a brake row's lamps, px (fits the gap to the next row). */
    private static final int PRESSURE_H = 2;
    private static final int CELL_W = 12;
    private static final int CELL_H = 11;
    private static final int CELL_GAP = 1;

    private static final int BACKGROUND = 0xB0101010;
    private static final int FRAME = 0x50FFFFFF;
    private static final int TEXT = 0xFFFFFFFF;
    private static final int DIM = 0xFF9A9A9A;
    private static final int OFF = 0xFF383838;
    private static final int HOVER = 0xFFFFFFFF;
    private static final int BAR = 0xFFDCDCDC;
    private static final int BAR_NEAR = 0xFFF0C030;
    private static final int OVERSPEED = 0xFFF04040;
    private static final int TICK = 0xFF7A7A7A;
    private static final int THROTTLE = 0xFF4FC34F;
    private static final int TRAIN_BRAKE = 0xFFE8A33C;
    private static final int INDEPENDENT_BRAKE = 0xFFDB6A3A;
    private static final int FORWARD = 0xFF4FC34F;
    private static final int BACKWARD = 0xFFE8A33C;
    private static final int NEUTRAL = 0xFF8A8A8A;

    private static final Consist.Handle[] ROWS = {
        Consist.Handle.THROTTLE, Consist.Handle.TRAIN_BRAKE, Consist.Handle.INDEPENDENT_BRAKE};

    /** Set {@code handle} to {@code value} — what a click at a point of the panel means. */
    public record Target(Consist.Handle handle, int value) {
    }

    private DriverPanel() {
    }

    /**
     * The readout for the player riding {@code wagon} — its cab's view of the
     * train — or null while the consist isn't known yet.
     */
    public static DriverReadout readout(WagonEntity wagon) {
        ConsistComposition composition = ClientConsists.composition(wagon.getConsistId());
        if (composition == null) {
            return null;
        }
        int consistId = wagon.getConsistId();
        return DriverReadout.of(ClientConsists.handles(consistId), ClientConsists.speed(consistId),
                composition, wagon.getWagonIndex(), ClientConsists.handbrakesSet(consistId),
                ClientConsists.trainBrakePressure(consistId), ClientConsists.indBrakePressure(consistId));
    }

    /** The panel's height for this readout. */
    public static int height(Font font, DriverReadout readout) {
        int rows = rows(readout).size();
        int footer = (readout.inControl() ? 0 : ROW + (otherCab(font).size() - 1) * (font.lineHeight + 1))
                + (readout.handbrakesSet() > 0 ? ROW : 0);
        return PAD + SPEED_ROW + BAR_H + TICK_H + 4 + (rows - 1) * ROW + LAMP_H + footer + PAD;
    }

    /** "Another cab is in control", wrapped to the panel (in Russian it is wider than the panel). */
    private static List<FormattedCharSequence> otherCab(Font font) {
        return font.split(Component.translatable("hud.railswheelsandtrains.other_cab"), WIDTH - 2 * PAD);
    }

    /**
     * Draw the instruments with the top left corner at {@code (x, y)}. With
     * {@code interactive}, the handle position under the mouse is outlined
     * if the driver can set it.
     */
    public static void draw(GuiGraphics graphics, Font font, int x, int y, DriverReadout readout,
            boolean interactive, int mouseX, int mouseY) {
        int height = height(font, readout);
        graphics.fill(x, y, x + WIDTH, y + height, BACKGROUND);
        graphics.renderOutline(x, y, WIDTH, height, FRAME);
        Target hovered = interactive ? targetAt(font, x, y, readout, mouseX, mouseY) : null;
        if (hovered != null && !readout.canMove(hovered.handle())) {
            hovered = null;
        }
        drawSpeed(graphics, font, x, y, readout);
        drawReverser(graphics, font, x, y, readout, hovered);
        drawSpeedometer(graphics, x, y, readout);
        List<Consist.Handle> rows = rows(readout);
        Columns columns = columns(font);
        for (int i = 0; i < rows.size(); i++) {
            drawHandle(graphics, font, x, rowTop(y, i), columns, rows.get(i), readout, hovered);
        }
        int footerY = rowTop(y, rows.size()) + 1;
        if (!readout.inControl()) {
            for (FormattedCharSequence line : otherCab(font)) {
                graphics.drawString(font, line, x + PAD, footerY, DIM, false);
                footerY += font.lineHeight + 1;
            }
            footerY += ROW - (font.lineHeight + 1);
        }
        if (readout.handbrakesSet() > 0) {
            // a train that won't move: the handbrakes are on (SPEC §5.3)
            graphics.drawString(font, Component.translatable("hud.railswheelsandtrains.handbrakes",
                    readout.handbrakesSet(), readout.wagons()),
                    x + PAD, footerY, BAR_NEAR, false);
        }
    }

    /** The handle position at a point of the panel drawn at {@code (x, y)}, or null. */
    public static Target targetAt(Font font, int x, int y, DriverReadout readout,
            double mouseX, double mouseY) {
        for (int i = 0; i < 3; i++) {
            int cx = reverserLeft(x) + i * (CELL_W + CELL_GAP);
            int cy = y + PAD + 9;
            if (mouseX >= cx && mouseX < cx + CELL_W && mouseY >= cy && mouseY < cy + CELL_H) {
                return new Target(Consist.Handle.REVERSER, i - 1);
            }
        }
        List<Consist.Handle> rows = rows(readout);
        Columns columns = columns(font);
        for (int i = 0; i < rows.size(); i++) {
            int top = rowTop(y, i);
            if (mouseY < top - 2 || mouseY >= top + LAMP_H + 2) {
                continue;
            }
            if (mouseX >= x + PAD && mouseX < columns.lampsLeft(x)) {
                return new Target(rows.get(i), 0); // the label: shut it
            }
            for (int notch = 1; notch <= Consist.NOTCHES; notch++) {
                int left = columns.lampLeft(x, notch);
                if (mouseX >= left && mouseX < left + columns.lampW() + LAMP_GAP) {
                    return new Target(rows.get(i), notch);
                }
            }
        }
        return null;
    }

    /** What a handle position is, for the screen's tooltip. */
    public static List<Component> describe(Target target, DriverReadout readout) {
        List<Component> lines = new ArrayList<>();
        Component name = Component.translatable(switch (target.handle()) {
            case REVERSER -> "control.railswheelsandtrains.reverser";
            case THROTTLE -> "control.railswheelsandtrains.throttle";
            case TRAIN_BRAKE -> "control.railswheelsandtrains.train_brake";
            case INDEPENDENT_BRAKE -> "control.railswheelsandtrains.independent_brake";
        });
        Component value = target.handle() == Consist.Handle.REVERSER
                ? Component.translatable(target.value() > 0 ? "control.railswheelsandtrains.forward"
                        : target.value() < 0 ? "control.railswheelsandtrains.backward"
                                : "control.railswheelsandtrains.neutral")
                : Component.literal(target.value() + " / " + Consist.NOTCHES);
        lines.add(Component.empty().append(name).append(": ").append(value));
        if (!readout.inControl()) {
            lines.add(Component.translatable("hud.railswheelsandtrains.other_cab")
                    .withStyle(ChatFormatting.GRAY));
        } else if (target.handle() == Consist.Handle.REVERSER && !readout.reverserFree()) {
            lines.add(Component.translatable("hud.railswheelsandtrains.reverser_locked")
                    .withStyle(ChatFormatting.GRAY));
        }
        return lines;
    }

    private static void drawSpeed(GuiGraphics graphics, Font font, int x, int y, DriverReadout readout) {
        String digits = Integer.toString((int) Math.round(readout.speedKmh()));
        int color = readout.atLimit() ? OVERSPEED : TEXT;
        graphics.pose().pushPose();
        graphics.pose().translate(x + PAD, y + PAD + 3, 0.0F);
        graphics.pose().scale(2.0F, 2.0F, 1.0F);
        graphics.drawString(font, digits, 0, 0, color, true);
        graphics.pose().popPose();
        int unitX = x + PAD + font.width(digits) * 2 + 3;
        Component unit = Component.translatable("hud.railswheelsandtrains.kmh");
        graphics.drawString(font, unit, unitX, y + PAD + 10, DIM, false);
        int arrowX = unitX + font.width(unit) + 6;
        if (readout.motion() != 0) {
            arrow(graphics, arrowX, y + PAD + 11, readout.motion() > 0,
                    readout.motion() > 0 ? FORWARD : BACKWARD);
        }
    }

    /** A 7×4 pixel arrow: up (rolling forward) or down (backward). */
    private static void arrow(GuiGraphics graphics, int x, int y, boolean up, int color) {
        for (int i = 0; i < 4; i++) {
            int row = up ? y + i : y + 3 - i;
            graphics.fill(x + 3 - i, row, x + 4 + i, row + 1, color);
        }
    }

    private static void drawReverser(GuiGraphics graphics, Font font, int x, int y,
            DriverReadout readout, Target hovered) {
        int left = reverserLeft(x);
        int width = 3 * CELL_W + 2 * CELL_GAP;
        Component label = Component.translatable("hud.railswheelsandtrains.reverser");
        graphics.drawString(font, label, left + (width - font.width(label)) / 2, y + PAD, DIM, false);
        String[] keys = {"backward", "neutral", "forward"};
        int[] colors = {BACKWARD, NEUTRAL, FORWARD};
        int cy = y + PAD + 9;
        for (int i = 0; i < 3; i++) {
            int cx = left + i * (CELL_W + CELL_GAP);
            boolean set = readout.handles().reverser() == i - 1;
            graphics.fill(cx, cy, cx + CELL_W, cy + CELL_H, set ? colors[i] : OFF);
            Component mark = Component.translatable("hud.railswheelsandtrains.reverser." + keys[i]);
            graphics.drawString(font, mark, cx + (CELL_W - font.width(mark) + 1) / 2, cy + 2,
                    set ? TEXT : DIM, false);
            if (hovered != null && hovered.handle() == Consist.Handle.REVERSER
                    && hovered.value() == i - 1) {
                graphics.renderOutline(cx - 1, cy - 1, CELL_W + 2, CELL_H + 2, HOVER);
            }
        }
    }

    private static void drawSpeedometer(GuiGraphics graphics, int x, int y, DriverReadout readout) {
        int left = x + PAD;
        int right = x + WIDTH - PAD;
        int top = y + PAD + SPEED_ROW;
        int span = right - left;
        graphics.fill(left, top, right, top + BAR_H, OFF);
        int fill = Math.round(readout.speedFraction() * span);
        int color = readout.atLimit() ? OVERSPEED
                : readout.limitKmh() > 0.0 && readout.speedKmh() >= readout.limitKmh() * 0.9 ? BAR_NEAR
                        : BAR;
        graphics.fill(left, top, left + fill, top + BAR_H, color);
        int step = readout.tickStepKmh();
        for (int kmh = 0; kmh <= readout.scaleKmh(); kmh += step) {
            int tx = left + Math.round(kmh / (float) readout.scaleKmh() * (span - 1));
            graphics.fill(tx, top + BAR_H, tx + 1, top + BAR_H + TICK_H, TICK);
        }
        if (readout.limitKmh() > 0.0) {
            int lx = left + Math.round(readout.limitFraction() * (span - 1));
            graphics.fill(lx, top - 1, lx + 1, top + BAR_H + TICK_H, OVERSPEED);
        }
    }

    private static void drawHandle(GuiGraphics graphics, Font font, int x, int top, Columns columns,
            Consist.Handle handle, DriverReadout readout, Target hovered) {
        graphics.drawString(font, label(handle), x + PAD, top, DIM, false);
        int notch = readout.handle(handle);
        int lit = switch (handle) {
            case THROTTLE -> THROTTLE;
            case TRAIN_BRAKE -> TRAIN_BRAKE;
            default -> INDEPENDENT_BRAKE;
        };
        for (int n = 1; n <= Consist.NOTCHES; n++) {
            int left = columns.lampLeft(x, n);
            graphics.fill(left, top, left + columns.lampW(), top + LAMP_H, n <= notch ? lit : OFF);
        }
        if (handle == Consist.Handle.TRAIN_BRAKE || handle == Consist.Handle.INDEPENDENT_BRAKE) {
            // the cylinders' pressure under the lamps: the brake catching up with the handle (SPEC §5.3)
            int from = columns.lampLeft(x, 1);
            int to = columns.lampLeft(x, Consist.NOTCHES) + columns.lampW();
            int fill = Math.round(readout.pressure(handle) * (to - from));
            graphics.fill(from, top + LAMP_H + 1, to, top + LAMP_H + 1 + PRESSURE_H, OFF);
            graphics.fill(from, top + LAMP_H + 1, from + fill, top + LAMP_H + 1 + PRESSURE_H, lit);
        }
        String value = Integer.toString(notch);
        graphics.drawString(font, value, x + WIDTH - PAD - font.width(value), top,
                notch > 0 ? TEXT : DIM, false);
        if (hovered != null && hovered.handle() == handle) {
            if (hovered.value() == 0) {
                Component label = label(handle);
                graphics.renderOutline(x + PAD - 2, top - 2, font.width(label) + 4, LAMP_H + 4, HOVER);
            } else {
                int left = columns.lampLeft(x, hovered.value());
                graphics.renderOutline(left - 1, top - 1, columns.lampW() + 2, LAMP_H + 2, HOVER);
            }
        }
    }

    private static Component label(Consist.Handle handle) {
        return Component.translatable(switch (handle) {
            case THROTTLE -> "hud.railswheelsandtrains.throttle";
            case TRAIN_BRAKE -> "hud.railswheelsandtrains.train_brake";
            case INDEPENDENT_BRAKE -> "hud.railswheelsandtrains.independent_brake";
            case REVERSER -> "hud.railswheelsandtrains.reverser";
        });
    }

    /** The handle rows shown: the independent brake only on a train that has one. */
    private static List<Consist.Handle> rows(DriverReadout readout) {
        List<Consist.Handle> rows = new ArrayList<>(ROWS.length);
        for (Consist.Handle handle : ROWS) {
            if (handle != Consist.Handle.INDEPENDENT_BRAKE || readout.independentBrake()) {
                rows.add(handle);
            }
        }
        return rows;
    }

    private static int rowTop(int y, int row) {
        return y + PAD + SPEED_ROW + BAR_H + TICK_H + 4 + row * ROW;
    }

    private static int reverserLeft(int x) {
        return x + WIDTH - PAD - (3 * CELL_W + 2 * CELL_GAP);
    }

    /**
     * Where a handle row's lamps go: after the widest label, before the
     * notch figure, eight lamps sharing the width between.
     */
    private record Columns(int labelW, int lampW) {

        int lampsLeft(int x) {
            return x + PAD + labelW;
        }

        int lampLeft(int x, int notch) {
            return lampsLeft(x) + (notch - 1) * (lampW + LAMP_GAP);
        }
    }

    private static Columns columns(Font font) {
        int labelW = 0;
        for (Consist.Handle handle : ROWS) {
            labelW = Math.max(labelW, font.width(label(handle)));
        }
        labelW += 5;
        int valueW = font.width("8") + 4;
        int span = WIDTH - 2 * PAD - labelW - valueW;
        int lampW = Math.max(3, (span - (Consist.NOTCHES - 1) * LAMP_GAP) / Consist.NOTCHES);
        return new Columns(labelW, lampW);
    }
}
