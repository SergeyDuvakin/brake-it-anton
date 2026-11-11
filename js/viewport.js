/**
 * Fit the 1600×900 frame in whole CSS pixels inside the box that is actually
 * free for the picture. A one-pixel toolbar twitch must not resize or recenter
 * that frame. A shrink that would clip is applied. The same math is used for
 * every browser; it does not assume that 100vh itself moves.
 */
export function contentBox(clientW, clientH, padding = {}) {
  const top = Math.max(0, Number(padding.top) || 0);
  const right = Math.max(0, Number(padding.right) || 0);
  const bottom = Math.max(0, Number(padding.bottom) || 0);
  const left = Math.max(0, Number(padding.left) || 0);
  return {
    width: Math.max(1, clientW - left - right),
    height: Math.max(1, clientH - top - bottom),
  };
}

/**
 * How many backing pixels per CSS pixel.
 * Never above 2, and 1 when the player asked for less motion.
 * Also never larger than the 1600×900 drawing.
 */
export function backingScale(cssW, cssH, deviceRatio, lowPower, logicalW = 1600, logicalH = 900) {
  const cap = lowPower ? 1 : 2;
  const dpr = Math.min(cap, Math.max(0.5, Number(deviceRatio) || 1));
  const fit = Math.min(logicalW / Math.max(1, cssW), logicalH / Math.max(1, cssH));
  return Math.min(dpr, fit);
}

export function frameSize(viewW, viewH, logicalW = 1600, logicalH = 900) {
  const availW = Math.max(1, Math.floor(viewW));
  const availH = Math.max(1, Math.floor(viewH));
  let width = availW;
  let height = Math.floor((width * logicalH) / logicalW);
  if (height > availH || height < 1) {
    height = availH;
    width = Math.max(1, Math.floor((height * logicalW) / logicalH));
  }
  return { width, height };
}

export function frameOrigin(outerW, outerH, frame) {
  return {
    left: Math.round((outerW - frame.width) / 2),
    top: Math.round((outerH - frame.height) / 2),
  };
}

function smallestPositive(values) {
  let best = 0;
  for (const value of values) {
    const n = Number(value);
    if (n > 0 && (best === 0 || n < best)) best = n;
  }
  return best;
}

/**
 * Overlap of every size that has already updated. A stale portrait height
 * loses to a landscape height from innerHeight, the visual viewport, or the
 * wrap. Zero means that source has not been measured.
 */
export function tightestBox(measures) {
  return {
    width: smallestPositive([measures.innerWidth, measures.visualWidth, measures.wrapWidth]),
    height: smallestPositive([measures.innerHeight, measures.visualHeight, measures.wrapHeight]),
  };
}

/**
 * Move, and if needed shrink, a frame so it lies inside the visible box.
 * The 1600×900 ratio is kept when the frame is larger than the box.
 */
export function clampPlacement(rect, viewW, viewH) {
  const boxW = Math.max(1, Math.floor(viewW));
  const boxH = Math.max(1, Math.floor(viewH));
  let width = Math.round(rect.width);
  let height = Math.round(rect.height);
  if (width > boxW || height > boxH || width < 1 || height < 1) {
    const fitted = frameSize(boxW, boxH);
    width = fitted.width;
    height = fitted.height;
  }
  let left = Math.round(rect.left);
  let top = Math.round(rect.top);
  if (left + width > boxW) left = boxW - width;
  if (top + height > boxH) top = boxH - height;
  if (left < 0) left = 0;
  if (top < 0) top = 0;
  return { width, height, left, top };
}

export function stableFrame(previous, viewW, viewH, slack = 2) {
  const next = frameSize(viewW, viewH);
  if (!previous) return next;
  const fits = previous.width <= next.width && previous.height <= next.height;
  const small = Math.abs(next.width - previous.width) <= slack && Math.abs(next.height - previous.height) <= slack;
  if (fits && small) return { width: previous.width, height: previous.height };
  return next;
}

function rectFits(rect, outerW, outerH) {
  return (
    rect.left >= 0 &&
    rect.top >= 0 &&
    rect.width <= outerW + 0.01 &&
    rect.height <= outerH + 0.01 &&
    rect.left + rect.width <= outerW + 0.01 &&
    rect.top + rect.height <= outerH + 0.01
  );
}

export function stablePlacement(previous, outerW, outerH, slack = 2) {
  const boxW = Math.max(1, Math.floor(outerW));
  const boxH = Math.max(1, Math.floor(outerH));
  const size = stableFrame(previous, boxW, boxH, slack);
  const origin = frameOrigin(boxW, boxH, size);
  const fresh = clampPlacement(
    { width: size.width, height: size.height, left: origin.left, top: origin.top },
    boxW,
    boxH,
  );
  if (!previous || previous.left === undefined || previous.top === undefined) return fresh;
  const sameSize = previous.width === size.width && previous.height === size.height;
  const still =
    Math.abs(origin.left - previous.left) <= 1 && Math.abs(origin.top - previous.top) <= 1;
  // Keep the old origin only while that whole rectangle still sits in the box.
  if (sameSize && still && rectFits(previous, boxW, boxH)) {
    return clampPlacement(previous, boxW, boxH);
  }
  return fresh;
}
