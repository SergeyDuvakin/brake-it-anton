import test from "node:test";
import assert from "node:assert/strict";

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

import { anchorKind, farDs, groundDs, paintFarToNear, screenFootprint } from "../js/anchors.js";
import { CFG } from "../js/config.js";
import { drainFrame } from "../js/clock.js";
import { contentBox, frameSize, stableFrame, stablePlacement } from "../js/viewport.js";
import { letterboxRect, logicalPoint } from "../js/geom.js";
import { LESSONS, buildInfinite, getMission } from "../js/missions.js";
import { PEDAL_PAD, PEDAL_ZONE, controlState, patienceNeedleDegrees, pedalArtRect, pedalHingeDegrees, pedalPadPoint } from "../js/ui.js";
import {
  CAR_BODY_H,
  CAR_BODY_W,
  CAR_NOSE_LOCAL_Y,
  CAR_SPRITE_SCALE,
  DOG_PAW_LOCAL_Y,
  PED_FOOT_LOCAL_Y,
  PLAN_ART,
  bumperFootGap,
  carDrawOrigin,
  pedestrianFootShift,
  planBlitBox,
  planMetresPerPixel,
  planRowDs,
  playerChassis,
  SCENERY_GAP,
  SCENERY_REACH,
  placedScene,
  render,
  sceneryAnchor,
} from "../js/draw.js";
import { VIEW, project } from "../js/road.js";
import { routeLocal, routeYaw, sectionCount, straightRun } from "../js/route.js";
import {
  brakeAccel,
  damageStage,
  expressionId,
  grade,
  irritationRate,
  netAccel,
  repairInvoice,
  safeSpeed,
  steerParams,
} from "../js/physics.js";
import { policyCareful, policyNever, policyPanic, policyProvoke, policyYield } from "../js/policies.js";
import { pedPoseKey, dogPoseKey } from "../js/cast.js";
import { vibrationPattern } from "../js/haptics.js";
import { DOG_STRIDE, PED_STRIDE, footOffset, gaitOffset, strideSlot } from "../js/gait.js";
import { actorTravel, bodyCenterLimit, contactDuringStep, createSim, hazardWorldX, isSolidHazard, nextHazard, overlapTimes, pokeAttention, renderAlpha, renderPose, runSim, stepSim, windowsOverlap } from "../js/sim.js";
import {
  createSession,
  keyDown,
  keyUp,
  onBlur,
  onVisibility,
  pauseSession,
  pointerDown,
  releasePointer,
  restartSession,
  resumeSession,
  sessionStep,
} from "../js/session.js";
import { cabinPoseId } from "../js/cabin.js";
import { applyVictory, freshSave, noteInfiniteDistance, parseSave, toggleSetting } from "../js/storage.js";

const dt = CFG.dt;

function empty(extra = {}) {
  return {
    id: "empty",
    seed: 1,
    cruise: 16,
    length: 8000,
    cargo: null,
    slippery: [],
    hazards: [],
    ...extra,
  };
}

function frames(sim, n, held, extra = {}) {
  for (let i = 0; i < n; i++) stepSim(sim, dt, { held, ...extra });
}

function trustMission() {
  return {
    id: "trust",
    seed: 5,
    cruise: 13,
    length: 460,
    cargo: null,
    slippery: [],
    patienceStart: 15,
    hazards: [{ id: "hole", type: "pothole", s: 250, trust: true, x: 1.8, halfW: 0.7, halfL: 1.2 }],
  };
}

function dump(sim) {
  return JSON.stringify({
    s: Math.round(sim.s),
    v: Number(sim.v.toFixed(2)),
    x: Number(sim.x.toFixed(2)),
    body: Math.round(sim.body),
    cargo: Math.round(sim.cargo),
    patience: Number(sim.patience.toFixed(1)),
    collisions: sim.stats.collisions,
    lunges: sim.stats.lunges,
    trusts: sim.stats.trustClears,
    harsh: sim.stats.harshFull,
    fail: sim.failReason,
    events: sim.events.slice(-6),
  });
}

test("full-press brake term is 8.5 at 100 km/h and grows with speed", () => {
  const v100 = 100 / 3.6;
  assert.ok(Math.abs(brakeAccel(v100) - 8.5) < 1e-9);
  assert.ok(brakeAccel(8) < brakeAccel(16));
  assert.ok(brakeAccel(16) < brakeAccel(v100));
  assert.ok(brakeAccel(v100) < brakeAccel(v100 + 8));
  const balanced = netAccel(v100, CFG.drag * v100, 1, CFG.drag, 1);
  assert.ok(Math.abs(balanced + 8.5) < 1e-9);
});

test("integrated braking bites harder at higher speed", () => {
  function delta(v) {
    const sim = createSim(empty(), 1);
    sim.v = v;
    stepSim(sim, dt, { held: true, snapBrake: true });
    return sim.v - v;
  }
  assert.ok(delta(27) < delta(8) - 0.02);
});

test("car accelerates, a long brake stops it, release lets Anton gas again", () => {
  const sim = createSim(empty(), 1);
  frames(sim, 180, false);
  assert.ok(sim.v > 8, dump(sim));
  frames(sim, 240, false);
  assert.ok(sim.v > 13 && sim.v < CFG.storySpeedCap, dump(sim));
  const cruise = sim.v;
  frames(sim, 90, true);
  assert.ok(sim.v < cruise - 6, dump(sim));
  const low = sim.v;
  frames(sim, 120, false);
  assert.ok(sim.v > low + 3, dump(sim));
});

test("a short press sheds less speed than a long one and is not a full stop", () => {
  function lowest(holdSec) {
    const sim = createSim(empty(), 2);
    frames(sim, 500, false);
    let min = sim.v;
    const n = Math.max(1, Math.round(holdSec / dt));
    for (let i = 0; i < n; i++) {
      stepSim(sim, dt, { held: true });
      min = Math.min(min, sim.v);
    }
    for (let i = 0; i < 40; i++) {
      stepSim(sim, dt, { held: false });
      min = Math.min(min, sim.v);
    }
    return min;
  }
  const short = lowest(0.08);
  const long = lowest(2.4);
  assert.ok(short > 9, `short ${short}`);
  assert.ok(long < 2, `long ${long}`);
  assert.ok(long < short - 7);
});

test("irritation rate matches the brief and braking on an empty road raises it", () => {
  assert.equal(
    irritationRate({ decel: 6, brakeInput: 0.8, holdTime: 1, justified: false, stopped: false }),
    7.2,
  );
  assert.equal(
    irritationRate({ decel: 6, brakeInput: 0.8, holdTime: 3, justified: false, stopped: false }),
    7.55,
  );
  assert.equal(
    irritationRate({ decel: 6, brakeInput: 0.2, holdTime: 3, justified: false, stopped: false }),
    0,
  );
  assert.equal(
    irritationRate({ decel: 4, brakeInput: 1, holdTime: 1, justified: false, stopped: false }),
    0,
  );
  assert.ok(
    irritationRate({ decel: 6, brakeInput: 1, holdTime: 1, justified: true, stopped: false }) <
      irritationRate({ decel: 6, brakeInput: 1, holdTime: 1, justified: false, stopped: false }),
  );

  const sim = createSim(empty(), 1);
  sim.v = 16;
  frames(sim, 60, true, { lockSpeed: true });
  assert.ok(sim.patience > 20 && sim.patience < 25, sim.patience);
  const mid = createSim(empty(), 1);
  mid.v = 16;
  frames(mid, 180, true, { lockSpeed: true });
  assert.ok(mid.patience > sim.patience + 10, mid.patience);
});

test("a release shorter than 0.65s gives the small relief, and it can repeat", () => {
  const sim = createSim(empty(), 1);
  sim.v = 12;
  frames(sim, 18, true, { lockSpeed: true });
  const before = sim.patience;
  stepSim(sim, dt, { held: false, lockSpeed: true });
  assert.ok(Math.abs(before - sim.patience - 0.4) < 0.02, sim.patience);
  assert.equal(sim.stats.shortReleases, 1);
  frames(sim, 18, true, { lockSpeed: true });
  stepSim(sim, dt, { held: false, lockSpeed: true });
  assert.equal(sim.stats.shortReleases, 2);
});

test("calm driving above 5 m/s slowly cools patience", () => {
  const sim = createSim(empty(), 1);
  sim.v = 10;
  frames(sim, 240, false, { lockSpeed: true });
  assert.ok(sim.patience < 14.6 && sim.patience > 13.5, sim.patience);
});

test("patience 40+ produces throttle bursts and 70+ steers wider", () => {
  function peakThrottle(patience) {
    const sim = createSim(empty(), 3);
    sim.patience = patience;
    sim.v = 16;
    let maxT = 0;
    for (let i = 0; i < 300; i++) {
      stepSim(sim, dt, { held: false, lockSpeed: true });
      maxT = Math.max(maxT, sim.lastThrottle);
    }
    return maxT;
  }
  assert.ok(peakThrottle(50) > peakThrottle(10) + 0.8);

  const calm = steerParams(10, false);
  const hot = steerParams(80, false);
  const burst = steerParams(10, true);
  assert.ok(hot.overshoot > calm.overshoot + 0.4);
  assert.ok(hot.delay > calm.delay);
  assert.ok(burst.overshoot > hot.overshoot);

  const base = trustMission();
  const cool = runSim({ ...base, patienceStart: 12 }, policyNever, { maxTime: 50 });
  const angry = runSim({ ...base, patienceStart: 88 }, policyNever, { maxTime: 50 });
  assert.equal(cool.stats.collisions, 0, dump(cool));
  assert.equal(angry.stats.collisions, 0, dump(angry));
  assert.ok(angry.stats.minX < cool.stats.minX - 0.35, `${angry.stats.minX} vs ${cool.stats.minX}`);
});

test("100 triggers one outburst, cooldown holds, then another is allowed", () => {
  const sim = createSim(empty(), 1);
  sim.v = 0;
  sim.patience = 100;
  stepSim(sim, dt, { held: false, lockSpeed: true });
  assert.equal(sim.stats.outbursts, 1);
  assert.ok(Math.abs(sim.patience - 65) < 0.001);
  assert.ok(sim.cooldown > 7.9 && sim.cooldown <= 8);
  sim.patience = 100;
  stepSim(sim, dt, { held: false, lockSpeed: true });
  assert.equal(sim.stats.outbursts, 1);
  assert.ok(sim.patience <= 92);
  frames(sim, Math.ceil(8.2 / dt), false, { lockSpeed: true });
  assert.ok(sim.cooldown <= 0);
  sim.patience = 100;
  stepSim(sim, dt, { held: false, lockSpeed: true });
  assert.equal(sim.stats.outbursts, 2);
});

test("not braking a trust hazard is the better choice", () => {
  const mission = trustMission();
  const trusted = runSim(mission, policyNever, { maxTime: 50 });
  assert.equal(trusted.stats.collisions, 0, dump(trusted));
  assert.ok(trusted.stats.trustClears >= 1, dump(trusted));
  assert.equal(trusted.stats.lunges, 0);
  assert.equal(trusted.success, true, dump(trusted));

  const provoked = runSim(mission, policyProvoke, { maxTime: 50 });
  assert.ok(provoked.stats.lunges >= 1, dump(provoked));
  assert.ok(provoked.stats.collisions >= 1, dump(provoked));
  assert.ok(provoked.body < trusted.body, dump(provoked));
});

test("never braking lesson 1 hits the pedestrian; careful braking clears it", () => {
  const lesson = getMission("lesson1");
  const crashed = runSim(lesson, policyNever, { maxTime: 80 });
  assert.ok(crashed.stats.collisions >= 1, dump(crashed));
  assert.ok(crashed.body < 90, dump(crashed));

  const careful = runSim(lesson, policyCareful, { maxTime: 90 });
  assert.equal(careful.success, true, dump(careful));
  assert.equal(careful.stats.collisions, 0, dump(careful));
  assert.ok(careful.body > 80, dump(careful));
});

test("cargo impulses, collisions and a failing trip", () => {
  const cake = createSim(empty({ cargo: "cake" }), 1);
  cake.v = 18;
  let guard = 0;
  while (cake.stats.harshFull < 1 && guard < 40) {
    stepSim(cake, dt, { held: true, lockSpeed: true });
    guard += 1;
  }
  assert.equal(cake.stats.harshFull, 1);
  assert.ok(Math.abs(cake.cargo - (100 - CFG.cakeImpulse)) < 0.05, cake.cargo);
  const before = cake.cargo;
  stepSim(cake, dt, { held: true, lockSpeed: true });
  assert.ok(before - cake.cargo > 0.01);

  const partial = createSim(empty({ cargo: "cake" }), 1);
  partial.v = 18;
  frames(partial, 6, true, { lockSpeed: true });
  assert.ok(partial.brakeInput < 1);
  assert.equal(partial.cargo, 100);

  const crawl = createSim(empty({ cargo: "fish" }), 1);
  crawl.v = 0;
  frames(crawl, 30, true, { lockSpeed: true });
  assert.equal(crawl.brakeInput, 1);
  assert.equal(crawl.cargo, 100);

  const fish = createSim(
    empty({
      cargo: "fish",
      hazards: [{ id: "c", type: "cutin", s: 5, x: 1.8, halfW: 1, halfL: 3, trust: false }],
    }),
    1,
  );
  fish.s = 5;
  fish.x = 1.8;
  fish.v = 12;
  stepSim(fish, dt, { held: false, lockSpeed: true });
  const hit = fish.events.find((e) => e.kind === "hit");
  assert.ok(hit, dump(fish));
  assert.equal(hit.cargoLoss, CFG.fishCollision);
  assert.ok(Math.abs(fish.cargo - (100 - CFG.fishCollision)) < 0.01);

  fish.cargo = 40;
  fish.body = 100;
  fish.v = 12;
  fish.done = false;
  fish.success = false;
  fish.failReason = null;
  fish.hazards[0].resolved = null;
  fish.s = 5;
  stepSim(fish, dt, { held: false, lockSpeed: true });
  assert.equal(fish.failReason, "cargo");
  assert.equal(fish.success, false);

  const wall = createSim(
    empty({
      hazards: [{ id: "car", type: "stopped", s: 5, x: 1.8, halfW: 1, halfL: 3, trust: false }],
    }),
    1,
  );
  wall.s = 5;
  wall.x = 1.8;
  wall.v = 22;
  stepSim(wall, dt, { held: false, lockSpeed: true });
  assert.equal(wall.failReason, "body");
  assert.equal(wall.body, 0);
});

test("a low-speed scrape is comic and the car is not stuck at zero", () => {
  const sim = createSim(
    empty({
      hazards: [{ id: "ped", type: "pedestrian", s: 6, x: 1.8, halfW: 0.4, halfL: 0.6, trust: false }],
    }),
    1,
  );
  sim.s = 6;
  sim.x = 1.8;
  sim.v = 1;
  stepSim(sim, dt, { held: false });
  assert.equal(sim.stats.collisions, 0, dump(sim));
  assert.ok(sim.body > 95);
  frames(sim, 120, false);
  assert.ok(sim.v > 4, sim.v);
  assert.equal(sim.done, false);
});

