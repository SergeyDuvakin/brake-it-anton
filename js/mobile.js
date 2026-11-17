/**
 * Phone shell. Orientation comes from the viewport media query.
 * The home-screen hint is only for iOS while the game is still in a browser tab.
 */

export const HOME_HINT_KEY = "brake-it-anton-home-hint";

export function isIosDevice(ua, platform, maxTouchPoints) {
  const agent = ua || "";
  if (/iPad|iPhone|iPod/.test(agent)) return true;
  return platform === "MacIntel" && (Number(maxTouchPoints) || 0) > 1;
}

/**
 * Portrait when the media query says so. Width and height are only a
 * fallback for a browser without matchMedia. They are one pair, never a
 * mix of the smallest width and the smallest height.
 */
export function isPortraitOrientation(mediaMatches, width, height) {
  if (typeof mediaMatches === "boolean") return mediaMatches;
  return (Number(height) || 0) > (Number(width) || 0);
}

/**
 * Show the install line on iOS in a browser tab. Standalone (home screen)
 * and a remembered dismissal stay quiet.
 */
export function shouldShowHomeHint({ ios, standalone, displayMode, dismissed }) {
  if (!ios || dismissed) return false;
  if (standalone === true) return false;
  if (displayMode === "standalone" || displayMode === "fullscreen") return false;
  return standalone === false || displayMode === "browser";
}
