/**
 * Approved cabin panels. The backdrop never moves. Anton crossfades, and the
 * sleep chain plays the regenerated V3 frames. The phone pose is a still.
 */

import { expressionId } from "./physics.js";

export const CABIN_CLIP = { x: 1056, y: 24, w: 520, h: 852 };
export const CABIN_DRAW_W = 520;

export const CABIN_POSES = [
  "drive",
  "phone",
  "drowsy",
  "asleep",
  "wake",
  "stow",
  "earnest",
  "preen",
  "annoyed",
  "angry",
  "furious",
  "ashamed",
  "proud",
  "belted",
  "focused",
];

const PAIRS = {
  "drive>drowsy": "drive-to-drowsy",
  "drowsy>asleep": "drowsy-to-asleep",
  "asleep>wake": "asleep-to-wake",
  "wake>drive": "wake-to-drive",
};

const FADE_MS = 280;

let manifest = null;
const poseImages = {};
const clipImages = {};
let loading = null;
let motion = { pose: null, from: null, t0: 0, lastNow: -1, clip: null };

function assetURL(path) {
  return new URL(`../assets/cabin/${path}`, import.meta.url).href;
}

function loadImage(path) {
  const ImageCtor = globalThis.Image;
  if (typeof ImageCtor !== "function") return null;
  const img = new ImageCtor();
  img.decoding = "async";
  img.src = assetURL(path);
  return img;
}

function waitImage(img) {
  if (!img) return Promise.resolve();
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });
}

export function whenCabinReady() {
  if (typeof globalThis.Image !== "function") return Promise.resolve(false);
  if (!loading) {
    loading = (async () => {
      const response = await globalThis.fetch(assetURL("manifest.json"));
      if (!response.ok) return false;
      manifest = await response.json();
      const jobs = [];
      for (const pose of manifest.poses || []) {
        const img = loadImage(`poses/${pose}.jpg`);
        poseImages[pose] = img;
        jobs.push(waitImage(img));
      }
      await Promise.all(jobs);
      return cabinReady();
    })().catch(() => false);
  }
  return loading;
}

export function cabinReady() {
  const poses = manifest?.poses || [];
  return poses.length > 0 && poses.every((pose) => ready(poseImages[pose]));
}

function ready(img) {
  return !!(img && img.complete && img.naturalWidth);
}

function ensureClip(name) {
  if (!name || clipImages[name] || !manifest?.clips?.[name]) return;
  const count = manifest.clips[name];
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    frames.push(loadImage(`sleep/${name}/${String(i).padStart(2, "0")}.jpg`));
  }
  clipImages[name] = frames;
}

/**
 * Which approved still to show. `forced` is a pose name from a screen
 * (the title uses preen). Countdown, and the first moment of a calm
 * drive, is the belted still.
 */
export function cabinPoseId(sim, phase, forced) {
  if (forced) return forced === "calm" ? "drive" : forced;
  if (phase === "result") return sim?.success ? "proud" : "ashamed";
  if (phase === "countdown") return "belted";
  const face = expressionId(sim || {});
  if (phase === "drive" && (sim?.t || 0) < 1.15 && face === "calm") return "belted";
  if (face === "calm") return "drive";
  if (CABIN_POSES.includes(face)) return face;
  return "drive";
}

function artHeight(img) {
  const w = img?.naturalWidth || 864;
  const h = img?.naturalHeight || 1152;
  return (CABIN_DRAW_W * h) / w;
}

function blit(ctx, img, alpha) {
  if (!ready(img) || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.drawImage(img, CABIN_CLIP.x, CABIN_CLIP.y, CABIN_DRAW_W, artHeight(img));
  ctx.restore();
}

function stepMotion(pose, now, reduced) {
  const stalled = motion.lastNow < 0 || !(now > motion.lastNow);
  if (stalled || reduced || motion.pose === null) {
    motion = { pose, from: null, t0: now, lastNow: now, clip: null };
    return { pose, from: null, fade: 1, clip: null, frame: 0, frac: 0 };
  }
  if (pose !== motion.pose) {
    const clip = PAIRS[`${motion.pose}>${pose}`] || null;
    if (clip) ensureClip(clip);
    motion = { pose, from: motion.pose, t0: now, lastNow: now, clip };
  } else {
    motion.lastNow = now;
  }
  const elapsed = Math.max(0, now - motion.t0);
  const count = motion.clip ? manifest?.clips?.[motion.clip] : 0;
  if (motion.clip && count > 1) {
    const duration = (manifest.durations?.[motion.clip] || count / (manifest.fps || 8)) * 1000;
    const u = Math.min(1, elapsed / duration);
    const pos = u * (count - 1);
    const frame = Math.min(count - 1, Math.floor(pos));
    const frac = Math.min(1, Math.max(0, pos - frame));
    if (u >= 1) {
      motion.from = null;
      motion.clip = null;
      return { pose, from: null, fade: 1, clip: null, frame: 0, frac: 0 };
    }
    return { pose, from: motion.from, fade: 1, clip: motion.clip, frame, frac };
  }
  const fade = Math.min(1, elapsed / FADE_MS);
  if (fade >= 1) motion.from = null;
  return { pose, from: fade >= 1 ? null : motion.from, fade, clip: null, frame: 0, frac: 0 };
}

function clipFrameReady(name, index) {
  return ready(clipImages[name]?.[index]);
}

export function paintCabin(ctx, sim, state) {
  const phase = state.session?.phase || "drive";
  const pose = cabinPoseId(sim, phase, state.pose);
  const reduced = !!state.save?.settings?.reducedMotion;
  const now = Number(state.now) || 0;
  const vis = stepMotion(pose, now, reduced);
  ctx.save();
  ctx.beginPath();
  ctx.rect(CABIN_CLIP.x, CABIN_CLIP.y, CABIN_CLIP.w, CABIN_CLIP.h);
  ctx.clip();
  ctx.fillStyle = "#F3D48A";
  ctx.fillRect(CABIN_CLIP.x, CABIN_CLIP.y, CABIN_CLIP.w, CABIN_CLIP.h);
  const clipReady = vis.clip && clipFrameReady(vis.clip, vis.frame);
  if (clipReady) {
    const frames = clipImages[vis.clip];
    blit(ctx, frames[vis.frame], 1);
    if (vis.frac > 0 && ready(frames[vis.frame + 1])) blit(ctx, frames[vis.frame + 1], vis.frac);
  } else if (vis.from && ready(poseImages[vis.from])) {
    blit(ctx, poseImages[vis.from], 1);
    blit(ctx, poseImages[vis.pose], vis.fade);
  } else {
    blit(ctx, poseImages[vis.pose], 1);
  }
  ctx.restore();
  return pose;
}

/** Result card portrait. Upper cabin, so the face and the drawn hands stay in frame. */
export function drawCabinMedal(ctx, pose, rect) {
  const img = poseImages[pose];
  if (!ready(img)) return false;
  const sw = img.naturalWidth;
  const sh = Math.max(1, Math.round(img.naturalHeight * 0.78));
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  const scale = Math.max(rect.w / sw, rect.h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(img, 0, 0, sw, sh, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh);
  ctx.restore();
  return true;
}
