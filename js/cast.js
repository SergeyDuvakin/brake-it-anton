/**
 * Approved world drawings. Bottom-center is the foot or the base.
 * One scale, no crop. The phone kid's raised foot is one extra pose,
 * not the other half of a stride. The dog's raised paw is a trick,
 * not a step. Groceries has a standing drawing and a passing drawing.
 */

import { DOG_STRIDE, PED_STRIDE, strideSlot } from "./gait.js";
import { VIEW, project } from "./road.js";

const SPECS = {
  pedStand: { file: "16_ped-phone-design.png", ax: 450, ay: 1016, scale: 0.18 },
  pedPass: { file: "19_ped-phone-passing.png", ax: 458, ay: 1030, scale: 0.18 },
  pedLift: { file: "20_ped-phone-raised-foot.png", ax: 457, ay: 1028, scale: 0.18 },
  pedGroc: { file: "21_ped-groceries-passing.png", ax: 416, ay: 1036, scale: 0.18 },
  pedGrocStand: { file: "17_ped-groceries-design.png", ax: 425, ay: 1021, scale: 0.18 },
  dogWalk: { file: "18_dog-design.png", ax: 585, ay: 745, scale: 0.18 },
  dogPaw: { file: "22_dog-raised-paw.png", ax: 589, ay: 740, scale: 0.18 },
  bin: { file: "35_bin-idle.png", ax: 516, ay: 880, scale: 0.16 },
  binHop: { file: "47_bin-hop.png", ax: 519, ay: 932, scale: 0.16 },
  lidFlat: { file: "36_lid-flat.png", ax: 578, ay: 685, scale: 0.16 },
  lidUp: { file: "41_lid-upright.png", ax: 521, ay: 869, scale: 0.16 },
  hole: { file: "37_pothole.png", ax: 584, ay: 447, artW: 867 },
  houseBase: { file: "38_house-base.png", ax: 523, ay: 914, scale: 0.28 },
  houseLaundry: { file: "42_house-laundry.png", ax: 523, ay: 918, scale: 0.28 },
  houseLow: { file: "44_house-low.png", ax: 591, ay: 762, scale: 0.28 },
  houseTall: { file: "45_house-tall.png", ax: 449, ay: 1053, scale: 0.28 },
  houseWide: { file: "46_house-wide.png", ax: 587, ay: 783, scale: 0.28 },
  treeBase: { file: "39_tree-base.png", ax: 440, ay: 1018, scale: 0.26 },
  treeWide: { file: "43_tree-wide.png", ax: 441, ay: 987, scale: 0.26 },
  cake: { file: "48_cake-whole.png", ax: 515, ay: 886, scale: 0.055 },
  cakeHurt: { file: "50_cake-damaged.png", ax: 519, ay: 887, scale: 0.055 },
  fish: { file: "49_aquarium-calm.png", ax: 584, ay: 741, scale: 0.06 },
  fishSlosh: { file: "51_aquarium-slosh.png", ax: 555, ay: 745, scale: 0.06 },
};

function load(file) {
  if (typeof globalThis.Image !== "function") return null;
  const img = new globalThis.Image();
  img.decoding = "async";
  img.src = new URL(`../assets/world/${file}`, import.meta.url).href;
  return img;
}

const IMAGES = {};
for (const [key, spec] of Object.entries(SPECS)) IMAGES[key] = load(spec.file);

function ready(img) {
  return !!(img && img.complete && img.naturalWidth);
}

export function worldImages() {
  return Object.values(IMAGES).filter(Boolean);
}

function depth(scale) {
  return Math.max(0.28, Math.min(1.15, scale || 1));
}

function billboard(ctx, key, x, y, spotScale) {
  const spec = SPECS[key];
  const img = IMAGES[key];
  if (!ready(img)) return false;
  const sc = spec.scale * depth(spotScale);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.drawImage(img, -spec.ax, -spec.ay);
  ctx.restore();
  return true;
}

