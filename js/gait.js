/**
 * Leg phase from distance walked, not from a wall clock.
 * The fold happens after interpolation, so a stride boundary does not
 * reverse the feet. Zero distance keeps the same pose.
 */

export const PED_STRIDE = 0.8;
export const DOG_STRIDE = 0.46;
export const PED_FOOT = 8;
export const DOG_FOOT = 5;

export function gaitPhase(distance, stride) {
  const span = stride > 0 ? stride : 1;
  let wrapped = distance % span;
  if (wrapped < 0) wrapped += span;
  const t = wrapped / span;
  return t < 0.5 ? t * 2 : (1 - t) * 2;
}

export function footOffset(distance, stride, amplitude) {
  const phase = gaitPhase(distance, stride);
  return (phase * 2 - 1) * amplitude;
}

/** Which drawn pose of a short cycle this distance is on. Slot 0 is the start of the stride. */
export function strideSlot(distance, stride, slots) {
  const count = Math.max(1, slots | 0);
  const span = stride > 0 ? stride : 1;
  let wrapped = distance % span;
  if (wrapped < 0) wrapped += span;
  return Math.min(count - 1, Math.floor((wrapped / span) * count));
}

export function gaitOffset(distance, kind, reduced = false) {
  if (reduced) return 0;
  if (kind === "dog") return footOffset(distance, DOG_STRIDE, DOG_FOOT);
  if (kind === "pedestrian") return footOffset(distance, PED_STRIDE, PED_FOOT);
  return 0;
}
