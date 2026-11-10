/**
 * Live UI for the approved garage, pause, result and HUD.
 *
 * Words are drawn with the project fonts. Buttons are the nine-slice
 * blanks plus a state (normal, hover, pressed, disabled, selected lesson).
 * The patience picture in the cut pack has the needle, the hub and the word
 * baked in. assets/ui/gauge-face-empty.png is not an approved layer: tools/
 * build-ui-assets.py paints those pixels out of a copy. The needle and the
 * word are drawn here from the real patience value.
 *
 * The pedal keeps the approved hinge. The bracket does not move. The lever
 * and the pad are one layer, rotated 0..24° about the top axle in rig.py
 * (y = 242, focal 1800). The pad is not scaled by itself.
 */

import { PALETTE as P } from "./config.js";
import { moodGlyph, repairInvoice } from "./physics.js";

const CARD_SRC = { x: 86, y: 86, w: 694, h: 973 };

export const GAUGE = {
  srcW: 868,
  srcH: 584,
  hubX: 431.5,
  hubY: 453.5,
  /** Tip distance from the hub, in the face picture. The baked needle reached ~219. */
  needleLen: 214,
  hubR: 34,
  box: { x: 20, y: 14, w: 420, h: 283 },
};

export const PEDAL = {
  y0: 242,
  focal: 1800,
  cx: 512,
  cy: 512,
  size: 1024,
  maxDeg: 24,
  thickness: 14,
  dest: { x: 1072, y: 418, w: 504, h: 504 },
};

const INK = "#1C161E";
const CREAM_TEXT = "#FFF6E4";
const NEEDLE = "#2A2826";

function loadUi(file) {
  const ImageCtor = globalThis.Image;
  if (typeof ImageCtor !== "function") return null;
  const img = new ImageCtor();
  img.decoding = "async";
  img.src = new URL(`../assets/ui/${file}`, import.meta.url).href;
  return img;
}

const IMG = {
  card: loadUi("card-frame.png"),
  teal: loadUi("btn-teal.png"),
  orange: loadUi("btn-orange.png"),
  cream: loadUi("btn-cream.png"),
  gauge: loadUi("gauge-face-empty.png"),
  car: loadUi("garage-car.png"),
  success: loadUi("success-anton.png"),
  failure: loadUi("failure-anton.png"),
  circle: loadUi("glyph-circle.png"),
  square: loadUi("glyph-square.png"),
  triangle: loadUi("glyph-triangle.png"),
  warning: loadUi("warning-triangle.png"),
  arrow: loadUi("hint-arrow.png"),
  mount: loadUi("pedal-mount.png"),
  lever: loadUi("pedal-lever.png"),
};

export function uiImages() {
  return Object.values(IMG).filter(Boolean);
}

function ready(img) {
  return !!(img && img.complete && img.naturalWidth);
}

