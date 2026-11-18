/**
 * Pixel start screen. Every PNG is blitted at the layout's native cell, ×4.
 * The street is horizontal, so it does not use the vertical world renderer.
 * Anton and the dog stay where the mockup put them. Only the cars and the
 * two pedestrians move, and a freeze puts even those back on the mockup.
 */

import { mulberry32 } from "./rng.js";
import { notePixelSmoothing, pixelImage, pixelProgress, retryPixelLoad } from "./pixel-assets.js";

async function readJson(url) {
  if (url.protocol === "file:") {
    const { readFileSync } = await import("node:fs");
    return JSON.parse(readFileSync(url, "utf8"));
  }
  const response = await globalThis.fetch(url);
  if (!response.ok) throw new Error(`start json ${response.status}`);
  return response.json();
}

function pixelUrl(...parts) {
  return new URL(["..", "assets", "pixel", ...parts].join("/"), import.meta.url);
}

let layout = null;
let font = null;
let startFailed = false;

function adoptStartJson(lay, fnt) {
  layout = lay;
  font = fnt;
}

// Node tests read the files now. The browser must not reject the module:
// a missing start-layout.json would reject the module and leave a blank page.
if (pixelUrl("start", "start-layout.json").protocol === "file:") {
  try {
    const fsMod = await import("node:fs");
    adoptStartJson(
      JSON.parse(fsMod.readFileSync(pixelUrl("start", "start-layout.json"), "utf8")),
      JSON.parse(fsMod.readFileSync(pixelUrl("start", "font9-ink.json"), "utf8")),
    );
  } catch {
    startFailed = true;
  }
} else {
  readJson(pixelUrl("start", "start-layout.json"))
    .then((lay) => readJson(pixelUrl("start", "font9-ink.json")).then((fnt) => adoptStartJson(lay, fnt)))
    .catch((error) => {
      startFailed = true;
      console.warn("Start layout failed; using the classic title.", error);
    });
}

const SCALE = 4;
const CREAM = "#FFF6E4";

const MOVERS = {
  "car/npc-white-left.png": "npc",
  "world/sprites/ped-pink-right-0.png": "pink",
  "world/sprites/ped-blue-left-1.png": "blue",
};

let captionOverride = null;
let attract = createAttract();
const rawCache = new Map();

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw, width, height) {
  const stride = width * 4;
  const out = new Uint8Array(height * stride);
  let i = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[i];
    i += 1;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[i];
      i += 1;
      const left = x >= 4 ? out[row + x - 4] : 0;
      const up = y ? out[prev + x] : 0;
      const ul = y && x >= 4 ? out[prev + x - 4] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) add = paeth(left, up, ul);
      out[row + x] = (value + add) & 255;
    }
  }
  return out;
}

function decodePng(file) {
  if (rawCache.has(file)) return rawCache.get(file);
  const job = (async () => {
    const buf = new Uint8Array(await (await globalThis.fetch(pixelUrl(...file.split("/")))).arrayBuffer());
    let p = 8;
    const idat = [];
    let width = 0;
    let height = 0;
    while (p < buf.length) {
      const len = (buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3];
      const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
      const data = buf.slice(p + 8, p + 8 + len);
      if (type === "IHDR") {
        width = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
        height = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
      } else if (type === "IDAT") idat.push(data);
      p += 12 + len;
    }
    const z = new Uint8Array(idat.reduce((n, part) => n + part.length, 0));
    let offset = 0;
    for (const part of idat) {
      z.set(part, offset);
      offset += part.length;
    }
    const stream = new globalThis.Blob([z]).stream().pipeThrough(new globalThis.DecompressionStream("deflate"));
    const raw = new Uint8Array(await new globalThis.Response(stream).arrayBuffer());
    return { width, height, pixels: unfilter(raw, width, height) };
  })();
  rawCache.set(file, job);
  return job;
}

export function warmStartPixels() {
  return Promise.all(Object.values(layout.elements).map((item) => decodePng(item.file)));
}

export function createAttract() {
  return {
    t: 0,
    frozen: false,
    npcX: 18,
    npcBlue: false,
    npcPause: 0,
    pinkX: 64,
    pinkPause: 0,
    blueX: 230,
    bluePause: 0,
    rng: mulberry32(7),
  };
}

