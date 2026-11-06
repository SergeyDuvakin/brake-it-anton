/** Map a viewport to the 1600×900 logical frame. Never stretch, never crop. */
export function letterboxRect(viewW, viewH, logicalW = 1600, logicalH = 900) {
  const scale = Math.min(viewW / logicalW, viewH / logicalH);
  const width = logicalW * scale;
  const height = logicalH * scale;
  return {
    left: (viewW - width) / 2,
    top: (viewH - height) / 2,
    width,
    height,
    scale,
  };
}

/** Inverse of the letterbox: CSS/client pixels → logical 1600×900. */
export function logicalPoint(clientX, clientY, rect, logicalW = 1600, logicalH = 900) {
  return {
    x: (clientX - rect.left) * (logicalW / rect.width),
    y: (clientY - rect.top) * (logicalH / rect.height),
  };
}

export function pointInRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
