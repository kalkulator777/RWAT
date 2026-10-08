package com.muzhik17.trainsmod.client.gui;

import com.muzhik17.trainsmod.client.render.model.RailStyle;
import com.muzhik17.trainsmod.client.render.model.RailStyles;
import com.muzhik17.trainsmod.network.SelectRailStylePayload;
import com.muzhik17.trainsmod.rail.RailItem;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * The rails item's picker (SPEC §6.10): the rail styles of the installed
 * resource packs, the mod's own rail first. The choice goes to the server,
 * which stores it on the stack; segments built with it are drawn in it. The
 * selected style turns on a 3D turntable beside the list. Track parameters
 * (gauge, ballast…) will join this screen later.
 */
public final class RailStyleScreen extends Screen {

    private static final int TOTAL_WIDTH = 520;
    private static final int GAP = 8;

    private final InteractionHand hand;
    private final String current;
    private PickerList<String> list;
    private Button select;
    private int previewX0;
    private int previewX1;
    private int previewY0;
    private int previewY1;

    public RailStyleScreen(InteractionHand hand, String current) {
        super(Component.translatable("screen.railswheelsandtrains.rail_style"));
        this.hand = hand;
        this.current = current;
    }

    @Override
    protected void init() {
        int total = Math.min(TOTAL_WIDTH, width - 20);
        int listWidth = (total - GAP) * 9 / 20;
        int left = (width - total) / 2;
        int listHeight = height - 32 - 40;
        list = new PickerList<>(minecraft, left, 32, listWidth, listHeight,
                style -> updateButtons(), this::choose);
        previewX0 = left + listWidth + GAP;
        previewX1 = left + total;
        previewY0 = 32;
        previewY1 = 32 + listHeight;
        for (String style : RailStyles.pickable()) {
            list.add(style, RailItem.styleName(style),
                    Component.literal(style.isEmpty() ? RailStyles.STANDARD : style));
        }
        list.select(current);
        addRenderableWidget(list);

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
            PacketDistributor.sendToServer(new SelectRailStylePayload(hand, style));
        }
        onClose();
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        super.render(graphics, mouseX, mouseY, partialTick);
        graphics.drawCenteredString(font, title, width / 2, 14, 0xFFFFFF);
        ModelPreview.panel(graphics, previewX0, previewY0, previewX1, previewY1);
        String style = list.selectedValue();
        RailStyle preview = style == null ? null : RailStyles.forSegment(style);
        if (preview != null) {
            ModelPreview.rail(graphics, previewX0, previewY0, previewX1, previewY1, preview);
        }
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
