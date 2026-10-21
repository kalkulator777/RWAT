package com.muzhik17.trainsmod.client.gui;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.muzhik17.trainsmod.client.ClientConfig;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientDriverHud;
import com.muzhik17.trainsmod.client.LightNames;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.RollingStockItem;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.convention.DriverReadout;
import com.muzhik17.trainsmod.kinematics.CabArea;
import com.muzhik17.trainsmod.network.CabLeverPayload;
import com.muzhik17.trainsmod.network.CarControlPayload;
import com.muzhik17.trainsmod.network.ControlGroupPayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.Mth;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * The driver's panel (SPEC §8, §9.7), {@code L} at the controls: the
 * instruments ({@link DriverPanel}) on the left — click a notch lamp or a
 * reverser cell to set that handle, the wheel steps it — and two pages on
 * the right. <b>Lights</b>: every light group of the train's models, one
 * button each with a lamp that shows it on, switching that group on every
 * wagon of the consist; scrolled if they don't fit. <b>Train</b> (SPEC §9.7,
 * 2026-10-12): the passengers' doors on each side and the lights inside, for
 * the whole train at once and car by car — left and right as the driver sees
 * them from this cab, the cars by number and name. Below, the switch for the
 * instruments on the HUD. Kept dumb on purpose (SPEC §7.3) — it shows and
 * sends, its switches working only while this cab drives; the server decides
 * who may move a handle, switch the lights or work the doors. The world
 * stays visible behind it (no blur): the train keeps running while it is open.
 */
public final class DriverPanelScreen extends Screen {

    private static final int BUTTON_HEIGHT = 20;
    private static final int MAX_BUTTON_WIDTH = 170;
    private static final int MIN_BUTTON_WIDTH = 90;
    private static final int GAP = 4;
    private static final int TOP = 38;
    private static final int FOOTER = 30;
    /** The train page: its widest, the height of a car's row and the width of its switches. */
    private static final int MAX_TRAIN_WIDTH = 300;
    private static final int ROW = 18;
    private static final int TOGGLE_W = 34;
    private static final int TOGGLE_H = 16;
    /** A whole-train row's label over its buttons, on a narrow window. */
    private static final int LABEL_LINE = 10;
    private static final int LAMP = 8;
    private static final int LAMP_ON = 0xFFFFD24A;
    private static final int LAMP_OFF = 0xFF3A3A3A;
    private static final int DIM = 0xA0A0A0;

    /** The page on the right; kept between openings. */
    private enum Page { LIGHTS, TRAIN }

    private static Page page = Page.LIGHTS;

    private final WagonEntity cab;
    /** Group → label, in the order the train's models list them. */
    private final Map<String, String> groups = new LinkedHashMap<>();
    /** Groups switched from this screen before the wagons' synced state catches up (kept over a resize). */
    private final PendingSwitches pending = new PendingSwitches();
    /** The groups some wagon of the train has on, as synced: read once a tick, not per button per frame. */
    private final Set<String> lit = new HashSet<>();
    /** Ticks since the screen opened: the clock of {@link #pending}. */
    private int ticks;
    /** The cars of the train page, front first. */
    private final List<Car> cars = new ArrayList<>();
    private final List<CarToggle> carToggles = new ArrayList<>();
    private final List<LightButton> lightButtons = new ArrayList<>();
    private int panelX;
    private int lightsX;
    private int lightsWidth;
    private int trainWidth;
    /** Too narrow a window for the train page's rows beside the instruments: labels over the buttons. */
    private boolean narrow;
    private int toggleW;
    /** The light buttons' grid and how far it is scrolled (rows). */
    private PanelLayout.Grid grid;
    private int lightScroll;
    /** Where the car rows start, how many fit, and how far the list is scrolled (rows). */
    private int listTop;
    private int listRows;
    private int scroll;

    /** The cars the train had when the page was made: a coupling or a cut while open remakes it. */
    private int carsKnown;
    /** The buttons that switch something on the train (lights, doors): active only while this cab drives. */
    private final List<Button> switches = new ArrayList<>();

    /**
     * A car of the train: its row on the page, entity, number in the train,
     * name, the doors on the driver's sides and its lights.
     */
    private record Car(int row, WagonEntity wagon, int number, Component name, int leftDoors, int rightDoors,
            List<String> lights) {
    }

    public DriverPanelScreen(WagonEntity cab) {
        super(Component.translatable("screen.railswheelsandtrains.driver_panel"));
        this.cab = cab;
    }

