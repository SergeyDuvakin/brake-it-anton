import { expect, test } from "@playwright/test";
import fs from "node:fs";

const shotPrefix = process.env.SHOT_PREFIX ? `${process.env.SHOT_PREFIX}-` : "";
const shot = (name) => `artifacts/${shotPrefix}${name}.png`;

function gameURL(search = "") {
  const base = process.env.BASE_URL || "http://127.0.0.1:4173/";
  const url = new URL(base.endsWith("/") ? base : `${base}/`);
  if (search) url.search = search;
  return url.toString();
}

async function clickId(page, id) {
  const point = await page.evaluate((target) => {
    const spot = window.__anton.hotspots().find((item) => item.id === target);
    if (!spot) return null;
    const canvas = document.querySelector("canvas");
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (spot.x + spot.w / 2) * (rect.width / 1600),
      y: rect.top + (spot.y + spot.h / 2) * (rect.height / 900),
    };
  }, id);
  expect(point, `hotspot ${id}`).toBeTruthy();
  await page.mouse.click(point.x, point.y);
}

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test.beforeAll(() => {
  fs.mkdirSync("artifacts", { recursive: true });
});

test("normal 1x: click start, brake, pause and resume without console errors", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(gameURL());
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await page.screenshot({ path: shot("title") });
  await clickId(page, "start");
  await page.waitForFunction(() => {
    const state = window.__anton.getState();
    return state.phase === "drive" && state.v > 4;
  });
  const calm = await page.evaluate(() => window.__anton.getState());
  expect(calm.patience).toBeLessThan(40);
  await page.screenshot({ path: shot("gameplay-calm") });

  const pedal = await page.evaluate(() => {
    const spot = window.__anton.hotspots().find((item) => item.id === "pedal");
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return {
      x: rect.left + (spot.x + spot.w / 2) * (rect.width / 1600),
      y: rect.top + (spot.y + spot.h / 2) * (rect.height / 900),
    };
  });
  const before = await page.evaluate(() => window.__anton.getState().v);
  await page.mouse.move(pedal.x, pedal.y);
  await page.mouse.down();
  await page.waitForFunction(() => window.__anton.getState().brake > 0.35);
  await page.waitForFunction((start) => window.__anton.getState().v < start - 1.5, before);
  await page.screenshot({ path: shot("gameplay-brake") });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__anton.getState().phase === "pause");
  const paused = await page.evaluate(() => window.__anton.getState());
  expect(paused.brake).toBe(0);
  expect(paused.held).toBe(false);
  expect(paused.pauseReason).toBe("escape");
  await page.screenshot({ path: shot("pause") });
  await clickId(page, "resume");
  await page.waitForFunction(() => window.__anton.getState().phase === "drive");
  const resumed = await page.evaluate(() => window.__anton.getState());
  expect(resumed.brake).toBe(0);
  expect(resumed.held).toBe(false);
  expect(errors).toEqual([]);
});

test("letterbox at 1280x720 and a mismatched landscape viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(gameURL());
  await page.waitForFunction(() => window.__anton?.hotspots().length > 0);
  const exact = await page.locator("canvas").boundingBox();
  expect(exact.width / exact.height).toBeCloseTo(16 / 9, 1);

  await page.setViewportSize({ width: 1100, height: 820 });
  await page.waitForTimeout(100);
  const odd = await page.locator("canvas").boundingBox();
  expect(odd.width / odd.height).toBeCloseTo(16 / 9, 1);
  expect(odd.width).toBeLessThan(1100.5);
  expect(odd.height).toBeLessThan(820);
  await page.screenshot({ path: shot("letterbox") });
});

test("portrait asks to rotate and does not show the playfield", async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 900 });
  await page.goto(gameURL());
  await expect(page.locator("#rotate")).toBeVisible();
  await expect(page.locator("#rotate")).toContainText("Поверни телефон");
  await expect(page.locator("#wrap")).toBeHidden();
  await page.screenshot({ path: shot("portrait") });
});

function boxesOverlap(a, b) {
  return a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
}

async function pedalPoint(page) {
  return page.evaluate(() => {
    const spot = window.__anton.hotspots().find((item) => item.id === "pedal");
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return {
      x: rect.left + (spot.x + spot.w / 2) * (rect.width / 1600),
      y: rect.top + (spot.y + spot.h / 2) * (rect.height / 900),
    };
  });
}

