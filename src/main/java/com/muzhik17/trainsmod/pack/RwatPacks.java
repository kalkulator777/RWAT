package com.muzhik17.trainsmod.pack;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.server.packs.PackLocationInfo;
import net.minecraft.server.packs.PackSelectionConfig;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.repository.FolderRepositorySource;
import net.minecraft.server.packs.repository.Pack;
import net.minecraft.server.packs.repository.PackSource;
import net.minecraft.server.packs.repository.RepositorySource;
import net.minecraft.world.level.validation.DirectoryValidator;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.event.AddPackFindersEvent;

/**
 * Discovery of RWAT content packs (SPEC §6.2): every zip or directory in
 * {@code <gamedir>/rwat_packs/} is one ordinary Minecraft pack registered
 * <b>twice</b> — as a resource pack (models, textures, lang) and as a data
 * pack (wagon type declarations) — and <b>required</b> for both, so it is
 * always on: no resource-pack screen toggle, and worlds (existing ones too)
 * pick the data half up automatically. Drop a pack in, restart, done.
 *
 * <p>Extra folders can be listed in the {@code rwat.packDirs} system property
 * (path-separator separated); the dev runs whose game dir isn't {@code run/}
 * (client2, server) point it at the shared {@code run/rwat_packs}.
 *
 * <p>Each pack's {@code "rwat"} block in {@code pack.mcmeta} is read first
 * ({@link RwatPackMeta}): a pack of a format newer than this RWAT reads, or
 * with a broken format, is not loaded. What each scan found — every pack, its
 * block, its problems, whether it loads — is kept for {@code /rwat packs}
 * ({@link #infos()}); the problems go to the log, once each time they change.
 * {@link #manifest} hashes the loaded packs for the check of a client's packs
 * against the server's ({@link PackManifest}).
 */
public final class RwatPacks {

    /** Folder name under the game directory. */
    public static final String FOLDER = "rwat_packs";

    /** Extra pack folders, {@link File#pathSeparator}-separated. */
    private static final String EXTRA_DIRS_PROPERTY = "rwat.packDirs";

    /** Shown next to the pack in the pack screens; adds itself to worlds automatically. */
    private static final PackSource SOURCE = PackSource.create(
            name -> Component.translatable("pack.nameAndSource", name,
                    Component.literal("RWAT")).withStyle(ChatFormatting.GRAY),
            true);

    /** Always on, above vanilla and mod resources, can be reordered against other packs. */
    private static final PackSelectionConfig SELECTION =
            new PackSelectionConfig(true, Pack.Position.TOP, false);

    /** Symlinks inside packs are not followed (a pack is a plain folder or a zip). */
    private static final DirectoryValidator NO_SYMLINKS = new DirectoryValidator(path -> false);

    /** The last scan of each pack type: the resource packs on a client, the data packs on a server. */
    private static final Map<PackType, List<PackInfo>> SCANS = new ConcurrentHashMap<>();

    /** The problems last logged per pack, so a rescan (F3+T, /reload, the other pack type) doesn't repeat them. */
    private static final Map<Path, List<PackProblem>> LOGGED = new ConcurrentHashMap<>();

    /** Pack hashes, kept by size and time of change. */
    private static final PackHashCache HASHES = new PackHashCache();

