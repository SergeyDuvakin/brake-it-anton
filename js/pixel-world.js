/**
 * Top-down pixel world. Integer ×4. The old perspective renderer stays
 * as the fallback in draw.js. Static objects share one camera rounding
 * with the ground strip so they cannot crawl across the asphalt.
 */

import { CFG } from "./config.js";
import { CABIN_POSES } from "./cabin.js";
import { damageStage } from "./physics.js";
import { patienceNeedleDegrees, pedalHingeDegrees } from "./ui.js";
import { hazardWorldX, isSolidHazard, renderPose } from "./sim.js";
import { notePixelSmoothing, pixelImage, usePixel } from "./pixel-assets.js";

export const PIXEL_SCALE = 4;
export const WORLD_W = 250;
export const WORLD_H = 211;
export const WORLD_X = 28;
export const WORLD_Y = 28;
export const WORLD_PX_PER_M = 32 / CFG.roadHalf;
export const ROAD_CX = 143.5;
/** Car centre sits low so most of the 211px panel is road ahead. */
export const CAR_CENTER_Y = 188;
const NOSE_ABOVE_CENTER = 20;
const TAIL_BELOW_CENTER = 19;

/** Seconds from the first off-screen "!" to the nose, at cruise. */
export const REACTION_S = 2.6;

export const PIXEL_POSE = {
  drive: "drive",
  focused: "drive",
  belted: "oy",
  phone: "phone",
  stow: "phone",
  drowsy: "asleep",
  asleep: "asleep",
  wake: "oy",
  earnest: "yasam",
  preen: "yasam",
  proud: "yasam",
  annoyed: "grumble",
  angry: "grumble",
  furious: "grumble",
  ashamed: "grumble",
};

export function pixelPoseFrame(cabinId, phase) {
  if (phase === "countdown") return "drive";
  return PIXEL_POSE[cabinId] || "drive";
}

export function poseMapCoversCabin() {
  return CABIN_POSES.every((id) => PIXEL_POSE[id]);
}

export function camPxOf(s) {
  return Math.round(s * WORLD_PX_PER_M);
}

/** Metres ahead of the car centre → native y. Identity scale. */
export function dsToNativeY(ds) {
  return CAR_CENTER_Y - Math.round(ds * WORLD_PX_PER_M);
}

export function yNative(worldS, camS) {
  return CAR_CENTER_Y - (Math.round(worldS * WORLD_PX_PER_M) - camPxOf(camS));
}

export function xNative(metresX) {
  return Math.round(ROAD_CX + metresX * WORLD_PX_PER_M);
}

export function noseNativeY() {
  return CAR_CENTER_Y - NOSE_ABOVE_CENTER;
}

export function lookAheadMetres() {
  return noseNativeY() / WORLD_PX_PER_M;
}

export function warnMetres(cruise) {
  return REACTION_S * Math.max(1, Number(cruise) || 10);
}

export function reactionSeconds(cruise) {
  return warnMetres(cruise) / Math.max(1, Number(cruise) || 10);
}

export function pedalDropPx(brake) {
  const steps = Math.round(Math.max(0, Math.min(1, brake)) * 7);
  return steps * 4;
}

const BUILDINGS_LEFT = ["house-red-gable", "house-orange-gable", "block-teal-tall", "shop-grey", "house-orange-tan"];
const BUILDINGS_RIGHT = ["house-red-gable", "block-brown-brick", "shop-teal", "house-orange-tan", "block-teal-tall"];
const SIDEWALK = ["bench", "trash-bin", "hydrant", "planter", "manhole"];

let worldCanvas = null;
let shadowCache = new Map();
let textCache = new Map();

function worldCtx() {
  if (worldCanvas) return worldCanvas.getContext("2d");
  if (typeof document === "undefined") return null;
  worldCanvas = document.createElement("canvas");
  worldCanvas.width = WORLD_W;
  worldCanvas.height = WORLD_H;
  return worldCanvas.getContext("2d");
}

function hash(n) {
  let x = Math.imul(n | 0, 0x9e3779b1);
  x ^= x >>> 16;
  return x >>> 0;
}