test("panic braking fails the cake; careful cake and fish trips can finish", () => {
  const cake = getMission("lesson3");
  const ruined = runSim(cake, policyPanic, { maxTime: 40 });
  assert.equal(ruined.success, false, dump(ruined));
  assert.equal(ruined.failReason, "cargo", dump(ruined));

  const baked = runSim(cake, policyCareful, { maxTime: 180 });
  assert.equal(baked.success, true, dump(baked));
  assert.ok(baked.cargo > 40, dump(baked));

  const fish = runSim(getMission("lesson4"), policyCareful, { maxTime: 200 });
  assert.equal(fish.success, true, dump(fish));
  assert.ok(fish.cargo > 0, dump(fish));
  assert.equal(fish.stats.collisions, 0, dump(fish));
});

test("lesson 2 rewards leaving the dog alone", () => {
  const sim = runSim(getMission("lesson2"), policyCareful, { maxTime: 180 });
  assert.equal(sim.success, true, dump(sim));
  assert.ok(sim.stats.trustClears >= 1, dump(sim));
  assert.equal(sim.stats.collisions, 0, dump(sim));
});

test("same seed repeats; authored hazards stay on the road and spaced", () => {
  const a = runSim(getMission("lesson1"), policyNever, { maxTime: 80 });
  const b = runSim(getMission("lesson1"), policyNever, { maxTime: 80 });
  assert.equal(a.stats.collisions, b.stats.collisions);
  assert.equal(a.body, b.body);
  assert.deepEqual(a.events, b.events);

  for (const lesson of LESSONS) {
    let prev = 0;
    for (const h of lesson.hazards) {
      assert.ok(Math.abs(h.x) <= 2.2, lesson.id);
      if (prev === 0) assert.ok(h.s >= 40 && h.s <= 58, `${lesson.id} opens in view at ${h.s}`);
      else assert.ok(h.s - prev >= 78, `${lesson.id} gap ${h.s - prev}`);
      assert.ok(h.s < lesson.length - 70, lesson.id);
      prev = h.s;
    }
  }
});

test("infinite mode is seeded, capped near 96 km/h, and stays in the lanes", () => {
  const a = buildInfinite(4);
  const b = buildInfinite(4);
  const c = buildInfinite(9);
  assert.deepEqual(
    a.hazards.map((h) => [h.s, h.type, h.trust]),
    b.hazards.map((h) => [h.s, h.type, h.trust]),
  );
  assert.notDeepEqual(
    a.hazards.map((h) => h.s),
    c.hazards.map((h) => h.s),
  );
  for (let i = 0; i < a.hazards.length; i++) {
    assert.ok(Math.abs(a.hazards[i].x) <= 2.2);
    if (i > 0) assert.ok(a.hazards[i].s - a.hazards[i - 1].s >= 80);
  }
  const sim = createSim(
    { id: "infinite", infinite: true, cruise: 16, length: 99999, cargo: null, slippery: [], hazards: [] },
    1,
  );
  sim.s = 5000;
  sim.v = 18;
  frames(sim, 600, false);
  assert.ok(sim.v > 22, sim.v);
  assert.ok(sim.v <= CFG.infiniteSpeedCap + 1e-6, sim.v);
  const bill = repairInvoice({ collisions: 2, mirrors: 1, harshFull: 1, honks: 3 }, 10);
  assert.equal(bill.total, 2 * 1400 + 350 + 800 + 3 * 90 + 120);
});

function brakeOnly(sim) {
  const hazard = nextHazard(sim);
  if (!hazard || hazard.trust) return false;
  const dist = hazard.s - sim.s;
  if (dist > (hazard.telegraph || 72) || dist < -2) return false;
  if ((hazard.type === "pedestrian" || hazard.type === "cutin") && hazard.crossDur && hazard.crossT >= hazard.crossDur) {
    return false;
  }
  return sim.v > Math.max(0.4, safeSpeed(hazard.type) - 1.2);
}

function driveTo(mission, policy, limitS, maxSec = 900) {
  const sim = createSim(mission, mission.seed || 1);
  let stuck = 0;
  let prev = sim.s;
  for (let i = 0; i < 60 * maxSec && sim.s < limitS && sim.body > 0 && sim.cargo > 0; i++) {
    const needsTap = sim.attention === "phone" || sim.attention === "drowsy" || sim.attention === "asleep";
    stepSim(sim, dt, { held: !!policy(sim), tap: needsTap });
    if (sim.v < 0.05 && sim.s < prev + 0.002) stuck += 1;
    else stuck = 0;
    prev = sim.s;
    if (stuck > 240) break;
  }
  return { sim, stuck: stuck > 240 };
}

test("a brake-only player can pass every generated road, and a parked car is trust", () => {
  for (let seed = 1; seed <= 24; seed += 1) {
    const road = buildInfinite(seed);
    const again = buildInfinite(seed);
    assert.deepEqual(
      road.hazards.map((hazard) => [hazard.s, hazard.type, hazard.trust]),
      again.hazards.map((hazard) => [hazard.s, hazard.type, hazard.trust]),
    );
    for (let i = 0; i < road.hazards.length; i += 1) {
      const hazard = road.hazards[i];
      if (hazard.type === "stopped" || hazard.type === "dog" || hazard.type === "pothole") {
        assert.equal(hazard.trust, true, `${seed} ${hazard.id}`);
      }
      if (hazard.type === "pedestrian" || hazard.type === "cutin" || hazard.type === "bin" || hazard.type === "roller") {
        assert.equal(hazard.trust, false, `${seed} ${hazard.id}`);
      }
      if (i > 0) assert.ok(hazard.s - road.hazards[i - 1].s >= 108, `${seed} gap`);
      assert.notEqual(hazard.type, road.hazards[i - 1]?.type);
    }
  }

  for (const seed of [1, 4, 9, 22]) {
    const road = buildInfinite(seed);
    const trip = driveTo(road, brakeOnly, road.hazards.at(-1).s + 40);
    assert.equal(trip.stuck, false, `stuck on seed ${seed} at ${trip.sim.s}`);
    assert.equal(trip.sim.stats.collisions, 0, `hits on seed ${seed}: ${trip.sim.events.filter((e) => e.kind === "hit").map((e) => e.id).join(",")}`);
    assert.ok(trip.sim.body > 99, trip.sim.body);
    assert.ok(trip.sim.s > road.hazards.at(-1).s, trip.sim.s);
  }

  const parked = {
    id: "park",
    seed: 3,
    cruise: 12.5,
    roll: 10,
    length: 240,
    cargo: null,
    slippery: [],
    hazards: [{ id: "car", type: "stopped", s: 90, trust: true, halfW: 0.95, halfL: 2.2, x: 1.8, telegraph: 72, decision: 58, commit: 40 }],
  };
  const hands = driveTo(parked, () => false, 200, 40);
  assert.equal(hands.sim.stats.collisions, 0, dump(hands.sim));
  assert.equal(hands.sim.hazards[0].resolved, "clear");
  assert.equal(hands.sim.hazards[0].committed, "avoid");
  const provoked = driveTo(parked, policyProvoke, 200, 40);
  assert.ok(provoked.sim.stats.collisions >= 1, dump(provoked.sim));
  assert.equal(provoked.sim.hazards[0].committed, "lunge");

  const person = getMission("lesson1");
  const missed = driveTo(person, () => false, person.length, 40);
  assert.ok(missed.sim.stats.collisions >= 1);
  const stopped = driveTo(person, brakeOnly, person.length - 5, 80);
  assert.equal(stopped.sim.stats.collisions, 0, dump(stopped.sim));
  assert.equal(stopped.stuck, false);
});

test("the opening countdown holds the car, and retry is an immediate clean ride", () => {
  const session = createSession(getMission("lesson1"), { seed: 11 });
  assert.equal(session.phase, "countdown");
  assert.equal(session.countdown, 3);
  sessionStep(session, 0.4);
  pauseSession(session, "escape");
  assert.equal(session.phase, "pause");
  resumeSession(session);
  assert.equal(session.phase, "countdown");
  assert.ok(session.countdown >= 1);
  keyDown(session, "Space");
  sessionStep(session, 1);
  assert.equal(session.phase, "countdown");
  assert.equal(session.sim.s, 0);
  assert.equal(session.sim.v, 0);
  assert.equal(session.sim.brakeInput, 0);
  sessionStep(session, 1.4);
  assert.equal(session.phase, "countdown");
  sessionStep(session, 0.7);
  assert.equal(session.phase, "drive");
  assert.equal(session.countdown, 0);
  sessionStep(session, 1.2);
  assert.ok(session.sim.s > 0);
  assert.ok(session.sim.v > 0);

  session.brakeHeld = true;
  session.pointerId = 7;
  keyDown(session, "Space");
  session.sim.bubble = "ОЙ!";
  session.sim.bubbleT = 1;
  session.sim.crashT = 0.2;
  session.sim.events.push({ kind: "hit" });
  session.phase = "result";
  session.result = { success: false, stars: 0 };
  session.recorded = true;
  const seed = session.seed;
  const mission = session.mission;
  restartSession(session);

  assert.equal(session.phase, "drive");
  assert.equal(session.countdown, 0);
  assert.equal(session.countdownAcc, 3);
  assert.equal(session.seed, seed);
  assert.equal(session.mission, mission);
  assert.equal(session.result, null);
  assert.equal(session.recorded, false);
  assert.equal(session.pauseReason, null);
  assert.equal(session.brakeHeld, false);
  assert.equal(session.pointerId, null);
  assert.equal(session.keysDown.size, 0);
  assert.equal(session.sim.s, 0);
  assert.equal(session.sim.v, mission.roll);
  assert.equal(session.sim.t, 0);
  assert.equal(session.sim.brakeInput, 0);
  assert.equal(session.sim.holdTime, 0);
  assert.equal(session.sim.pressTime, 0);
  assert.equal(session.sim.wasHeld, false);
  assert.equal(session.sim.bubble, null);
  assert.equal(session.sim.crashT, 0);
  assert.equal(session.sim.events.length, 0);
  assert.equal(session.sim.patience, CFG.patienceStart);
  assert.equal(session.sim.cargo, 100);
  assert.equal(session.sim.body, 100);
  assert.equal(session.sim.stats.collisions, 0);

  keyDown(session, "Space", { repeat: true });
  sessionStep(session, 0.2);
  assert.equal(session.sim.brakeInput, 0, "a held key must not leak into the new ride");
  assert.ok(session.sim.s > 0);
  keyUp(session, "Space");
  session.brakeHeld = true;
  sessionStep(session, 0.2);
  assert.ok(session.sim.brakeInput > 0.5, "a new press brakes on the first frames");

  onBlur(session);
  assert.equal(session.phase, "pause");
  assert.equal(session.sim.brakeInput, 0);
  assert.equal(session.brakeHeld, false);
  restartSession(session);
  assert.equal(session.phase, "drive");
  assert.equal(session.pauseReason, null);
  const heldS = session.sim.s;
  sessionStep(session, 0.25);
  assert.equal(session.sim.brakeInput, 0);
  assert.ok(session.sim.s > heldS);
  assert.equal(session.phase, "drive");
});

test("pause, blur and hide clear the pedal and the held keys", () => {
  const session = createSession(getMission("lesson1"), { seed: 11 });
  sessionStep(session, 3);
  assert.equal(session.phase, "drive");
  session.brakeHeld = true;
  keyDown(session, "Space");
  sessionStep(session, 0.3);
  assert.ok(session.sim.brakeInput > 0.5);
  assert.ok(session.sim.holdTime > 0);
  const s = session.sim.s;
  onBlur(session);
  assert.equal(session.phase, "pause");
  assert.equal(session.pauseReason, "blur");
  assert.equal(session.sim.brakeInput, 0);
  assert.equal(session.sim.holdTime, 0);
  assert.equal(session.brakeHeld, false);
  assert.equal(session.keysDown.size, 0);
  sessionStep(session, 1);
  assert.equal(session.sim.s, s);
  resumeSession(session);
  assert.equal(session.phase, "drive");
  sessionStep(session, 0.5);
  assert.equal(session.sim.brakeInput, 0);
  assert.ok(session.sim.v > 0);

  session.brakeHeld = true;
  sessionStep(session, 0.2);
  onVisibility(session, true);
  assert.equal(session.phase, "pause");
  assert.equal(session.pauseReason, "hidden");
  assert.equal(session.sim.brakeInput, 0);
  assert.equal(session.brakeHeld, false);
});

test("victory unlocks the next lesson only, and a bad save does not unlock the game", () => {
  const blank = parseSave(null);
  assert.equal(blank.ok, true);
  assert.equal(blank.save.unlocked, 1);
  assert.equal(blank.save.infinite, false);
  assert.deepEqual(blank.save.best, {});

  let save = applyVictory(freshSave(), "lesson1", 2);
  assert.equal(save.unlocked, 2);
  assert.equal(save.infinite, true);
  assert.equal(save.best.lesson1, 2);
  save = applyVictory(save, "lesson1", 1);
  assert.equal(save.best.lesson1, 2);
  save = applyVictory(save, "lesson2", 3);
  assert.equal(save.unlocked, 3);
  assert.equal(save.best.lesson4, undefined);

  const won = runSim(getMission("lesson1"), policyCareful, { maxTime: 90 });
  const graded = grade(won);
  assert.equal(graded.success, true);
  assert.ok(graded.stars >= 1 && graded.stars <= 3);
  const stored = applyVictory(freshSave(), "lesson1", graded.stars);
  assert.equal(stored.unlocked, 2);
  assert.equal(stored.infinite, true);

  for (const raw of [
    "{",
    '{"v":2,"unlocked":4,"infinite":true}',
    '{"v":1,"unlocked":"all","infinite":true}',
    '{"v":1,"unlocked":99,"infinite":true}',
    '{"v":1,"unlocked":4,"infinite":"yes"}',
    "[]",
    "null",
  ]) {
    const parsed = parseSave(raw);
    assert.equal(parsed.ok, false, raw);
    assert.equal(parsed.save.unlocked, 1, raw);
    assert.equal(parsed.save.infinite, false, raw);
  }

  const ok = parseSave('{"v":1,"unlocked":2,"infinite":false,"best":{"lesson1":3,"nope":9},"settings":{"sound":false}}');
  assert.equal(ok.ok, true);
  assert.equal(ok.save.unlocked, 2);
  assert.equal(ok.save.best.lesson1, 3);
  assert.equal(ok.save.best.nope, undefined);
  assert.equal(ok.save.settings.sound, false);
  assert.equal(ok.save.settings.music, false);
  assert.equal(ok.save.settings.shake, true);
  assert.equal(ok.save.settings.reducedMotion, false);
  const noisy = parseSave('{"v":1,"unlocked":1,"infinite":false,"settings":"broken"}');
  assert.equal(noisy.ok, true);
  assert.equal(noisy.save.unlocked, 1);
  assert.equal(noisy.save.settings.sound, true);
  assert.equal(noisy.save.settings.largeUi, false);
  const tuned = parseSave('{"v":1,"unlocked":1,"infinite":false,"settings":{"sound":true,"music":false,"voice":false,"vibration":false,"shake":true,"reducedMotion":true,"largeUi":true}}');
  assert.equal(tuned.save.settings.music, false);
  assert.equal(tuned.save.settings.voice, false);
  assert.equal(tuned.save.settings.vibration, false);
  assert.equal(tuned.save.settings.shake, true);
  assert.equal(tuned.save.settings.reducedMotion, true);
  assert.equal(tuned.save.settings.largeUi, true);
  const flipped = toggleSetting(tuned.save, "shake");
  assert.equal(flipped.settings.shake, false);
  assert.equal(flipped.settings.reducedMotion, true);
  assert.equal(toggleSetting(flipped, "motion").settings.reducedMotion, false);
  const farther = noteInfiniteDistance(ok.save, 420);
  const again = noteInfiniteDistance(farther, 12);
  assert.equal(again.bestMeters.infinite, 420);
});

