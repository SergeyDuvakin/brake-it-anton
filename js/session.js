import { IMPACT_CAUSES, IMPACT_TOTAL_MS, impactKind } from "./impact.js";
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
    swipeQueued: false,
    honkQueued: false,
    gesture: null,
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
  session.swipeQueued = false;
  session.honkQueued = false;
  session.gesture = null;
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
  session.impact = null;
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
export function pointerDown(session, id, pointerId, point) {
  if (!session || session.phase !== "drive") return "ignore";
  if (pointerId === null || pointerId === undefined) return "ignore";
  // One finger cannot own both targets. A second down from that finger,
  // or a drag from one control onto the other, does not move ownership.
  if (id === "pedal" && (session.pointerId === null || session.pointerId === undefined)) {
    if (session.wakeId === pointerId) return "ignore";
    session.pointerId = pointerId;
    session.brakeHeld = true;
    return "brake";
  }
  const touch = id === "anton" || id === "phone" || id === "wheel";
  if (touch && (session.wakeId === null || session.wakeId === undefined)) {
    if (session.pointerId === pointerId) return "ignore";
    session.wakeId = pointerId;
    session.gesture = {
      id,
      x: point?.x || 0,
      y: point?.y || 0,
      t: typeof performance !== "undefined" ? performance.now() : 0,
      swiped: false,
    };
    if (id === "anton") session.tapQueued = true;
    return "wake";
  }
  return "ignore";
}

export function pointerMove(session, point, pointerId) {
  const gesture = session?.gesture;
  if (!gesture || session.wakeId !== pointerId || gesture.id !== "phone" || gesture.swiped) return;
  const dx = (point?.x || 0) - gesture.x;
  const dy = (point?.y || 0) - gesture.y;
  const elapsed = (typeof performance !== "undefined" ? performance.now() : 0) - gesture.t;
  if (Math.abs(dx) >= 64 && Math.abs(dx) > 1.5 * Math.abs(dy) && elapsed <= 400) {
    gesture.swiped = true;
    session.swipeQueued = true;
  }
}

export function releasePointer(session, pointerId, fire = true) {
  if (!session) return;
  if (session.pointerId === pointerId) {
    session.pointerId = null;
    session.brakeHeld = false;
  }
  if (session.wakeId === pointerId) {
    const gesture = session.gesture;
    session.wakeId = null;
    session.gesture = null;
    if (!fire || !gesture || gesture.swiped || gesture.id === "anton") return;
    const elapsed = (typeof performance !== "undefined" ? performance.now() : 0) - gesture.t;
    if (gesture.id === "wheel") session.honkQueued = true;
    else if (gesture.id === "phone" && elapsed >= 600) session.swipeQueued = true;
    else session.tapQueued = true;
  }
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
  if (code === "KeyH" && session.phase === "drive") {
    if (opts.repeat) return;
    session.honkQueued = true;
    return;
  }
  if (code === "KeyG" && session.phase === "drive") {
    if (opts.repeat) return;
    session.swipeQueued = true;
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

function beginImpact(session) {
  const cause = session.sim.failCause;
  session.phase = "impact";
  session.impact = {
    kind: impactKind(cause),
    cause,
    ms: 0,
    hitX: session.sim.lastHit?.x ?? session.sim.x,
    hitColor: session.sim.lastHit?.color ?? null,
  };
  session.result = grade(session.sim);
  clearControls(session);
  snapRenderPose(session.sim);
}

export function sessionStep(session, dt) {
  if (!session || session.phase === "pause" || session.phase === "result") return;
  if (session.phase === "impact") {
    session.impact.ms += dt * 1000;
    if (session.impact.ms >= IMPACT_TOTAL_MS) session.phase = "result";
    return;
  }
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
  const swipe = session.swipeQueued;
  const honk = session.honkQueued;
  session.tapQueued = false;
  session.swipeQueued = false;
  session.honkQueued = false;
  stepSim(session.sim, dt, { held, tap, swipe, honk });
  if (session.sim.done) {
    const cause = session.sim.failCause;
    if (!session.sim.success && IMPACT_CAUSES.includes(cause)) beginImpact(session);
    else {
      session.phase = "result";
      session.result = grade(session.sim);
      clearControls(session);
      snapRenderPose(session.sim);
    }
  }
}
