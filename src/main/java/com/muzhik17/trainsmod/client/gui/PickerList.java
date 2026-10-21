package com.muzhik17.trainsmod.client.gui;

import java.util.function.Consumer;

import net.minecraft.Util;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.ObjectSelectionList;
import net.minecraft.network.chat.Component;

/**
 * A scrolling list of choices for the item pickers (SPEC §6.10/§6.11): each
 * row is a title plus an optional grey second line. A click or the arrow keys
 * select, and a new selection tells {@code onSelect}; a double click also
 * confirms ({@code onConfirm}).
 *
 * @param <T> the value a row stands for
 */
final class PickerList<T> extends ObjectSelectionList<PickerList.Row<T>> {

    /** Row height with a second line; single-line rows use the same height for a calm layout. */
    static final int ROW_HEIGHT = 24;
    private static final long DOUBLE_CLICK_MS = 250;

    private final Consumer<T> onSelect;
    private final Consumer<T> onConfirm;

    PickerList(Minecraft minecraft, int x, int y, int width, int height,
            Consumer<T> onSelect, Consumer<T> onConfirm) {
        super(minecraft, width, height, y, ROW_HEIGHT);
        setX(x);
        this.onSelect = onSelect;
        this.onConfirm = onConfirm;
    }

    /** Append a row; {@code detail} may be null. */
    Row<T> add(T value, Component title, Component detail) {
        Row<T> row = new Row<>(this, value, title, detail);
        addEntry(row);
        return row;
    }

    void clear() {
        clearEntries();
        setScrollAmount(0.0);
    }

    /** Select the row of {@code value} (if listed; telling {@code onSelect}) and scroll it into view. */
    void select(T value) {
        for (Row<T> row : children()) {
            if (row.value.equals(value)) {
                setSelected(row);
                centerScrollOn(row);
                return;
            }
        }
    }

    T selectedValue() {
        Row<T> row = getSelected();
        return row == null ? null : row.value;
    }

    /**
     * Every way a row gets selected ends here — a click, and the arrow keys
     * through {@code setFocused}, which never reach {@link Row#mouseClicked}:
     * a row newly selected tells {@code onSelect}, the row already selected
     * doesn't again.
     */
    @Override
    public void setSelected(Row<T> row) {
        if (row == getSelected()) {
            return;
        }
        super.setSelected(row);
        if (row != null) {
            onSelect.accept(row.value);
        }
    }

    @Override
    public int getRowWidth() {
        return width - 14;
    }

    @Override
    protected int getScrollbarPosition() {
        return getX() + width - 6;
    }

    static final class Row<T> extends ObjectSelectionList.Entry<Row<T>> {
        private final PickerList<T> owner;
        final T value;
        private final Component title;
        private final Component detail;
        private long lastClick;

        Row(PickerList<T> owner, T value, Component title, Component detail) {
            this.owner = owner;
            this.value = value;
            this.title = title;
            this.detail = detail;
        }

        @Override
        public void render(GuiGraphics graphics, int index, int top, int left, int width, int height,
                int mouseX, int mouseY, boolean hovering, float partialTick) {
            var font = Minecraft.getInstance().font;
            int titleY = detail == null ? top + (height - font.lineHeight) / 2 + 1 : top + 1;
            graphics.drawString(font, font.substrByWidth(title, width - 4).getString(),
                    left + 2, titleY, 0xFFFFFF);
            if (detail != null) {
                graphics.drawString(font, font.substrByWidth(detail, width - 4).getString(),
                        left + 2, top + 1 + font.lineHeight + 1, 0x9A9A9A);
            }
        }

        @Override
        public boolean mouseClicked(double mouseX, double mouseY, int button) {
            owner.setSelected(this);
            long now = Util.getMillis();
            if (now - lastClick < DOUBLE_CLICK_MS) {
                owner.onConfirm.accept(value);
            }
            lastClick = now;
            return true;
        }

        @Override
        public Component getNarration() {
            return detail == null ? title : Component.empty().append(title).append(", ").append(detail);
        }
    }
}
