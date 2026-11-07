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

test("844×390 and a Pixel landscape keep a stable 16:9 canvas when height jitters", async ({ page }) => {
  for (const size of [
    { width: 844, height: 390 },
    { width: 915, height: 412 },
    { width: 800, height: 360 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(gameURL());
    await page.waitForFunction(() => window.__anton?.frameBox);
    const first = await page.evaluate(() => window.__anton.frameBox());
    expect(Math.abs(first.width / first.height - 16 / 9)).toBeLessThan(0.03);
    expect(first.width).toBe(Math.floor(first.width));
    expect(first.height).toBe(Math.floor(first.height));
    for (const height of [size.height + 1, size.height - 1, size.height + 2, size.height]) {
      await page.setViewportSize({ width: size.width, height });
      await page.waitForTimeout(40);
    }
    const after = await page.evaluate(() => window.__anton.frameBox());
    expect(Math.abs(after.top - first.top)).toBeLessThan(1.5);
    expect(Math.abs(after.height - first.height)).toBeLessThan(1.5);
    expect(Math.abs(after.left - first.left)).toBeLessThan(1.5);
  }
});

test("an address-bar collapse settles, and a 1px flicker does not slide the canvas", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(gameURL());
  await page.waitForFunction(() => window.__anton?.frameBox);
  const open = await page.evaluate(() => window.__anton.frameBox());
  expect(open.height).toBeLessThanOrEqual(390);
  expect(Math.abs(open.width / open.height - 16 / 9)).toBeLessThan(0.03);

  await page.setViewportSize({ width: 844, height: 340 });
  await page.waitForTimeout(40);
  const bar = await page.evaluate(() => window.__anton.frameBox());
  expect(bar.height).toBeLessThanOrEqual(340);
  expect(bar.width).toBeLessThanOrEqual(844);
  expect(Math.abs(bar.width / bar.height - 16 / 9)).toBeLessThan(0.03);
  expect(bar.top).toBeGreaterThanOrEqual(-0.5);
  expect(bar.top + bar.height).toBeLessThanOrEqual(340.5);

  const samples = [];
  for (const height of [341, 340, 339, 340]) {
    await page.setViewportSize({ width: 844, height });
    await page.waitForTimeout(40);
    samples.push(await page.evaluate(() => window.__anton.frameBox()));
  }
  for (const sample of samples) {
    expect(Math.abs(sample.top - samples[0].top)).toBeLessThan(1.5);
    expect(Math.abs(sample.left - samples[0].left)).toBeLessThan(1.5);
    expect(sample.height).toBeLessThanOrEqual(341);
    expect(sample.top + sample.height).toBeLessThanOrEqual(341.5);
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(40);
  const back = await page.evaluate(() => window.__anton.frameBox());
  expect(back.height).toBeLessThanOrEqual(390);
  expect(back.height).toBeGreaterThan(bar.height);
  expect(Math.abs(back.width / back.height - 16 / 9)).toBeLessThan(0.03);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(40);
  await expect(page.locator("#rotate")).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(40);
  await expect(page.locator("#wrap")).toBeVisible();
  const landscape = await page.evaluate(() => window.__anton.frameBox());
  expect(landscape.height).toBeLessThanOrEqual(390);
  expect(Math.abs(landscape.width / landscape.height - 16 / 9)).toBeLessThan(0.03);
});

test("title scenery and wheels stay still while people may idle", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(gameURL());
  await page.waitForFunction(() => window.__anton?.labels().some((item) => item.text === "В урок"));
  const changed = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const regions = {
      buttons: { x: 1092, y: 640, w: 448, h: 204 },
      tree: { x: 140, y: 280, w: 240, h: 320 },
      wheel: { x: 640, y: 670, w: 140, h: 140 },
    };
    const read = (rect) => Uint8ClampedArray.from(ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data);
    const count = (a, b) => {
      let changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        const delta = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (delta > 24) changed += 1;
      }
      return changed;
    };
    let painted = read(regions.buttons);
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = read(regions.buttons);
      if (now[3] !== 0 && count(painted, now) === 0) break;
      painted = now;
    }
    const first = Object.fromEntries(Object.entries(regions).map(([key, rect]) => [key, read(rect)]));
    const worst = { buttons: 0, tree: 0, wheel: 0 };
    const start = performance.now();
    while (performance.now() - start < 450) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      for (const [key, rect] of Object.entries(regions)) {
        worst[key] = Math.max(worst[key], count(first[key], read(rect)));
      }
    }
    return worst;
  });
  expect(changed.buttons).toBe(0);
  expect(changed.tree).toBe(0);
  expect(changed.wheel).toBe(0);
});

