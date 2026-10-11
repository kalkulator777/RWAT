package com.muzhik17.trainsmod.client.gui;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.muzhik17.trainsmod.client.ClientConfig;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientDriverHud;
import com.muzhik17.trainsmod.client.LightNames;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.convention.DriverReadout;
import com.muzhik17.trainsmod.network.CabLeverPayload;
import com.muzhik17.trainsmod.network.ControlGroupPayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;

import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.sounds.SoundEvents;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * The driver's panel (SPEC §8, §9.7), {@code L} at the controls: the
 * instruments ({@link DriverPanel}) on the left — click a notch lamp or a
 * reverser cell to set that handle, the wheel steps it — and every light
 * group of the train's models on the right, one button each with a lamp
 * that shows it on, switching that group on every wagon of the consist. Below, the switch for the instruments
 * on the HUD. Kept dumb on purpose (SPEC §7.3) — it shows and sends; the
 * server decides who may move a handle or switch the lights. The world stays
 * visible behind it (no blur): the train keeps running while it is open.
 */
public final class DriverPanelScreen extends Screen {

    private static final int BUTTON_HEIGHT = 20;
    private static final int MAX_BUTTON_WIDTH = 170;
    private static final int MIN_BUTTON_WIDTH = 90;
    private static final int GAP = 4;
    /** Between the instruments and the lights. */
    private static final int COLUMN_GAP = 12;
    private static final int TOP = 38;
    private static final int MARGIN = 10;
    private static final int FOOTER = 30;

    private final WagonEntity cab;
    /** Group → label, in the order the train's models list them. */
    private final Map<String, String> groups = new LinkedHashMap<>();
    /** Groups switched from this screen before the wagons' synced state catches up. */
    private final Map<String, Boolean> pending = new LinkedHashMap<>();
    private int panelX;
    private int lightsX;
    private int lightsWidth;

    public DriverPanelScreen(WagonEntity cab) {
        super(Component.translatable("screen.railswheelsandtrains.driver_panel"));
        this.cab = cab;
    }

    @Override
    protected void init() {
        groups.clear();
        collectGroups();
        int count = groups.size();
        int rowsFit = Math.max(1, (height - FOOTER - GAP - TOP + GAP) / (BUTTON_HEIGHT + GAP));
        int columns = Math.max(1, (count + rowsFit - 1) / rowsFit);
        int rows = count == 0 ? 0 : (count + columns - 1) / columns;
        int room = width - 2 * MARGIN - DriverPanel.WIDTH - COLUMN_GAP;
        int buttonWidth = Math.clamp((room - (columns - 1) * GAP) / columns,
                MIN_BUTTON_WIDTH, MAX_BUTTON_WIDTH);
        lightsWidth = count == 0 ? MAX_BUTTON_WIDTH : columns * buttonWidth + (columns - 1) * GAP;
        panelX = Math.max(MARGIN, (width - DriverPanel.WIDTH - COLUMN_GAP - lightsWidth) / 2);
        lightsX = panelX + DriverPanel.WIDTH + COLUMN_GAP;
        int i = 0;
        for (String group : groups.keySet()) {
            int x = lightsX + (i / rows) * (buttonWidth + GAP);
            int y = TOP + (i % rows) * (BUTTON_HEIGHT + GAP);
            addRenderableWidget(new LightButton(group, x, y, buttonWidth));
            i++;
        }
        int footerY = height - FOOTER + 4;
        addRenderableWidget(Button.builder(hudCaption(), b -> {
                    ClientConfig.setDriverHud(!ClientConfig.driverHud());
                    b.setMessage(hudCaption());
                })
                .bounds(width / 2 - 154, footerY, 150, BUTTON_HEIGHT).build());
        addRenderableWidget(Button.builder(CommonComponents.GUI_DONE, b -> onClose())
                .bounds(width / 2 + 4, footerY, 150, BUTTON_HEIGHT).build());
    }

    @Override
    public void tick() {
        // left the cab, or stood up from the chair: nothing to drive from here
        if (minecraft != null && ClientDriverHud.cab(minecraft) != cab) {
            onClose();
        }
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        super.render(graphics, mouseX, mouseY, partialTick);
        graphics.drawCenteredString(font, title, width / 2, 12, 0xFFFFFF);
        graphics.drawString(font, Component.translatable("screen.railswheelsandtrains.driver_panel.instruments"),
                panelX, TOP - 12, 0xA0A0A0);
        graphics.drawString(font, Component.translatable("screen.railswheelsandtrains.driver_panel.lights"),
                lightsX, TOP - 12, 0xA0A0A0);
        if (groups.isEmpty()) {
            graphics.drawWordWrap(font, Component.translatable("screen.railswheelsandtrains.lights.none"),
                    lightsX, TOP + 6, lightsWidth, 0xA0A0A0);
        }
        DriverReadout readout = DriverPanel.readout(cab);
        if (readout == null) {
            return;
        }
        DriverPanel.draw(graphics, font, panelX, TOP, readout, true, mouseX, mouseY);
        DriverPanel.Target target = DriverPanel.targetAt(font, panelX, TOP, readout, mouseX, mouseY);
        if (target != null) {
            graphics.renderComponentTooltip(font, DriverPanel.describe(target, readout), mouseX, mouseY);
        }
    }

