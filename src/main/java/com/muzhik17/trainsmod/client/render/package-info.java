/**
 * Layer 3 — Rendering (client only).
 *
 * <p>One hardcoded wagon ("box with windows") whose job is to validate the
 * transforms: position/rotation derived from the bogies, slope tilt, correct
 * light sampling. Geometry is an internal data representation, baked and drawn
 * through the modern pipeline (RenderType / VertexConsumer) — not legacy GL, not
 * geometry built by hand in the renderer.
 *
 * <p>Partial-tick rendering uses the interpolated {@code s} from the network
 * layer. Built as if model-packs already exist: a format parser is added later
 * without rewriting the renderer (SPEC §2.4, principle #5).
 */
package com.muzhik17.trainsmod.client.render;
