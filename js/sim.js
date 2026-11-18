/**
 * Fixed-step yard simulation. The player never steers and never throttles.
 * `held` is the brake pedal. Anton chooses throttle and lane.
 *
 * Integrator (see physics.js):
 *   v += (throttle - drag * v - brake * a(v) * slip) * dt
 */

import { CFG } from "./config.js";
import { nearestGateS } from "./roadside.js";
import {
  buildDetourPath,
  clearsAt,
  createLat,
  detourBlocked,
  detourGap,
  lateralTargetX,
  passX,
} from "./lat.js";
import { mulberry32 } from "./rng.js";
import {
  applyRoadside,
  bootDistraction,
  inDanger,
  playerHonk,
  pokeAttention as pokeDistraction,
  registerPoke,
  steerWithDrift,
  strikeRoadside,
  swipePhone,
} from "./distract.js";
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
    crossDur: h.crossDur ?? (h.type === "pedestrian" ? 3.21 : h.type === "cutin" ? 2.65 : 0),
    yielded: false,
    hopped: false,
  }));
  for (const hazard of hazards) initEntity(hazard);
  const sim = {
    missionId: mission.id,
    infinite: !!mission.infinite,
    length: mission.length,
    cruise: mission.cruise ?? 16,
    brakeMul: mission.brakeMul ?? 1,
    patienceMul: mission.patienceMul ?? 1,
    ignoresMarkings: mission.ignoresMarkings === true,
    district: mission.district || null,
    passenger: mission.passenger || null,
    car: mission.car || "yellow",
    portrait: mission.portrait || null,
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
    failCause: null,
    lastHit: null,
    potholeLineAt: 0,
    shake: 0,
    crashT: 0,
    lastThrottle: 0,
    lastSelfBrake: 0,
    lastPlayerDecel: 0,
    inSlip: false,
    targetX: CFG.defaultX,
    lat: createLat(),
    skids: [],
    gags: (mission.gags || []).map((g) => ({ ...g, fired: false })),
    gagT: 0,
    nearT: 0,
    cargoFlash: 0,
    phoneAt: mission.phoneAt ?? null,
    phoneFor: mission.phoneFor ?? null,
    sleepDrowsyAt: mission.sleepDrowsyAt ?? null,
    sleepAt: mission.sleepAt ?? null,
    sleepFor: mission.sleepFor ?? null,
    attention: "road",
    phonePlayed: false,
    sleepPlayed: false,
    wokeFrom: null,
    stowT: 0,
    wakeT: 0,
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
      attentionPokes: 0,
      minV: Infinity,
      maxV: 0,
      maxThrottle: 0,
      minX: CFG.defaultX,
      maxX: CFG.defaultX,
    },
    events: [],
  };
  bootDistraction(sim);
  sim.say = (text, force) => say(sim, text, force);
  return sim;
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

