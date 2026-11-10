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
  await page.waitForFunction(() => window.__anton.labels().some((item) => item.text === "ПОЕХАЛИ"));
  const labels = await page.evaluate(() => window.__anton.labels());
  const texts = labels.map((item) => item.text);
  expect(texts).toContain("ГАРАЖ");
  expect(texts).toContain("ВЫБЕРИ УРОК");
  expect(texts).toContain("УРОК 1");
  expect(texts).toContain("УРОК 2");
  expect(texts).toContain("УРОК 4");
  expect(texts).toContain("ПОЕХАЛИ");
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
  await page.waitForFunction(() => window.__anton.labels().some((item) => item.text === "ПОЕХАЛИ"));
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
    const sx = canvas.width / 1600;
    const sy = canvas.height / 900;
    const regions = {
      buttons: { x: 1072, y: 674, w: 488, h: 186 },
      tree: { x: 140, y: 280, w: 240, h: 320 },
      wheel: { x: 640, y: 670, w: 140, h: 140 },
    };
    const read = (rect) => {
      const x = Math.max(0, Math.round(rect.x * sx));
      const y = Math.max(0, Math.round(rect.y * sy));
      const w = Math.max(1, Math.min(canvas.width - x, Math.round(rect.w * sx)));
      const h = Math.max(1, Math.min(canvas.height - y, Math.round(rect.h * sy)));
      return Uint8ClampedArray.from(ctx.getImageData(x, y, w, h).data);
    };
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
  // The phone window is a few seconds of game time. A stalled test poll can
  // step past it at 4×, so the poke runs on the page clock instead.
  await page.evaluate(() => {
    const timer = setInterval(() => {
      const state = window.__anton.getState();
      if (state.phase === "result") {
        clearInterval(timer);
        return;
      }
      const needs = state.attention === "phone" || state.attention === "drowsy" || state.attention === "asleep";
      if (!needs) return;
      const spot = window.__anton.hotspots().find((item) => item.id === "anton");
      if (!spot) return;
      const rect = document.querySelector("canvas").getBoundingClientRect();
      const x = rect.left + (spot.x + spot.w / 2) * (rect.width / 1600);
      const y = rect.top + (spot.y + spot.h / 2) * (rect.height / 900);
      const canvas = document.querySelector("canvas");
      canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, clientX: x, clientY: y, bubbles: true, pointerType: "touch" }));
      canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, clientX: x, clientY: y, bubbles: true, pointerType: "touch" }));
    }, 40);
  });
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
    const { render, placedScene, whenCarsReady } = await import("./js/draw.js");
    const { pedPoseKey, dogPoseKey } = await import("./js/cast.js");
    await whenCarsReady();
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
      out.drawImage(canvas, box.x, box.y, box.w, box.h, index * cell, cell + 8, cell, cell);
    });
    const pedKeys = pedPhases.map((sim) => {
      const ped = sim.hazards.find((item) => item.id === "ped");
      return pedPoseKey(ped, body(sim, "ped").travel, false);
    });
    const dogKeys = dogPhases.map((sim) => dogPoseKey(body(sim, "dog").travel, false));
    return {
      clean: cleanA && cleanB,
      standHash,
      standAgain,
      pedKeys,
      dogKeys,
      sheet: sheet.toDataURL("image/png"),
    };
  });
  expect(errors).toEqual([]);
  expect(drawn.clean).toBe(true);
  expect(drawn.standAgain).toBe(drawn.standHash);
  expect(drawn.pedKeys[0]).toBe("pedStand");
  expect(drawn.pedKeys.every((key) => ["pedStand", "pedPass", "pedLift"].includes(key))).toBe(true);
  expect(drawn.dogKeys[0]).toBe("dogPaw");
  expect(drawn.dogKeys.slice(1).includes("dogWalk") || drawn.dogKeys.slice(1).includes("dogPaw")).toBe(true);
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
    const { whenCabinReady } = await import("./js/cabin.js");
    const { createSim } = await import("./js/sim.js");
    const { freshSave } = await import("./js/storage.js");
    const { getMission, LESSONS } = await import("./js/missions.js");
    await document.fonts.ready;
    await whenCabinReady();
    const mission = getMission("lesson1");
    const save = freshSave();
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");
    const poses = ["road", "earnest", "drowsy", "phone", "stow", "asleep", "wake"];
    const sheet = document.createElement("canvas");
    sheet.width = 520 * poses.length;
    const phoneH = Math.round(640 * (225 / 520));
    sheet.height = 640 + 12 + phoneH;
    const out = sheet.getContext("2d");
    const skin = {};
    const { cabinSourceToScreen } = await import("./js/cabin.js");
    function screenOf(sx, sy) {
      const [x, y] = cabinSourceToScreen(sx, sy);
      return [Math.round(x), Math.round(y)];
    }
    const scale = (cabinSourceToScreen(864, 0)[0] - cabinSourceToScreen(0, 0)[0]) / 864;
    function pixel(sx, sy) {
      const [x, y] = screenOf(sx, sy);
      const data = ctx.getImageData(x, y, 1, 1).data;
      return [data[0], data[1], data[2]];
    }
    function regionStats(sx, sy, sw, sh) {
      const [x, y] = screenOf(sx, sy);
      const w = Math.max(1, Math.round(sw * scale));
      const h = Math.max(1, Math.round(sh * scale));
      const data = ctx.getImageData(x, y, w, h).data;
      let skinN = 0;
      let darkN = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r > 200 && g > 140 && g < 215 && b > 70 && b < 175) skinN += 1;
        if (r < 55 && g < 55 && b < 60) darkN += 1;
      }
      return { skinN, darkN };
    }
    poses.forEach((attention, index) => {
      const sim = createSim(mission, 11);
      sim.t = 4;
      sim.attention = attention;
      if (attention === "stow") sim.stowT = 0.36;
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
      out.drawImage(canvas, 1056, 24, 520, 640, index * 225, 652, 225, phoneH);
      skin[attention] = {
        sky: pixel(160, 70),
        face: pixel(500, 520),
        hands: regionStats(360, 800, 400, 180),
      };
    });
    return { sheet: sheet.toDataURL("image/png"), skin };
  });
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  fs.writeFileSync("/opt/cursor/artifacts/anton-hands.png", Buffer.from(sheet.sheet.split(",")[1], "base64"));
  const sky = sheet.skin.road.sky;
  for (const pose of ["road", "earnest", "drowsy", "phone", "stow", "asleep", "wake"]) {
    const sample = sheet.skin[pose].sky;
    const drift = Math.max(...sky.map((channel, index) => Math.abs(channel - sample[index])));
    expect(drift, pose).toBeLessThanOrEqual(3);
    expect(sheet.skin[pose].hands.darkN, pose).toBeGreaterThan(25);
  }
  expect(sheet.skin.road.hands.skinN).toBeGreaterThan(20);
  expect(sheet.skin.earnest.hands.skinN).toBeGreaterThan(20);
  expect(sheet.skin.wake.hands.skinN).toBeGreaterThan(12);
  expect(sheet.skin.asleep.face.join(",")).not.toBe(sheet.skin.wake.face.join(","));
  expect(sheet.skin.phone.face.join(",")).not.toBe(sheet.skin.road.face.join(","));

  await page.evaluate(() => {
    window.__anton.debugStart("lesson1");
    window.__anton.setTimeScale(6);
  });
  await page.waitForFunction(() => window.__anton.getState().phase === "drive");
  await page.evaluate(() => window.__anton.setTimeScale(0));
  const pedal = await pedalPoint(page);
  const antonAt = await page.evaluate(() => {
    const spot = window.__anton.hotspots().find((item) => item.id === "anton");
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return {
      x: rect.left + (spot.x + spot.w / 2) * (rect.width / 1600),
      y: rect.top + (spot.y + spot.h / 2) * (rect.height / 900),
    };
  });
  await page.evaluate(({ x, y, px, py }) => {
    const canvas = document.querySelector("canvas");
    const down = (id, cx, cy) => canvas.dispatchEvent(new PointerEvent("pointerdown", {
      pointerId: id, clientX: cx, clientY: cy, bubbles: true,
    }));
    const end = (type, id, cx, cy) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: cx, clientY: cy, bubbles: true,
    }));
    down(11, x, y);
    down(12, px, py);
    down(13, x, y);
    end("pointerup", 12, px, py);
    end("pointercancel", 11, x, y);
    end("lostpointercapture", 11, x, y);
  }, { ...antonAt, px: pedal.x, py: pedal.y });
  const antonFirst = await page.evaluate(() => window.__anton.getState());
  expect(antonFirst.held).toBe(false);
  expect(antonFirst.brakePointer).toBe(null);
  expect(antonFirst.wakePointer).toBe(null);
  expect(antonFirst.pokes).toBe(0);
  await page.evaluate(() => window.__anton.setTimeScale(6));
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
  expect(after.brakePointer).not.toBe(null);
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 8, clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 8, clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 9, clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 9, bubbles: true }));
  }, anton);
  const parked = await page.evaluate(() => window.__anton.getState());
  expect(parked.held).toBe(true);
  expect(parked.pokes).toBe(1);
  expect(parked.wakePointer).toBe(null);
  expect(parked.attention).not.toBe("phone");
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

