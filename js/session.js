import { grade } from "./physics.js";
import { createSim, stepSim } from "./sim.js";

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
    keysDown: new Set(),
    pauseReason: null,
    result: null,
    recorded: false,
  };
}

export function clearControls(session) {
  session.brakeHeld = false;
  session.pointerId = null;
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
  clearControls(session);
}

export function resumeSession(session) {
  if (!session || session.phase !== "pause") return;
  session.pauseReason = null;
  session.phase = session.countdownAcc >= 3 ? "drive" : "countdown";
  clearControls(session);
}

export function restartSession(session) {
  const next = createSession(session.mission, { seed: session.seed });
  session.sim = next.sim;
  session.phase = "countdown";
  session.countdown = 3;
  session.countdownAcc = 0;
  session.pauseReason = null;
  session.result = null;
  session.recorded = false;
  clearControls(session);
}

export function onBlur(session) {
  pauseSession(session, "blur");
}

export function onVisibility(session, hidden) {
  if (hidden) pauseSession(session, "hidden");
}

export function keyDown(session, code) {
  if (!session) return;
  if (code === "Escape") {
    if (session.phase === "drive" || session.phase === "countdown") pauseSession(session, "escape");
    return;
  }
  if (code === "Space" && session.phase === "drive") session.keysDown.add("Space");
}

export function keyUp(session, code) {
  if (!session) return;
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
      return;
    }
    session.countdown = Math.ceil(3 - session.countdownAcc);
    return;
  }
  const held = session.brakeHeld || session.keysDown.has("Space");
  stepSim(session.sim, dt, { held });
  if (session.sim.done) {
    session.phase = "result";
    session.result = grade(session.sim);
    clearControls(session);
  }
}
