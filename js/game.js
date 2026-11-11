/**
 * Browser shell. Physics stays in sim.js; this file only pumps frames,
 * maps touches through the letterbox, and keeps the pedal from sticking.
 */

import { createAudio } from "./audio.js";
import { pulse } from "./haptics.js";
import { createReplay } from "./replay.js";
import { expressionId } from "./physics.js";
import { SAVE_KEY } from "./config.js";
import { whenCabinReady, cabinReady } from "./cabin.js";
import { bumperFootGap, render, whenCarsReady } from "./draw.js";
import { logicalPoint, pointInRect } from "./geom.js";
import { LESSONS, futureMissions, getMission } from "./missions.js";
import { POLICIES } from "./policies.js";
import { applyHazardSnap, createSim, hazardSnap, nextHazard, renderAlpha, renderPose, snapRenderPose } from "./sim.js";
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
} from "./session.js";
import { applyVictory, freshSave, noteInfiniteDistance, parseSave, toggleSetting } from "./storage.js";
import { drainFrame } from "./clock.js";
import { backingScale, clampPlacement, contentBox, stablePlacement, tightestBox } from "./viewport.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const params = new URLSearchParams(location.search);
const debug = params.has("debug") || params.has("e2e");
const showDebug = params.has("debug");
let timeScale = params.has("e2e") ? 6 : 1;

const audio = createAudio();
const moment = createReplay();
let replayHold = null;
let save = loadSave();
let screen = "title";
let session = null;
let selected = "lesson1";
let hotspots = [];
let labels = [];
let readout = { needleDeg: null, pedalDeg: null, hubX: null, hubY: null, tipX: null, tipY: null, padX: null, padY: null };
let uiPointer = { over: null, pressed: null };
let autopilot = null;
let hint = true;
let notice = save.notice;
let lastHits = 0;
let lastHonks = 0;
let lastClears = 0;
let lastNear = 0;
let wasDown = false;
let hardPulsed = false;
let lastBubble = "";
let lastBubbleT = 0;
let lastCargo = 100;
let last = performance.now();
let acc = 0;
let presentedAlpha = 1;

const preview = createSim(getMission("lesson1"), 11);
preview.s = 30;
preview.v = 11;
preview.patience = 8;
if (preview.hazards[0]) preview.hazards[0].crossT = 0.62;

function loadSave() {
  try {
    const parsed = parseSave(localStorage.getItem(SAVE_KEY));
    if (!parsed.ok) {
      parsed.save.notice = "Сохранение не читается. Начали заново с первого урока.";
      try {
        const repaired = { ...parsed.save, notice: null };
        localStorage.setItem(SAVE_KEY, JSON.stringify(repaired));
      } catch {
        /* the fresh profile still plays, even if it cannot be written */
      }
      return parsed.save;
    }
    if (parsed.empty && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      parsed.save.settings.shake = false;
      parsed.save.settings.reducedMotion = true;
    }
    return parsed.save;
  } catch {
    const blank = freshSave();
    blank.notice = "Сохранение недоступно. Игра идёт без записи.";
    return blank;
  }
}

function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* private mode or a full disk: the attempt still plays */
  }
}

function canPlay(id) {
  if (id === "infinite") return save.infinite === true;
  const lesson = getMission(id);
  if (lesson?.open) return true;
  return !!lesson && lesson.lesson <= save.unlocked;
}

function beginRide() {
  moment.reset();
  replayHold = null;
}

function showReplaySample(sim, sample) {
  sim.s = sample.s;
  sim.prevS = sample.s;
  sim.x = sample.x;
  sim.prevX = sample.x;
  sim.v = sample.v;
  sim.brakeInput = sample.brake;
  applyHazardSnap(sim.hazards, sample.hazards);
  snapRenderPose(sim);
}

function finishReplay() {
  moment.cancel();
  if (session && replayHold) showReplaySample(session.sim, replayHold);
  replayHold = null;
  if (session && session.phase === "replay") session.phase = "result";
}