export function attractFreeze(on) {
  attract.frozen = !!on;
  if (on) {
    attract.npcX = 18;
    attract.npcBlue = false;
    attract.npcPause = 0;
    attract.pinkX = 64;
    attract.pinkPause = 0;
    attract.blueX = 230;
    attract.bluePause = 0;
  }
}

export function setLoadCaption(text) {
  captionOverride = text || null;
}

export function loadSlots(done, total) {
  if (!total || done <= 0) return 0;
  if (done >= total) return 36;
  return Math.floor((36 * done) / total);
}

export function atlasWidth(text, face = font) {
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width += face.space_adv;
    else width += face.glyphs[ch]?.adv || 0;
  }
  return width;
}

export function startLayout() {
  return layout;
}

/** Blink is 400 ms on, 400 ms off. Snap to the on phase without moving anyone. */
export function holdStartExhaust() {
  attract.t = Math.floor(attract.t / 0.8) * 0.8;
}

/** Native rects of the actors that move, at the mockup and where they are now. */
export function startMoverBoxes() {
  if (!layout) return [];
  const boxes = [];
  const add = (file, x, y) => {
    const img = pixelImage(file);
    boxes.push({
      x,
      y,
      w: img?.naturalWidth || 44,
      h: img?.naturalHeight || 26,
    });
  };
  for (const [file, x, y] of layout.scene) {
    if (MOVERS[file]) add(file, x, y);
  }
  for (const item of sceneSprites(false)) {
    if (item.moving) add(item.file, item.x, item.y);
  }
  return boxes;
}

export function attractStaticPlaces() {
  return sceneSprites(false)
    .filter((item) => !item.moving)
    .map((item) => [item.file, item.x, item.y]);
}

function stepMover(world, dt) {
  const pause = () => 4 + world.rng() * 5;
  if (world.npcPause > 0) {
    world.npcPause = Math.max(0, world.npcPause - dt);
    if (world.npcPause === 0) {
      world.npcX = 400;
      world.npcBlue = world.rng() < 0.25;
    }
  } else {
    world.npcX -= 24 * dt;
    if (world.npcX < -44) world.npcPause = pause();
  }
  if (world.pinkPause > 0) {
    world.pinkPause = Math.max(0, world.pinkPause - dt);
    if (world.pinkPause === 0) world.pinkX = -12;
  } else {
    world.pinkX += 8 * dt;
    if (world.pinkX > 400) world.pinkPause = pause();
  }
  if (world.bluePause > 0) {
    world.bluePause = Math.max(0, world.bluePause - dt);
    if (world.bluePause === 0) world.blueX = 412;
  } else {
    world.blueX -= 8 * dt;
    if (world.blueX < -16) world.bluePause = pause();
  }
}

export function stepAttract(dt, reduced) {
  if (attract.frozen || reduced) return attract;
  attract.t += dt;
  stepMover(attract, dt);
  return attract;
}

function sceneSprites(reduced) {
  if (!layout) return [];
  const still = attract.frozen || reduced;
  const pinkFrame = still ? 0 : Math.floor(attract.t / 0.25) % 2;
  const blueFrame = still ? 1 : Math.floor(attract.t / 0.25) % 2;
  const list = [];
  for (const [file, x, y] of layout.scene) {
    const kind = MOVERS[file];
    if (kind === "npc") {
      const npcFile = !still && attract.npcBlue ? "car/npc-blue-left.png" : file;
      list.push({ file: npcFile, x: still ? x : Math.round(attract.npcX), y, moving: true });
    } else if (kind === "pink") {
      list.push({
        file: `world/sprites/ped-pink-right-${pinkFrame}.png`,
        x: still ? x : Math.round(attract.pinkX),
        y,
        moving: true,
      });
    } else if (kind === "blue") {
      list.push({
        file: `world/sprites/ped-blue-left-${blueFrame}.png`,
        x: still ? x : Math.round(attract.blueX),
        y,
        moving: true,
      });
    } else {
      list.push({ file, x, y, moving: false });
    }
  }
  return list;
}

/** Static scenery after a stretch of attract time. Actors are not in this list. */
export function staticAttract(seconds) {
  const world = createAttract();
  stepMover(world, seconds);
  return sceneSpritesFrom(world, false).filter((item) => !item.moving);
}

