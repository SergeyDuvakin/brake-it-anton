/**
 * Original ink for Brake It, Anton.
 * One forward projection. Poses and props change with the situation.
 */

import { CFG, PALETTE as P } from "./config.js";
import { expressionId } from "./physics.js";
import {
  drawDriveChrome,
  drawGarageScreen,
  drawPauseScreen,
  drawResultScreen,
  pedalHitBox,
  uiImages,
} from "./ui.js";
import { VIEW, project } from "./road.js";
import { anchorKind, farDs, groundDs, paintFarToNear } from "./anchors.js";
import { gaitOffset } from "./gait.js";
import { actorTravel, hazardWorldX, renderPose } from "./sim.js";
import {
  drawCastBin,
  drawCastCargo,
  drawCastDog,
  drawCastHole,
  drawCastLid,
  drawCastPed,
  drawCastScenery,
  sceneryKey,
  worldImages,
} from "./cast.js";

/** World car scale. Do not shrink this to fake a gap in front of a pedestrian. */
export const CAR_SPRITE_SCALE = 1.42;
/** Radians of brake dive at a full press. Shared by the sprite and its anchor. */
export const CAR_DIVE = 0.14;
/** Unscaled top of the body. That edge is the bumper. */
export const CAR_NOSE_LOCAL_Y = -62;
export const CAR_BODY_W = 80;
export const CAR_BODY_H = 112;
/** Unscaled y of the pedestrian's feet before they are parked on the ground point. */
export const PED_FOOT_LOCAL_Y = 48;
/** Unscaled y of each family's road contact, before it is parked on the anchor. */
export const DOG_PAW_LOCAL_Y = 32;
export const BIN_BOTTOM_LOCAL_Y = 18;
export const LID_BOTTOM_LOCAL_Y = 16;
export const NPC_BOTTOM_LOCAL_Y = 44;

/**
 * The player's hitbox on the screen. Nose is the bumper, tail is the
 * near edge, and the two sides are the body half-width. People and dogs
 * are not forced into a patch like this: they stand up from their feet.
 */
export function playerChassis(xm) {
  const nose = CFG.carHalfFront;
  const tail = -CFG.carHalfBack;
  const half = CFG.carHalfW;
  return {
    nose: project(nose, xm),
    tail: project(tail, xm),
    noseL: project(nose, xm - half),
    noseR: project(nose, xm + half),
    tailL: project(tail, xm - half),
    tailR: project(tail, xm + half),
  };
}

/**
 * Draw origin for the ink title car. Its nose stays on the bumper.
 * The world cars do not use this scale: a uniform screen blit cannot
 * be both 3.4 m long and 1.7 m wide under this camera.
 */
export function carDrawOrigin(bumperX, bumperY, brakeInput, crashT = 0, scale = CAR_SPRITE_SCALE) {
  const dive = (brakeInput || 0) * CAR_DIVE;
  const squash = 1 - Math.min(0.16, crashT || 0);
  const ly = CAR_NOSE_LOCAL_Y * scale * squash;
  return {
    x: bumperX + Math.sin(dive) * ly,
    y: bumperY - Math.cos(dive) * ly,
  };
}

/**
 * Approved top-down plans (heading 0). The hood is the small sprite y.
 * Chassis length / art length, then one screen rectangle from the nose
 * to the tail of the same `project()` as the road. Width follows the
 * file, so a side lane does not shear or squash the drawing. The whole
 * mask is drawn, mirrors included. Length matches the chassis. The
 * drawing is a little wider for its length than the 3.4×1.7 m
 * rectangle, so the mirrors sit about 12 cm outside each side and the
 * doors land on the rectangle.
 */
export const PLAN_ART = {
  yellow: { artLen: 806, pivot: 500 },
  coral: { artLen: 855, pivot: 500 },
};

export function planMetresPerPixel(lengthM, artLen) {
  return lengthM / artLen;
}

/** Sprite y grows toward the tail. Smaller y is the nose, larger ds. */
export function planRowDs(centerDs, spriteY, pivotY, lengthM, artLen) {
  return centerDs - (spriteY - pivotY) * (lengthM / artLen);
}

function loadCarImage(file) {
  const ImageCtor = globalThis.Image;
  if (typeof ImageCtor !== "function") return null;
  const img = new ImageCtor();
  img.decoding = "async";
  img.src = new URL(`../assets/cars/${file}`, import.meta.url).href;
  return img;
}

const YELLOW_STRAIGHT = loadCarImage("yellow-car-game-straight.png");
const YELLOW_BRAKE = loadCarImage("yellow-car-brake.png");
const YELLOW_CRASH = loadCarImage("yellow-car-collision.png");
const CORAL_STRAIGHT = loadCarImage("coral-wagon-straight.png");

function imageReady(img) {
  return !!(img && img.complete && img.naturalWidth);
}

export function whenCarsReady() {
  const imgs = [YELLOW_STRAIGHT, YELLOW_BRAKE, YELLOW_CRASH, CORAL_STRAIGHT, ...worldImages(), ...uiImages()].filter(Boolean);
  if (!imgs.length) return Promise.resolve(false);
  return Promise.all(imgs.map((img) => (img.decode ? img.decode() : Promise.resolve()))).then(() => true);
}

/**
 * One rectangle for the whole plan. The nose and the tail stay on the
 * projected ground of those distances, and both axes use that one height.
 * Slicing the file by depth made the tail wider than the hood and shoved
 * a side-lane car into a trapezoid, so the drawing no longer matched itself.
 * The bitmap is not prewarped. Mirrors stay in the frame.
 */
export function planBlitBox(centerDs, xm, lengthM, artLen, imageWidth, pivot = 500) {
  const yTop = pivot - artLen / 2;
  const nose = project(planRowDs(centerDs, yTop, pivot, lengthM, artLen), xm);
  const tail = project(planRowDs(centerDs, yTop + artLen, pivot, lengthM, artLen), xm);
  const mid = project(centerDs, xm);
  const h = Math.abs(tail.y - nose.y);
  const w = h * (imageWidth / artLen);
  return {
    x: mid.x - w / 2,
    y: Math.min(nose.y, tail.y),
    w,
    h,
    sy: yTop,
    noseY: nose.y,
    tailY: tail.y,
  };
}

export function drawPlanSprite(ctx, img, spec) {
  if (!imageReady(img)) return false;
  const { centerDs, xm, lengthM, artLen, pivot = 500 } = spec;
  const box = planBlitBox(centerDs, xm, lengthM, artLen, img.width, pivot);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, box.sy, img.width, artLen, box.x, box.y, box.w, box.h);
  ctx.restore();
  return true;
}

/** Local y shift that sits the feet on the projected ground point. */
export function pedestrianFootShift() {
  return -PED_FOOT_LOCAL_Y;
}

/**
 * Bumper-to-feet separation for a pedestrian.
 * `screen` is pixels: positive when the bumper is closer to the camera than the feet.
 * `world` is metres from the bumper to the near face of the hitbox.
 */
export function bumperFootGap(sim, hazard) {
  const bumper = project(CFG.carHalfFront, sim.x);
  const foot = project(hazard.s - (hazard.halfL || 0) - sim.s, hazardWorldX(hazard, sim));
  return {
    world: hazard.s - hazard.halfL - (sim.s + CFG.carHalfFront),
    screen: bumper.y - foot.y,
    bumperY: bumper.y,
    footY: foot.y,
  };
}

let spots = [];
let labels = [];

function font(px, display = false) {
  return display ? `${px}px "Rubik Mono One", sans-serif` : `700 ${px}px "Balsamiq Sans", sans-serif`;
}

