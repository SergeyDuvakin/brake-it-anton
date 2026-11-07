/**
 * The picture's ground is the hitbox, not the centre of the sprite.
 * The near face is what meets the bumper first. The far face is half a
 * length farther up the road. People and dogs plant their feet on that
 * near face and stay upright; bins, lids, holes and other cars fill the
 * whole patch.
 */

import { project } from "./road.js";

export function anchorKind(type) {
  if (type === "bin" || type === "roller" || type === "cutin" || type === "stopped") return "near";
  if (type === "pothole") return "span";
  return "feet";
}

export function groundDs(hazard, camS) {
  return hazard.s - camS - (hazard.halfL || 0);
}

export function farDs(hazard, camS) {
  return hazard.s - camS + (hazard.halfL || 0);
}

/** Screen patch of the hitbox. Bottom is the near face, top is the far face. */
export function screenFootprint(nearDs, farDs, hx, halfW) {
  const near = project(nearDs, hx);
  const far = project(farDs, hx);
  const mid = (nearDs + farDs) / 2;
  const left = project(mid, hx - halfW);
  const right = project(mid, hx + halfW);
  const bottomY = Math.max(near.y, far.y);
  const topY = Math.min(near.y, far.y);
  return {
    near,
    far,
    left,
    right,
    cx: (left.x + right.x) / 2,
    bottomY,
    topY,
    width: Math.max(4, Math.abs(right.x - left.x)),
    length: Math.max(4, Math.abs(bottomY - topY)),
  };
}

/**
 * Farther ground first. `layer` breaks a tie: the player car shares its
 * nose with a body that has just arrived, and that body paints afterwards
 * so the contact is not covered by the roof.
 */
export function paintFarToNear(items) {
  return [...items].sort((a, b) => (b.ds - a.ds) || ((a.layer || 0) - (b.layer || 0)));
}