test("pointermove from the captured pedal onto Anton does not wake", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton);
  await page.evaluate(() => {
    window.__anton.debugStart("lesson1");
    window.__anton.setTimeScale(6);
  });
  await page.waitForFunction(() => window.__anton.getState().phase === "drive");
  await page.evaluate(() => window.__anton.setTimeScale(0));
  const pedal = await pedalPoint(page);
  const anton = await page.evaluate(() => {
    const spot = window.__anton.hotspots().find((item) => item.id === "anton");
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return {
      x: rect.left + (spot.x + spot.w / 2) * (rect.width / 1600),
      y: rect.top + (spot.y + spot.h / 2) * (rect.height / 900),
    };
  });
  await page.mouse.move(pedal.x, pedal.y);
  await page.mouse.down();
  await page.waitForFunction(() => window.__anton.getState().held);
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: x, clientY: y, bubbles: true,
    }));
  }, anton);
  const moved = await page.evaluate(() => window.__anton.getState());
  expect(moved.held).toBe(true);
  expect(moved.pokes).toBe(0);
  expect(moved.wakePointer).toBe(null);
  expect(moved.attention).toBe("road");
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test("the crossing before, at and past the bumper, old anchors beside the new", async ({ page }) => {
  await page.goto(gameURL("debug=1"));
  await page.waitForFunction(() => window.__anton);
  const drawn = await page.evaluate(async () => {
    const { render, placedScene, whenCarsReady } = await import("./js/draw.js");
    await whenCarsReady();
    const { createSim } = await import("./js/sim.js");
    const { screenFootprint } = await import("./js/anchors.js");
    const { freshSave } = await import("./js/storage.js");
    const { LESSONS } = await import("./js/missions.js");
    const { CFG } = await import("./js/config.js");
    await document.fonts.ready;
    const save = freshSave();
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const sheet = document.createElement("canvas");
    sheet.width = 1010 * 2;
    sheet.height = 852 * 5;
    const out = sheet.getContext("2d");
    function pose(lead, x) {
      const sim = createSim({
        id: "cross",
        seed: 11,
        cruise: 12,
        length: 200,
        cargo: null,
        slippery: [],
        hazards: [{ id: "ped", type: "pedestrian", s: 0, x, halfW: 0.42, halfL: 0.55 }],
      }, 11);
      sim.s = 40;
      sim.x = 1.8;
      sim.prevS = 39.6;
      const ped = sim.hazards[0];
      ped.crossT = 0.45 * ped.crossDur;
      ped.s = sim.s + CFG.carHalfFront + ped.halfL + lead;
      ped.x = x;
      return sim;
    }
    function frame(sim, col, row, legacy, notice) {
      render(ctx, {
        screen: "play",
        session: {
          sim,
          phase: "drive",
          mission: { id: "cross", objective: notice, lesson: 1, length: 200, infinite: false },
          countdown: 0,
          keysDown: new Set(),
          brakeHeld: false,
          result: null,
        },
        save,
        now: 1000,
        hint: false,
        debug: false,
        notice,
        preview: null,
        missions: LESSONS,
        selected: "lesson1",
        pose: null,
        alpha: 1,
        legacyAnchors: legacy,
      });
      out.drawImage(canvas, 24, 24, 1010, 852, col * 1010, row * 852, 1010, 852);
    }
    const rows = [
      [4, 1.8, "4 м до бампера, та же полоса"],
      [0, 1.8, "ближняя грань на бампере"],
      [-1.2, 1.8, "грань уже внутри машины"],
      [0, -1.6, "грань на бампере, другая сторона"],
    ];
    rows.forEach(([lead, x, notice], row) => {
      const sim = pose(lead, x);
      frame(sim, 0, row, true, `было · ${notice}`);
      frame(sim, 1, row, false, `стало · ${notice}`);
    });
    const crowd = createSim({
      id: "cross",
      seed: 11,
      cruise: 12,
      length: 200,
      cargo: null,
      slippery: [],
      hazards: [
        { id: "dog", type: "dog", s: 52, x: -1.4, halfW: 0.55, halfL: 0.8 },
        { id: "bin", type: "bin", s: 54, x: 1.8, halfW: 0.55, halfL: 0.7 },
        { id: "lid", type: "roller", s: 62, x: -1.2, halfW: 0.55, halfL: 0.55 },
        { id: "park", type: "stopped", s: 70, x: 0.3, halfW: 0.95, halfL: 2.2 },
        { id: "hole", type: "pothole", s: 48, x: 0.2, halfW: 0.72, halfL: 1.15 },
      ],
    }, 11);
    crowd.s = 40;
    crowd.x = 1.8;
    frame(crowd, 0, 4, true, "было · бак, крышка, собака, машина, яма");
    frame(crowd, 1, 4, false, "стало · бак, крышка, собака, машина, яма");
    const solo = createSim({
      id: "cross",
      seed: 11,
      cruise: 12,
      length: 200,
      cargo: null,
      slippery: [],
      hazards: [{ id: "park", type: "stopped", s: 70, x: 0.3, halfW: 0.95, halfL: 2.2, telegraph: -1, trust: false }],
    }, 11);
    solo.s = 40;
    solo.x = 1.8;
    render(ctx, {
      screen: "play",
      session: {
        sim: solo,
        phase: "drive",
        mission: { id: "cross", objective: "след", lesson: 1, length: 200, infinite: false },
        countdown: 0,
        keysDown: new Set(),
        brakeHeld: false,
        result: null,
      },
      save,
      now: 1000,
      hint: false,
      debug: false,
      notice: null,
      preview: null,
      missions: LESSONS,
      selected: "lesson1",
      pose: null,
      alpha: 1,
    });
    const park = solo.hazards[0];
    const view = placedScene(solo, 1);
    const actor = view.actors.find((item) => item.id === "park");
    const foot = screenFootprint(actor.groundDs, actor.farDs, actor.hx, park.halfW);
    function rgb(x, y) {
      const px = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return `${px[0]},${px[1]},${px[2]}`;
    }
    const families = [
      { id: "bin", type: "bin", s: 40, x: 1.2, halfW: 0.55, halfL: 0.7, carX: -1.8 },
      { id: "lid", type: "roller", s: 40, x: 1.2, halfW: 0.55, halfL: 0.55, carX: -1.8 },
      { id: "hole", type: "pothole", s: 70, x: 0.3, halfW: 0.72, halfL: 1.15, carX: 1.8 },
    ];
    const patches = [sample(park, foot)];
    for (const spec of families) {
      const one = createSim({
        id: "cross",
        seed: 11,
        cruise: 12,
        length: 200,
        cargo: null,
        slippery: [],
        hazards: [{ ...spec, telegraph: -1, trust: false }],
      }, 11);
      one.s = 40;
      one.x = spec.carX;
      render(ctx, {
        screen: "play",
        session: {
          sim: one,
          phase: "drive",
          mission: { id: "cross", objective: "след", lesson: 1, length: 200, infinite: false },
          countdown: 0,
          keysDown: new Set(),
          brakeHeld: false,
          result: null,
        },
        save,
        now: 1000,
        hint: false,
        debug: false,
        notice: null,
        preview: null,
        missions: LESSONS,
        selected: "lesson1",
        pose: null,
        alpha: 1,
      });
      const hazard = one.hazards[0];
      const actor = placedScene(one, 1).actors.find((item) => item.id === spec.id);
      patches.push(sample(hazard, screenFootprint(actor.groundDs, actor.farDs, actor.hx, hazard.halfW)));
    }
    function sample(hazard, box) {
      return {
        id: hazard.id,
        near: rgb(box.cx, box.bottomY - 3),
        far: rgb(box.cx, box.topY + 3),
        beyond: rgb(box.cx, box.topY - 12),
        closer: rgb(box.cx, box.bottomY + 12),
        center: rgb(box.cx, (box.topY + box.bottomY) / 2),
      };
    }
    const { actorTravel } = await import("./js/sim.js");
    const { gaitOffset } = await import("./js/gait.js");
    function contact(lead) {
      const sim = pose(lead, 1.8);
      const before = JSON.stringify({ s: sim.s, x: sim.x, hits: sim.stats.collisions, resolved: sim.hazards[0].resolved });
      render(ctx, {
        screen: "play",
        session: {
          sim,
          phase: "drive",
          mission: { id: "cross", objective: "след", lesson: 1, length: 200, infinite: false },
          countdown: 0,
          keysDown: new Set(),
          brakeHeld: false,
          result: null,
        },
        save,
        now: 1000,
        hint: false,
        debug: false,
        notice: null,
        preview: null,
        missions: LESSONS,
        selected: "lesson1",
        pose: null,
        alpha: 1,
        legacyAnchors: false,
      });
      const after = JSON.stringify({ s: sim.s, x: sim.x, hits: sim.stats.collisions, resolved: sim.hazards[0].resolved });
      const ped = sim.hazards[0];
      const actor = placedScene(sim, 1).actors[0];
      const fy = actor.spot.y;
      return {
        lead,
        same: before === after,
        foot: rgb(actor.spot.x, fy - 12),
        leg: rgb(actor.spot.x, fy - 56),
        below: rgb(actor.spot.x, fy + 14),
        gap: rgb(actor.spot.x, (fy + placedScene(sim, 1).car.y) / 2),
      };
    }
    function show(sim, alpha = 1) {
      render(ctx, {
        screen: "play",
        session: {
          sim,
          phase: "drive",
          mission: { id: "cross", objective: "след", lesson: 1, length: 200, infinite: false },
          countdown: 0,
          keysDown: new Set(),
          brakeHeld: false,
          result: null,
        },
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
        legacyAnchors: false,
      });
    }
    const { project } = await import("./js/road.js");
    const bare = createSim({
      id: "cross", seed: 11, cruise: 12, length: 200, cargo: null, slippery: [], hazards: [],
    }, 11);
    bare.s = 40;
    bare.x = 0.2;
    bare.prevS = 39.2;
    bare.prevX = -0.6;
    const beforeCar = JSON.stringify({ s: bare.s, x: bare.x, hits: bare.stats.collisions });
    const alphas = {};
    for (const alpha of [0, 0.5, 1]) {
      show(bare, alpha);
      const view = placedScene(bare, alpha);
      const xm = view.pose.x;
      const noseIn = project(CFG.carHalfFront - 0.4, xm);
      const noseOut = project(CFG.carHalfFront + 0.55, xm);
      const tailIn = project(-CFG.carHalfBack + 1.05, xm);
      const tailOut = project(-CFG.carHalfBack - 0.55, xm);
      const mid = (CFG.carHalfFront - CFG.carHalfBack) / 2;
      const leftOut = project(mid, xm - CFG.carHalfW - 0.4);
      const leftIn = project(mid, xm - CFG.carHalfW + 0.24);
      const rightIn = project(mid, xm + CFG.carHalfW - 0.24);
      const rightOut = project(mid, xm + CFG.carHalfW + 0.4);
      alphas[alpha] = {
        same: JSON.stringify({ s: bare.s, x: bare.x, hits: bare.stats.collisions }) === beforeCar,
        noseIn: rgb(noseIn.x, noseIn.y),
        noseOut: rgb(noseOut.x, noseOut.y),
        tailIn: rgb(tailIn.x, tailIn.y),
        tailOut: rgb(tailOut.x, tailOut.y),
        leftIn: rgb(leftIn.x, leftIn.y),
        leftOut: rgb(leftOut.x, leftOut.y),
        rightIn: rgb(rightIn.x, rightIn.y),
        rightOut: rgb(rightOut.x, rightOut.y),
      };
    }
    function sideCar(x, sampleX) {
      const sim = createSim({
        id: "cross",
        seed: 11,
        cruise: 12,
        length: 200,
        cargo: null,
        slippery: [],
        hazards: [{ id: "park", type: "stopped", s: 40, x, halfW: 0.95, halfL: 2.2, telegraph: -1, trust: false }],
      }, 11);
      sim.s = 40;
      sim.x = 0;
      show(sim);
      const spot = project(0.35, sampleX);
      return rgb(spot.x, spot.y);
    }
    const road = "88,96,120";
    const zoom = document.createElement("canvas");
    zoom.width = 560 * 3;
    zoom.height = 340 * 2;
    const zctx = zoom.getContext("2d");
    zctx.fillStyle = "#F4EFE4";
    zctx.fillRect(0, 0, zoom.width, zoom.height);
    const labels = ["4 м впереди", "на бампере", "уже внутри"];
    rows.slice(0, 3).forEach((_, index) => {
      for (const col of [0, 1]) {
        zctx.drawImage(sheet, col * 1010 + 430, index * 852 + 470, 520, 300, index * 560 + 8, col * 340 + 28, 544, 300);
        zctx.fillStyle = "#1C161E";
        zctx.font = "16px sans-serif";
        zctx.fillText(`${labels[index]} · ${col === 0 ? "было" : "стало"}`, index * 560 + 12, col * 340 + 20);
      }
    });
    return {
      sheet: sheet.toDataURL("image/png"),
      zoom: zoom.toDataURL("image/png"),
      patches,
      contacts: [4, 0, -1.2].map(contact),
      alphas,
      clearRight: sideCar(2.3, 1.1),
      hitRight: sideCar(1.35, 0.8),
      clearLeft: sideCar(-2.3, -1.1),
      hitLeft: sideCar(-1.35, -0.8),
      road,
    };
  });
  for (const patch of drawn.patches) {
    if (patch.id === "hole") {
      // The approved hole is a shallow oval. It keeps that shape, so the
      // long collider is not filled edge to edge. The pit itself is the
      // dark centre of the patch. A road crack can sit just past the far
      // face, so that pixel is not the check.
      const [r, g, b] = patch.center.split(",").map(Number);
      expect(patch.center, patch.id).not.toBe(drawn.road);
      expect(r, patch.id).toBeLessThan(140);
      expect(g, patch.id).toBeLessThan(120);
      expect(b, patch.id).toBeLessThan(80);
      continue;
    }
    expect(patch.near, patch.id).not.toBe(drawn.road);
    expect(patch.closer, patch.id).not.toBe(patch.near);
  }
  const dark = (value) => {
    const [r, g, b] = value.split(",").map(Number);
    return r < 80 && g < 70 && b < 80;
  };
  const carPaint = (value) => {
    const [r, g, b] = value.split(",").map(Number);
    const yellow = r > 145 && g > 80 && b < 70 && r > g + 20 && r - b > 50;
    const glass = b > 160 && g > 150 && r > 120;
    const edge = r < 120 && g < 90 && b < 70 && r > g && r > b;
    return yellow || glass || dark(value) || edge;
  };
  for (const row of drawn.contacts) expect(row.same, String(row.lead)).toBe(true);
  const ahead = drawn.contacts[0];
  const touch = drawn.contacts[1];
  const inside = drawn.contacts[2];
  const onPerson = (value) => value !== drawn.road;
  expect(onPerson(ahead.foot), ahead.foot).toBe(true);
  expect(onPerson(ahead.leg), ahead.leg).toBe(true);
  expect(ahead.gap).toBe(drawn.road);
  expect(carPaint(ahead.below), ahead.below).toBe(false);
  expect(onPerson(touch.foot), touch.foot).toBe(true);
  expect(onPerson(touch.leg), touch.leg).toBe(true);
  expect(carPaint(touch.below), touch.below).toBe(true);
  expect(onPerson(inside.foot), inside.foot).toBe(true);
  expect(onPerson(inside.leg), inside.leg).toBe(true);
  const vehicle = (value) => {
    const [r, g, b] = value.split(",").map(Number);
    const coral = r > 180 && g > 70 && g < 170 && b < 150 && r > g + 30;
    return carPaint(value) || coral;
  };
  for (const alpha of ["0", "0.5", "1"]) {
    const row = drawn.alphas[alpha];
    expect(row.same, alpha).toBe(true);
    expect(carPaint(row.noseIn), `${alpha} nose ${row.noseIn}`).toBe(true);
    expect(carPaint(row.tailIn), `${alpha} tail ${row.tailIn}`).toBe(true);
    expect(carPaint(row.leftIn), `${alpha} left ${row.leftIn}`).toBe(true);
    expect(carPaint(row.rightIn), `${alpha} right ${row.rightIn}`).toBe(true);
    expect(vehicle(row.noseOut), `${alpha} past nose ${row.noseOut}`).toBe(false);
    expect(vehicle(row.tailOut), `${alpha} past tail ${row.tailOut}`).toBe(false);
    expect(vehicle(row.leftOut), `${alpha} past left ${row.leftOut}`).toBe(false);
    expect(vehicle(row.rightOut), `${alpha} past right ${row.rightOut}`).toBe(false);
  }
  expect(vehicle(drawn.clearRight), drawn.clearRight).toBe(false);
  expect(vehicle(drawn.clearLeft), drawn.clearLeft).toBe(false);
  expect(vehicle(drawn.hitRight), drawn.hitRight).toBe(true);
  expect(vehicle(drawn.hitLeft), drawn.hitLeft).toBe(true);
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  fs.writeFileSync("/opt/cursor/artifacts/crossing-before-after.png", Buffer.from(drawn.sheet.split(",")[1], "base64"));
  fs.writeFileSync("/opt/cursor/artifacts/crossing-zoom.png", Buffer.from(drawn.zoom.split(",")[1], "base64"));
});

