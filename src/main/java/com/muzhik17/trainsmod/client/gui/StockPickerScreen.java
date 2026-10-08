package com.muzhik17.trainsmod.client.gui;

import java.util.List;

import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.RollingStockItem;
import com.muzhik17.trainsmod.network.SelectStockPayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypes;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * The rolling stock item's picker (SPEC §6.11): the wagon types the server's
 * packs declare (synced to every client) on the left, the chosen type's
 * liveries (from this client's model packs) on the right, under a 3D
 * turntable of the selection in that livery. The choice goes to the server,
 * which stores it on the stack.
 */
public final class StockPickerScreen extends Screen {

    private static final int GAP = 8;

    private final InteractionHand hand;
    private final RollingStockItem.Selection current;
    private PickerList<String> types;
    private PickerList<String> liveries;
    private Button select;
    private int previewX0;
    private int previewX1;
    private int previewY0;
    private int previewY1;

    public StockPickerScreen(InteractionHand hand, RollingStockItem.Selection current) {
        super(Component.translatable("screen.railswheelsandtrains.rolling_stock"));
        this.hand = hand;
        this.current = current;
    }

    @Override
    protected void init() {
        int total = Math.min(560, width - 20);
        int typesWidth = (total - GAP) * 2 / 5;
        int rightWidth = total - GAP - typesWidth;
        int left = (width - total) / 2;
        int listHeight = height - 32 - 40;
        int previewHeight = (listHeight - GAP) * 3 / 5;
        previewX0 = left + typesWidth + GAP;
        previewX1 = left + total;
        previewY0 = 32;
        previewY1 = 32 + previewHeight;

        types = new PickerList<>(minecraft, left, 32, typesWidth, listHeight,
                type -> showLiveries(type, ConsistComposition.Slot.BASE_LIVERY), type -> confirm());
        for (WagonType type : WagonTypes.all()) {
            types.add(type.id(), RollingStockItem.stockName(type.id()), describe(type));
        }
        addRenderableWidget(types);

        liveries = new PickerList<>(minecraft, previewX0, previewY1 + GAP, rightWidth,
                listHeight - previewHeight - GAP, livery -> updateButtons(), livery -> confirm());
        addRenderableWidget(liveries);

        select = addRenderableWidget(Button.builder(Component.translatable("gui.done"), b -> confirm())
                .bounds(width / 2 - 104, height - 30, 100, 20).build());
        addRenderableWidget(Button.builder(Component.translatable("gui.cancel"), b -> onClose())
                .bounds(width / 2 + 4, height - 30, 100, 20).build());

        if (current != null) {
            types.select(current.type());
            showLiveries(current.type(), current.livery());
        } else {
            updateButtons();
        }
    }

    /** "25.1 m · 53 t · cab · traction · walk-in" — what sets the types apart at a glance. */
    private static Component describe(WagonType type) {
        StringBuilder text = new StringBuilder(String.format("%.1f m · %.0f t", type.length(), type.massT()));
        if (type.drivable()) {
            text.append(" · ").append(Component.translatable("screen.railswheelsandtrains.cab").getString());
        }
        if (type.powered()) {
            text.append(" · ").append(Component.translatable("screen.railswheelsandtrains.traction").getString());
        }
        if (type.boardable()) {
            text.append(" · ").append(Component.translatable("screen.railswheelsandtrains.walk_in").getString());
        }
        return Component.literal(text.toString());
    }

    /** Fill the livery list for {@code type} (base textures first) and select {@code livery}. */
    private void showLiveries(String type, String livery) {
        liveries.clear();
        liveries.add(ConsistComposition.Slot.BASE_LIVERY,
                Component.translatable("screen.railswheelsandtrains.livery_base"), null);
        List<String> declared = StockModels.liveries(type);
        for (String id : declared) {
            liveries.add(id, Component.literal(id), null);
        }
        liveries.select(declared.contains(livery) ? livery : ConsistComposition.Slot.BASE_LIVERY);
        updateButtons();
    }

    private void updateButtons() {
        select.active = types.selectedValue() != null;
    }

    private void confirm() {
        String type = types.selectedValue();
        if (type != null) {
            String livery = liveries.selectedValue();
            PacketDistributor.sendToServer(new SelectStockPayload(hand, type,
                    livery != null ? livery : ConsistComposition.Slot.BASE_LIVERY));
        }
        onClose();
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        super.render(graphics, mouseX, mouseY, partialTick);
        graphics.drawCenteredString(font, title, width / 2, 14, 0xFFFFFF);
        renderPreview(graphics);
        if (types.children().isEmpty()) {
            graphics.drawCenteredString(font,
                    Component.translatable("screen.railswheelsandtrains.no_stock"),
                    width / 2, height / 2, 0xFF8080);
        }
    }

    /** The selected type on the turntable; a note while its model loads or if it has none. */
    private void renderPreview(GuiGraphics graphics) {
        ModelPreview.panel(graphics, previewX0, previewY0, previewX1, previewY1);
        String typeId = types.selectedValue();
        WagonType type = typeId == null ? null : WagonTypes.byId(typeId);
        if (type == null) {
            return;
        }
        StockModel model = StockModels.model(typeId); // also starts the load on first sight
        Component note = model == null ? Component.translatable("screen.railswheelsandtrains.loading")
                : model.isEmpty() ? Component.translatable("screen.railswheelsandtrains.no_model") : null;
        if (note != null) {
            graphics.drawCenteredString(font, note, (previewX0 + previewX1) / 2,
                    (previewY0 + previewY1) / 2 - font.lineHeight / 2, 0x9A9A9A);
            return;
        }
        String livery = liveries.selectedValue();
        ModelPreview.stock(graphics, previewX0, previewY0, previewX1, previewY1, model, type,
                livery != null ? livery : ConsistComposition.Slot.BASE_LIVERY);
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