function font(px, display) {
  return display ? `${Math.round(px)}px "Rubik Mono One", sans-serif` : `700 ${Math.round(px)}px "Balsamiq Sans", sans-serif`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function paint(ctx, labels, text, x, y, w, h, size, color, display) {
  const shown = String(text);
  let px = size;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  while (px > 13) {
    ctx.font = font(px, display);
    if (ctx.measureText(shown).width <= Math.max(8, w - 20)) break;
    px -= 1;
  }
  ctx.fillStyle = color;
  ctx.fillText(shown, x + w / 2, y + h / 2);
  if (labels) labels.push({ text: shown, x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
}

/** normal | hover | pressed | disabled | selected */
export function controlState(id, pointer, flags = {}) {
  if (flags.disabled) return "disabled";
  if (pointer && pointer.pressed === id) return "pressed";
  if (flags.selected) return "selected";
  if (pointer && pointer.over === id) return "hover";
  return "normal";
}

function nineSlice(ctx, img, x, y, w, h, srcInset, fallback, destInset = srcInset) {
  if (!ready(img) || w < 8 || h < 8) {
    roundRect(ctx, x, y, w, h, Math.min(18, h / 2));
    ctx.fillStyle = fallback;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.stroke();
    return;
  }
  const sw = img.width;
  const sh = img.height;
  const si = Math.min(srcInset, (sw - 2) / 2, (sh - 2) / 2);
  const di = Math.min(destInset, w / 2, h / 2);
  const scx = sw - si * 2;
  const scy = sh - si * 2;
  const dw = Math.max(0, w - di * 2);
  const dh = Math.max(0, h - di * 2);
  const parts = [
    [0, 0, si, si, x, y, di, di],
    [si, 0, scx, si, x + di, y, dw, di],
    [sw - si, 0, si, si, x + w - di, y, di, di],
    [0, si, si, scy, x, y + di, di, dh],
    [sw - si, si, si, scy, x + w - di, y + di, di, dh],
    [0, sh - si, si, si, x, y + h - di, di, di],
    [si, sh - si, scx, si, x + di, y + h - di, dw, di],
    [sw - si, sh - si, si, si, x + w - di, y + h - di, di, di],
  ];
  for (const part of parts) ctx.drawImage(img, ...part);
  if (dw > 0 && dh > 0) {
    ctx.fillStyle = fallback;
    ctx.fillRect(x + di, y + di, dw, dh);
  }
}

const FILL = {
  teal: "#508782",
  orange: "#E9A248",
  cream: "#FFECCE",
  card: "#FFECCE",
};

function buttonFace(kind) {
  if (kind === "teal" || kind === "selected") return { img: IMG.teal, fill: FILL.teal, inset: 34, ink: CREAM_TEXT };
  if (kind === "orange") return { img: IMG.orange, fill: FILL.orange, inset: 34, ink: INK };
  return { img: IMG.cream, fill: FILL.cream, inset: 34, ink: INK };
}

function drawButton(ctx, sink, spec) {
  const state = controlState(spec.id, spec.pointer, spec);
  const face = buttonFace(spec.kind || (spec.selected ? "teal" : "cream"));
  const shift = state === "pressed" ? 5 : state === "hover" || state === "selected" ? -3 : 0;
  ctx.save();
  if (state === "disabled") ctx.globalAlpha = 0.45;
  if (state === "pressed") ctx.filter = "brightness(0.92)";
  ctx.translate(0, shift);
  nineSlice(ctx, face.img, spec.x, spec.y, spec.w, spec.h, face.inset, face.fill);
  if (spec.radio) {
    const r = Math.min(16, spec.h * 0.22);
    ctx.beginPath();
    ctx.arc(spec.x + r + 22, spec.y + spec.h / 2, r, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = face.ink;
    ctx.stroke();
  }
  paint(ctx, sink.labels, spec.text, spec.x, spec.y, spec.w, spec.h, spec.size || Math.min(34, spec.h * 0.42), face.ink, true);
  ctx.restore();
  if (state !== "disabled" && spec.id) sink.spots.push({ id: spec.id, x: spec.x, y: spec.y, w: spec.w, h: spec.h });
}

const FRAME = 36;

export function cardFrame() {
  const margin = 8;
  const outerH = 900 - margin * 2;
  const scale = (outerH - FRAME * 2) / CARD_SRC.h;
  const innerW = CARD_SRC.w * scale;
  const innerH = CARD_SRC.h * scale;
  const w = innerW + FRAME * 2;
  const h = innerH + FRAME * 2;
  const x = (1600 - w) / 2;
  const y = margin;
  return { x, y, w, h, scale, innerX: x + FRAME, innerY: y + FRAME };
}

function place(card, sx, sy, sw, sh) {
  return {
    x: card.innerX + (sx - CARD_SRC.x) * card.scale,
    y: card.innerY + (sy - CARD_SRC.y) * card.scale,
    w: sw * card.scale,
    h: sh * card.scale,
  };
}

function drawCard(ctx) {
  const card = cardFrame();
  nineSlice(ctx, IMG.card, card.x, card.y, card.w, card.h, 80, FILL.card, FRAME);
  return card;
}

function lessonOpen(state, mission) {
  return mission.lesson <= state.save.unlocked;
}

function sideButtons(ctx, sink, state, y) {
  const sound = state.save.settings.sound ? "Звук: вкл" : "Звук: выкл";
  const shake = state.save.settings.shake ? "Тряска: вкл" : "Тряска: выкл";
  drawButton(ctx, sink, {
    id: "sound",
    x: 36,
    y,
    w: 300,
    h: 84,
    text: sound,
    kind: "cream",
    pointer: state.pointer,
    size: 26,
  });
  drawButton(ctx, sink, {
    id: "shake",
    x: 36,
    y: y + 100,
    w: 300,
    h: 84,
    text: shake,
    kind: "cream",
    pointer: state.pointer,
    size: 26,
  });
}

export function drawGarageScreen(ctx, state, sink) {
  ctx.fillStyle = P.PAPER;
  ctx.fillRect(0, 0, 1600, 900);
  const card = drawCard(ctx);
  const title = place(card, 150, 108, 560, 78);
  paint(ctx, sink.labels, "ГАРАЖ", title.x, title.y, title.w, title.h, 54, INK, true);
  const car = place(card, 230, 189, 410, 250);
  if (ready(IMG.car)) ctx.drawImage(IMG.car, car.x, car.y, car.w, car.h);
  const sub = place(card, 160, 468, 540, 52);
  paint(ctx, sink.labels, "ВЫБЕРИ УРОК", sub.x, sub.y, sub.w, sub.h, 32, INK, true);

  const rows = [
    [185, 548, 497, 91],
    [185, 648, 497, 89],
    [185, 747, 497, 90],
    [185, 846, 497, 90],
  ];
  state.missions.forEach((mission, index) => {
    const rect = place(card, ...rows[index]);
    const open = lessonOpen(state, mission);
    const selected = open && state.selected === mission.id;
    drawButton(ctx, sink, {
      id: open ? `mission-${mission.id}` : null,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      text: `УРОК ${mission.lesson}`,
      kind: selected ? "teal" : "cream",
      selected,
      disabled: !open,
      radio: true,
      pointer: state.pointer,
      size: 28,
    });
  });
  const go = place(card, 184, 951, 498, 98);
  drawButton(ctx, sink, {
    id: "go",
    x: go.x,
    y: go.y,
    w: go.w,
    h: go.h,
    text: "ПОЕХАЛИ",
    kind: "orange",
    pointer: state.pointer,
    size: 32,
  });
  sideButtons(ctx, sink, state, 620);
  if (state.save.infinite) {
    drawButton(ctx, sink, {
      id: "mission-infinite",
      x: 1264,
      y: 720,
      w: 300,
      h: 88,
      text: "ПОСЛЕДНИЙ",
      kind: state.selected === "infinite" ? "orange" : "cream",
      selected: state.selected === "infinite",
      pointer: state.pointer,
      size: 26,
    });
  }
}

function pauseMark(ctx, x, y, w, h) {
  const barW = Math.max(10, Math.min(22, w * 0.08));
  const barH = h * 0.55;
  const gap = barW * 0.85;
  const cx = x + w / 2;
  const top = y + h * 0.22;
  ctx.fillStyle = INK;
  roundRect(ctx, cx - gap / 2 - barW, top, barW, barH, 6);
  ctx.fill();
  roundRect(ctx, cx + gap / 2, top, barW, barH, 6);
  ctx.fill();
}

export function drawPauseScreen(ctx, state, sink) {
  ctx.fillStyle = P.PAPER;
  ctx.fillRect(0, 0, 1600, 900);
  const card = drawCard(ctx);
  const title = place(card, 160, 130, 540, 90);
  paint(ctx, sink.labels, "ПАУЗА", title.x, title.y, title.w, title.h, 58, INK, true);
  const mark = place(card, 250, 230, 360, 120);
  pauseMark(ctx, mark.x, mark.y, mark.w, mark.h);
  const rows = [
    ["resume", "ПРОДОЛЖИТЬ", "teal", 175, 441, 515, 153],
    ["retry", "ЗАНОВО", "orange", 175, 623, 515, 155],
    ["to-garage", "В ГАРАЖ", "cream", 175, 807, 515, 156],
  ];
  for (const [id, text, kind, sx, sy, sw, sh] of rows) {
    const rect = place(card, sx, sy, sw, sh);
    drawButton(ctx, sink, {
      id,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      text,
      kind,
      pointer: state.pointer,
      size: 32,
    });
  }
  sideButtons(ctx, sink, state, 620);
}

function starsLine(graded) {
  return `${"★".repeat(graded.stars)}${"☆".repeat(3 - graded.stars)}`;
}

function nextLessonOpen(state) {
  const order = ["lesson1", "lesson2", "lesson3", "lesson4"];
  const idx = order.indexOf(state.session.mission.id);
  if (idx < 0 || idx >= order.length - 1) return false;
  return state.save.unlocked >= idx + 2;
}

export function drawResultScreen(ctx, state, sink) {
  const sim = state.session.sim;
  const graded = state.session.result;
  const success = graded.success === true && !sim.infinite;
  ctx.fillStyle = P.PAPER;
  ctx.fillRect(0, 0, 1600, 900);
  const card = drawCard(ctx);
  const title = place(card, 130, 118, 600, 88);
  let heading = success ? "ДОЕХАЛИ!" : "НЕ ДОЕХАЛИ";
  if (sim.infinite) heading = "СМЕТА";
  paint(ctx, sink.labels, heading, title.x, title.y, title.w, title.h, success ? 48 : 40, INK, true);

  const medal = place(card, 286, 278, 294, 250);
  const face = success ? IMG.success : IMG.failure;
  if (ready(face)) ctx.drawImage(face, medal.x, medal.y + 10, medal.w, medal.h);

  if (sim.infinite) {
    const bill = repairInvoice(sim.stats, sim.t);
    const lines = bill.lines.slice(0, 3).map(([name, cost]) => `${name}  ${cost}`);
    lines.push(`Итого ${bill.total}`);
    lines.forEach((line, index) => {
      const row = place(card, 150, 560 + index * 36, 560, 34);
      paint(ctx, sink.labels, line, row.x, row.y, row.w, row.h, 20, INK, false);
    });
  } else {
    const line1 = success ? "Машина цела" : "Антон задумался...";
    const line2 = success ? (graded.badge ? "Почти не понадобился" : "Антон доволен") : "Попробуем ещё раз?";
    const a = place(card, 140, 560, 580, 42);
    const b = place(card, 140, 606, 580, 42);
    paint(ctx, sink.labels, line1, a.x, a.y, a.w, a.h, 28, INK, false);
    paint(ctx, sink.labels, line2, b.x, b.y, b.w, b.h, 28, INK, false);
    if (success) {
      const stars = place(card, 180, 656, 500, 40);
      paint(ctx, sink.labels, starsLine(graded), stars.x, stars.y, stars.w, stars.h, 28, INK, false);
    }
  }

  if (success) {
    const next = place(card, 175, 713, 515, 134);
    const garage = place(card, 175, 864, 515, 120);
    const open = nextLessonOpen(state);
    drawButton(ctx, sink, {
      id: open ? "next" : null,
      x: next.x,
      y: next.y,
      w: next.w,
      h: next.h,
      text: "ДАЛЬШЕ",
      kind: "teal",
      disabled: !open,
      pointer: state.pointer,
      size: 32,
    });
    drawButton(ctx, sink, {
      id: "to-garage",
      x: garage.x,
      y: garage.y,
      w: garage.w,
      h: garage.h,
      text: "В ГАРАЖ",
      kind: "cream",
      pointer: state.pointer,
      size: 32,
    });
    return;
  }
  const again = place(card, 174, 713, 517, 135);
  const garage = place(card, 174, 865, 517, 120);
  drawButton(ctx, sink, {
    id: "retry",
    x: again.x,
    y: again.y,
    w: again.w,
    h: again.h,
    text: "ЗАНОВО",
    kind: "orange",
    pointer: state.pointer,
    size: 32,
  });
  drawButton(ctx, sink, {
    id: "to-garage",
    x: garage.x,
    y: garage.y,
    w: garage.w,
    h: garage.h,
    text: "В ГАРАЖ",
    kind: "cream",
    pointer: state.pointer,
    size: 32,
  });
}

/** Math degrees: 0 points right, 90 points up, 180 points left. Patience 0 is the green end. */
export function patienceNeedleDegrees(patience) {
  const t = Math.max(0, Math.min(100, Number(patience) || 0)) / 100;
  return 180 * (1 - t);
}

export function pedalHingeDegrees(brake) {
  const t = Math.max(0, Math.min(1, Number(brake) || 0));
  return t * PEDAL.maxDeg;
}

function drawNeedle(ctx, box, patience) {
  const deg = patienceNeedleDegrees(patience);
  const sx = box.w / GAUGE.srcW;
  const sy = box.h / GAUGE.srcH;
  const hubX = box.x + GAUGE.hubX * sx;
  const hubY = box.y + GAUGE.hubY * sy;
  const len = GAUGE.needleLen * sx;
  const rad = (-deg * Math.PI) / 180;
  ctx.save();
  ctx.translate(hubX, hubY);
  ctx.rotate(rad);
  ctx.fillStyle = NEEDLE;
  ctx.beginPath();
  ctx.moveTo(len, 0);
  ctx.lineTo(GAUGE.hubR * 0.35 * sx, -13 * sy);
  ctx.lineTo(GAUGE.hubR * 0.35 * sx, 13 * sy);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, GAUGE.hubR * sx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const tip = (deg * Math.PI) / 180;
  return {
    deg,
    hubX,
    hubY,
    tipX: hubX + Math.cos(tip) * len,
    tipY: hubY - Math.sin(tip) * len,
  };
}

export function drawGauge(ctx, labels, patience) {
  const box = GAUGE.box;
  if (ready(IMG.gauge)) ctx.drawImage(IMG.gauge, box.x, box.y, box.w, box.h);
  else {
    roundRect(ctx, box.x, box.y, box.w, box.h * 0.72, 28);
    ctx.fillStyle = FILL.cream;
    ctx.fill();
  }
  const word = {
    x: box.x + (190 / GAUGE.srcW) * box.w,
    y: box.y + (98 / GAUGE.srcH) * box.h,
    w: (488 / GAUGE.srcW) * box.w,
    h: (52 / GAUGE.srcH) * box.h,
  };
  paint(ctx, labels, "ТЕРПЕНИЕ", word.x, word.y, word.w, word.h, 28, INK, true);
  return drawNeedle(ctx, box, patience);
}

function projectPedalRow(deg, y, z) {
  const th = (deg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const yy = y - PEDAL.y0;
  const ry = PEDAL.y0 + yy * c - z * s;
  const rz = yy * s + z * c;
  const scale = PEDAL.focal / (PEDAL.focal + rz);
  return { sy: PEDAL.cy + (ry - PEDAL.cy) * scale, scale };
}

function drawWarped(ctx, img, dest, deg, z) {
  if (!ready(img)) return;
  const start = 206;
  const end = 830;
  const step = 2;
  for (let y = start; y < end; y += step) {
    const a = projectPedalRow(deg, y, z);
    const b = projectPedalRow(deg, y + step, z);
    const top = dest.y + (Math.min(a.sy, b.sy) / PEDAL.size) * dest.h;
    const bot = dest.y + (Math.max(a.sy, b.sy) / PEDAL.size) * dest.h;
    const scale = (a.scale + b.scale) / 2;
    if (scale < 0.2 || scale > 1.5) continue;
    const dw = dest.w * scale;
    const dx = dest.x + ((PEDAL.cx * (1 - scale)) / PEDAL.size) * dest.w;
    ctx.drawImage(img, 0, y, PEDAL.size, step + 2, dx, top - 1, dw, Math.max(2, bot - top + 2));
  }
}

const pedalFrames = new Map();

function pedalFrame(deg) {
  const key = Math.round(deg * 2) / 2;
  const cached = pedalFrames.get(key);
  if (cached) return cached;
  if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
  const buffer = document.createElement("canvas");
  buffer.width = PEDAL.size;
  buffer.height = PEDAL.size;
  const btx = buffer.getContext("2d");
  const dest = { x: 0, y: 0, w: PEDAL.size, h: PEDAL.size };
  btx.imageSmoothingEnabled = true;
  drawWarped(btx, IMG.lever, dest, key, 0);
  btx.drawImage(IMG.mount, 0, 0);
  pedalFrames.set(key, buffer);
  return buffer;
}

export function pedalHitBox(dest = PEDAL.dest) {
  return {
    id: "pedal",
    x: dest.x + (220 / PEDAL.size) * dest.w,
    y: dest.y + (470 / PEDAL.size) * dest.h,
    w: (620 / PEDAL.size) * dest.w,
    h: (340 / PEDAL.size) * dest.h,
  };
}

export function pedalPadPoint(brake, dest = PEDAL.dest) {
  const deg = pedalHingeDegrees(brake);
  const srcY = 680;
  const th = (deg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const yy = srcY - PEDAL.y0;
  const ry = PEDAL.y0 + yy * c;
  const rz = yy * s;
  const scale = PEDAL.focal / (PEDAL.focal + rz);
  const screenY = PEDAL.cy + (ry - PEDAL.cy) * scale;
  const screenX = PEDAL.cx;
  return {
    deg,
    x: dest.x + (screenX / PEDAL.size) * dest.w,
    y: dest.y + (screenY / PEDAL.size) * dest.h,
  };
}

function drawFallbackPedal(ctx, dest, deg) {
  const pivotX = dest.x + (PEDAL.cx / PEDAL.size) * dest.w;
  const pivotY = dest.y + (PEDAL.y0 / PEDAL.size) * dest.h;
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate((deg * Math.PI) / 180);
  roundRect(ctx, -150, 40, 300, 120, 18);
  ctx.fillStyle = P.RED;
  ctx.fill();
  ctx.fillStyle = "#8A8E96";
  ctx.fillRect(-16, 0, 32, 70);
  ctx.restore();
}

export function drawPedalRig(ctx, brake) {
  const deg = pedalHingeDegrees(brake);
  const dest = PEDAL.dest;
  if (!ready(IMG.lever) || !ready(IMG.mount)) {
    drawFallbackPedal(ctx, dest, deg);
    return { deg, pad: pedalPadPoint(brake, dest) };
  }
  const frame = pedalFrame(deg);
  if (frame) {
    ctx.drawImage(frame, dest.x, dest.y, dest.w, dest.h);
  } else {
    ctx.save();
    ctx.filter = "brightness(0.45)";
    drawWarped(ctx, IMG.lever, dest, deg, PEDAL.thickness);
    ctx.filter = "none";
    drawWarped(ctx, IMG.lever, dest, deg, 0);
    ctx.drawImage(IMG.mount, dest.x, dest.y, dest.w, dest.h);
    ctx.restore();
  }
  return { deg, pad: pedalPadPoint(brake, dest) };
}

const GLYPH = { circle: "circle", square: "square", triangle: "triangle" };

export function drawDriveChrome(ctx, state, sink, brake) {
  const sim = state.session.sim;
  const mission = state.session.mission;
  const needle = drawGauge(ctx, sink.labels, sim.patience);
  const glyph = GLYPH[moodGlyph(sim.patience, sim.outburstT > 0)] || "circle";
  const tile = IMG[glyph];
  if (ready(tile)) ctx.drawImage(tile, 452, 18, 72, 70);
  if (sim.outburstT > 0 && ready(IMG.warning)) ctx.drawImage(IMG.warning, 452, 96, 64, 60);

  const chip = { x: 536, y: 18, w: 360, h: 78 };
  nineSlice(ctx, IMG.cream, chip.x, chip.y, chip.w, chip.h, 34, FILL.cream);
  const lesson = mission.infinite ? "∞" : String(mission.lesson).padStart(2, "0");
  paint(ctx, sink.labels, `УРОК ${lesson}`, chip.x + 8, chip.y + 6, chip.w - 16, 34, 20, INK, true);
  const goal = mission.infinite ? `${Math.floor(sim.s)} м` : mission.objective;
  paint(ctx, sink.labels, goal, chip.x + 8, chip.y + 44, chip.w - 16, 32, 18, INK, false);
  if (!mission.infinite) {
    const p = Math.max(0, Math.min(1, sim.s / mission.length));
    ctx.fillStyle = "#E7DCC6";
    ctx.fillRect(chip.x + 18, chip.y + chip.h + 8, chip.w - 36, 8);
    ctx.fillStyle = P.PAT_GREEN;
    ctx.fillRect(chip.x + 18, chip.y + chip.h + 8, Math.max(0, (chip.w - 36) * p), 8);
  }

  const pause = { x: 924, y: 22, w: 96, h: 90 };
  const pauseState = controlState("pause", state.pointer, {});
  ctx.save();
  ctx.translate(0, pauseState === "pressed" ? 4 : pauseState === "hover" ? -2 : 0);
  nineSlice(ctx, IMG.cream, pause.x, pause.y, pause.w, pause.h, 28, FILL.cream);
  pauseMark(ctx, pause.x, pause.y, pause.w, pause.h * 0.8);
  ctx.restore();
  sink.spots.push({ id: "pause", ...pause });

  const pedal = drawPedalRig(ctx, brake);
  if (state.hint && state.session.phase === "drive" && ready(IMG.arrow)) {
    ctx.save();
    ctx.translate(1288, 560);
    ctx.rotate(0.9);
    ctx.drawImage(IMG.arrow, -36, -28, 72, 64);
    ctx.restore();
  }
  return { needle, pedalDeg: pedal.deg, pad: pedal.pad };
}
