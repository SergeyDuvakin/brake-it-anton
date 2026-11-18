/**
 * Anton looks away: the car drifts, pokes take more than one tap,
 * a swipe drops the phone, and the horn is the player's.
 */

import { CFG } from "./config.js";
import { roadsideItems } from "./roadside.js";

const DRIFT_STATES = new Set(["phone", "drowsy", "asleep", "grope"]);

export function bootDistraction(sim) {
  sim.drift = { t: 0, dir: 0, holdT: 0, vLat: 0, active: false, fade: 0, recover: 0, offroad: false };
  sim.poke = { count: 0, lastT: -10 };
  sim.flinch = null;
  sim.flinchPrev = 0;
  sim.react = null;
  sim.phoneFinish = 0;
  sim.yawnT = 0;
  sim.dropT = 0;
  sim.gropeT = 0;
  sim.surfaceT = 0;
  sim.sorryT = 0;
  sim.phoneConfiscated = false;
  sim.honkCdT = 0;
  sim.honkFlashT = 0;
  sim.curbBumpT = 0;
  sim.curbSide = 0;
  sim.uselessAt = -10;
  sim.stats.playerHonks = 0;
  sim.stats.rudeHonks = 0;
  sim.stats.uselessPokes = 0;
}

export function driftState(sim) {
  if (sim.phoneFinish > 0 && sim.attention === "phone") return "phone";
  return DRIFT_STATES.has(sim.attention) ? sim.attention : null;
}

function sayIf(sim, text) {
  if (sim.outburstT > 0) return;
  if (typeof sim.say === "function") sim.say(text);
}

function setReact(sim, id, seconds) {
  sim.react = { id, until: sim.t + seconds };
}

function speedMul(sim) {
  return Math.max(0, Math.min(CFG.drift.refSpeed ? 1.2 : 1.2, sim.v / CFG.drift.refSpeed));
}

export function advanceDrift(sim, dt) {
  const state = driftState(sim);
  const drift = sim.drift;
  if (sim.react && sim.t >= sim.react.until) sim.react = null;
  if (sim.poke.count > 0 && sim.t - sim.poke.lastT >= CFG.poke.decay) {
    sim.poke.count = Math.max(0, sim.poke.count - 1);
    sim.poke.lastT = sim.t;
  }
  if (sim.phoneFinish > 0) {
    sim.phoneFinish = Math.max(0, sim.phoneFinish - dt);
    if (sim.phoneFinish === 0 && sim.attention === "phone") {
      sim.attention = "stow";
      sim.stowT = 0;
      sim.wokeFrom = "phone";
    }
  }
  if (sim.yawnT > 0) {
    sim.yawnT -= dt;
    if (sim.yawnT <= 0 && (sim.attention === "drowsy" || sim.attention === "asleep")) {
      sim.yawnT = 0;
      beginWake(sim);
    }
  }
  if (sim.attention === "drop") {
    sim.dropT += dt;
    if (sim.dropT >= CFG.swipe.drop) {
      sim.attention = "grope";
      sim.gropeT = 0;
      setReact(sim, "grope", CFG.swipe.grope);
      sayIf(sim, "ГДЕ ОН…");
    }
  } else if (sim.attention === "grope") {
    sim.gropeT += dt;
    if (sim.gropeT >= CFG.swipe.grope) beginSurface(sim, "НАШЁЛ!");
  } else if (sim.attention === "surface") {
    sim.surfaceT += dt;
    if (sim.surfaceT >= CFG.swipe.surface) {
      sim.attention = "earnest";
      sim.wokeFrom = "phone";
    }
  }
  if (sim.sorryT > 0) {
    sim.sorryT = Math.max(0, sim.sorryT - dt);
    if (sim.sorryT === 0 && sim.attention === "sorry") sim.attention = "earnest";
  }
  if (sim.honkCdT > 0) sim.honkCdT = Math.max(0, sim.honkCdT - dt);
  if (sim.honkFlashT > 0) sim.honkFlashT = Math.max(0, sim.honkFlashT - dt);
  if (sim.curbBumpT > 0) sim.curbBumpT = Math.max(0, sim.curbBumpT - dt);

  if (!state) {
    if (drift.active) {
      drift.fade = 0.25;
      drift.recover = CFG.drift.recoverDelay;
    }
    drift.active = false;
    drift.t = 0;
    if (drift.fade > 0) {
      drift.fade = Math.max(0, drift.fade - dt);
      drift.vLat *= Math.max(0, 1 - dt / 0.25);
    } else drift.vLat = 0;
    if (drift.recover > 0) drift.recover = Math.max(0, drift.recover - dt);
    return;
  }
  drift.t += dt;
  if (drift.t < CFG.drift.startDelay) {
    drift.vLat = 0;
    return;
  }
  if (!drift.active) {
    drift.active = true;
    drift.holdT = CFG.drift.holdMin + sim.rng() * (CFG.drift.holdMax - CFG.drift.holdMin);
    if (!drift.dir) drift.dir = sim.rng() < 0.5 ? -1 : 1;
  }
  const moving = drift.t - CFG.drift.startDelay;
  drift.holdT -= dt;
  if (drift.holdT <= 0) {
    drift.holdT = CFG.drift.holdMin + sim.rng() * (CFG.drift.holdMax - CFG.drift.holdMin);
    if (sim.rng() < CFG.drift.flipChance) drift.dir = -drift.dir;
  }
  const ramp = Math.min(1, CFG.drift.rampFrom + moving / CFG.drift.rampTime);
  const cap = CFG.drift.maxLat[state] || CFG.drift.maxLat.phone;
  drift.vLat = drift.dir * cap * ramp * speedMul(sim);
}