function sceneSpritesFrom(world, reduced) {
  const saved = attract;
  attract = world;
  const list = sceneSprites(reduced);
  attract = saved;
  return list;
}

function blit(ctx, file, x, y, dw, dh) {
  const img = pixelImage(file);
  if (!img || !img.naturalWidth) return null;
  const w = dw || img.naturalWidth;
  const h = dh || img.naturalHeight;
  ctx.imageSmoothingEnabled = false;
  notePixelSmoothing(false);
  ctx.drawImage(img, Math.round(x) * SCALE, Math.round(y) * SCALE, w * SCALE, h * SCALE);
  return { w, h };
}

function over(src, dst) {
  const sa = src[3] / 255;
  const da = dst[3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return [0, 0, 0, 0];
  const mix = (sc, dc) => Math.round(((sc / 255) * sa + (dc / 255) * da * (1 - sa)) / outA * 255);
  return [mix(src[0], dst[0]), mix(src[1], dst[1]), mix(src[2], dst[2]), Math.round(outA * 255)];
}

/** Source-over that matches the mockup's PIL composite. Canvas drawImage is off by one on soft shadows. */
function blitOver(ctx, file, nx, ny, nw, nh) {
  const decoded = rawCache.get(file);
  const ready = decoded && typeof decoded.then !== "function";
  if (!ready) {
    decodePng(file).then((bitmap) => {
      rawCache.set(file, bitmap);
      fastBake = null;
      exactCache = null;
      dimSoundChip = null;
    });
    blit(ctx, file, nx, ny, nw, nh);
    return;
  }
  const src = decoded.pixels;
  const dest = ctx.getImageData(nx * SCALE, ny * SCALE, nw * SCALE, nh * SCALE);
  const dw = nw * SCALE;
  for (let j = 0; j < nh; j += 1) {
    for (let i = 0; i < nw; i += 1) {
      const si = (j * nw + i) * 4;
      const ox = i * SCALE;
      const oy = j * SCALE;
      const di = (oy * dw + ox) * 4;
      const pixel = over(
        [src[si], src[si + 1], src[si + 2], src[si + 3]],
        [dest.data[di], dest.data[di + 1], dest.data[di + 2], dest.data[di + 3]],
      );
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const ii = ((oy + dy) * dw + ox + dx) * 4;
          dest.data[ii] = pixel[0];
          dest.data[ii + 1] = pixel[1];
          dest.data[ii + 2] = pixel[2];
          dest.data[ii + 3] = pixel[3];
        }
      }
    }
  }
  ctx.putImageData(dest, nx * SCALE, ny * SCALE);
}

function blitElement(ctx, key) {
  const item = layout.elements[key];
  if (!item) return;
  blitOver(ctx, item.file, item.x, item.y, item.w, item.h);
}

function drawAtlas(ctx, text, originX, originY) {
  const img = pixelImage(layout.loadbar.label_font);
  if (!img) return atlasWidth(text);
  let pen = originX;
  for (const ch of text) {
    if (ch === " ") {
      pen += font.space_adv;
      continue;
    }
    const glyph = font.glyphs[ch];
    if (!glyph) continue;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      img,
      glyph.x,
      0,
      font.cell_w,
      font.cell_h,
      pen * SCALE,
      (originY + font.cell_y_offset) * SCALE,
      font.cell_w * SCALE,
      font.cell_h * SCALE,
    );
    pen += glyph.adv;
  }
  return pen - originX;
}

export function drawAtlasText(ctx, text, x, y) {
  drawAtlas(ctx, text, x, y);
}

function loadCaption(progress) {
  if (captionOverride) return captionOverride;
  if (progress.error) return "НЕ ЗАГРУЗИЛОСЬ · ЕЩЁ РАЗ";
  if (progress.ready) return `ГОТОВО · ${progress.total}/${progress.total}`;
  return `${progress.done}/${progress.total || 0}`;
}

