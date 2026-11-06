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
  let window = 58;
  if (sim.inSlip) window = 100;
  else if (h.type === "cutin") window = 74;
  if (h.dist > window || h.dist < -1) return false;
  if (sim.v <= safe - 0.45) return false;
  if (sim.cargoType && sim.brakeInput >= 0.78 && h.dist > 16 && sim.v < safe + 7) return false;
  return true;
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
};