test("title and garage text is centered, present, and locked lessons are not starred", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(gameURL());
  await page.waitForFunction(() => window.__anton?.labels().some((item) => item.text === "Brake It, Anton"));
  const titleLabels = await page.evaluate(() => window.__anton.labels());
  expect(titleLabels.map((item) => item.text)).toEqual(
    expect.arrayContaining(["Brake It, Anton", "Он газует. Ты жмёшь тормоз.", "В урок", "Гараж"]),
  );
  assertLabels(titleLabels);
  await page.screenshot({ path: shot("title") });

  await clickId(page, "garage");
  await page.waitForFunction(() => window.__anton.labels().some((item) => item.text === "Антон газует сам."));
  const labels = await page.evaluate(() => window.__anton.labels());
  const texts = labels.map((item) => item.text);
  expect(texts).toContain("Гараж");
  expect(texts).toContain("Антон газует сам.");
  expect(texts.filter((text) => text === "Сначала пройди предыдущий урок").length).toBe(3);
  expect(texts.some((text) => text.includes("закрыт"))).toBe(false);
  expect(texts.some((text) => text.includes("★"))).toBe(false);
  expect(texts.every((text) => text.trim().length > 0)).toBe(true);
  assertLabels(labels);
  const spots = await page.evaluate(() => window.__anton.hotspots());
  expect(spots.find((item) => item.id === "mission-lesson1")).toBeTruthy();
  expect(spots.find((item) => item.id === "mission-lesson3")).toBeFalsy();
  expect(spots.find((item) => item.id === "mission-infinite")).toBeFalsy();
  for (const spot of spots) {
    expect(spot.w).toBeGreaterThanOrEqual(200);
    expect(spot.h).toBeGreaterThanOrEqual(72);
    expect(spot.x).toBeGreaterThanOrEqual(24);
    expect(spot.y).toBeGreaterThanOrEqual(24);
  }
  await page.screenshot({ path: shot("garage") });

  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(gameURL());
  await page.waitForFunction(() => window.__anton?.labels().some((item) => item.text === "Brake It, Anton"));
  await page.screenshot({ path: shot("title-844") });
  await clickId(page, "garage");
  await page.waitForFunction(() => window.__anton.labels().some((item) => item.text === "Антон газует сам."));
  const phoneLabels = await page.evaluate(() => window.__anton.labels());
  assertLabels(phoneLabels);
  await page.screenshot({ path: shot("garage-844") });
});

function assertLabels(labels) {
  for (const label of labels) {
    expect(label.text.trim().length).toBeGreaterThan(0);
    expect(label.cx).toBeCloseTo(label.x + label.w / 2, 0);
    expect(label.cy).toBeCloseTo(label.y + label.h / 2, 0);
    expect(label.x).toBeGreaterThanOrEqual(0);
    expect(label.y).toBeGreaterThanOrEqual(0);
    expect(label.x + label.w).toBeLessThanOrEqual(1600);
    expect(label.y + label.h).toBeLessThanOrEqual(900);
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      expect(boxesOverlap(labels[i], labels[j]), `${labels[i].text} / ${labels[j].text}`).toBe(false);
    }
  }
}

test("844×390 landscape keeps 16:9 and the start control inside the canvas", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(gameURL());
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  const box = await page.locator("canvas").boundingBox();
  expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
  expect(box.width).toBeLessThanOrEqual(844);
  expect(box.height).toBeLessThanOrEqual(390);
  const inside = await page.evaluate(() => {
    const spot = window.__anton.hotspots().find((item) => item.id === "start");
    const rect = document.querySelector("canvas").getBoundingClientRect();
    const x = rect.left + (spot.x + spot.w / 2) * (rect.width / 1600);
    const y = rect.top + (spot.y + spot.h / 2) * (rect.height / 900);
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });
  expect(inside).toBe(true);
});

test("keyboard space brakes and escape releases the pedal", async ({ page }) => {
  await page.goto(gameURL());
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__anton.getState().phase === "drive" && window.__anton.getState().v > 3);
  await page.keyboard.down("Space");
  await page.waitForFunction(() => window.__anton.getState().brake > 0.4);
  const before = await page.evaluate(() => window.__anton.getState().v);
  await page.waitForFunction((start) => window.__anton.getState().v < start - 1, before);
  await page.keyboard.up("Space");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__anton.getState().phase === "pause");
  const paused = await page.evaluate(() => window.__anton.getState());
  expect(paused.brake).toBe(0);
  expect(paused.held).toBe(false);
  expect(paused.pauseReason).toBe("escape");
});

test("real pedal: miss the pedestrian, retry, then stop and finish lesson 1", async ({ page }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await page.evaluate(() => window.__anton.setTimeScale(4));
  await clickId(page, "start");
  await page.waitForFunction(() => window.__anton.getState().phase === "drive" && window.__anton.getState().v > 2);
  await page.screenshot({ path: shot("early-drive") });
  await page.waitForFunction(() => {
    const state = window.__anton.getState();
    return state.phase === "result" && state.collisions >= 1;
  });
  const crashed = await page.evaluate(() => window.__anton.getState());
  expect(crashed.success).toBe(false);
  expect(crashed.fail).toBe("body");
  await page.screenshot({ path: shot("result-crash") });

  await clickId(page, "retry");
  const finished = await driveWithPedal(page, lessonBrake, {
    rescue: shot("pedestrian-rescue"),
    busy: shot("busy-hazard"),
    preen: shot("beat-preen"),
  });
  expect(finished.success).toBe(true);
  expect(finished.collisions).toBe(0);
  expect(finished.stars).toBeGreaterThan(0);
  await page.screenshot({ path: shot("result-success") });
  expect(errors).toEqual([]);
});

