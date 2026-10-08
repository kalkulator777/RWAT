/**
 * Layer 2 — Kinematics.
 *
 * <p>A wagon is a body on <b>two</b> bogies (never one — a one-point model is a
 * minecart and is thrown away wholesale). Each bogie is a point on the spline at
 * its own distance: lead at {@code s}, rear at {@code s − wheelbase}.
 *
 * <p>The body does not move on its own: its position is the midpoint between the
 * bogies and its orientation (yaw + pitch) follows the vector between them — so
 * cornering and slope tilt come for free. Moving the consist = advancing the
 * head's {@code s}; everything else is derived (SPEC §2.3).
 *
 * <p>v0 driver control: vanilla passenger seating, forward/back keys set a target
 * speed with simple smoothing. No HUD, no GUI.
 */
package com.muzhik17.trainsmod.kinematics;
