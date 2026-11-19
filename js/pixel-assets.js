/**
 * Loads the approved pixel package. Node tests have no Image, so they
 * stay on the old renderer. A failed file keeps that fallback too.
 */

const ROOT = new URL("../assets/pixel/", import.meta.url);

let manifest = null;
let images = new Map();
let loading = null;
let failed = false;
let logged = false;
let lastSmoothing = true;
let progress = { done: 0, total: 0, broken: [], tries: {}, gaveUp: false };
let extra = { done: 0, total: 0 };
let packReady = false;
let startFiles = [];
let startSeen = false;

function collectList(value, out = new Set()) {
  collectPngs(value, out);
  return [...out];
}

function assetURL(file) {
  return new URL(file, ROOT).href;
}

function collectPngs(value, out) {
  if (typeof value === "string" && value.endsWith(".png")) out.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectPngs(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectPngs(item, out));
}

function loadImage(file) {
  const img = new globalThis.Image();
  // The pixel pack is small. Ask for it ahead of the classic pictures.
  img.fetchPriority = "high";
  img.src = assetURL(file);
  return img;
}

function waitImage(img) {
  if (img.complete && img.naturalWidth) return Promise.resolve(true);
  return new Promise((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  });
}

export function pixelManifest() {
  return manifest;
}

export function pixelImage(file) {
  return images.get(file) || null;
}

function everyImageReady() {
  return images.size > 0 && [...images.values()].every((img) => img.complete && img.naturalWidth > 0);
}

export function pixelReady() {
  // The start group lands first. The world stays classic until the whole pack is in.
  return packReady && !failed && everyImageReady();
}

/** Every picture the start screen bakes is in. The bake waits on this, not on the whole pack. */
export function pixelStartReady() {
  if (startSeen) return true;
  startSeen = startFiles.length > 0 && startFiles.every((file) => {
    const img = images.get(file);
    return !!img && img.complete && img.naturalWidth > 0;
  });
  return startSeen;
}

export function notePixelSmoothing(value) {
  lastSmoothing = value;
}

export function pixelBlitSmoothing() {
  return lastSmoothing;
}

export function classicArtForced(state) {
  if (state?.save?.settings?.art === "classic") return true;
  if (typeof location !== "undefined" && /(?:^|[?&])art=classic(?:&|$)/.test(location.search || "")) return true;
  return false;
}

export function usePixel(state) {
  return pixelReady() && !classicArtForced(state);
}

export function noteExtraProgress(done, total) {
  extra = { done, total };
}

export function pixelProgress() {
  return {
    done: progress.done + extra.done,
    total: progress.total + extra.total,
    ready: pixelReady() && extra.done >= extra.total,
    error: progress.broken.length > 0 && !pixelReady(),
    gaveUp: progress.gaveUp,
    broken: progress.broken.slice(),
  };
}

async function loadOne(file) {
  const img = loadImage(file);
  images.set(file, img);
  const ok = await waitImage(img);
  progress.tries[file] = (progress.tries[file] || 0) + 1;
  return ok;
}

function bump(onProgress) {
  progress.done += 1;
  onProgress?.(progress.done, progress.total);
}

export function whenPixelReady(onProgress) {
  if (typeof globalThis.Image !== "function" || typeof globalThis.fetch !== "function") {
    return Promise.resolve(false);
  }
  if (!loading) {
    loading = (async () => {
      const response = await globalThis.fetch(assetURL("manifest.json"));
      if (!response.ok) throw new Error("pixel manifest");
      manifest = await response.json();
      const all = collectList(manifest);
      const start = collectList(manifest.start || {});
      startFiles = start;
      progress.total = all.length + 1;
      progress.done = 0;
      progress.broken = [];
      const rest = all.filter((file) => !start.includes(file));
      await Promise.all(start.map(async (file) => {
        const ok = await loadOne(file);
        if (!ok) progress.broken.push(file);
        bump(onProgress);
      }));
      if (typeof globalThis.window !== "undefined") globalThis.window.dispatchEvent(new globalThis.Event("anton-start-ready"));
      await Promise.all(rest.map(async (file) => {
        const ok = await loadOne(file);
        if (!ok) progress.broken.push(file);
        bump(onProgress);
      }));
      try {
        const face = new FontFace("Pixeloid Sans", `url(${assetURL("fonts/PixeloidSans-Bold.ttf")})`);
        await face.load();
        document.fonts.add(face);
      } catch (error) {
        console.warn("Pixeloid did not load.", error);
        progress.broken.push("fonts/PixeloidSans-Bold.ttf");
      }
      bump(onProgress);
      if (progress.broken.length) throw new Error("pixel image");
      packReady = true;
      return pixelReady();
    })().catch((error) => {
      if (!progress.broken.length) {
        failed = true;
        progress.gaveUp = true;
      }
      if (!logged && progress.gaveUp) {
        logged = true;
        console.warn("Pixel art failed to load; using the classic renderer.", error);
      }
      return false;
    });
  }
  return loading;
}

/** Try only the files that failed. Three failures in total and the classic title stays. */
export async function retryPixelLoad(onProgress) {
  if (pixelReady() || progress.gaveUp) return pixelReady();
  const batch = progress.broken.slice();
  progress.broken = [];
  await Promise.all(batch.map(async (file) => {
    if (!file.endsWith(".png")) return;
    const ok = await loadOne(file);
    if (!ok) progress.broken.push(file);
  }));
  if (!progress.broken.length) packReady = everyImageReady();
  const exhausted = progress.broken.some((file) => (progress.tries[file] || 0) >= 3);
  if (exhausted) {
    failed = true;
    progress.gaveUp = true;
    if (!logged) {
      logged = true;
      console.warn("Pixel art failed to load; using the classic renderer.");
    }
  }
  onProgress?.(progress.done, progress.total);
  return pixelReady();
}