test("stars use 80/60/35 and the face is not angry while calm", () => {
  function fake(partial) {
    return grade({
      body: 100,
      comfort: 100,
      cargo: 100,
      patience: 0,
      cargoType: null,
      success: true,
      stats: { collisions: 0, trustClears: 1, clears: 1, playerBrakeTime: 0.5, harshFull: 0 },
      ...partial,
    });
  }
  assert.equal(fake({}).stars, 3);
  assert.equal(fake({ body: 80, comfort: 80, patience: 20 }).stars, 3);
  const two = fake({ body: 60, comfort: 60, patience: 40 });
  assert.ok(Math.abs(two.percent - 60) < 1e-9);
  assert.equal(two.stars, 2);
  const one = fake({ body: 35, comfort: 35, patience: 65 });
  assert.ok(Math.abs(one.percent - 35) < 1e-9);
  assert.equal(one.stars, 1);
  assert.equal(fake({ body: 34, comfort: 34, patience: 66 }).stars, 0);
  assert.equal(fake({ success: false }).stars, 0);
  assert.equal(fake({}).badge, true);
  assert.equal(fake({ stats: { collisions: 1, trustClears: 0, clears: 0, playerBrakeTime: 0, harshFull: 0 } }).badge, false);
  assert.equal(
    fake({ stats: { collisions: 0, trustClears: 0, clears: 0, playerBrakeTime: 0, harshFull: 0 } }).badge,
    false,
  );

  const calm = createSim(empty(), 1);
  calm.patience = 12;
  calm.brakeInput = 1;
  assert.equal(expressionId(calm), "calm");
  calm.patience = 80;
  calm.brakeInput = 0;
  assert.equal(expressionId(calm), "angry");
  calm.patience = 10;
  calm.beltT = 0.2;
  assert.equal(expressionId(calm), "belted");
});

test("cabin stills follow the ride, and the phone pose stays a still name", () => {
  const sim = createSim(getMission("lesson1"), 11);
  assert.equal(cabinPoseId(sim, "countdown"), "belted");
  sim.t = 0.2;
  assert.equal(cabinPoseId(sim, "drive"), "belted");
  sim.t = 3;
  assert.equal(cabinPoseId(sim, "drive"), "drive");
  sim.patience = 55;
  assert.equal(cabinPoseId(sim, "drive"), "annoyed");
  sim.patience = 80;
  assert.equal(cabinPoseId(sim, "drive"), "angry");
  sim.outburstT = 1;
  assert.equal(cabinPoseId(sim, "drive"), "furious");
  sim.outburstT = 0;
  sim.patience = 10;
  sim.attention = "phone";
  assert.equal(cabinPoseId(sim, "drive"), "phone");
  sim.attention = "drowsy";
  assert.equal(cabinPoseId(sim, "drive"), "drowsy");
  sim.attention = "asleep";
  assert.equal(cabinPoseId(sim, "drive"), "asleep");
  sim.attention = "road";
  sim.success = true;
  assert.equal(cabinPoseId(sim, "result"), "proud");
  sim.success = false;
  assert.equal(cabinPoseId(sim, "result"), "ashamed");
  assert.equal(cabinPoseId(sim, "drive", "preen"), "preen");
});

test("vibration is a short pulse, never a held buzz", () => {
  for (const kind of ["tap", "hard"]) {
    const pattern = vibrationPattern(kind);
    assert.ok(pattern.length >= 1 && pattern.length <= 3);
    const on = pattern.filter((_, index) => index % 2 === 0).reduce((sum, ms) => sum + ms, 0);
    assert.ok(on <= 80, on);
    assert.ok(Math.max(...pattern) < 60);
  }
  assert.notDeepEqual(vibrationPattern("tap"), vibrationPattern("hard"));
});

test("collisions move the car through three damage stages", () => {
  assert.equal(damageStage(100, 0), 0);
  assert.equal(damageStage(82, 1), 1);
  assert.equal(damageStage(48, 2), 2);
  assert.equal(damageStage(12, 4), 3);
  assert.equal(damageStage(70, 3), 2);
});

test("six sections bend after a straight opening, and the camera looks ahead", () => {
  assert.equal(sectionCount(), 6);
  assert.equal(straightRun(), 120);
  const flat = routeLocal(20, 55, 1.8);
  assert.equal(flat.ds, 35);
  assert.equal(flat.xm, 1.8);
  assert.equal(routeYaw(20), 0);
  const bent = routeLocal(110, 180, 0);
  assert.ok(Math.abs(bent.xm) > 0.3, bent.xm);
  assert.ok(routeYaw(110) !== 0);
  const beside = routeLocal(110, 180, 6);
  assert.ok(Math.abs(beside.xm - bent.xm) > 4);
});

test("the straight road stays forward and does not fold between frames", () => {
  let prevY = -Infinity;
  let prevEdge = -Infinity;
  for (let ds = VIEW.look; ds >= VIEW.near; ds -= 0.5) {
    const center = project(ds, 0);
    const right = project(ds, VIEW.roadHalf);
    const left = project(ds, -VIEW.roadHalf);
    assert.ok(Math.abs(center.x - VIEW.vanishX) < 0.02, center.x);
    assert.ok(Math.abs(left.y - right.y) < 0.02);
    assert.ok(Math.abs(right.x - VIEW.vanishX - (VIEW.vanishX - left.x)) < 0.05);
    assert.ok(center.y > prevY, `depth reversed at ${ds}`);
    assert.ok(right.x + 0.02 >= prevEdge, `edge folded inward at ${ds}`);
    prevY = center.y;
    prevEdge = right.x;
  }

  const worldS = 80;
  let last = null;
  for (let car = 0; car <= 70; car += 0.25) {
    const point = project(worldS - car, 2.4);
    if (last) {
      assert.ok(point.y >= last.y - 1e-6);
      assert.ok(Math.abs(point.x - VIEW.vanishX) >= Math.abs(last.x - VIEW.vanishX) - 1e-4);
    }
    last = point;
  }
});

test("early brake keeps a visible bumper-to-feet gap and the crossing runs at zero speed", () => {
  const sim = createSim(getMission("lesson1"), 11);
  sim.v = 10;
  let minWorld = Infinity;
  let minScreen = Infinity;
  let sawStop = false;
  let crossWhileStopped = null;
  for (let i = 0; i < 8000 && !sim.done; i++) {
    const ped = sim.hazards.find((h) => h.id === "ped");
    stepSim(sim, dt, { held: brakeOpen(sim) });
    if (!ped.resolved && ped.crossT > 0.35 && ped.crossT < ped.crossDur * 0.7) {
      if (sim.v < 0.05) {
        sawStop = true;
        const gap = bumperFootGap(sim, ped);
        if (Math.abs(sim.x - hazardWorldX(ped, sim)) < CFG.carHalfW + ped.halfW + 0.2) {
          minWorld = Math.min(minWorld, gap.world);
          minScreen = Math.min(minScreen, gap.screen);
        }
        if (crossWhileStopped === null) crossWhileStopped = ped.crossT;
      }
    }
    if (sawStop && crossWhileStopped !== null && ped.crossT > crossWhileStopped + 1) break;
  }
  const ped = sim.hazards.find((h) => h.id === "ped");
  assert.ok(sawStop, "car never actually stopped for the crossing");
  assert.equal(sim.v, 0);
  assert.ok(ped.crossT > crossWhileStopped + 0.9, "pedestrian froze while the car was stopped");
  assert.equal(sim.stats.collisions, 0);
  assert.ok(minWorld > 2, `world gap ${minWorld}`);
  assert.ok(minWorld <= CFG.yieldStandoff + 0.05, `stop drifted past the standoff ${minWorld}`);
  assert.ok(minScreen > 48, `screen gap ${minScreen}px does not show daylight between bumper and feet`);

  const bumper = project(CFG.carHalfFront, sim.x);
  const origin = carDrawOrigin(bumper.x, bumper.y, 1, 0);
  const ly = CAR_NOSE_LOCAL_Y * CAR_SPRITE_SCALE;
  const dive = 0.14;
  const noseY = origin.y + Math.cos(dive) * ly;
  const noseX = origin.x - Math.sin(dive) * ly;
  assert.ok(Math.abs(noseY - bumper.y) < 0.01, noseY);
  assert.ok(Math.abs(noseX - bumper.x) < 0.01, noseX);
  assert.equal(CAR_SPRITE_SCALE, 1.42);
  assert.equal(CAR_BODY_W, 80);
  assert.equal(CAR_BODY_H, 112);
  assert.equal(PED_FOOT_LOCAL_Y + pedestrianFootShift(), 0);

  const sHeld = sim.s;
  const crossHeld = ped.crossT;
  for (let i = 0; i < 90; i++) stepSim(sim, dt, { held: true });
  assert.equal(sim.v, 0);
  assert.equal(sim.s, sHeld);
  assert.ok(ped.crossT > crossHeld + 1);
  assert.equal(sim.stats.collisions, 0);
  assert.equal(ped.resolved, null);

  for (let i = 0; i < 6000 && !ped.resolved && !sim.done; i++) stepSim(sim, dt, { held: false });
  assert.equal(ped.resolved, "clear");
  assert.equal(sim.stats.collisions, 0);
  assert.ok(Math.abs(hazardWorldX(ped, sim)) > 4, "pedestrian still in the lane");
  const sClear = sim.s;
  for (let i = 0; i < 240 && !sim.done; i++) stepSim(sim, dt, { held: false });
  assert.ok(sim.s > sClear + 8, "release did not resume");
  assert.equal(sim.stats.collisions, 0, "driving through the cleared crossing counted a hit");
  assert.ok(sim.s + CFG.carHalfFront > ped.s, "bumper never passed where the pedestrian stood");
});

test("early brake stops short of the pedestrian, then the lane clears", () => {
  const sim = createSim(getMission("lesson1"), 11);
  let minGap = Infinity;
  let sawStop = false;
  for (let i = 0; i < 16000 && !sim.done; i++) {
    const ped = sim.hazards.find((h) => h.id === "ped");
    const needsTap = sim.attention === "phone" || sim.attention === "drowsy" || sim.attention === "asleep";
    stepSim(sim, dt, { held: brakeOpen(sim), tap: needsTap });
    if (!ped.resolved && ped.crossT > 0.25 && ped.crossT < ped.crossDur * 0.7) {
      if (sim.v < 0.35) sawStop = true;
      if (Math.abs(sim.x - hazardWorldX(ped, sim)) < CFG.carHalfW + ped.halfW) {
        const gap = ped.s - ped.halfL - (sim.s + CFG.carHalfFront);
        minGap = Math.min(minGap, gap);
      }
    }
  }
  assert.equal(sim.success, true, dump(sim));
  assert.equal(sim.stats.collisions, 0, dump(sim));
  assert.equal(sim.hazards.find((h) => h.id === "ped").resolved, "clear");
  assert.ok(sawStop, "car never actually stopped for the crossing");
  assert.ok(minGap > 0.05, `bumper overlapped the pedestrian by ${minGap}`);
});

test("a large step cannot tunnel through a person, and a braked crawl does not die", () => {
  const fast = createSim(
    empty({
      hazards: [{ id: "ped", type: "pedestrian", s: 12, x: 1.8, halfW: 0.42, halfL: 0.55, trust: false }],
    }),
    1,
  );
  fast.v = 40;
  fast.x = 1.8;
  stepSim(fast, 0.5, { held: false, lockSpeed: true });
  assert.ok(fast.stats.collisions >= 1, dump(fast));
  assert.equal(fast.success, false);

  const shy = createSim(
    empty({
      hazards: [{ id: "ped", type: "pedestrian", s: 30, x: 1.8, halfW: 0.42, halfL: 0.55, trust: false }],
    }),
    1,
  );
  shy.v = 40;
  shy.s = 10;
  shy.x = 1.8;
  stepSim(shy, 0.25, { held: false, lockSpeed: true });
  assert.equal(shy.stats.collisions, 0, dump(shy));
  assert.ok(shy.s + CFG.carHalfFront < 30 - 0.55);

  const slow = createSim(getMission("lesson1"), 11);
  frames(slow, 200, false);
  while (slow.v > 0.2 && slow.s < 40) stepSim(slow, dt, { held: true });
  const ped = slow.hazards[0];
  let guard = 0;
  while (!ped.resolved && guard < 4000) {
    stepSim(slow, dt, { held: slow.v > 1 });
    guard += 1;
  }
  assert.equal(slow.stats.collisions, 0, dump(slow));
  assert.ok(slow.body > 95, slow.body);
});

test("trust, yield and a controlled stop all finish the open lessons", () => {
  for (const id of ["lesson1", "lesson2", "lesson3", "lesson4"]) {
    const careful = runSim(getMission(id), policyCareful, { maxTime: 240 });
    assert.equal(careful.success, true, `${id} ${dump(careful)}`);
    assert.equal(careful.stats.collisions, 0, `${id} ${dump(careful)}`);
  }
  const trusted = runSim(getMission("lesson2"), policyCareful, { maxTime: 240 });
  assert.ok(trusted.stats.trustClears >= 1, dump(trusted));
  const yielded = runSim(getMission("lesson1"), policyYield, { maxTime: 180 });
  assert.equal(yielded.success, true, dump(yielded));
  assert.equal(yielded.stats.collisions, 0, dump(yielded));
  const hows = new Set(yielded.events.filter((e) => e.kind === "clear").map((e) => e.how));
  assert.ok(hows.has("yield"), [...hows].join(","));

  const crashed = runSim(getMission("lesson1"), policyNever, { maxTime: 40 });
  assert.equal(crashed.success, false, dump(crashed));
  assert.equal(crashed.failReason, "body");

  const cake = runSim(getMission("lesson3"), policyCareful, { maxTime: 240 });
  const kinds = new Set(cake.events.map((e) => e.kind));
  assert.ok(kinds.has("avoid") || cake.stats.trustClears >= 1);
  assert.ok(kinds.has("clear"));
  assert.ok(cake.cargo > 40, cake.cargo);
  assert.notEqual(cake.cargoType, null);
});