test("safe-area padding keeps a 16:9 canvas inside the content box", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(gameURL());
  await page.waitForFunction(() => window.__anton?.frameBox);
  await page.evaluate(() => {
    document.getElementById("wrap").style.padding = "0px 47px 21px 47px";
    window.dispatchEvent(new Event("resize"));
  });
  const box = await page.evaluate(() => {
    const wrap = document.getElementById("wrap");
    const canvas = document.querySelector("canvas");
    const style = getComputedStyle(wrap);
    const pad = {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    };
    const wrapRect = wrap.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      content: {
        left: wrapRect.left + pad.left,
        top: wrapRect.top + pad.top,
        right: wrapRect.right - pad.right,
        bottom: wrapRect.bottom - pad.bottom,
      },
      canvas: {
        left: canvasRect.left,
        top: canvasRect.top,
        right: canvasRect.right,
        bottom: canvasRect.bottom,
        width: canvasRect.width,
        height: canvasRect.height,
      },
    };
  });
  expect(box.canvas.width / box.canvas.height).toBeCloseTo(16 / 9, 1);
  expect(box.canvas.left).toBeGreaterThanOrEqual(box.content.left - 0.5);
  expect(box.canvas.top).toBeGreaterThanOrEqual(box.content.top - 0.5);
  expect(box.canvas.right).toBeLessThanOrEqual(box.content.right + 0.5);
  expect(box.canvas.bottom).toBeLessThanOrEqual(box.content.bottom + 0.5);
});

test("losing pointer capture releases the pedal", async ({ page }) => {
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await clickId(page, "start");
  await page.waitForFunction(() => window.__anton.getState().phase === "drive");
  const pedal = await pedalPoint(page);
  await page.mouse.move(pedal.x, pedal.y);
  await page.mouse.down();
  await page.waitForFunction(() => window.__anton.getState().held);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1, bubbles: true }));
  });
  await page.waitForFunction(() => window.__anton.getState().held === false);
  await page.mouse.up();
});

test("pointercancel releases the pedal and a second finger cannot hold it", async ({ page }) => {
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await clickId(page, "start");
  await page.waitForFunction(() => window.__anton.getState().phase === "drive");
  const pedal = await pedalPoint(page);
  await page.mouse.move(pedal.x, pedal.y);
  await page.mouse.down();
  await page.waitForFunction(() => window.__anton.getState().held);
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 2, clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2, clientX: x, clientY: y, bubbles: true }));
  }, pedal);
  await page.waitForTimeout(40);
  expect(await page.evaluate(() => window.__anton.getState().held)).toBe(true);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));
  });
  await page.waitForFunction(() => window.__anton.getState().held === false);
  await page.mouse.up();
});

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

async function frozenShot(page, path) {
  const scale = await page.evaluate(() => window.__anton.getTimeScale());
  await page.evaluate(() => window.__anton.setTimeScale(0));
  await page.screenshot({ path });
  await page.evaluate((value) => window.__anton.setTimeScale(value), scale);
}

