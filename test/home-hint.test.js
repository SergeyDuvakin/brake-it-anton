import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { HOME_HINT_DELAY_MS, homeHintVisible, isSafariBrowserTab } from "../js/home-hint.js";

const hint = "Поделиться → На экран «Домой» → Открыть как веб-приложение";

function visible(extra) {
  return homeHintVisible({
    screen: "title",
    standalone: false,
    displayMode: "browser",
    portrait: false,
    elapsedMs: HOME_HINT_DELAY_MS,
    ...extra,
  });
}

test("the Safari tab hint waits, then stays off the playfield and the home-screen app", () => {
  assert.equal(isSafariBrowserTab(false, "browser"), true);
  assert.equal(isSafariBrowserTab(true, "browser"), false);
  assert.equal(isSafariBrowserTab(undefined, "browser"), false);
  assert.equal(isSafariBrowserTab(false, "standalone"), false);
  assert.equal(isSafariBrowserTab(false, "fullscreen"), false);

  assert.equal(visible({ elapsedMs: HOME_HINT_DELAY_MS - 1 }), false);
  assert.equal(visible({}), true);
  assert.equal(visible({ screen: "play" }), false);
  assert.equal(visible({ screen: "garage" }), false);
  assert.equal(visible({ portrait: true }), false);
  assert.equal(visible({ standalone: true }), false);
  assert.equal(visible({ displayMode: "standalone" }), false);
});

test("the page points Safari at the web app manifest and the current icon files", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const manifest = JSON.parse(readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.name, "Brake It, Anton");
  assert.equal(manifest.short_name, "Anton");
  assert.equal(manifest.background_color, "#FAC83C");
  assert.equal(manifest.theme_color, "#FAC83C");
  assert.deepEqual(manifest.icons.map((icon) => icon.src), [
    "./assets/icon-180.png",
    "./assets/icon-192.png",
    "./assets/icon-512.png",
    "./assets/icon-1024.png",
  ]);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  assert.match(html, /rel="apple-touch-icon" href="\.\/assets\/icon-180\.png"/);
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.ok(html.includes(hint));
});