function startMission(id) {
  if (!canPlay(id)) return;
  beginRide();
  const seed = id === "infinite" ? (Date.now() % 90000) + 1 : getMission(id).seed;
  const mission = getMission(id, seed);
  session = createSession(mission, { seed });
  screen = "play";
  hint = id === "lesson1";
  lastHits = 0;
  lastHonks = 0;
  lastClears = 0;
  lastNear = 0;
  wasDown = false;
  acc = 0;
  audio.unlock();
  if (save.settings.music) audio.startRadio();
}

function applyAudio() {
  audio.setEffects(save.settings.sound);
  audio.setMusic(save.settings.music);
  audio.setVoice(save.settings.voice);
}

function settle() {
  if (!session || session.phase !== "result" || session.recorded) return;
  session.recorded = true;
  audio.stopRadio();
  if (session.mission.infinite) save = noteInfiniteDistance(save, session.sim.s);
  else if (session.result?.success) save = applyVictory(save, session.mission.id, session.result.stars);
  audio.sting();
  persist();
}

function toggle(which) {
  save = toggleSetting(save, which);
  applyAudio();
  const driving = screen === "play" && session?.phase === "drive";
  if (save.settings.music && driving) audio.startRadio();
  else audio.stopRadio();
  persist();
  if (save.settings.sound) audio.ui();
}

function activate(id) {
  if (!id) return;
  notice = null;
  if (id === "start") return startMission("lesson1");
  if (id === "garage" || id === "to-garage") {
    audio.stopRadio();
    screen = "garage";
    session = null;
    audio.ui();
    return;
  }
  if (id === "sound" || id === "music" || id === "voice" || id === "vibrate" || id === "motion" || id === "shake" || id === "large") {
    return toggle(id);
  }
  if (id.startsWith("mission-")) {
    const missionId = id.slice("mission-".length);
    if (!canPlay(missionId)) return;
    selected = missionId;
    audio.ui();
    return;
  }
  if (id === "go") return startMission(selected);
  if (id === "pause") {
    pauseSession(session, "button");
    audio.stopRadio();
    audio.ui();
    return;
  }
  if (id === "resume") {
    resumeSession(session);
    if (save.settings.music) audio.startRadio();
    audio.ui();
    return;
  }
  if (id === "retry" && session) {
    const mission = session.mission;
    const pointerId = session.pointerId;
    beginRide();
    restartSession(session);
    if (pointerId !== null && pointerId !== undefined) {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch {
        /* the pointer already ended */
      }
    }
    hint = mission.id === "lesson1";
    lastHits = 0;
    lastHonks = 0;
    lastClears = 0;
    lastNear = 0;
    wasDown = false;
    acc = 0;
    last = performance.now();
    if (save.settings.music) audio.startRadio();
    audio.ui();
    return;
  }
  if (id === "moment" && session && moment.start()) {
    replayHold = {
      s: session.sim.s,
      x: session.sim.x,
      v: session.sim.v,
      brake: session.sim.brakeInput,
      hazards: hazardSnap(session.sim.hazards),
    };
    session.phase = "replay";
    audio.ui();
    return;
  }
  if (id === "next" && session) {
    const order = ["lesson1", "lesson2", "lesson3", "lesson4"];
    const idx = order.indexOf(session.mission.id);
    audio.ui();
    if (session.result?.success && idx >= 0 && idx < order.length - 1 && canPlay(order[idx + 1])) {
      return startMission(order[idx + 1]);
    }
    audio.stopRadio();
    screen = "garage";
    session = null;
  }
}

