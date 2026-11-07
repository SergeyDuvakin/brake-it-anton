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

export function stableFrame(previous, viewW, viewH, slack = 2) {
  const next = frameSize(viewW, viewH);
  if (!previous) return next;
  const fits = previous.width <= next.width && previous.height <= next.height;
  const small = Math.abs(next.width - previous.width) <= slack && Math.abs(next.height - previous.height) <= slack;
  if (fits && small) return { width: previous.width, height: previous.height };
  return next;
}

export function stablePlacement(previous, outerW, outerH, slack = 2) {
  const size = stableFrame(previous, outerW, outerH, slack);
  const origin = frameOrigin(outerW, outerH, size);
  if (!previous || previous.left === undefined || previous.top === undefined) {
    return { width: size.width, height: size.height, left: origin.left, top: origin.top };
  }
  const inside =
    previous.left >= 0 &&
    previous.top >= 0 &&
    previous.left + size.width <= outerW + 0.01 &&
    previous.top + size.height <= outerH + 0.01;
  const still =
    Math.abs(origin.left - previous.left) <= 1 && Math.abs(origin.top - previous.top) <= 1;
  if (inside && still) {
    return { width: size.width, height: size.height, left: previous.left, top: previous.top };
  }
  return { width: size.width, height: size.height, left: origin.left, top: origin.top };
}
