/**
 * Tunable data for Brake It, Anton.
 *
 * Physics uses the brief's integrator:
 *   v += (throttle - drag * v - brake * a(v)) * dt
 * a(v) is the full-press brake term. At 100 km/h it is 8.5 m/s², and it
 * grows with speed. Net acceleration also includes throttle and drag.
 *
 * Patience numbers follow the task brief (start 15, +7.2 /s, …). The design
 * doc's earlier draft (start 10, +12 /s, −4 /s) is superseded by those
 * acceptance figures; see README. Justified braking in front of a real
 * hazard is discounted so a correct press is not punished like an empty road.
 */

export const CFG = {
  hz: 60,
  dt: 1 / 60,

  drag: 0.22,
  /** a(v) at standstill, m/s². Below the cargo harsh-threshold of 4. */
  brakeA0: 3.4,
  /** a(v) at 100 km/h. */
  brakeA100: 8.5,
  /** a(v) approached above 100 km/h. Design-doc harsh cap. */
  brakeAHarsh: 11,
  vRef: 100 / 3.6,

  brakePressTime: 0.12,
  brakeReleaseTime: 0.15,
  /** Anton waits this long after the player releases before he really gases. */
  resumeDelay: 0.2,
  slipMul: 0.55,

  patienceStart: 15,
  irritationRate: 7.2,
  irritationDecel: 4.8,
  irritationBrake: 0.35,
  holdExtraAfter: 2.2,
  holdExtraRate: 0.35,
  shortRelease: 0.65,
  shortReleaseRelief: 0.4,
  calmAfter: 2.5,
  calmMinSpeed: 5,
  calmRate: 0.5,
  /** Portion of the harsh rate applied when the brake is actually justified. */
  justifiedMul: 0.15,
  unnecessaryStopRate: 6,
  harshSpikeDecel: 8.5,
  harshSpike: 10,
  saveReward: 8,
  trustReward: 6,
  outburstReturn: 65,
  outburstTime: 1.8,
  outburstCooldown: 8,
  cooldownPatienceCap: 92,

  comfortLerp: 3.2,
  comfortRecover: 8,
  comfortDrop: 12,
  comfortLock: 0.85,

  cakeImpulse: 8,
  fishImpulse: 10,
  cakeSustain: 4,
  fishSustain: 6,
  cakeCollision: 30,
  fishCollision: 45,
  cargoDecel: 4,
  fullPress: 1,

  storySpeedCap: 22,
  infiniteSpeedCap: 96 / 3.6,

  carHalfW: 0.85,
  carHalfFront: 2.05,
  carHalfBack: 1.35,
  defaultX: 1.8,
  roadEdge: 3.35,

  weightsCargo: { body: 0.4, comfort: 0.35, mood: 0.25 },
  weightsPlain: { body: 0.5, comfort: 0.2, mood: 0.3 },
  starThresholds: { three: 80, two: 60, one: 35 },

  bodyPerMs: {
    pedestrian: 3.2,
    dog: 2.0,
    pothole: 1.5,
    bin: 2.4,
    stopped: 6.5,
    cutin: 6.0,
  },
};

/** Speed at or under which a yield-hazard is a comic clear instead of a hit. */
export const SAFE_SPEED = {
  pedestrian: 3.0,
  bin: 6.2,
  cutin: 3.6,
  stopped: 99,
  dog: 99,
  pothole: 99,
};

export const GEOMETRIC = new Set(["pothole", "dog", "stopped"]);

export const PALETTE = {
  INK: "#1C161E",
  PAPER: "#F6ECD6",
  ROAD: "#586078",
  SIDEWALK: "#DCD2BE",
  GRASS: "#A0C878",
  YEL: "#FAC83C",
  RED: "#E83428",
  TEAL: "#3CAAA0",
  PINK: "#F296A0",
  SKIN: "#F0BE8C",
  BLUE: "#5A8CDC",
  ORANGE: "#E68246",
  PAT_GREEN: "#8CBE5A",
  PAT_YELLOW: "#FAC83C",
  PAT_RED: "#E83428",
  CABIN: "#FAD778",
  GLASS: "#AADCEB",
  WHITE: "#FFF8EA",
  DARKRED: "#B4231C",
};

export const INVOICE = {
  bumper: 1400,
  mirror: 350,
  intervention: 800,
  honk: 90,
  nervesPerSec: 12,
};

export const SAVE_KEY = "brake-it-anton-save-v1";