function spriteOf(name) {
  const spec = {
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
    "ped-pink-left-0": [10, 16, 4, 14],
    "ped-pink-left-1": [10, 16, 4, 14],
    "ped-pink-right-0": [10, 16, 4, 14],
    "ped-pink-right-1": [10, 16, 4, 14],
    "ped-blue-left-0": [10, 16, 4, 14],
    "ped-blue-left-1": [10, 16, 4, 14],
    "ped-blue-right-0": [10, 16, 4, 14],
    "ped-blue-right-1": [10, 16, 4, 14],
    "dog-left": [14, 9, 6, 7],
    "dog-right": [14, 9, 6, 7],
  }[name];
  if (!spec) return null;
  return {
    name,
    file: `world/sprites/${name}.png`,
    shadow: name === "manhole" ? null : `world/shadows/${name}.png`,
    w: spec[0],
    h: spec[1],
    ax: spec[2],
    ay: spec[3],
  };
}

function tintShadow(file) {
  const cached = shadowCache.get(file);
  if (cached) return cached;
  const img = pixelImage(file);
  if (!img || !img.naturalWidth || typeof document === "undefined") return null;
  const buffer = document.createElement("canvas");
  buffer.width = img.naturalWidth;
  buffer.height = img.naturalHeight;
  const stx = buffer.getContext("2d");
  stx.drawImage(img, 0, 0);
  stx.globalCompositeOperation = "source-in";
  stx.fillStyle = "rgba(0,0,0,0.2)";
  stx.fillRect(0, 0, buffer.width, buffer.height);
  shadowCache.set(file, buffer);
  return buffer;
}

function blitSprite(nctx, spec, xFoot, yFoot) {
  if (!spec) return;
  const x = Math.round(xFoot - spec.ax);
  const y = Math.round(yFoot - spec.ay);
  if (spec.shadow) {
    const shadow = tintShadow(spec.shadow);
    if (shadow) nctx.drawImage(shadow, x, y);
  }
  const img = pixelImage(spec.file);
  if (img) nctx.drawImage(img, x, y);
}

function dressing(cam) {
  const items = [];
  const first = Math.floor((cam - 8) / 32);
  const last = Math.floor((cam + 28) / 32);
  for (let block = first; block <= last; block += 1) {
    const h = hash(block + 17);
    const s = block * 32 + 10;
    const leftName = BUILDINGS_LEFT[h % BUILDINGS_LEFT.length];
    const left = spriteOf(leftName);
    if (left) items.push({ spec: left, s, xPx: 94 - (left.w - left.ax), yOff: 0 });
    const rightName = BUILDINGS_RIGHT[(h >>> 3) % BUILDINGS_RIGHT.length];
    const right = spriteOf(rightName);
    if (right && right.w <= 57) items.push({ spec: right, s: s + 6, xPx: 193 + right.ax });
    const tree = spriteOf("tree");
    const side = (h >>> 8) & 1;
    items.push({ spec: tree, s: s + 18, xPx: side ? 30 : 220 });
    const prop = spriteOf(SIDEWALK[(h >>> 12) % SIDEWALK.length]);
    const walk = (h >>> 16) & 1;
    items.push({ spec: prop, s: s + 4, xPx: walk ? 104 : 182 });
  }
  return items;
}

function pedName(h, sim, reduced) {
  const color = (hash(String(h.id).length * 13 + (h.s | 0)) & 1) ? "blue" : "pink";
  const moving = h.motion === "enter" || h.motion === "leave";
  const step = moving && !reduced ? Math.floor((sim?.t || 0) / 0.25) % 2 : 0;
  const faceLeft = (h.x || 0) >= 0 ? h.motion !== "leave" : h.motion === "leave";
  const dir = faceLeft ? "left" : "right";
  return `ped-${color}-${dir}-${step}`;
}

function dogName(h) {
  const faceLeft = (h.x || 0) >= 0;
  return faceLeft ? "dog-left" : "dog-right";
}

