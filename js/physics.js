import { CFG, GEOMETRIC, INVOICE, SAFE_SPEED } from "./config.js";

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Full-press brake term a(v), m/s².
 * Exactly CFG.brakeA100 (8.5) at 100 km/h, lower when slower, up toward 11 above.
 */
export function brakeAccel(v) {
  const t = clamp(v / CFG.vRef, 0, 1.45);
  if (t <= 1) return lerp(CFG.brakeA0, CFG.brakeA100, t);
  const extra = (t - 1) / 0.45;
  return lerp(CFG.brakeA100, CFG.brakeAHarsh, extra);
}

/** dv/dt without dt. brake is 0..1 physical pedal after the press ramp. */
export function netAccel(v, throttle, brake, drag = CFG.drag, slip = 1) {
  return throttle - drag * v - brake * brakeAccel(v) * slip;
}

/**
 * Irritation added per second. Mood, not hit points.
 * `decel` is the player's brake contribution (not Anton's own easing).
 * `stopped` is an unnecessary full stop on an empty road.
 */
export function irritationRate({ decel, brakeInput, holdTime, justified, stopped }) {
  let rate = 0;
  const harsh = decel > CFG.irritationDecel && brakeInput > CFG.irritationBrake;
  if (harsh) rate += justified ? CFG.irritationRate * CFG.justifiedMul : CFG.irritationRate;
  if (holdTime > CFG.holdExtraAfter && brakeInput > CFG.irritationBrake) {
    rate += justified ? CFG.holdExtraRate * 0.25 : CFG.holdExtraRate;
  }
  if (stopped && !justified) rate += CFG.unnecessaryStopRate;
  return rate;
}

/** How badly Anton steers. Higher patience = later, wider, less tidy. */
export function steerParams(patience, outburst) {
  if (outburst) return { rate: 2.15, overshoot: 1.05, delay: 0.42 };
  if (patience >= 70) return { rate: 2.8, overshoot: 0.85, delay: 0.32 };
  if (patience >= 40) return { rate: 3.15, overshoot: 0.28, delay: 0.12 };
  return { rate: 3.7, overshoot: 0.05, delay: 0 };
}

export function infiniteTargetSpeed(distance) {
  return Math.min(CFG.infiniteSpeedCap, 16 + distance / 220);
}

export function collisionCargoLoss(type, speed) {
  if (type !== "cake" && type !== "fish") return 0;
  if (speed < 3) return 0;
  const full = type === "fish" ? CFG.fishCollision : CFG.cakeCollision;
  const scale = clamp(speed / 10, 0.45, 1);
  return full * scale;
}

export function cargoImpulse(type) {
  if (type === "cake") return CFG.cakeImpulse;
  if (type === "fish") return CFG.fishImpulse;
  return 0;
}

export function cargoSustain(type) {
  if (type === "cake") return CFG.cakeSustain;
  if (type === "fish") return CFG.fishSustain;
  return 0;
}

export function moodWord(patience, outburst) {
  if (outburst || patience >= 100) return "Ну всё!";
  if (patience >= 70) return "Закипает";
  if (patience >= 40) return "Бубнит";
  return "Терпит";
}

export function moodGlyph(patience, outburst) {
  if (outburst || patience >= 70) return "triangle";
  if (patience >= 40) return "square";
  return "circle";
}

/**
 * Face id. Brake position does not pick the face; patience and events do.
 * `belted` is a short interrupt after a genuinely harsh stop.
 */
function preening(sim) {
  const list = sim.hazards || [];
  for (const h of list) {
    if (h.type !== "roller" || h.resolved) continue;
    const dist = h.s - sim.s;
    if (dist < 32 && dist > 1.2 && (sim.brakeInput || 0) < 0.28) return true;
  }
  return false;
}

export function expressionId(sim) {
  if (sim.attention === "phone") return "phone";
  if (sim.attention === "stow") return "stow";
  if (sim.attention === "drowsy") return "drowsy";
  if (sim.attention === "asleep") return "asleep";
  if (sim.attention === "wake") return "wake";
  if (sim.attention === "earnest") return "earnest";
  if (sim.beltT > 0 || sim.cargoFlash > 0) return "belted";
  if (sim.outburstT > 0 || sim.patience >= 100) return "furious";
  if (sim.intent === "lunge") return "angry";
  if (sim.patience >= 70) return "angry";
  if (preening(sim)) return "preen";
  if (sim.patience >= 40) return "annoyed";
  if (sim.intent === "avoid" || sim.intent === "yield") return "focused";
  return "calm";
}

export function grade(sim) {
  const body = clamp(sim.body, 0, 100);
  const comfortShown = sim.cargoType ? clamp(sim.cargo, 0, 100) : clamp(sim.comfort, 0, 100);
  const mood = clamp(100 - sim.patience, 0, 100);
  const w = sim.cargoType ? CFG.weightsCargo : CFG.weightsPlain;
  const percent = w.body * body + w.comfort * comfortShown + w.mood * mood;
  let stars = 0;
  if (percent >= CFG.starThresholds.three) stars = 3;
  else if (percent >= CFG.starThresholds.two) stars = 2;
  else if (percent >= CFG.starThresholds.one) stars = 1;
  if (!sim.success) stars = 0;
  const skilled =
    sim.stats.trustClears >= 1 ||
    (sim.stats.playerBrakeTime >= 0.15 && sim.stats.clears >= 1);
  const badge =
    sim.success === true &&
    sim.stats.collisions === 0 &&
    sim.patience < 45 &&
    sim.stats.playerBrakeTime < 3.6 &&
    sim.stats.harshFull <= 2 &&
    skilled &&
    (!sim.cargoType || sim.cargo >= 70);
  return {
    body,
    comfort: comfortShown,
    ride: clamp(sim.comfort, 0, 100),
    mood,
    patience: sim.patience,
    percent,
    stars,
    badge,
    success: sim.success === true,
    failReason: sim.failReason,
  };
}

export function repairInvoice(stats, time) {
  const lines = [
    ["Бампер «ну почти»", (stats.collisions || 0) * INVOICE.bumper],
    ["Зеркало с характером", (stats.mirrors || 0) * INVOICE.mirror],
    ["Антикризисное вмешательство", (stats.harshFull || 0) * INVOICE.intervention],
    ["Сигналы в пустоту", (stats.honks || 0) * INVOICE.honk],
    ["Аренда нервов", Math.round((time || 0) * INVOICE.nervesPerSec)],
  ].filter(([, cost]) => cost > 0);
  const total = lines.reduce((sum, [, cost]) => sum + cost, 0);
  return { lines, total };
}

export function isGeometric(type) {
  return GEOMETRIC.has(type);
}

export function safeSpeed(type) {
  return SAFE_SPEED[type] ?? 4;
}