    /**
     * Lay out the screen: the instruments and the right half side by side,
     * centred; the right half as wide as its pages want, up to what the
     * window leaves. On a narrow window (4:3, 5:4 at the automatic GUI scale)
     * the margins close up and the right half takes all the rest; its pages
     * fit there: the light buttons in fewer columns and scrolled, the train
     * page's labels over their buttons.
     */
    @Override
    protected void init() {
        groups.clear();
        collectGroups();
        pending.retain(groups.keySet());
        collectCars();
        carToggles.clear();
        lightButtons.clear();
        switches.clear();
        int labelWidth = widest("doors_left", "doors_right", "lights_inside") + 8;
        int captionWidth = widest("open", "close", "on", "off") + 8;
        int trainNeed = labelWidth + 2 * captionWidth + GAP;
        PanelLayout.Halves halves = PanelLayout.halves(width, DriverPanel.WIDTH, trainNeed);
        narrow = halves.narrow();
        int rowsFit = (height - FOOTER - GAP - TOP + GAP) / (BUTTON_HEIGHT + GAP);
        grid = PanelLayout.grid(groups.size(), halves.room(), rowsFit, MIN_BUTTON_WIDTH, MAX_BUTTON_WIDTH, GAP);
        lightsWidth = grid.width();
        trainWidth = Math.min(halves.room(), Math.max(MAX_TRAIN_WIDTH, trainNeed));
        toggleW = narrow ? Math.min(TOGGLE_W, widest("column.left", "column.right", "column.light") + 4) : TOGGLE_W;
        // the instruments stay put when the page changes
        int rightWidth = Math.max(lightsWidth, trainWidth);
        panelX = halves.panelX(width, DriverPanel.WIDTH, rightWidth);
        lightsX = panelX + DriverPanel.WIDTH + halves.gap();
        addPageTab(Page.LIGHTS, "screen.railswheelsandtrains.driver_panel.lights", lightsX);
        addPageTab(Page.TRAIN, "screen.railswheelsandtrains.driver_panel.train",
                lightsX + font.width(Component.translatable("screen.railswheelsandtrains.driver_panel.lights")) + 12);
        if (page == Page.LIGHTS) {
            for (String group : groups.keySet()) {
                LightButton button = new LightButton(group, grid.buttonWidth());
                lightButtons.add(button);
                switches.add(button);
                addRenderableWidget(button);
            }
            lightScroll = Mth.clamp(lightScroll, 0, grid.maxScroll());
            layOutLights();
        } else {
            initTrain(labelWidth);
        }
        int footerY = height - FOOTER + 4;
        addRenderableWidget(Button.builder(hudCaption(), b -> {
                    ClientConfig.setDriverHud(!ClientConfig.driverHud());
                    b.setMessage(hudCaption());
                })
                .bounds(width / 2 - 154, footerY, 150, BUTTON_HEIGHT).build());
        addRenderableWidget(Button.builder(CommonComponents.GUI_DONE, b -> onClose())
                .bounds(width / 2 + 4, footerY, 150, BUTTON_HEIGHT).build());
        refresh();
    }

    /** The widest of the panel's strings under {@code keys}. */
    private int widest(String... keys) {
        int widest = 0;
        for (String key : keys) {
            widest = Math.max(widest,
                    font.width(Component.translatable("screen.railswheelsandtrains.driver_panel." + key)));
        }
        return widest;
    }

    /**
     * The train page: three rows for the whole train — the doors on the
     * left, on the right, the lights inside: on/off each, the label left of
     * the buttons or, on a narrow window, over them — then a row per car with
     * the same three as switches, scrolled if there are more cars than room.
     */
    private void initTrain(int labelWidth) {
        int buttonWidth = Math.min(80, ((narrow ? trainWidth : trainWidth - labelWidth) - GAP) / 2);
        int x = narrow ? lightsX : lightsX + labelWidth;
        CarControlPayload.Target[] targets = {CarControlPayload.Target.DOORS_LEFT,
            CarControlPayload.Target.DOORS_RIGHT, CarControlPayload.Target.LIGHTS};
        for (int row = 0; row < 3; row++) {
            CarControlPayload.Target target = targets[row];
            int y = trainRowTop(row) + (narrow ? LABEL_LINE : 0);
            boolean doors = target != CarControlPayload.Target.LIGHTS;
            addTrainButton(x, y, buttonWidth, doors ? "open" : "on", target, true);
            addTrainButton(x + buttonWidth + GAP, y, buttonWidth, doors ? "close" : "off", target, false);
        }
        listTop = trainRowTop(3) + 18;
        listRows = Math.max(1, (height - FOOTER - GAP - listTop) / ROW);
        scroll = Mth.clamp(scroll, 0, Math.max(0, cars.size() - listRows));
        for (Car car : cars) {
            for (int column = 0; column < 3; column++) {
                CarToggle toggle = new CarToggle(car, targets[column], toggleX(column));
                carToggles.add(toggle);
                switches.add(toggle);
                addRenderableWidget(toggle);
            }
        }
        layOutCars();
    }