export function steerWithDrift(sim, dt, want, rate) {
  advanceDrift(sim, dt);
  const drift = sim.drift;
  let x = sim.x;
  const curb = CFG.drift.curbX;
  if (drift.active && drift.t >= CFG.drift.startDelay) x += drift.vLat * dt;
  else if (drift.fade > 0) x += drift.vLat * dt;
  else if (drift.recover > 0 && Math.abs(sim.x) > curb) {
    const step = Math.max(-CFG.drift.recoverRate * dt, Math.min(CFG.drift.recoverRate * dt, want - x));
    x += step;
  } else {
    x += Math.max(-rate * dt, Math.min(rate * dt, want - x));
  }
  if (sim.flinch) {
    const next = flinchMetres(sim.flinch.t + dt, sim.flinch.amp);
    x += (next - sim.flinchPrev) * sim.flinch.dir;
    sim.flinchPrev = next;
    sim.flinch.t += dt;
    if (sim.flinch.t >= CFG.flinch.up + CFG.flinch.hold + CFG.flinch.back) {
      sim.flinch = null;
      sim.flinchPrev = 0;
    }
  }
  const wide = drift.active || drift.offroad || !!sim.flinch;
  const lim = wide ? CFG.drift.maxOffset : CFG.roadHalf - CFG.carHalfW;
  const before = sim.x;
  sim.x = Math.max(-lim, Math.min(lim, x));
  noteCurb(sim, before, sim.x);
  if (!drift.active && Math.abs(sim.x) <= curb && drift.offroad) {
    drift.offroad = false;
    bumpCurb(sim);
    setReact(sim, "sorry", 1);
    sim.attention = sim.attention === "road" || sim.attention === "earnest" ? "sorry" : sim.attention;
    sim.sorryT = 1;
    sayIf(sim, "ВСЁ, ВСЁ, ЕДУ");
  }
}

function noteCurb(sim, before, after) {
  const curb = CFG.drift.curbX;
  const crossed = (Math.abs(before) < curb && Math.abs(after) >= curb)
    || (Math.abs(before) >= curb && Math.abs(after) < curb && sim.drift.offroad);
  if (!crossed) return;
  if (Math.abs(after) >= curb) sim.drift.offroad = true;
  bumpCurb(sim);
}

function bumpCurb(sim) {
  sim.curbBumpT = 0.2;
  sim.curbSide = Math.sign(sim.x) || sim.drift.dir || 1;
  sim.shake = Math.max(sim.shake, 4);
  sim.stats.curbBumps = (sim.stats.curbBumps || 0) + 1;
}

function flinchMetres(t, amp) {
  const up = CFG.flinch.up;
  const hold = CFG.flinch.hold;
  const back = CFG.flinch.back;
  if (t <= 0) return 0;
  if (t < up) return amp * (t / up);
  if (t < up + hold) return amp;
  if (t < up + hold + back) return amp * (1 - (t - up - hold) / back);
  return 0;
}