async function driveWithPedal(page, decide, shots = {}) {
  await page.waitForFunction(() => {
    const phase = window.__anton.getState().phase;
    return phase === "drive" || phase === "countdown" || phase === "result";
  });
  await page.waitForFunction(
    () => window.__anton.getState().phase === "drive" && window.__anton.hotspots().some((spot) => spot.id === "pedal"),
  );
  const pedal = await pedalPoint(page);
  let down = false;
  let sawTap = false;
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
    const needsTap = state.attention === "phone" || state.attention === "drowsy" || state.attention === "asleep";
    if (needsTap && !sawTap) {
      await page.evaluate(() => {
        const spot = window.__anton.hotspots().find((item) => item.id === "anton");
        const rect = document.querySelector("canvas").getBoundingClientRect();
        const x = rect.left + (spot.x + spot.w / 2) * (rect.width / 1600);
        const y = rect.top + (spot.y + spot.h / 2) * (rect.height / 900);
        const canvas = document.querySelector("canvas");
        canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, clientX: x, clientY: y, bubbles: true }));
        canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, clientX: x, clientY: y, bubbles: true }));
      });
      sawTap = true;
    }
    if (!needsTap) sawTap = false;
    const want = state.phase === "drive" && decide(state);
    if (want && !down) {
      await page.mouse.move(pedal.x, pedal.y);
      await page.mouse.down();
      down = true;
    } else if (!want && down) {
      await page.mouse.up();
      down = false;
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
      await frozenShot(page, shots.rescue);
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
      await frozenShot(page, shots.busy);
      sawBusy = true;
    }
    if (shots.preen && state.pose === "preen" && state.hazard?.type === "roller") {
      await frozenShot(page, shots.preen);
      shots.preen = null;
    }
    await page.waitForTimeout(30);
  }
  throw new Error("pedal drive timed out");
}

test("clicked retry, hotkey R and a stale space: the ride starts now", async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await page.evaluate(() => window.__anton.setTimeScale(1));
  await clickId(page, "start");
  await page.waitForFunction(() => window.__anton.getState().phase === "result", null, { timeout: 30000 });

  const retryCss = await page.evaluate(() => {
    const spot = window.__anton.hotspots().find((item) => item.id === "retry");
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return spot.h * (rect.height / 900);
  });
  expect(retryCss).toBeGreaterThanOrEqual(48);
  await page.keyboard.down("Space");
  await clickId(page, "retry");
  const clicked = await page.evaluate(() => window.__anton.getState());
  expect(clicked.phase).toBe("drive");
  expect(clicked.countdown).toBe(0);
  expect(clicked.v).toBeGreaterThan(5);
  expect(clicked.brake).toBe(0);
  expect(clicked.held).toBe(false);
  expect(clicked.collisions).toBe(0);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", repeat: true, bubbles: true }));
  });
  await page.screenshot({ path: shot("after-retry") });

  await page.waitForTimeout(300);
  const leaked = await page.evaluate(() => window.__anton.getState());
  expect(leaked.phase).toBe("drive");
  expect(leaked.countdown).toBe(0);
  expect(leaked.brake).toBe(0);
  expect(leaked.held).toBe(false);
  expect(leaked.s).toBeGreaterThan(0.4);

  await page.keyboard.up("Space");
  await page.keyboard.down("Space");
  await page.waitForFunction(() => window.__anton.getState().brake > 0.35);
  await page.keyboard.up("Space");

  await page.evaluate(() => window.__anton.setTimeScale(8));
  await page.waitForFunction(() => window.__anton.getState().phase === "result", null, { timeout: 20000 });
  await page.evaluate(() => window.__anton.setTimeScale(1));
  await page.keyboard.press("KeyR");
  const hotkey = await page.evaluate(() => window.__anton.getState());
  expect(hotkey.phase).toBe("drive");
  expect(hotkey.countdown).toBe(0);
  expect(hotkey.v).toBeGreaterThan(5);
  expect(hotkey.brake).toBe(0);
  expect(hotkey.held).toBe(false);
});