function drawLoadBar(ctx, progress, skipFrame) {
  if (!skipFrame) blitElement(ctx, "loadbar-frame");
  const slots = captionOverride ? 36 : loadSlots(progress.done, progress.total);
  const seg = layout.elements["loadbar-segment"];
  const img = pixelImage(seg.file);
  if (img) {
    for (let i = 0; i < slots; i += 1) {
      const x = layout.loadbar.segment_x0 + layout.loadbar.segment_step * i;
      const crop = i === layout.loadbar.slots - 1 ? layout.loadbar.last_slot_width : seg.w;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        img,
        0,
        0,
        crop,
        seg.h,
        x * SCALE,
        layout.loadbar.segment_y * SCALE,
        crop * SCALE,
        seg.h * SCALE,
      );
    }
  }
  const text = loadCaption(progress);
  const lw = atlasWidth(text);
  const x = 40 + Math.floor((180 - lw) / 2);
  const x0 = x - 3;
  const x1 = 40 + Math.floor((180 + lw) / 2) + 2;
  ctx.fillStyle = CREAM;
  ctx.fillRect(x0 * SCALE, 212 * SCALE, (x1 - x0 + 1) * SCALE, 9 * SCALE);
  drawAtlas(ctx, text, x, 211);
  return { text, x, y: 212, w: x1 - x0 + 1, h: 9 };
}

const GRASS = [92, 184, 122];
let dimSoundChip = null;

function isChipGrass(r, g, b, a) {
  return a === 0 || (a === 255 && r === GRASS[0] && g === GRASS[1] && b === GRASS[2]);
}

/** Dim the chip once. Grass baked into the corners stays the lawn colour. */
function dimmedSoundCanvas() {
  if (dimSoundChip) return dimSoundChip;
  const sound = layout.elements["chip-sound"];
  const decoded = rawCache.get(sound.file);
  if (!decoded || typeof decoded.then === "function") return null;
  const canvas = document.createElement("canvas");
  canvas.width = sound.w * SCALE;
  canvas.height = sound.h * SCALE;
  const img = canvas.getContext("2d").createImageData(canvas.width, canvas.height);
  const src = decoded.pixels;
  for (let j = 0; j < sound.h; j += 1) {
    for (let i = 0; i < sound.w; i += 1) {
      const si = (j * sound.w + i) * 4;
      const r = src[si];
      const g = src[si + 1];
      const b = src[si + 2];
      const a = src[si + 3];
      const keep = isChipGrass(r, g, b, a);
      const pr = keep ? r : Math.round(r * 0.55);
      const pg = keep ? g : Math.round(g * 0.55);
      const pb = keep ? b : Math.round(b * 0.55);
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const ii = ((j * SCALE + dy) * canvas.width + i * SCALE + dx) * 4;
          img.data[ii] = pr;
          img.data[ii + 1] = pg;
          img.data[ii + 2] = pb;
          img.data[ii + 3] = a;
        }
      }
    }
  }
  const gctx = canvas.getContext("2d");
  gctx.putImageData(img, 0, 0);
  dimSoundChip = canvas;
  return canvas;
}

function drawDim(ctx, _file, x, y) {
  const chip = dimmedSoundCanvas();
  if (!chip) return;
  ctx.imageSmoothingEnabled = false;
  notePixelSmoothing(false);
  ctx.drawImage(chip, x * SCALE, y * SCALE);
}

function pushLabel(sink, text, x, y, w, h) {
  sink?.labels?.push({ text, x: x * SCALE, y: y * SCALE, w: w * SCALE, h: h * SCALE, cx: (x + w / 2) * SCALE, cy: (y + h / 2) * SCALE });
}

function pushSpot(sink, id, rect) {
  const [x0, y0, x1, y1] = rect;
  sink?.spots?.push({
    id,
    x: x0 * SCALE,
    y: y0 * SCALE,
    w: (x1 - x0 + 1) * SCALE,
    h: (y1 - y0 + 1) * SCALE,
  });
}

