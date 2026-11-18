/**
 * Crash-scene timeline. Pure data: the renderer only draws what this returns.
 * Offsets are native pixels from the student car's top-left.
 */

export const IMPACT_TOTAL_MS = 1300;

export const IMPACT_CAUSES = [
  "pedestrian",
  "dog",
  "stopped",
  "cutin",
  "bin",
  "roller",
  "pothole",
  "drift-sleep",
  "drift-phone",
  "drift-grope",
  "flinch",
];

export const LOSS_SUBTITLE = {
  stopped: ["Поцеловали", "припаркованную", "машину."],
  cutin: ["Не пропустили", "выезжающую", "машину."],
  pedestrian: ["Пешеход цел,", "но очень зол.", "Тормози раньше."],
  dog: ["Пёс цел,", "но обиделся.", "Тормози раньше."],
  bin: ["Бак устоял.", "Машина — нет."],
  roller: ["Крышка люка", "победила."],
  pothole: ["Яма оказалась", "глубже."],
  timeout: ["Не успели."],
  "drift-sleep": ["Антон уснул", "за рулём."],
  "drift-phone": ["Антон засмотрелся", "в телефон."],
  "drift-grope": ["Антон искал телефон", "под ногами."],
  flinch: ["Антон дёрнулся.", "Буди заранее."],
};

const CAR_SHAKE = [[4, -4], [-4, 4], [4, 0], [-4, 0], [0, 4]];
const PED_HOP = [[14, -16, 1], [20, -22, 1], [26, -22, 1], [30, -16, 1], [32, -12, 3]];
const DOG_ARC = [[8, -20], [14, -25], [20, -27], [26, -25], [30, -20], [32, -15]];

export function impactKind(cause) {
  if (cause === "pedestrian") return "ped";
  if (cause === "dog") return "dog";
  return "car";
}

function frameAt(ms, origin, step, count, reduced) {
  if (reduced) return 0;
  const held = ms >= 900 ? 899 : ms;
  return Math.floor((held - origin) / step) % count;
}

function blinkOn(ms, reduced) {
  if (reduced) return true;
  return Math.floor(ms / 100) % 2 === 0;
}

function pedReact(ms, reduced) {
  const t = ms >= 900 ? 899 : ms;
  if (t < 33) return null;
  if (t < 100) return { frame: 0, dx: 8, dy: -18, alarm: { dx: 13, dy: -25 } };
  if (t < 150) return { frame: 1, dx: 8, dy: -27 };
  if (t < 200) return { frame: 1, dx: 8, dy: -25 };
  if (t < 233) return { frame: 1, dx: 8, dy: -16 };
  if (t < 333) return { frame: 2, dx: 8, dy: -9 };
  if (t < 733) {
    const frame = reduced ? 3 : (Math.floor((t - 333) / 100) % 2 === 0 ? 3 : 4);
    return {
      frame,
      dx: 8,
      dy: -9,
      anger: blinkOn(t, reduced) ? { dx: 20, dy: -8 } : null,
    };
  }
  const k = Math.min(PED_HOP.length - 1, Math.floor((t - 733) / 42));
  const step = PED_HOP[k];
  return { frame: step[2], dx: step[0], dy: step[1] };
}

function dogReact(ms, reduced) {
  const t = ms >= 900 ? 899 : ms;
  if (t < 33) return null;
  if (t < 100) return { frame: 0, dx: 4, dy: -14, alarm: { dx: 15, dy: -22 } };
  if (t < 400) {
    const i = Math.min(DOG_ARC.length - 1, Math.floor((t - 100) / 50));
    const step = DOG_ARC[i];
    return { frame: 1, dx: step[0], dy: step[1] };
  }
  const frame = reduced ? 2 : (Math.floor((t - 400) / 100) % 2 === 0 ? 2 : 0);
  return {
    frame,
    dx: 32,
    dy: -15,
    anger: blinkOn(t, reduced) ? { dx: 45, dy: -18 } : null,
  };
}

function fadeLevel(ms) {
  if (ms < 900) return 0;
  if (ms < 1000) return 2;
  if (ms < 1100) return 4;
  if (ms < 1200) return 6;
  return 8;
}

/**
 * @param {"car"|"ped"|"dog"} kind
 * @param {number} ms
 * @param {{ cause?: string, reducedMotion?: boolean, shake?: boolean, color?: string }} [opts]
 */
