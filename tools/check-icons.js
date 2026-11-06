import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function u32(buf, offset) {
  return buf[offset] * 16777216 + buf[offset + 1] * 65536 + buf[offset + 2] * 256 + buf[offset + 3];
}

function pngInfo(buf) {
  if (buf.length < 29) return null;
  for (let i = 0; i < PNG_SIG.length; i += 1) {
    if (buf[i] !== PNG_SIG[i]) return null;
  }
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const len = u32(buf, offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    chunks.push(type);
    offset += 12 + len;
    if (type === "IEND") break;
  }
  return {
    width: u32(buf, 16),
    height: u32(buf, 20),
    bit: buf[24],
    color: buf[25],
    interlace: buf[28],
    chunks,
  };
}

const pngs = [
  ["assets/icon-180.png", 180],
  ["assets/icon-192.png", 192],
  ["assets/icon-512.png", 512],
  ["assets/icon-1024.png", 1024],
];

for (const [rel, size] of pngs) {
  const file = path.join(root, rel);
  if (!existsSync(file)) fail(`missing ${rel}`);
  const info = pngInfo(readFileSync(file));
  if (!info) fail(`${rel} is not image/png`);
  if (info.width !== size || info.height !== size) {
    fail(`${rel} is ${info.width}x${info.height}, expected ${size}x${size}`);
  }
  if (info.bit !== 8 || info.color !== 2 || info.interlace !== 0 || info.chunks.includes("tRNS")) {
    fail(`${rel} must stay a square opaque RGB PNG`);
  }
  if (!info.chunks.includes("IEND")) fail(`${rel} is truncated`);
}

const svgRel = "assets/app-icon.svg";
const svgPath = path.join(root, svgRel);
if (!existsSync(svgPath)) fail(`missing ${svgRel}`);
const svg = readFileSync(svgPath, "utf8");
if (!svg.includes("<svg")) fail(`${svgRel} is not image/svg+xml`);
const withoutNamespace = svg.replace('xmlns="http://www.w3.org/2000/svg"', "");
if (/https?:\/\//.test(withoutNamespace)) fail(`${svgRel} references an external URL`);
for (const entry of svg.match(/url\(\s*[^)]+\)/g) || []) {
  if (!/^url\(\s*['"]?#/.test(entry) && !/^url\(\s*['"]?data:/.test(entry)) {
    fail(`${svgRel} has an external url(): ${entry.slice(0, 48)}`);
  }
}

const htmlPath = path.join(root, "index.html");
if (!existsSync(htmlPath)) fail("missing index.html");
const html = readFileSync(htmlPath, "utf8");
const links = [
  'rel="icon" href="./assets/icon-192.png" type="image/png" sizes="192x192"',
  'rel="icon" href="./assets/app-icon.svg" type="image/svg+xml"',
  'rel="apple-touch-icon" href="./assets/icon-180.png" type="image/png" sizes="180x180"',
  'rel="manifest" href="./manifest.webmanifest"',
  'name="theme-color" content="#FAC83C"',
  'name="mobile-web-app-capable" content="yes"',
  'name="apple-mobile-web-app-capable" content="yes"',
  'name="apple-mobile-web-app-status-bar-style" content="black-translucent"',
  'name="apple-mobile-web-app-title" content="Anton"',
  "Поделиться → На экран «Домой» → Открыть как веб-приложение",
];
for (const link of links) {
  if (!html.includes(link)) fail(`index.html missing ${link}`);
}

const manifestPath = path.join(root, "manifest.webmanifest");
if (!existsSync(manifestPath)) fail("missing manifest.webmanifest");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const expect = {
  name: "Brake It, Anton",
  short_name: "Anton",
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: "#FAC83C",
  theme_color: "#FAC83C",
};
for (const [key, value] of Object.entries(expect)) {
  if (manifest[key] !== value) fail(`manifest ${key} is ${JSON.stringify(manifest[key])}`);
}
const expectedIcons = [
  ["./assets/icon-180.png", "180x180"],
  ["./assets/icon-192.png", "192x192"],
  ["./assets/icon-512.png", "512x512"],
  ["./assets/icon-1024.png", "1024x1024"],
];
if (!Array.isArray(manifest.icons) || manifest.icons.length !== expectedIcons.length) {
  fail("manifest icons do not match the published PNG set");
}
expectedIcons.forEach(([src, sizes], index) => {
  const icon = manifest.icons[index];
  if (!icon || icon.src !== src || icon.sizes !== sizes || icon.type !== "image/png" || icon.purpose !== "any") {
    fail(`manifest icon ${src} is wrong`);
  }
});

const gamePath = path.join(root, "js/game.js");
if (existsSync(gamePath)) {
  const game = readFileSync(gamePath, "utf8");
  if (game.includes("./home-hint.js") && !existsSync(path.join(root, "js/home-hint.js"))) {
    fail("js/home-hint.js is missing beside js/game.js");
  }
}

const servePath = path.join(root, "tools/serve.js");
if (existsSync(servePath)) {
  const serve = readFileSync(servePath, "utf8");
  for (const type of ['".png": "image/png"', '".svg": "image/svg+xml"', '".webmanifest": "application/manifest+json"']) {
    if (!serve.includes(type)) fail(`tools/serve.js missing ${type}`);
  }
}

console.log(`icons ok (${pngs.length} png, svg, manifest)`);
