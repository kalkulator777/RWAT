package com.muzhik17.trainsmod.debug;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.gui.RailStyleScreen;
import com.muzhik17.trainsmod.client.gui.StockPickerScreen;
import com.muzhik17.trainsmod.consist.RollingStockItem;
import com.muzhik17.trainsmod.stock.ConsistComposition;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.world.InteractionHand;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;

/**
 * Dev tool: screenshots of the item pickers without anyone at the keyboard
 * (debug, SPEC §2.4a) — so a screen change can be looked at from an automated
 * run. With the system property {@code rwat.autoshot} set ({@code ./gradlew
 * runClient -PquickPlay=<world> -Pautoshot=<what>}), once in a world the
 * client opens the picker and saves {@code screenshots/rwat-autoshot-1.png}
 * and {@code -2.png} a moment apart (the turntable has turned between them).
 * {@code <what>}: {@code stock:<type>[@<livery>]} or {@code rail:<style>}
 * ({@code rail:} alone = the mod's own rail). Off unless the property is set.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientAutoShot {

    private static final String PROPERTY = "rwat.autoshot";
    /** Ticks in the world before the picker opens (chunks and packs settle). */
    private static final int OPEN_AT = 100;
    /** Ticks after opening for each shot (the stock model loads in the background meanwhile). */
    private static final int[] SHOTS_AT = {OPEN_AT + 80, OPEN_AT + 120};

    private static int ticks;

    private ClientAutoShot() {
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        String what = System.getProperty(PROPERTY);
        Minecraft mc = Minecraft.getInstance();
        if (what == null || mc.player == null || ticks > SHOTS_AT[SHOTS_AT.length - 1]) {
            return;
        }
        ticks++;
        if (ticks == OPEN_AT) {
            mc.setScreen(screenFor(what));
        }
        for (int i = 0; i < SHOTS_AT.length; i++) {
            if (ticks == SHOTS_AT[i]) {
                Screenshot.grab(mc.gameDirectory, "rwat-autoshot-" + (i + 1) + ".png",
                        mc.getMainRenderTarget(),
                        message -> RailsWheelsAndTrains.LOGGER.info("[autoshot] {}", message.getString()));
            }
        }
    }

    private static Screen screenFor(String what) {
        if (what.startsWith("rail:")) {
            return new RailStyleScreen(InteractionHand.MAIN_HAND, what.substring("rail:".length()));
        }
        String spec = what.startsWith("stock:") ? what.substring("stock:".length()) : what;
        int at = spec.indexOf('@');
        String type = at >= 0 ? spec.substring(0, at) : spec;
        String livery = at >= 0 ? spec.substring(at + 1) : ConsistComposition.Slot.BASE_LIVERY;
        return new StockPickerScreen(InteractionHand.MAIN_HAND, new RollingStockItem.Selection(type, livery));
    }
}