function paintExact(ctx, state) {
  const reduced = !!state.save?.settings?.reducedMotion;
  const progress = pixelProgress();
  const ready = progress.ready || !!captionOverride;
  ctx.imageSmoothingEnabled = false;
  notePixelSmoothing(false);
  const ground = layout.elements["street-ground"];
  blit(ctx, ground.file, ground.x, ground.y, ground.w, ground.h);
  const sprites = sceneSprites(reduced)
    .map((item) => {
      const img = pixelImage(item.file);
      const h = img?.naturalHeight || 16;
      return { ...item, bottom: item.y + h };
    })
    .sort((a, b) => a.bottom - b.bottom);
  for (const item of sprites) blit(ctx, item.file, item.x, item.y);
  const exhaustOn = attract.frozen || reduced || Math.floor(attract.t / 0.4) % 2 === 0;
  if (exhaustOn) blitElement(ctx, "exhaust-0");
  blitElement(ctx, "logo-plate");
  blitElement(ctx, "logo-title");
  blitElement(ctx, "logo-badge");
  blitElement(ctx, "logo-tagline");
  blitElement(ctx, "cabin-frame");
  blit(ctx, layout["cabin-pose"].file, layout["cabin-pose"].x, layout["cabin-pose"].y);
  blitElement(ctx, "bubble-poekhali");
  if (ready) {
    blitElement(ctx, "btn-start-base");
    blitElement(ctx, "btn-start-label");
    blitElement(ctx, "icon-hand-tap");
  }
  drawLoadBar(ctx, progress);
  if (ready) {
    blitElement(ctx, "chip-garage");
    const sound = layout.elements["chip-sound"];
    if (state.save?.settings?.sound === false) drawDim(ctx, sound.file, sound.x, sound.y);
    else blitElement(ctx, "chip-sound");
  }
}

function spriteBox(item) {
  const img = pixelImage(item.file);
  const h = img?.naturalHeight || 16;
  const w = img?.naturalWidth || 16;
  return { ...item, w, h, bottom: item.y + h };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

let fastBake = null;

function buildCabinCard() {
  const frame = layout.elements["cabin-frame"];
  const pose = layout["cabin-pose"];
  const base = document.createElement("canvas");
  base.width = 1600;
  base.height = 900;
  const g = base.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  const ground = layout.elements["street-ground"];
  blit(g, ground.file, ground.x, ground.y, ground.w, ground.h);
  const statics = sceneSprites(false).filter((item) => !item.moving).map(spriteBox).sort((a, b) => a.bottom - b.bottom);
  for (const item of statics) blit(g, item.file, item.x, item.y);
  blitElement(g, "cabin-frame");
  blit(g, pose.file, pose.x, pose.y);
  blitElement(g, "bubble-poekhali");
  const card = document.createElement("canvas");
  card.width = frame.w * SCALE;
  card.height = frame.h * SCALE;
  card.getContext("2d").drawImage(
    base,
    frame.x * SCALE,
    frame.y * SCALE,
    card.width,
    card.height,
    0,
    0,
    card.width,
    card.height,
  );
  return { canvas: card, x: frame.x * SCALE, y: frame.y * SCALE };
}

function buildFastBake(ready, soundOff) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  const ground = layout.elements["street-ground"];
  blit(g, ground.file, ground.x, ground.y, ground.w, ground.h);
  const statics = sceneSprites(false).filter((item) => !item.moving).map(spriteBox).sort((a, b) => a.bottom - b.bottom);
  for (const item of statics) blit(g, item.file, item.x, item.y);
  const keys = ["logo-plate", "logo-title", "logo-badge", "logo-tagline", "loadbar-frame"];
  if (ready) keys.push("btn-start-base", "btn-start-label", "icon-hand-tap", "chip-garage", "chip-sound");
  for (const key of keys) {
    if (key === "chip-sound" && soundOff) {
      const sound = layout.elements["chip-sound"];
      drawDim(g, sound.file, sound.x, sound.y);
    } else blitElement(g, key);
  }
  return { canvas, cabin: buildCabinCard(), ready, soundOff };
}

function drawFast(ctx, state) {
  const reduced = !!state.save?.settings?.reducedMotion;
  const progress = pixelProgress();
  const ready = progress.ready || !!captionOverride;
  const soundOff = state.save?.settings?.sound === false;
  if (!fastBake || fastBake.ready !== ready || fastBake.soundOff !== soundOff) {
    fastBake = buildFastBake(ready, soundOff);
  }
  ctx.imageSmoothingEnabled = false;
  notePixelSmoothing(false);
  ctx.drawImage(fastBake.canvas, 0, 0);
  const sprites = sceneSprites(reduced).map(spriteBox).sort((a, b) => a.bottom - b.bottom);
  const movers = sprites.filter((item) => item.moving);
  for (const item of movers) blit(ctx, item.file, item.x, item.y);
  for (const item of sprites) {
    if (item.moving) continue;
    if (movers.some((mover) => mover.bottom < item.bottom && rectsOverlap(mover, item))) blit(ctx, item.file, item.x, item.y);
  }
  ctx.drawImage(fastBake.cabin.canvas, fastBake.cabin.x, fastBake.cabin.y);
  const exhaustOn = attract.frozen || reduced || Math.floor(attract.t / 0.4) % 2 === 0;
  if (exhaustOn) {
    const puff = layout.elements["exhaust-0"];
    blit(ctx, puff.file, puff.x, puff.y, puff.w, puff.h);
  }
  drawLoadBar(ctx, progress, true);
}