export function inDanger(sim, hazardDist, movingActor) {
  const windowM = 2.6 * Math.max(1, sim.cruise || 10);
  if (hazardDist !== null && hazardDist > 0 && hazardDist <= windowM) return true;
  return !!movingActor;
}

export function startFlinch(sim, amp, dir) {
  if (!amp) return;
  sim.flinch = { t: 0, dir: dir || (sim.rng() < 0.5 ? -1 : 1), amp };
  sim.flinchPrev = 0;
  sim.stats.squeals = (sim.stats.squeals || 0) + 1;
}

function blocked(sim) {
  return sim.attention === "stow"
    || sim.attention === "wake"
    || sim.attention === "sorry"
    || sim.attention === "drop"
    || sim.attention === "surface"
    || sim.phoneFinish > 0
    || sim.yawnT > 0
    || sim.outburstT > 0;
}

function beginWake(sim) {
  sim.attention = "wake";
  sim.wakeT = 0;
  sim.wokeFrom = "sleep";
  sim.poke.count = 0;
}

function beginSurface(sim, line) {
  sim.attention = "surface";
  sim.surfaceT = 0;
  sim.phoneConfiscated = true;
  sim.phonePlayed = true;
  setReact(sim, line === "НАШЁЛ!" ? "surface" : "surface-empty", CFG.swipe.surface);
  sayIf(sim, line);
}

export function registerPoke(sim, danger) {
  const result = { counted: false, done: false, useless: false, flinch: false };
  if (!sim || blocked(sim)) return result;
  if (sim.attention === "grope") {
    beginSurface(sim, "ЛАДНО, ПОТОМ…");
    result.counted = true;
    result.done = true;
    sim.stats.attentionPokes += 1;
    return result;
  }
  const need = CFG.poke.need[sim.attention];
  if (!need) {
    if (sim.attention === "road" || sim.attention === "earnest") {
      const repeat = sim.t - sim.uselessAt < CFG.poke.uselessWindow;
      const cost = repeat ? CFG.poke.uselessRepeat : CFG.poke.useless;
      sim.patience = Math.min(100, sim.patience + cost);
      sim.uselessAt = sim.t;
      sim.stats.uselessPokes += 1;
      setReact(sim, "grumble", 0.8);
      sim.bubbleGap = 0;
      sayIf(sim, repeat ? "ДА ЕДУ Я, ЕДУ!" : "ДА ЕДУ Я!");
      result.useless = true;
      if (danger?.hot) {
        startFlinch(sim, CFG.flinch.useless, danger.dir);
        setReact(sim, danger.dir < 0 ? "flinch-l" : "flinch-r", 0.35);
        sayIf(sim, "НЕ ПУГАЙ!");
        result.flinch = true;
      }
    }
    return result;
  }
  if (sim.t - sim.poke.lastT < CFG.poke.minGap) return result;
  sim.poke.count += 1;
  sim.poke.lastT = sim.t;
  sim.stats.attentionPokes += 1;
  result.counted = true;
  const n = sim.poke.count;
  if (sim.attention === "phone") {
    sim.phoneFinish = CFG.poke.phoneFinish;
    setReact(sim, "shchas", CFG.poke.phoneFinish);
    sayIf(sim, "ЩАС-ЩАС");
    result.done = true;
    if (danger?.hot) {
      startFlinch(sim, CFG.flinch.phone, danger.dir);
      result.flinch = true;
    }
    return result;
  }
  if (sim.attention === "drowsy") {
    if (n < need) {
      setReact(sim, "stir", 0.4);
      sayIf(sim, "М-М?");
      return result;
    }
    sim.yawnT = 0.5;
    setReact(sim, "yawn", 0.5);
    sayIf(sim, "А-А-АХ…");
    result.done = true;
    if (danger?.hot) {
      startFlinch(sim, CFG.flinch.drowsy, danger.dir);
      result.flinch = true;
    }
    return result;
  }
  if (sim.attention === "asleep") {
    if (n === 1) {
      setReact(sim, "stir", 0.4);
      sayIf(sim, "ХР… М?");
      return result;
    }
    if (n === 2) {
      setReact(sim, "yawn", 0.5);
      sayIf(sim, "А-А-АХ…");
      return result;
    }
    sim.sorryAfterWake = true;
    beginWake(sim);
    result.done = true;
    if (danger?.hot) {
      startFlinch(sim, CFG.flinch.asleep, danger.dir);
      setReact(sim, danger.dir < 0 ? "flinch-l" : "flinch-r", 0.35);
      sayIf(sim, "А?! ЧТО?!");
      result.flinch = true;
    }
  }
  return result;
}

