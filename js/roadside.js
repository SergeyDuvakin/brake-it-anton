/**
 * One layout for the curb. The pixel world draws these rows, and the
 * sim hits the same rectangles. Houses, fences and lamps never move.
 */

import { CFG } from "./config.js";

export const PPM = 32 / CFG.roadHalf;
export const ROAD_CX = 143.5;
export const WALL_M = 5.03;

export const BUILDINGS_LEFT = ["house-red-gable", "house-orange-gable", "block-teal-tall", "shop-grey", "house-orange-tan"];
export const BUILDINGS_RIGHT = ["house-red-gable", "block-brown-brick", "shop-teal", "house-orange-tan", "block-teal-tall"];
export const SIDEWALK = ["bench", "trash-bin", "hydrant", "planter", "manhole"];

/** Native pixels: w, h, ax, ay. Kept in step with manifest.json. */
export const SPRITE = {
  "house-red-gable": [45, 35, 0, 32],
  "house-orange-gable": [61, 32, 0, 29],
  "block-teal-tall": [35, 41, 0, 38],
  "shop-grey": [65, 41, 0, 38],
  "block-brown-brick": [41, 39, 0, 36],
  "house-orange-tan": [49, 45, 0, 42],
  "shop-teal": [49, 49, 0, 46],
  tree: [19, 24, 8, 19],
  bench: [14, 8, 0, 6],
  "trash-bin": [7, 8, 0, 6],
  hydrant: [7, 7, 0, 5],
  manhole: [9, 7, 4, 3],
  planter: [16, 7, 0, 5],
  fence: [8, 16, 0, 14],
  lamp: [9, 29, 4, 26],
};

/** Collider in metres. `solid: false` is flat (a manhole). */
export const COLLIDER = {
  bench: { w: 14 / PPM, l: 8 / PPM, solid: true },
  planter: { w: 16 / PPM, l: 7 / PPM, solid: true },
  hydrant: { w: 7 / PPM, l: 7 / PPM, solid: true },
  "trash-bin": { w: 7 / PPM, l: 8 / PPM, solid: true },
  manhole: { w: 9 / PPM, l: 7 / PPM, solid: false },
  lamp: { w: 0.3, l: 0.3, solid: true },
  fence: { w: 0.3, l: 0.3, solid: true },
};

const SIDEWALK_BANDS = { left: [96, 111], right: [176, 191] };

export function hash32(n) {
  let x = Math.imul(n | 0, 0x9e3779b1);
  x ^= x >>> 16;
  return x >>> 0;
}

export function pxToM(px) {
  return (px - ROAD_CX) / PPM;
}

function sidewalkPlace(w, onRight) {
  const [lo, hi] = onRight ? SIDEWALK_BANDS.right : SIDEWALK_BANDS.left;
  const span = hi - lo + 1;
  const start = lo + Math.max(0, Math.floor((span - w) / 2));
  const ax = Math.floor(w / 2);
  return { xPx: start + ax, ax };
}

function pushHouse(items, name, s, xPx, side) {
  const spec = SPRITE[name];
  items.push({
    name,
    s,
    xPx,
    ax: spec[2],
    ay: spec[3],
    kind: "house",
    side,
    w: spec[0],
    h: spec[1],
  });
}

/** Draw list for one 32 m block. Pixel positions match the old dressing(). */
export function blockLayout(block) {
  const h = hash32(block + 17);
  const s = block * 32 + 10;
  const items = [];
  const leftName = BUILDINGS_LEFT[h % BUILDINGS_LEFT.length];
  const left = SPRITE[leftName];
  pushHouse(items, leftName, s, 94 - (left[0] - left[2]), "left");
  const rightName = BUILDINGS_RIGHT[(h >>> 3) % BUILDINGS_RIGHT.length];
  const right = SPRITE[rightName];
  if (right[0] <= 57) pushHouse(items, rightName, s + 6, 193 + right[2], "right");
  const treeSide = (h >>> 8) & 1;
  const tree = SPRITE.tree;
  items.push({
    name: "tree",
    s: s + 18,
    xPx: treeSide ? 30 : 220,
    ax: tree[2],
    ay: tree[3],
    kind: "tree",
    w: tree[0],
    h: tree[1],
  });
  const propName = SIDEWALK[(h >>> 12) % SIDEWALK.length];
  const onRight = ((h >>> 16) & 1) === 0;
  const prop = SPRITE[propName];
  const placed = sidewalkPlace(prop[0], onRight);
  items.push({
    name: propName,
    s: s + 4,
    xPx: placed.xPx,
    ax: placed.ax,
    ay: prop[3],
    kind: "prop",
    side: onRight ? "right" : "left",
    w: prop[0],
    h: prop[1],
  });
  return items;
}

