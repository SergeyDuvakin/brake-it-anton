/**
 * Fit the 1600×900 frame in whole CSS pixels.
 * Mobile browser toolbars change the visual height by a pixel or two;
 * sizes inside `slack` stay put so the canvas does not bob in the letterbox.
 * The same math is used for Safari and Chrome.
 */
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

export function stableFrame(previous, viewW, viewH, slack = 2) {
  const next = frameSize(viewW, viewH);
  if (!previous) return next;
  if (Math.abs(next.width - previous.width) <= slack && Math.abs(next.height - previous.height) <= slack) {
    return previous;
  }
  return next;
}
