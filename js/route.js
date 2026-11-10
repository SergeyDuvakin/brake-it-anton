/**
 * Six linked sections. The first is straight so the opening hazards stay
 * where the straight-road tests measured them. Later sections bend.
 * The camera looks PREVIEW_LEAD metres ahead, so the next bend is on
 * screen before the car's own heading changes.
 *
 * Physics stays in track metres (s, lateral). Only the picture bends.
 */

export const PREVIEW_LEAD = 18;

export function sectionsFor() {
  return [
    { length: 120, kappa: 0 },
    { length: 70, kappa: 0.013 },
    { length: 80, kappa: 0 },
    { length: 65, kappa: -0.016 },
    { length: 75, kappa: 0.011 },
    { length: 90, kappa: 0 },
  ];
}

const SECTIONS = sectionsFor();
const LOOP = SECTIONS.reduce((sum, section) => sum + section.length, 0);

function kappaOf(s) {
  let u = s % LOOP;
  if (u < 0) u += LOOP;
  for (const section of SECTIONS) {
    if (u <= section.length) return section.kappa;
    u -= section.length;
  }
  return 0;
}

const pts = [{ s: 0, x: 0, y: 0, h: 0 }];

function ensure(s) {
  const step = 1;
  const target = Math.max(0, s) + 2;
  while (pts[pts.length - 1].s < target) {
    const a = pts[pts.length - 1];
    const h = a.h + kappaOf(a.s) * step;
    pts.push({
      s: a.s + step,
      x: a.x + Math.sin(h) * step,
      y: a.y + Math.cos(h) * step,
      h,
    });
  }
}

function sample(s) {
  if (s <= 0) return pts[0];
  ensure(s);
  const i = Math.min(pts.length - 2, Math.floor(s));
  const a = pts[i];
  const b = pts[i + 1];
  const t = s - a.s;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    h: a.h + (b.h - a.h) * t,
  };
}

/** Car heading minus the look heading. Negative: the road ahead has bent right. */
export function routeYaw(camS) {
  const car = sample(camS);
  const look = sample(camS + PREVIEW_LEAD);
  return car.h - look.h;
}

/**
 * Track point → the straight camera's (ds, xm). On the opening straight,
 * before the look point reaches a bend, this is exact.
 */
export function routeLocal(camS, worldS, lateral) {
  const cam = sample(camS);
  const look = sample(camS + PREVIEW_LEAD);
  const point = sample(worldS);
  if (cam.h === 0 && look.h === 0 && point.h === 0 && cam.x === 0 && point.x === 0) {
    return { ds: worldS - camS, xm: lateral };
  }
  const pathH = point.h;
  const px = point.x + Math.cos(pathH) * lateral;
  const py = point.y - Math.sin(pathH) * lateral;
  const dx = px - cam.x;
  const dy = py - cam.y;
  const lookH = look.h;
  return {
    ds: dx * Math.sin(lookH) + dy * Math.cos(lookH),
    xm: dx * Math.cos(lookH) - dy * Math.sin(lookH),
  };
}

export function sectionCount() {
  return SECTIONS.length;
}

export function straightRun() {
  return SECTIONS[0].length;
}
