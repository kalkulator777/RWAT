package com.muzhik17.trainsmod.client.gui;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.render.model.RailStyle;
import com.muzhik17.trainsmod.client.render.model.RailStyles;
import com.muzhik17.trainsmod.network.SelectRailStylePayload;
import com.muzhik17.trainsmod.rail.BedMaterial;
import com.muzhik17.trainsmod.rail.RailItem;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.narration.NarratedElementType;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * The rails item's picker (SPEC §6.10): the rail styles of the installed
 * resource packs, the mod's own rail first, and under the 3D turntable the
 * bed material (SPEC §2.2) as a row of block icons. The choice goes to the
 * server, which stores it on the stack; segments built with it are drawn in
 * that style on that bed. The turntable shows the selected style on the
 * selected bed. Further track parameters (gauge…) will join this screen later.
 */
public final class RailStyleScreen extends Screen {

    private static final int TOTAL_WIDTH = 520;
    private static final int GAP = 8;
    /** A bed icon button and the pitch of the icon grid. */
    private static final int BED_BUTTON = 20;
    private static final int BED_PITCH = 22;
    /** Height of the "Bed: …" caption line above the icons. */
    private static final int CAPTION = 12;

    private final InteractionHand hand;
    private final String current;
    private BedMaterial bed;
    private PickerList<String> list;
    private Button select;
    private int previewX0;
    private int previewX1;
    private int previewY0;
    private int previewY1;
    private int captionY;

    public RailStyleScreen(InteractionHand hand, String current, BedMaterial bed) {
        super(Component.translatable("screen.railswheelsandtrains.rail_style"));
        this.hand = hand;
        this.current = current;
        this.bed = bed;
    }

    @Override
    protected void init() {
        int total = Math.min(TOTAL_WIDTH, width - 20);
        int listWidth = (total - GAP) * 9 / 20;
        int left = (width - total) / 2;
        int top = 32;
        int bottom = height - 40;
        list = new PickerList<>(minecraft, left, top, listWidth, bottom - top,
                style -> updateButtons(), this::choose);
        previewX0 = left + listWidth + GAP;
        previewX1 = left + total;
        for (String style : RailStyles.pickable()) {
            list.add(style, RailItem.styleName(style),
                    Component.literal(style.isEmpty() ? RailStyles.STANDARD : style));
        }
        list.select(current);
        addRenderableWidget(list);

        // the bed picker under the turntable: a caption, then rows of block icons
        BedMaterial[] materials = BedMaterial.values();
        int fit = Math.max(1, (previewX1 - previewX0) / BED_PITCH);
        int rows = (materials.length + fit - 1) / fit;
        int perRow = (materials.length + rows - 1) / rows; // balanced rows, not a full one and a stub
        int gridLeft = previewX0 + (previewX1 - previewX0 - perRow * BED_PITCH) / 2;
        int gridTop = bottom - rows * BED_PITCH + (BED_PITCH - BED_BUTTON);
        for (int i = 0; i < materials.length; i++) {
            addRenderableWidget(new BedButton(gridLeft + (i % perRow) * BED_PITCH,
                    gridTop + (i / perRow) * BED_PITCH, materials[i]));
        }
        captionY = gridTop - CAPTION;
        previewY0 = top;
        previewY1 = captionY - 4;

        select = addRenderableWidget(Button.builder(Component.translatable("gui.done"),
                        b -> choose(list.selectedValue()))
                .bounds(width / 2 - 104, height - 30, 100, 20).build());
        addRenderableWidget(Button.builder(Component.translatable("gui.cancel"), b -> onClose())
                .bounds(width / 2 + 4, height - 30, 100, 20).build());
        updateButtons();
    }

    private void updateButtons() {
        select.active = list.selectedValue() != null;
    }

    private void choose(String style) {
        if (style != null) {
            PacketDistributor.sendToServer(new SelectRailStylePayload(hand, style, bed.id()));
        }
        onClose();
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        super.render(graphics, mouseX, mouseY, partialTick);
        graphics.drawCenteredString(font, title, width / 2, 14, 0xFFFFFF);
        graphics.drawString(font, Component.translatable("screen.railswheelsandtrains.rail_style.bed",
                bed.displayName()), previewX0, captionY, 0xFFFFFF);
        if (previewY1 - previewY0 < 16) {
            return; // too short a window for a turntable
        }
        ModelPreview.panel(graphics, previewX0, previewY0, previewX1, previewY1);
        String style = list.selectedValue();
        RailStyle preview = style == null ? null : RailStyles.forSegment(style);
        if (preview != null) {
            ModelPreview.rail(graphics, previewX0, previewY0, previewX1, previewY1, preview,
                    RailsWheelsAndTrains.trackBed(bed).defaultBlockState());
        }
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

    /** One bed material: its block's icon, the name as tooltip, outlined while chosen. */
    private final class BedButton extends AbstractButton {

        private final BedMaterial material;
        private final ItemStack icon;

        BedButton(int x, int y, BedMaterial material) {
            super(x, y, BED_BUTTON, BED_BUTTON, Component.empty());
            this.material = material;
            this.icon = material.icon();
            setTooltip(Tooltip.create(material.displayName()));
        }

        @Override
        public void onPress() {
            bed = material;
        }

        @Override
        protected void renderWidget(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            super.renderWidget(graphics, mouseX, mouseY, partialTick);
            graphics.renderItem(icon, getX() + (width - 16) / 2, getY() + (height - 16) / 2);
            if (bed == material) {
                graphics.renderOutline(getX() - 1, getY() - 1, width + 2, height + 2, 0xFFFFFFFF);
            }
        }

        @Override
        protected void updateWidgetNarration(NarrationElementOutput output) {
            output.add(NarratedElementType.TITLE, material.displayName());
        }
    }
}