function tick(dt) {
  if (screen !== "play" || !session) return;
  if (session.phase === "replay") {
    const sample = moment.step();
    if (!sample) {
      finishReplay();
      return;
    }
    showReplaySample(session.sim, sample);
    return;
  }
  if (session.phase !== "drive" && session.phase !== "countdown") audio.stopRadio();
  if (autopilot && debug && session.phase === "drive") {
    const policy = POLICIES[autopilot];
    if (policy) session.brakeHeld = !!policy(session.sim);
    const attention = session.sim.attention;
    if (attention === "phone" || attention === "drowsy" || attention === "asleep") session.tapQueued = true;
  }
  const before = session.phase;
  sessionStep(session, dt);
  if (!session) return;
  const sim = session.sim;
  const down = session.phase === "drive" && (session.brakeHeld || session.keysDown.has("Space"));
  if (down && !wasDown) {
    audio.pedal(true);
    pulse("tap", save.settings.vibration);
  }
  if (!down) hardPulsed = false;
  else if (!hardPulsed && sim.brakeInput > 0.8 && sim.v > 8) {
    hardPulsed = true;
    pulse("hard", save.settings.vibration);
  }
  if (!down && wasDown) {
    audio.pedal(false);
    hint = false;
  }
  wasDown = down;
  if (sim.bubble && (sim.bubble !== lastBubble || sim.bubbleT > lastBubbleT + 0.2)) audio.voice(sim.bubble);
  lastBubble = sim.bubble || "";
  lastBubbleT = sim.bubbleT || 0;
  if (sim.cargo + 1 < lastCargo) audio.cargo(sim.cargoType);
  lastCargo = sim.cargo ?? lastCargo;
    if (session.phase === "drive") {
    moment.push({
      s: sim.s,
      x: sim.x,
      v: sim.v,
      brake: sim.brakeInput,
      hazards: hazardSnap(sim.hazards),
    });
  }
  audio.brakeAmount(sim.brakeInput, sim.v);
  if (sim.stats.collisions > lastHits) {
    lastHits = sim.stats.collisions;
    audio.crash();
  }
  if (sim.stats.honks > lastHonks) {
    lastHonks = sim.stats.honks;
    audio.honk();
  }
  if (sim.stats.clears > lastClears) {
    lastClears = sim.stats.clears;
    audio.pop();
  }
  if (sim.stats.nearMisses > lastNear) {
    lastNear = sim.stats.nearMisses;
    audio.near();
  }
  audio.duck(!!sim.bubble);
  if (session.phase === "result" && before !== "result") settle();
}

function frame(now) {
  const frameStart = performance.now();
  const nextMetric = pixelMetric(readMetric());
  if (metricChanged(nextMetric)) {
    metric = nextMetric;
    syncOrient();
    fitCanvas();
  }
  applyBuffer();
  const drained = drainFrame(acc, (now - last) / 1000, timeScale);
  last = now;
  acc = drained.acc;
  for (let step = 0; step < drained.steps; step += 1) tick(1 / 60);
  const driving = screen === "play" && session?.phase === "drive";
  presentedAlpha = driving ? renderAlpha(acc, 1 / 60) : 1;
  const drawn = render(ctx, {
    screen,
    session,
    save,
    now,
    hint,
    debug: showDebug,
    notice,
    preview,
    missions: LESSONS,
    futureTrips: futureMissions(),
    selected,
    pose: null,
    alpha: presentedAlpha,
    replayReady: moment.ready(),
    pointer: uiPointer,
  });
  hotspots = drawn.spots;
  labels = drawn.labels;
  readout = drawn.readout || readout;
  lastFrameMs = performance.now() - frameStart;
  requestAnimationFrame(frame);
}

function eventPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return logicalPoint(event.clientX, event.clientY, rect);
}

function hit(point) {
  for (let i = hotspots.length - 1; i >= 0; i--) {
    if (pointInRect(point, hotspots[i])) return hotspots[i].id;
  }
  return null;
}

function trackPointer(event) {
  uiPointer.over = hit(eventPoint(event));
}

function finishPress(event, fire) {
  releasePointer(session, event.pointerId);
  const pressed = uiPointer.pressed;
  uiPointer.pressed = null;
  if (!fire || !pressed) return;
  if (hit(eventPoint(event)) === pressed) activate(pressed);
}

canvas.addEventListener("pointermove", (event) => {
  if (document.body.classList.contains("is-portrait")) return;
  trackPointer(event);
});

