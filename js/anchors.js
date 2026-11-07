/**
 * Where a picture touches the road, in the same metres as the hitbox.
 * Feet sit on the body's s. A bin, lid or other car sits on its near face.
 * A hole spans that face to the far one. The player nose is a separate bumper.
 */

export function anchorKind(type) {
  if (type === "bin" || type === "roller" || type === "cutin" || type === "stopped") return "near";
  if (type === "pothole") return "span";
  return "feet";
}

export function groundDs(hazard, camS) {
  const dist = hazard.s - camS;
  const kind = anchorKind(hazard.type);
  if (kind === "near" || kind === "span") return dist - (hazard.halfL || 0);
  return dist;
}

export function farDs(hazard, camS) {
  const dist = hazard.s - camS;
  const kind = anchorKind(hazard.type);
  if (kind === "near" || kind === "span") return dist + (hazard.halfL || 0);
  return dist;
}

/** Farther bodies first, so a closer ground paints in front. */
export function paintFarToNear(items) {
  return [...items].sort((a, b) => b.ds - a.ds);
}