    private void addTrainButton(int x, int y, int width, String key, CarControlPayload.Target target, boolean on) {
        Button button = Button.builder(Component.translatable("screen.railswheelsandtrains.driver_panel." + key),
                b -> switchTrain(target, on)).bounds(x, y, width, BUTTON_HEIGHT).build();
        switches.add(button);
        addRenderableWidget(button);
    }

    /** The top of a whole-train row of the train page (row 3: where the rows end). */
    private int trainRowTop(int row) {
        return TOP + row * (narrow ? LABEL_LINE + BUTTON_HEIGHT + 2 : BUTTON_HEIGHT + GAP);
    }

    /** The left edge of a car row's switch column (doors left, doors right, lights). */
    private int toggleX(int column) {
        return lightsX + trainWidth - (3 - column) * toggleW - (2 - column) * GAP;
    }

    /** Put the light buttons in their places for the scroll; rows scrolled off hide. */
    private void layOutLights() {
        for (int i = 0; i < lightButtons.size(); i++) {
            LightButton button = lightButtons.get(i);
            int row = grid.row(i) - lightScroll;
            button.visible = row >= 0 && row < grid.visibleRows();
            button.setPosition(lightsX + grid.column(i) * (grid.buttonWidth() + GAP),
                    TOP + row * (BUTTON_HEIGHT + GAP));
        }
    }

    /** Put the car switches on their rows for the scroll; rows scrolled off hide. */
    private void layOutCars() {
        for (CarToggle toggle : carToggles) {
            int row = toggle.car.row() - scroll;
            toggle.visible = row >= 0 && row < listRows && toggle.has();
            toggle.setY(listTop + row * ROW + (ROW - TOGGLE_H) / 2);
        }
    }

    private void addPageTab(Page target, String key, int x) {
        Component label = Component.translatable(key);
        addRenderableWidget(new PageTab(target, label, x, TOP - 14, font.width(label)));
    }

    @Override
    public void tick() {
        ticks++;
        // left the cab, or stood up from the chair: nothing to drive from here
        if (minecraft != null && ClientDriverHud.cab(minecraft) != cab) {
            onClose();
            return;
        }
        ConsistComposition composition = ClientConsists.composition(cab.getConsistId());
        if (composition != null && composition.wagonCount() != carsKnown) {
            rebuildWidgets(); // coupled or cut while open: other cars, other light groups
            return;
        }
        refresh();
    }

    /**
     * Read the lamps' synced state, let it overrule the clicks it has caught
     * up with (or that waited too long), and let the switches work only
     * while this cab drives: the lights and doors are switched by whoever
     * drives — from another cab, look only.
     */
    private void refresh() {
        lit.clear();
        for (WagonEntity wagon : wagons()) {
            for (String group : groups.keySet()) {
                if (wagon.controlValue(group) > 0.0F) {
                    lit.add(group);
                }
            }
        }
        pending.settle(lit::contains, ticks);
        DriverReadout readout = DriverPanel.readout(cab);
        boolean inControl = readout != null && readout.inControl();
        for (Button button : switches) {
            button.active = inControl;
        }
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        super.render(graphics, mouseX, mouseY, partialTick);
        graphics.drawCenteredString(font, title, width / 2, 12, 0xFFFFFF);
        graphics.drawString(font, Component.translatable("screen.railswheelsandtrains.driver_panel.instruments"),
                panelX, TOP - 12, DIM);
        DriverReadout readout = DriverPanel.readout(cab);
        if (page == Page.LIGHTS && groups.isEmpty()) {
            graphics.drawWordWrap(font, Component.translatable("screen.railswheelsandtrains.lights.none"),
                    lightsX, TOP + 6, lightsWidth, DIM);
        }
        if (page == Page.LIGHTS && grid.scrolls()) {
            scrollBar(graphics, lightsX + lightsWidth + 3, TOP, grid.visibleRows() * (BUTTON_HEIGHT + GAP) - GAP,
                    grid.visibleRows(), grid.rows(), lightScroll);
        }
        if (page == Page.TRAIN) {
            renderTrain(graphics, readout);
        }
        if (readout == null) {
            return;
        }
        DriverPanel.draw(graphics, font, panelX, TOP, readout, true, mouseX, mouseY);
        DriverPanel.Target target = DriverPanel.targetAt(font, panelX, TOP, readout, mouseX, mouseY);
        if (target != null) {
            graphics.renderComponentTooltip(font, DriverPanel.describe(target, readout), mouseX, mouseY);
        }
    }