test("touch retry on 844×390 is immediate and the pedal is a real target", async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await page.evaluate(() => window.__anton.setTimeScale(8));
  await clickId(page, "start");
  await page.waitForFunction(() => window.__anton.getState().phase === "result", null, { timeout: 20000 });
  await page.evaluate(() => window.__anton.setTimeScale(1));
  const point = await page.evaluate(() => {
    const spot = window.__anton.hotspots().find((item) => item.id === "retry");
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return {
      x: rect.left + (spot.x + spot.w / 2) * (rect.width / 1600),
      y: rect.top + (spot.y + spot.h / 2) * (rect.height / 900),
      cssH: spot.h * (rect.height / 900),
      cssW: spot.w * (rect.width / 1600),
    };
  });
  expect(point.cssH).toBeGreaterThanOrEqual(48);
  expect(point.cssW).toBeGreaterThanOrEqual(72);
  await page.touchscreen.tap(point.x, point.y);
  const state = await page.evaluate(() => window.__anton.getState());
  expect(state.phase).toBe("drive");
  expect(state.countdown).toBe(0);
  expect(state.v).toBeGreaterThan(5);
  expect(state.brake).toBe(0);
  expect(state.held).toBe(false);
  const box = await page.locator("canvas").boundingBox();
  expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
  await page.screenshot({ path: shot("after-retry-844") });

  const touched = await page.evaluate(() => {
    const spot = window.__anton.hotspots().find((item) => item.id === "pedal");
    const canvas = document.querySelector("canvas");
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + (spot.x + spot.w / 2) * (rect.width / 1600);
    const y = rect.top + (spot.y + spot.h / 2) * (rect.height / 900);
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId: 8,
        pointerType: "touch",
        button: 0,
        isPrimary: true,
      }),
    );
    const down = window.__anton.getState();
    return { held: down.held, cssH: spot.h * (rect.height / 900) };
  });
  expect(touched.held).toBe(true);
  expect(touched.cssH).toBeGreaterThanOrEqual(48);
  await page.waitForFunction(() => window.__anton.getState().brake > 0.3);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 8, pointerType: "touch", button: 0 }),
    );
    window.dispatchEvent(new Event("blur"));
  });
  const blurred = await page.evaluate(() => window.__anton.getState());
  expect(blurred.phase).toBe("pause");
  expect(blurred.brake).toBe(0);
  expect(blurred.held).toBe(false);
  expect(blurred.pauseReason).toBe("blur");
  await context.close();
});

async function captureEarlyStop(page, file) {
  await page.goto(gameURL());
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await clickId(page, "start");
  await page.waitForFunction(() => window.__anton.getState().phase === "drive" && window.__anton.getState().v > 4);
  const opening = await page.evaluate(() => window.__anton.getState());
  expect(opening.countdown).toBe(0);
  const pedal = await pedalPoint(page);
  let down = false;
  const started = Date.now();
  let caught = null;
  while (Date.now() - started < 20000) {
    const state = await page.evaluate(() => window.__anton.getState());
    if (
      state.phase === "drive" &&
      state.v < 0.4 &&
      state.collisions === 0 &&
      state.hazard?.type === "pedestrian" &&
      state.hazard.cross > 0.45 &&
      state.hazard.cross < 2.2 &&
      state.stopGap
    ) {
      caught = state;
      await page.screenshot({ path: file });
      break;
    }
    const want =
      state.phase === "drive" &&
      state.hazard?.type === "pedestrian" &&
      state.hazard.dist < 40 &&
      state.hazard.cross < 3.2 &&
      state.v > 2.2;
    if (want && !down) {
      await page.mouse.move(pedal.x, pedal.y);
      await page.mouse.down();
      down = true;
    } else if (!want && down) {
      await page.mouse.up();
      down = false;
    }
    await page.waitForTimeout(40);
  }
  if (down) await page.mouse.up();
  expect(caught, "normal-speed stop was not reached").toBeTruthy();
  expect(caught.stopGap.world).toBeGreaterThan(2);
  expect(caught.stopGap.screen).toBeGreaterThan(48);
  expect(caught.collisions).toBe(0);
  const box = await page.locator("canvas").boundingBox();
  expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
}

test("normal speed: early brake leaves a visible gap on desktop and on 844×390", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await captureEarlyStop(page, shot("after-pedestrian-gap"));
  await page.setViewportSize({ width: 844, height: 390 });
  await captureEarlyStop(page, shot("after-pedestrian-gap-844"));
});

