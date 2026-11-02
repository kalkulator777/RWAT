package com.muzhik17.trainsmod.pack;

import java.util.List;
import java.util.Map;

import com.mojang.brigadier.context.CommandContext;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypes;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterClientCommandsEvent;

/**
 * The client's side of the pack report ({@link PackReport#CLIENT}):
 *
 * <ul>
 * <li>{@code /rwatc packs} — the RWAT packs this client loaded as resource
 *     packs and what its loaders found (wagon models and their sounds, rail
 *     styles, models without a type, the model files' check); in a
 *     single-player world the server's part too, since the owner may have no
 *     cheats for {@code /rwat packs};</li>
 * <li>{@code /rwatc packs validate} — load and check every declared model
 *     now ({@link StockModels#checkFiles}), in the background, and report;</li>
 * <li>after each wagon type sync and each resource reload: the models
 *     declared for no type the server sent (fix list D4), to the log and the
 *     report.</li>
 * </ul>
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientPackReport {

    /** The type layer and the model declarations the last model–type check saw. */
    private static Map<String, WagonType> checkedTypes;
    private static Map<String, PackOrigin> checkedModels;
    /** The last server's types, kept by the client until the next sync: not checked against. */
    private static Map<String, WagonType> staleTypes;
    /** What the check logged last: a sync repeating the same set doesn't log it again. */
    private static List<PackProblem> logged = List.of();
    /** A model files' check in flight. */
    private static boolean validating;

    private ClientPackReport() {
    }

    @SubscribeEvent
    static void onRegisterCommands(RegisterClientCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("rwatc")
                .then(Commands.literal("packs")
                        .executes(ClientPackReport::show)
                        .then(Commands.literal("validate").executes(ClientPackReport::validate))));
    }

    private static int show(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        if (Minecraft.getInstance().hasSingleplayerServer()) {
            PackReportView.show(source, PackReport.SERVER, true);
        }
        PackReportView.show(source, PackReport.CLIENT, false);
        if (!PackReport.CLIENT.has(PackReport.Source.MODEL_FILES)) {
            source.sendSuccess(() -> Component.translatable("rwat.packs.validate.hint")
                    .withStyle(ChatFormatting.GRAY), false);
        }
        return 1;
    }

    private static int validate(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        if (validating) {
            source.sendFailure(Component.translatable("rwat.packs.validate.busy"));
            return 0;
        }
        validating = true;
        int count = StockModels.declared();
        source.sendSuccess(() -> Component.translatable("rwat.packs.validate.start", count)
                .withStyle(ChatFormatting.GRAY), false);
        StockModels.checkFiles().whenComplete((check, error) -> Minecraft.getInstance().execute(() -> {
            validating = false;
            if (error != null) {
                RailsWheelsAndTrains.LOGGER.error("Model files check failed", error);
                source.sendFailure(Component.literal(error.toString()));
            } else if (check == null) {
                source.sendFailure(Component.translatable("rwat.packs.validate.stale"));
            } else {
                PackReportView.log(check.problems());
                PackReport.CLIENT.replace(PackReport.Source.MODEL_FILES, check.checked(), check.problems());
                long errors = check.problems().stream().filter(PackProblem::isError).count();
                long warnings = check.problems().size() - errors;
                source.sendSuccess(() -> Component.translatable("rwat.packs.validate.done", count, errors, warnings)
                        .withStyle(errors > 0 ? ChatFormatting.RED
                                : warnings > 0 ? ChatFormatting.YELLOW : ChatFormatting.GREEN), false);
                PackReportView.problems(source, check.problems());
            }
        }));
        return 1;
    }

    /**
     * Models without a type, checked whenever the type layer or the model
     * declarations change (the sync replaces the layer wholesale, a resource
     * reload the declarations): cheap identity checks every tick, the check
     * itself only on a change, and only in a world, against a layer this
     * server sent.
     */
    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        if (Minecraft.getInstance().level == null) {
            return;
        }
        Map<String, WagonType> types = WagonTypes.loadedTypes();
        Map<String, PackOrigin> models = StockModels.origins();
        if (types == staleTypes || types == checkedTypes && models == checkedModels) {
            return;
        }
        checkedTypes = types;
        checkedModels = models;
        // no types at all: no sync yet, or a server without stock — every model would be "without type"
        List<PackProblem> problems = types.isEmpty() ? List.of()
                : PackReport.modelsWithoutType(models, types.keySet());
        if (!problems.equals(logged)) {
            PackReportView.log(problems);
            logged = problems;
        }
        PackReport.CLIENT.replace(PackReport.Source.MODEL_TYPES, Map.of(), problems);
    }

    /** The server's types stay until the next sync: don't hold them against this client's models meanwhile. */
    @SubscribeEvent
    static void onLoggingOut(ClientPlayerNetworkEvent.LoggingOut event) {
        staleTypes = WagonTypes.loadedTypes();
        checkedTypes = null;
        checkedModels = null;
        logged = List.of();
        PackReport.CLIENT.clear(PackReport.Source.MODEL_TYPES);
    }
}
