import { safeSpeed } from "./physics.js";
import { nextHazard } from "./sim.js";

/** Let Anton drive. Correct on trust hazards, fatal on a person in the lane. */
export function policyNever() {
  return false;
}

/** Pin the pedal. Stops the car; does not dose anything. */
export function policyAlways() {
  return true;
}

/**
 * Brake only for hazards Anton will not handle, and feather the pedal on
 * cargo trips so a full press is rare unless speed is still high.
 */
export function policyCareful(sim) {
  const h = nextHazard(sim);
  if (!h || h.trust) return false;
  const safe = safeSpeed(h.type);
  const slip =
    sim.inSlip ||
    (sim.slippery || []).some((z) => h.s > z.s0 - 8 && h.s < z.s1 + 4);
  let window = 36;
  if (slip) window = 78;
  else if (h.type === "cutin") window = 52;
  else if (h.type === "pedestrian") window = 30;
  else if (h.type === "roller") window = 34;
  if (h.dist > window || h.dist < -1) return false;
  if ((h.type === "pedestrian" || h.type === "cutin") && h.crossDur && h.crossT >= h.crossDur) return false;

  if (h.type === "pedestrian" || h.type === "cutin") {
    if (h.crossT >= (h.crossDur || 9)) return false;
    // Stay under the safe speed. At a crawl, full pedal is below the cargo
    // decel threshold, so holding here does not mash the cake.
    return sim.v > safe - (slip ? 0.7 : 0.2);
  }
  if (h.type === "bin" || h.type === "roller") return sim.v > safe - 1.6;
  return sim.v > safe - 0.4;
}

/**
 * Brake to a stop for anything Anton will not handle, then wait.
 * Trust hazards are left to him.
 */
export function policyYield(sim) {
  const h = nextHazard(sim);
  if (!h || h.trust) return false;
  if (h.dist > 40 || h.dist < -1) return false;
  if ((h.type === "pedestrian" || h.type === "cutin") && h.crossT >= (h.crossDur || 9)) return false;
  if (h.type === "bin" && sim.v < safeSpeed("bin") - 1.2) return false;
  if ((h.type === "pedestrian" || h.type === "cutin") && h.crossT < 0 && sim.v < 4 && h.dist > 13) return false;
  return sim.v > 1.2;
}

/**
 * A firm press while a trust hazard is still a choice, then release.
 * That is the mistake: Anton cancels the avoid and surges in-lane.
 */
export function policyProvoke(sim) {
  const h = nextHazard(sim);
  if (!h) return false;
  return h.dist < 52 && h.dist > 44;
}

/** Repeated full jabs once the car is moving. Ruins cake and fish. */
export function policyPanic(sim) {
  if (sim.v < 9 && sim.brakeInput < 0.4) return false;
  return sim.t % 0.62 < 0.2;
}

export const POLICIES = {
  never: policyNever,
  always: policyAlways,
  careful: policyCareful,
  provoke: policyProvoke,
  panic: policyPanic,
  yield: policyYield,
};