test("production draw interpolates the road between sim steps", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(gameURL("debug=1"));
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await clickId(page, "start");
  await page.waitForFunction(() => window.__anton.getState().phase === "drive" && window.__anton.getState().v > 4);
  // Half rate leaves a remainder between 1/60 steps, so the live frame pump
  // has to draw inside the step. A locked 60 Hz clock often lands on the endpoint.
  await page.evaluate(() => window.__anton.setTimeScale(0.5));
  const live = [];
  const started = Date.now();
  while (Date.now() - started < 700) {
    live.push(await page.evaluate(() => window.__anton.getPresented()));
    await page.waitForTimeout(16);
  }
  await page.evaluate(() => window.__anton.setTimeScale(1));
  const driving = live.filter((sample) => sample && sample.phase === "drive" && sample.s > sample.prevS + 1e-4);
  expect(driving.length).toBeGreaterThan(5);
  for (const sample of driving) {
    const lo = Math.min(sample.prevS, sample.s);
    const hi = Math.max(sample.prevS, sample.s);
    expect(sample.alpha).toBeGreaterThanOrEqual(0);
    expect(sample.alpha).toBeLessThanOrEqual(1);
    expect(sample.poseS).toBeGreaterThanOrEqual(lo - 1e-6);
    expect(sample.poseS).toBeLessThanOrEqual(hi + 1e-6);
  }
  const fractional = driving.filter((sample) => sample.alpha > 0.05 && sample.alpha < 0.95);
  expect(fractional.length).toBeGreaterThan(0);

  const drawn = await page.evaluate(async () => {
    const { render, placedScene } = await import("./js/draw.js");
    const { createSim, stepSim } = await import("./js/sim.js");
    const { getMission, LESSONS } = await import("./js/missions.js");
    const { freshSave } = await import("./js/storage.js");
    const mission = getMission("lesson1");
    const sim = createSim(mission, 11);
    for (let i = 0; i < 45; i += 1) stepSim(sim, 1 / 60, { held: false });
    const before = { s: sim.s, collisions: sim.stats.collisions, events: sim.events.length };
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const session = {
      sim,
      phase: "drive",
      mission,
      countdown: 0,
      keysDown: new Set(),
      brakeHeld: false,
      result: null,
    };
    const save = freshSave();
    const state = (alpha) => ({
      screen: "play",
      session,
      save,
      now: 1000,
      hint: false,
      debug: false,
      notice: null,
      preview: null,
      missions: LESSONS,
      selected: "lesson1",
      pose: null,
      alpha,
    });
    const images = {};
    const samples = {};
    let spots = null;
    for (const alpha of [0, 0.5, 1]) {
      const frame = render(ctx, state(alpha));
      const next = JSON.stringify(frame.spots);
      if (spots === null) spots = next;
      else if (spots !== next) spots = "moved";
      const data = ctx.getImageData(24, 200, 1010, 650).data;
      let hash = 0;
      for (let i = 0; i < data.length; i += 64) hash = (hash * 33 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) >>> 0;
      samples[alpha] = hash;
      images[String(alpha)] = canvas.toDataURL("image/png");
    }
    const scene = [0, 0.5, 1].map((alpha) => placedScene(sim, alpha));
    const ped = scene.map((item) => item.actors.find((actor) => actor.id === "ped"));
    return {
      before,
      after: { s: sim.s, collisions: sim.stats.collisions, events: sim.events.length },
      samples,
      spots,
      dist: ped.map((actor) => actor.dist),
      cam: scene.map((item) => item.pose.s),
      images,
    };
  });
  expect(drawn.after).toEqual(drawn.before);
  expect(drawn.spots).not.toBe("moved");
  expect(drawn.samples["0.5"]).not.toBe(drawn.samples["0"]);
  expect(drawn.samples["1"]).not.toBe(drawn.samples["0.5"]);
  expect(drawn.dist[1]).toBeCloseTo((drawn.dist[0] + drawn.dist[2]) / 2, 6);
  expect(drawn.cam[1]).toBeGreaterThan(drawn.cam[0]);
  expect(drawn.cam[1]).toBeLessThan(drawn.cam[2]);
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  for (const alpha of ["0", "0.5", "1"]) {
    const png = Buffer.from(drawn.images[alpha].split(",")[1], "base64");
    fs.writeFileSync(`/opt/cursor/artifacts/interp-alpha-${alpha}.png`, png);
  }
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const presented = window.__anton.getPresented();
    return presented
      && presented.phase === "pause"
      && presented.alpha === 1
      && presented.prevS === presented.s
      && presented.poseS === presented.s;
  });
  expect(errors).toEqual([]);
});

