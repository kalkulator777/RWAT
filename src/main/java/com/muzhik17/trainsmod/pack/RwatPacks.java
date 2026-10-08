package com.muzhik17.trainsmod.pack;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
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

    private RwatPacks() {
    }

    /** Mod-bus listener: fires once per pack type (client resources, server data). */
    public static void onAddPackFinders(AddPackFindersEvent event) {
        event.addRepositorySource(new Source(event.getPackType()));
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

    /** Scans the pack folders anew on every repository reload (pack screen open, /reload). */
    private record Source(PackType type) implements RepositorySource {

        @Override
        public void loadPacks(Consumer<Pack> onLoad) {
            Set<String> seen = new LinkedHashSet<>();
            for (Path folder : folders()) {
                try {
                    Files.createDirectories(folder);
                    FolderRepositorySource.discoverPacks(folder, NO_SYMLINKS, (path, resources) -> {
                        String name = path.getFileName().toString();
                        if (!seen.add(name)) {
                            RailsWheelsAndTrains.LOGGER.warn(
                                    "RWAT pack {} found twice, keeping the first one", path);
                            return;
                        }
                        PackLocationInfo info = new PackLocationInfo(
                                "rwat/" + name, Component.literal(name), SOURCE, Optional.empty());
                        Pack pack = Pack.readMetaAndCreate(info, resources, type, SELECTION);
                        if (pack != null) {
                            onLoad.accept(pack);
                        } else {
                            RailsWheelsAndTrains.LOGGER.warn(
                                    "Skipping RWAT pack {}: no readable pack.mcmeta", path);
                        }
                    });
                } catch (IOException e) {
                    RailsWheelsAndTrains.LOGGER.warn("Failed to list RWAT packs in {}", folder, e);
                }
            }
        }
    }
}
