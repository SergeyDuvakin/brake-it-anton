/**
 * Original ink for Brake It, Anton.
 * One forward projection. Poses and props change with the situation.
 */

import { CFG, PALETTE as P } from "./config.js";
import { damageStage } from "./physics.js";
import { paintCabin } from "./cabin.js";
import { DRIVER_PLATE } from "./layout.js";
import {
  drawDriveChrome,
  drawGarageScreen,
  drawPauseScreen,
  drawResultScreen,
  drawTitleChrome,
  pedalHitBox,
  setLargeUi,
  uiImages,
  uiScale,
} from "./ui.js";
import { VIEW, project } from "./road.js";
import { routeLocal, routeYaw } from "./route.js";
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
 * to the tail of the same `viewProject()` as the road. Width follows the
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
const YELLOW_LEFT = loadCarImage("yellow-car-left.png");
const YELLOW_RIGHT = loadCarImage("yellow-car-right.png");
const YELLOW_SMALL_LEFT = loadCarImage("yellow-car-small-left.png");
const YELLOW_SMALL_RIGHT = loadCarImage("yellow-car-small-right.png");
const CORAL_STRAIGHT = loadCarImage("coral-wagon-straight.png");

let viewCam = 0;

function bindView(cam) {
  viewCam = cam || 0;
}

function viewProject(ds, xm) {
  const local = routeLocal(viewCam, viewCam + ds, xm);
  return project(local.ds, local.xm);
}

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

