package com.muzhik17.trainsmod.client.gui;

/**
 * The driver's panel screen's arithmetic across the window (SPEC §9.7),
 * free of the game for the tests: how the instruments and the right half
 * share the width, and how the light buttons fill the right half. A window
 * too narrow for the train page's rows beside the instruments (4:3 and 5:4
 * at the automatic GUI scale: 320–341 wide) closes up its margins and gives
 * the right half all that is left; the train page then stacks each row's
 * label over its buttons ({@link DriverPanelScreen}).
 */
final class PanelLayout {

    static final int MARGIN = 10;
    /** Between the instruments and the right half. */
    static final int COLUMN_GAP = 12;
    /** The same on a narrow window. */
    static final int NARROW_MARGIN = 6;
    static final int NARROW_COLUMN_GAP = 8;

    private PanelLayout() {
    }

    /**
     * The window across: narrow or not, its margin, the gap after the
     * instruments and the room left for the right half.
     */
    record Halves(boolean narrow, int margin, int gap, int room) {

        /** The instruments' left edge, the pair centred with a right half {@code rightWidth} wide (at most the room). */
        int panelX(int screenWidth, int panelWidth, int rightWidth) {
            return Math.max(margin, (screenWidth - panelWidth - gap - rightWidth) / 2);
        }
    }

    /**
     * Share {@code screenWidth} between the instruments ({@code panelWidth})
     * and the right half, whose train page wants {@code trainNeed} for its
     * rows side by side: narrow if that doesn't fit with the usual margins.
     */
    static Halves halves(int screenWidth, int panelWidth, int trainNeed) {
        int room = screenWidth - 2 * MARGIN - panelWidth - COLUMN_GAP;
        if (room >= trainNeed) {
            return new Halves(false, MARGIN, COLUMN_GAP, room);
        }
        return new Halves(true, NARROW_MARGIN, NARROW_COLUMN_GAP,
                screenWidth - 2 * NARROW_MARGIN - panelWidth - NARROW_COLUMN_GAP);
    }

    /**
     * The light buttons: {@code rows} in all, {@code visibleRows} of them
     * shown, the rest scrolled to. Column by column while they all show;
     * row by row while they scroll, so the wheel brings in the next groups
     * in order.
     */
    record Grid(int columns, int rows, int visibleRows, int buttonWidth, int gap) {

        boolean scrolls() {
            return rows > visibleRows;
        }

        /** How far the grid scrolls, rows. */
        int maxScroll() {
            return rows - visibleRows;
        }

        int width() {
            return columns * buttonWidth + (columns - 1) * gap;
        }

        int column(int index) {
            return scrolls() ? index % columns : index / rows;
        }

        int row(int index) {
            return scrolls() ? index / columns : index % rows;
        }
    }

    /**
     * Lay out {@code count} buttons in {@code room}: as many columns as
     * {@code rowsFit} rows each need, but no more than fit at the narrowest
     * buttons; the rows balanced between the columns, the buttons widened to
     * share the room up to {@code maxWidth} — never wider than the room.
     */
    static Grid grid(int count, int room, int rowsFit, int minWidth, int maxWidth, int gap) {
        int rowsShown = Math.max(1, rowsFit);
        int fit = Math.max(1, (room + gap) / (minWidth + gap));
        int columns = Math.clamp((count + rowsShown - 1) / rowsShown, 1, fit);
        int rows = (count + columns - 1) / columns;
        int width = Math.min(room, Math.clamp((room - (columns - 1) * gap) / columns, minWidth, maxWidth));
        return new Grid(columns, rows, Math.min(rows, rowsShown), width, gap);
    }
}
