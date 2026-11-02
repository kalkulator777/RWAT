package com.muzhik17.trainsmod.client.gui;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashSet;
import java.util.Set;

import org.junit.jupiter.api.Test;

/**
 * The driver's panel screen across the window (SPEC §9.7, audit M32): the
 * right half stays on screen at every window the game allows, down to
 * 320×240 (4:3 and 5:4 at the automatic GUI scale), and the light buttons
 * never run off its right edge.
 */
class PanelLayoutTest {

    /** {@code DriverPanel.WIDTH}. */
    private static final int PANEL = 140;
    /** The screen's light buttons: narrowest, widest, gap. */
    private static final int MIN_BUTTON = 90;
    private static final int MAX_BUTTON = 170;
    private static final int GAP = 4;
    /**
     * The train page's rows side by side in the default font: Russian — the
     * label "Свет в вагонах" 79 + 8, two buttons holding "Выключить" 56 + 8,
     * a gap; English — "Doors on the right" 94 + 8, "Close" 27 + 8.
     */
    private static final int RUSSIAN_NEED = 87 + 2 * 64 + GAP;
    private static final int ENGLISH_NEED = 102 + 2 * 35 + GAP;
    private static final int RUSSIAN_BUTTONS = 2 * 64 + GAP;

    /** GUI-scaled windows: 1280×960 / 1600×1200 and 1280×1024 at auto, 1024×768 at auto, 854×480 at 2, 1920×1080 at 4, 3, 2. */
    private static final int[][] WINDOWS = {
        {320, 240}, {320, 256}, {341, 256}, {427, 240}, {480, 270}, {640, 360}, {960, 540}};

    /** The screen's rows of light buttons that fit between the tabs and the footer. */
    private static int rowsFit(int height) {
        return (height - 30 - GAP - 38 + GAP) / (20 + GAP);
    }

    @Test
    void theRightHalf_staysOnScreen() {
        for (int need : new int[]{RUSSIAN_NEED, ENGLISH_NEED}) {
            for (int[] window : WINDOWS) {
                int width = window[0];
                PanelLayout.Halves halves = PanelLayout.halves(width, PANEL, need);
                int rightX = halves.panelX(width, PANEL, halves.room()) + PANEL + halves.gap();
                assertTrue(rightX + halves.room() <= width - halves.margin(), "width " + width);
                // the scroll bar beside the right half (3 px off, 2 wide) too
                assertTrue(rightX + halves.room() + 5 <= width, "width " + width);
            }
        }
    }

    @Test
    void narrow_onlyWhereTheRowsDontFitBeside() {
        assertTrue(PanelLayout.halves(320, PANEL, RUSSIAN_NEED).narrow());
        assertTrue(PanelLayout.halves(341, PANEL, RUSSIAN_NEED).narrow());
        assertTrue(PanelLayout.halves(341, PANEL, ENGLISH_NEED).narrow());
        assertFalse(PanelLayout.halves(427, PANEL, RUSSIAN_NEED).narrow());
        assertFalse(PanelLayout.halves(480, PANEL, RUSSIAN_NEED).narrow());
        // the narrowest window still holds a row's two buttons with their Russian captions
        PanelLayout.Halves narrowest = PanelLayout.halves(320, PANEL, RUSSIAN_NEED);
        assertEquals(160, narrowest.room());
        assertTrue(narrowest.room() >= RUSSIAN_BUTTONS);
    }

    @Test
    void theLightButtons_neverRunOffTheRoom() {
        for (int room = 80; room <= 800; room += 7) {
            for (int rowsFit = 0; rowsFit <= 20; rowsFit++) {
                for (int count = 0; count <= 60; count++) {
                    PanelLayout.Grid grid = PanelLayout.grid(count, room, rowsFit, MIN_BUTTON, MAX_BUTTON, GAP);
                    String at = "room " + room + ", rows " + rowsFit + ", groups " + count;
                    assertTrue(grid.width() <= room, at);
                    assertTrue(grid.visibleRows() <= Math.max(1, rowsFit), at);
                    Set<Integer> cells = new HashSet<>();
                    for (int i = 0; i < count; i++) {
                        assertTrue(grid.column(i) < grid.columns() && grid.row(i) < grid.rows(), at);
                        assertTrue(cells.add(grid.row(i) * grid.columns() + grid.column(i)), at);
                    }
                    assertEquals(count > grid.columns() * Math.max(1, rowsFit), grid.scrolls(), at);
                }
            }
        }
    }

    @Test
    void fitting_goesColumnByColumn() {
        // 854×480 at GUI 2: ten groups in two balanced columns of five
        PanelLayout.Halves halves = PanelLayout.halves(427, PANEL, RUSSIAN_NEED);
        PanelLayout.Grid grid = PanelLayout.grid(10, halves.room(), rowsFit(240), MIN_BUTTON, MAX_BUTTON, GAP);
        assertEquals(2, grid.columns());
        assertEquals(5, grid.rows());
        assertFalse(grid.scrolls());
        assertEquals(1, grid.column(5));
        assertEquals(0, grid.row(5));
    }

    @Test
    void narrow_scrollsOneColumnRowByRow() {
        // 1280×1024 at auto (320×256): twelve groups, one column, seven rows shown
        PanelLayout.Halves halves = PanelLayout.halves(320, PANEL, RUSSIAN_NEED);
        PanelLayout.Grid grid = PanelLayout.grid(12, halves.room(), rowsFit(256), MIN_BUTTON, MAX_BUTTON, GAP);
        assertEquals(1, grid.columns());
        assertEquals(160, grid.width());
        assertEquals(7, grid.visibleRows());
        assertEquals(5, grid.maxScroll());
        assertEquals(11, grid.row(11));
    }

    @Test
    void manyGroups_scrollInsteadOfNarrowerButtons() {
        // 1920×1080 at GUI 4 (480×270): thirty groups used to need four 90 px columns in 308 px
        PanelLayout.Halves halves = PanelLayout.halves(480, PANEL, RUSSIAN_NEED);
        PanelLayout.Grid grid = PanelLayout.grid(30, halves.room(), rowsFit(270), MIN_BUTTON, MAX_BUTTON, GAP);
        assertEquals(308, halves.room());
        assertEquals(3, grid.columns());
        assertEquals(100, grid.buttonWidth());
        assertEquals(8, grid.visibleRows());
        assertEquals(2, grid.maxScroll());
        // row by row while scrolling: the fourth group opens the second row
        assertEquals(0, grid.column(3));
        assertEquals(1, grid.row(3));
    }
}