test("pages bundle lists every runtime script and the shipped fonts", () => {
  const yml = readFileSync(".github/workflows/deploy-pages.yml", "utf8");
  for (const file of readdirSync("js")) {
    if (!file.endsWith(".js")) continue;
    assert.ok(yml.includes(`js/${file}`), file);
  }
  for (const font of ["BalsamiqSans-Bold.ttf", "BalsamiqSans-Regular.ttf", "RubikMonoOne-Regular.ttf"]) {
    assert.ok(yml.includes(`assets/fonts/${font}`), font);
  }
  for (const car of [
    "yellow-car-game-straight.png",
    "yellow-car-brake.png",
    "yellow-car-collision.png",
    "yellow-car-left.png",
    "yellow-car-right.png",
    "yellow-car-small-left.png",
    "yellow-car-small-right.png",
    "coral-wagon-straight.png",
  ]) {
    assert.ok(yml.includes(`assets/cars/${car}`), car);
  }
  assert.ok(yml.includes("assets/world/"));
  assert.ok(yml.includes("47_bin-hop.png"));
  for (const icon of [
    "manifest.webmanifest",
    "icons/favicon-32.png",
    "icons/apple-touch-icon.png",
    "icons/icon-192.png",
    "icons/icon-512.png",
  ]) {
    assert.ok(yml.includes(icon), icon);
  }
  assert.ok(!yml.includes("artifacts/"));
  assert.ok(!yml.includes("cp icons/anton-wheel-1024.png"));
  assert.ok(yml.includes("test ! -e .pages-dist/icons/anton-wheel-1024.png"));
  const master = createHash("sha256").update(readFileSync("icons/anton-wheel-1024.png")).digest("hex");
  assert.equal(master, "0d4fb6984918709768f78bc567088197970b7fd75c09de47f082377c2076f0a6");
  const html = readFileSync("index.html", "utf8");
  assert.ok(html.includes('href="icons/favicon-32.png"'));
  assert.ok(html.includes('href="icons/apple-touch-icon.png"'));
  assert.ok(html.includes('href="manifest.webmanifest"'));
  assert.ok(!html.includes("/icons/"));
});

function brakeOpen(sim) {
  const next = sim.hazards.find((h) => !h.resolved && !h.trust);
  if (!next) return false;
  const dist = next.s - sim.s;
  if (dist > 36 || dist < -1) return false;
  if ((next.type === "pedestrian" || next.type === "cutin") && next.crossT >= next.crossDur) return false;
  if (next.type === "pedestrian" || next.type === "cutin") return sim.v > 2.4;
  if (next.type === "roller") return sim.v > 6;
  return sim.v > 8;
}

test("brake timing: early stop leaves a gap, late speed is a hit, crawl is not", () => {
  const mission = getMission("lesson1");
  const early = createSim(mission, mission.seed);
  early.v = 10;
  let minGap = Infinity;
  let sawLane = false;
  for (let i = 0; i < 8000 && !early.done; i++) {
    const ped = early.hazards.find((h) => h.id === "ped");
    const needsTap = early.attention === "phone" || early.attention === "drowsy" || early.attention === "asleep";
    stepSim(early, dt, { held: brakeOpen(early), tap: needsTap });
    if (!ped.resolved && ped.crossT > 0.4 && ped.crossT < ped.crossDur * 0.7) {
      sawLane = true;
      if (Math.abs(early.x - hazardWorldX(ped, early)) < CFG.carHalfW + ped.halfW + 0.2) {
        minGap = Math.min(minGap, ped.s - ped.halfL - (early.s + CFG.carHalfFront));
      }
    }
  }
  assert.equal(early.stats.collisions, 0, dump(early));
  assert.equal(early.success, true, dump(early));
  assert.ok(sawLane, "pedestrian never occupied the lane");
  assert.ok(minGap > 2, `gap ${minGap}`);
  const pedDone = early.hazards.find((h) => h.id === "ped");
  assert.equal(pedDone.resolved, "clear");
  assert.ok(Math.abs(hazardWorldX(pedDone, early)) > 4, "pedestrian still in the lane");

  const late = createSim(mission, mission.seed);
  late.v = 12;
  for (let i = 0; i < 4000 && late.stats.collisions === 0 && !late.done; i++) {
    const ped = late.hazards.find((h) => h.id === "ped");
    const dist = ped.s - late.s;
    stepSim(late, dt, { held: dist < 6 && late.v > 8 });
  }
  assert.ok(late.stats.collisions >= 1, dump(late));

  const kinds = new Set(early.events.map((e) => e.kind + ":" + (e.id || "")));
  assert.ok([...kinds].some((name) => name.includes("lid") || name.includes("roller") || early.events.some((e) => e.id === "lid")));
});

test("the mobile frame stays on whole pixels when the toolbar jitters", () => {
  const phone = frameSize(844, 390);
  assert.equal(phone.width, Math.floor(phone.width));
  assert.equal(phone.height, Math.floor(phone.height));
  assert.ok(phone.height <= 390);
  assert.ok(phone.width <= 844);
  assert.ok(Math.abs(phone.width / phone.height - 16 / 9) < 0.02);

  const held = stableFrame(phone, 844, 391);
  assert.equal(held.width, phone.width);
  assert.equal(held.height, phone.height);
  const shrunk = stableFrame(phone, 844, 389);
  assert.ok(shrunk.height <= 389);
  assert.ok(shrunk.width <= phone.width);
  const back = stableFrame(shrunk, 844, 390);
  assert.equal(back.width, shrunk.width);
  assert.equal(back.height, shrunk.height);

  const placed = stablePlacement(null, 844, 390);
  assert.equal(placed.width, phone.width);
  assert.equal(placed.height, phone.height);
  assert.equal(placed.left + placed.width <= 844, true);
  assert.equal(placed.top + placed.height <= 390, true);
  const nudged = stablePlacement(placed, 844, 391);
  assert.equal(nudged.left, placed.left);
  assert.equal(nudged.top, placed.top);
  assert.equal(nudged.width, placed.width);
  assert.equal(nudged.height, placed.height);
  const clipped = stablePlacement(placed, 844, 389);
  assert.ok(clipped.height <= 389);
  assert.ok(clipped.top >= 0);
  assert.ok(clipped.top + clipped.height <= 389);
  assert.ok(clipped.left >= 0);
  assert.ok(clipped.left + clipped.width <= 844);

  const padded = contentBox(844, 390, { top: 0, right: 47, bottom: 21, left: 47 });
  assert.equal(padded.width, 750);
  assert.equal(padded.height, 369);
  const fitted = frameSize(padded.width, padded.height);
  assert.ok(fitted.width <= padded.width);
  assert.ok(fitted.height <= padded.height);
  assert.ok(Math.abs(fitted.width / fitted.height - 16 / 9) < 0.02);
  const squashed = 693 / 369;
  assert.ok(Math.abs(fitted.width / fitted.height - 16 / 9) < Math.abs(squashed - 16 / 9));

  const android = frameSize(915, 412);
  const shorter = stableFrame(android, 915, 360);
  assert.ok(shorter.height < android.height);
  assert.equal(shorter.width, Math.floor(shorter.width));

  // The old 100vh formula centers a changing canvas in a fixed screen.
  function legacyTop(outerW, outerH, cssVh) {
    const height = Math.min(cssVh, (outerW * 9) / 16);
    return (outerH - height) / 2;
  }
  const a = legacyTop(932, 430, 430);
  const b = legacyTop(932, 430, 414);
  assert.ok(Math.abs(b - a) > 5);
});

test("display rate changes how many 1/60 steps land in a frame, not the step itself", () => {
  for (const hz of [30, 60, 90, 120]) {
    let acc = 0;
    let steps = 0;
    for (let i = 0; i < hz; i++) {
      const drained = drainFrame(acc, 1 / hz, 1);
      acc = drained.acc;
      steps += drained.steps;
    }
    assert.ok(Math.abs(steps - 60) <= 1, `${hz} Hz produced ${steps} steps`);
    assert.ok(acc < 1 / 60, `${hz} Hz leftover ${acc}`);
  }
  const stall = drainFrame(0, 0.5, 1);
  assert.equal(stall.raw, 0.1);
  assert.equal(stall.steps, 6);
  const behind = drainFrame(0.2, 0.1, 1);
  assert.ok(behind.steps <= 8);
  assert.ok(behind.acc < 1 / 60 + 0.2);
});

test("a touch at the start of a step still hits once, and roadside props do not", () => {
  assert.equal(isSolidHazard({ id: "tree", kind: "prop", type: "bin" }), false);
  assert.equal(isSolidHazard({ id: "house", category: "decor", type: "stopped" }), false);
  assert.equal(isSolidHazard({ id: "ped", type: "pedestrian" }), true);

  const decor = createSim(
    {
      id: "decor",
      cruise: 12,
      roll: 10,
      length: 80,
      cargo: null,
      slippery: [],
      hazards: [{ id: "tree", kind: "prop", type: "pedestrian", s: 10, x: 1.8, halfW: 0.42, halfL: 0.55, trust: false }],
    },
    1,
  );
  decor.s = 6;
  decor.x = 1.8;
  decor.v = 12;
  stepSim(decor, 0.5, { held: false, lockSpeed: true });
  assert.equal(decor.stats.collisions, 0);
  assert.equal(decor.hazards[0].resolved, null);

  const slipped = createSim(getMission("lesson1"), 11);
  const ped = slipped.hazards.find((h) => h.id === "ped");
  ped.crossT = ped.crossDur * 0.4;
  ped.committed = "avoid";
  ped.trust = true;
  slipped.s = ped.s - 2;
  slipped.x = ped.x;
  slipped.v = 10;
  slipped.patience = 10;
  stepSim(slipped, 0.5, { held: false, lockSpeed: true });
  const hits = slipped.events.filter((e) => e.kind === "hit");
  assert.ok(Math.abs(slipped.x - ped.x) > CFG.carHalfW + ped.halfW - 0.04);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].hitId, "hit:ped");
  assert.equal(slipped.stats.collisions, 1);
  stepSim(slipped, 1 / 60, { held: false, lockSpeed: true });
  assert.equal(slipped.stats.collisions, 1);
  assert.equal(slipped.events.filter((e) => e.hitId === "hit:ped").length, 1);

  const lesson = getMission("lesson1");
  const missed = runSim(lesson, () => false, { maxTime: 40 });
  const careful = runSim(lesson, policyCareful, { maxTime: 90 });
  assert.ok(missed.stats.collisions >= 1);
  assert.equal(missed.events.filter((e) => e.hitId === "hit:ped").length, 1);
  assert.equal(careful.stats.collisions, 0, dump(careful));
});

test("lane contact is the overlap of the two time windows, not the two endpoints", () => {
  const reach = CFG.carHalfW + 0.42 - 0.04;
  const maxSteer = steerParams(0, false).rate / 60;
  const maxStory = CFG.storySpeedCap / 60;
  assert.ok(maxSteer < reach, `steer per step ${maxSteer} already crosses a lane`);
  assert.ok(2 * maxSteer < 2 * reach);
  assert.ok(maxStory < 0.4);

  const through = {
    prevX: -3,
    x: 3,
    prevS: 8,
    s: 16,
  };
  const body = { s: 12, halfL: 0.55, halfW: 0.42, prevX: 0, x: 0 };
  assert.ok(Math.abs(through.prevX) > reach && Math.abs(through.x) > reach);
  assert.equal(contactDuringStep(through, body, through.prevS), true);

  const earlyLane = overlapTimes(0, 3, -reach, reach);
  const lateNose = overlapTimes(0, 10, 6, 9);
  assert.ok(earlyLane && lateNose && earlyLane[1] < lateNose[0]);
  assert.equal(windowsOverlap(earlyLane, lateNose), false);
  const missed = { prevX: 1.8, x: 1.8 + 3, prevS: 0, s: 10 };
  const ahead = { s: 8, halfL: 0.55, halfW: 0.42, prevX: 1.8, x: 1.8 };
  assert.equal(contactDuringStep(missed, ahead, missed.prevS), false);

  const dart = { prevX: 0, x: 0, prevS: 10, s: 14 };
  const walker = { s: 12, halfL: 0.55, halfW: 0.42, prevX: -3, x: 3 };
  assert.equal(contactDuringStep(dart, walker, dart.prevS), true);

  const side = createSim(
    empty({
      hazards: [{ id: "ped", type: "pedestrian", s: 20, x: 1.8, halfW: 0.42, halfL: 0.55, trust: true }],
    }),
    1,
  );
  const ped = side.hazards[0];
  ped.crossT = ped.crossDur * 0.4;
  ped.committed = "avoid";
  side.v = CFG.storySpeedCap;
  side.patience = 0;
  side.x = 1.8 - (reach - 0.02);
  side.s = ped.s - ped.halfL - CFG.carHalfFront - 0.25;
  const noseGap = ped.s - ped.halfL - (side.s + CFG.carHalfFront);
  assert.ok(noseGap > 0.2 && noseGap < side.v / 60, `nose gap ${noseGap} is not inside one story step`);
  assert.ok(Math.abs(side.x - 1.8) < reach);
  stepSim(side, 1 / 60, { held: false, lockSpeed: true });
  assert.ok(Math.abs(side.x - 1.8) > reach, dump(side));
  assert.equal(side.stats.collisions, 0, dump(side));
  assert.equal(side.hazards[0].hitId, undefined);

  const wide = createSim(
    empty({
      hazards: [{ id: "ped", type: "pedestrian", s: 12, x: -0.2, halfW: 0.42, halfL: 0.55, trust: false }],
    }),
    1,
  );
  wide.hazards[0].crossT = wide.hazards[0].crossDur * 0.2;
  wide.x = -3;
  wide.v = 20;
  wide.s = 0;
  stepSim(wide, 1.2, { held: false, lockSpeed: true });
  const wideReach = CFG.carHalfW + 0.42 - 0.04;
  assert.ok(Math.abs(wide.x - (-0.2)) > wideReach, dump(wide));
  assert.equal(wide.stats.collisions, 1, dump(wide));
  assert.equal(wide.events.filter((e) => e.hitId === "hit:ped").length, 1);
});

function mockCtx() {
  const calls = [];
  const target = { canvas: { width: 1600, height: 900 } };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === "measureText") return () => ({ width: 40 });
      return (...args) => {
        const nums = args.filter((item) => typeof item === "number" && Number.isFinite(item));
        if (nums.length) calls.push(nums);
        return undefined;
      };
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  });
  return { ctx, calls };
}

function playState(session, alpha) {
  return {
    screen: "play",
    session,
    save: freshSave(),
    now: 1000,
    hint: false,
    debug: false,
    notice: null,
    preview: null,
    missions: LESSONS,
    selected: session.mission.id,
    pose: null,
    alpha,
  };
}

function simFingerprint(sim) {
  return JSON.stringify({
    s: sim.s,
    x: sim.x,
    v: sim.v,
    t: sim.t,
    prevS: sim.prevS,
    prevX: sim.prevX,
    collisions: sim.stats.collisions,
    patience: sim.patience,
    events: sim.events,
    hazards: sim.hazards.map((h) => ({
      id: h.id,
      resolved: h.resolved,
      crossT: h.crossT,
      x: h.x,
      prevX: h.prevX,
    })),
  });
}

