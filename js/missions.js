/**
 * Hand-authored trips. One cargo per trip: lesson 3 is cake, lesson 4 is fish.
 * Distances are metres along a straight yard road. A trust hazard is one
 * Anton can take himself — braking in the decision window makes him lunge.
 *
 * The first hazard of every lesson sits inside the forward view, so the
 * opening is already a situation. Gaps stay long enough that two telegraphs
 * are not on screen as a single unavoidable stack.
 */

import { mulberry32 } from "./rng.js";

function H(partial) {
  return {
    telegraph: 72,
    decision: 58,
    commit: 40,
    halfW: 0.62,
    halfL: 1.35,
    clearAfter: 8,
    trust: false,
    x: 1.8,
    ...partial,
  };
}

export const LESSONS = [
  {
    id: "lesson1",
    seed: 11,
    lesson: 1,
    title: "Только не трогай",
    objective: "До двора",
    district: "Старый двор",
    cruise: 12.5,
    roll: 10,
    length: 360,
    cargo: null,
    slippery: [],
    blurb: ["Он газует. Ты жмёшь тормоз.", "Перед человеком — заранее."],
    gags: [],
    hazards: [
      H({ id: "ped", type: "pedestrian", s: 48, halfW: 0.42, halfL: 0.55, telegraph: 70 }),
      H({ id: "lid", type: "roller", s: 132, halfW: 0.55, halfL: 0.55, telegraph: 48 }),
      H({ id: "bin", type: "bin", s: 214, halfW: 0.55, halfL: 0.7, telegraph: 48 }),
    ],
  },
  {
    id: "lesson2",
    seed: 22,
    lesson: 2,
    title: "До двора",
    objective: "Выехать со двора",
    district: "Старый двор",
    cruise: 13,
    roll: 10,
    length: 430,
    cargo: null,
    slippery: [],
    blurb: ["Собака сама выберет дугу.", "Машину из двора — тормози."],
    gags: [],
    hazards: [
      H({ id: "ped", type: "pedestrian", s: 46, halfW: 0.42, halfL: 0.55, telegraph: 70 }),
      H({ id: "dog", type: "dog", s: 130, trust: true, halfW: 0.55, halfL: 0.8 }),
      H({ id: "cut", type: "cutin", s: 220, halfW: 0.95, halfL: 2.15, telegraph: 64 }),
      H({ id: "bin", type: "bin", s: 310, halfW: 0.55, halfL: 0.7 }),
    ],
  },
  {
    id: "lesson3",
    seed: 33,
    lesson: 3,
    title: "Торт едет",
    objective: "Довези торт",
    district: "Торговая улица",
    cruise: 12.8,
    roll: 10,
    length: 450,
    cargo: "cake",
    slippery: [],
    blurb: ["Жёсткий тормоз на скорости роняет крем.", "Яму пусть объедет сам."],
    gags: [],
    hazards: [
      H({ id: "hole", type: "pothole", s: 50, trust: true, halfW: 0.72, halfL: 1.15 }),
      H({ id: "ped", type: "pedestrian", s: 140, halfW: 0.42, halfL: 0.55, telegraph: 70 }),
      H({ id: "park", type: "stopped", s: 230, trust: true, halfW: 0.95, halfL: 2.2 }),
      H({ id: "bin", type: "bin", s: 320, halfW: 0.55, halfL: 0.7 }),
    ],
  },
  {
    id: "lesson4",
    seed: 44,
    lesson: 4,
    title: "Рыбка сказала поехали",
    objective: "Аквариум цел",
    district: "Мокрый край",
    cruise: 12.8,
    roll: 10,
    length: 460,
    cargo: "fish",
    slippery: [{ s0: 18, s1: 210 }],
    blurb: ["Мокро видно заранее.", "Рыбка считает рывок."],
    gags: [],
    hazards: [
      H({ id: "ped", type: "pedestrian", s: 50, halfW: 0.42, halfL: 0.55, telegraph: 78 }),
      H({
        id: "cut",
        type: "cutin",
        s: 148,
        halfW: 0.95,
        halfL: 2.15,
        telegraph: 80,
        decision: 64,
        commit: 44,
      }),
      H({ id: "dog", type: "dog", s: 240, trust: true, halfW: 0.55, halfL: 0.8 }),
      H({ id: "hole", type: "pothole", s: 330, trust: true, halfW: 0.72, halfL: 1.15 }),
    ],
  },
];

export function getLesson(id) {
  return LESSONS.find((m) => m.id === id) || null;
}

/**
 * Infinite yard. Density rises, then stops tightening so two hazards never
 * seal both lanes. Same seed rebuilds the same road.
 */
export function buildInfinite(seed = 1) {
  const rng = mulberry32(seed >>> 0);
  const types = ["pedestrian", "dog", "pothole", "stopped", "cutin", "bin"];
  const hazards = [];
  let s = 150;
  let last = "";
  let guard = 0;
  while (s < 9000 && guard < 70) {
    guard += 1;
    let type = types[Math.floor(rng() * types.length)];
    if (type === last) type = types[(types.indexOf(type) + 1) % types.length];
    last = type;
    const trust = type === "dog" || type === "pothole" || (type === "stopped" && rng() > 0.45);
    hazards.push(
      H({
        id: `inf-${guard}`,
        type,
        s: Math.round(s),
        trust,
        halfW: type === "cutin" || type === "stopped" ? 0.95 : type === "pothole" ? 0.72 : type === "bin" ? 0.55 : 0.48,
        halfL: type === "cutin" || type === "stopped" ? 2.15 : type === "pedestrian" ? 0.55 : 1.05,
        x: 1.8,
      }),
    );
    const tighten = Math.min(40, s / 140);
    const gap = Math.max(108, Math.round(168 - tighten + rng() * 24 - 8));
    s += gap;
  }
  return {
    id: "infinite",
    seed,
    lesson: 0,
    title: "Последний урок",
    objective: "Пока едет",
    district: "Весь двор",
    cruise: 16,
    length: 20000,
    cargo: null,
    infinite: true,
    slippery: [
      { s0: 900, s1: 1100 },
      { s0: 2400, s1: 2650 },
      { s0: 4200, s1: 4500 },
    ],
    blurb: ["Он всё злее жмёт газ.", "Финал — смета, не магазин."],
    gags: [],
    roll: 11,
    hazards,
  };
}

export function getMission(id, seed = 1) {
  if (id === "infinite") return buildInfinite(seed);
  return getLesson(id);
}