function learnerFile(sim, state) {
  const failed = state.session?.phase === "result" && state.session?.result && state.session.result.success === false;
  const hazard = sim.crashT > 0.05 || damageStage(sim.body) >= 2 || failed;
  const braking = sim.brakeInput > 0.05;
  if (!hazard) return braking ? "car/learner-brake.png" : "car/learner-normal.png";
  const reduced = !!state.save?.settings?.reducedMotion;
  const on = reduced || Math.floor((state.now || 0) / 250) % 2 === 0;
  if (!on) return braking ? "car/learner-brake.png" : "car/learner-normal.png";
  return "car/learner-hazard.png";
}

function drawOldHole(nctx, x, y, halfW) {
  const rx = Math.max(3, Math.round(halfW * WORLD_PX_PER_M));
  const ry = Math.max(2, Math.round(rx * 0.55));
  pxEllipse(nctx, Math.round(x), Math.round(y), rx, ry, "#241C16");
  pxLine(nctx, x - rx * 0.4, y, x - rx * 0.7, y - ry * 0.6, 1, "#FAC83C");
  pxLine(nctx, x + rx * 0.3, y, x + rx * 0.65, y - ry * 0.55, 1, "#FAC83C");
}

/** Hard-edged line on the native grid (no antialiasing). Width 1 or 2. */
export function pxLine(nctx, x0, y0, x1, y1, width, color) {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  const steep = dy > dx;
  let err = dx - dy;
  nctx.fillStyle = color;
  for (let guard = 0; guard < 512; guard += 1) {
    if (width > 1) nctx.fillRect(x, y, steep ? width : 1, steep ? 1 : width);
    else nctx.fillRect(x, y, 1, 1);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Filled ellipse, one rect per row, so edges stay hard. */
function pxEllipse(nctx, cx, cy, rx, ry, color) {
  nctx.fillStyle = color;
  for (let j = -ry; j <= ry; j += 1) {
    const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (j * j) / (ry * ry))) + 0.5);
    if (half > 0) nctx.fillRect(cx - half, cy + j, half * 2 + 1, 1);
  }
}

/** Filled rounded rect, one rect per row: hard corners, and a translucent fill never doubles up. */
function pxRoundRect(nctx, x, y, w, h, r, color) {
  nctx.fillStyle = color;
  for (let j = 0; j < h; j += 1) {
    const dyTop = r - 1 - j;
    const dyBot = j - (h - r);
    const dy = Math.max(dyTop, dyBot, -1);
    let inset = 0;
    if (dy >= 0) inset = r - Math.floor(Math.sqrt(Math.max(0, r * r - (dy + 0.5) * (dy + 0.5))) + 0.5);
    nctx.fillRect(x + inset, y + j, w - inset * 2, 1);
  }
}

/** Warning chip, in the world style: 1px outline, one highlight and one shadow step. 9×12 native. */
const BANG = [
  ".ooooooo.",
  "ohhhhhhho",
  "oyyykyyyo",
  "oyyykyyyo",
  "oyyykyyyo",
  "oyyykyyyo",
  "oyyykyyyo",
  "oyyyyyyyo",
  "oyyykyyyo",
  "odddddddo",
  ".ooooooo.",
];
const BANG_KEY = { o: "#6E4210", h: "#FFE06A", y: "#FAC83C", d: "#D49A20", k: "#2A2430" };

function drawBang(nctx, x) {
  const cx = Math.max(5, Math.min(WORLD_W - 6, Math.round(x)));
  const x0 = cx - 4;
  const y0 = 2;
  for (let j = 0; j < BANG.length; j += 1) {
    const row = BANG[j];
    for (let i = 0; i < row.length; i += 1) {
      const c = BANG_KEY[row[i]];
      if (!c) continue;
      nctx.fillStyle = c;
      nctx.fillRect(x0 + i, y0 + j, 1, 1);
    }
  }
  // wider stroke: the bar and the dot are 2px, like the HUD lettering
  nctx.fillStyle = BANG_KEY.k;
  nctx.fillRect(x0 + 3, y0 + 2, 1, 5);
  nctx.fillRect(x0 + 3, y0 + 8, 1, 1);
}