export function impactFrame(kind, ms, opts = {}) {
  const reduced = !!opts.reducedMotion;
  const allowShake = !reduced && opts.shake !== false;
  const cause = opts.cause || (kind === "ped" ? "pedestrian" : kind === "dog" ? "dog" : "stopped");
  const color = opts.color === "blue" ? "blue" : "pink";
  const card = ms >= IMPACT_TOTAL_MS;
  const pose = card
    ? "grumble"
    : ms < 33
      ? null
      : (Math.floor(ms / 100) % 2 ? "bams-1" : "bams-0");
  let flash = 0;
  if (!reduced) {
    if (ms < 16.7) flash = 0.78;
    else if (ms < 33) flash = 0.43;
  }
  let shake = [0, 0];
  if (allowShake) {
    if (kind === "car" && ms >= 33 && ms < 200) {
      const i = Math.min(CAR_SHAKE.length - 1, Math.floor((ms - 33) / 33));
      shake = CAR_SHAKE[i];
    } else if (kind !== "car" && ms >= 33 && ms < 100) {
      shake = ms < 66 ? [4, 0] : [-4, 0];
    }
  }
  const fx = [];
  let react = null;
  let carSprite = null;
  let npcSprite = null;
  if (ms >= 33) {
    carSprite = kind === "car" ? "car/learner-crash.png" : "car/learner-brake.png";
    if (kind === "car" && cause === "stopped") npcSprite = "car/npc-white-up-crash.png";
    else if (kind === "car" && cause === "cutin") npcSprite = "car/npc-blue-up-crash.png";
    if (kind === "car" && ms < 566) {
      fx.push({
        sheet: "fx/bams.png",
        frame: frameAt(ms, 33, 66, 2, reduced),
        fw: 96,
        fh: 46,
        dx: -96,
        dy: -38,
        clampX: 4,
      });
    }
    if (kind === "car" && ms >= 66) {
      fx.push({
        sheet: "fx/stars.png",
        frame: frameAt(ms, 66, 100, 3, reduced),
        fw: 30,
        fh: 14,
        dx: -4,
        dy: 0,
      });
    }
    if (kind === "car" && ms >= 100) {
      fx.push({
        sheet: "fx/steam.png",
        frame: frameAt(ms, 100, 150, 4, reduced),
        fw: 14,
        fh: 14,
        dx: 4,
        dy: -12,
      });
    }
    if (kind === "ped" && ms >= 100 && ms < 600) {
      fx.push({
        sheet: "fx/opa.png",
        frame: frameAt(ms, 100, 66, 2, reduced),
        fw: 64,
        fh: 32,
        dx: -56,
        dy: -34,
      });
    }
    if (kind === "dog" && ms >= 400 && ms < 850) {
      fx.push({
        sheet: "fx/gav.png",
        frame: frameAt(ms, 400, 66, 2, reduced),
        fw: 60,
        fh: 30,
        dx: 38,
        dy: -44,
      });
    }
    const body = kind === "ped" ? pedReact(ms, reduced) : kind === "dog" ? dogReact(ms, reduced) : null;
    if (body) {
      const sheet = kind === "ped"
        ? `world/sprites/ped-${color}-react.png`
        : "world/sprites/dog-react.png";
      react = {
        sheet,
        frame: body.frame,
        fw: kind === "ped" ? 12 : 16,
        fh: kind === "ped" ? 20 : 12,
        dx: body.dx,
        dy: body.dy,
      };
      if (body.alarm) {
        fx.push({ sheet: "fx/alarm.png", frame: 0, fw: 3, fh: 7, dx: body.alarm.dx, dy: body.alarm.dy });
      }
      if (body.anger) {
        fx.push({ sheet: "fx/anger.png", frame: 0, fw: 5, fh: 5, dx: body.anger.dx, dy: body.anger.dy });
      }
    }
  }
  return {
    flash,
    shake,
    pose,
    bubble: card ? "НУ ВОТ…" : (ms >= 33 ? "ОЙ!" : null),
    carSprite,
    npcSprite,
    fx,
    react,
    fadeLevel: fadeLevel(ms),
    card,
  };
}

/** Bounce, two-step shake and pothole dust while the drive continues. */
export function driveHitDecor(sim, opts = {}) {
  const none = { carDy: 0, shake: [0, 0], dust: [] };
  if (!sim?.lastHit || !(sim.crashT > 0)) return none;
  const ms = (0.24 - sim.crashT) * 1000;
  if (ms < 0) return none;
  const allowShake = !opts.reducedMotion && opts.shake !== false;
  const shake = allowShake && ms < 66 ? (ms < 33 ? [4, 0] : [-4, 0]) : [0, 0];
  const pothole = sim.lastHit.type === "pothole";
  const dust = [];
  if (pothole && ms < 200) {
    const frame = Math.min(1, Math.floor(ms / 100));
    dust.push({ frame, dx: -7, dy: -8 }, { frame, dx: 20, dy: -8 });
  }
  return {
    carDy: pothole && ms < 66 ? -1 : 0,
    shake,
    dust,
  };
}
