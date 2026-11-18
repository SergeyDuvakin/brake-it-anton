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
  const gate = (hash32(block + 91) % 5) + 4;
  items.push({ name: "fence", s: s + gate, kind: "fence", side: "left", gate: true });
  items.push({ name: "fence", s: s + gate + 8, kind: "fence", side: "right", gate: true });
  return items;
}

function lampRows(sFrom, sTo) {
  const rows = [];
  const first = Math.floor((sFrom - 8) / 16);
  const last = Math.ceil((sTo + 8) / 16);
  for (let k = first; k <= last; k += 1) {
    const s = k * 16 + 8;
    if (s < sFrom - 2 || s > sTo + 2) continue;
    rows.push({ name: "lamp", s, xPx: 95, ax: 4, ay: 26, kind: "lamp", side: "left", w: 9, h: 29 });
    rows.push({ name: "lamp", s, xPx: 183, ax: 4, ay: 26, kind: "lamp", side: "right", w: 9, h: 29, mirror: true });
  }
  return rows;
}

export function layoutBetween(sFrom, sTo) {
  const first = Math.floor((sFrom - 8) / 32);
  const last = Math.floor((sTo + 8) / 32);
  const items = [];
  for (let block = first; block <= last; block += 1) items.push(...blockLayout(block));
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
  const sign = item.side === "right" ? 1 : -1;
  return {
    name: "lamp",
    s: item.s,
    x: sign * 4.67,
    halfW: 0.15,
    halfL: 0.15,
    solid: true,
    side: item.side,
    kind: "lamp",
  };
}

function fenceBoxes(item) {
  const sign = item.side === "right" ? 1 : -1;
  const edge = sign * WALL_M;
  const gate = 2.6;
  const post = 0.15;
  return [
    {
      name: "fence",
      s: item.s - gate / 2 - 1.2,
      x: edge + sign * 0.2,
      halfW: 0.2,
      halfL: 1.2,
      solid: true,
      side: item.side,
      kind: "fence",
    },
    {
      name: "fence-post",
      s: item.s - gate / 2,
      x: edge,
      halfW: post,
      halfL: post,
      solid: true,
      side: item.side,
      kind: "fence",
    },
    {
      name: "fence-post",
      s: item.s + gate / 2,
      x: edge,
      halfW: post,
      halfL: post,
      solid: true,
      side: item.side,
      kind: "fence",
    },
    {
      name: "fence",
      s: item.s + gate / 2 + 1.2,
      x: edge + sign * 0.2,
      halfW: 0.2,
      halfL: 1.2,
      solid: true,
      side: item.side,
      kind: "fence",
    },
  ];
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
    else if (item.kind === "fence") boxes.push(...fenceBoxes(item));
  }
  return boxes;
}