test("render samples the last step only and does not touch the sim", () => {
  const session = createSession(getMission("lesson1"), { seed: 11 });
  session.phase = "drive";
  session.countdownAcc = 3;
  sessionStep(session, dt);
  const sim = session.sim;
  assert.ok(sim.s > sim.prevS);
  const start = sim.prevS;
  const end = sim.s;
  const mid = (start + end) / 2;
  const at0 = placedScene(sim, 0);
  const at1 = placedScene(sim, 1);
  const atHalf = placedScene(sim, 0.5);
  assert.equal(at0.pose.s, start);
  assert.equal(at1.pose.s, end);
  assert.ok(Math.abs(atHalf.pose.s - mid) < 1e-9);
  assert.equal(at0.pose.x, sim.prevX);
  assert.equal(at1.pose.x, sim.x);
  assert.ok(Math.abs(atHalf.pose.x - (sim.prevX + sim.x) / 2) < 1e-9);

  const ped0 = at0.actors.find((actor) => actor.id === "ped");
  const ped1 = at1.actors.find((actor) => actor.id === "ped");
  const pedHalf = atHalf.actors.find((actor) => actor.id === "ped");
  assert.ok(ped0.dist > ped1.dist);
  assert.ok(Math.abs(pedHalf.dist - (ped0.dist + ped1.dist) / 2) < 1e-9);
  assert.ok(Math.abs(pedHalf.hx - (ped0.hx + ped1.hx) / 2) < 1e-9);
  assert.notEqual(ped0.spot.y, ped1.spot.y);
  assert.notEqual(ped0.spot.x, ped1.spot.x);
  // The camera sits on the car, so the bumper's screen x follows lateral pose only.
  assert.equal(at0.car.x, project(CFG.carHalfFront, sim.prevX).x);
  assert.equal(at1.car.x, project(CFG.carHalfFront, sim.x).x);
  assert.ok(Math.abs(atHalf.car.x - project(CFG.carHalfFront, (sim.prevX + sim.x) / 2).x) < 1e-6);

  const before = simFingerprint(sim);
  const drawn0 = mockCtx();
  const drawnHalf = mockCtx();
  const drawn1 = mockCtx();
  const spots0 = render(drawn0.ctx, playState(session, 0)).spots;
  const spotsHalf = render(drawnHalf.ctx, playState(session, 0.5)).spots;
  const spots1 = render(drawn1.ctx, playState(session, 1)).spots;
  assert.deepEqual(spots0, spotsHalf);
  assert.deepEqual(spots0, spots1);
  assert.notDeepEqual(drawn0.calls, drawnHalf.calls);
  assert.notDeepEqual(drawnHalf.calls, drawn1.calls);
  assert.equal(simFingerprint(sim), before);
  assert.equal(sim.stats.collisions, 0);

  const afterFirst = sim.s;
  stepSim(sim, dt, { held: false });
  assert.equal(sim.prevS, afterFirst);
  assert.equal(renderPose(sim, 0).s, afterFirst);
  assert.notEqual(renderPose(sim, 0).s, start);

  const frozenS = sim.s;
  const frozenEvents = sim.events.length;
  const low = renderPose(sim, 0.2).s;
  const high = renderPose(sim, 0.8).s;
  assert.ok(high > low);
  assert.ok(low > sim.prevS && high < sim.s);
  assert.equal(sim.s, frozenS);
  assert.equal(sim.events.length, frozenEvents);
});

test("pause, blur, hide, retry, countdown and finish drop the stale pose", () => {
  const session = createSession(getMission("lesson1"), { seed: 11 });
  assert.equal(session.phase, "countdown");
  assert.equal(session.sim.prevS, session.sim.s);
  sessionStep(session, 1);
  assert.equal(session.phase, "countdown");
  assert.equal(session.sim.s, 0);
  assert.equal(renderPose(session.sim, 0.4).s, 0);
  sessionStep(session, 2.1);
  assert.equal(session.phase, "drive");
  assert.equal(session.sim.prevS, session.sim.s);

  frames(session.sim, 20, false);
  assert.notEqual(session.sim.prevS, session.sim.s);
  const live = session.sim.s;
  pauseSession(session, "button");
  assert.equal(session.sim.prevS, live);
  assert.equal(renderPose(session.sim, 0).s, live);
  assert.equal(renderPose(session.sim, 0.3).s, live);
  resumeSession(session);
  assert.equal(session.phase, "drive");
  assert.equal(renderPose(session.sim, 0.3).s, live);

  frames(session.sim, 5, false);
  onBlur(session);
  assert.equal(session.pauseReason, "blur");
  assert.equal(session.sim.prevS, session.sim.s);
  resumeSession(session);
  frames(session.sim, 5, false);
  onVisibility(session, true);
  assert.equal(session.pauseReason, "hidden");
  assert.equal(session.sim.prevX, session.sim.x);
  for (const hazard of session.sim.hazards) {
    assert.equal(hazard.prevX, hazardWorldX(hazard, session.sim));
  }

  const moved = session.sim.s;
  restartSession(session);
  assert.equal(session.phase, "drive");
  assert.notEqual(session.sim.s, moved);
  assert.equal(session.sim.prevS, session.sim.s);
  assert.equal(session.sim.prevX, session.sim.x);
  assert.equal(renderPose(session.sim, 0).s, renderPose(session.sim, 1).s);

  session.sim.s = session.mission.length;
  session.sim.done = true;
  session.phase = "drive";
  session.sim.prevS = 0;
  sessionStep(session, dt);
  assert.equal(session.phase, "result");
  assert.equal(session.sim.prevS, session.sim.s);
  assert.equal(renderAlpha(Number.NaN, dt), 1);
});

test("drawing between frames does not change 30/60/90/120 or the stall cap", () => {
  function ride(hz, seconds, draw) {
    const session = createSession(getMission("lesson1"), { seed: 11 });
    session.phase = "drive";
    session.countdownAcc = 3;
    let acc = 0;
    let steps = 0;
    const shown = [];
    let between = 0;
    for (let frame = 0; frame < hz * seconds; frame += 1) {
      const drained = drainFrame(acc, 1 / hz, 1);
      acc = drained.acc;
      for (let n = 0; n < drained.steps; n += 1) {
        sessionStep(session, 1 / 60);
        steps += 1;
      }
      const alpha = session.phase === "drive" ? renderAlpha(acc, 1 / 60) : 1;
      const scene = placedScene(session.sim, alpha);
      if (draw) render(mockCtx().ctx, playState(session, alpha));
      const prev = session.sim.prevS;
      const curr = session.sim.s;
      const lo = Math.min(prev, curr);
      const hi = Math.max(prev, curr);
      assert.ok(scene.pose.s >= lo - 1e-9 && scene.pose.s <= hi + 1e-9);
      if (session.phase === "drive" && scene.pose.s > lo + 1e-6 && scene.pose.s < hi - 1e-6) between += 1;
      shown.push(scene.pose.s);
    }
    return { fp: simFingerprint(session.sim), steps, shown, between, collisions: session.sim.stats.collisions };
  }

  for (const hz of [30, 60, 90, 120]) {
    const plain = ride(hz, 2, false);
    const drawn = ride(hz, 2, true);
    assert.equal(drawn.fp, plain.fp, `${hz} Hz render changed the sim`);
    assert.equal(drawn.collisions, plain.collisions);
    let rewound = 0;
    for (let i = 1; i < drawn.shown.length; i += 1) {
      if (drawn.shown[i] + 1e-6 < drawn.shown[i - 1]) rewound += 1;
    }
    assert.equal(rewound, 0, `${hz} Hz rewound the picture`);
  }
  const smooth = ride(120, 3, false);
  assert.ok(smooth.between > 20, `120 Hz intermediates ${smooth.between}`);
  const odd = ride(90, 3, false);
  assert.ok(odd.between > 10, `90 Hz intermediates ${odd.between}`);

  const stalled = createSession(getMission("lesson1"), { seed: 11 });
  stalled.phase = "drive";
  stalled.countdownAcc = 3;
  const twin = createSession(getMission("lesson1"), { seed: 11 });
  twin.phase = "drive";
  twin.countdownAcc = 3;
  const burst = drainFrame(0, 0.5, 1);
  assert.equal(burst.steps, 6);
  assert.equal(burst.raw, 0.1);
  for (let n = 0; n < burst.steps; n += 1) {
    sessionStep(stalled, 1 / 60);
    sessionStep(twin, 1 / 60);
    placedScene(stalled.sim, renderAlpha(burst.acc, 1 / 60));
  }
  assert.equal(simFingerprint(stalled.sim), simFingerprint(twin.sim));
  assert.equal(stalled.sim.events.length, twin.sim.events.length);
});

function walkMission() {
  return {
    id: "walk",
    seed: 1,
    cruise: 12,
    roll: 10,
    length: 400,
    cargo: null,
    slippery: [],
    hazards: [
      { id: "ped", type: "pedestrian", s: 90, x: 1.2, halfW: 0.42, halfL: 0.55 },
      { id: "dog", type: "dog", s: 30, x: 0.4, halfW: 0.35, halfL: 0.45 },
    ],
  };
}

test("walk cycles use the drawn poses and do not invent a missing stride", () => {
  const phone = { id: "ped", crossT: 0.4, crossDur: 3, hopped: false };
  const seen = new Set();
  for (let d = 0; d < PED_STRIDE; d += PED_STRIDE / 12) seen.add(pedPoseKey(phone, d, false));
  assert.deepEqual([...seen].sort(), ["pedLift", "pedPass", "pedStand"]);
  assert.equal(pedPoseKey({ ...phone, crossT: -1 }, 0.4, false), "pedStand");
  assert.equal(pedPoseKey(phone, 0.4, true), "pedStand");
  const groc = { id: "groc", crossT: 0.4, hopped: false };
  const grocSeen = new Set();
  for (let d = 0; d < PED_STRIDE; d += PED_STRIDE / 8) grocSeen.add(pedPoseKey(groc, d, false));
  assert.deepEqual([...grocSeen].sort(), ["pedGroc", "pedGrocStand"]);
  assert.equal(pedPoseKey({ ...groc, crossT: -1 }, 0.2, false), "pedGrocStand");
  const dog = new Set();
  for (let d = 0.06; d < DOG_STRIDE; d += DOG_STRIDE / 8) dog.add(dogPoseKey(d, false));
  assert.deepEqual([...dog].sort(), ["dogPaw", "dogWalk"]);
  assert.equal(dogPoseKey(0, false), "dogPaw");
  assert.equal(strideSlot(0, PED_STRIDE, 3), 0);
  assert.equal(strideSlot(PED_STRIDE * 0.9, PED_STRIDE, 3), 2);
});

test("pedestrian and dog feet follow distance, and a stride boundary does not flip them", () => {
  let prev = footOffset(0, PED_STRIDE, 8);
  for (let distance = 0.01; distance < PED_STRIDE * 3; distance += 0.01) {
    const next = footOffset(distance, PED_STRIDE, 8);
    assert.ok(Math.abs(next - prev) < 1, `${distance} jumped from ${prev} to ${next}`);
    prev = next;
  }
  const edge = PED_STRIDE;
  assert.ok(Math.abs(footOffset(edge - 0.01, PED_STRIDE, 8) - footOffset(edge + 0.01, PED_STRIDE, 8)) < 0.5);
  assert.ok(Math.abs(footOffset(edge, PED_STRIDE, 8) + 8) < 1e-9);
  assert.equal(gaitOffset(1.2, "pedestrian", true), 0);
  assert.equal(gaitOffset(1.2, "dog", true), 0);
  assert.equal(footOffset(0, DOG_STRIDE, 5), footOffset(0, DOG_STRIDE, 5));

  const sim = createSim(walkMission(), 1);
  const ped = sim.hazards.find((h) => h.id === "ped");
  const dog = sim.hazards.find((h) => h.id === "dog");
  assert.equal(actorTravel(ped, sim), 0);
  assert.equal(actorTravel(dog, sim), 0);
  sim.v = 0;
  frames(sim, 40, false);
  assert.equal(actorTravel(ped, sim), 0);
  assert.equal(actorTravel(dog, sim), 0);
  assert.equal(gaitOffset(actorTravel(ped, sim), "pedestrian"), gaitOffset(0, "pedestrian"));

  let walked = 0;
  for (let u = 0; u <= 1.001; u += 0.01) {
    ped.crossT = u * ped.crossDur;
    const travel = actorTravel(ped, sim);
    assert.ok(travel + 1e-9 >= walked, `ped travel went back at ${u}`);
    walked = travel;
  }
  ped.crossT = 0.3 * ped.crossDur;
  const lingerA = actorTravel(ped, sim);
  ped.crossT = 0.6 * ped.crossDur;
  assert.equal(actorTravel(ped, sim), lingerA);
  assert.equal(hazardWorldX(ped, sim), ped.x);

  ped.hopped = true;
  ped.crossT = 0.5 * ped.crossDur;
  assert.equal(actorTravel(ped, sim), 0);
  ped.hopped = false;
  ped.crossT = -1;

  let dogWalk = 0;
  for (let s = 0; s <= 40; s += 0.25) {
    sim.s = s;
    const travel = actorTravel(dog, sim);
    assert.ok(travel + 1e-6 >= dogWalk);
    dogWalk = travel;
  }
  const parked = actorTravel(dog, sim);
  sim.v = 0;
  const frozenS = sim.s;
  stepSim(sim, 1 / 60, { held: false, lockSpeed: true });
  assert.equal(sim.s, frozenS);
  assert.equal(actorTravel(dog, sim), parked);

  function arrive(dt, n) {
    const next = createSim(walkMission(), 1);
    const body = next.hazards.find((h) => h.id === "ped");
    body.crossT = 0.08 * body.crossDur;
    next.v = 0;
    for (let i = 0; i < n; i += 1) stepSim(next, dt, { held: false, lockSpeed: true });
    return actorTravel(body, next);
  }
  const fine = arrive(1 / 60, 12);
  const mid = arrive(1 / 30, 6);
  const coarse = arrive(0.2, 1);
  assert.ok(Math.abs(fine - mid) < 1e-9);
  assert.ok(Math.abs(fine - coarse) < 1e-9);
  assert.ok(fine > 0);

  function dart(dt, n) {
    const next = createSim(walkMission(), 1);
    next.v = 12;
    next.s = 10;
    for (let i = 0; i < n; i += 1) stepSim(next, dt, { held: false, lockSpeed: true });
    return { s: next.s, travel: actorTravel(next.hazards.find((h) => h.id === "dog"), next) };
  }
  const dashA = dart(1 / 60, 12);
  const dashB = dart(1 / 30, 6);
  const dashC = dart(0.2, 1);
  assert.ok(Math.abs(dashA.s - dashB.s) < 1e-9);
  assert.ok(Math.abs(dashA.s - dashC.s) < 1e-9);
  assert.ok(Math.abs(dashA.travel - dashB.travel) < 1e-6, `${dashA.travel} vs ${dashB.travel}`);
  assert.ok(Math.abs(dashA.travel - dashC.travel) < 1e-6, `${dashA.travel} vs ${dashC.travel}`);

  const posed = createSim(walkMission(), 1);
  const mover = posed.hazards.find((h) => h.id === "ped");
  mover.crossT = 0.1 * mover.crossDur;
  posed.v = 0;
  stepSim(posed, 1 / 60, { held: false, lockSpeed: true });
  assert.ok(actorTravel(mover, posed) > mover.prevTravel);
  let past = null;
  for (let u = 0.04; u < 0.2; u += 0.0002) {
    mover.crossT = u * mover.crossDur;
    const travel = actorTravel(mover, posed);
    if (travel >= PED_STRIDE + 0.02) {
      past = travel;
      break;
    }
  }
  assert.ok(past > PED_STRIDE);
  mover.prevTravel = past - 0.04;
  const beforeEvents = posed.events.length;
  const beforeHits = posed.stats.collisions;
  const seen = renderPose(posed, 0.5);
  assert.equal(posed.events.length, beforeEvents);
  assert.equal(posed.stats.collisions, beforeHits);
  const rendered = mover.prevTravel + (past - mover.prevTravel) * 0.5;
  assert.ok(Math.abs(seen.hazardTravel.get("ped") - rendered) < 1e-9);
  const scene = placedScene(posed, 0.5);
  assert.equal(scene.actors.find((actor) => actor.id === "ped").travel, seen.hazardTravel.get("ped"));
  assert.ok(Math.abs(gaitOffset(rendered, "pedestrian") + 8) < 1);

  const session = createSession(walkMission(), { seed: 1 });
  session.phase = "drive";
  session.countdownAcc = 3;
  const livePed = session.sim.hazards.find((h) => h.id === "ped");
  livePed.crossT = 0.1 * livePed.crossDur;
  session.sim.v = 0;
  sessionStep(session, 1 / 60);
  pauseSession(session, "button");
  assert.equal(livePed.prevTravel, actorTravel(livePed, session.sim));
  assert.equal(renderPose(session.sim, 0.25).hazardTravel.get("ped"), livePed.prevTravel);
  onVisibility(session, true);
  assert.equal(session.sim.hazards.find((h) => h.id === "ped").prevTravel, actorTravel(session.sim.hazards.find((h) => h.id === "ped"), session.sim));
  restartSession(session);
  const reset = session.sim.hazards.find((h) => h.id === "ped");
  assert.equal(actorTravel(reset, session.sim), 0);
  assert.equal(gaitOffset(actorTravel(reset, session.sim), "pedestrian"), -8);
});