function houseSpan(item) {
  const spec = SPRITE[item.name];
  if (!spec) return null;
  const ay = spec[3];
  const h = spec[1];
  return [item.s - (h - ay) / PPM, item.s + ay / PPM];
}

function rangesTouch(a0, a1, b0, b1) {
  return a0 <= b1 + 1e-6 && b0 <= a1 + 1e-6;
}

const FENCE_STEP = 8 / PPM;
const FENCE_UP = 14 / PPM;
const FENCE_DOWN = 2 / PPM;
const GATE_HALF = 1.3;

function housesOn(sFrom, sTo, side) {
  const first = Math.floor((sFrom - 8) / 32) - 1;
  const last = Math.floor((sTo + 8) / 32) + 1;
  const items = [];
  for (let block = first; block <= last; block += 1) {
    for (const item of blockLayout(block)) {
      if (item.kind === "house" && (!side || item.side === side)) items.push(item);
    }
  }
  return items;
}

function gateCovers(lo, hi) {
  const mid = (lo + hi) / 2;
  const block = Math.round((mid - 26) / 32);
  for (let b = block - 1; b <= block + 1; b += 1) {
    const gate = b * 32 + 26;
    if (rangesTouch(lo, hi, gate - GATE_HALF, gate + GATE_HALF)) return true;
  }
  return false;
}

/**
 * One post every 8 native px on a single grid, s = k·(8/PPM).
 * A tile is dropped when its drawn rect (14 px up, 2 px down) touches a
 * house on that side or the 2.6 m gate. The first tile of a run drops the
 * rail under the post so the gap ends on a post.
 */
export function fenceTiles(sFrom, sTo) {
  const tiles = [];
  const k0 = Math.floor((sFrom - 1) / FENCE_STEP) - 2;
  const k1 = Math.ceil((sTo + 1) / FENCE_STEP) + 2;
  for (const side of ["left", "right"]) {
    const houses = housesOn(sFrom - 8, sTo + 8, side);
    const spans = houses.map(houseSpan);
    const xPx = side === "left" ? 88 : 193;
    const kept = [];
    for (let k = k0; k <= k1; k += 1) {
      const s = k * FENCE_STEP;
      if (s < sFrom - 1 || s > sTo + 1) continue;
      const lo = s - FENCE_DOWN;
      const hi = s + FENCE_UP;
      if (spans.some((span) => span && rangesTouch(lo, hi, span[0], span[1]))) continue;
      if (gateCovers(lo, hi)) continue;
      kept.push({ k, s, lo, hi });
    }
    for (let i = 0; i < kept.length; i += 1) {
      const tile = kept[i];
      const prev = kept[i - 1];
      const trimBottom = !prev || prev.k !== tile.k - 1;
      // Rows 0–12 stay. The rail (rows 13–15) would hang into the gap.
      const sLo = trimBottom ? tile.s + 1 / PPM : tile.lo;
      tiles.push({
        name: "fence",
        s: tile.s,
        k: tile.k,
        sLo,
        sHi: tile.hi,
        trimBottom,
        xPx,
        ax: 0,
        ay: 14,
        kind: "fence",
        side,
        w: 8,
        h: trimBottom ? 13 : 16,
        mirror: false,
      });
    }
  }
  return tiles;
}

