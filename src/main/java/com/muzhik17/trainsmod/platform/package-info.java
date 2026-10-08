/**
 * Version-isolation facade (SPEC principle #4).
 *
 * <p>Render and version-specific calls are hidden behind our own interfaces from
 * day one. A port to NeoForge 26.x is expected within the year, and the cost of
 * porting is highest for an entity/render-heavy mod — so the version-specific
 * surface is concentrated here rather than scattered across the codebase.
 *
 * <p>Interfaces are added here as real version-specific call sites appear; this
 * package intentionally starts empty rather than with speculative stubs.
 */
package com.muzhik17.trainsmod.platform;