function idHash(id) {
  let n = 0;
  const text = String(id || "");
  for (let i = 0; i < text.length; i += 1) n = (n * 33 + text.charCodeAt(i)) >>> 0;
  return n;
}

/**
 * Approved poses only. The phone kid has three drawings (planted, passing,
 * one raised foot). Groceries has two; there is no second stride to invent.
 * The dog alternates the walk drawing and the raised paw.
 */
export function pedPoseKey(hazard, travel, reduced) {
  const phone = idHash(hazard?.id) % 3 !== 0;
  const moving = !!(hazard && hazard.crossT >= 0 && !hazard.hopped && !reduced && travel > 0.02);
  if (!moving) return phone ? "pedStand" : "pedGrocStand";
  // Slot 0 is the passing drawing the contact tests already sit on.
  if (phone) return ["pedPass", "pedLift", "pedStand"][strideSlot(travel, PED_STRIDE, 3)];
  return ["pedGroc", "pedGrocStand"][strideSlot(travel, PED_STRIDE, 2)];
}

export function drawCastPed(ctx, x, y, spotScale, travel, reduced, hazard) {
  return billboard(ctx, pedPoseKey(hazard, travel, reduced), x, y, spotScale);
}

export function dogPoseKey(travel, reduced) {
  if (reduced || !(travel > 0.05)) return "dogPaw";
  return strideSlot(travel, DOG_STRIDE, 2) === 0 ? "dogPaw" : "dogWalk";
}

export function drawCastDog(ctx, x, y, spotScale, travel, reduced) {
  return billboard(ctx, dogPoseKey(travel, reduced), x, y, spotScale);
}

export function drawCastBin(ctx, x, y, spotScale, hopped) {
  return billboard(ctx, hopped ? "binHop" : "bin", x, y, spotScale);
}

export function drawCastLid(ctx, x, y, spotScale, rolling) {
  return billboard(ctx, rolling ? "lidFlat" : "lidUp", x, y, spotScale);
}

/** The hole is the ground. Its width matches the collider; the drawing is not squashed. */
export function drawCastHole(ctx, placed, hazard) {
  const img = IMAGES.hole;
  if (!placed || placed.legacy || !ready(img)) return false;
  const midDs = ((placed.groundDs ?? 0) + (placed.farDs ?? 0)) / 2;
  const mid = project(midDs, placed.hx);
  const widthPx = ((hazard.halfW || 0.72) * 2 * VIEW.focal) / mid.z;
  const sc = widthPx / SPECS.hole.artW;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.translate(mid.x, mid.y);
  ctx.scale(sc, sc);
  ctx.drawImage(img, -SPECS.hole.ax, -SPECS.hole.ay);
  ctx.restore();
  return true;
}

export function drawCastScenery(ctx, key, x, y, spotScale) {
  return billboard(ctx, key, x, y, spotScale);
}

export function sceneryKey(item) {
  const cycle = Math.abs(item.n * 2 + (item.side > 0 ? 1 : 4)) % 7;
  if (item.band === "market") return cycle % 2 === 0 ? "houseLaundry" : "houseTall";
  if (item.band === "edge") return cycle % 3 === 0 ? "treeWide" : "houseWide";
  if (cycle === 0 || cycle === 5) return item.n % 2 ? "treeWide" : "treeBase";
  if (cycle === 1) return "houseLaundry";
  if (cycle === 2) return "houseLow";
  if (cycle === 3) return "houseTall";
  if (cycle === 4) return "houseWide";
  return "houseBase";
}

export function drawCastCargo(ctx, x, y, spotScale, sim) {
  if (!sim?.cargoType) return false;
  const hurt = (sim.cargo ?? 100) < 60;
  const slosh = hurt || (sim.brakeInput || 0) > 0.45;
  const key = sim.cargoType === "fish"
    ? (slosh ? "fishSlosh" : "fish")
    : (hurt ? "cakeHurt" : "cake");
  return billboard(ctx, key, x, y, spotScale);
}