    /** A light dim instead of the blur: the driver still sees the line ahead. */
    @Override
    public void renderBackground(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        graphics.fillGradient(0, 0, width, height, 0x60101010, 0x80101010);
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (button == 0 && setHandle(mouseX, mouseY, 0)) {
            return true;
        }
        return super.mouseClicked(mouseX, mouseY, button);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        if (scrollY != 0.0 && setHandle(mouseX, mouseY, scrollY > 0.0 ? 1 : -1)) {
            return true;
        }
        return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
    }

    /**
     * Move the handle under the mouse: to the position clicked ({@code step}
     * 0), or one notch up or down from where it stands (the wheel). False if
     * there's no handle there.
     */
    private boolean setHandle(double mouseX, double mouseY, int step) {
        DriverReadout readout = DriverPanel.readout(cab);
        DriverPanel.Target target = readout == null ? null
                : DriverPanel.targetAt(font, panelX, TOP, readout, mouseX, mouseY);
        if (target == null) {
            return false;
        }
        Consist.Handle handle = target.handle();
        if (!readout.canMove(handle)) {
            return true; // on the panel, but not the driver's to move now
        }
        int value = target.value();
        if (step != 0) {
            int min = handle == Consist.Handle.REVERSER ? -1 : 0;
            int max = handle == Consist.Handle.REVERSER ? 1 : Consist.NOTCHES;
            value = Math.clamp(readout.handle(handle) + step, min, max);
        }
        if (value != readout.handle(handle)) {
            PacketDistributor.sendToServer(new CabLeverPayload(cab.getId(), handle.ordinal(), value));
            minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0F));
        }
        return true;
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

    /** Where the instruments are drawn (the debug scene aims the mouse at them). */
    public int panelX() {
        return panelX;
    }

    public int panelY() {
        return TOP;
    }

    private static Component hudCaption() {
        return Component.translatable("screen.railswheelsandtrains.driver_panel.hud",
                state(ClientConfig.driverHud()));
    }

    /** Switch a light group on every wagon of the train. */
    private void toggle(String group) {
        boolean on = !isOn(group);
        pending.put(group, on);
        PacketDistributor.sendToServer(new ControlGroupPayload(cab.getConsistId(),
                ControlGroupPayload.Scope.PANEL, group, on ? 1.0F : 0.0F));
    }

    private static Component state(boolean on) {
        return Component.translatable(on ? "control.railswheelsandtrains.on" : "control.railswheelsandtrains.off");
    }

    /**
     * A light group's switch: its name, and a lamp on the left lit while the
     * group is on — the name keeps the whole width that ": off" took.
     */
    private final class LightButton extends Button {

        private static final int LAMP = 8;
        private static final int LAMP_ON = 0xFFFFD24A;
        private static final int LAMP_OFF = 0xFF3A3A3A;

        private final String group;

        LightButton(String group, int x, int y, int width) {
            super(x, y, width, BUTTON_HEIGHT, Component.literal(groups.get(group)), b -> toggle(group),
                    DEFAULT_NARRATION);
            this.group = group;
        }

        @Override
        public void renderString(GuiGraphics graphics, Font font, int color) {
            int left = getX() + 5;
            int top = getY() + (getHeight() - LAMP) / 2;
            graphics.fill(left, top, left + LAMP, top + LAMP, 0xFF101010);
            graphics.fill(left + 1, top + 1, left + LAMP - 1, top + LAMP - 1, isOn(group) ? LAMP_ON : LAMP_OFF);
            renderScrollingString(graphics, font, getMessage(), left + LAMP + 2, getY(),
                    getX() + getWidth() - 3, getY() + getHeight(), color);
        }

        @Override
        protected MutableComponent createNarrationMessage() {
            return wrapDefaultNarrationMessage(Component.empty().append(getMessage()).append(": ")
                    .append(state(isOn(group))));
        }
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
        int consistId = cab.getConsistId();
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
        collectLabels();
        // two groups by one name (a model's front and rear "Head Light" switches): add the code
        Map<String, Integer> uses = new LinkedHashMap<>();
        for (String label : groups.values()) {
            uses.merge(label, 1, Integer::sum);
        }
        groups.replaceAll((group, label) -> uses.get(label) > 1 && !label.equals(group)
                ? label + " (" + group + ")" : label);
    }

    private void collectLabels() {
        int consistId = cab.getConsistId();
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