canvas.addEventListener("pointerdown", (event) => {
  if (document.body.classList.contains("is-portrait")) return;
  if (session?.phase === "replay") {
    finishReplay();
    return;
  }
  audio.unlock();
  const id = hit(eventPoint(event));
  uiPointer.over = id;
  const action = pointerDown(session, id, event.pointerId);
  if (action === "brake" || action === "wake") {
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      /* A synthetic pointer has no capture target. The id is still tracked. */
    }
    return;
  }
  if (id && id !== "pedal" && id !== "anton") {
    uiPointer.pressed = id;
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      /* The click still resolves on pointerup. */
    }
  }
});

canvas.addEventListener("pointerup", (event) => finishPress(event, true));
canvas.addEventListener("pointercancel", (event) => finishPress(event, false));
canvas.addEventListener("lostpointercapture", (event) => finishPress(event, false));

window.addEventListener("keydown", (event) => {
  if (document.body.classList.contains("is-portrait")) return;
  if (session?.phase === "replay" && (event.code === "Escape" || event.code === "Space" || event.code === "Enter")) {
    event.preventDefault();
    finishReplay();
    return;
  }
  audio.unlock();
  if (event.code === "Space") event.preventDefault();
  if (event.repeat && event.code !== "Space") return;
  if (!session) {
    if (event.code === "Enter" || event.code === "Space") activate(screen === "garage" ? "go" : "start");
    return;
  }
  keyDown(session, event.code, { repeat: event.repeat });
  if (event.code === "KeyR" && (session.phase === "result" || session.phase === "pause")) activate("retry");
});

window.addEventListener("keyup", (event) => {
  if (session) keyUp(session, event.code);
});

window.addEventListener("blur", () => {
  if (session) onBlur(session);
});

document.addEventListener("visibilitychange", () => {
  if (session) onVisibility(session, document.hidden);
});

// Whole pixels only, so a fractional toolbar twitch does not refit every frame.
function pixelMetric(raw) {
  return {
    innerWidth: Math.round(raw.innerWidth),
    innerHeight: Math.round(raw.innerHeight),
    visualWidth: Math.round(raw.visualWidth),
    visualHeight: Math.round(raw.visualHeight),
    wrapWidth: Math.round(raw.wrapWidth),
    wrapHeight: Math.round(raw.wrapHeight),
  };
}

function readMetric() {
  const box = window.visualViewport;
  const wrap = document.getElementById("wrap");
  return {
    innerWidth: window.innerWidth || 0,
    innerHeight: window.innerHeight || 0,
    visualWidth: box?.width || 0,
    visualHeight: box?.height || 0,
    wrapWidth: wrap?.clientWidth || 0,
    wrapHeight: wrap?.clientHeight || 0,
  };
}

function metricChanged(next) {
  if (!metric) return true;
  return (
    next.innerWidth !== metric.innerWidth ||
    next.innerHeight !== metric.innerHeight ||
    next.visualWidth !== metric.visualWidth ||
    next.visualHeight !== metric.visualHeight ||
    next.wrapWidth !== metric.wrapWidth ||
    next.wrapHeight !== metric.wrapHeight
  );
}

function syncOrient() {
  const box = tightestBox(readMetric());
  const width = box.width || window.innerWidth || 0;
  const height = box.height || window.innerHeight || 0;
  document.body.classList.toggle("is-portrait", height > width);
}

let placement = null;
let painted = null;
let metric = null;
let bufferScale = 1;
let lastFrameMs = 0;
let refitTimers = [];