export function drawPixelWorld(ctx, sim, state) {
  const nctx = worldCtx();
  if (!nctx || !sim) return null;
  const alpha = state.alpha ?? 1;
  const pose = renderPose(sim, alpha);
  const cam = camPxOf(pose.s);
  const reduced = !!state.save?.settings?.reducedMotion;
  nctx.imageSmoothingEnabled = false;
  notePixelSmoothing(false);
  nctx.clearRect(0, 0, WORLD_W, WORLD_H);
  const strip = pixelImage("world/road-straight-strip.png");
  if (strip) {
    const phase = cam % 128;
    for (let k = 0; k < 3; k += 1) {
      const y = phase - 128 + k * 128;
      nctx.drawImage(strip, 0, y);
    }
  }
  const marks = [];
  for (const h of sim.hazards || []) {
    if (h.type === "pedestrian") marks.push({ file: "world/zebra-across-road.png", s: h.pose?.s ?? h.s, x: 112 });
  }
  for (const mark of marks) {
    const img = pixelImage(mark.file);
    if (!img) continue;
    const y = yNative(mark.s, pose.s) - Math.round(img.naturalHeight / 2);
    nctx.drawImage(img, mark.x, y);
  }

  const queue = [];
  for (const item of dressing(pose.s)) {
    const spec = item.spec;
    const y = yNative(item.s, pose.s);
    queue.push({ y, draw: () => blitSprite(nctx, spec, item.xPx, y) });
  }
  for (const h of sim.hazards || []) {
    if (h.resolved && (h.pose?.s ?? h.s) - pose.s < -12) continue;
    const hs = h.pose?.s ?? h.s;
    const hx = h.pose && Number.isFinite(h.pose.x) && h.motion && h.motion !== "curb"
      ? h.pose.x
      : hazardWorldX(h, { ...sim, s: pose.s });
    const y = yNative(hs, pose.s);
    const x = xNative(hx);
    if (h.type === "pothole") {
      queue.push({ y, draw: () => drawOldHole(nctx, x, y, h.halfW || 0.7) });
      continue;
    }
    let name = null;
    if (h.type === "pedestrian") name = pedName(h, sim, reduced);
    else if (h.type === "dog") name = dogName(h);
    else if (h.type === "bin") name = "trash-bin";
    else if (h.type === "roller") name = "manhole";
    else if (h.type === "stopped") {
      queue.push({
        y,
        draw: () => {
          const img = pixelImage("car/npc-white-up.png");
          if (img) nctx.drawImage(img, x - 13, y - 21);
        },
      });
      continue;
    } else if (h.type === "cutin") {
      queue.push({
        y,
        draw: () => {
          const img = pixelImage("car/npc-blue-up.png");
          if (img) nctx.drawImage(img, x - 13, y - 21);
        },
      });
      continue;
    }
    const spec = name ? spriteOf(name) : null;
    if (spec) queue.push({ y, draw: () => blitSprite(nctx, spec, x, y) });
  }
  const carX = xNative(pose.x);
  const carY = CAR_CENTER_Y;
  const tailY = carY + TAIL_BELOW_CENTER;
  queue.push({
    y: tailY,
    draw: () => {
      pxRoundRect(nctx, carX - 13 + 5, carY - 21 + 3, 20, 40, 5, "rgba(0,0,0,0.2)");
      const img = pixelImage(learnerFile(sim, state));
      if (img) nctx.drawImage(img, carX - 13, carY - 21);
    },
  });
  queue.sort((a, b) => a.y - b.y);
  for (const item of queue) item.draw();

  const cruise = sim.cruise || 10;
  const warn = warnMetres(cruise);
  const ahead = lookAheadMetres();
  for (const h of sim.hazards || []) {
    if (h.resolved || !isSolidHazard(h)) continue;
    const hs = h.pose?.s ?? h.s;
    const dist = hs - pose.s - CFG.carHalfFront;
    if (dist <= ahead || dist > warn) continue;
    const hx = h.pose?.x ?? hazardWorldX(h, sim);
    drawBang(nctx, xNative(hx));
  }

  drawPixelGauge(nctx, sim.patience);
  const pause = pixelImage("ui/pause-button.png");
  if (pause) {
    pxRoundRect(nctx, 225, 5, 24, 22, 4, "rgba(0,0,0,0.2)");
    nctx.drawImage(pause, 223, 3);
  }

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  notePixelSmoothing(false);
  ctx.drawImage(worldCanvas, WORLD_X, WORLD_Y, WORLD_W * PIXEL_SCALE, WORLD_H * PIXEL_SCALE);
  const mask = pixelImage("ui/world-corner-mask.png");
  if (mask) ctx.drawImage(mask, WORLD_X, WORLD_Y, mask.naturalWidth * PIXEL_SCALE, mask.naturalHeight * PIXEL_SCALE);
  const frame = pixelImage("ui/world-plate-frame.png");
  if (frame) ctx.drawImage(frame, 24, 24, 1008, 852);
  ctx.restore();
  return gaugeReadout(sim.patience);
}

