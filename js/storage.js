/**
 * localStorage schema v1.
 * A broken file becomes a fresh profile (lesson 1 only). It must not throw
 * and must not unlock the whole game.
 */

export function freshSave() {
  return {
    v: 1,
    unlocked: 1,
    infinite: false,
    best: {},
    bestMeters: {},
    settings: {
      sound: true,
      music: true,
      voice: true,
      vibration: true,
      shake: true,
      reducedMotion: false,
      largeUi: false,
    },
    notice: null,
  };
}

const LESSON_KEY = /^lesson[1-4]$/;

export function parseSave(raw) {
  const blank = () => ({ ok: false, save: freshSave(), reason: "malformed" });
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, save: freshSave(), empty: true };
  }
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { ...blank(), reason: "malformed" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return blank();
  if (data.v !== 1) return { ok: false, save: freshSave(), reason: "version" };
  if (typeof data.unlocked !== "number" || !Number.isInteger(data.unlocked)) {
    return { ok: false, save: freshSave(), reason: "unlocked" };
  }
  if (data.unlocked < 1 || data.unlocked > 4) {
    return { ok: false, save: freshSave(), reason: "unlocked" };
  }
  if (typeof data.infinite !== "boolean") {
    return { ok: false, save: freshSave(), reason: "infinite" };
  }
  const best = {};
  if (data.best && typeof data.best === "object" && !Array.isArray(data.best)) {
    for (const [key, val] of Object.entries(data.best)) {
      if (!LESSON_KEY.test(key)) continue;
      if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > 3) continue;
      best[key] = val;
    }
  }
  const bestMeters = {};
  const meters = data.bestMeters && data.bestMeters.infinite;
  if (typeof meters === "number" && Number.isFinite(meters) && meters >= 0 && meters < 1e7) {
    bestMeters.infinite = meters;
  }
  const settingsIn = data.settings && typeof data.settings === "object" && !Array.isArray(data.settings) ? data.settings : {};
  const legacySound = settingsIn.sound !== false;
  const settings = {
    sound: settingsIn.effects !== undefined ? settingsIn.effects !== false : legacySound,
    music: settingsIn.music === undefined ? legacySound : settingsIn.music !== false,
    voice: settingsIn.voice !== false,
    vibration: settingsIn.vibration !== false,
    shake: settingsIn.shake !== false,
    reducedMotion: settingsIn.reducedMotion === true,
    largeUi: settingsIn.largeUi === true,
  };
  return {
    ok: true,
    save: { v: 1, unlocked: data.unlocked, infinite: data.infinite, best, bestMeters, settings, notice: null },
  };
}

export function applyVictory(save, missionId, stars) {
  const next = structuredClone(save);
  const order = ["lesson1", "lesson2", "lesson3", "lesson4"];
  const idx = order.indexOf(missionId);
  if (idx >= 0) {
    next.unlocked = Math.max(next.unlocked, Math.min(4, idx + 2));
    if (missionId === "lesson1") next.infinite = true;
    const prev = next.best[missionId] || 0;
    next.best[missionId] = Math.max(prev, stars | 0);
  }
  return next;
}

const TOGGLE = {
  sound: "sound",
  music: "music",
  voice: "voice",
  vibrate: "vibration",
  motion: "reducedMotion",
  shake: "shake",
  large: "largeUi",
};

/** One accessibility switch. Shake and reduced motion are separate. */
export function toggleSetting(save, which) {
  const key = TOGGLE[which];
  const next = structuredClone(save);
  if (!key || !next.settings) return next;
  next.settings[key] = !next.settings[key];
  return next;
}

export function noteInfiniteDistance(save, meters) {
  const next = structuredClone(save);
  const prev = next.bestMeters.infinite || 0;
  if (meters > prev) next.bestMeters.infinite = Math.floor(meters);
  return next;
}