test("real pedal carries the cake past distinct hazards", async ({ page }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton?.hotspots().length >= 0);
  await page.evaluate(() => {
    window.__anton.setTimeScale(2);
    window.__anton.debugStart("lesson3");
  });
  const finished = await driveWithPedal(page, cakeBrake, { busy: shot("busy-cake") });
  expect(finished.success, JSON.stringify(finished)).toBe(true);
  expect(finished.collisions, JSON.stringify(finished)).toBe(0);
  expect(finished.cargoType).toBe("cake");
  expect(finished.stars).toBeGreaterThan(0);
  expect(finished.cargo, JSON.stringify(finished)).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});

function cakeBrake(state) {
  const hazard = state.hazard;
  if (!hazard || hazard.trust) return false;
  if (hazard.dist > 50 || hazard.dist < -1) return false;
  const holding = state.brake > 0.2;
  if (hazard.type === "pedestrian" || hazard.type === "cutin") {
    if (hazard.cross >= 3.2) return false;
    return holding ? state.v > 2.4 : state.v > 8;
  }
  if (hazard.type === "bin") return holding ? state.v > 7 : state.v > 11;
  return false;
}

function lessonBrake(state) {
  const hazard = state.hazard;
  if (!hazard || hazard.trust) return false;
  if (hazard.dist > 52 || hazard.dist < -1) return false;
  if (hazard.type === "pedestrian" || hazard.type === "cutin") {
    if (hazard.cross >= 3.2) return false;
    // Stay under the safe speed. A full press only hurts cargo while still fast.
    return state.v > 2.6;
  }
  if (hazard.type === "roller") return state.v > 6.2;
  if (hazard.type === "bin") return state.brake > 0.2 ? state.v > 7.2 : state.v > 10.4;
  return false;
}

async function driveWithPedal(page, decide, shots = {}) {
  await page.waitForFunction(() => {
    const phase = window.__anton.getState().phase;
    return phase === "drive" || phase === "countdown" || phase === "result";
  });
  await page.waitForFunction(() => window.__anton.getState().phase === "drive");
  const pedal = await pedalPoint(page);
  let down = false;
  let sawRescue = !shots.rescue;
  let sawBusy = !shots.busy;
  const started = Date.now();
  while (Date.now() - started < 90000) {
    const state = await page.evaluate(() => window.__anton.getState());
    if (state.phase === "result") {
      if (down) await page.mouse.up();
      expect(sawRescue).toBe(true);
      expect(sawBusy).toBe(true);
      return state;
    }
    if (
      !sawRescue &&
      state.phase === "drive" &&
      state.v < 0.9 &&
      state.collisions === 0 &&
      state.hazard?.type === "pedestrian" &&
      state.hazard.cross > 0.25 &&
      state.hazard.cross < 2.8
    ) {
      await page.screenshot({ path: shots.rescue });
      sawRescue = true;
    }
    if (
      !sawBusy &&
      state.phase === "drive" &&
      state.hazard &&
      !state.hazard.trust &&
      state.hazard.dist < 20 &&
      state.hazard.dist > 5 &&
      state.v > 2
    ) {
      await page.screenshot({ path: shots.busy });
      sawBusy = true;
    }
    if (shots.preen && state.pose === "preen" && state.hazard?.type === "roller") {
      await page.screenshot({ path: shots.preen });
      shots.preen = null;
    }
    const want = state.phase === "drive" && decide(state);
    if (want && !down) {
      await page.mouse.move(pedal.x, pedal.y);
      await page.mouse.down();
      down = true;
    } else if (!want && down) {
      await page.mouse.up();
      down = false;
    }
    await page.waitForTimeout(30);
  }
  throw new Error("pedal drive timed out");
}

test("e2e 6x: scripted careful lesson finishes and a panic cake trip fails", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await page.evaluate(() => window.__anton.setAutopilot("careful"));
  await clickId(page, "start");
  await page.waitForFunction(() => window.__anton.getState().phase === "result", null, { timeout: 45000 });
  const won = await page.evaluate(() => window.__anton.getState());
  expect(won.success).toBe(true);
  expect(won.stars).toBeGreaterThan(0);
  await page.screenshot({ path: shot("result-success") });

  await page.evaluate(() => {
    window.__anton.setAutopilot("panic");
    window.__anton.debugStart("lesson3");
  });
  await page.waitForFunction(() => window.__anton.getState().phase === "result", null, { timeout: 45000 });
  const lost = await page.evaluate(() => window.__anton.getState());
  expect(lost.success).toBe(false);
  expect(lost.fail).toBe("cargo");
  await page.screenshot({ path: shot("result-fail") });
  expect(errors).toEqual([]);
});