function hashPed(n) {
  let x = Math.imul(n | 0, 0x9e3779b1);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Same blue/pink split the pixel pedestrians use. */
export function pedColor(h) {
  return (hashPed(String(h?.id || "").length * 13 + ((h?.s || 0) | 0)) & 1) ? "blue" : "pink";
}

function sideOf(h, near = 4.15) {
  return h.x >= 0 ? near : -near;
}

/** Metres from the centre line where a living actor waits. The grass starts near 4.93. */
export const WAIT_X = {
  pedestrian: 4.15,
  dog: 3.9,
  cutin: 4.35,
};

function smooth(t) {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

/** pedestrian | animal | car | static. Cars that already sit in a lane are parked. */
export function familyOf(type) {
  if (type === "pedestrian") return "pedestrian";
  if (type === "dog") return "animal";
  if (type === "cutin" || type === "stopped") return "car";
  return "static";
}

function sideX(h, abs) {
  return (h.x >= 0 ? 1 : -1) * abs;
}

/**
 * Lateral position in metres. The sim step writes `pose`; collision,
 * steering and the picture only read it. Objects built by a test with
 * no pose still answer from the old crossing curve.
 */
export function hazardWorldX(h, sim) {
  const posed = h && h.pose && Number.isFinite(h.pose.x);
  // A test can set crossT on a body that has not stepped yet. Until the
  // machine leaves the curb, that clock still answers.
  const sampling = h && h.crossT >= 0 && (!h.motion || h.motion === "curb");
  if (posed && !sampling) return h.pose.x;
  return derivedWorldX(h, sim);
}

function derivedWorldX(h, sim) {
  const dist = h.s - (sim?.s || 0);
  if (h.type === "pedestrian") return actorCurve(h, dist, 5.2, -Math.sign(h.x || 1) * 5.35);
  if (h.type === "cutin") return actorCurve(h, dist, 5.6, -Math.sign(h.x || 1) * 5.5);
  if (h.type === "dog") {
    const side = sideOf(h, 4.9);
    if (dist > 18) return side + Math.sin(h.s) * 0.15;
    const t = clamp(1 - dist / 18, 0, 1);
    return side + (h.x - side) * t + Math.sin(t * Math.PI) * 0.85 * Math.sign(side || 1);
  }
  // Bins, lids, holes and parked cars never drift. Their authored x is the position.
  return h.x;
}

/** Old curve, kept so a gait sample can ask "where would u be" without a pose. */
function actorCurve(h, dist, sideAbs, farX) {
  const side = h.x >= 0 ? sideAbs : -sideAbs;
  const lane = h.x;
  if (h.hopped) return farX;
  if (!(h.crossT >= 0)) {
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

const PED_ENTER = 0.4;
const PED_LINGER = 1.94;
const PED_LEAVE = 0.87;
const PED_TOTAL = PED_ENTER + PED_LINGER + PED_LEAVE;
const CUT_ENTER = 0.9;
const DOG_DART = 0.85;
const DOG_LEAVE = 0.9;

function initEntity(h) {
  h.family = familyOf(h.type);
  if (h.family === "static" || h.type === "stopped") h.motion = "rest";
  else h.motion = "curb";
  h.motionT = 0;
  const x = h.family === "static" || h.type === "stopped"
    ? h.x
    : sideX(h, WAIT_X[h.type] || WAIT_X.pedestrian);
  h.pose = { s: h.s, x };
  h.prevPose = { s: h.s, x };
}

/**
 * People walk across and finish. Animals dart and leave. A cut-in takes
 * the lane and drives along it. Bins, lids, holes and parked cars never
 * change their own x.
 */
function advanceEntity(h, sim, dt) {
  if (!h.pose) initEntity(h);
  if (h.wobbleT > 0) h.wobbleT = Math.max(0, h.wobbleT - dt);
  if (h.resolved) return;
  const dist = h.s - sim.s;
  if (h.family === "pedestrian") advancePedestrian(h, sim, dt, dist);
  else if (h.family === "animal") advanceAnimal(h, sim, dt, dist);
  else if (h.type === "cutin") advanceCutin(h, sim, dt, dist);
  else {
    h.motion = h.motion === "shoved" ? "shoved" : "rest";
    h.pose.s = h.s;
    h.pose.x = h.x;
  }
}

function advancePedestrian(h, sim, dt, dist) {
  const curb = sideX(h, WAIT_X.pedestrian);
  const lane = h.x;
  if (h.honkMode === "wait") {
    h.motion = "curb";
    h.pose.x = curb;
    h.pose.s = h.s;
    h.crossT = -1;
    if (dist < -2) {
      h.honkMode = null;
      markClear(sim, h, "honk");
    }
    return;
  }
  if (h.honkMode === "hopback") {
    h.motionT = (h.motionT || 0) + dt;
    const u = Math.min(1, h.motionT / 0.35);
    h.motion = "enter";
    h.pose.x = lane + (curb - lane) * u;
    h.pose.s = h.s;
    if (u >= 1) {
      h.honkMode = "wait";
      h.motion = "curb";
      h.motionT = 0;
      h.pose.x = curb;
    }
    return;
  }
  if (h.honkMode === "hurry") dt *= CFG.honk.hurry;
  const far = -Math.sign(h.x || 1) * 5.35;
  if (h.motion === "curb" && h.crossT >= 0) {
    h.motion = "enter";
    h.motionT = clamp(h.crossT / (h.crossDur || PED_TOTAL), 0, 1) * PED_TOTAL;
  }
  const onTop = dist < h.halfL + CFG.carHalfFront && dist > -(h.halfL + CFG.carHalfBack);
  if (h.motion === "curb" && onTop && !(h.crossT >= 0)) {
    h.motion = "linger";
    h.motionT = PED_ENTER + 0.05;
    h.pose.x = lane;
    h.pose.s = h.s;
    h.crossT = ((h.motionT / PED_TOTAL) * (h.crossDur || PED_TOTAL));
    return;
  }
  if (h.motion === "curb") {
    h.pose.x = curb;
    h.pose.s = h.s;
    h.crossT = -1;
    const prevDist = h.s - (sim.prevS ?? sim.s);
    const seen = Math.min(prevDist, dist) < 11.5 && Math.max(prevDist, dist) > -1;
    if (!seen) return;
    h.motion = "enter";
    h.motionT = 0;
    h.crossT = 0;
    if (sim.v < 3.4) h.yielded = true;
  }
  h.motionT += dt;
  const t = h.motionT;
  if (t < PED_ENTER) {
    h.motion = "enter";
    h.pose.x = curb + (lane - curb) * smooth(t / PED_ENTER);
  } else if (t < PED_ENTER + PED_LINGER) {
    h.motion = "linger";
    h.pose.x = lane;
  } else if (t < PED_TOTAL) {
    h.motion = "leave";
    h.pose.x = lane + (far - lane) * smooth((t - PED_ENTER - PED_LINGER) / PED_LEAVE);
  } else {
    h.motion = "off";
    h.pose.x = far;
  }
  h.pose.s = h.s;
  const dur = h.crossDur || PED_TOTAL;
  h.crossT = h.motion === "off" ? dur : (t / PED_TOTAL) * dur;
  if (sim.v < 3 && h.playerBraked) h.yielded = true;
}

function advanceAnimal(h, sim, dt, dist) {
  const curb = sideX(h, WAIT_X.dog);
  const lane = h.x;
  if (h.honkMode === "flee") {
    h.motion = "flee";
    h.motionT = (h.motionT || 0) + dt;
    const away = sideX(h, 6.2);
    const gate = nearestGateS(h.s, h.x >= 0 ? "right" : "left");
    const u = Math.min(1, h.motionT / CFG.honk.dogFlee);
    // Along the sidewalk first. Crossing the fence only happens inside the gate.
    const along = Math.min(1, u / 0.55);
    const out = u <= 0.55 ? 0 : (u - 0.55) / 0.45;
    h.pose.s = h.s + (gate - h.s) * along;
    h.pose.x = curb + (away - curb) * out;
    if (u >= 1) {
      h.motion = "off";
      h.honkMode = null;
      h.pose.x = away;
      h.pose.s = gate;
      markClear(sim, h, "honk");
    }
    return;
  }
  if (h.motion === "curb") {
    h.pose.x = curb + Math.sin(h.s) * 0.15;
    h.pose.s = h.s;
    if (dist < 18 && dist > -2) {
      h.motion = "dart";
      h.motionT = 0;
    }
    return;
  }
  h.motionT += dt;
  if (h.motion === "dart" && h.motionT < DOG_DART) {
    const u = h.motionT / DOG_DART;
    h.pose.x = curb + (lane - curb) * smooth(u) + Math.sin(u * Math.PI) * 0.85 * Math.sign(curb || 1);
  } else if (h.motion === "dart") {
    h.motion = "leave";
    h.motionT = 0;
    h.pose.x = lane;
  }
  if (h.motion === "leave") {
    const u = clamp(h.motionT / DOG_LEAVE, 0, 1);
    // Back to the curb they came from, so Anton's avoid lane stays empty.
    h.pose.x = lane + (curb - lane) * smooth(u);
    if (h.motionT >= DOG_LEAVE) h.motion = "off";
  }
  if (h.motion === "off") h.pose.x = curb;
  h.pose.s = h.s;
}

function advanceCutin(h, sim, dt, dist) {
  const curb = sideX(h, WAIT_X.cutin);
  const lane = h.x;
  if (h.honkHold) {
    h.motion = "curb";
    h.pose.x = curb;
    h.pose.s = h.s;
    h.crossT = -1;
    if (dist < -4) {
      h.honkHold = false;
      markClear(sim, h, "honk");
    }
    return;
  }
  const onTop = dist < h.halfL + CFG.carHalfFront && dist > -(h.halfL + CFG.carHalfBack);
  if (h.motion === "curb" && onTop) {
    h.motion = "lane";
    h.motionT = CUT_ENTER;
    h.pose.x = lane;
    h.pose.s = h.s;
    h.crossT = h.crossDur || 2.65;
    return;
  }
  if (h.motion === "curb") {
    h.pose.x = curb;
    h.pose.s = h.s;
    h.crossT = -1;
    const prevDist = h.s - (sim.prevS ?? sim.s);
    const seen = Math.min(prevDist, dist) < 13 && Math.max(prevDist, dist) > -1;
    if (!seen) return;
    h.motion = "enter";
    h.motionT = 0;
    h.crossT = 0;
    if (sim.v < 4) h.yielded = true;
  }
  h.motionT += dt;
  if (h.motionT < CUT_ENTER) {
    h.motion = "enter";
    h.pose.x = curb + (lane - curb) * smooth(h.motionT / CUT_ENTER);
  } else {
    h.motion = "lane";
    h.pose.x = lane;
  }
  // Once the player has slowed, the other car drives off along the lane.
  // At cruise it holds its spot, so the hit is unavoidable.
  if (sim.v < 5) h.yielded = true;
  if (h.yielded) h.pose.s += Math.max(18, CFG.infiniteSpeedCap + 2) * dt;
  h.s = h.pose.s;
  const dur = h.crossDur || 2.65;
  const gap = h.pose.s - sim.s;
  if (h.motion === "lane" && h.yielded && gap > 16) h.crossT = dur;
  else if (h.motion === "lane") h.crossT = dur * 0.5;
  else h.crossT = (h.motionT / CUT_ENTER) * dur * 0.4;
  if (sim.v < 3.6 && h.playerBraked) h.yielded = true;
}

/** Knock a living body out of the car. Statics and a stopped car stay put. */
function shovePose(sim, h) {
  if (familyOf(h.type) === "static" || h.type === "stopped") return;
  if (!h.pose) initEntity(h);
  h.hopped = true;
  if (h.type === "cutin") {
    h.pose.x = h.x;
    h.pose.s = Math.max(h.pose.s, sim.s + CFG.carHalfFront + h.halfL + 0.55);
    h.s = h.pose.s;
    h.motion = "lane";
    return;
  }
  if (h.family === "pedestrian" || h.family === "animal") {
    h.pose.x = -Math.sign(h.x || 1) * (h.family === "animal" ? 5.1 : 5.35);
    h.pose.s = h.s;
    h.motion = "off";
    h.crossT = h.crossDur || PED_TOTAL;
  }
}

function log(sim, entry) {
  sim.events.push({ t: round3(sim.t), ...entry });
  if (sim.events.length > 80) sim.events.shift();
}

function say(sim, text, force) {
  if (!force && sim.bubble && sim.bubbleGap > 0.4) return;
  sim.bubble = text;
  sim.bubbleT = 1.15;
  sim.bubbleGap = 2.3;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function justified(sim) {
  for (const h of sim.hazards) {
    if (h.resolved) continue;
    const dist = h.s - sim.s;
    if (h.type === "pothole" && isSolidHazard(h) && dist < h.telegraph && dist > -4) return true;
    if (h.trust) continue;
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

/**
 * Furthest the centre may sit. The body then ends on the asphalt edge.
 * Mirrors painted past carHalfW are not included.
 */
export function bodyCenterLimit() {
  return CFG.roadHalf - CFG.carHalfW;
}

function laneDesiredX(sim) {
  const h = nextHazard(sim);
  let x = CFG.defaultX;
  if (h && h.committed === "lunge" && h.dist > -4 && h.dist < 50) x = h.x;
  else if (h && h.committed === "avoid" && h.dist > -8 && h.dist < 55) {
    const params = steerParams(sim.patience, sim.outburstT > 0);
    const sign = Math.sign(h.x || 1);
    x = -sign * CFG.defaultX - sign * params.overshoot;
  } else if (sim.outburstT > 0) {
    x = CFG.defaultX + Math.sin(sim.t * 2.4) * 0.35;
  } else if (h && h.dist < 78) x = CFG.defaultX;
  else if (sim.patience >= 70) x = CFG.defaultX + Math.sin(sim.t * 1.3 + sim.seed) * 0.42;
  else if (sim.patience >= 40) x = CFG.defaultX + Math.sin(sim.t * 1.15) * 0.16;
  if (sim.ignoresMarkings && !(h && (h.committed === "avoid" || h.committed === "lunge"))) {
    x += Math.sin(sim.s * 0.08) * 1.1;
  }
  return x;
}

function desiredX(sim) {
  const limit = bodyCenterLimit();
  return clamp(lateralTargetX(sim, laneDesiredX(sim)), -limit, limit);
}

function outOfIt(sim) {
  return sim.attention === "phone" || sim.attention === "asleep" || sim.attention === "grope";
}

/** A counted poke. Phone takes one, a doze takes two, sleep takes three. */
export function pokeAttention(sim) {
  return pokeDistraction(sim);
}

export { registerPoke, swipePhone, playerHonk };

function advanceAttention(sim, dt) {
  if (sim.attention === "road" && sim.phoneAt !== null && sim.phoneAt !== undefined && !sim.phonePlayed && sim.s >= sim.phoneAt) {
    sim.phonePlayed = true;
    sim.attention = "phone";
  }
  if (sim.attention === "road" && sim.sleepDrowsyAt !== null && sim.sleepDrowsyAt !== undefined && !sim.sleepPlayed && sim.s >= sim.sleepDrowsyAt) {
    sim.sleepPlayed = true;
    sim.attention = "drowsy";
  }
  if (sim.attention === "drowsy" && sim.sleepAt !== null && sim.sleepAt !== undefined && sim.s >= sim.sleepAt) {
    sim.attention = "asleep";
  }
  if (sim.attention === "stow") {
    sim.stowT += dt;
    if (sim.stowT >= 0.72) sim.attention = "earnest";
  }
  if (sim.attention === "wake") {
    sim.wakeT += dt;
    if (sim.wakeT >= 0.62) {
      if (sim.sorryAfterWake) {
        sim.sorryAfterWake = false;
        sim.attention = "sorry";
        sim.sorryT = 1;
        sim.react = { id: "sorry", until: sim.t + 1 };
        say(sim, "ИЗВИНИ!");
      } else sim.attention = "earnest";
    }
  }
  if (sim.attention === "earnest") {
    const linkedId = sim.wokeFrom === "sleep" ? sim.sleepFor : sim.phoneFor;
    const linked = linkedId ? sim.hazards.find((hazard) => hazard.id === linkedId) : null;
    if (linked && linked.resolved) sim.attention = "road";
  }
}

function commitHazards(sim, held) {
  for (const h of sim.hazards) {
    if (h.resolved) continue;
    // A pothole is a stop, then a detour. It never takes the cruise avoid or the lunge.
    if (h.type === "pothole") continue;
    const dist = h.s - sim.s;
    if (h.committed === "asleep" && !outOfIt(sim) && dist > 14) {
      h.committed = "avoid";
      h.commitAt = sim.t;
      sim.intent = "avoid";
      say(sim, "Я САМ!");
      log(sim, { kind: "avoid", id: h.id });
    }
    if (h.committed) continue;
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
        if (outOfIt(sim)) {
          h.committed = "asleep";
          sim.intent = sim.attention === "asleep" ? "sleep" : "phone";
          log(sim, { kind: "asleep", id: h.id });
          continue;
        }
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
  const s0 = h.prevS ?? h.s;
  const s1 = h.s;
  const along = overlapTimes(
    prevS - s0,
    sim.s - s1,
    -(h.halfL + CFG.carHalfFront),
    h.halfL + CFG.carHalfBack,
  );
  return windowsOverlap(lateral, along);
}

function snapshotPose(sim) {
  sim.prevS = sim.s;
  sim.prevX = sim.x;
  for (const h of sim.hazards) {
    h.prevS = h.s;
    h.prevX = hazardWorldX(h, sim);
    if (h.pose) h.prevPose = { s: h.pose.s, x: h.pose.x };
    h.prevTravel = actorTravel(h, sim);
  }
}

/** Freeze the drawn pose on the authoritative state. Render must not be the one to write this. */
export function snapRenderPose(sim) {
  if (!sim) return;
  snapshotPose(sim);
}

/** Fields the picture needs so a replay can put a body back where it was. */
export function hazardSnap(hazards) {
  return (hazards || []).map((h) => ({
    id: h.id,
    resolved: h.resolved,
    committed: h.committed,
    crossT: h.crossT,
    hopped: !!h.hopped,
    yielded: !!h.yielded,
    s: h.s,
    x: h.x,
    motion: h.motion,
    motionT: h.motionT,
    family: h.family,
    pose: h.pose ? { s: h.pose.s, x: h.pose.x } : null,
  }));
}

export function applyHazardSnap(hazards, snap) {
  if (!snap) return;
  for (const item of snap) {
    const h = (hazards || []).find((hazard) => hazard.id === item.id);
    if (!h) continue;
    h.resolved = item.resolved;
    h.committed = item.committed;
    h.crossT = item.crossT;
    h.hopped = item.hopped;
    h.yielded = item.yielded;
    if (Number.isFinite(item.s)) h.s = item.s;
    if (Number.isFinite(item.x)) h.x = item.x;
    if (item.motion) h.motion = item.motion;
    if (Number.isFinite(item.motionT)) h.motionT = item.motionT;
    if (item.family) h.family = item.family;
    if (item.pose) h.pose = { s: item.pose.s, x: item.pose.x };
  }
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
  const hazardTravel = new Map();
  for (const h of sim.hazards || []) {
    const now = hazardWorldX(h, sim);
    const prev = h.prevX ?? now;
    hazardX.set(h.id, prev + (now - prev) * t);
    const nowTravel = actorTravel(h, sim);
    const prevTravel = h.prevTravel ?? nowTravel;
    hazardTravel.set(h.id, prevTravel + (nowTravel - prevTravel) * t);
  }
  return {
    s: prevS + (sim.s - prevS) * t,
    x: prevX + (sim.x - prevX) * t,
    alpha: t,
    hazardX,
    hazardTravel,
  };
}

/**
 * Metres this body has walked. Waiting, lingering and a finished dart stay put.
 * The value depends on the pose, not on how many steps reached it.
 */
export function actorTravel(h, sim) {
  if (!h) return 0;
  if (h.type === "pedestrian") return pedestrianTravel(h);
  if (h.type === "dog") return dogTravel(h, h.s - (sim?.s || 0));
  return 0;
}

function pedestrianTravel(h) {
  if (h.hopped || !(h.crossT >= 0)) return 0;
  const dur = h.crossDur || 3.35;
  const u = clamp(h.crossT / dur, 0, 1);
  const dummy = { s: h.s - 10 };
  const at = (uu) => derivedWorldX({ ...h, pose: undefined, crossT: uu * dur, hopped: false }, dummy);
  const side = at(0);
  const lane = at(0.2);
  const here = at(u);
  if (u <= 0.16) return Math.abs(here - side);
  const inbound = Math.abs(lane - side);
  if (u <= 0.74) return inbound;
  return inbound + Math.abs(here - lane);
}

function dogTravel(h, dist) {
  if (dist >= 18) return 0;
  const end = clamp(1 - Math.max(dist, 0) / 18, 0, 1);
  const steps = 64;
  const n = Math.max(1, Math.round(steps * end));
  const at = (t) => derivedWorldX({ ...h, pose: undefined }, { s: h.s - 18 * (1 - t) });
  let prev = at(0);
  let length = 0;
  for (let i = 1; i <= n; i += 1) {
    const x = at((end * i) / n);
    length += Math.abs(x - prev);
    prev = x;
  }
  return length;
}

function frontOf(s) {
  return s + CFG.carHalfFront;
}

function markClear(sim, h, how) {
  h.resolved = "clear";
  sim.stats.clears += 1;
  const detour = how === "detour";
  const trustedAvoid = h.trust && h.committed === "avoid";
  if (detour || trustedAvoid) sim.stats.trustClears += 1;
  if (!h.rewarded) {
    h.rewarded = true;
    if (detour || trustedAvoid) sim.patience = Math.max(0, sim.patience - CFG.trustReward);
    else if (!h.trust && h.playerBraked) sim.patience = Math.max(0, sim.patience - CFG.saveReward);
  }
  if (how === "touch") say(sim, "ФУХ.");
  else if (h.type === "roller" && (how === "slow" || how === "scrape" || how === "pass" || how === "yield")) say(sim, "ЦЕЛЫ");
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
  if ((h.type === "pedestrian" || h.type === "dog") && impact >= 1.2) bodyLoss = 100;
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
  sim.lastHit = {
    id: h.id,
    type: h.type,
    t: sim.t,
    x: hazardWorldX(h, sim),
    color: h.type === "pedestrian" ? pedColor(h) : (h.color ?? null),
    object: h.object ?? null,
  };
  const quiet = (sim.attention === "asleep" || sim.attention === "drowsy") && h.type === "pothole";
  const ended = sim.body <= 0;
  if (!quiet && !ended) {
    say(sim, "ОЙ!");
    if (h.type === "pothole") sim.potholeLineAt = sim.t + 0.7;
  } else if (!quiet && ended && h.type !== "pothole") {
    say(sim, "ОЙ!");
  }
  const carHit = h.type === "pothole" || h.type === "stopped" || h.type === "cutin" || h.type === "bin" || h.type === "roller";
  if (!quiet && carHit && sim.body > 0) sim.beltT = Math.max(sim.beltT, 0.7);
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

    if (!contactDuringStep(sim, h, prevS)) continue;
    resolveContact(sim, h);
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
    const how = h.detoured ? "detour" : h.committed === "avoid" ? "avoid" : h.yielded ? "yield" : "pass";
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

function boxesOverlapNow(sim, h) {
  const hx = hazardWorldX(h, sim);
  const hs = h.pose?.s ?? h.s;
  const lateral = Math.abs(sim.x - hx) < CFG.carHalfW + h.halfW - 0.02;
  const along = sim.s + CFG.carHalfFront > hs - h.halfL && sim.s - CFG.carHalfBack < hs + h.halfL;
  return lateral && along;
}

/**
 * Detection already happened. Resolution is a table: stop short, comic shove,
 * or a real hit. Every branch leaves the pose outside the car.
 */
function softTouch(sim, h) {
  h.solid = false;
  h.wobbleT = 0.45;
  sim.shake = Math.max(sim.shake, 1.5);
  markClear(sim, h, "touch");
}

function resolveContact(sim, h) {
  const near = (h.pose?.s ?? h.s) - h.halfL;
  const gap = near - frontOf(sim.s);
  const geometric = isGeometric(h.type);
  const limit = safeSpeed(h.type);
  // A hole can dent the car. It never moves and it is never taken away.
  if (h.type === "pothole") {
    resolveHit(sim, h);
    return;
  }
  // Cruise clips a bin or a lid. The sprite stays; the collider lets the car go.
  if (h.type === "bin" || h.type === "roller") {
    if (sim.v <= limit) {
      softTouch(sim, h);
      return;
    }
    h.solid = false;
    resolveHit(sim, h);
    return;
  }
  if (!geometric && sim.v <= limit && gap >= -0.45) {
    if (!h.yielded) log(sim, { kind: "yield", id: h.id });
    sim.stats.yields += h.yielded ? 0 : 1;
    pinShort(sim, h);
    return;
  }
  if (!geometric && sim.v <= limit) {
    shovePose(sim, h);
    markClear(sim, h, sim.v <= 1.25 ? "scrape" : "slow");
    return;
  }
  shovePose(sim, h);
  resolveHit(sim, h);
  if (boxesOverlapNow(sim, h)) shovePose(sim, h);
}

function advanceActors(sim, dt) {
  for (const h of sim.hazards) {
    if (!isSolidHazard(h)) continue;
    const before = h.motion;
    advanceEntity(h, sim, dt);
    if (before === "curb" && h.motion !== "curb" && h.motion !== "rest") {
      const dist = (h.pose?.s ?? h.s) - sim.s;
      const line = h.type === "cutin" ? "ОТКУДА ОН" : h.type === "roller" ? "ВОЛОСЫ" : h.type === "pedestrian" ? "ОН В ТЕЛЕФОНЕ" : null;
      if (line && dist > 4) say(sim, line);
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
  const recent = sim.lastHit && Math.abs(sim.t - sim.lastHit.t) <= 0.05;
  sim.failCause = recent ? sim.lastHit.type : reason;
}

function openHole(h) {
  return h && h.type === "pothole" && !h.resolved && isSolidHazard(h);
}

function upcomingHole(sim) {
  let best = null;
  let bestGap = Infinity;
  for (const h of sim.hazards) {
    if (!openHole(h)) continue;
    const gap = detourGap(sim, h);
    if (gap < CFG.detour.minGap) continue;
    if (gap < bestGap) {
      best = h;
      bestGap = gap;
    }
  }
  if (!best) return null;
  for (const h of sim.hazards) {
    if (h === best || h.resolved || !isSolidHazard(h)) continue;
    if (h.s < best.s - 0.5 && h.s + h.halfL > sim.s - 2) return null;
  }
  return best;
}

function holeById(sim, id) {
  if (!id) return null;
  return sim.hazards.find((h) => h.id === id) || null;
}

function gatherHoles(sim, primary) {
  const xPass = passX(primary);
  if (xPass === null) return null;
  const holes = [primary];
  let guard = 0;
  let built = null;
  while (guard < 6) {
    guard += 1;
    built = buildDetourPath(holes);
    if (!built) return null;
    let added = false;
    for (const h of sim.hazards) {
      if (holes.includes(h) || !openHole(h)) continue;
      const hs = h.pose?.s ?? h.s;
      if (hs < sim.s - 2 || hs > built.sExit + 14) continue;
      if (!clearsAt(xPass, h)) continue;
      holes.push(h);
      added = true;
    }
    if (!added) break;
  }
  return built ? { ...built, holes } : null;
}

function leaveDetour(lat, resume) {
  lat.mode = "lane";
  lat.path = null;
  lat.holdX = null;
  lat.cruiseCap = null;
  lat.blocked = false;
  lat.holeId = null;
  lat.sExit = null;
  lat.sEnter = null;
  lat.pause = 0;
  lat.ramp = 0;
  lat.release = 0;
  lat.said = false;
  lat.stopped = false;
  lat.braked = false;
  lat.wantV = null;
  lat.resumeLeft = resume ? CFG.detour.resumeCruise : 0;
}

function beginAim(sim, hole) {
  const built = gatherHoles(sim, hole);
  const lat = sim.lat;
  if (!built) {
    lat.wantV = 0;
    lat.stopped = true;
    return;
  }
  lat.mode = "aim";
  lat.path = built.path;
  lat.sEnter = built.sEnter;
  lat.sExit = built.sExit;
  lat.holeId = hole.id;
  lat.holes = built.holes;
  lat.pause = 0;
  lat.ramp = 0;
  lat.cruiseCap = CFG.detour.speed;
  lat.holdX = null;
  lat.wantV = 0;
  if (!lat.said) {
    sim.bubbleGap = 0;
    say(sim, "ОБЪЕДУ");
    lat.said = true;
  }
}

function beginApproach(sim, hole) {
  const lat = sim.lat;
  lat.mode = "approach";
  lat.holeId = hole.id;
  lat.path = null;
  lat.sExit = null;
  lat.cruiseCap = CFG.detour.speed;
  lat.ramp = 0;
  lat.holdX = null;
  lat.release = CFG.detour.releaseHold;
}

function crawlSpeed(lat) {
  const u = clamp(lat.ramp / CFG.detour.ramp, 0, 1);
  return CFG.detour.speed * u;
}

/**
 * Full stop, release, then either crawl up to the hole or pause and take the S.
 * lockSpeed never arms this. Sleep and the phone never arm it.
 */
function advanceDetour(sim, dt, held, lockSpeed) {
  const lat = sim.lat;
  if (!lat) return;
  lat.wantV = null;
  lat.blocked = false;
  if (sim.drift?.active) {
    if (lat.mode !== "lane") leaveDetour(lat, false);
    return;
  }
  if (lockSpeed) return;

  const spec = CFG.detour;
  if (lat.mode === "lane") {
    const hole = upcomingHole(sim);
    lat.gap = hole ? detourGap(sim, hole) : null;
    if (!hole || outOfIt(sim)) {
      lat.stopped = false;
      lat.release = 0;
      return;
    }
    if (held) lat.braked = true;
    if (!lat.braked) {
      lat.stopped = false;
      lat.release = 0;
      return;
    }
    if (sim.v < spec.stopV) lat.stopped = true;
    else if (sim.v > 0.8) lat.stopped = false;
    if (!lat.stopped) {
      lat.release = 0;
      return;
    }
    if (held) {
      lat.release = 0;
      return;
    }
    lat.release += dt;
    lat.wantV = 0;
    if (lat.release < spec.releaseHold) return;
    if (lat.gap > spec.aimWindow) beginApproach(sim, hole);
    else beginAim(sim, hole);
  }

  if (lat.mode === "approach") {
    const hole = holeById(sim, lat.holeId);
    lat.gap = hole ? detourGap(sim, hole) : null;
    lat.cruiseCap = spec.speed;
    if (!hole || hole.resolved || outOfIt(sim)) {
      leaveDetour(lat, false);
      return;
    }
    if (held) {
      lat.holdX = sim.x;
      lat.wantV = 0;
      lat.ramp = 0;
      lat.release = 0;
      return;
    }
    lat.holdX = null;
    lat.release += dt;
    if (lat.release < spec.releaseHold) {
      lat.wantV = 0;
      return;
    }
    if (lat.gap < spec.minGap) {
      leaveDetour(lat, false);
      return;
    }
    if (lat.gap <= spec.aimWindow) {
      beginAim(sim, hole);
    } else {
      lat.ramp += dt;
      lat.wantV = crawlSpeed(lat);
      return;
    }
  }

  if (lat.mode === "aim") {
    const hole = holeById(sim, lat.holeId);
    lat.gap = hole ? detourGap(sim, hole) : null;
    lat.wantV = 0;
    lat.cruiseCap = spec.speed;
    lat.blocked = detourBlocked(sim);
    if (!hole || hole.resolved) {
      leaveDetour(lat, false);
      return;
    }
    if (outOfIt(sim)) {
      leaveDetour(lat, false);
      return;
    }
    if (held || lat.blocked) {
      if (held) lat.holdX = sim.x;
      return;
    }
    lat.holdX = null;
    lat.pause += dt;
    if (lat.pause + 1e-6 < spec.aimPause) return;
    lat.mode = "detour";
    lat.ramp = 0;
    lat.release = spec.releaseHold;
    for (const item of lat.holes || [hole]) item.detoured = true;
  }

  if (lat.mode === "detour") {
    const hole = holeById(sim, lat.holeId);
    lat.gap = hole ? detourGap(sim, hole) : null;
    lat.cruiseCap = spec.speed;
    lat.blocked = detourBlocked(sim);
    if (outOfIt(sim)) {
      leaveDetour(lat, false);
      return;
    }
    if (held) {
      lat.holdX = sim.x;
      lat.wantV = 0;
      lat.ramp = 0;
      lat.release = 0;
      return;
    }
    lat.holdX = null;
    lat.release += dt;
    if (lat.release < spec.releaseHold || lat.blocked) {
      lat.wantV = 0;
      return;
    }
    lat.ramp += dt;
    lat.wantV = crawlSpeed(lat);
    if (sim.s >= (lat.sExit ?? sim.s) && Math.abs(sim.x - CFG.defaultX) < 0.1) {
      leaveDetour(lat, true);
    }
  }
}

function dangerOf(sim) {
  let nearest = null;
  let moving = false;
  for (const h of sim.hazards) {
    if (h.resolved) continue;
    const dist = h.s - sim.s;
    if (dist > 0 && (nearest === null || dist < nearest)) nearest = dist;
    if ((h.type === "pedestrian" || h.type === "dog") && dist < CFG.flinch.pedDanger && dist > -2) {
      if (h.motion === "enter" || h.motion === "linger" || h.motion === "dart") moving = true;
    }
  }
  const ahead = nextHazard(sim);
  let dir = null;
  if (ahead) {
    const hx = hazardWorldX(ahead, sim);
    if (Math.abs(hx - sim.x) >= 0.3) dir = -Math.sign(hx - sim.x) || 1;
  }
  return { hot: inDanger(sim, nearest, moving), dir };
}

function honkActors(sim) {
  for (const h of sim.hazards) {
    if (h.resolved || h.family === "static" || h.type === "bin" || h.type === "roller" || h.type === "pothole" || h.type === "stopped") continue;
    const dist = h.s - sim.s;
    if (!(dist > 0 && dist <= CFG.honk.radius)) continue;
    if (h.type === "pedestrian") {
      if (h.motion === "enter" || h.motion === "linger") sim.stats.rudeHonks += 1;
      if (h.motion === "curb") h.honkMode = "wait";
      else if (h.motion === "enter" && dist >= CFG.honk.hopMin) {
        h.honkMode = "hopback";
        h.motionT = 0;
      } else h.honkMode = "hurry";
    } else if (h.type === "dog" && (h.motion === "curb" || h.motion === "dart")) {
      h.honkMode = "flee";
      h.motionT = 0;
    } else if (h.type === "cutin" && (h.motion === "curb" || h.motion === "enter")) h.honkHold = true;
  }
}

export function stepSim(sim, dt, input = {}) {
  if (sim.done) return sim;
  snapshotPose(sim);
  advanceAttention(sim, dt);
  const danger = dangerOf(sim);
  if (input.tap) registerPoke(sim, danger);
  if (input.swipe) swipePhone(sim, danger);
  if (input.honk && playerHonk(sim, danger)) honkActors(sim);
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
  advanceDetour(sim, dt, held, !!input.lockSpeed);

  const nearest = nextHazard(sim);
  const holeHold = held && sim.lat?.stopped && (sim.lat.mode === "lane" || sim.lat.mode === "approach") && upcomingHole(sim);
  if (sim.lat?.mode === "aim") sim.intent = "aim";
  else if (sim.lat?.mode === "detour") sim.intent = "detour";
  else if (holeHold) sim.intent = "hold";
  else if (nearest && nearest.committed === "lunge") sim.intent = "lunge";
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
  if (sim.lat?.cruiseCap !== null && sim.lat?.cruiseCap !== undefined) cruise = Math.min(cruise, sim.lat.cruiseCap);
  if (sim.lat?.resumeLeft > 0) {
    const u = clamp(1 - sim.lat.resumeLeft / CFG.detour.resumeCruise, 0, 1);
    const gentle = CFG.detour.speed + (cruiseBase - CFG.detour.speed) * u;
    cruise = Math.min(cruise, gentle);
    sim.lat.resumeLeft = Math.max(0, sim.lat.resumeLeft - dt);
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
    const accel = netAccel(sim.v, throttle, physBrake * (sim.brakeMul || 1), CFG.drag, slip);
    sim.v = clamp(sim.v + accel * dt, 0, cap);
    if (sim.lat?.wantV !== null && sim.lat?.wantV !== undefined) sim.v = sim.lat.wantV;
  }
  sim.stats.minV = Math.min(sim.stats.minV, sim.v);
  sim.stats.maxV = Math.max(sim.stats.maxV, sim.v);
  sim.s += sim.v * dt;

  const steerH = nextHazard(sim);
  const params = steerParams(sim.patience, sim.outburstT > 0);
  let rate = params.rate;
  if (sim.lat && sim.lat.mode !== "lane") rate = Math.max(rate, 8);
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
  steerWithDrift(sim, dt, want, rate);
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
  const drifting = sim.drift?.active || sim.drift?.offroad || sim.flinch;
  if (!sim.done && drifting) {
    const box = strikeRoadside(sim, prevS);
    if (box) {
      const cause = applyRoadside(sim, box);
      if (cause && cause !== "tuk") fail(sim, "body");
    }
  }

  const fair = justified(sim);
  const stoppedHard =
    !input.lockSpeed &&
    sim.v < 0.35 &&
    held &&
    sim.brakeInput > 0.5 &&
    sim.holdTime > 0.5 &&
    !fair;
  let rateMood = irritationRate({
    decel: playerDecel,
    brakeInput: held ? sim.brakeInput : 0,
    holdTime: sim.holdTime,
    justified: fair,
    stopped: stoppedHard,
  });
  rateMood *= sim.patienceMul || 1;
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
  if (sim.potholeLineAt && sim.t + 1e-9 >= sim.potholeLineAt) {
    sim.potholeLineAt = 0;
    sim.bubbleGap = 0;
    say(sim, "ЯМА ЖЕ!");
  }
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
    const needsTap = sim.attention === "phone" || sim.attention === "drowsy" || sim.attention === "asleep";
    const tap = opts.attend === false ? false : needsTap;
    stepSim(sim, dt, { held, tap });
    t += dt;
  }
  if (!sim.done) {
    sim.done = true;
    sim.success = false;
    sim.failReason = "timeout";
  }
  return sim;
}