/** Centre of the nearest 2.6 m gate that is not buried in a house. */
export function nearestGateS(s, side) {
  const block = Math.round((s - 26) / 32);
  let best = null;
  let bestD = Infinity;
  for (let b = block - 3; b <= block + 3; b += 1) {
    const gate = b * 32 + 26;
    const houses = blockLayout(b).filter((item) => item.kind === "house" && item.side === side);
    const buried = houses.some((house) => {
      const span = houseSpan(house);
      return span && rangesTouch(gate - GATE_HALF, gate + GATE_HALF, span[0], span[1]);
    });
    if (buried) continue;
    const dist = Math.abs(gate - s);
    if (dist < bestD) {
      best = gate;
      bestD = dist;
    }
  }
  return best ?? block * 32 + 26;
}

function lampRows(sFrom, sTo) {
  const rows = [];
  const first = Math.floor((sFrom - 8) / 16);
  const last = Math.ceil((sTo + 8) / 16);
  for (let k = first; k <= last; k += 1) {
    const s = k * 16 + 8;
    if (s < sFrom - 2 || s > sTo + 2) continue;
    // Pole columns 1–3 land on 96–98 when the foot is 99 (ax 4).
    rows.push({ name: "lamp", s, xPx: 99, ax: 4, ay: 26, kind: "lamp", side: "left", w: 9, h: 29, mirror: false });
    // Flipped pole lands on 188–190. The shadow stays unmirrored, light from the same side.
    rows.push({
      name: "lamp",
      s,
      xPx: 191,
      ax: 4,
      ay: 26,
      kind: "lamp",
      side: "right",
      w: 9,
      h: 29,
      mirror: true,
      leftEdge: 183,
      shadowX: 190,
    });
  }
  return rows;
}

export function layoutBetween(sFrom, sTo) {
  const first = Math.floor((sFrom - 8) / 32);
  const last = Math.floor((sTo + 8) / 32);
  const items = [];
  for (let block = first; block <= last; block += 1) items.push(...blockLayout(block));
  items.push(...fenceTiles(sFrom, sTo));
  items.push(...lampRows(sFrom, sTo));
  return items;
}

/** What the pixel world paints. Same rows the collider uses. */
export function dressingLayout(camS) {
  return layoutBetween(camS - 8, camS + 28);
}

function houseBox(item) {
  const edge = item.side === "left" ? -WALL_M : WALL_M;
  const outward = item.side === "left" ? -1 : 1;
  const depth = Math.max(0.4, item.w / PPM);
  return {
    name: item.name,
    s: item.s,
    x: edge + outward * depth * 0.5,
    halfW: depth * 0.5,
    halfL: Math.max(0.4, item.h / PPM) * 0.5,
    solid: true,
    side: item.side,
    kind: "house",
  };
}

function propBox(item) {
  const spec = COLLIDER[item.name];
  if (!spec) return null;
  const sign = item.side === "right" ? 1 : -1;
  return {
    name: item.name,
    s: item.s,
    x: sign * Math.abs(pxToM(item.xPx)),
    halfW: spec.w / 2,
    halfL: spec.l / 2,
    solid: spec.solid,
    side: item.side,
    kind: "prop",
  };
}

function lampBox(item) {
  const centerPx = item.side === "right" ? 189 : 97;
  return {
    name: "lamp",
    s: item.s,
    x: pxToM(centerPx),
    halfW: 0.15,
    halfL: 0.15,
    solid: true,
    side: item.side,
    kind: "lamp",
  };
}

function fenceBox(item) {
  const sign = item.side === "right" ? 1 : -1;
  const halfW = 0.2;
  const sLo = item.sLo ?? item.s - 2 / PPM;
  const sHi = item.sHi ?? item.s + 14 / PPM;
  return {
    name: "fence",
    s: (sLo + sHi) / 2,
    x: sign * (WALL_M + halfW),
    halfW,
    halfL: (sHi - sLo) / 2,
    solid: true,
    side: item.side,
    kind: "fence",
    sLo,
    sHi,
  };
}

/** Solid (and flat) rectangles in metres. */
export function roadsideItems(sFrom, sTo) {
  const boxes = [];
  for (const item of layoutBetween(sFrom, sTo)) {
    if (item.kind === "house") boxes.push(houseBox(item));
    else if (item.kind === "prop") {
      const box = propBox(item);
      if (box) boxes.push(box);
    } else if (item.kind === "lamp") boxes.push(lampBox(item));
    else if (item.kind === "fence") boxes.push(fenceBox(item));
  }
  return boxes;
}