test("production draw walks people and dogs by distance", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(gameURL("debug=1"));
  await page.waitForFunction(() => window.__anton);
  const drawn = await page.evaluate(async () => {
    const { render, placedScene } = await import("./js/draw.js");
    const { createSim } = await import("./js/sim.js");
    const { gaitOffset } = await import("./js/gait.js");
    const { freshSave } = await import("./js/storage.js");
    const { LESSONS } = await import("./js/missions.js");
    await document.fonts.ready;
    const mission = {
      id: "walk",
      seed: 1,
      cruise: 12,
      length: 400,
      cargo: null,
      slippery: [],
      hazards: [
        { id: "ped", type: "pedestrian", s: 7.2, x: 0.2, halfW: 0.42, halfL: 0.55 },
        { id: "dog", type: "dog", s: 24, x: -1.4, halfW: 0.35, halfL: 0.45 },
      ],
    };
    const save = freshSave();
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    function paint(sim, now) {
      const session = {
        sim,
        phase: "drive",
        mission,
        countdown: 0,
        keysDown: new Set(),
        brakeHeld: false,
        result: null,
      };
      const before = sim.events.length;
      render(ctx, {
        screen: "play",
        session,
        save,
        now,
        hint: false,
        debug: false,
        notice: null,
        preview: null,
        missions: LESSONS,
        selected: "walk",
        pose: null,
        alpha: 1,
      });
      return before === sim.events.length && sim.stats.collisions === 0;
    }
    function hash(rect) {
      const data = ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data;
      let value = 0;
      for (let i = 0; i < data.length; i += 16) value = (value * 33 + data[i] + data[i + 1] * 3) >>> 0;
      return value;
    }
    function body(sim, id) {
      const actor = placedScene(sim, 1).actors.find((item) => item.id === id);
      const size = 150;
      return {
        travel: actor.travel,
        step: gaitOffset(actor.travel, id === "dog" ? "dog" : "pedestrian", false),
        x: Math.max(0, Math.min(1600 - size, Math.round(actor.spot.x - size / 2))),
        y: Math.max(0, Math.min(900 - size, Math.round(actor.spot.y - size * 0.85))),
        w: size,
        h: size,
      };
    }
    const standing = createSim(mission, 1);
    standing.v = 0;
    const cleanA = paint(standing, 0);
    const road = { x: 80, y: 360, w: 900, h: 480 };
    paint(standing, 0);
    const standHash = hash(road);
    const cleanB = paint(standing, 110);
    const standAgain = hash(road);

    function posePed(u) {
      const sim = createSim(mission, 1);
      sim.v = 0;
      const ped = sim.hazards.find((h) => h.id === "ped");
      ped.crossT = u * ped.crossDur;
      return sim;
    }
    function poseDog(s) {
      const sim = createSim(mission, 1);
      sim.v = 0;
      sim.s = s;
      return sim;
    }
    const pedPhases = [posePed(-1)];
    const dogPhases = [poseDog(0)];
    for (const target of [0, 8]) {
      let best = null;
      for (let u = 0.04; u < 0.16; u += 0.0004) {
        const sim = posePed(u);
        const step = gaitOffset(body(sim, "ped").travel, "pedestrian", false);
        const err = Math.abs(step - target);
        if (!best || err < best.err) best = { err, sim };
      }
      pedPhases.push(best.sim);
    }
    for (const target of [0, 5]) {
      let best = null;
      for (let s = 6; s < 24; s += 0.05) {
        const sim = poseDog(s);
        const step = gaitOffset(body(sim, "dog").travel, "dog", false);
        const err = Math.abs(step - target);
        if (!best || err < best.err) best = { err, sim };
      }
      dogPhases.push(best.sim);
    }

    const sheet = document.createElement("canvas");
    const zoom = 3;
    const cell = 150 * zoom;
    sheet.width = cell * 3;
    sheet.height = cell * 2 + 8;
    const out = sheet.getContext("2d");
    const pedHashes = [];
    const dogHashes = [];
    pedPhases.forEach((sim, index) => {
      paint(sim, 0);
      const box = body(sim, "ped");
      pedHashes.push(hash(box));
      out.drawImage(canvas, box.x, box.y, box.w, box.h, index * cell, 0, cell, cell);
    });
    dogPhases.forEach((sim, index) => {
      paint(sim, 0);
      const box = body(sim, "dog");
      dogHashes.push(hash(box));
      const legs = { ...box, y: Math.min(900 - box.h, box.y + 48) };
      out.drawImage(canvas, legs.x, legs.y, legs.w, legs.h, index * cell, cell + 8, cell, cell);
    });
    return {
      clean: cleanA && cleanB,
      standHash,
      standAgain,
      pedHashes,
      dogHashes,
      sheet: sheet.toDataURL("image/png"),
    };
  });
  expect(errors).toEqual([]);
  expect(drawn.clean).toBe(true);
  expect(drawn.standAgain).toBe(drawn.standHash);
  expect(new Set(drawn.pedHashes).size).toBe(drawn.pedHashes.length);
  expect(new Set(drawn.dogHashes).size).toBe(drawn.dogHashes.length);
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  fs.writeFileSync(
    "/opt/cursor/artifacts/gait-phases.png",
    Buffer.from(drawn.sheet.split(",")[1], "base64"),
  );
});