function drawPixelGauge(nctx, patience) {
  const face = pixelImage("ui/gauge-face.png");
  nctx.save();
  pxRoundRect(nctx, 5, 5, 72, 46, 4, "rgba(0,0,0,0.2)");
  if (face) nctx.drawImage(face, 3, 3);
  const deg = patienceNeedleDegrees(patience);
  const rad = (deg * Math.PI) / 180;
  const hubX = 3 + 36;
  const hubY = 3 + 39;
  const tipX = Math.round(hubX + Math.cos(rad) * 15);
  const tipY = Math.round(hubY - Math.sin(rad) * 15);
  pxLine(nctx, hubX, hubY, tipX, tipY, 2, "#2A2430");
  nctx.fillStyle = "#2A2430";
  nctx.fillRect(hubX - 2, hubY - 2, 5, 4);
  nctx.fillStyle = "#FFF6E4";
  nctx.fillRect(hubX - 1, hubY - 1, 3, 2);
  nctx.restore();
}

export function gaugeReadout(patience) {
  const deg = patienceNeedleDegrees(patience);
  const rad = (deg * Math.PI) / 180;
  const hubNx = 3 + 36;
  const hubNy = 3 + 39;
  const hubX = 28 + hubNx * 4 + 2;
  const hubY = 28 + hubNy * 4 + 2;
  const tipNx = Math.round(hubNx + Math.cos(rad) * 15);
  const tipNy = Math.round(hubNy - Math.sin(rad) * 15);
  return {
    deg,
    hubX,
    hubY,
    tipX: 28 + tipNx * 4 + 2,
    tipY: 28 + tipNy * 4 + 2,
  };
}

function thresholdText(text, scale) {
  const key = `${scale}:${text}`;
  const cached = textCache.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  const native = document.createElement("canvas");
  const measure = native.getContext("2d");
  measure.font = "9px 'Pixeloid Sans', sans-serif";
  const width = Math.max(1, Math.ceil(measure.measureText(text).width));
  native.width = width;
  native.height = 12;
  const nctx = native.getContext("2d");
  nctx.font = "9px 'Pixeloid Sans', sans-serif";
  nctx.fillStyle = "#1C181C";
  nctx.textBaseline = "top";
  nctx.fillText(text, 0, 1);
  const data = nctx.getImageData(0, 0, native.width, native.height);
  for (let i = 3; i < data.data.length; i += 4) data.data[i] = data.data[i] >= 128 ? 255 : 0;
  nctx.putImageData(data, 0, 0);
  const big = document.createElement("canvas");
  big.width = width * scale;
  big.height = 12 * scale;
  const btx = big.getContext("2d");
  btx.imageSmoothingEnabled = false;
  btx.drawImage(native, 0, 0, big.width, big.height);
  textCache.set(key, big);
  return big;
}

