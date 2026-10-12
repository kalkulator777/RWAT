package com.muzhik17.trainsmod;

import java.util.Collections;
import java.util.EnumMap;
import java.util.Map;

import org.slf4j.Logger;

import com.mojang.logging.LogUtils;
import com.mojang.serialization.Codec;

import com.muzhik17.trainsmod.consist.CrowbarItem;
import com.muzhik17.trainsmod.consist.DriverKeyItem;
import com.muzhik17.trainsmod.consist.RollingStockItem;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.network.RwatNetwork;
import com.muzhik17.trainsmod.pack.RwatPacks;
import com.muzhik17.trainsmod.rail.BedMaterial;
import com.muzhik17.trainsmod.rail.RailItem;
import com.muzhik17.trainsmod.rail.RailMarkerBlock;
import com.muzhik17.trainsmod.rail.RailSwitchMarkerBlock;
import com.muzhik17.trainsmod.rail.TrackBedBlock;

import net.minecraft.core.component.DataComponentType;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import net.neoforged.fml.ModContainer;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * Main mod entry point. Loaded on both physical sides.
 *
 * <p>The mod id ({@link #MODID}) stays {@code railswheelsandtrains} — it is the
 * registry/asset namespace and is independent of the Java package
 * ({@code com.muzhik17.trainsmod}).
 *
 * <p>This class only owns cross-cutting infrastructure: the logger and the
 * {@link DeferredRegister} backbone. Actual content lives in the per-layer
 * packages (see {@code package-info.java} of each).
 */
@Mod(RailsWheelsAndTrains.MODID)
public class RailsWheelsAndTrains {
    /** Registry/asset namespace for everything this mod registers. */
    public static final String MODID = "railswheelsandtrains";

    public static final Logger LOGGER = LogUtils.getLogger();

    // --- Registration backbone. Empty for now; populated as each layer lands. ---
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(MODID);
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MODID);
    public static final DeferredRegister<EntityType<?>> ENTITY_TYPES = DeferredRegister.create(Registries.ENTITY_TYPE, MODID);
    public static final DeferredRegister<CreativeModeTab> CREATIVE_MODE_TABS = DeferredRegister.create(Registries.CREATIVE_MODE_TAB, MODID);
    public static final DeferredRegister.DataComponents DATA_COMPONENTS =
            DeferredRegister.createDataComponents(Registries.DATA_COMPONENT_TYPE, MODID);

    /** The rail style a rails item builds with (SPEC §6.10); absent = the mod's own rail. */
    public static final DeferredHolder<DataComponentType<?>, DataComponentType<String>> RAIL_STYLE =
            DATA_COMPONENTS.registerComponentType("rail_style", builder -> builder
                    .persistent(Codec.STRING)
                    .networkSynchronized(ByteBufCodecs.STRING_UTF8));

    /** The bed material a rails item lays (SPEC §2.2, {@link BedMaterial} id); absent = gravel. */
    public static final DeferredHolder<DataComponentType<?>, DataComponentType<String>> RAIL_BED =
            DATA_COMPONENTS.registerComponentType("rail_bed", builder -> builder
                    .persistent(Codec.STRING)
                    .networkSynchronized(ByteBufCodecs.STRING_UTF8));

    /** The wagon type + livery a rolling stock item places (SPEC §6.11); absent = nothing chosen yet. */
    public static final DeferredHolder<DataComponentType<?>, DataComponentType<RollingStockItem.Selection>> STOCK_SELECTION =
            DATA_COMPONENTS.registerComponentType("stock_selection", builder -> builder
                    .persistent(RollingStockItem.Selection.CODEC)
                    .networkSynchronized(RollingStockItem.Selection.STREAM_CODEC));

    /**
     * The wagon entity (SPEC §2.1, 0.2: consist is logical, the wagon is the
     * Entity). The client derives the position from interpolated {@code s},
     * not from vanilla move packets ({@code lerpTo} is a no-op) — but the
     * update interval must stay <b>finite</b>: the entity <i>spawn</i> packet
     * places the entity at the last vanilla-<i>sent</i> position
     * ({@code ServerEntity}'s codec base), which refreshes only on this
     * interval. {@code Integer.MAX_VALUE} froze that base at tracking-start,
     * so an observer re-entering range got the wagon spawned at a stale,
     * possibly client-unloaded spot — where it never ticks, so our pose
     * system never picks it up: invisible forever (the big-circle playtest
     * bug). 10 ticks keeps the spawn base ≤0.5 s stale for a few bytes per
     * wagon per second; the client still ignores the move packets themselves.
     */
    public static final DeferredHolder<EntityType<?>, EntityType<WagonEntity>> WAGON_ENTITY =
            ENTITY_TYPES.register("wagon", () -> EntityType.Builder
                    .<WagonEntity>of(WagonEntity::new, MobCategory.MISC)
                    .sized(1.5F, 1.5F)
                    .passengerAttachments(1.0F)
                    .clientTrackingRange(10)
                    .updateInterval(10)
                    .build(MODID + ":wagon"));

    /** Track bed: the rails' collision block (SPEC §2.2, 0.3), a block per bed material. */
    public static final Map<BedMaterial, DeferredBlock<TrackBedBlock>> TRACK_BEDS = registerTrackBeds();

    /** The gravel bed — the only one before bed materials, still under the plain name. */
    public static final DeferredBlock<TrackBedBlock> TRACK_BED = TRACK_BEDS.get(BedMaterial.GRAVEL);

    public static final DeferredItem<BlockItem> TRACK_BED_ITEM =
            ITEMS.registerSimpleBlockItem("track_bed", TRACK_BED);

    /** Rail marker: one end of a future segment, direction from the placer's look (SPEC §2.2 UX). */
    public static final DeferredBlock<RailMarkerBlock> RAIL_MARKER = BLOCKS.registerBlock("rail_marker",
            RailMarkerBlock::new, BlockBehaviour.Properties.of()
                    .mapColor(MapColor.METAL)
                    .strength(0.5F)
                    .sound(SoundType.METAL)
                    .noOcclusion());

    public static final DeferredItem<BlockItem> RAIL_MARKER_ITEM =
            ITEMS.registerSimpleBlockItem("rail_marker", RAIL_MARKER);

    /** Switch marker: the toe of a Y-switch or one corner of a diamond crossing (SPEC §2.2 UX). */
    public static final DeferredBlock<RailSwitchMarkerBlock> RAIL_SWITCH_MARKER =
            BLOCKS.registerBlock("rail_switch_marker",
                    RailSwitchMarkerBlock::new, BlockBehaviour.Properties.of()
                            .mapColor(MapColor.GOLD)
                            .strength(0.5F)
                            .sound(SoundType.METAL)
                            .noOcclusion());

    public static final DeferredItem<BlockItem> RAIL_SWITCH_MARKER_ITEM =
            ITEMS.registerSimpleBlockItem("rail_switch_marker", RAIL_SWITCH_MARKER);

    /** The rails: connects two markers into a segment (SPEC §2.2 UX). */
    public static final DeferredItem<RailItem> RAIL_ITEM =
            ITEMS.registerItem("rail", RailItem::new, new Item.Properties());

    /** Rolling stock: choose a wagon type from the packs, place it on the rails (SPEC §6.11). */
    public static final DeferredItem<RollingStockItem> ROLLING_STOCK_ITEM =
            ITEMS.registerItem("rolling_stock", RollingStockItem::new, new Item.Properties());

    /** The crowbar: uncouples a consist at the coupler it is used on (SPEC §6.12). */
    public static final DeferredItem<CrowbarItem> CROWBAR =
            ITEMS.registerItem("crowbar", CrowbarItem::new, new Item.Properties().stacksTo(1));

    /** The driver's key: opens the cabs when the server locks them (SPEC §9.2, {@code cab_access}). */
    public static final DeferredItem<DriverKeyItem> DRIVER_KEY =
            ITEMS.registerItem("driver_key", DriverKeyItem::new, new Item.Properties().stacksTo(1));

    /** The mod's creative tab. Contents are added as content is registered. */
    public static final DeferredHolder<CreativeModeTab, CreativeModeTab> TRAINS_TAB = CREATIVE_MODE_TABS.register("trains_tab",
            () -> CreativeModeTab.builder()
                    .title(Component.translatable("itemGroup." + MODID))
                    .icon(() -> Items.MINECART.getDefaultInstance())
                    .displayItems((parameters, output) -> {
                        output.accept(RAIL_MARKER_ITEM.get());
                        output.accept(RAIL_SWITCH_MARKER_ITEM.get());
                        output.accept(RAIL_ITEM.get());
                        output.accept(TRACK_BED_ITEM.get());
                        output.accept(ROLLING_STOCK_ITEM.get());
                        output.accept(CROWBAR.get());
                        output.accept(DRIVER_KEY.get());
                    })
                    .build());

    private static Map<BedMaterial, DeferredBlock<TrackBedBlock>> registerTrackBeds() {
        Map<BedMaterial, DeferredBlock<TrackBedBlock>> beds = new EnumMap<>(BedMaterial.class);
        for (BedMaterial material : BedMaterial.values()) {
            beds.put(material, BLOCKS.registerBlock(material.blockName(),
                    properties -> new TrackBedBlock(properties, material), material.properties()));
        }
        return Collections.unmodifiableMap(beds);
    }

    /** The bed block of a material, for laying. */
    public static TrackBedBlock trackBed(BedMaterial material) {
        return TRACK_BEDS.get(material).get();
    }

    // FML passes IEventBus / ModContainer in automatically by parameter type.
    public RailsWheelsAndTrains(IEventBus modEventBus, ModContainer modContainer) {
        BLOCKS.register(modEventBus);
        ITEMS.register(modEventBus);
        ENTITY_TYPES.register(modEventBus);
        CREATIVE_MODE_TABS.register(modEventBus);
        DATA_COMPONENTS.register(modEventBus);
        ServerConfig.register(modContainer);

        modEventBus.addListener(this::commonSetup);
        modEventBus.addListener(RwatNetwork::register);
        modEventBus.addListener(RwatPacks::onAddPackFinders);
    }

    private void commonSetup(FMLCommonSetupEvent event) {
        LOGGER.info("Rails, Wheels & Trains: common setup");
    }
}