function ink(ctx, width = 6) {
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
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

function paintCenter(ctx, text, x, y, w, h, size, color = P.INK, display = false, record = false) {
  const shown = String(text);
  let px = size;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  while (px > 14) {
    ctx.font = font(px, display);
    if (ctx.measureText(shown).width <= Math.max(8, w - 18)) break;
    px -= 1;
  }
  ctx.fillStyle = color;
  ctx.fillText(shown, x + w / 2, y + h / 2);
  if (record) labels.push({ text: shown, x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
}

function button(ctx, id, x, y, w, h, text, kind = "paper") {
  spots.push({ id, x, y, w, h });
  roundRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = kind === "primary" ? P.TEAL : kind === "ink" ? P.INK : kind === "red" ? P.RED : P.PAPER;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();
  paintCenter(ctx, text, x, y, w, h, h > 90 ? 32 : 24, kind === "ink" || kind === "red" ? P.PAPER : P.INK, false, true);
}

function hash(n) {
  let x = Math.imul(n | 0, 0x9e3779b1);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function panel(ctx, x, y, w, h, fill) {
  roundRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = fill;
  ctx.fill();
  ink(ctx, 8);
  ctx.stroke();
}

export function render(ctx, state) {
  spots = [];
  labels = [];
  const sink = { spots, labels };
  let readout = { needleDeg: null, pedalDeg: null, hubX: null, hubY: null, tipX: null, tipY: null, padX: null, padY: null };
  ctx.clearRect(0, 0, 1600, 900);
  ctx.fillStyle = P.PAPER;
  ctx.fillRect(0, 0, 1600, 900);
  if (state.screen === "garage") drawGarageScreen(ctx, state, sink);
  else if (state.screen === "title") drawTitle(ctx, state);
  else readout = drawPlay(ctx, state, sink);
  if (state.notice) {
    roundRect(ctx, 360, 18, 880, 44, 12);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    paintCenter(ctx, state.notice, 360, 18, 880, 44, 18, P.INK, false, true);
  }
  return { spots, labels, readout };
}

function drawTitle(ctx, state) {
  const boil = state.save.settings.reducedMotion ? 0 : Math.floor(state.now / 110) % 2;
  drawWorld(ctx, state.preview, boil, false, 1, !!state.save.settings.reducedMotion);
  panel(ctx, 1056, 24, 520, 852, P.CABIN);
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(1056, 24, 520, 168);
  ink(ctx, 6);
  ctx.beginPath();
  ctx.moveTo(1056, 192);
  ctx.lineTo(1576, 192);
  ctx.stroke();
  paintCenter(ctx, "Brake It, Anton", 1076, 40, 480, 78, 34, P.INK, true, true);
  paintCenter(ctx, "Он газует. Ты жмёшь тормоз.", 1076, 122, 480, 40, 20, P.INK, false, true);
  ctx.save();
  ctx.translate(0, 28);
  drawAnton(ctx, "preen", boil, 0, state.preview);
  ctx.restore();
  button(ctx, "start", 1092, 640, 448, 112, "В урок", "primary");
  button(ctx, "garage", 1092, 768, 448, 76, "Гараж", "paper");
}


function drawPlay(ctx, state, sink) {
  const session = state.session;
  const sim = session.sim;
  const boil = state.save.settings.reducedMotion ? 0 : Math.floor(state.now / 110) % 2;
  const motion = !state.save.settings.reducedMotion;
  const mag = state.save.settings.shake && motion ? Math.min(sim.shake, 5) : 0;
  const held = session.phase === "drive" && (session.brakeHeld || session.keysDown.has("Space"));
  const visual = held ? Math.max(sim.brakeInput, 0.2) : 0;
  const driving = session.phase === "drive";
  const brake = driving ? sim.brakeInput : 0;

  ctx.save();
  if (mag) ctx.translate((hash(sim.t * 60) - 0.5) * mag, (hash(sim.t * 40) - 0.5) * mag * 0.5);
  drawWorld(ctx, sim, boil, motion, state.alpha ?? 1, !!state.save.settings.reducedMotion, !!state.legacyAnchors);
  ctx.restore();
  drawCabin(ctx, sim, state, boil, visual);
  const showHud = driving || session.phase === "countdown";
  const chrome = showHud ? drawDriveChrome(ctx, state, sink, brake) : null;
  if (driving) {
    spots.push({ id: "anton", x: 1100, y: 90, w: 420, h: 340 });
    spots.push(pedalHitBox());
  }
  if (session.phase === "countdown") {
    roundRect(ctx, 640, 150, 120, 84, 14);
    ctx.fillStyle = P.PAPER;
    ctx.fill();
    ink(ctx, 6);
    ctx.stroke();
    paintCenter(ctx, String(session.countdown || 1), 640, 150, 120, 84, 42, P.INK, true, false);
  }
  const needsTap = sim.attention === "phone" || sim.attention === "drowsy" || sim.attention === "asleep";
  if (driving && needsTap) {
    roundRect(ctx, 560, 128, 340, 40, 12);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    paintCenter(ctx, sim.attention === "phone" ? "Ткни в него · F" : "Разбуди · F", 560, 128, 340, 40, 18, P.INK, false, true);
  } else if (state.hint && driving) {
    roundRect(ctx, 560, 128, 340, 40, 12);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    paintCenter(ctx, "Он газует. Ты жмёшь тормоз.", 560, 128, 340, 40, 18, P.INK, false, true);
  }
  if (session.phase === "pause") drawPauseScreen(ctx, state, sink);
  if (session.phase === "result") drawResultScreen(ctx, state, sink);
  const needle = chrome?.needle;
  return {
    needleDeg: needle ? needle.deg : null,
    pedalDeg: chrome ? chrome.pedalDeg : session.phase === "result" ? 0 : null,
    hubX: needle?.hubX ?? null,
    hubY: needle?.hubY ?? null,
    tipX: needle?.tipX ?? null,
    tipY: needle?.tipY ?? null,
    padX: chrome?.pad?.x ?? null,
    padY: chrome?.pad?.y ?? null,
  };
}

/**
 * One camera sample for the road, the car, and every actor.
 * Screen positions are not linear in alpha; the meters are.
 * Pointers and collision do not read this.
 */
export function placedScene(sim, alpha = 1, legacy = false) {
  const pose = renderPose(sim, alpha);
  const car = project(CFG.carHalfFront, pose.x);
  const actors = [];
  for (const h of sim.hazards || []) {
    const dist = h.s - pose.s;
    const hx = pose.hazardX.has(h.id) ? pose.hazardX.get(h.id) : hazardWorldX(h, sim);
    const travel = pose.hazardTravel?.has(h.id) ? pose.hazardTravel.get(h.id) : actorTravel(h, sim);
    const kind = anchorKind(h.type);
    const near = legacy ? dist : groundDs(h, pose.s);
    const far = legacy ? dist : farDs(h, pose.s);
    actors.push({
      id: h.id,
      dist,
      hx,
      travel,
      kind,
      legacy,
      groundDs: near,
      farDs: far,
      spot: project(near, hx),
      farSpot: project(far, hx),
    });
  }
  return { pose, car, actors };
}

function drawWorld(ctx, sim, boil, motion, alpha = 1, reduced = false, legacy = false) {
  const scene = placedScene(sim, alpha, legacy);
  const cam = scene.pose.s;
  const actorAt = new Map(scene.actors.map((actor) => [actor.id, actor]));
  const box = VIEW.panel;
  const far = 1600;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.fillStyle = "#9BC56F";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(box.x, box.y, box.w, VIEW.vanishY - box.y + 8);

  fillQuad(ctx, VIEW.near, far, -VIEW.sideHalf, -VIEW.roadHalf, "#E4D7C4");
  fillQuad(ctx, VIEW.near, far, VIEW.roadHalf, VIEW.sideHalf, "#E4D7C4");
  fillQuad(ctx, VIEW.near, far, -VIEW.roadHalf, VIEW.roadHalf, P.ROAD);
  strokeRay(ctx, -VIEW.roadHalf, far, P.INK, 7);
  strokeRay(ctx, VIEW.roadHalf, far, P.INK, 7);

  const curb = 5;
  for (let s = Math.floor((cam + VIEW.near) / curb) * curb; s < cam + VIEW.look; s += curb) {
    for (const side of [-1, 1]) {
      const spot = project(s - cam, side * (VIEW.roadHalf + 0.08));
      if (spot.y < 40 || spot.y > 900) continue;
      ctx.fillStyle = P.PAPER;
      ctx.fillRect(spot.x - 5 * spot.scale, spot.y, 10 * spot.scale, 7 * spot.scale);
    }
  }

  for (const zone of sim.slippery || []) {
    const ds0 = zone.s0 - cam;
    const ds1 = zone.s1 - cam;
    if (ds1 < VIEW.near || ds0 > VIEW.look) continue;
    fillQuad(ctx, Math.max(ds0, VIEW.near), Math.min(ds1, VIEW.look), -VIEW.roadHalf * 0.92, VIEW.roadHalf * 0.92, "rgba(120,170,190,0.45)");
    if (ds0 > 2 && ds0 < VIEW.look - 6) {
      const spot = project(ds0, 0);
      roundRect(ctx, spot.x - 52, spot.y - 16, 104, 32, 8);
      ctx.fillStyle = P.YEL;
      ctx.fill();
      ink(ctx, 3);
      ctx.stroke();
      paintCenter(ctx, "МОКРО", spot.x - 52, spot.y - 16, 104, 32, 16, P.INK, false, false);
    }
  }

  for (let s = Math.floor((cam + VIEW.near) / 9) * 9; s < cam + VIEW.look; s += 9) {
    fillQuad(ctx, s - cam, s - cam + 3.4, -0.18, 0.18, P.PAPER);
  }
  for (let s = Math.floor((cam - 6) / 17) * 17; s < cam + VIEW.look; s += 17) {
    const ds = s - cam;
    const a = project(ds, -0.9);
    const b = project(ds + 1.4, 0.4);
    ctx.strokeStyle = "rgba(28,22,30,0.35)";
    ctx.lineWidth = Math.max(1, 2 * a.scale);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let s = Math.floor((cam - 4) / 36) * 36; s < cam + VIEW.look; s += 36) {
    const spot = project(s - cam, 0.55);
    if (spot.y < 50 || spot.y > 880) continue;
    ctx.beginPath();
    ctx.ellipse(spot.x, spot.y, 16 * spot.scale, 8 * spot.scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#3E4658";
    ctx.fill();
    ink(ctx, 2);
    ctx.stroke();
  }

  for (const skid of sim.skids || []) {
    const spot = project(skid.s - cam, skid.x);
    if (spot.y < 40 || spot.y > 880) continue;
    ctx.strokeStyle = "rgba(28,22,30,0.45)";
    ctx.lineWidth = 5 * spot.scale;
    ctx.beginPath();
    ctx.moveTo(spot.x - 14 * spot.scale, spot.y);
    ctx.lineTo(spot.x - 10 * spot.scale, spot.y + 26 * spot.scale);
    ctx.moveTo(spot.x + 14 * spot.scale, spot.y);
    ctx.lineTo(spot.x + 10 * spot.scale, spot.y + 26 * spot.scale);
    ctx.stroke();
  }

  const props = [];
  for (let s = Math.floor((cam - 8) / 14) * 14; s < cam + VIEW.look; s += 14) {
    const n = Math.round(s / 14);
    for (const side of [-1, 1]) {
      props.push({ ds: s - cam, xm: side * sceneryAnchor(), n, side, band: districtAt(s), kind: "prop" });
    }
  }
  for (const h of sim.hazards) {
    const placed = actorAt.get(h.id);
    const dist = placed.dist;
    if (h.resolved && dist < -10) continue;
    if (dist < VIEW.near || dist > VIEW.look) continue;
    props.push({ ds: legacy ? dist : placed.groundDs, layer: 1, xm: placed.hx, kind: "hazard", h, placed });
  }
  // The nose, not the tail. A body whose near face is still ahead of the
  // bumper is farther up the screen and paints first. A body on the nose
  // or closer paints after the car: its feet sit on the yellow because
  // the near face has reached the bumper, and covering them made the
  // torso look as if it were standing on the roof. The tail stays the
  // hitbox's near edge; it is not the sort key.
  if (!legacy) props.push({ ds: CFG.carHalfFront, layer: 0, kind: "car" });
  const ordered = paintFarToNear(props);
  for (const item of ordered) {
    if (item.kind === "prop") drawProp(ctx, item, boil);
    else if (item.kind === "car") drawCar(ctx, sim, boil, scene.pose, legacy);
    else drawHazard(ctx, sim, item.h, boil, item.placed, reduced);
  }
  if (legacy) drawCar(ctx, sim, boil, scene.pose, true);

  if (motion && sim.v > 11) {
    const shift = (cam * 28) % 70;
    ctx.strokeStyle = "rgba(28,22,30,0.22)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const y = 800 - ((i * 80 + shift) % 220);
      ctx.beginPath();
      ctx.moveTo(34, y);
      ctx.lineTo(58, y + 8);
      ctx.moveTo(1024, y + 6);
      ctx.lineTo(1000, y + 14);
      ctx.stroke();
    }
  }
  ctx.restore();
  roundRect(ctx, box.x, box.y, box.w, box.h, 8);
  ink(ctx, 8);
  ctx.stroke();
}

function fillQuad(ctx, ds0, ds1, x0, x1, color) {
  const a = project(ds0, x0);
  const b = project(ds0, x1);
  const c = project(ds1, x1);
  const d = project(ds1, x0);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeRay(ctx, xm, far, color, width) {
  const a = project(VIEW.near, xm);
  const b = project(far, xm);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function districtAt(worldS) {
  return ["yard", "market", "edge"][Math.abs(Math.floor(worldS / 220)) % 3];
}

/**
 * Metres from the centre line to the scenery anchor.
 * The anchor is the middle of the drawing. The widest house base
 * reaches 2.72 m toward the road, so the anchor sits that far
 * outside the curb. The inner edge of the base then lands on the
 * sidewalk, not on the asphalt.
 */
export const SCENERY_REACH = 2.72;
export const SCENERY_GAP = 0.28;

export function sceneryAnchor() {
  return VIEW.roadHalf + SCENERY_GAP + SCENERY_REACH;
}

function shadowAt(ctx, x, y, sc, rx) {
  ctx.save();
  ctx.translate(x, y + 4 * sc);
  ctx.scale(1, 0.42);
  ctx.fillStyle = "rgba(28,22,30,0.2)";
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * sc, 16 * sc, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawProp(ctx, item, boil) {
  const spot = project(item.ds, item.xm);
  if (spot.y < -30 || spot.y > 940) return;
  const sc = Math.max(0.42, Math.min(1.2, spot.scale));
  const color = [P.PINK, P.BLUE, P.ORANGE, P.YEL, P.TEAL][Math.abs(item.n + item.side) % 5];
  const cycle = Math.abs(item.n * 2 + (item.side > 0 ? 1 : 4)) % 7;
  if (drawCastScenery(ctx, sceneryKey(item), spot.x, spot.y, spot.scale)) return;
  shadowAt(ctx, spot.x, spot.y, sc, 46);
  // Houses and trees stay put. The 110 ms boil is only for people, dogs and Anton.
  if (item.band === "market") {
    drawBuilding(ctx, spot.x, spot.y, sc, cycle % 2 === 0 ? 1 : 4, color, 0, true);
    return;
  }
  if (item.band === "edge") {
    if (cycle % 3 === 0) drawTree(ctx, spot.x, spot.y, sc, 0, item.n);
    else drawBuilding(ctx, spot.x, spot.y, sc * 1.1, 3, color, 0, false);
    return;
  }
  if (cycle === 0 || cycle === 5) drawTree(ctx, spot.x, spot.y, sc, 0, item.n);
  else if (cycle === 1) drawBuilding(ctx, spot.x, spot.y, sc, 0, color, 0, Math.abs(item.n) % 3 === 0);
  else if (cycle === 2) drawBuilding(ctx, spot.x, spot.y, sc, 1, color, 0, false);
  else if (cycle === 3) drawBuilding(ctx, spot.x, spot.y, sc, 4, color, 0, false);
  else if (cycle === 4) drawBuilding(ctx, spot.x, spot.y, sc, 0, color, 0, true);
  else drawBuilding(ctx, spot.x, spot.y, sc, 2, color, 0, false);
}

function drawBuilding(ctx, x, y, sc, kind, color, boil, laundry) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  const bob = boil ? 1.2 : 0;
  if (kind === 1) {
    roundRect(ctx, -62, -8, 124, 70, 4);
    ctx.fillStyle = color;
    ctx.fill();
    ink(ctx, 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-70, -6);
    ctx.lineTo(-78, -36);
    ctx.lineTo(78, -28 + bob);
    ctx.lineTo(70, -4);
    ctx.closePath();
    ctx.fillStyle = P.RED;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    ctx.fillStyle = P.PAPER;
    roundRect(ctx, -20, 16, 40, 46, 3);
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-40, -48);
    ctx.quadraticCurveTo(0, -34, 40, -46);
    ctx.stroke();
  } else if (kind === 2) {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = -3; i <= 3; i++) {
      ctx.moveTo(i * 16, -28);
      ctx.lineTo(i * 16, 24);
    }
    ctx.moveTo(-52, -8);
    ctx.lineTo(52, -8);
    ctx.stroke();
    roundRect(ctx, -14, -6, 28, 32, 2);
    ctx.fillStyle = P.ORANGE;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
  } else if (kind === 3) {
    roundRect(ctx, -78, -20, 156, 58, 3);
    ctx.fillStyle = color;
    ctx.fill();
    ink(ctx, 5);
    ctx.stroke();
    ctx.fillStyle = P.INK;
    ctx.fillRect(-18, -4, 30, 42);
    ctx.beginPath();
    ctx.arc(48, 8, 12, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 4) {
    roundRect(ctx, -34, -70, 68, 110, 4);
    ctx.fillStyle = color;
    ctx.fill();
    ink(ctx, 5);
    ctx.stroke();
    ctx.fillStyle = P.GLASS;
    ctx.fillRect(-18, -52, 16, 18);
    ctx.fillRect(6, -28, 16, 18);
    ink(ctx, 3);
    ctx.strokeRect(-18, -52, 16, 18);
  } else {
    roundRect(ctx, -50 + bob, -24, 100, 86, 4);
    ctx.fillStyle = color;
    ctx.fill();
    ink(ctx, 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-60, -20);
    ctx.lineTo(-8, -78);
    ctx.lineTo(62, -16);
    ctx.closePath();
    ctx.fillStyle = color === P.YEL ? P.ORANGE : P.INK;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    ctx.fillStyle = P.PAPER;
    roundRect(ctx, -32, -4, 22, 18, 2);
    ctx.fill();
    roundRect(ctx, 8, 6, 16, 28, 2);
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
    if (laundry) {
      ctx.fillStyle = P.PINK;
      ctx.fillRect(18, -58, 14, 12);
      ctx.fillStyle = P.GLASS;
      ctx.fillRect(34, -54, 12, 10);
    }
  }
  ctx.restore();
}

function drawTree(ctx, x, y, sc, boil, seed) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.fillStyle = "#6A432C";
  roundRect(ctx, -8, -4, 16, 40, 3);
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(boil ? 4 : -3, -36, 34, 0, Math.PI * 2);
  ctx.fillStyle = "#5E9440";
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(seed % 2 ? -12 : 14, -48, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#7CB85A";
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  ctx.restore();
}

function drawHazard(ctx, sim, h, boil, placed, reduced = false) {
  const dist = placed ? placed.dist : h.s - sim.s;
  const hx = placed ? placed.hx : hazardWorldX(h, sim);
  const spot = placed ? placed.spot : project(dist, hx);
  const travel = reduced ? 0 : placed?.travel ?? actorTravel(h, sim);
  const step = gaitOffset(travel, h.type, reduced);
  const farY = placed?.farSpot?.y ?? spot.y;
  const top = Math.min(spot.y, farY);
  const bottom = Math.max(spot.y, farY);
  if (bottom < -40 || top > 960) return;
  const sc = Math.max(0.62, Math.min(1.45, spot.scale * 1.55));
  const hop = h.hopped ? -22 * sc : 0;
  const planVehicle = (h.type === "cutin" || h.type === "stopped") && !placed?.legacy && imageReady(CORAL_STRAIGHT);
  let cast = false;
  if (!placed?.legacy) {
    if (h.type === "pedestrian") cast = drawCastPed(ctx, spot.x, spot.y + hop, spot.scale, step, reduced, h);
    else if (h.type === "dog") cast = drawCastDog(ctx, spot.x, spot.y, spot.scale, travel, reduced);
    else if (h.type === "pothole") cast = drawCastHole(ctx, placed, h);
    else if (h.type === "bin") cast = drawCastBin(ctx, spot.x, spot.y, spot.scale, !!h.hopped);
    else if (h.type === "roller") cast = drawCastLid(ctx, spot.x, spot.y, spot.scale, h.crossT >= 0);
  }
  if (!cast && !planVehicle) shadowAt(ctx, spot.x, spot.y, sc, h.type === "cutin" || h.type === "stopped" ? 34 : 22);
  if (!cast) {
    if (h.type === "pedestrian") drawPed(ctx, spot.x, spot.y + hop, sc, step, true);
    else if (h.type === "dog") drawDog(ctx, spot.x, spot.y, sc, step, !!placed?.legacy);
    else if (h.type === "pothole") drawHole(ctx, placed || { spot, farSpot: spot, hx, groundDs: dist, farDs: dist, legacy: false }, h, sc);
    else if (h.type === "bin") drawBin(ctx, placed, h, sc, dist);
    else if (h.type === "roller") drawRoller(ctx, placed, h, sc);
    else drawNpc(ctx, placed, h, sc, dist, boil);
  }

  if (!h.resolved && dist < (h.telegraph || 60) && dist > 2) {
    const markLift = h.type === "pedestrian" ? 184 : 78;
    const by = spot.y - markLift * sc;
    ctx.beginPath();
    ctx.arc(spot.x, by, 18 * Math.min(sc, 1.1) + 4, 0, Math.PI * 2);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    paintCenter(ctx, "!", spot.x - 16, by - 16, 32, 32, 22, P.INK, true, false);
  }
  if (h.trust && !h.resolved && h.committed !== "lunge" && dist < (h.telegraph || 60) && dist > 2) {
    const free = -Math.sign(h.x || 1) * 1.6;
    const chev = project(Math.max(4, Math.min(dist * 0.35, 14)), free);
    ctx.fillStyle = P.YEL;
    ctx.beginPath();
    ctx.moveTo(chev.x, chev.y - 16);
    ctx.lineTo(chev.x + 14, chev.y + 10);
    ctx.lineTo(chev.x - 14, chev.y + 10);
    ctx.closePath();
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
  }
}

function drawPed(ctx, x, y, sc, step, phone) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.translate(0, pedestrianFootShift());
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-12, 10);
  ctx.lineTo(-18 + step, PED_FOOT_LOCAL_Y);
  ctx.moveTo(12, 10);
  ctx.lineTo(20 - step, PED_FOOT_LOCAL_Y);
  ctx.stroke();
  roundRect(ctx, -26, -34, 52, 50, 10);
  ctx.fillStyle = P.PINK;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(2, -62, 26, 0, Math.PI * 2);
  ctx.fillStyle = P.SKIN;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.fillStyle = P.WHITE;
  ctx.beginPath();
  ctx.ellipse(-4, -64, 12, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.INK;
  ctx.beginPath();
  ctx.arc(-2, -64, 5, 0, Math.PI * 2);
  ctx.fill();
  if (phone) {
    roundRect(ctx, 18, -8, 16, 24, 3);
    ctx.fillStyle = P.INK;
    ctx.fill();
    ctx.fillStyle = P.GLASS;
    ctx.fillRect(21, -4, 10, 12);
  }
  ctx.restore();
}

function drawDog(ctx, x, y, sc, step = 0, legacy = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  if (!legacy) ctx.translate(0, -DOG_PAW_LOCAL_Y);
  ctx.fillStyle = "#8A5A3A";
  roundRect(ctx, -40, -18, 70, 36, 8);
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(36, -16, 14, 0, Math.PI * 2);
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.WHITE;
  ctx.beginPath();
  ctx.arc(40, -18, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.INK;
  ctx.beginPath();
  ctx.arc(41, -18, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8A5A3A";
  ctx.fillRect(-28 + step, 14, 8, 18);
  ctx.fillRect(-8 - step, 14, 8, 18);
  ctx.fillRect(10 + step, 14, 8, 18);
  ink(ctx, 4);
  ctx.beginPath();
  ctx.moveTo(-36, -8);
  ctx.quadraticCurveTo(-52, -16 - step * 0.6, -34, 6);
  ctx.stroke();
  ctx.restore();
}

function drawHole(ctx, placed, h, sc = 1) {
  if (placed.legacy) {
    ctx.save();
    ctx.translate(placed.spot.x, placed.spot.y);
    ctx.scale(sc, sc);
    ctx.beginPath();
    ctx.ellipse(0, 6, 34, 18, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#241C16";
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const midS = (placed.groundDs + placed.farDs) / 2;
  const halfW = h.halfW || 0.7;
  const left = project(midS, placed.hx - halfW);
  const right = project(midS, placed.hx + halfW);
  const cx = (placed.spot.x + placed.farSpot.x) / 2;
  const cy = (placed.spot.y + placed.farSpot.y) / 2;
  const rx = Math.max(8, Math.abs(right.x - left.x) / 2);
  const ry = Math.max(6, Math.abs(placed.spot.y - placed.farSpot.y) / 2);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#241C16";
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.strokeStyle = P.YEL;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.4, cy);
  ctx.lineTo(cx - rx * 0.7, cy - ry * 0.6);
  ctx.moveTo(cx + rx * 0.3, cy);
  ctx.lineTo(cx + rx * 0.65, cy - ry * 0.55);
  ctx.stroke();
  ctx.restore();
}

function plant(ctx, placed, sc, contactY) {
  ctx.translate(placed.spot.x, placed.spot.y);
  ctx.scale(sc, sc);
  ctx.translate(0, -contactY);
}

function drawBin(ctx, placed, h, sc, dist) {
  ctx.save();
  if (placed?.legacy) {
    ctx.translate(placed.spot.x, placed.spot.y);
    ctx.scale(sc, sc);
    ctx.rotate(h.hopped ? 1.15 : dist < 14 ? 0.7 : 0.18);
  } else {
    plant(ctx, placed, sc, BIN_BOTTOM_LOCAL_Y);
    if (h.hopped) ctx.rotate(1.15);
  }
  roundRect(ctx, -20, -36, 40, 54, 5);
  ctx.fillStyle = "#5E7A52";
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.INK;
  ctx.fillRect(-24, -40, 48, 8);
  ctx.restore();
}

function drawRoller(ctx, placed, h, sc) {
  ctx.save();
  if (placed?.legacy) {
    ctx.translate(placed.spot.x, placed.spot.y);
    ctx.scale(sc, sc);
    ctx.rotate((h.crossT > 0 ? h.crossT : 0) * 7);
    ctx.beginPath();
    ctx.ellipse(0, 0, 28, 16, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#6E8A62";
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, -22);
    ctx.stroke();
  } else {
    plant(ctx, placed, sc, LID_BOTTOM_LOCAL_Y);
    ctx.beginPath();
    ctx.ellipse(0, 0, 28, 16, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#6E8A62";
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, -22);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNpc(ctx, placed, h, sc, dist, boil) {
  const lengthM = (h.halfL || 2.2) * 2;
  if (placed && !placed.legacy && drawPlanSprite(ctx, CORAL_STRAIGHT, {
    centerDs: placed.dist,
    xm: placed.hx,
    lengthM,
    artLen: PLAN_ART.coral.artLen,
    pivot: PLAN_ART.coral.pivot,
  })) return;
  const colors = [P.BLUE, P.ORANGE, P.TEAL, P.PINK];
  const color = colors[Math.abs(Math.floor(hash(h.s) * 4)) % colors.length];
  ctx.save();
  if (placed?.legacy) {
    ctx.translate(placed.spot.x, placed.spot.y);
    ctx.scale(sc, sc);
    if (h.type === "cutin" && h.crossT >= 0 && h.crossT < (h.crossDur || 2)) ctx.rotate(-0.4);
  } else {
    plant(ctx, placed, sc, NPC_BOTTOM_LOCAL_Y);
  }
  const bodyY = -48;
  const wheelY = 24;
  const glassY = -36;
  roundRect(ctx, -30, bodyY, 60, 92, 10);
  ctx.fillStyle = color;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(-20, glassY, 40, 22);
  ctx.fillStyle = P.INK;
  ctx.fillRect(-22, wheelY, 14, 16);
  ctx.fillRect(8, wheelY, 14, 16);
  if (h.type === "cutin" && dist < 40) {
    ctx.strokeStyle = P.YEL;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(28, -6);
    ctx.lineTo(52, -24 + (boil ? 4 : 0));
    ctx.stroke();
  }
  ctx.restore();
}

function playerPlanImage(sim) {
  if ((sim.crashT || 0) > 0.05 && imageReady(YELLOW_CRASH)) return YELLOW_CRASH;
  if ((sim.brakeInput || 0) > 0.35 && imageReady(YELLOW_BRAKE)) return YELLOW_BRAKE;
  return YELLOW_STRAIGHT;
}

function drawCar(ctx, sim, boil, pose, legacy = false) {
  const xm = pose ? pose.x : sim.x;
  const lengthM = CFG.carHalfFront + CFG.carHalfBack;
  const centerDs = (CFG.carHalfFront - CFG.carHalfBack) / 2;
  if (!legacy && drawPlanSprite(ctx, playerPlanImage(sim), {
    centerDs,
    xm,
    lengthM,
    artLen: PLAN_ART.yellow.artLen,
    pivot: PLAN_ART.yellow.pivot,
  })) {
    if (sim.cargoType) {
      const deck = project(centerDs - 0.7, xm);
      if (!drawCastCargo(ctx, deck.x, deck.y, deck.scale, sim)) {
        const sc = Math.min(0.4, ((CFG.carHalfW * VIEW.focal) / deck.z) / 90);
        ctx.save();
        ctx.translate(deck.x, deck.y);
        drawCargoIcon(ctx, 0, 0, sim.cargoType, sc, sim);
        ctx.restore();
      }
    }
    return;
  }
  const bumper = project(CFG.carHalfFront, xm);
  const origin = carDrawOrigin(bumper.x, bumper.y, sim.brakeInput, sim.crashT);
  drawCarSprite(ctx, origin.x, origin.y, CAR_SPRITE_SCALE, sim.brakeInput, sim, boil, pose ? pose.s : sim.s);
}

function drawCarSprite(ctx, x, y, sc, brake, sim, boil = 0, travelS = null) {
  ctx.save();
  ctx.translate(x, y);
  const live = sim || { s: 0, cargoType: null, cargo: 100, body: 100, t: 0, cargoFlash: 0, nearT: 0, crashT: 0, lastSelfBrake: 0 };
  const dive = (brake || 0) * CAR_DIVE;
  ctx.rotate(dive);
  ctx.scale(sc, sc * (1 - Math.min(0.16, live.crashT || 0)));
  ctx.fillStyle = "rgba(28,22,30,0.22)";
  ctx.beginPath();
  ctx.ellipse(0, 42, 40, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  roundRect(ctx, -CAR_BODY_W / 2, CAR_NOSE_LOCAL_Y, CAR_BODY_W, CAR_BODY_H, 16);
  ctx.fillStyle = live.body < 45 ? "#CDB56A" : P.YEL;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.fillStyle = P.GLASS;
  roundRect(ctx, -28, -50, 56, 30, 6);
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  roundRect(ctx, -18, -16, 36, 26, 4);
  ctx.fillStyle = P.RED;
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  paintCenter(ctx, "У", -16, -18, 32, 26, 16, P.PAPER, true, false);
  const lamps = (brake || 0) > 0.15 || live.lastSelfBrake > 0.1;
  ctx.fillStyle = lamps ? P.RED : P.ORANGE;
  ctx.fillRect(-28, 32, 16, 10);
  ctx.fillRect(12, 32, 16, 10);
  // Distance turns the wheels. The 110 ms boil used to add half a radian
  // even while the title car was standing still.
  const spin = (travelS ?? live.s) * 2.6;
  drawWheel(ctx, -28, -30, spin);
  drawWheel(ctx, 28, -30, spin);
  drawWheel(ctx, -28, 26, spin);
  drawWheel(ctx, 28, 26, spin);
  if (live.cargoType) {
    const launch = live.cargoFlash || 0;
    const tilt = Math.sin(live.t * 8) * (brake || 0) * 0.4;
    ctx.save();
    ctx.translate(0, -78 - launch * 36);
    ctx.rotate(tilt + launch * 0.6);
    drawCargoIcon(ctx, 0, 0, live.cargoType, 1, live);
    ctx.restore();
  }
  if ((brake || 0) > 0.55 && live.v > 8 && live.cargoType) {
    roundRect(ctx, -36, -118, 72, 26, 8);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
    paintCenter(ctx, live.cargoType === "fish" ? "РЫБКА" : "КРЕМ", -36, -118, 72, 26, 14, P.INK, false, false);
  }
  ctx.restore();
}

function drawWheel(ctx, x, y, spin) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = P.INK;
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = P.PAPER;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.cos(spin) * 7, Math.sin(spin) * 7);
  ctx.lineTo(-Math.cos(spin) * 7, -Math.sin(spin) * 7);
  ctx.stroke();
  ctx.restore();
}

function drawCargoIcon(ctx, x, y, type, sc, sim) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  const hurt = sim && sim.cargo < 60;
  if (type === "cake") {
    roundRect(ctx, -24, -6, 48, 28, 6);
    ctx.fillStyle = hurt ? "#E7B89A" : P.PINK;
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-8, -6);
    ctx.lineTo(-10, hurt ? -16 : -28);
    ctx.moveTo(8, -6);
    ctx.lineTo(12, hurt ? -14 : -26);
    ctx.stroke();
    ctx.fillStyle = P.YEL;
    ctx.beginPath();
    ctx.arc(-10, hurt ? -16 : -28, 3, 0, Math.PI * 2);
    ctx.arc(12, hurt ? -14 : -26, 3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const slosh = sim ? Math.sin((sim.t || 0) * 7) * Math.min(1, (sim.brakeInput || 0) + (sim.cargoFlash || 0)) * 8 : 0;
    roundRect(ctx, -20, -18, 40, 34, 6);
    ctx.fillStyle = P.GLASS;
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
    ctx.fillStyle = "rgba(90,160,190,0.55)";
    ctx.fillRect(-16, -4 + slosh * 0.2, 32, 16);
    ctx.fillStyle = P.ORANGE;
    ctx.beginPath();
    ctx.ellipse(slosh, 2, 8, 5, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCabin(ctx, sim, state, boil, visual) {
  panel(ctx, 1056, 24, 520, 852, P.CABIN);
  ctx.save();
  ctx.beginPath();
  ctx.rect(1056, 24, 520, 852);
  ctx.clip();
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(1056, 24, 520, 150);
  ink(ctx, 6);
  ctx.beginPath();
  ctx.moveTo(1056, 174);
  ctx.lineTo(1576, 174);
  ctx.stroke();
  ctx.fillStyle = "#E08A3C";
  roundRect(ctx, 1140, 470, 360, 150, 24);
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  const exp = state.pose || expressionId(sim);
  drawAnton(ctx, exp, boil, visual, sim);
  if (sim.bubble && sim.bubbleT > 0) {
    roundRect(ctx, 1088, 186, 250, 48, 12);
    ctx.fillStyle = P.PAPER;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    paintCenter(ctx, sim.bubble, 1088, 186, 250, 48, 20, P.INK, false, false);
  }
  ctx.restore();
}

function drawLimb(ctx, x0, y0, cx, cy, x1, y1) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.stroke();
  ctx.strokeStyle = P.SKIN;
  ctx.lineWidth = 8;
  ctx.stroke();
}

/** A point `dist` pixels from `from` toward `to`. */
function toward(from, to, dist) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist };
}

const STEER_Y = 200;
const STEER_RX = 76;
const STEER_RY = 34;

function gripPoint(side, angle) {
  const base = side < 0 ? Math.PI - 0.5 : 0.5;
  const a = base + angle;
  return {
    x: Math.cos(a) * (STEER_RX - 6),
    y: STEER_Y + Math.sin(a) * (STEER_RY - 3),
    a,
  };
}

function drawSteeringWheel(ctx, angle) {
  ctx.save();
  ctx.translate(0, STEER_Y);
  ctx.rotate(angle);
  ctx.strokeStyle = P.INK;
  ctx.lineCap = "round";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-44, 7);
  ctx.lineTo(-12, 1);
  ctx.moveTo(44, 7);
  ctx.lineTo(12, 1);
  ctx.moveTo(0, 22);
  ctx.lineTo(0, 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, STEER_RX, STEER_RY, 0, 0, Math.PI * 2);
  ctx.lineWidth = 16;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, STEER_RX - 20, STEER_RY - 11, 0, 0, Math.PI * 2);
  ctx.strokeStyle = P.PAPER;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 2, 11, 0, Math.PI * 2);
  ctx.fillStyle = P.INK;
  ctx.fill();
  ctx.strokeStyle = P.PAPER;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function drawGripHand(ctx, point, side) {
  const dir = side < 0 ? -1 : 1;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.fillStyle = P.SKIN;
  for (const [x, y, rad] of [[dir * 9, -10, 5.5], [dir * 15, -1, 5.5], [dir * 11, 8, 5]]) {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-dir * 8, 8, 6, 4.5, dir * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  ctx.restore();
}

function drawAnton(ctx, exp, boil, lean, sim) {
  const shift = poseShift(exp);
  ctx.save();
  ctx.translate(1316, 268 + shift.y + lean * 10);
  ctx.rotate(shift.rot);

  roundRect(ctx, -100, 70, 200, 150, 24);
  ctx.fillStyle = P.TEAL;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();

  ctx.strokeStyle = P.INK;
  ctx.lineWidth = shift.belt;
  ctx.beginPath();
  ctx.moveTo(-78, 88);
  ctx.lineTo(30, 150 + (exp === "belted" ? 10 : 0));
  ctx.stroke();

  const wheel = Math.max(-0.35, Math.min(0.35, ((sim.targetX || 1.8) - (sim.x || 1.8)) * 0.45));
  const leftGrip = gripPoint(-1, wheel);
  const rightGrip = gripPoint(1, wheel);
  const leftShoulder = { x: -102, y: 128 };
  const rightShoulder = { x: 102, y: 128 };
  const stowU = exp === "stow" ? Math.max(0, Math.min(1, (sim.stowT || 0) / 0.72)) : 0;
  const onWheel = !shift.phoneHand && !shift.limp;
  if (onWheel && !shift.hairHand) {
    const leftWrist = toward(leftGrip, leftShoulder, 14);
    const rightWrist = toward(rightGrip, rightShoulder, 14);
    drawLimb(ctx, leftShoulder.x, leftShoulder.y, -124, 168, leftWrist.x, leftWrist.y);
    drawLimb(ctx, rightShoulder.x, rightShoulder.y, 124, 168, rightWrist.x, rightWrist.y);
  } else if (onWheel && shift.hairHand) {
    const rightWrist = toward(rightGrip, rightShoulder, 14);
    drawLimb(ctx, rightShoulder.x, rightShoulder.y, 124, 168, rightWrist.x, rightWrist.y);
  }
  drawSteeringWheel(ctx, wheel);
  if (onWheel && !shift.hairHand) {
    drawGripHand(ctx, leftGrip, -1);
    drawGripHand(ctx, rightGrip, 1);
  } else if (onWheel && shift.hairHand) {
    drawGripHand(ctx, rightGrip, 1);
  }

  if (shift.hairHand) {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-70, 120);
    ctx.quadraticCurveTo(-90, 20, -20, -70);
    ctx.stroke();
    ctx.fillStyle = P.SKIN;
    ctx.beginPath();
    ctx.arc(-18, -78, 14, 0, Math.PI * 2);
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
  }

  if (shift.limp) {
    const leftHang = { x: -96, y: 258 };
    const rightHang = { x: 100, y: 262 };
    const leftWrist = toward(leftHang, { x: -48, y: 108 }, 14);
    const rightWrist = toward(rightHang, { x: 48, y: 112 }, 14);
    drawLimb(ctx, -48, 108, -108, 196, leftWrist.x, leftWrist.y);
    drawLimb(ctx, 48, 112, 112, 200, rightWrist.x, rightWrist.y);
    drawGripHand(ctx, leftHang, -1);
    drawGripHand(ctx, rightHang, 1);
  }
  if (shift.phoneHand) {
    const u = stowU;
    const left = {
      x: -96 + (leftGrip.x + 96) * u,
      y: 252 + (leftGrip.y - 252) * u,
    };
    const phone = {
      x: 50 + u * 34,
      y: (shift.headDrop || 0) + 48 + u * u * 90,
    };
    const right = {
      x: phone.x + (rightGrip.x - phone.x) * u,
      y: phone.y + (rightGrip.y - phone.y) * u,
    };
    const leftWrist = toward(left, { x: -62, y: 118 }, 14);
    const rightWrist = toward(right, { x: 48, y: 116 }, 14);
    drawLimb(ctx, -62, 118, -108, 180, leftWrist.x, leftWrist.y);
    drawLimb(ctx, 48, 116, 96, 70 + u * 30, rightWrist.x, rightWrist.y);
    drawGripHand(ctx, left, -1);
    if (u > 0.72) drawGripHand(ctx, rightGrip, 1);
  }

  ctx.save();
  ctx.translate(0, shift.headDrop || 0);
  ctx.beginPath();
  ctx.ellipse(shift.head, 0, 112, 100, 0, 0, Math.PI * 2);
  ctx.fillStyle = P.SKIN;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();
  ctx.fillStyle = P.SKIN;
  // Each ear is its own path. Two ellipses in one path draw a straight
  // line from the end of the first to the start of the second.
  for (const [x, y, rx, ry] of [[-104, 18, 16, 22], [104, 26, 14, 18]]) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
  }

  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  [-36, -12, 14, 40].forEach((hx, i) => {
    const lift = exp === "furious" || exp === "preen" ? 14 : exp === "proud" ? 8 : 0;
    ctx.moveTo(hx + shift.head, -86);
    ctx.quadraticCurveTo(hx + (i - 1.5) * 8, -132 - lift - (boil && i % 2 ? 6 : 0), hx + 10, -100);
  });
  ctx.stroke();

  const look = lookFor(exp);
  const wide = exp === "stow" || exp === "earnest" || exp === "wake";
  const heavy = exp === "drowsy";
  const shut = exp === "asleep";
  eye(ctx, -32 + shift.head, -10, heavy ? 26 : wide ? 32 : exp === "belted" ? 30 : 26, heavy ? 8 : wide ? 28 : exp === "belted" ? 26 : 22, wide ? 9 : 8, look.left, shut);
  eye(ctx, 30 + shift.head, 8, heavy ? 16 : wide ? 20 : 16, heavy ? 5 : wide ? 18 : 14, wide ? 6 : 5, look.right, shut);
  brows(ctx, exp, shift.head);
  mouth(ctx, exp, shift.head);

  if (exp === "furious") {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-78, -70);
    ctx.quadraticCurveTo(-110, -110, -60, -120);
    ctx.moveTo(80, -64);
    ctx.quadraticCurveTo(112, -104, 64, -116);
    ctx.stroke();
  }
  if (shift.notes) {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(92, -40, 8, 0, Math.PI * 1.4);
    ctx.moveTo(100, -40);
    ctx.lineTo(100, -62);
    ctx.stroke();
  }
  ctx.restore();
  if (shift.phoneHand) {
    const u = stowU;
    const phone = {
      x: 50 + u * 34,
      y: (shift.headDrop || 0) + 48 + u * u * 90,
    };
    const right = {
      x: phone.x + (rightGrip.x - phone.x) * u,
      y: phone.y + (rightGrip.y - phone.y) * u,
    };
    if (u <= 0.72) drawGripHand(ctx, right, 1);
    drawHandset(ctx, 50 + u * 34, (shift.headDrop || 0) + 18 + u * u * 128, -0.4 + u * 2.2);
  }
  ctx.restore();
}

function drawHandset(ctx, x, y, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  roundRect(ctx, -28, -46, 56, 92, 8);
  ctx.fillStyle = P.INK;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  roundRect(ctx, -20, -34, 40, 64, 4);
  ctx.fillStyle = P.GLASS;
  ctx.fill();
  ctx.restore();
}

function poseShift(exp) {
  if (exp === "phone") return { y: 16, rot: 0.12, hairHand: false, phoneHand: true, belt: 5, head: 2, notes: false, headDrop: 30 };
  if (exp === "drowsy") return { y: 20, rot: 0.18, hairHand: false, slack: true, belt: 5, head: 8, notes: false, headDrop: 16 };
  if (exp === "asleep") return { y: 34, rot: 0.3, hairHand: false, limp: true, belt: 4, head: 12, notes: false, headDrop: 32 };
  if (exp === "wake") return { y: -14, rot: -0.16, hairHand: false, grip: true, belt: 7, head: -6, notes: false, headDrop: 0 };
  if (exp === "stow") return { y: 0, rot: -0.04, hairHand: false, phoneHand: true, belt: 6, head: -2, notes: false, headDrop: 6 };
  if (exp === "earnest") return { y: -18, rot: -0.07, hairHand: false, grip: true, belt: 6, head: 0, notes: false, headDrop: 0 };
  if (exp === "preen") return { y: -10, rot: -0.06, hairHand: true, belt: 5, head: 6, notes: true };
  if (exp === "focused") return { y: 12, rot: 0.05, hairHand: false, belt: 5, head: 0, notes: false };
  if (exp === "belted") return { y: 26, rot: 0.1, hairHand: false, belt: 10, head: -4, notes: false };
  if (exp === "angry" || exp === "furious") return { y: 2, rot: 0, hairHand: false, belt: 6, head: 0, notes: false };
  if (exp === "ashamed") return { y: 8, rot: 0.12, hairHand: false, belt: 5, head: -8, notes: false };
  if (exp === "proud") return { y: -12, rot: -0.04, hairHand: false, belt: 5, head: 4, notes: false };
  if (exp === "annoyed") return { y: 0, rot: 0.04, hairHand: false, belt: 5, head: 2, notes: false };
  return { y: 0, rot: -0.02, hairHand: false, belt: 5, head: 0, notes: false };
}

function lookFor(exp) {
  if (exp === "phone") return { left: { x: 0, y: 9 }, right: { x: 0, y: 6 } };
  if (exp === "drowsy") return { left: { x: 0, y: 4 }, right: { x: 0, y: 3 } };
  if (exp === "asleep") return { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  if (exp === "wake") return { left: { x: 0, y: -5 }, right: { x: 0, y: -3 } };
  if (exp === "stow") return { left: { x: -1, y: -4 }, right: { x: 0, y: -3 } };
  if (exp === "earnest") return { left: { x: 1, y: 3 }, right: { x: 0, y: 2 } };
  if (exp === "focused") return { left: { x: 1, y: 7 }, right: { x: 1, y: 4 } };
  if (exp === "preen") return { left: { x: -2, y: -6 }, right: { x: 0, y: -4 } };
  if (exp === "belted") return { left: { x: 0, y: -8 }, right: { x: 1, y: -5 } };
  if (exp === "ashamed") return { left: { x: -7, y: 4 }, right: { x: -4, y: 2 } };
  if (exp === "angry" || exp === "furious") return { left: { x: 4, y: 2 }, right: { x: 2, y: 1 } };
  if (exp === "proud") return { left: { x: 2, y: -3 }, right: { x: 0, y: -1 } };
  return { left: { x: 3, y: 1 }, right: { x: 0, y: 2 } };
}

function eye(ctx, x, y, rx, ry, pupil, look, shut) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, shut ? 4 : ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = P.WHITE;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  if (shut) return;
  ctx.beginPath();
  ctx.arc(x + look.x, y + look.y, pupil, 0, Math.PI * 2);
  ctx.fillStyle = P.INK;
  ctx.fill();
}

function brows(ctx, exp, hx) {
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 6;
  ctx.beginPath();
  const x = hx || 0;
  if (exp === "angry" || exp === "furious") {
    ctx.moveTo(-60 + x, -42);
    ctx.lineTo(-8 + x, -28);
    ctx.moveTo(12 + x, -20);
    ctx.lineTo(52 + x, -38);
  } else if (exp === "preen") {
    ctx.moveTo(-58 + x, -48);
    ctx.quadraticCurveTo(-30 + x, -60, -8 + x, -46);
    ctx.moveTo(14 + x, -24);
    ctx.quadraticCurveTo(32 + x, -34, 50 + x, -20);
  } else if (exp === "drowsy" || exp === "asleep") {
    ctx.moveTo(-58 + x, -28);
    ctx.lineTo(-8 + x, -34);
    ctx.moveTo(14 + x, -10);
    ctx.lineTo(50 + x, -16);
  } else if (exp === "wake") {
    ctx.moveTo(-62 + x, -58);
    ctx.lineTo(-8 + x, -36);
    ctx.moveTo(12 + x, -30);
    ctx.lineTo(54 + x, -48);
  } else if (exp === "phone") {
    ctx.moveTo(-58 + x, -30);
    ctx.lineTo(-8 + x, -36);
    ctx.moveTo(14 + x, -12);
    ctx.lineTo(50 + x, -16);
  } else if (exp === "stow") {
    ctx.moveTo(-60 + x, -56);
    ctx.lineTo(-8 + x, -40);
    ctx.moveTo(12 + x, -34);
    ctx.lineTo(52 + x, -46);
  } else if (exp === "earnest") {
    ctx.moveTo(-58 + x, -34);
    ctx.lineTo(-8 + x, -48);
    ctx.moveTo(14 + x, -22);
    ctx.lineTo(52 + x, -34);
  } else if (exp === "focused") {
    ctx.moveTo(-58 + x, -36);
    ctx.lineTo(-8 + x, -44);
    ctx.moveTo(14 + x, -16);
    ctx.lineTo(50 + x, -24);
  } else if (exp === "belted") {
    ctx.moveTo(-58 + x, -54);
    ctx.lineTo(-8 + x, -42);
    ctx.moveTo(12 + x, -30);
    ctx.lineTo(50 + x, -40);
  } else if (exp === "annoyed") {
    ctx.moveTo(-58 + x, -34);
    ctx.lineTo(-10 + x, -46);
    ctx.moveTo(12 + x, -16);
    ctx.lineTo(50 + x, -28);
  } else {
    ctx.moveTo(-58 + x, -40);
    ctx.quadraticCurveTo(-32 + x, -54, -8 + x, -40);
    ctx.moveTo(14 + x, -18);
    ctx.quadraticCurveTo(32 + x, -28, 52 + x, -16);
  }
  ctx.stroke();
}

function mouth(ctx, exp, hx) {
  const x = hx || 0;
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  if (exp === "angry" || exp === "furious") {
    ctx.moveTo(-22 + x, 46);
    ctx.lineTo(28 + x, 46);
    ctx.lineTo(18 + x, 66);
    ctx.lineTo(-14 + x, 66);
    ctx.closePath();
    ctx.fillStyle = "#7A3030";
    ctx.fill();
    ctx.stroke();
    return;
  }
  if (exp === "drowsy") {
    ctx.moveTo(-16 + x, 56);
    ctx.quadraticCurveTo(4 + x, 62, 22 + x, 56);
  } else if (exp === "asleep") {
    ctx.ellipse(4 + x, 60, 8, 10, 0, 0, Math.PI * 2);
  } else if (exp === "wake") {
    ctx.arc(2 + x, 50, 14, 0, Math.PI * 2);
  } else if (exp === "phone") {
    ctx.ellipse(4 + x, 58, 10, 7, 0, 0, Math.PI * 2);
  } else if (exp === "stow") {
    ctx.arc(2 + x, 54, 12, 0, Math.PI * 2);
  } else if (exp === "earnest") {
    ctx.moveTo(-22 + x, 50);
    ctx.quadraticCurveTo(4 + x, 66, 26 + x, 48);
  } else if (exp === "annoyed") {
    ctx.moveTo(-18 + x, 50);
    ctx.quadraticCurveTo(x, 42, 24 + x, 56);
  } else if (exp === "focused") {
    ctx.moveTo(-16 + x, 52);
    ctx.lineTo(20 + x, 52);
  } else if (exp === "belted") {
    ctx.arc(x, 56, 12, 0, Math.PI * 2);
  } else if (exp === "preen") {
    ctx.moveTo(-10 + x, 48);
    ctx.quadraticCurveTo(8 + x, 40, 18 + x, 50);
  } else if (exp === "proud") {
    ctx.moveTo(-28 + x, 44);
    ctx.quadraticCurveTo(4 + x, 78, 32 + x, 40);
  } else if (exp === "ashamed") {
    ctx.moveTo(-14 + x, 58);
    ctx.quadraticCurveTo(4 + x, 48, 20 + x, 56);
  } else {
    ctx.moveTo(-24 + x, 48);
    ctx.quadraticCurveTo(2 + x, 70, 28 + x, 46);
  }
  ctx.stroke();
}

