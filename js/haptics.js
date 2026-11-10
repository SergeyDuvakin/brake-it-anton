/**
 * Short pulses only. A pattern is a finite list of milliseconds.
 * Nothing here loops, and every call cancels whatever was still buzzing.
 */

export function vibrationPattern(kind) {
  if (kind === "hard") return [26, 36, 32];
  return [16];
}

export function pulse(kind, enabled) {
  if (!enabled) return false;
  const nav = globalThis.navigator;
  if (!nav || typeof nav.vibrate !== "function") return false;
  const pattern = vibrationPattern(kind);
  try {
    nav.vibrate(0);
    return nav.vibrate(pattern) !== false;
  } catch {
    return false;
  }
}