    /** The train page's labels: the whole-train rows', the car list's heading and each car's name. */
    private void renderTrain(GuiGraphics graphics, DriverReadout readout) {
        String[] keys = {"doors_left", "doors_right", "lights_inside"};
        for (int row = 0; row < 3; row++) {
            graphics.drawString(font, Component.translatable("screen.railswheelsandtrains.driver_panel." + keys[row]),
                    lightsX, trainRowTop(row) + (narrow ? 1 : 6), 0xFFFFFF);
        }
        int headY = listTop - 11;
        graphics.fill(lightsX, headY - 4, lightsX + trainWidth, headY - 3, 0x50FFFFFF);
        graphics.drawString(font, Component.translatable("screen.railswheelsandtrains.driver_panel.cars"),
                lightsX, headY, DIM);
        String[] heads = {"left", "right", "light"};
        for (int column = 0; column < 3; column++) {
            Component head = Component.translatable("screen.railswheelsandtrains.driver_panel.column." + heads[column]);
            graphics.drawString(font, head, toggleX(column) + (toggleW - font.width(head)) / 2, headY, DIM);
        }
        int nameWidth = toggleX(0) - GAP - lightsX;
        for (int i = scroll; i < cars.size() && i < scroll + listRows; i++) {
            Car car = cars.get(i);
            int y = listTop + (i - scroll) * ROW + (ROW - font.lineHeight) / 2 + 1;
            String text = car.number() + "  " + car.name().getString();
            if (font.width(text) > nameWidth) {
                text = font.plainSubstrByWidth(text, nameWidth - font.width("…")) + "…";
            }
            // the car this cab is: marked
            graphics.drawString(font, text, lightsX, y, car.wagon() == cab ? 0xFFE8C860 : 0xFFFFFF);
            for (int column = 0; column < 3; column++) {
                CarToggle toggle = carToggles.get(i * 3 + column);
                if (!toggle.has()) {
                    graphics.drawString(font, "—", toggleX(column) + (toggleW - font.width("—")) / 2, y, 0x606060);
                }
            }
        }
        if (cars.size() > listRows) {
            scrollBar(graphics, lightsX + trainWidth + 3, listTop, listRows * ROW, listRows, cars.size(), scroll);
        }
        if (readout != null && !readout.inControl()) {
            graphics.drawString(font, Component.translatable("hud.railswheelsandtrains.other_cab"),
                    lightsX, listTop + listRows * ROW + 2, DIM);
        }
    }