test("one tap wakes Anton, the brake does not, and a late hole stays his", () => {
  const phone = createSim(getMission("lesson1"), 11);
  phone.s = 92;
  phone.v = 12;
  stepSim(phone, dt, { held: false, lockSpeed: true });
  assert.equal(phone.attention, "phone");
  assert.equal(pokeAttention(phone), true);
  assert.equal(phone.attention, "stow");
  assert.equal(pokeAttention(phone), false);
  assert.equal(phone.stats.attentionPokes, 1);
  frames(phone, Math.ceil(0.72 / dt), false, { lockSpeed: true });
  assert.equal(phone.attention, "earnest");
  const braked = createSim(getMission("lesson1"), 11);
  braked.s = 100;
  braked.v = 12;
  braked.attention = "phone";
  braked.phonePlayed = true;
  stepSim(braked, dt, { held: true, lockSpeed: true });
  assert.equal(braked.attention, "phone");
  assert.equal(braked.stats.attentionPokes, 0);
  assert.ok(braked.brakeInput > 0);

  const lesson = getMission("lesson2");
  assert.equal(lesson.sleepDrowsyAt, 390);
  assert.equal(lesson.sleepAt, 430);
  assert.equal(getMission("lesson3").phoneAt, undefined);
  assert.equal(getMission("lesson4").sleepDrowsyAt, undefined);
  const drowsy = createSim(lesson, 22);
  drowsy.s = 390;
  drowsy.v = 12;
  stepSim(drowsy, dt, { held: false, lockSpeed: true });
  assert.equal(drowsy.attention, "drowsy");
  const hole = drowsy.hazards.find((h) => h.id === "nap");
  hole.s = drowsy.s + 30;
  stepSim(drowsy, dt, { held: false, lockSpeed: true });
  assert.notEqual(hole.committed, "asleep");
  assert.equal(pokeAttention(drowsy), true);
  assert.equal(drowsy.attention, "wake");

  const asleep = createSim(lesson, 22);
  asleep.s = 430;
  asleep.v = 10;
  asleep.attention = "asleep";
  asleep.sleepPlayed = true;
  const nap = asleep.hazards.find((h) => h.id === "nap");
  nap.s = asleep.s + 10;
  stepSim(asleep, dt, { held: true, lockSpeed: true });
  assert.equal(nap.committed, "asleep");
  assert.equal(asleep.attention, "asleep");
  pokeAttention(asleep);
  stepSim(asleep, dt, { held: true, lockSpeed: true });
  assert.equal(nap.committed, "asleep");
  assert.ok(Math.abs(asleep.x) <= 3.35);

  const early = createSim(lesson, 22);
  early.s = 400;
  early.v = 10;
  early.attention = "asleep";
  early.sleepPlayed = true;
  const far = early.hazards.find((h) => h.id === "nap");
  far.s = early.s + 20;
  stepSim(early, dt, { held: false, lockSpeed: true });
  assert.equal(far.committed, "asleep");
  pokeAttention(early);
  stepSim(early, dt, { held: false, lockSpeed: true });
  assert.equal(far.committed, "avoid");

  const missed = runSim(getMission("lesson1"), policyCareful, { maxTime: 120, attend: false });
  assert.ok(missed.stats.collisions >= 1, dump(missed));
  const watched = runSim(getMission("lesson1"), policyCareful, { maxTime: 120 });
  assert.equal(watched.stats.collisions, 0, dump(watched));
  assert.equal(watched.success, true, dump(watched));

  function script(step) {
    const sim = createSim(getMission("lesson1"), 11);
    sim.s = 80;
    sim.v = 12.5;
    let acc = 0;
    let taps = 0;
    while (sim.s < 110 && !sim.done) {
      const drained = drainFrame(acc, step, 1);
      acc = drained.acc;
      for (let n = 0; n < drained.steps; n += 1) {
        const tap = sim.attention === "phone" && taps === 0;
        if (tap) taps += 1;
        stepSim(sim, 1 / 60, { held: false, lockSpeed: true, tap });
      }
    }
    return { s: sim.s, attention: sim.attention, pokes: sim.stats.attentionPokes, collisions: sim.stats.collisions };
  }
  const slow = script(1 / 30);
  const fast = script(1 / 120);
  assert.equal(slow.pokes, 1);
  assert.equal(fast.pokes, 1);
  assert.equal(slow.attention, fast.attention);
  assert.equal(slow.collisions, fast.collisions);

  const session = createSession(getMission("lesson1"), { seed: 11 });
  session.phase = "drive";
  session.countdownAcc = 3;
  assert.equal(pointerDown(session, "screen", 4), "ignore");
  assert.equal(pointerDown(session, "pedal", 1), "brake");
  assert.equal(pointerDown(session, "anton", 2), "wake");
  assert.equal(session.brakeHeld, true);
  assert.equal(session.wakeId, 2);
  releasePointer(session, 2);
  assert.equal(session.brakeHeld, true);
  assert.equal(session.wakeId, null);
  assert.equal(pointerDown(session, "anton", 3), "wake");
  releasePointer(session, 9);
  assert.equal(session.pointerId, 1);
  assert.equal(session.wakeId, 3);
  releasePointer(session, 3);
  releasePointer(session, 1);
  assert.equal(session.brakeHeld, false);
  assert.equal(session.wakeId, null);
  session.phase = "drive";
  pointerDown(session, "anton", 5);
  pointerDown(session, "pedal", 6);
  assert.equal(session.wakeId, 5);
  assert.equal(session.pointerId, 6);
  releasePointer(session, 6);
  assert.equal(session.wakeId, 5);
  assert.equal(session.brakeHeld, false);
  onBlur(session);
  assert.equal(session.pointerId, null);
  assert.equal(session.wakeId, null);
  assert.equal(session.tapQueued, false);
  restartSession(session);
  assert.equal(session.sim.attention, "road");
  assert.equal(session.sim.stats.attentionPokes, 0);
});

test("attention fingers, cues and both lessons stay fair at every frame rate", () => {
  const lesson1 = getMission("lesson1");
  const lesson2 = getMission("lesson2");
  assert.equal(lesson1.phoneAt, 92);
  assert.equal(lesson1.hazards.find((h) => h.id === "hole").s, 176);
  assert.equal(lesson1.length, 470);
  assert.equal(lesson2.sleepDrowsyAt, 390);
  assert.equal(lesson2.sleepAt, 430);
  assert.equal(lesson2.hazards.find((h) => h.id === "nap").s, 520);
  assert.equal(lesson2.length, 640);
  for (const lesson of [lesson1, lesson2]) {
    let prev = 0;
    for (const hazard of lesson.hazards) {
      if (prev) assert.ok(hazard.s - prev >= 78, `${lesson.id} ${hazard.id}`);
      prev = hazard.s;
    }
    assert.ok(lesson.hazards.at(-1).s < lesson.length - 70);
  }

  const session = createSession(lesson1, { seed: 11 });
  session.phase = "drive";
  session.countdownAcc = 3;
  assert.equal(pointerDown(session, "pedal", 1), "brake");
  assert.equal(pointerDown(session, "anton", 1), "ignore");
  assert.equal(session.wakeId, null);
  assert.equal(session.tapQueued, false);
  assert.equal(pointerDown(session, "anton", 2), "wake");
  assert.equal(pointerDown(session, "anton", 3), "ignore");
  assert.equal(pointerDown(session, "pedal", 4), "ignore");
  assert.equal(session.pointerId, 1);
  assert.equal(session.wakeId, 2);
  assert.equal(session.tapQueued, true);
  releasePointer(session, 2);
  assert.equal(session.brakeHeld, true);
  assert.equal(session.pointerId, 1);
  assert.equal(session.wakeId, null);
  releasePointer(session, 1);
  assert.equal(session.brakeHeld, false);

  assert.equal(pointerDown(session, "anton", 5), "wake");
  assert.equal(pointerDown(session, "pedal", 5), "ignore");
  assert.equal(pointerDown(session, "pedal", 6), "brake");
  releasePointer(session, 6);
  assert.equal(session.wakeId, 5);
  assert.equal(session.brakeHeld, false);
  assert.equal(session.tapQueued, true);
  session.tapQueued = false;
  pointerDown(session, "pedal", 7);
  releasePointer(session, 5);
  assert.equal(session.brakeHeld, true);
  assert.equal(session.wakeId, null);

  session.sim.attention = "phone";
  session.sim.phonePlayed = true;
  keyDown(session, "KeyF", { repeat: false });
  keyDown(session, "KeyF", { repeat: true });
  assert.equal(session.tapQueued, true);
  assert.equal(session.keysDown.has("Space"), false);
  keyDown(session, "Space", { repeat: false });
  assert.equal(session.keysDown.has("Space"), true);
  sessionStep(session, 1 / 60);
  assert.equal(session.sim.attention, "stow");
  assert.equal(session.sim.stats.attentionPokes, 1);
  assert.ok(session.sim.brakeInput > 0);
  keyDown(session, "KeyF", { repeat: true });
  assert.equal(session.tapQueued, false);
  keyDown(session, "KeyF", { repeat: false });
  sessionStep(session, 1 / 60);
  assert.equal(session.sim.stats.attentionPokes, 1);

  for (const state of ["phone", "stow", "drowsy", "asleep", "wake"]) {
    const ride = createSession(lesson1, { seed: 11 });
    ride.phase = "drive";
    ride.countdownAcc = 3;
    ride.sim.attention = state;
    ride.sim.phonePlayed = true;
    ride.sim.sleepPlayed = true;
    ride.sim.stowT = 0.2;
    ride.sim.wakeT = 0.2;
    pointerDown(ride, "pedal", 1);
    pointerDown(ride, "anton", 2);
    const timer = state === "wake" ? ride.sim.wakeT : ride.sim.stowT;
    pauseSession(ride, "pause");
    sessionStep(ride, 1);
    assert.equal(ride.phase, "pause", state);
    assert.equal(ride.sim.attention, state, state);
    assert.equal(ride.pointerId, null, state);
    assert.equal(ride.wakeId, null, state);
    assert.equal(ride.tapQueued, false, state);
    assert.equal(ride.sim.brakeInput, 0, state);
    assert.equal(state === "wake" ? ride.sim.wakeT : ride.sim.stowT, timer, state);
    resumeSession(ride);
    onBlur(ride);
    assert.equal(ride.pauseReason, "blur");
    resumeSession(ride);
    onVisibility(ride, true);
    assert.equal(ride.pauseReason, "hidden");
    assert.equal(ride.sim.attention, state);
    restartSession(ride);
    assert.equal(ride.sim.attention, "road");
    assert.equal(ride.sim.phonePlayed, false);
    assert.equal(ride.pointerId, null);
  }

  function atDistance(dist) {
    const sim = createSim({
      id: "edge",
      seed: 1,
      cruise: 10,
      length: 400,
      cargo: null,
      slippery: [],
      hazards: [{ id: "hole", type: "pothole", s: 100 + dist, trust: true, x: 1.8, halfW: 0.7, halfL: 1.2 }],
    }, 1);
    sim.s = 100;
    sim.v = 0;
    sim.x = 1.8;
    sim.attention = "asleep";
    sim.sleepPlayed = true;
    stepSim(sim, 1 / 60, { held: false, lockSpeed: true });
    return sim;
  }
  const onEdge = atDistance(14);
  assert.equal(onEdge.hazards[0].committed, "asleep");
  pokeAttention(onEdge);
  stepSim(onEdge, 1 / 60, { held: false, lockSpeed: true });
  assert.equal(onEdge.hazards[0].committed, "asleep");
  const justFar = atDistance(14.25);
  pokeAttention(justFar);
  stepSim(justFar, 1 / 60, { held: false, lockSpeed: true });
  assert.equal(justFar.hazards[0].committed, "avoid");
  const inside = atDistance(10);
  pokeAttention(inside);
  stepSim(inside, 1 / 60, { held: false, lockSpeed: true });
  assert.equal(inside.hazards[0].committed, "asleep");

  const nodding = createSim(lesson2, 22);
  nodding.s = 400;
  nodding.v = 8;
  nodding.attention = "drowsy";
  nodding.sleepPlayed = true;
  nodding.x = 1.8;
  const nap = nodding.hazards.find((h) => h.id === "nap");
  nap.s = nodding.s + 30;
  nap.x = 1.8;
  for (let i = 0; i < 40; i += 1) stepSim(nodding, 1 / 60, { held: false, lockSpeed: true });
  assert.equal(nap.committed, "avoid");
  assert.ok(nodding.x < 1.2, nodding.x);
  assert.equal(nodding.attention, "drowsy");

  const dozing = createSim(lesson2, 22);
  dozing.s = 450;
  dozing.v = 8;
  dozing.attention = "asleep";
  dozing.sleepPlayed = true;
  dozing.x = CFG.defaultX;
  for (let i = 0; i < 90; i += 1) stepSim(dozing, 1 / 60, { held: false, lockSpeed: true });
  assert.ok(Math.abs(dozing.x) <= 3.35);
  assert.ok(Math.abs(dozing.x - CFG.defaultX) < 0.35, dozing.x);

  const early = runSim(lesson1, policyCareful, { maxTime: 140 });
  const earlyAgain = runSim(lesson1, policyCareful, { maxTime: 140 });
  assert.equal(early.success, true, dump(early));
  assert.equal(early.stats.collisions, 0, dump(early));
  assert.equal(early.attention, "road");
  assert.equal(early.phonePlayed, true);
  assert.deepEqual(early.events, earlyAgain.events);
  assert.equal(early.events.some((e) => e.kind === "asleep"), false);
  early.done = false;
  stepSim(early, 1 / 60, { held: false });
  assert.equal(early.attention, "road");

  const ignored = runSim(lesson1, policyCareful, { maxTime: 140, attend: false });
  assert.ok(ignored.events.some((e) => e.hitId === "hit:hole"), dump(ignored));
  const slept = runSim(lesson2, policyCareful, { maxTime: 180 });
  const sleptAgain = runSim(lesson2, policyCareful, { maxTime: 180 });
  assert.equal(slept.success, true, dump(slept));
  assert.equal(slept.stats.collisions, 0, dump(slept));
  assert.deepEqual(slept.events, sleptAgain.events);
  assert.equal(slept.events.some((e) => e.id === "nap" && e.kind === "asleep"), false);
  const napHit = runSim(lesson2, policyCareful, { maxTime: 180, attend: false });
  assert.ok(napHit.events.some((e) => e.hitId === "hit:nap"), dump(napHit));

  function batch(hz) {
    const sim = createSim(lesson1, 11);
    sim.s = 88;
    sim.v = 12.5;
    let acc = 0;
    let steps = 0;
    while (steps < 200) {
      const drained = drainFrame(acc, 1 / hz, 1);
      acc = drained.acc;
      for (let n = 0; n < drained.steps && steps < 200; n += 1) {
        const tap = sim.attention === "phone" && sim.stats.attentionPokes === 0;
        stepSim(sim, 1 / 60, { held: false, lockSpeed: true, tap });
        placedScene(sim, renderAlpha(acc, 1 / 60));
        steps += 1;
      }
    }
    const hole = sim.hazards.find((h) => h.id === "hole");
    return [sim.attention, sim.stats.attentionPokes, sim.stats.collisions, hole.committed, sim.phonePlayed];
  }
  const rates = [30, 60, 90, 120].map(batch);
  for (const row of rates) assert.deepEqual(row, rates[0]);

  const shown = createSession(lesson1, { seed: 11 });
  shown.phase = "drive";
  shown.countdownAcc = 3;
  shown.sim.attention = "phone";
  shown.sim.phonePlayed = true;
  shown.sim.stowT = 0.3;
  const before = [shown.sim.attention, shown.sim.stowT, shown.sim.stats.attentionPokes, shown.sim.events.length];
  const phoneFrame = render(mockCtx().ctx, playState(shown, 0.5));
  assert.deepEqual([shown.sim.attention, shown.sim.stowT, shown.sim.stats.attentionPokes, shown.sim.events.length], before);
  assert.ok(phoneFrame.labels.some((label) => label.text === "Ткни в него · F"));
  assert.ok(phoneFrame.spots.some((spot) => spot.id === "anton"));
  assert.ok(phoneFrame.spots.some((spot) => spot.id === "pedal"));
  shown.sim.attention = "drowsy";
  assert.ok(render(mockCtx().ctx, playState(shown, 1)).labels.some((label) => label.text === "Разбуди · F"));
  shown.sim.attention = "asleep";
  assert.ok(render(mockCtx().ctx, playState(shown, 1)).labels.some((label) => label.text === "Разбуди · F"));
  shown.sim.attention = "earnest";
  const back = render(mockCtx().ctx, playState(shown, 1));
  assert.equal(back.labels.some((label) => label.text.includes("Ткни") || label.text.includes("Разбуди")), false);
  shown.sim.attention = "road";
  assert.equal(render(mockCtx().ctx, playState(shown, 1)).labels.some((label) => label.text.includes("Ткни")), false);
});

