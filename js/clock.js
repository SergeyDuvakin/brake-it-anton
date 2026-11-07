/**
 * The picture is drawn on the display refresh. The drive always steps at 1/60.
 * One animation frame never donates more than 0.1s of wall time, so a stall
 * cannot fast-forward the ride.
 */
export function drainFrame(acc, elapsedSeconds, timeScale = 1) {
  const raw = Math.min(0.1, elapsedSeconds);
  let next = acc + raw * timeScale;
  const cap = timeScale > 1 ? 48 : 8;
  let steps = 0;
  while (next >= 1 / 60 && steps < cap) {
    next -= 1 / 60;
    steps += 1;
  }
  return { acc: next, steps, raw };
}
