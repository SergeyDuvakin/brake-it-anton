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

export function pixelReady() {
  return !failed && images.size > 0 && [...images.values()].every((img) => img.complete && img.naturalWidth > 0);
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

export function whenPixelReady() {
  if (typeof globalThis.Image !== "function" || typeof globalThis.fetch !== "function") {
    return Promise.resolve(false);
  }
  if (!loading) {
    loading = (async () => {
      const response = await globalThis.fetch(assetURL("manifest.json"));
      if (!response.ok) throw new Error("pixel manifest");
      manifest = await response.json();
      const files = new Set();
      collectPngs(manifest, files);
      const jobs = [];
      for (const file of files) {
        const img = loadImage(file);
        images.set(file, img);
        jobs.push(waitImage(img));
      }
      try {
        const face = new FontFace("Pixeloid Sans", `url(${assetURL("fonts/PixeloidSans-Bold.ttf")})`);
        await face.load();
        document.fonts.add(face);
      } catch (error) {
        console.warn("Pixeloid did not load.", error);
      }
      const ok = (await Promise.all(jobs)).every(Boolean);
      if (!ok) throw new Error("pixel image");
      return pixelReady();
    })().catch((error) => {
      failed = true;
      if (!logged) {
        logged = true;
        console.warn("Pixel art failed to load; using the classic renderer.", error);
      }
      return false;
    });
  }
  return loading;
}