let exactCache = null;

function drawExactCached(ctx, state) {
  const progress = pixelProgress();
  const ready = progress.ready || !!captionOverride;
  const soundOff = state.save?.settings?.sound === false;
  const caption = loadCaption(progress);
  const exhaustOn = attract.frozen || !!state.save?.settings?.reducedMotion || Math.floor(attract.t / 0.4) % 2 === 0;
  const key = `${ready}|${soundOff}|${caption}|${exhaustOn}`;
  if (!exactCache || exactCache.key !== key) {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    paintExact(g, state);
    exactCache = { key, canvas };
  }
  ctx.imageSmoothingEnabled = false;
  notePixelSmoothing(false);
  ctx.drawImage(exactCache.canvas, 0, 0);
}

function pushChrome(sink, state) {
  const progress = pixelProgress();
  const ready = progress.ready || !!captionOverride;
  if (ready) {
    pushSpot(sink, "start", layout.hitboxes.start);
    pushLabel(sink, "ПОЕХАЛИ!", 40, 182, 183, 28);
    pushSpot(sink, "garage", layout.hitboxes.garage);
    pushSpot(sink, "sound", layout.hitboxes.sound);
    pushLabel(sink, "ГАРАЖ", 270, 186, 48, 17);
    pushLabel(sink, state.save?.settings?.sound === false ? "Звук: выкл" : "Звук: вкл", 322, 186, 49, 17);
  }
  const caption = loadCaption(progress);
  const lw = atlasWidth(caption);
  const x = 40 + Math.floor((180 - lw) / 2);
  pushLabel(sink, caption, x - 3, 212, Math.floor((180 + lw) / 2) + 2 - (x - 3) + 1, 9);
  if (progress.error) pushSpot(sink, "reload", [40, 211, 220, 221]);
  pushLabel(sink, "Brake It, Anton", 17, 7, 110, 49);
  pushLabel(sink, "Он газует. Ты жмёшь тормоз.", 14, 59, 185, 12);
}

export function drawPixelStart(ctx, state, sink) {
  if (startFailed) return false;
  if (!layout || !font) return true;
  const still = attract.frozen || !!state.save?.settings?.reducedMotion;
  if (still) drawExactCached(ctx, state);
  else drawFast(ctx, state);
  pushChrome(sink, state);
  return true;
}

/** `px` is whole screen pixels per font pixel. Shrinks until the line fits. */
export function drawAtlasCentered(ctx, text, x, y, w, h, px) {
  if (!font || !layout) return false;
  const img = pixelImage(layout.loadbar.label_font);
  if (!img) return false;
  const scale = Math.max(1, px | 0);
  const textW = atlasWidth(text) * scale;
  const textH = 9 * scale;
  if ((textW > w || textH > h) && scale > 1) return drawAtlasCentered(ctx, text, x, y, w, h, scale - 1);
  let pen = x + Math.round((w - textW) / 2);
  const top = y + Math.round((h - textH) / 2);
  ctx.imageSmoothingEnabled = false;
  for (const ch of text) {
    if (ch === " ") {
      pen += font.space_adv * scale;
      continue;
    }
    const glyph = font.glyphs[ch];
    if (!glyph) continue;
    ctx.drawImage(
      img,
      glyph.x,
      0,
      font.cell_w,
      font.cell_h,
      pen,
      top + font.cell_y_offset * scale,
      font.cell_w * scale,
      font.cell_h * scale,
    );
    pen += glyph.adv * scale;
  }
  return true;
}

export function reloadStartArt() {
  fastBake = null;
  exactCache = null;
  dimSoundChip = null;
  return retryPixelLoad();
}
