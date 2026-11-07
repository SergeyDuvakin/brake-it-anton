import { grade } from "./physics.js";
import { createSim, snapRenderPose, stepSim } from "./sim.js";

/**
 * Countdown, pause and the single brake pointer live outside the integrator
 * so blur can zero the pedal without inventing a physics frame.
 */
export function createSession(mission, opts = {}) {
  const seed = opts.seed ?? mission.seed ?? 1;
  return {
    mission,
    seed,
    sim: createSim(mission, seed),
    phase: "countdown",
    countdown: 3,
    countdownAcc: 0,
    brakeHeld: false,
    pointerId: null,
    wakeId: null,
    tapQueued: false,
    keysDown: new Set(),
    pauseReason: null,
    result: null,
    recorded: false,
    /** Ignore a key-repeat of Space until it is released. Fresh presses still brake. */
    armBrake: false,
  };
}

export function clearControls(session) {
  session.brakeHeld = false;
  session.pointerId = null;
  session.wakeId = null;
  session.tapQueued = false;
  session.keysDown.clear();
  const sim = session.sim;
  if (!sim) return;
  sim.brakeInput = 0;
  sim.holdTime = 0;
  sim.pressTime = 0;
  sim.wasHeld = false;
  sim.fullPressLatched = false;
}

export function pauseSession(session, reason = "pause") {
  if (!session) return;
  if (session.phase !== "drive" && session.phase !== "countdown") return;
  session.phase = "pause";
  session.pauseReason = reason;
  session.armBrake = true;
  clearControls(session);
  snapRenderPose(session.sim);
}

export function resumeSession(session) {
  if (!session || session.phase !== "pause") return;
  session.pauseReason = null;
  session.phase = session.countdownAcc >= 3 ? "drive" : "countdown";
  clearControls(session);
  snapRenderPose(session.sim);
}

export function restartSession(session) {
  const next = createSession(session.mission, { seed: session.seed });
  session.sim = next.sim;
  // A retry is a new ride, not the opening tutorial. The 3-2-1 stays on
  // createSession only. countdownAcc is already finished so pause/resume
  // cannot drop the player back into that countdown.
  session.phase = "drive";
  session.countdown = 0;
  session.countdownAcc = 3;
  session.pauseReason = null;
  session.result = null;
  session.recorded = false;
  session.armBrake = true;
  clearControls(session);
  if (session.sim.v < 1) session.sim.v = session.mission.roll ?? 10;
  snapRenderPose(session.sim);
}

export function onBlur(session) {
  pauseSession(session, "blur");
}

/**
 * Pedal and Anton are different fingers. A tap does not press the brake,
 * and the brake does not wake him. Ending one pointer releases only that finger.
 */
export function pointerDown(session, id, pointerId) {
  if (!session || session.phase !== "drive") return "ignore";
  if (id === "pedal" && (session.pointerId === null || session.pointerId === undefined)) {
    session.pointerId = pointerId;
    session.brakeHeld = true;
    return "brake";
  }
  if (id === "anton" && (session.wakeId === null || session.wakeId === undefined)) {
    session.wakeId = pointerId;
    session.tapQueued = true;
    return "wake";
  }
  return "ignore";
}

export function releasePointer(session, pointerId) {
  if (!session) return;
  if (session.pointerId === pointerId) {
    session.pointerId = null;
    session.brakeHeld = false;
  }
  if (session.wakeId === pointerId) session.wakeId = null;
}

export function onVisibility(session, hidden) {
  if (hidden) pauseSession(session, "hidden");
}

export function keyDown(session, code, opts = {}) {
  if (!session) return;
  if (code === "Escape") {
    if (session.phase === "drive" || session.phase === "countdown") pauseSession(session, "escape");
    return;
  }
  if (code === "KeyF" && session.phase === "drive") {
    if (opts.repeat) return;
    session.tapQueued = true;
    return;
  }
  if (code === "Space" && session.phase === "drive") {
    if (opts.repeat && session.armBrake) return;
    session.armBrake = false;
    session.keysDown.add("Space");
  }
}

export function keyUp(session, code) {
  if (!session) return;
  if (code === "Space") session.armBrake = false;
  session.keysDown.delete(code);
}

export function sessionStep(session, dt) {
  if (!session || session.phase === "pause" || session.phase === "result") return;
  if (session.phase === "countdown") {
    session.countdownAcc += dt;
    if (session.countdownAcc >= 3) {
      session.phase = "drive";
      session.countdown = 0;
      if (session.sim.v < 1) session.sim.v = session.mission.roll ?? 10;
      snapRenderPose(session.sim);
      return;
    }
    session.countdown = Math.ceil(3 - session.countdownAcc);
    return;
  }
  const held = session.brakeHeld || session.keysDown.has("Space");
  const tap = session.tapQueued;
  session.tapQueued = false;
  stepSim(session.sim, dt, { held, tap });
  if (session.sim.done) {
    session.phase = "result";
    session.result = grade(session.sim);
    clearControls(session);
    snapRenderPose(session.sim);
  }
}
