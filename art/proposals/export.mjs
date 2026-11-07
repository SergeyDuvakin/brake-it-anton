import { chromium } from "playwright";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve("art/proposals");
const out = path.join(root, "png");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${path.join(root, "preview.html")}`);
await page.waitForFunction(() => window.__proposalsReady);
const meta = await page.evaluate(() => window.__proposalMeta);
for (const item of meta) {
  const data = await page.evaluate((id) => document.getElementById(id).toDataURL("image/png"), item.id);
  writeFileSync(path.join(out, item.file), Buffer.from(data.split(",")[1], "base64"));
}
const sheet = await page.evaluate(() => document.getElementById("contact").toDataURL("image/png"));
const sheetPath = path.join(root, "contact-sheet.png");
writeFileSync(sheetPath, Buffer.from(sheet.split(",")[1], "base64"));
await browser.close();

copyFileSync("icons/anton-wheel-1024.png", path.join(out, "icon-anton-wheel-1024.png"));
const manifest = {
  status: "proposal",
  accepted: false,
  note: "Предложения для просмотра. В игру не встроены. Гладкая доска-референс отклонена. Иконка сохранена как есть.",
  palette: ["#1C161E", "#F6ECD6", "#FAC83C", "#F296A0", "#F0BE8C", "#3CAAA0", "#E68246", "#5A8CDC", "#E83428", "#AADCEB", "#8A5A3A", "#5E7A52"],
  source: "art/proposals/preview.html",
  production: "не подключено. js/draw.js не менялся этим пакетом.",
  assets: [
    ...meta.map((item) => ({
      id: item.id,
      file: `png/${item.file}`,
      width: item.w,
      height: item.h,
      state: item.note,
      status: "proposal",
      anchor: item.id.startsWith("ped") || item.id.startsWith("anton") ? "низ фигуры" : item.id.startsWith("dog") ? "лапы" : item.id.startsWith("car") ? "задний бампер внизу, капот вверх по дороге" : "низ",
    })),
    {
      id: "icon",
      file: "png/icon-anton-wheel-1024.png",
      width: 1024,
      height: 1024,
      state: "утверждённая иконка, без перерисовки",
      status: "preserved",
      anchor: "квадрат",
    },
  ],
  wip: [
    "декорации: дома, деревья, бордюр",
    "интерфейс: педаль, терпение, титры, гараж, пауза, итог",
    "груз: торт и рыба",
    "остальные лица Антона: earnest, wake, stow, preen, furious",
    "походка в игре: эти рисунки ещё не кадры шага симуляции",
  ],
};
writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
const zip = path.join(root, "brake-it-anton-asset-proposals.zip");
execFileSync("zip", ["-r", "-q", zip, "png", "manifest.json", "preview.html", "contact-sheet.png"], { cwd: root });
copyFileSync(sheetPath, "/opt/cursor/artifacts/asset-proposals-contact.png");
copyFileSync(zip, "/opt/cursor/artifacts/brake-it-anton-asset-proposals.zip");
console.log(`exported ${meta.length} sprites`);
