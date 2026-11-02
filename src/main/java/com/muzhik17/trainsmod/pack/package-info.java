/**
 * Content packs (SPEC §6): discovery of the {@code rwat_packs/} folder.
 * A pack is a plain Minecraft pack carrying wagon types ({@code data/}) and
 * their models ({@code assets/}); the loaders for each half live with their
 * consumers ({@code data.WagonTypeReloadListener}, {@code client.render.model}).
 *
 * <p>Here too: the pack's {@code "rwat"} block and format version
 * ({@code RwatPackMeta}) and what a scan found about each pack
 * ({@code RwatPacks.infos()}). The classes without Minecraft imports are
 * unit-tested.
 */
package com.muzhik17.trainsmod.pack;