    /** A scroll bar along a list's right edge: {@code shown} of {@code total} rows, from row {@code scroll}. */
    private static void scrollBar(GuiGraphics graphics, int x, int top, int height, int shown, int total, int scroll) {
        int thumb = Math.max(8, height * shown / total);
        int thumbY = top + (height - thumb) * scroll / Math.max(1, total - shown);
        graphics.fill(x, top, x + 2, top + height, 0x40FFFFFF);
        graphics.fill(x, thumbY, x + 2, thumbY + thumb, 0xC0FFFFFF);
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
        if (page == Page.TRAIN && scrollY != 0.0 && mouseX >= lightsX && mouseY >= listTop
                && mouseY < listTop + listRows * ROW && cars.size() > listRows) {
            scroll = Mth.clamp(scroll - (int) Math.signum(scrollY), 0, cars.size() - listRows);
            layOutCars();
            return true;
        }
        if (page == Page.LIGHTS && scrollY != 0.0 && mouseX >= lightsX && mouseY >= TOP
                && mouseY < TOP + grid.visibleRows() * (BUTTON_HEIGHT + GAP) && grid.scrolls()) {
            lightScroll = Mth.clamp(lightScroll - (int) Math.signum(scrollY), 0, grid.maxScroll());
            layOutLights();
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

    /** Show the lights page ({@code false}) or the train page (the debug scene turns the pages). */
    public void showTrain(boolean train) {
        page = train ? Page.TRAIN : Page.LIGHTS;
        rebuildWidgets();
    }

    private static Component hudCaption() {
        return Component.translatable("screen.railswheelsandtrains.driver_panel.hud",
                state(ClientConfig.driverHud()));
    }

    /** Switch a light group on every wagon of the train; its lamp shows the click until the sync answers. */
    private void toggle(String group) {
        boolean on = !isOn(group);
        pending.put(group, on, ticks);
        PacketDistributor.sendToServer(new ControlGroupPayload(cab.getConsistId(),
                ControlGroupPayload.Scope.PANEL, group, on ? 1.0F : 0.0F));
    }

    /** The whole train: open or close the doors on one side, or switch the lights inside every car. */
    private void switchTrain(CarControlPayload.Target target, boolean on) {
        if (target != CarControlPayload.Target.LIGHTS) {
            PacketDistributor.sendToServer(new CarControlPayload(cab.getConsistId(), -1, target, on, List.of()));
            return;
        }
        for (Car car : cars) {
            if (!car.lights().isEmpty()) {
                PacketDistributor.sendToServer(new CarControlPayload(cab.getConsistId(), car.wagon().getId(),
                        target, on, car.lights()));
            }
        }
    }

    private static Component state(boolean on) {
        return Component.translatable(on ? "control.railswheelsandtrains.on" : "control.railswheelsandtrains.off");
    }

    /**
     * A light group's switch: its name, and a lamp on the left lit while the
     * group is on — the name keeps the whole width that ": off" took.
     */
    private final class LightButton extends Button {

        private final String group;

        LightButton(String group, int width) {
            super(0, 0, width, BUTTON_HEIGHT, Component.literal(groups.get(group)), b -> toggle(group),
                    DEFAULT_NARRATION);
            this.group = group;
        }

        @Override
        public void renderString(GuiGraphics graphics, Font font, int color) {
            int left = getX() + 5;
            int top = getY() + (getHeight() - LAMP) / 2;
            lamp(graphics, left, top, isOn(group));
            renderScrollingString(graphics, font, getMessage(), left + LAMP + 2, getY(),
                    getX() + getWidth() - 3, getY() + getHeight(), color);
        }

        @Override
        protected MutableComponent createNarrationMessage() {
            return wrapDefaultNarrationMessage(Component.empty().append(getMessage()).append(": ")
                    .append(state(isOn(group))));
        }
    }

    private static void lamp(GuiGraphics graphics, int left, int top, boolean on) {
        graphics.fill(left, top, left + LAMP, top + LAMP, 0xFF101010);
        graphics.fill(left + 1, top + 1, left + LAMP - 1, top + LAMP - 1, on ? LAMP_ON : LAMP_OFF);
    }

    /**
     * One car's doors on a side or its lights: a lamp lit while they are open
     * (any of them) or on; a click switches them the other way.
     */
    private final class CarToggle extends Button {

        private final Car car;
        private final CarControlPayload.Target target;
        /** The state the tooltip was made for (null: none yet). */
        private Boolean described;

        CarToggle(Car car, CarControlPayload.Target target, int x) {
            super(x, 0, toggleW, TOGGLE_H, Component.translatable("screen.railswheelsandtrains.driver_panel.column."
                    + switch (target) {
                        case DOORS_LEFT -> "left";
                        case DOORS_RIGHT -> "right";
                        case LIGHTS -> "light";
                    }), b -> { }, DEFAULT_NARRATION);
            this.car = car;
            this.target = target;
        }

        /** True if the car has anything here to switch. */
        boolean has() {
            return switch (target) {
                case DOORS_LEFT -> car.leftDoors() != 0;
                case DOORS_RIGHT -> car.rightDoors() != 0;
                case LIGHTS -> !car.lights().isEmpty();
            };
        }

        boolean on() {
            return switch (target) {
                case DOORS_LEFT -> (car.wagon().doorMask() & car.leftDoors()) != 0;
                case DOORS_RIGHT -> (car.wagon().doorMask() & car.rightDoors()) != 0;
                case LIGHTS -> car.lights().stream().anyMatch(group -> car.wagon().controlValue(group) > 0.0F);
            };
        }

        @Override
        public void onPress() {
            PacketDistributor.sendToServer(new CarControlPayload(cab.getConsistId(), car.wagon().getId(), target,
                    !on(), car.lights()));
        }

        @Override
        public void renderString(GuiGraphics graphics, Font font, int color) {
            boolean on = on();
            lamp(graphics, getX() + (getWidth() - LAMP) / 2, getY() + (getHeight() - LAMP) / 2, on);
            if (described == null || described != on) {
                described = on;
                boolean doors = target != CarControlPayload.Target.LIGHTS;
                setTooltip(Tooltip.create(Component.translatable(doors
                        ? (on ? "screen.railswheelsandtrains.driver_panel.doors_open"
                                : "screen.railswheelsandtrains.driver_panel.doors_shut")
                        : (on ? "screen.railswheelsandtrains.driver_panel.lights_on"
                                : "screen.railswheelsandtrains.driver_panel.lights_off"),
                        car.number(), car.name(), Component.translatable(
                                target == CarControlPayload.Target.DOORS_LEFT
                                        ? "screen.railswheelsandtrains.driver_panel.side.left"
                                        : "screen.railswheelsandtrains.driver_panel.side.right"))));
            }
        }

        @Override
        protected MutableComponent createNarrationMessage() {
            return wrapDefaultNarrationMessage(Component.empty().append(Integer.toString(car.number()))
                    .append(" ").append(car.name()).append(", ").append(getMessage()).append(": ")
                    .append(state(on())));
        }
    }

    /** A page's name over the right half: click to show it; the page shown is white and underlined. */
    private final class PageTab extends Button {

        private final Page target;

        PageTab(Page target, Component label, int x, int y, int width) {
            super(x, y, width, 12, label, b -> {
                if (page != target) {
                    page = target;
                    rebuildWidgets();
                }
            }, DEFAULT_NARRATION);
            this.target = target;
        }

        @Override
        protected void renderWidget(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            boolean shown = page == target;
            int color = shown || isHoveredOrFocused() ? 0xFFFFFF : DIM;
            graphics.drawString(font, getMessage(), getX(), getY() + 2, color);
            if (shown) {
                graphics.fill(getX(), getY() + 11, getX() + getWidth(), getY() + 12, 0xFFFFFFFF);
            }
        }
    }

    /** On if any wagon of the train has it on — or the way this screen just switched it, until the sync answers. */
    private boolean isOn(String group) {
        Boolean switched = pending.get(group);
        return switched != null ? switched : lit.contains(group);
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
     * The train's cars, front first: the doors on the driver's left and right
     * — as seen from this cab (its chair's facing, the car's turn in the
     * train) — and the groups of the lamps inside its model.
     */
    private void collectCars() {
        cars.clear();
        ConsistComposition composition = ClientConsists.composition(cab.getConsistId());
        carsKnown = composition == null ? 0 : composition.wagonCount();
        if (composition == null || minecraft == null || minecraft.player == null) {
            return;
        }
        WagonEntity[] byIndex = new WagonEntity[composition.wagonCount()];
        for (WagonEntity wagon : wagons()) {
            int index = wagon.getWagonIndex();
            if (index >= 0 && index < byIndex.length) {
                byIndex[index] = wagon;
            }
        }
        ConsistComposition.Slot cabSlot = ClientConsists.slot(cab.getConsistId(), cab.getWagonIndex());
        int chair = cab.chairOf(minecraft.player);
        WagonType.Seat seat = cabSlot != null && cabSlot.type().cab() != null && chair >= 0
                && chair < cabSlot.type().cab().seats().size() ? cabSlot.type().cab().seats().get(chair) : null;
        int facing = CabArea.facing(cab.isFlipped(), seat);
        for (int i = 0; i < byIndex.length; i++) {
            if (byIndex[i] == null) {
                continue; // out of sight: not this client's to show
            }
            ConsistComposition.Slot slot = composition.slot(i);
            WagonType type = slot.type();
            int left = CabArea.leftSide(slot.flipped(), facing);
            cars.add(new Car(cars.size(), byIndex[i], i + 1, RollingStockItem.stockName(type.id()),
                    CabArea.passengerSideDoors(type, left), CabArea.passengerSideDoors(type, -left),
                    cabinLights(StockModels.model(type.id()))));
        }
    }

    /** The groups of a model's cabin lamps — the lights inside the car (SPEC §8). */
    private static List<String> cabinLights(StockModel model) {
        List<String> lights = new ArrayList<>();
        if (model == null) {
            return lights;
        }
        for (StockModel.Lamp lamp : model.lamps()) {
            if (lamp.group() >= 0 && lamp.group() < model.lightGroups().size()) {
                String group = model.lightGroups().get(lamp.group());
                if (!lights.contains(group) && lights.size() < CarControlPayload.MAX_GROUPS) {
                    lights.add(group);
                }
            }
        }
        return lights;
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
