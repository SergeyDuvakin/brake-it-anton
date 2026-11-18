/**
 * Shared lateral channel. This stage writes a pothole detour into it.
 * A later drift stage reads the same target and, while drift is active,
 * moves the car itself instead of following the path.
 */

import { CFG } from "./config.js";
import { clamp } from "./physics.js";

export function createLat() {
  return {
    mode: "lane",
    path: null,
    holdX: null,
    cruiseCap: null,
    blocked: false,
    holeId: null,
    gap: null,
    release: 0,
    pause: 0,
    ramp: 0,
    stopped: false,
    wantV: null,
    resumeLeft: 0,
    sExit: null,
    said: false,
    braked: false,
  };
}

export function detourGap(sim, h) {
  const hs = h.pose?.s ?? h.s;
  return (hs - h.halfL) - (sim.s + CFG.carHalfFront);
}

function limit() {
  return CFG.roadHalf - CFG.carHalfW;
}

/** Metres of clearance past the body. Null when even the curb still hits the hole. */
export function passX(h) {
  const hx = h.pose?.x ?? h.x;
  const offset = h.halfW + CFG.carHalfW + CFG.detour.margin;
  const sign = hx === 0 ? 1 : Math.sign(hx);
  const x = clamp(hx - sign * offset, -limit(), limit());
  const clears = Math.abs(x - hx) >= h.halfW + CFG.carHalfW - 0.02;
  return clears ? x : null;
}

export function clearsAt(x, h) {
  const hx = h.pose?.x ?? h.x;
  return Math.abs(x - hx) >= h.halfW + CFG.carHalfW - 0.02;
}

/**
 * Smooth S: own lane, aside for the whole overlap, own lane again.
 * The return is steep enough that 2.5 m/s puts the car home inside 4 s,
 * then it stays in lane until sExit.
 */
export function buildDetourPath(holes) {
  const list = holes.filter(Boolean);
  const xPass = passX(list[0]);
  if (xPass === null) return null;
  let overlapStart = Infinity;
  let overlapEnd = -Infinity;
  for (const h of list) {
    const hs = h.pose?.s ?? h.s;
    overlapStart = Math.min(overlapStart, hs - h.halfL - CFG.carHalfFront);
    overlapEnd = Math.max(overlapEnd, hs + h.halfL + CFG.carHalfBack);
  }
  const sEnter = overlapStart - CFG.detour.enterLead;
  const sExit = overlapEnd + CFG.detour.exitAfter;
  const back = overlapEnd + 1.35;
  const path = [
    { s: sEnter, x: CFG.defaultX },
    { s: Math.max(sEnter, overlapStart), x: xPass },
    { s: Math.max(overlapEnd, sEnter), x: xPass },
    { s: Math.max(back, overlapEnd), x: CFG.defaultX },
    { s: Math.max(sExit, back), x: CFG.defaultX },
  ];
  return { path, xPass, sEnter, sExit, overlapStart };
}

export function samplePath(path, s) {
  if (!path || path.length === 0) return CFG.defaultX;
  if (s <= path[0].s) return path[0].x;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    if (s <= b.s) {
      const span = b.s - a.s;
      const u = span <= 1e-6 ? 1 : (s - a.s) / span;
      return a.x + (b.x - a.x) * u;
    }
  }
  return path[path.length - 1].x;
}

function solidBody(h) {
  if (!h || h.alive === false || h.resolved) return false;
  if (h.solid === false) return false;
  if (h.category === "decor" || h.kind === "prop") return false;
  return true;
}

/** A solid body sitting in the remaining detour corridor. The hole we are passing is not one. */
export function detourBlocked(sim) {
  const lat = sim.lat;
  const path = lat?.path;
  if (!lat || !path || path.length === 0) return false;
  const slack = CFG.carHalfW + CFG.detour.blockSlack;
  const s0 = sim.s;
  const s1 = path[path.length - 1].s;
  for (const h of sim.hazards) {
    if (!solidBody(h)) continue;
    if (h.id === lat.holeId) continue;
    if (h.detoured) continue;
    const hx = h.pose?.x ?? h.x;
    const hs = h.pose?.s ?? h.s;
    if (hs + h.halfL < s0 - 1 || hs - h.halfL > s1 + 1) continue;
    const along = hs + h.halfL > s0 && hs - h.halfL < s1;
    if (!along) continue;
    const px = samplePath(path, hs);
    if (Math.abs(hx - px) < slack + h.halfW) return true;
  }
  return false;
}

/**
 * Lane target, unless a detour path or a held brake owns x.
 * Drift, when it exists, does not call this.
 */
export function lateralTargetX(sim, laneX) {
  const lat = sim.lat;
  if (!lat || sim.drift?.active) return laneX;
  if (lat.holdX !== null && lat.holdX !== undefined) return lat.holdX;
  if (lat.mode === "detour" && lat.path) return samplePath(lat.path, sim.s);
  if (lat.mode === "approach" || lat.mode === "aim") return CFG.defaultX;
  return laneX;
}
