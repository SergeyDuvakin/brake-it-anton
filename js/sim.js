/**
 * Fixed-step yard simulation. The player never steers and never throttles.
 * `held` is the brake pedal. Anton chooses throttle and lane.
 *
 * Integrator (see physics.js):
 *   v += (throttle - drag * v - brake * a(v) * slip) * dt
 */

import { CFG } from "./config.js";
import { mulberry32 } from "./rng.js";
import {
  brakeAccel,
  cargoImpulse,
  cargoSustain,
  clamp,
  collisionCargoLoss,
  infiniteTargetSpeed,
  irritationRate,
  isGeometric,
  netAccel,
  safeSpeed,
  steerParams,
} from "./physics.js";

export function createSim(mission, seed = 1) {
  const hazards = (mission.hazards || []).map((h) => ({
    telegraph: 72,
    decision: 58,
    commit: 40,
    halfW: 0.62,
    halfL: 1.35,
    clearAfter: 8,
    trust: false,
    x: CFG.defaultX,
    ...h,
    resolved: null,
    committed: null,
    seenBrake: 0,
    playerBraked: false,
    rewarded: false,
    commitAt: 0,
    crossT: -1,
    crossDur: h.crossDur ?? (h.type === "pedestrian" ? 3.35 : h.type === "cutin" ? 2.65 : h.type === "roller" ? 2.35 : 0),
    yielded: false,
    hopped: false,
  }));
  return {
    missionId: mission.id,
    infinite: !!mission.infinite,
    length: mission.length,
    cruise: mission.cruise ?? 16,
    cargoType: mission.cargo || null,
    slippery: (mission.slippery || []).map((z) => ({ s0: z.s0, s1: z.s1 })),
    hazards,
    seed,
    rng: mulberry32(seed),
    s: 0,
    prevS: 0,
    v: 0,
    x: CFG.defaultX,
    prevX: CFG.defaultX,
    brakeInput: 0,
    holdTime: 0,
    pressTime: 0,
    wasHeld: false,
    resumeDelay: 0,
    calmTime: 0,
    patience: mission.patienceStart ?? CFG.patienceStart,
    cooldown: 0,
    outburstT: 0,
    surgeT: 0,
    beltT: 0,
    stun: 0,
    comfort: 100,
    comfortTarget: 100,
    comfortLock: 0,
    cargo: 100,
    body: 100,
    fullPressLatched: false,
    spiked: false,
    intent: "cruise",
    bubble: null,
    bubbleT: 0,
    bubbleGap: 0,
    saidSlip: false,
    t: 0,
    done: false,
    success: false,
    failReason: null,
    shake: 0,
    crashT: 0,
    lastThrottle: 0,
    lastSelfBrake: 0,
    lastPlayerDecel: 0,
    inSlip: false,
    targetX: CFG.defaultX,
    skids: [],
    gags: (mission.gags || []).map((g) => ({ ...g, fired: false })),
    gagT: 0,
    nearT: 0,
    cargoFlash: 0,
    stats: {
      collisions: 0,
      trustClears: 0,
      clears: 0,
      lunges: 0,
      playerBrakeTime: 0,
      harshFull: 0,
      honks: 0,
      mirrors: 0,
      outbursts: 0,
      shortReleases: 0,
      nearMisses: 0,
      yields: 0,
      minV: Infinity,
      maxV: 0,
      maxThrottle: 0,
      minX: CFG.defaultX,
      maxX: CFG.defaultX,
    },
    events: [],
  };
}

export function nextHazard(sim) {
  let best = null;
  for (const h of sim.hazards) {
    if (h.resolved) continue;
    const dist = h.s - sim.s;
    if (dist < -6) continue;
    if (!best || dist < best.dist) best = { ...h, dist };
  }
  return best;
}

function sideOf(h, near = 5.15) {
  return h.x >= 0 ? near : -near;
}

/**
 * Lateral position in metres.
 * People and pulling-out cars cross on a clock once they have started,
 * so a stopped instructor can wait them out. Until then they stand off
 * the lane. A body placed on top of the car (tests, a late overlap)
 * is already in the lane.
 * Dogs still run in with distance: Anton is supposed to steer around
 * them, not wait for a crossing.
 */