function blitBox(proj, centerDs, xm, lengthM, artLen, imageWidth, pivot = 500) {
  const yTop = pivot - artLen / 2;
  const nose = proj(planRowDs(centerDs, yTop, pivot, lengthM, artLen), xm);
  const tail = proj(planRowDs(centerDs, yTop + artLen, pivot, lengthM, artLen), xm);
  const mid = proj(centerDs, xm);
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
  const box = blitBox(viewProject, centerDs, xm, lengthM, artLen, img.width, pivot);
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
  bindView(sim.s);
  const bumper = viewProject(CFG.carHalfFront, sim.x);
  const foot = viewProject(hazard.s - (hazard.halfL || 0) - sim.s, hazardWorldX(hazard, sim));
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
  size = Math.round(size * uiScale());
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

function hash(n) {
  let x = Math.imul(n | 0, 0x9e3779b1);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function render(ctx, state) {
  setLargeUi(!!state.save?.settings?.largeUi);
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
  paintCabin(ctx, state.preview, { ...state, pose: "preen", session: { phase: "drive", sim: state.preview } });
  drawTitleChrome(ctx, { spots, labels }, state);
}


function drawPlay(ctx, state, sink) {
  const session = state.session;
  const sim = session.sim;
  const boil = state.save.settings.reducedMotion ? 0 : Math.floor(state.now / 110) % 2;
  const motion = !state.save.settings.reducedMotion;
  const mag = state.save.settings.shake && motion ? Math.min(sim.shake, 5) : 0;
  const driving = session.phase === "drive";
  const brake = driving ? sim.brakeInput : 0;

  ctx.save();
  if (mag) ctx.translate((hash(sim.t * 60) - 0.5) * mag, (hash(sim.t * 40) - 0.5) * mag * 0.5);
  drawWorld(ctx, sim, boil, motion, state.alpha ?? 1, !!state.save.settings.reducedMotion, !!state.legacyAnchors);
  ctx.restore();
  drawCabin(ctx, sim, state);
  const showHud = driving || session.phase === "countdown";
  const chrome = showHud ? drawDriveChrome(ctx, state, sink, brake) : null;
  if (driving) {
    spots.push({
      id: "anton",
      x: DRIVER_PLATE.x + 48,
      y: DRIVER_PLATE.y + 70,
      w: DRIVER_PLATE.w - 96,
      h: 360,
    });
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
  bindView(pose.s);
  const car = viewProject(CFG.carHalfFront, pose.x);
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
      spot: viewProject(near, hx),
      farSpot: viewProject(far, hx),
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

  // Short strips follow a bend. One quad from the bumper to the horizon would cut the corner.
  for (let ds = VIEW.near; ds < far; ds += ds < VIEW.look ? 8 : 400) {
    const ds1 = Math.min(far, ds + (ds < VIEW.look ? 8 : 400));
    fillQuad(ctx, ds, ds1, -VIEW.sideHalf, -VIEW.roadHalf, "#E4D7C4");
    fillQuad(ctx, ds, ds1, VIEW.roadHalf, VIEW.sideHalf, "#E4D7C4");
    fillQuad(ctx, ds, ds1, -VIEW.roadHalf, VIEW.roadHalf, P.ROAD);
  }
  strokeCurve(ctx, -VIEW.roadHalf, far, P.INK, 7);
  strokeCurve(ctx, VIEW.roadHalf, far, P.INK, 7);

  const curb = 5;
  for (let s = Math.floor((cam + VIEW.near) / curb) * curb; s < cam + VIEW.look; s += curb) {
    for (const side of [-1, 1]) {
      const spot = viewProject(s - cam, side * (VIEW.roadHalf + 0.08));
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
      const spot = viewProject(ds0, 0);
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
    const a = viewProject(ds, -0.9);
    const b = viewProject(ds + 1.4, 0.4);
    ctx.strokeStyle = "rgba(28,22,30,0.35)";
    ctx.lineWidth = Math.max(1, 2 * a.scale);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let s = Math.floor((cam - 4) / 36) * 36; s < cam + VIEW.look; s += 36) {
    const spot = viewProject(s - cam, 0.55);
    if (spot.y < 50 || spot.y > 880) continue;
    ctx.beginPath();
    ctx.ellipse(spot.x, spot.y, 16 * spot.scale, 8 * spot.scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#3E4658";
    ctx.fill();
    ink(ctx, 2);
    ctx.stroke();
  }

  for (const skid of sim.skids || []) {
    const spot = viewProject(skid.s - cam, skid.x);
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
  const a = viewProject(ds0, x0);
  const b = viewProject(ds0, x1);
  const c = viewProject(ds1, x1);
  const d = viewProject(ds1, x0);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeCurve(ctx, xm, far, color, width) {
  ctx.beginPath();
  let started = false;
  for (let ds = VIEW.near; ds <= VIEW.look; ds += 4) {
    const p = viewProject(ds, xm);
    if (!started) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
    started = true;
  }
  const end = viewProject(far, xm);
  ctx.lineTo(end.x, end.y);
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
  const spot = viewProject(item.ds, item.xm);
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
  const spot = placed ? placed.spot : viewProject(dist, hx);
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
    if (h.type === "pedestrian") cast = drawCastPed(ctx, spot.x, spot.y + hop, spot.scale, travel, reduced, h);
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
    const chev = viewProject(Math.max(4, Math.min(dist * 0.35, 14)), free);
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
  const left = viewProject(midS, placed.hx - halfW);
  const right = viewProject(midS, placed.hx + halfW);
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
  const stage = damageStage(sim.body, sim.stats?.collisions);
  if ((stage >= 2 || (sim.crashT || 0) > 0.05) && imageReady(YELLOW_CRASH)) return YELLOW_CRASH;
  if ((sim.brakeInput || 0) > 0.35 && imageReady(YELLOW_BRAKE)) return YELLOW_BRAKE;
  const yaw = routeYaw(viewCam);
  if (yaw < -0.2 && imageReady(YELLOW_LEFT)) return YELLOW_LEFT;
  if (yaw > 0.2 && imageReady(YELLOW_RIGHT)) return YELLOW_RIGHT;
  if (yaw < -0.08 && imageReady(YELLOW_SMALL_LEFT)) return YELLOW_SMALL_LEFT;
  if (yaw > 0.08 && imageReady(YELLOW_SMALL_RIGHT)) return YELLOW_SMALL_RIGHT;
  return YELLOW_STRAIGHT;
}

/** Light and heavy still need owner drawings. These marks are not painted into the car file. */
function drawDamagePlaceholder(ctx, sim, xm) {
  const stage = damageStage(sim.body, sim.stats?.collisions);
  if (stage !== 1 && stage !== 3) return;
  const nose = viewProject(CFG.carHalfFront * 0.72, xm);
  ctx.save();
  ctx.translate(nose.x, nose.y);
  ctx.lineCap = "round";
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 3;
  if (stage === 1) {
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(4, 6);
    ctx.moveTo(-4, -8);
    ctx.lineTo(8, -1);
    ctx.stroke();
  } else {
    ctx.fillStyle = "rgba(28,22,30,0.72)";
    ctx.beginPath();
    ctx.moveTo(-16, 2);
    ctx.lineTo(-2, -14);
    ctx.lineTo(12, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
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
      const deck = viewProject(centerDs - 0.7, xm);
      if (!drawCastCargo(ctx, deck.x, deck.y, deck.scale, sim)) {
        const sc = Math.min(0.4, ((CFG.carHalfW * VIEW.focal) / deck.z) / 90);
        ctx.save();
        ctx.translate(deck.x, deck.y);
        drawCargoIcon(ctx, 0, 0, sim.cargoType, sc, sim);
        ctx.restore();
      }
    }
    drawDamagePlaceholder(ctx, sim, xm);
    return;
  }
  const bumper = viewProject(CFG.carHalfFront, xm);
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

function drawDriverPlate(ctx) {
  const plate = DRIVER_PLATE;
  ctx.save();
  roundRect(ctx, plate.x, plate.y, plate.w, plate.h, plate.radius);
  ctx.fillStyle = "#F4E2B8";
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = P.INK;
  ctx.stroke();
  ctx.restore();
}

function drawCabin(ctx, sim, state) {
  drawDriverPlate(ctx);
  paintCabin(ctx, sim, state);
  ctx.save();
  roundRect(ctx, DRIVER_PLATE.x, DRIVER_PLATE.y, DRIVER_PLATE.w, DRIVER_PLATE.h, DRIVER_PLATE.radius);
  ctx.lineWidth = 5;
  ctx.strokeStyle = P.INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(DRIVER_PLATE.x, DRIVER_PLATE.y, DRIVER_PLATE.w, DRIVER_PLATE.h);
  ctx.clip();
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
