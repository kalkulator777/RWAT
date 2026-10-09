package com.muzhik17.trainsmod.client.gui;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.LightNames;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.network.ControlGroupPayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.CommonComponents;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * The driver's light menu (SPEC §8): every light group of the train's models,
 * one button each, switching that group on every wagon of the consist. Kept
 * dumb on purpose (SPEC §7.3) — it lists, sends and shows; the server decides
 * who may switch.
 */
public final class TrainLightsScreen extends Screen {

    private static final int BUTTON_WIDTH = 180;
    private static final int BUTTON_HEIGHT = 20;
    private static final int GAP = 4;
    private static final int ROWS_PER_COLUMN = 8;

    private final int consistId;
    /** Group → label, in the order the train's models list them. */
    private final Map<String, String> groups = new LinkedHashMap<>();
    /** Groups switched on from this screen before the wagons' synced state catches up. */
    private final Map<String, Boolean> pending = new LinkedHashMap<>();

    public TrainLightsScreen(int consistId) {
        super(Component.translatable("screen.railswheelsandtrains.lights"));
        this.consistId = consistId;
    }

    @Override
    protected void init() {
        groups.clear();
        collectGroups();
        int columns = Math.max(1, (groups.size() + ROWS_PER_COLUMN - 1) / ROWS_PER_COLUMN);
        int rows = Math.min(groups.size(), ROWS_PER_COLUMN);
        int totalWidth = columns * BUTTON_WIDTH + (columns - 1) * GAP;
        int top = height / 2 - (rows * (BUTTON_HEIGHT + GAP)) / 2;
        int left = width / 2 - totalWidth / 2;
        int i = 0;
        for (String group : groups.keySet()) {
            int x = left + (i / ROWS_PER_COLUMN) * (BUTTON_WIDTH + GAP);
            int y = top + (i % ROWS_PER_COLUMN) * (BUTTON_HEIGHT + GAP);
            addRenderableWidget(Button.builder(caption(group), b -> {
                        boolean on = !isOn(group);
                        pending.put(group, on);
                        PacketDistributor.sendToServer(
                                new ControlGroupPayload(consistId, true, group, on ? 1.0F : 0.0F));
                        b.setMessage(caption(group));
                    })
                    .bounds(x, y, BUTTON_WIDTH, BUTTON_HEIGHT).build());
            i++;
        }
        addRenderableWidget(Button.builder(CommonComponents.GUI_DONE, b -> onClose())
                .bounds(width / 2 - 50, top + rows * (BUTTON_HEIGHT + GAP) + 8, 100, BUTTON_HEIGHT)
                .build());
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        super.render(graphics, mouseX, mouseY, partialTick);
        int rows = Math.min(groups.size(), ROWS_PER_COLUMN);
        int top = height / 2 - (rows * (BUTTON_HEIGHT + GAP)) / 2;
        graphics.drawCenteredString(font, title, width / 2, top - 20, 0xFFFFFF);
        if (groups.isEmpty()) {
            graphics.drawCenteredString(font, Component.translatable("screen.railswheelsandtrains.lights.none"),
                    width / 2, height / 2 - 20, 0xA0A0A0);
        }
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

    private Component caption(String group) {
        return Component.literal(groups.get(group) + ": ").append(Component.translatable(isOn(group)
                ? "control.railswheelsandtrains.on" : "control.railswheelsandtrains.off"));
    }

    /** On if any wagon of the train has it on (or this screen just switched it). */
    private boolean isOn(String group) {
        Boolean switched = pending.get(group);
        if (switched != null) {
            return switched;
        }
        for (WagonEntity wagon : wagons()) {
            if (wagon.controlValue(group) > 0.0F) {
                return true;
            }
        }
        return false;
    }

    private List<WagonEntity> wagons() {
        List<WagonEntity> wagons = new ArrayList<>();
        if (minecraft == null || minecraft.level == null) {
            return wagons;
        }
        for (var entity : minecraft.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity wagon && wagon.getConsistId() == consistId) {
                wagons.add(wagon);
            }
        }
        return wagons;
    }

    /**
     * The train's light groups: each model's {@code LCG} groups plus the
     * groups of glowing switch-driven parts (the ChME3's tail lamps), labelled
     * from the translations ({@link LightNames}: the pack's for the type, else
     * the mod's), else the model's own switch label, else the name.
     */
    private void collectGroups() {
        for (int index = 0; ; index++) {
            ConsistComposition.Slot slot = ClientConsists.slot(consistId, index);
            if (slot == null) {
                break;
            }
            StockModel model = StockModels.model(slot.type().id());
            if (model == null) {
                continue;
            }
            String type = slot.type().id();
            for (String group : model.lightGroups()) {
                groups.putIfAbsent(group, label(model, type, group));
            }
            for (StockModel.Control control : model.controls()) {
                if (control.role().hide() && glows(control)) {
                    groups.putIfAbsent(control.role().group(), label(model, type, control.role().group()));
                }
            }
        }
    }

    private static boolean glows(StockModel.Control control) {
        for (Mesh mesh : control.meshes().values()) {
            for (Mesh.Quad quad : mesh.quads()) {
                if ((quad.tag() & StockModel.TAG_FULLBRIGHT) != 0) {
                    return true;
                }
            }
        }
        return false;
    }

    private static String label(StockModel model, String type, String group) {
        String name = LightNames.of(type, group);
        if (name != null) {
            return name;
        }
        for (StockModel.Control control : model.controls()) {
            String label = control.role().label();
            if (control.role().group().equals(group) && label != null && !label.isBlank()) {
                return label;
            }
        }
        return group;
    }
}