test("one tap and the brake are different fingers", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton);
  const sheet = await page.evaluate(async () => {
    const { render } = await import("./js/draw.js");
    const { createSim } = await import("./js/sim.js");
    const { freshSave } = await import("./js/storage.js");
    const { getMission, LESSONS } = await import("./js/missions.js");
    await document.fonts.ready;
    const mission = getMission("lesson1");
    const save = freshSave();
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");
    const poses = ["phone", "drowsy", "asleep", "earnest"];
    const sheet = document.createElement("canvas");
    sheet.width = 520 * 4;
    sheet.height = 640;
    const out = sheet.getContext("2d");
    poses.forEach((attention, index) => {
      const sim = createSim(mission, 11);
      sim.attention = attention;
      sim.stowT = attention === "stow" ? 0.4 : 0;
      const session = {
        sim,
        phase: "drive",
        mission,
        countdown: 0,
        keysDown: new Set(),
        brakeHeld: false,
        result: null,
      };
      render(ctx, {
        screen: "play",
        session,
        save,
        now: 0,
        hint: false,
        debug: false,
        notice: null,
        preview: null,
        missions: LESSONS,
        selected: "lesson1",
        pose: null,
        alpha: 1,
      });
      out.drawImage(canvas, 1056, 24, 520, 640, index * 520, 0, 520, 640);
    });
    return sheet.toDataURL("image/png");
  });
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  fs.writeFileSync("/opt/cursor/artifacts/attention-states.png", Buffer.from(sheet.split(",")[1], "base64"));

  await page.evaluate(() => {
    window.__anton.debugStart("lesson1");
    window.__anton.setTimeScale(6);
  });
  await page.waitForFunction(() => window.__anton.getState().phase === "drive");
  const pedal = await pedalPoint(page);
  let down = false;
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const state = await page.evaluate(() => window.__anton.getState());
    if (state.attention === "phone") break;
    const want = state.phase === "drive" && lessonBrake(state);
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
  await page.evaluate(() => window.__anton.setTimeScale(0));
  if (!down) {
    await page.mouse.move(pedal.x, pedal.y);
    await page.mouse.down();
  }
  await page.waitForFunction(() => window.__anton.getState().attention === "phone" && window.__anton.getState().held);
  const anton = await page.evaluate(() => {
    const spot = window.__anton.hotspots().find((item) => item.id === "anton");
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return {
      x: rect.left + (spot.x + spot.w / 2) * (rect.width / 1600),
      y: rect.top + (spot.y + spot.h / 2) * (rect.height / 900),
    };
  });
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 2, clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2, clientX: x, clientY: y, bubbles: true }));
  }, anton);
  await page.evaluate(() => window.__anton.setTimeScale(1));
  await page.waitForFunction(() => window.__anton.getState().attention !== "phone");
  const after = await page.evaluate(() => window.__anton.getState());
  expect(after.held).toBe(true);
  expect(after.pokes).toBe(1);
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 3, clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 3, clientX: x, clientY: y, bubbles: true }));
  }, anton);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__anton.getState().pokes)).toBe(1);
  expect(await page.evaluate(() => window.__anton.getState().held)).toBe(true);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1, bubbles: true }));
  });
  await page.waitForFunction(() => window.__anton.getState().held === false);
  expect(errors).toEqual([]);
});

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
