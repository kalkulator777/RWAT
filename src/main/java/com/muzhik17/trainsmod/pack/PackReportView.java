package com.muzhik17.trainsmod.pack;

import java.util.List;
import java.util.Map;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.packs.PackType;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

/**
 * How a {@link PackReport} is shown: in the log as the loaders find the
 * problems, in chat for {@code /rwat packs} (server) and {@code /rwatc packs}
 * (client) together with the RWAT packs that side's scan found
 * ({@link RwatPacks#infos(PackType)}), and as one line to an operator joining
 * a server whose packs have errors. The fixed text is translated ({@code rwat.packs.*}); the problems
 * themselves are the loaders' English, as in the log.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class PackReportView {

    /** Problems listed in chat at most, per report: the rest are in the log. */
    private static final int MAX_LINES = 40;

    private PackReportView() {
    }

    /** What went wrong, for a problem's message: the exception's message, or the exception if it has none. */
    public static String reason(Throwable e) {
        return e.getMessage() != null ? e.getMessage() : e.toString();
    }

    /** Log each problem: errors as errors, warnings as warnings. */
    public static void log(List<PackProblem> problems) {
        for (PackProblem problem : problems) {
            if (problem.isError()) {
                RailsWheelsAndTrains.LOGGER.error("Pack {}, {}: {}", problem.pack(), problem.file(), problem.message());
            } else {
                RailsWheelsAndTrains.LOGGER.warn("Pack {}, {}: {}", problem.pack(), problem.file(), problem.message());
            }
        }
    }

    /**
     * The report in chat: the packs and what each loaded, the RWAT packs that
     * side's scan found ({@link #rwatPacks}), then the counts and the
     * problems, errors first.
     *
     * @param server true for the server's report (the title says which side)
     */
    public static void show(CommandSourceStack source, PackReport report, boolean server) {
        source.sendSuccess(() -> Component.translatable(server ? "rwat.packs.title.server" : "rwat.packs.title.client")
                .withStyle(ChatFormatting.GOLD), false);
        Map<String, Map<PackReport.Source, Integer>> loaded = report.loaded();
        if (report.packs().isEmpty()) {
            source.sendSuccess(() -> Component.translatable("rwat.packs.none").withStyle(ChatFormatting.GRAY), false);
        }
        for (String pack : report.packs()) {
            MutableComponent line = Component.literal("  " + pack);
            Map<PackReport.Source, Integer> counts = loaded.getOrDefault(pack, Map.of());
            boolean first = true;
            for (Map.Entry<PackReport.Source, Integer> count : counts.entrySet()) {
                line.append(Component.literal(first ? " — " : ", "))
                        .append(Component.translatable("rwat.packs.count." + count.getKey().key, count.getValue()));
                first = false;
            }
            source.sendSuccess(() -> line, false);
        }
        rwatPacks(source, server ? PackType.SERVER_DATA : PackType.CLIENT_RESOURCES);
        int errors = report.errors();
        int warnings = report.warnings();
        if (errors == 0 && warnings == 0) {
            source.sendSuccess(() -> Component.translatable("rwat.packs.clean").withStyle(ChatFormatting.GREEN), false);
            return;
        }
        source.sendSuccess(() -> Component.translatable("rwat.packs.summary", errors, warnings)
                .withStyle(errors > 0 ? ChatFormatting.RED : ChatFormatting.YELLOW), false);
        problems(source, report.problems());
    }

    /**
     * The RWAT packs the last scan of that pack type found, one line each:
     * the folder or zip, {@code rwat.name} and {@code version}, the format,
     * loaded or not, the short content hash and how many problems the scan
     * found (they are listed with the rest of the report). Nothing if the
     * scan found none. A hash not worked out yet is not waited for: the
     * hashing is started in the background and the next listing shows it.
     */
    private static void rwatPacks(CommandSourceStack source, PackType type) {
        List<PackInfo> infos = RwatPacks.infos(type);
        if (infos.isEmpty()) {
            return;
        }
        source.sendSuccess(() -> Component.translatable("rwat.packs.rwat.title").withStyle(ChatFormatting.GOLD), false);
        boolean hashing = false;
        for (PackInfo info : infos) {
            MutableComponent line = Component.literal("  " + info.fileName());
            String label = info.label();
            if (label != null) {
                line.append(Component.literal(" — " + label));
            }
            if (info.meta() != null) {
                line.append(", ").append(Component.translatable("rwat.packs.rwat.format", info.meta().format()));
            }
            line.append(", ").append(info.loaded()
                    ? Component.translatable("rwat.packs.rwat.loaded").withStyle(ChatFormatting.GREEN)
                    : Component.translatable("rwat.packs.rwat.not_loaded").withStyle(ChatFormatting.RED));
            if (info.loaded()) {
                String hash = RwatPacks.knownHash(info);
                hashing |= hash == null;
                MutableComponent shown = hash != null
                        ? Component.translatable("rwat.packs.rwat.hash", PackManifest.shortHash(hash))
                        : Component.translatable("rwat.packs.rwat.hash_pending");
                line.append(", ").append(shown.withStyle(ChatFormatting.GRAY));
            }
            if (!info.problems().isEmpty()) {
                line.append(", ").append(Component.translatable("rwat.packs.rwat.problems",
                        info.errors(), info.warnings())
                        .withStyle(info.hasErrors() ? ChatFormatting.RED : ChatFormatting.YELLOW));
            }
            source.sendSuccess(() -> line, false);
        }
        if (hashing) {
            RwatPacks.manifest(type);
            source.sendSuccess(() -> Component.translatable("rwat.packs.rwat.hashing")
                    .withStyle(ChatFormatting.GRAY), false);
        }
    }

    /** The problems in chat, errors first, at most {@link #MAX_LINES} of them. */
    public static void problems(CommandSourceStack source, List<PackProblem> problems) {
        for (int i = 0; i < Math.min(problems.size(), MAX_LINES); i++) {
            Component line = line(problems.get(i));
            source.sendSuccess(() -> line, false);
        }
        if (problems.size() > MAX_LINES) {
            source.sendSuccess(() -> Component.translatable("rwat.packs.more", problems.size() - MAX_LINES)
                    .withStyle(ChatFormatting.GRAY), false);
        }
    }

    /** {@code ✖ pack file: message}, red for an error, yellow for a warning. */
    private static Component line(PackProblem problem) {
        return Component.literal(problem.isError() ? "✖ " : "⚠ ")
                .withStyle(problem.isError() ? ChatFormatting.RED : ChatFormatting.YELLOW)
                .append(Component.literal(problem.pack() + " " + problem.file() + ": ").withStyle(ChatFormatting.GRAY))
                .append(Component.literal(problem.message()).withStyle(ChatFormatting.WHITE));
    }

    /**
     * One line to an operator joining a server whose packs have errors —
     * the owner of a single-player world counts, cheats or not, and is
     * pointed at {@code /rwatc packs}, which there shows the server's part
     * too and needs no cheats.
     */
    @SubscribeEvent
    static void onPlayerLoggedIn(PlayerEvent.PlayerLoggedInEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) {
            return;
        }
        boolean owner = player.server.isSingleplayerOwner(player.getGameProfile());
        int errors = PackReport.SERVER.errors();
        if (errors == 0 || !owner && !player.hasPermissions(Commands.LEVEL_GAMEMASTERS)) {
            return;
        }
        player.sendSystemMessage(Component.translatable("rwat.packs.join", errors,
                owner ? "/rwatc packs" : "/rwat packs").withStyle(ChatFormatting.RED));
    }
}
