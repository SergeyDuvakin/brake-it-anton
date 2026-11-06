/**
 * Browser shell. Physics stays in sim.js; this file only pumps frames,
 * maps touches through the letterbox, and keeps the pedal from sticking.
 */

import { createAudio } from "./audio.js";
import { SAVE_KEY } from "./config.js";
import { render } from "./draw.js";
import { logicalPoint, pointInRect } from "./geom.js";
import { LESSONS, getMission } from "./missions.js";
import { POLICIES } from "./policies.js";
import { createSim } from "./sim.js";
import {
  createSession,
  keyDown,
  keyUp,
  onBlur,
  onVisibility,
  pauseSession,
  restartSession,
  resumeSession,
  sessionStep,
} from "./session.js";
import { applyVictory, freshSave, noteInfiniteDistance, parseSave } from "./storage.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const params = new URLSearchParams(location.search);
const debug = params.has("debug") || params.has("e2e");
let timeScale = params.has("e2e") ? 6 : 1;

const audio = createAudio();
let save = loadSave();
let screen = "title";
let session = null;
let selected = "lesson1";
let hotspots = [];
let autopilot = null;
let hint = true;
let notice = save.notice;
let lastHits = 0;
let lastHonks = 0;
let wasDown = false;
let last = performance.now();
let acc = 0;

const preview = createSim(getMission("lesson1"), 11);
preview.s = 150;
preview.v = 8;
preview.patience = 15;

function loadSave() {
  try {
    const parsed = parseSave(localStorage.getItem(SAVE_KEY));
    if (!parsed.ok) {
      parsed.save.notice = "Сохранение не читается. Начали заново.";
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
  return !!lesson && lesson.lesson <= save.unlocked;
}

function startMission(id) {
  if (!canPlay(id)) return;
  const seed = id === "infinite" ? (Date.now() % 90000) + 1 : getMission(id).seed;
  const mission = getMission(id, seed);
  session = createSession(mission, { seed });
  screen = "play";
  hint = id === "lesson1";
  lastHits = 0;
  lastHonks = 0;
  wasDown = false;
  acc = 0;
  audio.unlock();
  if (save.settings.sound) audio.startRadio();
}

function settle() {
  if (!session || session.phase !== "result" || session.recorded) return;
  session.recorded = true;
  audio.stopRadio();
  if (session.mission.infinite) save = noteInfiniteDistance(save, session.sim.s);
  else if (session.result?.success) save = applyVictory(save, session.mission.id, session.result.stars);
  persist();
}

function toggle(which) {
  if (which === "sound") {
    save.settings.sound = !save.settings.sound;
    audio.setEnabled(save.settings.sound);
    if (save.settings.sound && screen === "play" && session?.phase === "drive") audio.startRadio();
    else audio.stopRadio();
  } else {
    save.settings.shake = !save.settings.shake;
    save.settings.reducedMotion = !save.settings.shake;
  }
  persist();
  audio.ui();
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
  if (id === "sound" || id === "shake") return toggle(id);
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
    if (save.settings.sound) audio.startRadio();
    audio.ui();
    return;
  }
  if (id === "retry" && session) {
    const mission = session.mission;
    restartSession(session);
    hint = mission.id === "lesson1";
    lastHits = 0;
    lastHonks = 0;
    if (save.settings.sound) audio.startRadio();
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
  if (session.phase !== "drive" && session.phase !== "countdown") audio.stopRadio();
  if (autopilot && debug && session.phase === "drive") {
    const policy = POLICIES[autopilot];
    if (policy) session.brakeHeld = !!policy(session.sim);
  }
  const before = session.phase;
  sessionStep(session, dt);
  if (!session) return;
  const sim = session.sim;
  const down = session.phase === "drive" && (session.brakeHeld || session.keysDown.has("Space"));
  if (down && !wasDown) audio.pedal(true);
  if (!down && wasDown) {
    audio.pedal(false);
    hint = false;
  }
  wasDown = down;
  audio.brakeAmount(sim.brakeInput, sim.v);
  if (sim.stats.collisions > lastHits) {
    lastHits = sim.stats.collisions;
    audio.crash();
  }
  if (sim.stats.honks > lastHonks) {
    lastHonks = sim.stats.honks;
    audio.honk();
  }
  audio.duck(!!sim.bubble);
  if (session.phase === "result" && before !== "result") settle();
}

function frame(now) {
  const raw = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += raw * timeScale;
  const cap = timeScale > 1 ? 48 : 8;
  let steps = 0;
  while (acc >= 1 / 60 && steps < cap) {
    acc -= 1 / 60;
    steps += 1;
    tick(1 / 60);
  }
  hotspots = render(ctx, {
    screen,
    session,
    save,
    now,
    hint,
    debug,
    notice,
    preview,
    missions: LESSONS,
    selected,
    pose: null,
  });
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

canvas.addEventListener("pointerdown", (event) => {
  if (document.body.classList.contains("is-portrait")) return;
  audio.unlock();
  const id = hit(eventPoint(event));
  if (id === "pedal" && session?.phase === "drive" && (session.pointerId === null || session.pointerId === undefined)) {
    session.pointerId = event.pointerId;
    session.brakeHeld = true;
    canvas.setPointerCapture?.(event.pointerId);
    return;
  }
  if (id && id !== "pedal") activate(id);
});

canvas.addEventListener("pointerup", (event) => releasePointer(event.pointerId));
canvas.addEventListener("pointercancel", (event) => releasePointer(event.pointerId));

function releasePointer(pointerId) {
  if (!session || session.pointerId !== pointerId) return;
  session.pointerId = null;
  session.brakeHeld = false;
}

window.addEventListener("keydown", (event) => {
  if (document.body.classList.contains("is-portrait")) return;
  audio.unlock();
  if (event.code === "Space") event.preventDefault();
  if (event.repeat && event.code !== "Space") return;
  if (!session) {
    if (event.code === "Enter" || event.code === "Space") activate(screen === "garage" ? "go" : "start");
    return;
  }
  keyDown(session, event.code);
  if (event.code === "KeyR" && session.phase === "result") activate("retry");
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

function syncOrient() {
  document.body.classList.toggle("is-portrait", window.innerHeight > window.innerWidth);
}

window.addEventListener("resize", syncOrient);
syncOrient();

window.__anton = {
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
    };
  },
  hotspots() {
    return hotspots.map((spot) => ({ id: spot.id, x: spot.x, y: spot.y, w: spot.w, h: spot.h }));
  },
  setAutopilot(name) {
    if (!debug) return;
    autopilot = name;
  },
  setTimeScale(value) {
    if (!debug) return;
    timeScale = value;
  },
  debugStart(id) {
    if (!debug) return;
    const mission = getMission(id, id === "infinite" ? 7 : undefined);
    if (!mission) return;
    session = createSession(mission, { seed: mission.seed || 7 });
    screen = "play";
    hint = false;
    lastHits = 0;
    lastHonks = 0;
    wasDown = false;
    acc = 0;
  },
};

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
  audio.setEnabled(save.settings.sound);
  requestAnimationFrame(frame);
}

boot();
