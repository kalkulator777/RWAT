/**
 * Content packs (SPEC §6): discovery of the {@code rwat_packs/} folder
 * ({@code RwatPacks}) and what is shared by every loader of a pack's files.
 * A pack is a plain Minecraft pack carrying wagon types ({@code data/}) and
 * their models and rail styles ({@code assets/}); the loaders for each half
 * live with their consumers ({@code data.WagonTypeReloadListener},
 * {@code data.RailFootprintReloadListener}, {@code client.render.model}).
 *
 * <p>Shared here, plain Java without MC types so the core parsers and the
 * tests use them: strict JSON reading ({@code PackJson}: unknown keys warn
 * with a hint, {@code null} and wrong types are errors naming the field),
 * the wagon type load ({@code WagonTypeLoader}), the rail style declaration
 * both sides read ({@code RailStyleDecl}), the model files' check
 * ({@code ModelCheck}, its findings by code: {@code ModelFinding}) and the
 * report of every loader's problems by pack and
 * file ({@code PackReport}, one {@code PackProblem} type for all). Shown by
 * {@code PackReportView} ({@code /rwat packs}, the operators' notice) and
 * {@code ClientPackReport} ({@code /rwatc packs [validate]}).
 *
 * <p>Here too: the pack's {@code "rwat"} block and format version
 * ({@code RwatPackMeta}), what a scan found about each pack
 * ({@code RwatPacks.infos()}), and the check of a client's packs against the
 * server's by content hash ({@code PackHasher}, {@code PackManifest},
 * {@code PackSyncEvents}).
 */
package com.muzhik17.trainsmod.pack;
