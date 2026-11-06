import test from "node:test";
import assert from "node:assert/strict";

import { CFG } from "../js/config.js";
import { letterboxRect, logicalPoint } from "../js/geom.js";
import { LESSONS, buildInfinite, getMission } from "../js/missions.js";
import {
  brakeAccel,
  expressionId,
  grade,
  irritationRate,
  netAccel,
  repairInvoice,
  steerParams,
} from "../js/physics.js";
import { policyCareful, policyNever, policyPanic, policyProvoke } from "../js/policies.js";
import { createSim, runSim, stepSim } from "../js/sim.js";
import {
  createSession,
  keyDown,
  onBlur,
  onVisibility,
  restartSession,
  resumeSession,
  sessionStep,
} from "../js/session.js";
import { applyVictory, freshSave, noteInfiniteDistance, parseSave } from "../js/storage.js";

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
      assert.ok(h.s - prev >= 130, `${lesson.id} gap ${h.s - prev}`);
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

test("countdown holds the car and replay restores the attempt", () => {
  const session = createSession(getMission("lesson1"), { seed: 11 });
  sessionStep(session, 2.4);
  assert.equal(session.phase, "countdown");
  assert.equal(session.sim.s, 0);
  assert.equal(session.sim.v, 0);
  sessionStep(session, 0.7);
  assert.equal(session.phase, "drive");
  sessionStep(session, 1.2);
  assert.ok(session.sim.s > 0);
  assert.ok(session.sim.v > 0);
  const progressed = session.sim.patience;
  restartSession(session);
  assert.equal(session.phase, "countdown");
  assert.equal(session.countdown, 3);
  assert.equal(session.sim.s, 0);
  assert.equal(session.sim.v, 0);
  assert.equal(session.sim.brakeInput, 0);
  assert.equal(session.sim.patience, CFG.patienceStart);
  assert.equal(session.sim.cargo, 100);
  assert.equal(session.sim.body, 100);
  assert.notEqual(progressed, session.sim.s);
  sessionStep(session, 1);
  assert.equal(session.sim.s, 0);
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