function drawBubble(ctx, text) {
  const scale = text.length > 8 ? 3 : 4;
  const glyph = thresholdText(text, scale);
  if (!glyph) return;
  const pad = (1 + 2) * PIXEL_SCALE;
  let w = glyph.width + pad * 2;
  w = Math.round(w / 4) * 4;
  const maxW = 520 - 40;
  if (w > maxW) w = maxW;
  const h = scale === 4 ? 56 : 48;
  const x = 1096;
  const y = 92;
  const slice = pixelImage("ui/bubble-9slice.png");
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (slice) {
    const b = 4;
    const sw = slice.naturalWidth;
    const sh = slice.naturalHeight;
    ctx.drawImage(slice, 0, 0, 1, 1, x, y, b, b);
    ctx.drawImage(slice, sw - 1, 0, 1, 1, x + w - b, y, b, b);
    ctx.drawImage(slice, 0, sh - 1, 1, 1, x, y + h - b, b, b);
    ctx.drawImage(slice, sw - 1, sh - 1, 1, 1, x + w - b, y + h - b, b, b);
    ctx.drawImage(slice, 1, 0, sw - 2, 1, x + b, y, w - b * 2, b);
    ctx.drawImage(slice, 1, sh - 1, sw - 2, 1, x + b, y + h - b, w - b * 2, b);
    ctx.drawImage(slice, 0, 1, 1, sh - 2, x, y + b, b, h - b * 2);
    ctx.drawImage(slice, sw - 1, 1, 1, sh - 2, x + w - b, y + b, b, h - b * 2);
    ctx.drawImage(slice, 1, 1, sw - 2, sh - 2, x + b, y + b, w - b * 2, h - b * 2);
  }
  ctx.drawImage(glyph, Math.round(x + (w - glyph.width) / 2), Math.round(y + (h - glyph.height) / 2));
  const tail = pixelImage("ui/bubble-tail.png");
  if (tail) ctx.drawImage(tail, x + 140, y + h - 4, 24, 20);
  ctx.restore();
}

export function drawPixelCabin(ctx, sim, state, cabinId) {
  const phase = state.session?.phase || "drive";
  const frameId = pixelPoseFrame(cabinId, phase);
  const plate = pixelImage("ui/plate-driver.png");
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  notePixelSmoothing(false);
  if (plate) ctx.drawImage(plate, 1056, 24);
  const pose = pixelImage(`cabin/poses/${frameId}.png`);
  if (pose) ctx.drawImage(pose, 1066, 34, 500, 600);
  if (sim?.bubble && sim.bubbleT > 0) drawBubble(ctx, sim.bubble);
  const hint = state.hint && phase === "drive";
  const needs = sim?.attention === "phone" || sim?.attention === "drowsy" || sim?.attention === "asleep";
  if (hint || (phase === "drive" && needs)) {
    const label = needs ? (sim.attention === "phone" ? "Ткни в него · F" : "Разбуди · F") : "Он газует. Ты жмёшь тормоз.";
    const glyph = thresholdText(label, 2);
    ctx.fillStyle = "#FFF6E4";
    ctx.fillRect(1080, 576, 472, 48);
    ctx.strokeStyle = "#1C181C";
    ctx.lineWidth = 4;
    ctx.strokeRect(1080, 576, 472, 48);
    if (glyph) ctx.drawImage(glyph, Math.round(1080 + (472 - glyph.width) / 2), Math.round(576 + (48 - glyph.height) / 2));
  }
  ctx.restore();
}

export function drawPixelPedal(ctx, brake) {
  const drop = pedalDropPx(brake);
  const plate = pixelImage("ui/plate-pedal.png");
  const bracket = pixelImage("pedal/pedal-bracket.png");
  const pad = pixelImage("pedal/pedal-pad.png");
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  notePixelSmoothing(false);
  if (plate) ctx.drawImage(plate, 1056, 660);
  if (bracket) ctx.drawImage(bracket, 1281, 708);
  const padY = 738 + drop;
  ctx.fillStyle = "#4A4A52";
  ctx.fillRect(1308, 732, 16, Math.max(0, padY + 4 - 732));
  ctx.fillStyle = "#1C181C";
  ctx.fillRect(1308, 732, 1, Math.max(0, padY + 4 - 732));
  ctx.fillRect(1323, 732, 1, Math.max(0, padY + 4 - 732));
  if (pad) ctx.drawImage(pad, 1236, padY);
  ctx.restore();
  return {
    deg: pedalHingeDegrees(brake),
    pad: { x: 1236 + 80, y: padY + 45 },
  };
}

export function pixelChrome(ctx, sim, state, brake) {
  const needle = gaugeReadout(sim.patience);
  const pedal = drawPixelPedal(ctx, brake);
  return { needle, pedalDeg: pedal.deg, pad: pedal.pad };
}

export { usePixel };