test("every family shares its hitbox ground, and nearer bodies paint in front", () => {
  const mission = {
    id: "anchors",
    seed: 3,
    cruise: 12,
    length: 400,
    cargo: null,
    slippery: [],
    hazards: [
      { id: "ped", type: "pedestrian", s: 30, x: 1.2, halfW: 0.42, halfL: 0.55 },
      { id: "dog", type: "dog", s: 36, x: -1.1, halfW: 0.55, halfL: 0.8 },
      { id: "bin", type: "bin", s: 44, x: 1.6, halfW: 0.55, halfL: 0.7 },
      { id: "lid", type: "roller", s: 52, x: -1.4, halfW: 0.55, halfL: 0.55 },
      { id: "park", type: "stopped", s: 64, x: 0.4, halfW: 0.95, halfL: 2.2 },
      { id: "cut", type: "cutin", s: 78, x: -0.6, halfW: 0.95, halfL: 2.15 },
      { id: "hole", type: "pothole", s: 90, x: 1.8, halfW: 0.72, halfL: 1.15 },
    ],
  };
  const sim = createSim(mission, 3);
  sim.prevS = 10;
  sim.s = 12;
  const at = (alpha) => placedScene(sim, alpha);
  const end = at(1);
  const start = at(0);
  const mid = at(0.5);
  for (const scene of [start, end]) {
    for (const actor of scene.actors) {
      const hazard = sim.hazards.find((item) => item.id === actor.id);
      const near = groundDs(hazard, scene.pose.s);
      const spot = project(near, actor.hx);
      assert.equal(actor.kind, anchorKind(hazard.type));
      assert.ok(Math.abs(actor.groundDs - near) < 1e-9);
      assert.ok(Math.abs(actor.farDs - farDs(hazard, scene.pose.s)) < 1e-9);
      assert.ok(Math.abs(actor.spot.x - spot.x) < 1e-6);
      assert.ok(Math.abs(actor.spot.y - spot.y) < 1e-6);
      const expectNear = hazard.s - hazard.halfL - scene.pose.s;
      assert.ok(Math.abs(near - expectNear) < 1e-9);
      const foot = screenFootprint(actor.groundDs, actor.farDs, actor.hx, hazard.halfW || 0.4);
      assert.ok(Math.abs(actor.spot.y - foot.near.y) < 1e-6);
      assert.ok(Math.abs(actor.farSpot.y - foot.far.y) < 1e-6);
      assert.ok(Math.abs(foot.length - Math.abs(foot.near.y - foot.far.y)) < 1e-6 || foot.length === 4);
      assert.equal(Math.sign(actor.spot.x - VIEW.vanishX), Math.sign(hazard.x) || 0);
    }
    assert.ok(Math.abs(scene.car.y - project(CFG.carHalfFront, scene.pose.x).y) < 1e-6);
  }
  for (const actor of mid.actors) {
    const a0 = start.actors.find((item) => item.id === actor.id);
    const a1 = end.actors.find((item) => item.id === actor.id);
    assert.ok(Math.abs(actor.groundDs - (a0.groundDs + a1.groundDs) / 2) < 1e-6, actor.id);
    assert.ok(Math.abs(actor.farDs - (a0.farDs + a1.farDs) / 2) < 1e-6, actor.id);
  }

  const order = paintFarToNear([
    { id: "ahead", ds: CFG.carHalfFront + 4, layer: 1 },
    { id: "car", ds: CFG.carHalfFront, layer: 0 },
    { id: "on", ds: CFG.carHalfFront, layer: 1 },
    { id: "inside", ds: CFG.carHalfFront - 1.2, layer: 1 },
    { id: "past", ds: -CFG.carHalfBack - 2, layer: 1 },
  ]).map((item) => item.id);
  assert.deepEqual(order, ["ahead", "car", "on", "inside", "past"]);

  sim.s = 20;
  const ped = sim.hazards.find((item) => item.id === "ped");
  const gap = bumperFootGap(sim, ped);
  assert.ok(gap.world > 0);
  const ahead = placedScene(sim, 1);
  assert.ok(ahead.actors.find((actor) => actor.id === "ped").spot.y < ahead.car.y);

  function crossing(lead, x) {
    const body = createSim({
      id: "cross",
      seed: 11,
      cruise: 12,
      length: 200,
      cargo: null,
      slippery: [],
      hazards: [{ id: "ped", type: "pedestrian", s: 0, x, halfW: 0.42, halfL: 0.55 }],
    }, 11);
    body.s = 40;
    body.x = 1.8;
    body.prevS = 40;
    const person = body.hazards[0];
    person.crossT = 0.45 * person.crossDur;
    person.s = body.s + CFG.carHalfFront + person.halfL + lead;
    person.x = x;
    return body;
  }
  const clear = crossing(1.2, 1.8);
  const clearView = placedScene(clear, 1);
  assert.ok(bumperFootGap(clear, clear.hazards[0]).world > 1);
  assert.ok(clearView.actors[0].spot.y < clearView.car.y);
  const touch = crossing(0, 1.8);
  const touchView = placedScene(touch, 1);
  assert.ok(Math.abs(bumperFootGap(touch, touch.hazards[0]).world) < 1e-9);
  assert.ok(Math.abs(touchView.actors[0].spot.y - touchView.car.y) < 0.05);
  const hit = crossing(-0.8, 1.8);
  const hitView = placedScene(hit, 1);
  assert.ok(bumperFootGap(hit, hit.hazards[0]).world < 0);
  assert.ok(hitView.actors[0].spot.y > hitView.car.y);
  const beside = placedScene(crossing(0, -1.6), 1);
  assert.ok(beside.actors[0].spot.x < VIEW.vanishX);
  assert.ok(beside.car.x > VIEW.vanishX);

  const session = createSession(mission, { seed: 3 });
  session.phase = "drive";
  session.sim.s = 12;
  const fingerprint = simFingerprint(session.sim);
  render(mockCtx().ctx, playState(session, 0.4));
  assert.equal(simFingerprint(session.sim), fingerprint);
});

test("the player chassis matches its hitbox, and people stay taller than their patch", () => {
  const sim = createSim({
    id: "fit",
    seed: 2,
    cruise: 12,
    length: 80,
    cargo: null,
    slippery: [],
    hazards: [{ id: "ped", type: "pedestrian", s: 30, x: 1.1, halfW: 0.42, halfL: 0.55 }],
  }, 2);
  sim.prevS = 10;
  sim.s = 14;
  sim.prevX = -0.4;
  sim.x = 1.2;
  for (const alpha of [0, 0.5, 1]) {
    const scene = placedScene(sim, alpha);
    const box = playerChassis(scene.pose.x);
    assert.ok(Math.abs(box.nose.x - project(CFG.carHalfFront, scene.pose.x).x) < 1e-6);
    assert.ok(Math.abs(box.nose.y - project(CFG.carHalfFront, scene.pose.x).y) < 1e-6);
    assert.ok(Math.abs(box.tail.y - project(-CFG.carHalfBack, scene.pose.x).y) < 1e-6);
    assert.ok(box.noseL.x < box.nose.x && box.nose.x < box.noseR.x);
    assert.ok(box.tail.y > box.nose.y);
    assert.ok(Math.abs(box.noseR.x - project(CFG.carHalfFront, scene.pose.x + CFG.carHalfW).x) < 1e-6);
    assert.ok(Math.abs(box.tailL.x - project(-CFG.carHalfBack, scene.pose.x - CFG.carHalfW).x) < 1e-6);
  }
  const mid = placedScene(sim, 0.5);
  const at0 = placedScene(sim, 0);
  const at1 = placedScene(sim, 1);
  assert.ok(Math.abs(mid.pose.x - (at0.pose.x + at1.pose.x) / 2) < 1e-9);

  const nose = project(CFG.carHalfFront, 0);
  const tail = project(-CFG.carHalfBack, 0);
  const lengthM = CFG.carHalfFront + CFG.carHalfBack;
  const centerDs = (CFG.carHalfFront - CFG.carHalfBack) / 2;
  const art = PLAN_ART.yellow;
  const metres = planMetresPerPixel(lengthM, art.artLen);
  assert.ok(Math.abs(planRowDs(centerDs, art.pivot - art.artLen / 2, art.pivot, lengthM, art.artLen) - CFG.carHalfFront) < 1e-9);
  assert.ok(Math.abs(planRowDs(centerDs, art.pivot + art.artLen / 2, art.pivot, lengthM, art.artLen) - (-CFG.carHalfBack)) < 1e-9);
  // Door line of the mask is about 400 px and meets the 1.7 m body.
  // The 462 px mask, mirrors included, is drawn in full.
  const doorHalf = (400 / 2) * metres;
  const mirrorHalf = (462 / 2) * metres;
  assert.ok(Math.abs(doorHalf - CFG.carHalfW) < 0.02, doorHalf);
  assert.ok(mirrorHalf - CFG.carHalfW > 0.08 && mirrorHalf - CFG.carHalfW < 0.16, mirrorHalf);
  const screenLen = tail.y - nose.y;
  const artW = (462 * metres * VIEW.focal) / ((nose.z + tail.z) / 2);
  const aspect = screenLen / artW;
  assert.ok(screenLen > 110 && screenLen < 220, screenLen);
  assert.ok(aspect > 1.6 && aspect < 1.9, aspect);
  // The blit band is 806 px of the 807×462 mask. One scale, so the
  // height/width does not change from the left curb to the right.
  const mask = art.artLen / 462;
  const drawn = [];
  for (const xm of [-2.4, 0, 2.4]) {
    const box = planBlitBox(centerDs, xm, lengthM, art.artLen, 1000, art.pivot);
    const full = box.h / (box.w * (462 / 1000));
    drawn.push(full);
    assert.ok(Math.abs(full - mask) < 1e-9, `${xm} ${full}`);
    assert.ok(Math.abs(box.w / box.h - 1000 / art.artLen) < 1e-9);
    assert.ok(Math.abs((box.y + box.h) - Math.max(box.noseY, box.tailY)) < 1e-6);
  }
  assert.ok(Math.abs(drawn[0] - drawn[1]) < 1e-12 && Math.abs(drawn[1] - drawn[2]) < 1e-12);
  const near = planBlitBox(8, 2.4, 4.4, PLAN_ART.coral.artLen, 1000, PLAN_ART.coral.pivot);
  const far = planBlitBox(30, -2.4, 4.4, PLAN_ART.coral.artLen, 1000, PLAN_ART.coral.pivot);
  assert.ok(Math.abs(near.h / near.w - far.h / far.w) < 1e-12);
  assert.ok(tail.y < VIEW.panel.y + VIEW.panel.h - 8, tail.y);
  const gap8 = project(CFG.carHalfFront, 0).y - project(CFG.carHalfFront + 8.4, 0).y;
  assert.ok(gap8 > 100, gap8);
  const coralM = planMetresPerPixel(4.4, PLAN_ART.coral.artLen);
  assert.ok(Math.abs(planRowDs(12, PLAN_ART.coral.pivot - PLAN_ART.coral.artLen / 2, PLAN_ART.coral.pivot, 4.4, PLAN_ART.coral.artLen) - (12 + 2.2)) < 1e-9);
  assert.ok(coralM > 0);
  const origin = carDrawOrigin(nose.x, nose.y, 0, 0);
  assert.ok(Math.abs(origin.y + CAR_NOSE_LOCAL_Y * CAR_SPRITE_SCALE - nose.y) < 1e-6);
  assert.ok(DOG_PAW_LOCAL_Y > 18);
  const sc = Math.max(0.62, Math.min(1.45, nose.scale * 1.55));
  const personPx = (PED_FOOT_LOCAL_Y + 62 + 26) * sc;
  const dogPx = (DOG_PAW_LOCAL_Y + 16 + 14) * sc;
  const personGround = nose.y - project(CFG.carHalfFront + 1.1, 0).y;
  const dogGround = nose.y - project(CFG.carHalfFront + 1.6, 0).y;
  // A metre of road is much taller now that the camera looks down.
  // The pictures stay upright on their feet; they are not stretched to the patch.
  assert.ok(personPx > personGround * 2, `${personPx} vs ${personGround}`);
  assert.ok(dogPx > dogGround, `${dogPx} vs ${dogGround}`);
  assert.equal(pedestrianFootShift(), -PED_FOOT_LOCAL_Y);
  const title = carDrawOrigin(nose.x, nose.y, 0, 0);
  assert.ok(Math.abs(title.y + CAR_NOSE_LOCAL_Y * CAR_SPRITE_SCALE - nose.y) < 1e-6);
});

