/** Shown on the title screen only while the game is still a Safari tab. */
export const HOME_HINT_DELAY_MS = 4000;

/**
 * `navigator.standalone === false` is an iPhone/iPad Safari tab.
 * A home-screen launch sets it true, and WebKit also reports
 * display-mode standalone when a manifest asked for fullscreen.
 * Other browsers leave `standalone` undefined, so they never see this hint.
 */
export function isSafariBrowserTab(standalone, displayMode) {
  if (standalone !== false) return false;
  if (displayMode === "standalone" || displayMode === "fullscreen") return false;
  return true;
}

export function homeHintVisible({ screen, standalone, displayMode, portrait, elapsedMs }) {
  if (screen !== "title") return false;
  if (portrait) return false;
  if (!isSafariBrowserTab(standalone, displayMode)) return false;
  return elapsedMs >= HOME_HINT_DELAY_MS;
}