/** The old name. One call follows the poke rules; it is not an instant wake. */
export function pokeAttention(sim) {
  const result = registerPoke(sim, null);
  return result.counted;
}

export function swipePhone(sim, danger) {
  if (!sim || sim.attention !== "phone" || sim.phoneConfiscated) return false;
  sim.attention = "drop";
  sim.dropT = 0;
  sim.phoneFinish = 0;
  sim.phonePlayed = true;
  setReact(sim, "drop", CFG.swipe.drop);
  sayIf(sim, "ЭЙ!");
  if (danger?.hot) startFlinch(sim, CFG.flinch.phone, danger.dir);
  sim.stats.thuds = (sim.stats.thuds || 0) + 1;
  return true;
}

export function playerHonk(sim, danger) {
  if (!sim) return false;
  if (sim.honkCdT > 0) return false;
  sim.honkCdT = CFG.honk.cooldown;
  sim.honkFlashT = 0.4;
  sim.stats.playerHonks += 1;
  sim.patience = Math.min(100, sim.patience + CFG.honk.cost);
  if (sim.stats.playerHonks === 1) {
    setReact(sim, "oy", 0.6);
    sayIf(sim, "ТЫ ЧЕГО СИГНАЛИШЬ?");
  }
  if (sim.attention === "drowsy" || sim.attention === "asleep") {
    const amp = sim.attention === "asleep" ? CFG.flinch.asleep : CFG.flinch.drowsy;
    sim.sorryAfterWake = true;
    beginWake(sim);
    if (danger?.hot) startFlinch(sim, amp, danger.dir);
  }
  return true;
}

export function strikeRoadside(sim, prevS) {
  if (sim.done) return null;
  const reach = 6;
  const boxes = roadsideItems(Math.min(prevS, sim.s) - reach, Math.max(prevS, sim.s) + reach);
  const x0 = sim.prevX ?? sim.x;
  const x1 = sim.x;
  for (const box of boxes) {
    if (!box.solid) continue;
    const along0 = prevS - box.s;
    const along1 = sim.s - box.s;
    const lat0 = x0 - box.x;
    const lat1 = x1 - box.x;
    const hitS = intervalsOverlap(along0, along1, -(box.halfL + CFG.carHalfFront), box.halfL + CFG.carHalfBack);
    const hitX = intervalsOverlap(lat0, lat1, -(box.halfW + CFG.carHalfW), box.halfW + CFG.carHalfW);
    if (hitS && hitX) return box;
  }
  return null;
}

function intervalsOverlap(a0, a1, lo, hi) {
  const loS = Math.min(a0, a1);
  const hiS = Math.max(a0, a1);
  return hiS > lo && loS < hi;
}

export function applyRoadside(sim, box) {
  const state = driftState(sim) || (sim.attention === "grope" ? "grope" : "phone");
  if (sim.v < CFG.drift.softHit) {
    sim.v = 0;
    sim.shake = Math.max(sim.shake, 2);
    sim.curbBumpT = 0.2;
    if (sim.attention === "phone" || sim.phoneFinish > 0) {
      sim.phoneFinish = 0;
      sim.attention = "stow";
      sim.stowT = 0;
    } else if (sim.attention === "drowsy" || sim.attention === "asleep" || sim.attention === "grope") {
      beginWake(sim);
    }
    return "tuk";
  }
  const cause = state === "asleep" || state === "drowsy" ? "drift-sleep" : state === "grope" ? "drift-grope" : "drift-phone";
  const flinchCause = sim.flinch ? "flinch" : cause;
  sim.stats.collisions += 1;
  sim.lastHit = {
    type: flinchCause,
    object: box.name,
    drift: state,
    t: sim.t,
    x: sim.x,
    s: sim.s,
  };
  return flinchCause;
}