function applyBuffer() {
  const cssW = placement?.width || 1600;
  const cssH = placement?.height || 900;
  const low = !!save.settings.reducedMotion;
  // The drawing stays 1600×900. devicePixelRatio is not allowed to enlarge it,
  // and the scale we would grant a screen is capped at 2 (1 if motion is reduced).
  bufferScale = backingScale(cssW, cssH, window.devicePixelRatio, low);
  if (canvas.width !== 1600 || canvas.height !== 900) {
    canvas.width = 1600;
    canvas.height = 900;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function fitCanvas() {
  const wrap = document.getElementById("wrap");
  const measured = readMetric();
  let originX = 0;
  let originY = 0;
  let wrapW = 0;
  let wrapH = 0;
  if (wrap && measured.wrapWidth > 0 && measured.wrapHeight > 0) {
    const style = getComputedStyle(wrap);
    const pad = {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    };
    const inner = contentBox(measured.wrapWidth, measured.wrapHeight, pad);
    wrapW = inner.width;
    wrapH = inner.height;
    const rect = wrap.getBoundingClientRect();
    originX = rect.left + pad.left;
    originY = rect.top + pad.top;
  }
  const outer = tightestBox({
    innerWidth: measured.innerWidth,
    innerHeight: measured.innerHeight,
    visualWidth: measured.visualWidth,
    visualHeight: measured.visualHeight,
    wrapWidth: wrapW,
    wrapHeight: wrapH,
  });
  if (!(outer.width > 0) || !(outer.height > 0)) return;
  const visible = tightestBox({
    innerWidth: measured.innerWidth,
    innerHeight: measured.innerHeight,
    visualWidth: measured.visualWidth,
    visualHeight: measured.visualHeight,
  });
  const next = stablePlacement(placement, outer.width, outer.height);
  const css = clampPlacement(
    {
      left: originX + next.left,
      top: originY + next.top,
      width: next.width,
      height: next.height,
    },
    visible.width || outer.width,
    visible.height || outer.height,
  );
  placement = {
    width: css.width,
    height: css.height,
    left: css.left - Math.round(originX),
    top: css.top - Math.round(originY),
  };
  if (
    painted &&
    painted.left === css.left &&
    painted.top === css.top &&
    painted.width === css.width &&
    painted.height === css.height
  ) {
    return;
  }
  painted = css;
  canvas.style.position = "fixed";
  canvas.style.left = `${css.left}px`;
  canvas.style.top = `${css.top}px`;
  canvas.style.width = `${css.width}px`;
  canvas.style.height = `${css.height}px`;
  applyBuffer();
}

function refitSoon() {
  syncOrient();
  fitCanvas();
}

function scheduleRefit() {
  for (const id of refitTimers) clearTimeout(id);
  refitTimers = [];
  requestAnimationFrame(refitSoon);
  for (const ms of [100, 300, 600, 1000]) {
    refitTimers.push(setTimeout(refitSoon, ms));
  }
}

window.addEventListener("resize", refitSoon);
window.addEventListener("orientationchange", scheduleRefit);
window.screen?.orientation?.addEventListener("change", scheduleRefit);
window.visualViewport?.addEventListener("resize", refitSoon);
syncOrient();
fitCanvas();

window.__anton = {
  cabinReady,
  frameBudget: () => lastFrameMs,
  bufferScale: () => bufferScale,
  getState() {
    return {
      screen,
      phase: session?.phase ?? null,
      countdown: session?.countdown ?? null,
      s: session?.sim.s ?? 0,
      v: session?.sim.v ?? 0,
      brake: session?.sim.brakeInput ?? 0,
      held: !!(session && (session.brakeHeld || session.keysDown.has("Space"))),
      patience: session?.sim.patience ?? null,
      body: session?.sim.body ?? null,
      cargo: session?.sim.cargo ?? null,
      success: session?.result?.success ?? null,
      stars: session?.result?.stars ?? null,
      fail: session?.sim.failReason ?? null,
      unlocked: save.unlocked,
      infinite: save.infinite,
      pauseReason: session?.pauseReason ?? null,
      collisions: session?.sim.stats.collisions ?? 0,
      cargoType: session?.sim.cargoType ?? null,
      hazard: hazardState(),
      stopGap: gapState(),
      pose: session ? expressionId(session.sim) : expressionId(preview),
      cabinReady: cabinReady(),
      attention: session?.sim.attention ?? null,
      pokes: session?.sim.stats.attentionPokes ?? 0,
      brakePointer: session?.pointerId ?? null,
      wakePointer: session?.wakeId ?? null,
      needleDeg: readout.needleDeg,
      pedalDeg: readout.pedalDeg,
      hubX: readout.hubX,
      hubY: readout.hubY,
      tipX: readout.tipX,
      tipY: readout.tipY,
      padX: readout.padX,
      padY: readout.padY,
      pressed: uiPointer.pressed,
      over: uiPointer.over,
    };
  },
  hotspots() {
    return hotspots.map((spot) => ({ id: spot.id, x: spot.x, y: spot.y, w: spot.w, h: spot.h }));
  },
  frameBox() {
    const rect = canvas.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  },
  labels() {
    return labels.map((item) => ({ ...item }));
  },
  setAutopilot(name) {
    if (!debug) return;
    autopilot = name;
  },
  setTimeScale(value) {
    if (!debug) return;
    timeScale = value;
  },
  getTimeScale() {
    return timeScale;
  },
  getPresented() {
    if (!debug || !session) return null;
    const pose = renderPose(session.sim, presentedAlpha);
    return {
      alpha: presentedAlpha,
      phase: session.phase,
      s: session.sim.s,
      prevS: session.sim.prevS,
      x: session.sim.x,
      prevX: session.sim.prevX,
      poseS: pose.s,
      poseX: pose.x,
    };
  },
  debugPlace(pose = {}) {
    if (!debug || !session) return;
    const sim = session.sim;
    if (Number.isFinite(pose.x)) {
      sim.x = pose.x;
      sim.prevX = pose.x;
    }
    if (Number.isFinite(pose.s)) {
      sim.s = pose.s;
      sim.prevS = pose.s;
    }
    if (Number.isFinite(pose.brake)) sim.brakeInput = pose.brake;
    if (Number.isFinite(pose.crash)) sim.crashT = pose.crash;
    sim.v = 0;
  },
  setPatience(value) {
    if (!debug || !session) return;
    session.sim.patience = Math.max(0, Math.min(100, Number(value) || 0));
  },
  setBrakeInput(value) {
    if (!debug || !session) return;
    session.sim.brakeInput = Math.max(0, Math.min(1, Number(value) || 0));
  },
  debugHurt(body, hits) {
    if (!debug || !session) return;
    session.sim.body = Math.max(0, Math.min(100, Number(body) || 0));
    session.sim.stats.collisions = Math.max(0, Number(hits) || 0);
  },
  debugSeek(metres) {
    if (!debug || !session) return;
    const s = Math.max(0, Number(metres) || 0);
    session.sim.s = s;
    session.sim.prevS = s;
  },
  debugStart(id) {
    if (!debug) return;
    beginRide();
    const mission = getMission(id, id === "infinite" ? 7 : undefined);
    if (!mission) return;
    session = createSession(mission, { seed: mission.seed || 7 });
    screen = "play";
    hint = false;
    lastHits = 0;
    lastHonks = 0;
    lastClears = 0;
    lastNear = 0;
    wasDown = false;
    acc = 0;
  },
};

function hazardState() {
  if (!session) return null;
  const hazard = nextHazard(session.sim);
  if (!hazard) return null;
  return {
    id: hazard.id,
    type: hazard.type,
    dist: hazard.dist,
    trust: hazard.trust === true,
    cross: hazard.crossT,
  };
}

function gapState() {
  if (!session) return null;
  const ped = session.sim.hazards.find((hazard) => hazard.type === "pedestrian" && !hazard.resolved);
  if (!ped) return null;
  const gap = bumperFootGap(session.sim, ped);
  return { world: gap.world, screen: gap.screen };
}

async function boot() {
  try {
    const faces = [
      ["Balsamiq Sans", "BalsamiqSans-Bold.ttf", "700"],
      ["Balsamiq Sans", "BalsamiqSans-Regular.ttf", "400"],
      ["Rubik Mono One", "RubikMonoOne-Regular.ttf", "400"],
    ].map(([family, file, weight]) => new FontFace(family, `url(${new URL(`../assets/fonts/${file}`, import.meta.url)})`, { weight }));
    await Promise.all(faces.map((face) => face.load()));
    for (const face of faces) document.fonts.add(face);
  } catch (error) {
    console.warn("Font load failed, falling back to system faces.", error);
  }
  applyAudio();
  try {
    await whenCarsReady();
  } catch {
    /* A missing picture falls back to flat shapes. The ride still starts. */
  }
  try {
    await whenCabinReady();
  } catch {
    /* The cabin stays a flat panel until the approved stills load. */
  }
  requestAnimationFrame(frame);
}

boot();