    /** Hashing reads whole packs (MVP: ~170 MB): one background thread, never a game thread. */
    private static final ExecutorService HASHING = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "RWAT pack hashing");
        thread.setDaemon(true);
        return thread;
    });

    private RwatPacks() {
    }

    /** Mod-bus listener: fires once per pack type (client resources, server data). */
    public static void onAddPackFinders(AddPackFindersEvent event) {
        event.addRepositorySource(new Source(event.getPackType()));
    }

    /**
     * The RWAT packs the last scan found, loaded or not, in load order: the
     * data-pack scan where there was one (what the server loads — what
     * {@code /rwat packs} shows), else the resource-pack scan (a client that
     * hasn't opened a world). Empty before the first scan.
     */
    public static List<PackInfo> infos() {
        List<PackInfo> data = SCANS.get(PackType.SERVER_DATA);
        return data != null ? data : infos(PackType.CLIENT_RESOURCES);
    }

    /** The RWAT packs the last scan of that pack type found, loaded or not. */
    public static List<PackInfo> infos(PackType type) {
        return SCANS.getOrDefault(type, List.of());
    }

    /**
     * The loaded packs of the last scan of that pack type with their content
     * hashes, worked out on a background thread (a pack unchanged since its
     * last hash isn't read again). A pack that can't be read is left out,
     * with an error in the log; at most {@link PackManifest#MAX_PACKS}.
     */
    public static CompletableFuture<List<PackManifest.Entry>> manifest(PackType type) {
        List<PackInfo> loaded = infos(type).stream().filter(PackInfo::loaded).toList();
        return CompletableFuture.supplyAsync(() -> {
            List<PackManifest.Entry> entries = new ArrayList<>();
            for (PackInfo info : loaded) {
                if (entries.size() == PackManifest.MAX_PACKS) {
                    RailsWheelsAndTrains.LOGGER.warn("More than {} RWAT packs: only the first {} are checked "
                            + "against the other side's", PackManifest.MAX_PACKS, PackManifest.MAX_PACKS);
                    break;
                }
                try {
                    long start = System.nanoTime();
                    int read = HASHES.computed();
                    String hash = HASHES.hash(info.path());
                    RailsWheelsAndTrains.LOGGER.debug("RWAT pack {}: hash {} ({} in {} ms)", info.fileName(), hash,
                            HASHES.computed() != read ? "read" : "unchanged, from the cache",
                            (System.nanoTime() - start) / 1_000_000L);
                    entries.add(info.manifestEntry(hash));
                } catch (IOException | RuntimeException e) {
                    RailsWheelsAndTrains.LOGGER.error("RWAT pack {} ({}): can't hash it for the pack check: {}",
                            info.fileName(), info.path(), e.toString());
                }
            }
            return List.copyOf(entries);
        }, HASHING);
    }

    /** Every folder packs are read from: the game dir's one first, then the extras. */
    static Set<Path> folders() {
        Set<Path> folders = new LinkedHashSet<>();
        folders.add(FMLPaths.GAMEDIR.get().resolve(FOLDER).toAbsolutePath().normalize());
        String extra = System.getProperty(EXTRA_DIRS_PROPERTY, "");
        for (String entry : extra.split(File.pathSeparator)) {
            if (!entry.isBlank()) {
                folders.add(Path.of(entry.trim()).toAbsolutePath().normalize());
            }
        }
        return folders;
    }

    /**
     * Logs a pack's problems — warnings as warnings, errors as errors with the
     * pack's path and that it isn't loaded — unless they are what was logged
     * for it last time.
     */
    private static void report(String name, Path path, List<PackProblem> problems) {
        if (problems.equals(LOGGED.put(path, problems))) {
            return;
        }
        for (PackProblem problem : problems) {
            if (problem.isError()) {
                RailsWheelsAndTrains.LOGGER.error("RWAT pack {} ({}): {}; the pack is not loaded",
                        name, path, problem.message());
            } else {
                RailsWheelsAndTrains.LOGGER.warn("RWAT pack {}: {}", name, problem.message());
            }
        }
    }

    /** Scans the pack folders anew on every repository reload (pack screen open, /reload). */
    private record Source(PackType type) implements RepositorySource {

        @Override
        public void loadPacks(Consumer<Pack> onLoad) {
            Map<String, Path> seen = new HashMap<>();
            List<PackInfo> infos = new ArrayList<>();
            for (Path folder : folders()) {
                try {
                    Files.createDirectories(folder);
                    FolderRepositorySource.discoverPacks(folder, NO_SYMLINKS, (path, resources) -> {
                        String name = path.getFileName().toString();
                        String id = PackInfo.idOf(name);
                        Path first = seen.putIfAbsent(name, path);
                        if (first != null) {
                            List<PackProblem> problems = List.of(PackProblem.error(id, path.toString(),
                                    "a pack of the same name was found first, in " + first));
                            report(name, path, problems);
                            infos.add(new PackInfo(name, path, null, problems, false));
                            return;
                        }
                        RwatPackMeta.Result meta = RwatPackMeta.read(path, id);
                        List<PackProblem> problems = new ArrayList<>(meta.problems());
                        Pack pack = null;
                        if (meta.accepted()) {
                            PackLocationInfo info = new PackLocationInfo(
                                    id, Component.literal(name), SOURCE, Optional.empty());
                            pack = Pack.readMetaAndCreate(info, resources, type, SELECTION);
                            if (pack == null) {
                                problems.add(PackProblem.error(id, RwatPackMeta.MCMETA,
                                        "Minecraft can't read its \"pack\" section"));
                            }
                        }
                        report(name, path, problems);
                        infos.add(new PackInfo(name, path, meta.meta(), problems, pack != null));
                        if (pack != null) {
                            onLoad.accept(pack);
                        }
                    });
                } catch (IOException e) {
                    RailsWheelsAndTrains.LOGGER.warn("Failed to list RWAT packs in {}", folder, e);
                }
            }
            SCANS.put(type, List.copyOf(infos));
        }
    }
}
