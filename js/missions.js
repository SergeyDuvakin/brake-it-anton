/**
 * Hand-authored trips. One cargo per trip: lesson 3 is cake, lesson 4 is fish.
 * Distances are metres along the yard road. A trust hazard is one Anton can
 * take himself — braking there makes him lunge.
 */

import { mulberry32 } from "./rng.js";

function H(partial) {
  return {
    telegraph: 84,
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
    cruise: 13.5,
    length: 480,
    cargo: null,
    slippery: [],
    blurb: ["Он рулит. Ты только тормозишь.", "Коротко перед человеком — и отпусти."],
    hazards: [
      H({ id: "ped", type: "pedestrian", s: 230, halfW: 0.42, halfL: 0.5 }),
    ],
  },
  {
    id: "lesson2",
    seed: 22,
    lesson: 2,
    title: "До двора",
    objective: "Выехать со двора",
    district: "Старый двор",
    cruise: 14.5,
    length: 1120,
    cargo: null,
    slippery: [],
    blurb: ["Собаку он объедет сам.", "Тормози, только если сам не справится."],
    hazards: [
      H({ id: "ped", type: "pedestrian", s: 210, halfW: 0.42, halfL: 0.5 }),
      H({ id: "dog", type: "dog", s: 450, trust: true, halfW: 0.5, halfL: 0.75 }),
      H({ id: "bin", type: "bin", s: 700, halfW: 0.55, halfL: 0.7 }),
      H({ id: "cut", type: "cutin", s: 960, halfW: 0.9, halfL: 2.1, telegraph: 90 }),
    ],
  },
  {
    id: "lesson3",
    seed: 33,
    lesson: 3,
    title: "Торт едет",
    objective: "Довези торт",
    district: "Старый двор",
    cruise: 14.6,
    length: 1240,
    cargo: "cake",
    slippery: [],
    blurb: ["Полный тормоз на скорости портит крем.", "Яму пусть объедет сам."],
    hazards: [
      H({ id: "hole", type: "pothole", s: 250, trust: true, halfW: 0.7, halfL: 1.2 }),
      H({ id: "ped", type: "pedestrian", s: 520, halfW: 0.42, halfL: 0.5 }),
      H({ id: "park", type: "stopped", s: 800, trust: true, halfW: 0.9, halfL: 2.2 }),
      H({ id: "bin", type: "bin", s: 1060, halfW: 0.55, halfL: 0.7 }),
    ],
  },
  {
    id: "lesson4",
    seed: 44,
    lesson: 4,
    title: "Рыбка сказала поехали",
    objective: "Аквариум цел",
    district: "Старый двор",
    cruise: 15,
    length: 1420,
    cargo: "fish",
    slippery: [{ s0: 430, s1: 720 }],
    blurb: ["Впереди мокро — тормози раньше.", "Рыбка считает каждый рывок."],
    hazards: [
      H({
        id: "cut",
        type: "cutin",
        s: 580,
        halfW: 0.9,
        halfL: 2.1,
        telegraph: 120,
        decision: 90,
        commit: 52,
      }),
      H({ id: "dog", type: "dog", s: 860, trust: true, halfW: 0.5, halfL: 0.75 }),
      H({ id: "ped", type: "pedestrian", s: 1100, halfW: 0.42, halfL: 0.5 }),
      H({ id: "hole", type: "pothole", s: 1300, trust: true, halfW: 0.7, halfL: 1.2 }),
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
  let s = 180;
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
        halfW: type === "cutin" || type === "stopped" ? 0.9 : type === "pothole" ? 0.7 : 0.5,
        halfL: type === "cutin" || type === "stopped" ? 2.1 : 1.1,
        x: 1.8,
      }),
    );
    const tighten = Math.min(58, s / 90);
    const gap = Math.max(90, Math.round(148 - tighten + rng() * 28 - 10));
    s += gap;
  }
  return {
    id: "infinite",
    seed,
    lesson: 0,
    title: "Последний урок",
    objective: "Пока едет",
    district: "Старый двор",
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
    hazards,
  };
}

export function getMission(id, seed = 1) {
  if (id === "infinite") return buildInfinite(seed);
  return getLesson(id);
}