test("the body stops on the curb, and scenery past it is not a hit", () => {
  const limit = bodyCenterLimit();
  assert.equal(VIEW.roadHalf, CFG.roadHalf);
  assert.ok(Math.abs(limit - (CFG.roadHalf - CFG.carHalfW)) < 1e-12);
  assert.ok(Math.abs(limit + CFG.carHalfW - CFG.roadHalf) < 1e-12);
  const mirrorHalf = (462 / 2) * (CFG.carHalfFront + CFG.carHalfBack) / PLAN_ART.yellow.artLen;
  assert.ok(mirrorHalf > CFG.carHalfW);
  assert.ok(mirrorHalf - CFG.carHalfW < 0.16);

  const mission = (hazards) => ({
    id: "edge",
    seed: 5,
    cruise: 12,
    length: 200,
    cargo: null,
    slippery: [],
    hazards,
  });
  function planted(x, hazards = []) {
    const sim = createSim(mission(hazards), 5);
    sim.x = x;
    sim.prevX = x;
    sim.v = 8;
    sim.s = 20;
    return sim;
  }

  for (const x of [6, -6, 3.35, -3.2]) {
    for (const held of [false, true]) {
      for (const step of [1 / 60, 1 / 30, 0.2]) {
        const sim = planted(x);
        stepSim(sim, step, { held, lockSpeed: true });
        assert.ok(Math.abs(sim.x) <= limit + 1e-9, `${x} ${step} -> ${sim.x}`);
        assert.ok(Math.abs(sim.x) + CFG.carHalfW <= CFG.roadHalf + 1e-9);
      }
    }
  }

  const back = planted(5);
  stepSim(back, 1 / 60, { held: true, lockSpeed: true });
  assert.ok(Math.abs(Math.abs(back.x) - limit) < 1e-9, back.x);
  for (let i = 0; i < 240; i++) stepSim(back, 1 / 60, { held: true, lockSpeed: true });
  assert.ok(Math.abs(back.x - CFG.defaultX) < 0.4, back.x);
  assert.ok(Math.abs(back.x) + CFG.carHalfW < CFG.roadHalf);

  function trace(seed, x0) {
    const sim = createSim(mission([]), seed);
    sim.x = x0;
    sim.v = 10;
    const xs = [];
    for (let i = 0; i < 30; i++) {
      stepSim(sim, i % 3 === 0 ? 1 / 30 : 1 / 60, { held: i % 2 === 0, lockSpeed: true });
      xs.push(Math.round(sim.x * 1e6) / 1e6);
    }
    return xs;
  }
  assert.deepEqual(trace(7, 5), trace(7, 5));
  assert.deepEqual(trace(11, -5), trace(11, -5));
  const fromRight = trace(7, 5);
  const fromLeft = trace(7, -5);
  assert.ok(fromRight[0] > 0 && fromRight.every((x) => Math.abs(x) <= limit + 1e-6));
  assert.ok(fromLeft[0] < 0 && fromLeft.every((x) => Math.abs(x) <= limit + 1e-6));

  const sidewalk = planted(limit, [{ id: "walker", type: "pedestrian", s: 48, x: 1.2, halfW: 0.42, halfL: 0.55 }]);
  sidewalk.v = 0;
  for (let i = 0; i < 20; i++) stepSim(sidewalk, 1 / 60, { held: true, lockSpeed: true });
  assert.equal(sidewalk.stats.collisions, 0);
  assert.ok(hazardWorldX(sidewalk.hazards[0], sidewalk) > CFG.roadHalf);

  const struck = planted(limit, [{ id: "hole", type: "pothole", s: 22, x: 3.55, halfW: 0.5, halfL: 0.8 }]);
  struck.v = 8;
  for (let i = 0; i < 8 && struck.stats.collisions === 0; i++) stepSim(struck, 1 / 60, { held: false, lockSpeed: true });
  assert.equal(struck.stats.collisions, 1);
  const other = planted(-limit, [{ id: "hole", type: "pothole", s: 22, x: -3.55, halfW: 0.5, halfL: 0.8 }]);
  other.v = 8;
  for (let i = 0; i < 8 && other.stats.collisions === 0; i++) stepSim(other, 1 / 60, { held: false, lockSpeed: true });
  assert.equal(other.stats.collisions, 1);

  const skim = planted(limit, [{ id: "hole", type: "pothole", s: 22, x: 4.1, halfW: 0.5, halfL: 0.8 }]);
  skim.v = 8;
  for (let i = 0; i < 40; i++) stepSim(skim, 1 / 60, { held: false, lockSpeed: true });
  assert.equal(skim.stats.collisions, 0);

  const moving = planted(limit, [{ id: "hole", type: "pothole", s: 21.2, x: 4.4, halfW: 0.5, halfL: 0.9 }]);
  moving.v = 0;
  stepSim(moving, 1 / 60, { held: true, lockSpeed: true });
  assert.equal(moving.stats.collisions, 0);
  moving.hazards[0].x = 3.5;
  stepSim(moving, 1 / 60, { held: true, lockSpeed: true });
  assert.equal(moving.stats.collisions, 1);

  const decor = planted(limit, [{
    id: "bush", type: "pothole", s: 21.2, x: 3.5, halfW: 0.5, halfL: 0.9, category: "decor",
  }]);
  decor.v = 6;
  for (let i = 0; i < 20; i++) stepSim(decor, 1 / 60, { held: false, lockSpeed: true });
  assert.equal(decor.stats.collisions, 0);
  assert.equal(isSolidHazard(decor.hazards[0]), false);
  assert.equal(isSolidHazard({ type: "bin", solid: false }), false);
  assert.equal(isSolidHazard({ type: "bin", kind: "prop" }), false);
  assert.equal(isSolidHazard({ type: "bin" }), true);

  const stop = planted(limit, [{ id: "hole", type: "pothole", s: 40, x: limit, halfW: 0.5, halfL: 0.8 }]);
  stop.v = 10;
  stop.s = 20;
  for (let i = 0; i < 400 && stop.v > 0.05 && stop.stats.collisions === 0; i++) stepSim(stop, 1 / 60, { held: true });
  assert.equal(stop.stats.collisions, 0, stop.stats.collisions);
  const hole = stop.hazards[0];
  const gap = hole.s - hole.halfL - (stop.s + CFG.carHalfFront);
  assert.ok(gap > 0.5, gap);
});

function boxesOverlap(a, b) {
  return a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
}

test("patience needle and pedal hinge follow the live input", () => {
  assert.equal(CFG.patienceStart, 15);
  assert.equal(CFG.irritationRate, 7.2);
  assert.equal(CFG.irritationDecel, 4.8);
  assert.equal(CFG.irritationBrake, 0.35);
  assert.equal(patienceNeedleDegrees(0), 180);
  assert.equal(patienceNeedleDegrees(15), 153);
  assert.equal(patienceNeedleDegrees(50), 90);
  assert.equal(patienceNeedleDegrees(100), 0);
  assert.ok(patienceNeedleDegrees(10) > patienceNeedleDegrees(70));
  assert.equal(patienceNeedleDegrees(-4), 180);
  assert.equal(patienceNeedleDegrees(140), 0);
  assert.equal(pedalHingeDegrees(0), 0);
  assert.equal(pedalHingeDegrees(0.5), 12);
  assert.equal(pedalHingeDegrees(1), 24);
  assert.equal(pedalHingeDegrees(2), 24);
  const released = pedalPadPoint(0);
  const half = pedalPadPoint(0.5);
  const pressed = pedalPadPoint(1);
  assert.equal(released.deg, 0);
  assert.equal(half.deg, 12);
  assert.equal(pressed.deg, 24);
  assert.ok(pressed.y < half.y && half.y < released.y, `${pressed.y} ${half.y} ${released.y}`);
  assert.equal(controlState("go", { over: "go", pressed: null }, {}), "hover");
  assert.equal(controlState("go", { over: "go", pressed: "go" }, {}), "pressed");
  assert.equal(controlState("mission-lesson2", {}, { disabled: true }), "disabled");
  assert.equal(controlState("mission-lesson1", { over: "sound" }, { selected: true }), "selected");

  const save = freshSave();
  const garage = render(mockCtx().ctx, {
    screen: "garage",
    session: null,
    save,
    now: 0,
    hint: false,
    debug: false,
    notice: null,
    preview: null,
    missions: LESSONS,
    selected: "lesson1",
    pose: null,
    alpha: 1,
    pointer: { over: null, pressed: null },
  });
  const names = garage.labels.map((item) => item.text);
  assert.ok(names.includes("ГАРАЖ"));
  assert.ok(names.includes("ВЫБЕРИ УРОК"));
  assert.ok(names.includes("УРОК 1"));
  assert.ok(names.includes("ПОЕХАЛИ"));
  assert.equal(names.includes("Антон газует сам."), false);
  assert.ok(garage.spots.some((spot) => spot.id === "mission-lesson1"));
  assert.equal(garage.spots.some((spot) => spot.id === "mission-lesson3"), false);
  assert.equal(garage.spots.some((spot) => spot.id === "mission-infinite"), false);
  for (let i = 0; i < garage.labels.length; i += 1) {
    for (let j = i + 1; j < garage.labels.length; j += 1) {
      assert.equal(boxesOverlap(garage.labels[i], garage.labels[j]), false, `${garage.labels[i].text}/${garage.labels[j].text}`);
    }
  }

  function ride(phase, patience, brake, success, rideSave = save) {
    const session = createSession(getMission("lesson1"), { seed: 11 });
    session.phase = phase;
    session.countdownAcc = 3;
    session.sim.patience = patience;
    session.sim.brakeInput = brake;
    if (phase === "result") {
      session.sim.done = true;
      session.sim.success = success;
      session.result = grade(session.sim);
      session.result.success = success;
    }
    return render(mockCtx().ctx, {
      screen: "play",
      session,
      save: rideSave,
      now: 0,
      hint: false,
      debug: false,
      notice: null,
      preview: null,
      missions: LESSONS,
      selected: "lesson1",
      pose: null,
      alpha: 1,
      pointer: { over: "resume", pressed: null },
    });
  }

  const calm = ride("drive", 15, 0, false);
  const hot = ride("drive", 90, 1, false);
  assert.ok(Math.abs(calm.readout.needleDeg - 153) < 1e-9);
  assert.ok(Math.abs(hot.readout.needleDeg - 18) < 1e-9);
  assert.ok(Math.hypot(calm.readout.tipX - hot.readout.tipX, calm.readout.tipY - hot.readout.tipY) > 40);
  assert.equal(calm.readout.pedalDeg, 0);
  assert.equal(hot.readout.pedalDeg, 24);
  assert.ok(hot.readout.padY < calm.readout.padY);
  assert.ok(calm.labels.some((item) => item.text === "ТЕРПЕНИЕ"));
  assert.ok(calm.spots.some((spot) => spot.id === "pedal"));
  assert.ok(calm.spots.some((spot) => spot.id === "anton"));

  const paused = ride("pause", 15, 0, false);
  assert.ok(paused.labels.some((item) => item.text === "ПАУЗА"));
  assert.ok(paused.labels.some((item) => item.text === "ПРОДОЛЖИТЬ"));
  assert.ok(paused.labels.some((item) => item.text === "ЗАНОВО"));
  assert.ok(paused.labels.some((item) => item.text === "В ГАРАЖ"));
  assert.ok(paused.spots.some((spot) => spot.id === "resume"));
  for (let i = 0; i < paused.labels.length; i += 1) {
    for (let j = i + 1; j < paused.labels.length; j += 1) {
      assert.equal(boxesOverlap(paused.labels[i], paused.labels[j]), false, `${paused.labels[i].text}/${paused.labels[j].text}`);
    }
  }

  const won = ride("result", 12, 0, true, applyVictory(freshSave(), "lesson1", 3));
  assert.ok(won.labels.some((item) => item.text === "ДОЕХАЛИ!"));
  assert.ok(won.labels.some((item) => item.text === "Машина цела"));
  assert.ok(won.labels.some((item) => item.text === "ДАЛЬШЕ"));
  assert.ok(won.spots.some((spot) => spot.id === "next"));
  const lost = ride("result", 80, 0, false);
  assert.ok(lost.labels.some((item) => item.text === "НЕ ДОЕХАЛИ"));
  assert.ok(lost.labels.some((item) => item.text === "ЗАНОВО"));
  assert.equal(lost.spots.some((spot) => spot.id === "next"), false);
  assert.ok(lost.spots.some((spot) => spot.id === "retry"));
  for (const frame of [won, lost]) {
    for (let i = 0; i < frame.labels.length; i += 1) {
      for (let j = i + 1; j < frame.labels.length; j += 1) {
        assert.equal(boxesOverlap(frame.labels[i], frame.labels[j]), false, `${frame.labels[i].text}/${frame.labels[j].text}`);
      }
    }
  }
});

test("the pedal stays inside the plate, and house bases stay off the asphalt", () => {
  const zone = PEDAL_ZONE;
  for (const deg of [0, 24]) {
    const ink = pedalArtRect(deg);
    assert.ok(ink.x >= zone.x + PEDAL_PAD - 0.5, `${deg} left ${ink.x}`);
    assert.ok(ink.y >= zone.y + PEDAL_PAD - 0.5, `${deg} top ${ink.y}`);
    assert.ok(ink.x + ink.w <= zone.x + zone.w - PEDAL_PAD + 0.5, `${deg} right ${ink.x + ink.w}`);
    assert.ok(ink.y + ink.h <= zone.y + zone.h - PEDAL_PAD + 0.5, `${deg} bottom ${ink.y + ink.h}`);
  }
  assert.ok(zone.x > VIEW.panel.x + VIEW.panel.w);
  assert.ok(zone.y + zone.h < 900);
  for (const [w, h] of [[1600, 900], [844, 390], [932, 430]]) {
    const box = letterboxRect(w, h);
    const left = box.left + zone.x * box.scale;
    const top = box.top + zone.y * box.scale;
    const right = box.left + (zone.x + zone.w) * box.scale;
    const bottom = box.top + (zone.y + zone.h) * box.scale;
    assert.ok(left >= -0.5 && top >= -0.5 && right <= w + 0.5 && bottom <= h + 0.5, `${w}x${h}`);
  }
  const anchor = sceneryAnchor();
  assert.ok(anchor - SCENERY_REACH >= VIEW.roadHalf + SCENERY_GAP - 1e-9);
  assert.ok(anchor - SCENERY_REACH > CFG.roadHalf);
});

test("letterbox keeps 16:9 and maps touches back into 1600×900", () => {
  const fit = letterboxRect(1280, 720);
  assert.equal(fit.left, 0);
  assert.equal(fit.top, 0);
  assert.ok(Math.abs(fit.width / fit.height - 16 / 9) < 1e-9);

  const odd = letterboxRect(1000, 800);
  assert.ok(odd.top > 0);
  assert.ok(Math.abs(odd.width / odd.height - 16 / 9) < 1e-9);
  const origin = logicalPoint(odd.left, odd.top, odd);
  const far = logicalPoint(odd.left + odd.width, odd.top + odd.height, odd);
  assert.ok(Math.abs(origin.x) < 1e-6 && Math.abs(origin.y) < 1e-6);
  assert.ok(Math.abs(far.x - 1600) < 1e-6 && Math.abs(far.y - 900) < 1e-6);
});