test("the plan footprint matches the chassis at both sides and several depths", async ({ page }) => {
  await page.goto(gameURL("debug=1"));
  await page.waitForFunction(() => window.__anton);
  const drawn = await page.evaluate(async () => {
    const { render, placedScene, whenCarsReady } = await import("./js/draw.js");
    const { actorTravel, createSim } = await import("./js/sim.js");
    const { gaitOffset } = await import("./js/gait.js");
    const { project } = await import("./js/road.js");
    const { CFG } = await import("./js/config.js");
    const { freshSave } = await import("./js/storage.js");
    const { LESSONS } = await import("./js/missions.js");
    await whenCarsReady();
    await document.fonts.ready;
    const save = freshSave();
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    function rgb(x, y) {
      const px = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return `${px[0]},${px[1]},${px[2]}`;
    }
    function show(sim, alpha = 1) {
      render(ctx, {
        screen: "play",
        session: {
          sim,
          phase: "drive",
          mission: { id: "fit", objective: "след", lesson: 1, length: 400, infinite: false },
          countdown: 0,
          keysDown: new Set(),
          brakeHeld: false,
          result: null,
        },
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
        legacyAnchors: false,
      });
    }
    function empty(x, prevX) {
      const sim = createSim({
        id: "fit", seed: 4, cruise: 12, length: 400, cargo: null, slippery: [], hazards: [],
      }, 4);
      sim.s = 40;
      sim.prevS = 39.4;
      sim.x = x;
      sim.prevX = prevX ?? x;
      return sim;
    }
    function probe(sim, noseDs, tailDs, xm, halfW, sideInset = 0.24, endInset = 0.35) {
      const center = (noseDs + tailDs) / 2;
      const spot = (ds, x) => {
        const p = project(ds, x);
        return rgb(p.x, p.y);
      };
      return {
        noseIn: spot(noseDs - endInset, xm),
        noseOut: spot(noseDs + 0.45, xm),
        tailIn: spot(tailDs + endInset, xm),
        tailOut: spot(tailDs - 0.45, xm),
        leftIn: spot(center, xm - halfW + sideInset),
        leftOut: spot(center, xm - halfW - 0.32),
        rightIn: spot(center, xm + halfW - sideInset),
        rightOut: spot(center, xm + halfW + 0.32),
      };
    }
    function strokeBox(noseDs, tailDs, xm, halfW) {
      const corners = [
        project(noseDs, xm - halfW),
        project(noseDs, xm + halfW),
        project(tailDs, xm + halfW),
        project(tailDs, xm - halfW),
      ];
      ctx.save();
      ctx.strokeStyle = "#ff2bd6";
      ctx.lineWidth = 2;
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    const players = [];
    for (const x of [-1.2, 0.35, 1.45]) {
      const sim = empty(x);
      show(sim);
      players.push({ x, ...probe(sim, CFG.carHalfFront, -CFG.carHalfBack, x, CFG.carHalfW) });
    }
    const moving = empty(1.1, -1.4);
    const alphas = {};
    for (const alpha of [0, 0.5, 1]) {
      show(moving, alpha);
      const xm = moving.prevX + (moving.x - moving.prevX) * alpha;
      alphas[alpha] = probe(moving, CFG.carHalfFront, -CFG.carHalfBack, xm, CFG.carHalfW);
    }
    const brake = empty(0.2);
    brake.brakeInput = 1;
    show(brake);
    const braking = probe(brake, CFG.carHalfFront, -CFG.carHalfBack, brake.x, CFG.carHalfW);
    const crash = empty(-0.4);
    crash.crashT = 0.4;
    show(crash);
    const crashing = probe(crash, CFG.carHalfFront, -CFG.carHalfBack, crash.x, CFG.carHalfW);
    const depths = [];
    for (const dist of [7, 16, 30]) {
      for (const [playerX, hx] of [[-2.5, 1.15], [2.5, -1.15]]) {
        const sim = empty(playerX);
        sim.hazards.push({
          id: "park", type: "stopped", s: sim.s + dist, x: hx, halfW: 0.95, halfL: 2.2, telegraph: -1, trust: false,
        });
        show(sim);
        depths.push({
          dist,
          hx,
          // On the body of the drawing. A far car keeps the file's aspect, so it
          // is narrower than the foreshortened lane and a kerb-side sample misses it.
          ...probe(sim, dist + 2.2, dist - 2.2, hx, 0.95, 0.78, dist > 24 ? 0.7 : 0.28),
        });
      }
    }
    function side(otherX, sampleX) {
      const sim = empty(0);
      sim.hazards.push({
        id: "park", type: "stopped", s: sim.s, x: otherX, halfW: 0.95, halfL: 2.2, telegraph: -1, trust: false,
      });
      show(sim);
      const p = project(0.2, sampleX);
      return rgb(p.x, p.y);
    }
    function actorSim(type, lead, x, halfW, halfL) {
      const sim = empty(0.3);
      const h = { id: "one", type, s: 0, x, halfW, halfL, telegraph: -1, trust: false };
      sim.hazards.push(h);
      h.s = sim.s + CFG.carHalfFront + halfL + lead;
      show(sim);
      return { sim, h, actor: placedScene(sim, 1).actors[0] };
    }
    const dogMeet = actorSim("dog", -2.05, 0, 0.55, 0.8);
    const dogSc = Math.max(0.62, Math.min(1.45, dogMeet.actor.spot.scale * 1.55));
    const dogStep = gaitOffset(dogMeet.actor.travel ?? actorTravel(dogMeet.h, dogMeet.sim), "dog", false);
    const hood = project(-0.2, dogMeet.sim.x - 0.45);
    const dog = {
      paw: rgb(dogMeet.actor.spot.x + (-4 - dogStep) * dogSc, dogMeet.actor.spot.y - 8),
      belly: rgb(dogMeet.actor.spot.x, dogMeet.actor.spot.y - 30 * dogSc),
      below: rgb(hood.x, hood.y),
      pawY: dogMeet.actor.spot.y,
      bellyY: dogMeet.actor.spot.y - 30 * dogSc,
    };
    const dogClear = actorSim("dog", 0, 2.4, 0.55, 0.8);
    const gap = project(CFG.carHalfFront, 1.35);
    const dogGap = rgb(gap.x, gap.y);
    const ped = actorSim("pedestrian", 0, 0.3, 0.42, 0.55);
    const pedSc = Math.max(0.62, Math.min(1.45, ped.actor.spot.scale * 1.55));
    const feet = rgb(ped.actor.spot.x, ped.actor.spot.y - 1);
    const sheet = document.createElement("canvas");
    sheet.width = 1680;
    sheet.height = 980;
    const out = sheet.getContext("2d");
    out.fillStyle = "#F4EFE4";
    out.fillRect(0, 0, sheet.width, sheet.height);
    out.fillStyle = "#1C161E";
    out.font = "20px sans-serif";
    const tiles = [
      [-1.2, "игрок x=−1.2"],
      [0.35, "игрок x=0.35"],
      [1.45, "игрок x=1.45"],
    ];
    tiles.forEach(([x, label], i) => {
      const sim = empty(x);
      show(sim);
      strokeBox(CFG.carHalfFront, -CFG.carHalfBack, x, CFG.carHalfW);
      out.drawImage(canvas, 300, 560, 520, 280, 16 + i * 552, 36, 520, 280);
      out.fillStyle = "#1C161E";
      out.fillText(label, 16 + i * 552, 26);
    });
    [[7, 1.15, -2.5, "коралл 7 м"], [16, -1.15, 2.5, "коралл 16 м"], [30, 1.15, -2.5, "коралл 30 м"]].forEach(([dist, hx, playerX, label], i) => {
      const sim = empty(playerX);
      sim.hazards.push({
        id: "park", type: "stopped", s: sim.s + dist, x: hx, halfW: 0.95, halfL: 2.2, telegraph: -1, trust: false,
      });
      show(sim);
      strokeBox(dist + 2.2, dist - 2.2, hx, 0.95);
      const spot = project(dist, hx);
      out.drawImage(canvas, spot.x - 180, spot.y - 80, 360, 180, 16 + i * 552, 360, 520, 260);
      out.fillStyle = "#1C161E";
      out.fillText(label, 16 + i * 552, 350);
    });
    const contacts = [
      [2.4, 1.15, "мимо справа"],
      [1.32, 0.7, "задел справа"],
      [-1.32, -0.7, "задел слева"],
      [-2.4, -1.15, "мимо слева"],
    ];
    contacts.forEach(([otherX, sampleX, label], i) => {
      const sim = empty(0);
      sim.hazards.push({
        id: "park", type: "stopped", s: sim.s, x: otherX, halfW: 0.95, halfL: 2.2, telegraph: -1, trust: false,
      });
      show(sim);
      strokeBox(CFG.carHalfFront, -CFG.carHalfBack, 0, CFG.carHalfW);
      strokeBox(2.2, -2.2, otherX, 0.95);
      const spot = project(0.2, sampleX);
      ctx.strokeStyle = "#1C161E";
      ctx.strokeRect(spot.x - 4, spot.y - 4, 8, 8);
      out.drawImage(canvas, 220, 560, 680, 280, 16 + i * 414, 680, 400, 250);
      out.fillStyle = "#1C161E";
      out.fillText(label, 16 + i * 414, 668);
    });
    show(dogMeet.sim);
    strokeBox(CFG.carHalfFront, -CFG.carHalfBack, dogMeet.sim.x, CFG.carHalfW);
    const dogSheet = document.createElement("canvas");
    dogSheet.width = 720;
    dogSheet.height = 360;
    dogSheet.getContext("2d").drawImage(canvas, 280, 500, 560, 280, 0, 0, 720, 360);
    return {
      players,
      alphas,
      braking,
      crashing,
      depths,
      hitRight: side(1.32, 0.7),
      missRight: side(2.4, 1.15),
      hitLeft: side(-1.32, -0.7),
      missLeft: side(-2.4, -1.15),
      dog,
      dogGap,
      feet,
      sheet: sheet.toDataURL("image/png"),
      dogSheet: dogSheet.toDataURL("image/png"),
    };
  });
  const vehicle = (value) => {
    const [r, g, b] = value.split(",").map(Number);
    const yellow = r > 145 && g > 80 && b < 70 && r > g + 20 && r - b > 50;
    const coral = r > 160 && g > 40 && g < 190 && b < 150 && r > g + 40 && r > b;
    const ink = r < 60 && g < 60 && b < 60;
    const glass = b > 150 && g > 140 && r > 100 && r < 210;
    return yellow || coral || ink || glass;
  };
  const brown = (value) => {
    const [r, g, b] = value.split(",").map(Number);
    return r > 90 && r < 240 && g > 50 && g < 180 && b < 120 && r > b + 20;
  };
  function edges(row, label) {
    for (const key of ["noseIn", "tailIn", "leftIn", "rightIn"]) {
      expect(vehicle(row[key]), `${label} ${key} ${row[key]}`).toBe(true);
    }
    for (const key of ["noseOut", "tailOut", "leftOut", "rightOut"]) {
      expect(vehicle(row[key]), `${label} ${key} ${row[key]}`).toBe(false);
    }
  }
  for (const row of drawn.players) edges(row, `player ${row.x}`);
  for (const alpha of ["0", "0.5", "1"]) edges(drawn.alphas[alpha], `alpha ${alpha}`);
  edges(drawn.braking, "brake");
  edges(drawn.crashing, "crash");
  for (const row of drawn.depths) edges(row, `coral ${row.dist} x ${row.hx}`);
  expect(vehicle(drawn.hitRight), drawn.hitRight).toBe(true);
  expect(vehicle(drawn.hitLeft), drawn.hitLeft).toBe(true);
  expect(vehicle(drawn.missRight), drawn.missRight).toBe(false);
  expect(vehicle(drawn.missLeft), drawn.missLeft).toBe(false);
  expect(brown(drawn.dog.paw), drawn.dog.paw).toBe(true);
  expect(brown(drawn.dog.belly), drawn.dog.belly).toBe(true);
  expect(drawn.dog.bellyY).toBeLessThan(drawn.dog.pawY - 12);
  expect(vehicle(drawn.dog.below), `dog on bumper ${drawn.dog.below}`).toBe(true);
  expect(vehicle(drawn.dogGap), drawn.dogGap).toBe(false);
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  fs.writeFileSync("/opt/cursor/artifacts/footprint-bounds.png", Buffer.from(drawn.sheet.split(",")[1], "base64"));
  fs.writeFileSync("/opt/cursor/artifacts/footprint-dog.png", Buffer.from(drawn.dogSheet.split(",")[1], "base64"));
});

test("the approved plan keeps one shape at both curbs, braking, and far cars", async ({ page }) => {
  await page.goto(gameURL("debug=1"));
  await page.waitForFunction(() => window.__anton);
  const measured = await page.evaluate(async () => {
    const { drawPlanSprite, planBlitBox, PLAN_ART, whenCarsReady } = await import("./js/draw.js");
    const { CFG } = await import("./js/config.js");
    await whenCarsReady();
    function load(file) {
      const img = new Image();
      img.src = `./assets/cars/${file}`;
      return img.decode().then(() => img);
    }
    const yellow = await load("yellow-car-game-straight.png");
    const brake = await load("yellow-car-brake.png");
    const crash = await load("yellow-car-collision.png");
    const coral = await load("coral-wagon-straight.png");
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    function mask(img, art, lengthM, centerDs, xm) {
      ctx.clearRect(0, 0, 1600, 900);
      drawPlanSprite(ctx, img, { centerDs, xm, lengthM, artLen: art.artLen, pivot: art.pivot });
      const box = planBlitBox(centerDs, xm, lengthM, art.artLen, img.width, art.pivot);
      const x0 = Math.max(0, Math.floor(box.x));
      const y0 = Math.max(0, Math.floor(box.y));
      const x1 = Math.min(1599, Math.ceil(box.x + box.w));
      const y1 = Math.min(899, Math.ceil(box.y + box.h));
      const data = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
      let minX = 1e9;
      let minY = 1e9;
      let maxX = -1;
      let maxY = -1;
      const w = x1 - x0 + 1;
      for (let y = 0; y < y1 - y0 + 1; y += 1) {
        for (let x = 0; x < w; x += 1) {
          if (data[(y * w + x) * 4 + 3] < 16) continue;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      return { bw, bh, aspect: bh / bw, boxAspect: box.h / (box.w * (bw / img.width)) };
    }
    const lengthM = CFG.carHalfFront + CFG.carHalfBack;
    const centerDs = (CFG.carHalfFront - CFG.carHalfBack) / 2;
    const players = [-2.4, 0, 2.4].map((xm) => ({ xm, ...mask(yellow, PLAN_ART.yellow, lengthM, centerDs, xm) }));
    return {
      players,
      brake: mask(brake, PLAN_ART.yellow, lengthM, centerDs, 2.4),
      crash: mask(crash, PLAN_ART.yellow, lengthM, centerDs, -2.4),
      coralNear: mask(coral, PLAN_ART.coral, 4.4, 8, 1.6),
      coralFar: mask(coral, PLAN_ART.coral, 4.4, 30, -1.6),
      backing: {
        width: document.querySelector("canvas").width,
        height: document.querySelector("canvas").height,
        dpr: window.devicePixelRatio,
      },
    };
  });
  const aspects = measured.players.map((row) => row.aspect);
  for (const row of measured.players) {
    expect(Math.abs(row.aspect - 807 / 462), `x ${row.xm} ${row.bw}x${row.bh}`).toBeLessThan(0.055);
  }
  expect(Math.max(...aspects) - Math.min(...aspects)).toBeLessThan(0.04);
  expect(measured.brake.aspect).toBeGreaterThan(1.72);
  expect(measured.brake.aspect).toBeLessThan(1.80);
  expect(measured.crash.aspect).toBeGreaterThan(1.72);
  expect(measured.crash.aspect).toBeLessThan(1.80);
  expect(Math.abs(measured.coralNear.aspect - 857 / 444), JSON.stringify(measured.coralNear)).toBeLessThan(0.08);
  // A car thirty metres ahead is about twenty pixels wide. The smooth edge
  // adds a pixel or two; the rectangle itself is the file's aspect.
  const farPx = Math.abs(measured.coralFar.bw - measured.coralFar.bh / (857 / 444));
  expect(farPx, JSON.stringify(measured.coralFar)).toBeLessThan(2.5);
  expect(measured.backing.width).toBe(1600);
  expect(measured.backing.height).toBe(900);
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

test("the gauge needle and the pedal angle follow the real input", async ({ page }) => {
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await page.evaluate(() => window.__anton.debugStart("lesson1"));
  await page.waitForFunction(() => window.__anton.getState().phase === "drive");
  await page.evaluate(() => window.__anton.setTimeScale(0));

  async function pose(patience, brake) {
    await page.evaluate(({ patience, brake }) => {
      window.__anton.setPatience(patience);
      window.__anton.setBrakeInput(brake);
    }, { patience, brake });
    const expectDeg = 180 * (1 - patience / 100);
    const expectPedal = brake * 24;
    await page.waitForFunction(
      ({ expectDeg, expectPedal }) => {
        const state = window.__anton.getState();
        return state.needleDeg !== null
          && Math.abs(state.needleDeg - expectDeg) < 0.05
          && Math.abs(state.pedalDeg - expectPedal) < 0.05;
      },
      { expectDeg, expectPedal },
    );
    return page.evaluate(() => {
      const state = window.__anton.getState();
      const canvas = document.querySelector("canvas");
      const ctx = canvas.getContext("2d");
      const ink = (x, y) => {
        let darkest = 765;
        for (let dy = -3; dy <= 3; dy += 3) {
          for (let dx = -3; dx <= 3; dx += 3) {
            const pix = ctx.getImageData(Math.round(x + dx), Math.round(y + dy), 1, 1).data;
            darkest = Math.min(darkest, pix[0] + pix[1] + pix[2]);
          }
        }
        return darkest;
      };
      const dx = state.hubX - state.tipX;
      const dy = state.hubY - state.tipY;
      const len = Math.hypot(dx, dy) || 1;
      return {
        needleDeg: state.needleDeg,
        pedalDeg: state.pedalDeg,
        tipX: state.tipX,
        tipY: state.tipY,
        padY: state.padY,
        needleInk: ink(state.tipX + (dx / len) * 18, state.tipY + (dy / len) * 18),
        hubInk: ink(state.hubX, state.hubY),
        padInk: ink(state.padX, state.padY),
      };
    });
  }

  const calm = await pose(8, 0);
  const hot = await pose(96, 1);
  expect(calm.needleDeg).toBeCloseTo(180 * (1 - 8 / 100), 1);
  expect(hot.needleDeg).toBeCloseTo(180 * (1 - 96 / 100), 1);
  expect(calm.pedalDeg).toBe(0);
  expect(hot.pedalDeg).toBeCloseTo(24, 1);
  expect(hot.padY).toBeLessThan(calm.padY - 10);
  expect(Math.hypot(calm.tipX - hot.tipX, calm.tipY - hot.tipY)).toBeGreaterThan(50);
  expect(calm.needleInk).toBeLessThan(240);
  expect(hot.needleInk).toBeLessThan(240);
  expect(calm.hubInk).toBeLessThan(220);
  expect(calm.padInk).toBeLessThan(320);
  expect(hot.padInk).toBeLessThan(320);
});

test("house bases and tree trunks stay off the asphalt, near and far", async ({ page }) => {
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton?.hotspots().some((spot) => spot.id === "start"));
  await page.evaluate(() => window.__anton.debugStart("lesson1"));
  await page.waitForFunction(() => window.__anton.getState().phase === "drive");
  await page.evaluate(() => window.__anton.setTimeScale(0));
  const leaks = await page.evaluate(async () => {
    const { project, VIEW } = await import("./js/road.js");
    const canvas = document.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const hits = [];
    for (const cam of [16, 34, 52, 70]) {
      window.__anton.debugPlace({ s: cam, x: 0 });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const distances = [];
      for (let world = Math.floor((cam - 6) / 14) * 14; world < cam + 56; world += 14) {
        const ds = world - cam;
        if (ds > 3 && ds < 58) distances.push(ds);
      }
      for (const ds of distances) {
        const curbL = project(ds, -VIEW.roadHalf);
        const curbR = project(ds, VIEW.roadHalf);
        const y = Math.round(curbL.y);
        if (y < 30 || y > 870) continue;
        for (const [edge, dir] of [[Math.round(curbL.x), 1], [Math.round(curbR.x), -1]]) {
          for (let step = 4; step <= 28; step += 4) {
            const x = edge + dir * step;
            if (x < 30 || x > 1000) continue;
            const px = ctx.getImageData(x, y, 1, 1).data;
            const r = px[0];
            const g = px[1];
            const b = px[2];
            const road = b > 85 && b > r + 6 && r < 160;
            const wall = r > 165 && g > 120 && b < 175 && r > b + 25 && Math.abs(r - g) < 90;
            const roof = r > 150 && g < 110 && b < 120;
            const trunk = r > 70 && r < 150 && g > 50 && g < 120 && b < 80 && r > b + 20 && Math.abs(r - g) < 40;
            if (!road && (wall || roof || trunk)) hits.push({ cam, ds, x, y, rgb: `${r},${g},${b}` });
          }
        }
      }
    }
    return hits.slice(0, 8);
  });
  expect(leaks, JSON.stringify(leaks)).toEqual([]);
});

test("phone-sized frame stays within the DPR cap and a loose frame budget", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(gameURL("e2e=1"));
  await page.waitForFunction(() => window.__anton?.debugStart);
  await page.evaluate(() => window.__anton.debugStart("lesson1"));
  await page.waitForFunction(() => window.__anton.getState().phase === "drive");
  const budget = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 30; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push(window.__anton.frameBudget());
    }
    samples.sort((a, b) => a - b);
    return {
      median: samples[Math.floor(samples.length / 2)],
      max: samples[samples.length - 1],
      scale: window.__anton.bufferScale(),
      buffer: [document.querySelector("canvas").width, document.querySelector("canvas").height],
    };
  });
  fs.writeFileSync("/opt/cursor/artifacts/frame-budget.json", JSON.stringify(budget, null, 2));
  expect(budget.scale).toBeLessThanOrEqual(2);
  expect(budget.median).toBeLessThan(32);
});