export function hazardWorldX(h, sim) {
  const dist = h.s - sim.s;
  if (h.type === "pedestrian") return actorX(h, sim, dist, 5.2, -Math.sign(h.x || 1) * 5.35);
  if (h.type === "cutin") return actorX(h, sim, dist, 5.6, -Math.sign(h.x || 1) * 5.5);
  if (h.type === "dog") {
    const side = sideOf(h, 4.9);
    if (dist > 18) return side + Math.sin(h.s) * 0.15;
    const t = clamp(1 - dist / 18, 0, 1);
    const darted = side + (h.x - side) * t + Math.sin(t * Math.PI) * 0.85 * Math.sign(side || 1);
    return darted;
  }
  if (h.type === "roller") return actorX(h, sim, dist, 5.35, -Math.sign(h.x || 1) * 5.15);
  if (h.type === "bin") {
    const side = sideOf(h, 4.55);
    if (dist > 16) return side;
    const t = clamp(1 - Math.max(dist, 0) / 16, 0, 1);
    return side + (h.x - side) * smooth(t);
  }
  return h.x;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Curb, walk to the lane, linger, leave. u is 0..1 of the crossing. */
function actorX(h, sim, dist, sideAbs, farX) {
  const side = h.x >= 0 ? sideAbs : -sideAbs;
  const lane = h.x;
  if (h.hopped) return farX;
  if (h.crossT < 0) {
    if (dist < 2.4) return lane;
    return side;
  }
  const dur = h.crossDur || 3;
  const u = clamp(h.crossT / dur, 0, 1);
  if (u < 0.04) return side;
  if (u < 0.16) return side + (lane - side) * smooth((u - 0.04) / 0.12);
  if (u < 0.74) return lane;
  if (u < 1) return lane + (farX - lane) * smooth((u - 0.74) / 0.26);
  return farX;
}

function log(sim, entry) {
  sim.events.push({ t: round3(sim.t), ...entry });
  if (sim.events.length > 80) sim.events.shift();
}

function say(sim, text) {
  if (sim.bubble && sim.bubbleGap > 0.4) return;
  sim.bubble = text;
  sim.bubbleT = 1.15;
  sim.bubbleGap = 2.3;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function justified(sim) {
  for (const h of sim.hazards) {
    if (h.resolved || h.trust) continue;
    const dist = h.s - sim.s;
    if (dist < h.telegraph && dist > -4) return true;
  }
  return false;
}

function selfBrake(sim) {
  const h = nextHazard(sim);
  if (!h || h.trust || h.committed === "lunge") return 0;
  if (sim.outburstT > 0 || sim.surgeT > 0) return 0;
  if (h.dist > 30 || h.dist < -1) return 0;
  const skill = sim.patience >= 70 ? 0.4 : sim.patience >= 40 ? 0.65 : 0.8;
  const urgency = clamp((24 - h.dist) / 24, 0, 1);
  return 0.24 * skill * urgency;
}

function desiredX(sim) {
  const h = nextHazard(sim);
  if (h && h.committed === "lunge" && h.dist > -4 && h.dist < 50) return h.x;
  if (h && h.committed === "avoid" && h.dist > -8 && h.dist < 55) {
    const params = steerParams(sim.patience, sim.outburstT > 0);
    const sign = Math.sign(h.x || 1);
    return clamp(-sign * CFG.defaultX - sign * params.overshoot, -CFG.roadEdge + 0.15, CFG.roadEdge - 0.15);
  }
  if (sim.outburstT > 0) {
    return CFG.defaultX + Math.sin(sim.t * 2.4) * 0.35;
  }
  if (h && h.dist < 78) return CFG.defaultX;
  if (sim.patience >= 70) return CFG.defaultX + Math.sin(sim.t * 1.3 + sim.seed) * 0.42;
  if (sim.patience >= 40) return CFG.defaultX + Math.sin(sim.t * 1.15) * 0.16;
  return CFG.defaultX;
}

function commitHazards(sim, held) {
  for (const h of sim.hazards) {
    if (h.resolved || h.committed) continue;
    const dist = h.s - sim.s;
    const braking = held && sim.brakeInput > CFG.irritationBrake;
    if (braking && dist < h.telegraph && dist > 0) {
      if (h.trust) {
        if (dist < h.decision && dist > h.commit) {
          h.seenBrake = Math.max(h.seenBrake, sim.brakeInput);
          h.playerBraked = true;
        }
      } else {
        h.seenBrake = Math.max(h.seenBrake, sim.brakeInput);
        h.playerBraked = true;
      }
    }
    if (dist <= h.commit && dist > -5) {
      h.commitAt = sim.t;
      if (h.trust) {
        h.committed = h.seenBrake > CFG.irritationBrake ? "lunge" : "avoid";
        if (h.committed === "lunge") {
          sim.stats.lunges += 1;
          sim.surgeT = Math.max(sim.surgeT, 2.4);
          sim.intent = "lunge";
          say(sim, "НУ ЗАЧЕМ?!");
          log(sim, { kind: "lunge", id: h.id });
        } else {
          sim.intent = "avoid";
          say(sim, "Я САМ!");
          log(sim, { kind: "avoid", id: h.id });
        }
      } else {
        h.committed = "yield";
        sim.intent = "yield";
        if (sim.patience < 70) say(sim, "ДА Я ВИЖУ!");
      }
    }
  }
}

/** Houses and trees are props. They are drawn, and they are not solid. */
export function isSolidHazard(h) {
  if (!h || h.alive === false) return false;
  if (h.solid === false) return false;
  if (h.category === "decor" || h.kind === "prop") return false;
  return true;
}

function lateralReach(h) {
  return CFG.carHalfW + h.halfW - 0.04;
}

function lateralOverlapAt(carX, hx, h) {
  return Math.abs(carX - hx) < lateralReach(h);
}

/** Where the body is now. Yield and "have they left" use only this. */
function lateralOverlap(sim, h) {
  return lateralOverlapAt(sim.x, hazardWorldX(h, sim), h);
}

/**
 * Times in [0, 1] when a straight move from a0 to a1 sits strictly inside (lo, hi).
 * The whole step is one line, so the answer is a single interval.
 */
export function overlapTimes(a0, a1, lo, hi) {
  const inside = (value) => value > lo && value < hi;
  if (a0 === a1) return inside(a0) ? [0, 1] : null;
  let t0 = (lo - a0) / (a1 - a0);
  let t1 = (hi - a0) / (a1 - a0);
  if (t0 > t1) {
    const swap = t0;
    t0 = t1;
    t1 = swap;
  }
  const start = Math.max(0, t0);
  const end = Math.min(1, t1);
  if (!(end > start)) return null;
  const mid = a0 + (a1 - a0) * ((start + end) / 2);
  if (!inside(mid)) return null;
  return [start, end];
}

export function windowsOverlap(left, right) {
  if (!left || !right) return false;
  return left[0] < right[1] && right[0] < left[1];
}

/**
 * Contact only while the lane overlap and the bumper overlap happen together.
 * Endpoints alone miss a crossing through the middle, and they also count a
 * miss when the car leaves the lane before the nose arrives.
 * Actor x is the straight line between the two samples this step produced.
 */
export function contactDuringStep(sim, h, prevS) {
  const hx0 = h.prevX ?? hazardWorldX(h, sim);
  const hx1 = hazardWorldX(h, sim);
  const reach = lateralReach(h);
  const lateral = overlapTimes((sim.prevX ?? sim.x) - hx0, sim.x - hx1, -reach, reach);
  const near = h.s - h.halfL;
  const far = h.s + h.halfL;
  const along = overlapTimes(prevS, sim.s, near - CFG.carHalfFront, far + CFG.carHalfBack);
  return windowsOverlap(lateral, along);
}

function snapshotPose(sim) {
  sim.prevS = sim.s;
  sim.prevX = sim.x;
  for (const h of sim.hazards) {
    h.prevX = hazardWorldX(h, sim);
  }
}

/** Freeze the drawn pose on the authoritative state. Render must not be the one to write this. */
export function snapRenderPose(sim) {
  if (!sim) return;
  snapshotPose(sim);
}

export function renderAlpha(accumulator, step = 1 / 60) {
  if (!(step > 0) || !Number.isFinite(accumulator)) return 1;
  const alpha = accumulator / step;
  if (alpha <= 0) return 0;
  if (alpha >= 1) return 1;
  return alpha;
}

/**
 * Picture between the previous sim step and the current one.
 * Does not write the sim. Alpha 0 is the previous step, alpha 1 is the live step.
 * UI and collision keep using the live sim, not this pose.
 */
export function renderPose(sim, alpha = 1) {
  const t = renderAlpha(alpha, 1);
  const prevS = sim.prevS ?? sim.s;
  const prevX = sim.prevX ?? sim.x;
  const hazardX = new Map();
  for (const h of sim.hazards || []) {
    const now = hazardWorldX(h, sim);
    const prev = h.prevX ?? now;
    hazardX.set(h.id, prev + (now - prev) * t);
  }
  return {
    s: prevS + (sim.s - prevS) * t,
    x: prevX + (sim.x - prevX) * t,
    alpha: t,
    hazardX,
  };
}

function frontOf(s) {
  return s + CFG.carHalfFront;
}

function markClear(sim, h, how) {
  h.resolved = "clear";
  sim.stats.clears += 1;
  if (h.trust && h.committed === "avoid") sim.stats.trustClears += 1;
  if (!h.rewarded) {
    h.rewarded = true;
    if (h.trust && h.committed === "avoid") sim.patience = Math.max(0, sim.patience - CFG.trustReward);
    else if (!h.trust && h.playerBraked) sim.patience = Math.max(0, sim.patience - CFG.saveReward);
  }
  if (h.type === "roller" && (how === "slow" || how === "scrape" || how === "pass" || how === "yield")) say(sim, "ЦЕЛЫ");
  else if (how === "slow" || how === "scrape") say(sim, "ФУХ.");
  else if (how === "yield") say(sim, "НУ ПРОШЁЛ");
  log(sim, { kind: "clear", id: h.id, how });
}

function resolveHit(sim, h) {
  const hitId = h.hitId || `hit:${h.id}`;
  h.hitId = hitId;
  const impact = sim.v;
  const excess = Math.max(0, impact - 1.2);
  let bodyLoss = (CFG.bodyPerMs[h.type] || 3) * excess;
  if (bodyLoss < 1 && (h.type === "stopped" || h.type === "cutin") && impact > 0.45) bodyLoss = 6;
  // A person or a pulling-out car taken at a real pace wrecks a trip that
  // has no cargo to fail instead. Braking down to a safe speed never gets here.
  // Cargo trips keep proportional damage so the cake or the fish can be the loss.
  if (!sim.cargoType && (h.type === "pedestrian" || h.type === "cutin") && impact > 8) {
    bodyLoss = Math.max(bodyLoss, 100);
  }
  sim.body = clamp(sim.body - bodyLoss, 0, 100);
  const cargoLoss = collisionCargoLoss(sim.cargoType, impact);
  sim.cargo = clamp(sim.cargo - cargoLoss, 0, 100);
  sim.comfortTarget = clamp(sim.comfortTarget - Math.min(30, cargoLoss * 0.35 + 8), 0, 100);
  sim.stats.collisions += 1;
  if (h.type === "stopped" || h.type === "cutin") sim.stats.mirrors += 1;
  h.resolved = "hit";
  sim.stun = 0.32;
  sim.v = Math.max(2.2, sim.v * 0.25);
  sim.shake = impact > 8 ? 7 : 4.5;
  sim.crashT = 0.24;
  sim.beltT = Math.max(sim.beltT, 0.28);
  say(sim, "ОЙ!");
  log(sim, { kind: "hit", id: h.id, hitId, type: h.type, impact: round3(impact), bodyLoss: round3(bodyLoss), cargoLoss });
}

function pinShort(sim, h) {
  // Hold the bumper this far short of the body. Drawing places the nose
  // on that bumper, so the standoff is physical and visible together.
  const stopAt = h.s - h.halfL - CFG.carHalfFront - CFG.yieldStandoff;
  if (sim.s > stopAt) sim.s = stopAt;
  sim.v = 0;
  h.yielded = true;
}

/**
 * People and cars that pull out occupy the lane on a timer.
 * A car already down to a safe speed is held in front of them.
 * It does not drive through the body, and it is not punished for having braked.
 */
function holdYield(sim, h) {
  if (h.resolved || h.trust) return false;
  if (h.type !== "pedestrian" && h.type !== "cutin") return false;
  if (h.crossT < 0) return false;
  if (!lateralOverlap(sim, h)) return false;
  const gap = h.s - h.halfL - frontOf(sim.s);
  if (gap > 11 || gap < -0.35) return false;
  if (sim.v > safeSpeed(h.type) + 1.1) return false;
  pinShort(sim, h);
  return true;
}

function collide(sim, prevS) {
  for (const h of sim.hazards) {
    if (h.resolved) continue;
    if (!isSolidHazard(h)) continue;
    if (holdYield(sim, h)) continue;

    const entered = contactDuringStep(sim, h, prevS);
    if (!entered) continue;

    const near = h.s - h.halfL;
    const gap = near - frontOf(sim.s);
    const geometric = isGeometric(h.type);
    const limit = safeSpeed(h.type);

    if (!geometric && sim.v <= limit) {
      // Already buried in the body at a crawl: they hop aside. A fresh arrival stops short.
      if (gap < -0.45 || h.type === "bin") {
        h.hopped = true;
        markClear(sim, h, sim.v <= 1.25 ? "scrape" : "slow");
        if (h.type === "bin") say(sim, "БАК ЛЁГ");
      } else {
        if (!h.yielded) log(sim, { kind: "yield", id: h.id });
        sim.stats.yields += h.yielded ? 0 : 1;
        pinShort(sim, h);
      }
      continue;
    }

    resolveHit(sim, h);
    const contact = near - CFG.carHalfFront * 0.15;
    if (sim.s > contact) sim.s = contact;
    sim.v = Math.min(sim.v, 1.6);
  }

  for (const h of sim.hazards) {
    if (h.resolved) continue;
    const dur = h.crossDur || 0;
    const crossed = dur > 0 && h.crossT >= dur && !lateralOverlap(sim, h);
    if (crossed && sim.s + 12 > h.s) {
      markClear(sim, h, h.yielded ? "yield" : "pass");
      continue;
    }
    if (sim.s <= h.s + h.clearAfter) continue;
    if ((h.type === "pedestrian" || h.type === "cutin") && h.crossT >= 0 && h.crossT < dur) continue;
    const how = h.committed === "avoid" ? "avoid" : h.yielded ? "yield" : "pass";
    if (how === "pass" && !h.trust && lateralOverlap(sim, h)) continue;
    const lateralGap = Math.abs(sim.x - hazardWorldX(h, sim)) - CFG.carHalfW - h.halfW;
    if (how === "pass" && lateralGap < 0.55 && sim.v > 8) noteNear(sim, h);
    markClear(sim, h, how);
  }
}

function noteNear(sim, h) {
  if (sim.nearT > 0) return;
  sim.nearT = 0.45;
  sim.stats.nearMisses += 1;
  sim.shake = Math.max(sim.shake, 3.2);
  sim.beltT = Math.max(sim.beltT, 0.22);
  say(sim, h.type === "dog" ? "ЧУТЬ НЕ" : "ЕЛЕ!");
  log(sim, { kind: "near", id: h.id });
}

function advanceActors(sim, dt) {
  for (const h of sim.hazards) {
    if (h.resolved) continue;
    if (h.type !== "pedestrian" && h.type !== "cutin" && h.type !== "roller") continue;
    const dist = h.s - sim.s;
    if (h.crossT < 0) {
      const close = h.type === "cutin" ? 13 : h.type === "roller" ? 22 : 11.5;
      const arrive = dist < close && dist > 3.2;
      const waited = h.playerBraked && sim.v < 2.2 && dist < close + 3 && dist > 3.2;
      if (arrive || waited) {
        h.crossT = 0;
        if (sim.v < safeSpeed(h.type) + 0.4) h.yielded = true;
        const line = h.type === "cutin" ? "ОТКУДА ОН" : h.type === "roller" ? "ВОЛОСЫ" : "ОН В ТЕЛЕФОНЕ";
        if (dist > 4) say(sim, line);
      }
    } else {
      h.crossT += dt;
      if (sim.v < safeSpeed(h.type) && h.playerBraked) h.yielded = true;
    }
  }
}

function playGags(sim) {
  const busy = sim.hazards.some((h) => !h.resolved && Math.abs(h.s - sim.s) < 28);
  if (busy) return;
  for (const g of sim.gags) {
    if (g.fired || sim.s < g.s) continue;
    g.fired = true;
    sim.gagT = 1.1;
    say(sim, g.line);
    log(sim, { kind: "gag", id: g.kind || "gag" });
    break;
  }
}

function fail(sim, reason) {
  sim.done = true;
  sim.success = false;
  sim.failReason = reason;
  sim.body = clamp(sim.body, 0, 100);
  sim.cargo = clamp(sim.cargo, 0, 100);
}

export function stepSim(sim, dt, input = {}) {
  if (sim.done) return sim;
  snapshotPose(sim);
  const held = !!input.held;

  if (input.snapBrake && held) sim.brakeInput = 1;
  else {
    const ramp = held ? 1 / CFG.brakePressTime : 1 / CFG.brakeReleaseTime;
    sim.brakeInput = clamp(sim.brakeInput + (held ? 1 : -1) * ramp * dt, 0, 1);
  }

  const releaseEdge = !held && sim.wasHeld;
  const pressEdge = held && !sim.wasHeld;
  if (pressEdge) {
    sim.resumeDelay = 0;
    sim.pressTime = 0;
    sim.spiked = false;
  }
  if (releaseEdge) {
    if (sim.pressTime > 0 && sim.pressTime < CFG.shortRelease) {
      sim.patience = Math.max(0, sim.patience - CFG.shortReleaseRelief);
      sim.stats.shortReleases += 1;
    }
    if (sim.pressTime >= 0.12) sim.comfortLock = Math.max(sim.comfortLock, CFG.comfortLock);
    sim.resumeDelay = CFG.resumeDelay;
    sim.pressTime = 0;
    sim.holdTime = 0;
  } else if (held) {
    sim.pressTime += dt;
    sim.holdTime += dt;
    sim.stats.playerBrakeTime += dt;
  } else {
    sim.holdTime = 0;
  }

  sim.inSlip = sim.slippery.some((z) => sim.s >= z.s0 && sim.s <= z.s1);
  if (sim.inSlip && !sim.saidSlip) {
    sim.saidSlip = true;
    say(sim, "СКОЛЬЗКО!");
  }
  const slip = sim.inSlip ? CFG.slipMul : 1;

  commitHazards(sim, held);

  const nearest = nextHazard(sim);
  if (nearest && nearest.committed === "lunge") sim.intent = "lunge";
  else if (nearest && nearest.committed === "avoid" && nearest.dist < 50) sim.intent = "avoid";
  else if (nearest && !nearest.trust && nearest.dist < 34) sim.intent = "yield";
  else if (sim.outburstT > 0) sim.intent = "lunge";
  else if (!nearest || nearest.dist > 40) sim.intent = "cruise";

  const cruiseBase = sim.infinite ? infiniteTargetSpeed(sim.s) : sim.cruise;
  let cruise = cruiseBase;
  if (sim.outburstT > 0) cruise = Math.min(CFG.infiniteSpeedCap, cruise + 6);
  else if (sim.surgeT > 0) cruise = Math.min(CFG.storySpeedCap + 2, cruise + 7);
  else if (sim.patience >= 40 && !held && sim.surgeT <= 0) {
    const burst = Math.sin(sim.t * 4.2 + (sim.seed % 7)) > 0.55;
    if (burst) cruise += 4.5;
  }
  // Catch-up gas only while the instructor is off the pedal. A held brake
  // must be able to beat Anton's throttle or every press feels the same.
  const pedal = sim.brakeInput;
  const catchup = clamp(cruise - sim.v, 0, 8) * 0.55 * (1 - pedal);
  let throttle = CFG.drag * cruise * (1 - 0.92 * pedal) + catchup;
  if (sim.resumeDelay > 0 && sim.surgeT <= 0 && sim.outburstT <= 0) throttle *= 0.18;
  if (sim.stun > 0) throttle *= 0.08;
  sim.lastThrottle = throttle;
  sim.stats.maxThrottle = Math.max(sim.stats.maxThrottle, throttle);

  const auto = selfBrake(sim);
  sim.lastSelfBrake = auto;
  // Player pedal and Anton's own easing share the brakes, but only the
  // player's pedal moves patience, cargo and the latch.
  const physBrake = Math.max(sim.brakeInput, auto);
  const playerDecel = brakeAccel(sim.v) * sim.brakeInput * slip;
  sim.lastPlayerDecel = playerDecel;

  const prevS = sim.s;
  if (!input.lockSpeed) {
    const cap = sim.infinite ? CFG.infiniteSpeedCap : CFG.storySpeedCap;
    const accel = netAccel(sim.v, throttle, physBrake, CFG.drag, slip);
    sim.v = clamp(sim.v + accel * dt, 0, cap);
  }
  sim.stats.minV = Math.min(sim.stats.minV, sim.v);
  sim.stats.maxV = Math.max(sim.stats.maxV, sim.v);
  sim.s += sim.v * dt;

  const steerH = nextHazard(sim);
  const params = steerParams(sim.patience, sim.outburstT > 0);
  let rate = params.rate;
  if (
    steerH &&
    steerH.committed === "avoid" &&
    sim.t < steerH.commitAt + params.delay &&
    steerH.dist > 0
  ) {
    rate = Math.min(rate, 0.65);
  }
  const want = desiredX(sim);
  sim.targetX = want;
  sim.x += clamp(want - sim.x, -rate * dt, rate * dt);
  sim.x = clamp(sim.x, -CFG.roadEdge, CFG.roadEdge);
  sim.stats.minX = Math.min(sim.stats.minX, sim.x);
  sim.stats.maxX = Math.max(sim.stats.maxX, sim.x);

  if (held && sim.brakeInput > 0.55 && sim.v > 5) {
    const last = sim.skids[sim.skids.length - 1];
    if (!last || sim.s - last.s > 1.4) {
      sim.skids.push({ s: sim.s, x: sim.x });
      if (sim.skids.length > 12) sim.skids.shift();
    }
  }

  advanceActors(sim, dt);
  playGags(sim);
  collide(sim, prevS);

  const fair = justified(sim);
  const stoppedHard =
    !input.lockSpeed &&
    sim.v < 0.35 &&
    held &&
    sim.brakeInput > 0.5 &&
    sim.holdTime > 0.5 &&
    !fair;
  const rateMood = irritationRate({
    decel: playerDecel,
    brakeInput: held ? sim.brakeInput : 0,
    holdTime: sim.holdTime,
    justified: fair,
    stopped: stoppedHard,
  });
  sim.patience = clamp(sim.patience + rateMood * dt, 0, 100);
  if (held && playerDecel > CFG.harshSpikeDecel && !sim.spiked) {
    sim.spiked = true;
    sim.patience = clamp(sim.patience + CFG.harshSpike, 0, 100);
    sim.beltT = Math.max(sim.beltT, 0.48);
    log(sim, { kind: "harsh-spike" });
  }
  if (held && sim.brakeInput > 0.92 && playerDecel > 6) sim.beltT = Math.max(sim.beltT, 0.42);

  if (!held && sim.v > CFG.calmMinSpeed) sim.calmTime += dt;
  else sim.calmTime = 0;
  if (sim.calmTime > CFG.calmAfter) sim.patience = Math.max(0, sim.patience - CFG.calmRate * dt);

  if (sim.cooldown > 0) sim.patience = Math.min(sim.patience, CFG.cooldownPatienceCap);
  if (sim.patience >= 100 && sim.cooldown <= 0 && sim.outburstT <= 0) {
    sim.patience = CFG.outburstReturn;
    sim.outburstT = CFG.outburstTime;
    sim.cooldown = CFG.outburstCooldown;
    sim.stats.outbursts += 1;
    sim.stats.honks += 1;
    say(sim, "НУ ВСЁ!");
    log(sim, { kind: "outburst" });
  }

  if (sim.cargoType && held && sim.brakeInput >= CFG.fullPress && playerDecel > CFG.cargoDecel) {
    if (!sim.fullPressLatched) {
      sim.fullPressLatched = true;
      sim.cargo -= cargoImpulse(sim.cargoType);
      sim.stats.harshFull += 1;
      sim.cargoFlash = 0.55;
      say(sim, sim.cargoType === "fish" ? "РЫБКА" : "КРЕМ");
      sim.comfortTarget = clamp(sim.comfortTarget - CFG.comfortDrop, 0, 100);
      log(sim, { kind: "cargo-impulse", type: sim.cargoType, cargo: sim.cargo });
    } else {
      sim.cargo -= cargoSustain(sim.cargoType) * dt;
      sim.comfortTarget = clamp(sim.comfortTarget - 6 * dt, 0, 100);
    }
  } else if (sim.brakeInput < 0.85) sim.fullPressLatched = false;

  if (sim.comfortLock > 0) sim.comfortLock = Math.max(0, sim.comfortLock - dt);
  else if (!held && sim.brakeInput < 0.25) {
    sim.comfortTarget = clamp(sim.comfortTarget + CFG.comfortRecover * dt, 0, 100);
  }
  const blend = 1 - Math.exp(-CFG.comfortLerp * dt);
  sim.comfort += (sim.comfortTarget - sim.comfort) * blend;
  sim.comfort = clamp(sim.comfort, 0, 100);
  sim.cargo = clamp(sim.cargo, 0, 100);

  if (sim.body <= 0) fail(sim, "body");
  else if (sim.cargoType && sim.cargo <= 0) fail(sim, "cargo");
  else if (!sim.infinite && sim.s >= sim.length) {
    sim.done = true;
    sim.success = true;
    sim.failReason = null;
  }

  sim.cooldown = Math.max(0, sim.cooldown - dt);
  sim.outburstT = Math.max(0, sim.outburstT - dt);
  sim.surgeT = Math.max(0, sim.surgeT - dt);
  sim.beltT = Math.max(0, sim.beltT - dt);
  sim.stun = Math.max(0, sim.stun - dt);
  sim.resumeDelay = Math.max(0, sim.resumeDelay - dt);
  sim.shake = Math.max(0, sim.shake - dt * 18);
  sim.crashT = Math.max(0, sim.crashT - dt);
  sim.nearT = Math.max(0, sim.nearT - dt);
  sim.cargoFlash = Math.max(0, sim.cargoFlash - dt);
  sim.gagT = Math.max(0, sim.gagT - dt);
  if (sim.bubbleT > 0) sim.bubbleT -= dt;
  else sim.bubble = null;
  if (sim.bubbleGap > 0) sim.bubbleGap -= dt;
  sim.t += dt;
  sim.wasHeld = held;
  return sim;
}

export function runSim(mission, policy, opts = {}) {
  const sim = createSim(mission, opts.seed ?? mission.seed ?? 1);
  const dt = CFG.dt;
  const max = opts.maxTime ?? 200;
  let t = 0;
  while (!sim.done && t < max) {
    const held = !!policy(sim, t);
    stepSim(sim, dt, { held });
    t += dt;
  }
  if (!sim.done) {
    sim.done = true;
    sim.success = false;
    sim.failReason = "timeout";
  }
  return sim;
}
