import { expect, test } from "@playwright/test";
import fs from "node:fs";

const shot = (name) => `artifacts/${name}.png`;

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

test("click start, brake, pause and resume without console errors", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
  await expect(page.locator("#rotate")).toBeVisible();
  await expect(page.locator("#rotate")).toContainText("Поверни телефон");
  await expect(page.locator("#wrap")).toBeHidden();
  await page.screenshot({ path: shot("portrait") });
});

test("scripted careful lesson finishes and a panic cake trip fails", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/?e2e=1");
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
