/**
 * Original flat ink. One projection for the road, the marks and the props.
 * No sprites, no gradients, no borrowed characters.
 */

import { PALETTE as P } from "./config.js";
import { expressionId, moodGlyph, moodWord, repairInvoice } from "./physics.js";
import { VIEW, project } from "./road.js";
import { hazardWorldX } from "./sim.js";

let spots = [];
let labels = [];

function font(px, display = false) {
  return display ? `${px}px "Rubik Mono One", sans-serif` : `700 ${px}px "Balsamiq Sans", sans-serif`;
}

function ink(ctx, width = 6) {
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Text centered in its own box. Nothing is drawn without a string. */
function paintCenter(ctx, text, x, y, w, h, size, color = P.INK, display = false, record = false) {
  const shown = String(text);
  let px = size;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  while (px > 12) {
    ctx.font = font(px, display);
    if (ctx.measureText(shown).width <= Math.max(8, w - 16)) break;
    px -= 1;
  }
  ctx.fillStyle = color;
  ctx.fillText(shown, x + w / 2, y + h / 2);
  if (record) labels.push({ text: shown, x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
}

function button(ctx, id, x, y, w, h, text, kind = "paper") {
  spots.push({ id, x, y, w, h });
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = kind === "primary" ? P.TEAL : kind === "ink" ? P.INK : P.PAPER;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();
  paintCenter(ctx, text, x, y, w, h, 24, kind === "ink" ? P.YEL : P.INK, false, true);
}

function hash(n) {
  let x = Math.imul(n | 0, 0x9e3779b1);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function panel(ctx, x, y, w, h, fill) {
  roundRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = fill;
  ctx.fill();
  ink(ctx, 8);
  ctx.stroke();
}

export function render(ctx, state) {
  spots = [];
  labels = [];
  ctx.clearRect(0, 0, 1600, 900);
  ctx.fillStyle = P.PAPER;
  ctx.fillRect(0, 0, 1600, 900);
  if (state.screen === "garage") drawGarage(ctx, state);
  else if (state.screen === "title") drawTitle(ctx, state);
  else drawPlay(ctx, state);
  if (state.notice) {
    roundRect(ctx, 360, 18, 880, 42, 12);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    paintCenter(ctx, state.notice, 360, 18, 880, 42, 18, P.INK, false, true);
  }
  return { spots, labels };
}

function drawTitle(ctx, state) {
  const boil = state.save.settings.reducedMotion ? 0 : Math.floor(state.now / 110) % 2;
  drawWorld(ctx, state.preview, boil, false);
  panel(ctx, 1056, 24, 520, 852, P.CABIN);
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(1056, 24, 520, 156);
  ink(ctx, 6);
  ctx.beginPath();
  ctx.moveTo(1056, 180);
  ctx.lineTo(1576, 180);
  ctx.stroke();
  paintCenter(ctx, "ИНСТРУКТОР", 1080, 40, 472, 68, 32, P.INK, true, true);
  paintCenter(ctx, "Brake It, Anton", 1080, 112, 472, 40, 22, P.INK, false, true);

  ctx.save();
  ctx.translate(0, 28);
  drawAnton(ctx, "proud", boil, 0, state.preview);
  ctx.restore();

  roundRect(ctx, 1088, 608, 456, 72, 14);
  ctx.fillStyle = P.YEL;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  paintCenter(ctx, "Он газует сам.", 1088, 612, 456, 30, 22, P.INK, false, true);
  paintCenter(ctx, "Тебе — одна педаль.", 1088, 644, 456, 30, 22, P.INK, false, true);
  button(ctx, "start", 1088, 700, 456, 78, "В урок", "primary");
  button(ctx, "garage", 1088, 792, 456, 72, "Гараж", "paper");

  roundRect(ctx, 360, 800, 320, 48, 12);
  ctx.fillStyle = P.YEL;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  paintCenter(ctx, "Смотри вперёд", 360, 800, 320, 48, 20, P.INK, false, true);
}

function drawGarage(ctx, state) {
  const { save } = state;
  panel(ctx, 24, 24, 1552, 852, P.GRASS);

  roundRect(ctx, 48, 44, 1504, 100, 16);
  ctx.fillStyle = P.INK;
  ctx.fill();
  paintCenter(ctx, "ГАРАЖ", 48, 48, 1504, 50, 34, P.YEL, true, true);
  paintCenter(ctx, "Старый двор", 48, 100, 1504, 36, 20, P.PAPER, false, true);

  drawYardPoster(ctx, 48, 164, 700, 400);
  roundRect(ctx, 48, 580, 700, 150, 16);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  paintCenter(ctx, "Антон, новичок", 64, 592, 668, 42, 26, P.INK, false, true);
  paintCenter(ctx, "Газует сам. Обижается, если тормозить зря.", 64, 638, 668, 36, 20, P.INK, false, true);
  paintCenter(ctx, "Других учеников тут нет.", 64, 678, 668, 36, 18, P.INK, false, true);

  state.missions.forEach((mission, index) => {
    drawMissionCard(ctx, state, mission, 780, 164 + index * 112);
  });
  drawInfiniteCard(ctx, state, 780, 164 + 4 * 112);

  button(ctx, "sound", 48, 760, 250, 76, save.settings.sound ? "Звук: вкл" : "Звук: выкл", "paper");
  button(ctx, "shake", 316, 760, 280, 76, save.settings.shake ? "Тряска: вкл" : "Тряска: выкл", "paper");
  button(ctx, "go", 1180, 792, 340, 72, "В урок", "primary");
}

function drawYardPoster(ctx, x, y, w, h) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = "#B7D48A";
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const houses = [
    [28, 28, P.PINK],
    [168, 46, P.BLUE],
    [36, 168, P.ORANGE],
    [176, 188, P.YEL],
  ];
  for (const [dx, dy, color] of houses) drawHouse(ctx, x + dx + 70, y + dy + 70, 0.92, color, dx + dy, 0, color === P.PINK);
  drawTree(ctx, x + 300, y + 250, 0.8, 0, 2);

  ctx.beginPath();
  ctx.moveTo(x + 430, y + h - 18);
  ctx.lineTo(x + 520, y + 36);
  ctx.lineTo(x + 610, y + 36);
  ctx.lineTo(x + w - 28, y + h - 18);
  ctx.closePath();
  ctx.fillStyle = P.ROAD;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.strokeStyle = P.PAPER;
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 12]);
  ctx.beginPath();
  ctx.moveTo(x + 500, y + h - 24);
  ctx.lineTo(x + 565, y + 48);
  ctx.stroke();
  ctx.setLineDash([]);

  drawMiniCar(ctx, x + 520, y + h - 78);
  drawPed(ctx, x + 640, y + 150, 0.7, 0, false);
  ctx.restore();

  roundRect(ctx, x + 16, y + h - 58, w - 32, 42, 10);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  paintCenter(ctx, "Старый двор. Пока ездит только Антон.", x + 16, y + h - 58, w - 32, 42, 18, P.INK, false, true);
}

function drawMiniCar(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  roundRect(ctx, -22, -28, 44, 62, 8);
  ctx.fillStyle = P.YEL;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(-14, -20, 28, 14);
  ctx.fillStyle = P.RED;
  roundRect(ctx, -10, -2, 20, 14, 2);
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  paintCenter(ctx, "У", -10, -4, 20, 16, 12, P.PAPER, true, false);
  ctx.restore();
}

function drawMissionCard(ctx, state, mission, x, y) {
  const unlocked = mission.lesson <= state.save.unlocked;
  const best = state.save.best[mission.id] || 0;
  const picked = unlocked && state.selected === mission.id;
  roundRect(ctx, x, y, 740, 102, 16);
  ctx.fillStyle = unlocked ? (picked ? P.YEL : P.PAPER) : "#E4D8C4";
  ctx.fill();
  ink(ctx, unlocked ? 5 : 4);
  ctx.stroke();
  paintCenter(ctx, `${mission.lesson}. ${mission.title}`, x + 16, y + 6, 708, 32, 22, P.INK, false, true);
  paintCenter(
    ctx,
    unlocked ? mission.objective : "Сначала предыдущий урок",
    x + 16,
    y + 40,
    708,
    24,
    18,
    P.INK,
    false,
    true,
  );
  const status = unlocked ? (best > 0 ? "★".repeat(best) + "☆".repeat(3 - best) : "ещё не ездил") : "закрыт";
  paintCenter(ctx, status, x + 16, y + 68, 708, 26, 18, P.INK, false, true);
  if (!unlocked) drawLock(ctx, x + 28, y + 74);
  if (unlocked) spots.push({ id: `mission-${mission.id}`, x, y, w: 740, h: 102 });
}

function drawInfiniteCard(ctx, state, x, y) {
  const open = state.save.infinite === true;
  const picked = open && state.selected === "infinite";
  const meters = state.save.bestMeters.infinite || 0;
  roundRect(ctx, x, y, 740, 102, 16);
  ctx.fillStyle = open ? (picked ? P.ORANGE : P.YEL) : "#E4D8C4";
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  paintCenter(ctx, "Последний урок", x + 16, y + 6, 708, 32, 22, P.INK, false, true);
  paintCenter(
    ctx,
    open ? (meters ? `рекорд ${meters} м` : "Пока машина едет") : "После первого урока",
    x + 16,
    y + 40,
    708,
    24,
    18,
    P.INK,
    false,
    true,
  );
  paintCenter(ctx, open ? "без звёзд" : "закрыт", x + 16, y + 68, 708, 26, 18, P.INK, false, true);
  if (!open) drawLock(ctx, x + 28, y + 74);
  if (open) spots.push({ id: "mission-infinite", x, y, w: 740, h: 102 });
}

function drawLock(ctx, x, y) {
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y + 8, 16, 12);
  ctx.beginPath();
  ctx.arc(x + 8, y + 8, 6, Math.PI, 0);
  ctx.stroke();
}

function drawPlay(ctx, state) {
  const session = state.session;
  const sim = session.sim;
  const boil = state.save.settings.reducedMotion ? 0 : Math.floor(state.now / 110) % 2;
  const motion = !state.save.settings.reducedMotion;
  const mag = state.save.settings.shake && motion ? sim.shake : 0;
  const held = session.phase === "drive" && (session.brakeHeld || session.keysDown.has("Space"));
  const visual = held ? Math.max(sim.brakeInput, 0.22) : 0;
  const paused = session.phase === "pause" || session.phase === "result";

  ctx.save();
  if (mag) ctx.translate((hash(sim.t * 60) - 0.5) * mag, (hash(sim.t * 40) - 0.5) * mag * 0.6);
  drawWorld(ctx, sim, boil, motion);
  ctx.restore();
  drawCabin(ctx, sim, state, boil, visual);
  drawPatience(ctx, sim, paused);
  drawPedal(ctx, paused ? 0 : visual, paused);
  drawHud(ctx, state, sim);

  if (session.phase === "drive" && !paused) spots.push({ id: "pedal", x: 1088, y: 742, w: 460, h: 140 });
  if (session.phase === "countdown") drawCountdown(ctx, session);
  if (session.phase === "pause") drawPause(ctx, state);
  if (session.phase === "result") drawResult(ctx, state);
  if (state.hint && session.phase === "drive") {
    roundRect(ctx, 1088, 588, 456, 44, 12);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    paintCenter(ctx, "Он газует. Ты жмёшь тормоз.", 1088, 588, 456, 44, 18, P.INK, false, true);
  }
  if (state.debug && session.phase === "drive") {
    paintCenter(
      ctx,
      `v ${Math.round(sim.v * 3.6)}  p ${sim.patience.toFixed(0)}  ${sim.intent}`,
      40,
      800,
      420,
      28,
      16,
      P.INK,
      false,
      false,
    );
  }
}

function drawHud(ctx, state, sim) {
  const mission = state.session.mission;
  roundRect(ctx, 44, 40, 220, 64, 12);
  ctx.fillStyle = P.INK;
  ctx.fill();
  const lesson = mission.infinite ? "∞" : String(mission.lesson).padStart(2, "0");
  paintCenter(ctx, `УРОК ${lesson}`, 44, 40, 220, 64, 24, P.YEL, true, false);

  roundRect(ctx, 280, 44, 500, 64, 12);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  const goal = mission.infinite ? `${Math.floor(sim.s)} м` : mission.objective;
  paintCenter(ctx, goal, 290, 48, 400, 30, 20, P.INK, false, false);
  if (!mission.infinite) {
    const p = Math.max(0, Math.min(1, sim.s / mission.length));
    ctx.fillStyle = "#E7DCC6";
    ctx.fillRect(300, 84, 390, 8);
    ctx.fillStyle = P.PAT_GREEN;
    ctx.fillRect(300, 84, Math.max(0, 390 * p), 8);
  }
  if (mission.cargo === "cake" || mission.cargo === "fish") drawCargoIcon(ctx, 730, 70, mission.cargo, 0.55, sim);

  roundRect(ctx, 940, 36, 72, 72, 14);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.fillStyle = P.INK;
  ctx.fillRect(962, 52, 8, 36);
  ctx.fillRect(980, 52, 8, 36);
  spots.push({ id: "pause", x: 928, y: 28, w: 96, h: 88 });
}

function drawCountdown(ctx, session) {
  roundRect(ctx, 44, 120, 180, 92, 14);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();
  paintCenter(ctx, String(session.countdown || 1), 44, 124, 180, 52, 40, P.INK, true, false);
  const line = session.mission.blurb[session.countdown > 1 ? 0 : 1] || session.mission.blurb[0];
  paintCenter(ctx, line, 44, 172, 180, 32, 13, P.INK, false, false);
}

function drawWorld(ctx, sim, boil, motion) {
  const box = VIEW.panel;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.fillStyle = P.GRASS;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(box.x, box.y, box.w, VIEW.vanishY - box.y + 18);

  const far = 2400;
  fillQuad(ctx, VIEW.near, far, -VIEW.sideHalf, -VIEW.roadHalf, P.SIDEWALK);
  fillQuad(ctx, VIEW.near, far, VIEW.roadHalf, VIEW.sideHalf, P.SIDEWALK);
  fillQuad(ctx, VIEW.near, far, -VIEW.roadHalf, VIEW.roadHalf, P.ROAD);
  strokeRay(ctx, -VIEW.roadHalf, far, P.INK, 6);
  strokeRay(ctx, VIEW.roadHalf, far, P.INK, 6);

  for (const zone of sim.slippery || []) {
    const ds0 = zone.s0 - sim.s;
    const ds1 = zone.s1 - sim.s;
    if (ds1 < VIEW.near || ds0 > VIEW.look) continue;
    fillQuad(ctx, Math.max(ds0, VIEW.near), Math.min(ds1, VIEW.look), -VIEW.roadHalf, VIEW.roadHalf, "rgba(90,150,180,0.34)");
    if (ds0 > VIEW.near && ds0 < VIEW.look - 4) {
      const spot = project(ds0, 0);
      roundRect(ctx, spot.x - 46, spot.y - 16, 92, 30, 8);
      ctx.fillStyle = P.YEL;
      ctx.fill();
      ink(ctx, 3);
      ctx.stroke();
      paintCenter(ctx, "МОКРО", spot.x - 46, spot.y - 16, 92, 30, 14, P.INK, false, false);
    }
  }

  const dashStep = 8;
  for (let s = Math.floor((sim.s + VIEW.near) / dashStep) * dashStep; s < sim.s + VIEW.look; s += dashStep) {
    fillQuad(ctx, s - sim.s, s - sim.s + 3.2, -0.15, 0.15, P.PAPER);
  }

  const props = [];
  for (let s = Math.floor((sim.s - 12) / 22) * 22; s < sim.s + VIEW.look; s += 22) {
    const n = Math.round(s / 22);
    const band = districtAt(s);
    for (const side of [-1, 1]) {
      props.push({ ds: s - sim.s, xm: side * 6.45, n, side, band, kind: "prop" });
    }
  }
  for (const h of sim.hazards) {
    const dist = h.s - sim.s;
    if (h.resolved && dist < -8) continue;
    if (dist < VIEW.near || dist > VIEW.look) continue;
    props.push({ ds: dist, xm: hazardWorldX(h, sim), kind: "hazard", h });
  }
  props.sort((a, b) => b.ds - a.ds);
  for (const item of props) {
    if (item.kind === "prop") drawProp(ctx, item, boil);
    else drawHazard(ctx, sim, item.h, boil);
  }

  for (const skid of sim.skids || []) {
    const spot = project(skid.s - sim.s, skid.x);
    if (spot.y < 30 || spot.y > 890) continue;
    ctx.strokeStyle = "rgba(28,22,30,0.4)";
    ctx.lineWidth = 4 * spot.scale;
    ctx.beginPath();
    ctx.moveTo(spot.x - 12 * spot.scale, spot.y);
    ctx.lineTo(spot.x - 8 * spot.scale, spot.y + 22 * spot.scale);
    ctx.moveTo(spot.x + 12 * spot.scale, spot.y);
    ctx.lineTo(spot.x + 8 * spot.scale, spot.y + 22 * spot.scale);
    ctx.stroke();
  }

  if (motion && sim.v > 9) drawWhiskers(ctx, sim);
  drawCar(ctx, sim, boil);
  ctx.restore();

  roundRect(ctx, box.x, box.y, box.w, box.h, 8);
  ink(ctx, 8);
  ctx.stroke();
}

function fillQuad(ctx, ds0, ds1, x0, x1, color) {
  const a = project(ds0, x0);
  const b = project(ds0, x1);
  const c = project(ds1, x1);
  const d = project(ds1, x0);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeRay(ctx, xm, far, color, width) {
  const a = project(VIEW.near, xm);
  const b = project(far, xm);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function districtAt(worldS) {
  const names = ["yard", "market", "edge"];
  return names[Math.abs(Math.floor(worldS / 280)) % 3];
}

function drawWhiskers(ctx, sim) {
  const shift = (sim.s * 42) % 90;
  ctx.strokeStyle = "rgba(28,22,30,0.28)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const y = 780 - ((i * 70 + shift) % 260);
    const len = 18 + sim.v;
    ctx.beginPath();
    ctx.moveTo(36, y);
    ctx.lineTo(36 + len, y + 10);
    ctx.moveTo(1020, y + 8);
    ctx.lineTo(1020 - len, y + 18);
    ctx.stroke();
  }
}

function drawProp(ctx, item, boil) {
  const spot = project(item.ds, item.xm);
  if (spot.y < -40 || spot.y > 940) return;
  const sc = Math.max(0.34, spot.scale);
  const color = [P.PINK, P.BLUE, P.YEL, P.ORANGE][Math.abs(item.n) % 4];
  const kind = Math.abs(item.n + item.side) % 5;
  if (item.band === "market") {
    if (kind === 0) drawStall(ctx, spot.x, spot.y, sc, color, boil);
    else if (kind === 1) drawSign(ctx, spot.x, spot.y, sc, boil);
    else drawHouse(ctx, spot.x, spot.y, sc * 1.05, color, item.n * item.side, boil, false);
    return;
  }
  if (item.band === "edge") {
    if (kind < 2) drawShed(ctx, spot.x, spot.y, sc, color);
    else if (kind === 2) drawFence(ctx, spot.x, spot.y, sc);
    else drawTree(ctx, spot.x, spot.y, sc, boil, item.n);
    return;
  }
  if (kind === 0) drawTree(ctx, spot.x, spot.y, sc, boil, item.n + item.side);
  else if (kind === 1 && item.side > 0) drawBench(ctx, spot.x, spot.y, sc);
  else drawHouse(ctx, spot.x, spot.y, sc, color, item.n * item.side, boil, Math.abs(item.n) % 6 === 0);
}

function drawHouse(ctx, x, y, sc, color, seed, boil, laundry) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  const ox = boil ? Math.sin(seed) * 1.4 : 0;
  roundRect(ctx, -54 + ox, -20, 108, 78, 4);
  ctx.fillStyle = color;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-64, -16);
  ctx.lineTo(-6, -62);
  ctx.lineTo(66, -14);
  ctx.closePath();
  ctx.fillStyle = color === P.YEL ? P.ORANGE : P.INK;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.PAPER;
  roundRect(ctx, -36, 4, 26, 22, 3);
  ctx.fill();
  roundRect(ctx, 8, -2, 16, 14, 3);
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  ctx.fillStyle = P.INK;
  roundRect(ctx, -8, 16, 18, 42, 2);
  ctx.fill();
  if (laundry) {
    ctx.fillStyle = P.PINK;
    ctx.fillRect(24, -52, 16, 12);
    ctx.fillStyle = P.GLASS;
    ctx.fillRect(42, -48, 12, 10);
  }
  ctx.restore();
}

function drawTree(ctx, x, y, sc, boil, seed) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.fillStyle = "#6E4A32";
  roundRect(ctx, -7, 0, 14, 34, 3);
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(boil ? 3 : -2, -22, 30, 0, Math.PI * 2);
  ctx.fillStyle = "#6E9A48";
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(seed % 2 ? -10 : 12, -30, 9, 0, Math.PI * 2);
  ctx.fillStyle = P.YEL;
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  ctx.restore();
}

function drawBench(ctx, x, y, sc) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.fillStyle = P.ORANGE;
  roundRect(ctx, -30, -6, 60, 14, 3);
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-20, 8);
  ctx.lineTo(-20, 22);
  ctx.moveTo(20, 8);
  ctx.lineTo(20, 22);
  ctx.stroke();
  ctx.restore();
}

function drawStall(ctx, x, y, sc, color, boil) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-48, 8);
  ctx.lineTo(-36, -28);
  ctx.lineTo(40, -22 + (boil ? 2 : 0));
  ctx.lineTo(50, 10);
  ctx.closePath();
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.PAPER;
  roundRect(ctx, -34, 6, 70, 22, 3);
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.restore();
}

function drawSign(ctx, x, y, sc, boil) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 20);
  ctx.lineTo(0, -10);
  ctx.stroke();
  roundRect(ctx, -28, -42, 56, 32, 4);
  ctx.fillStyle = P.YEL;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-16, -30);
  ctx.quadraticCurveTo(0, -18 + (boil ? 3 : 0), 16, -28);
  ctx.stroke();
  ctx.restore();
}

function drawShed(ctx, x, y, sc, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  roundRect(ctx, -70, -16, 140, 52, 3);
  ctx.fillStyle = color;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.fillStyle = P.INK;
  ctx.fillRect(-16, -2, 28, 38);
  ctx.restore();
}

function drawFence(ctx, x, y, sc) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) {
    ctx.moveTo(i * 16, -16);
    ctx.lineTo(i * 16, 16);
  }
  ctx.moveTo(-36, -4);
  ctx.lineTo(36, -4);
  ctx.stroke();
  ctx.restore();
}

function drawHazard(ctx, sim, h, boil) {
  const dist = h.s - sim.s;
  const hx = hazardWorldX(h, sim);
  const spot = project(dist, hx);
  if (spot.y < -20 || spot.y > 930) return;
  const sc = Math.max(0.5, Math.min(1.15, spot.scale * 1.15));
  const hop = h.hopped ? -18 : 0;
  if (h.type === "pedestrian") drawPed(ctx, spot.x, spot.y + hop, sc, boil, h.crossT >= 0 && h.crossT < 0.5);
  else if (h.type === "dog") drawDog(ctx, spot.x, spot.y, sc, boil);
  else if (h.type === "pothole") drawHole(ctx, spot.x, spot.y, sc);
  else if (h.type === "bin") drawBin(ctx, spot.x, spot.y + hop, sc, dist, h.hopped);
  else drawNpc(ctx, spot.x, spot.y, sc, h, dist, boil);

  if (!h.resolved && dist < (h.telegraph || 72) && dist > 1.5) {
    const pulse = 1 + Math.sin(sim.t * 8) * 0.08;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y - 48 * sc, (15 * sc + 8) * pulse, 0, Math.PI * 2);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    paintCenter(ctx, "!", spot.x - 16, spot.y - 48 * sc - 16, 32, 32, Math.max(16, 22 * sc), P.INK, true, false);
  }

  if (h.trust && !h.resolved && h.committed !== "lunge" && dist < (h.telegraph || 72) && dist > 0) {
    const free = -Math.sign(h.x || 1) * 1.7;
    const chev = project(Math.max(5, Math.min(dist * 0.4, 18)), free);
    ctx.fillStyle = P.YEL;
    ctx.beginPath();
    ctx.moveTo(chev.x, chev.y - 18);
    ctx.lineTo(chev.x + 16, chev.y + 12);
    ctx.lineTo(chev.x - 16, chev.y + 12);
    ctx.closePath();
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
  }
}

function drawPed(ctx, x, y, sc, boil, phone) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  const step = boil ? 6 : -6;
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-10, 8);
  ctx.lineTo(-16, 40 + step);
  ctx.moveTo(10, 8);
  ctx.lineTo(16, 40 - step);
  ctx.stroke();
  roundRect(ctx, -22, -28, 44, 42, 8);
  ctx.fillStyle = P.PINK;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -48, 20, 0, Math.PI * 2);
  ctx.fillStyle = P.SKIN;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.WHITE;
  ctx.beginPath();
  ctx.ellipse(-4, -50, 9, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.INK;
  ctx.beginPath();
  ctx.arc(-3, -50, 3.5, 0, Math.PI * 2);
  ctx.fill();
  if (phone) {
    ctx.fillStyle = P.INK;
    roundRect(ctx, 14, -8, 12, 18, 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(18, -6);
    ctx.lineTo(28, 8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDog(ctx, x, y, sc, boil) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.fillStyle = "#8A5A3A";
  roundRect(ctx, -34, -16, 68, 32, 6);
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  const leg = boil ? 5 : 0;
  ctx.fillStyle = P.INK;
  ctx.fillRect(-24, 12, 7, 14 + leg);
  ctx.fillRect(-8, 12, 7, 16 - leg);
  ctx.fillRect(8, 12, 7, 14 + leg);
  ctx.fillRect(22, 12, 7, 12);
  ctx.beginPath();
  ctx.arc(30, -8, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.WHITE;
  ctx.beginPath();
  ctx.arc(18, -6, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.INK;
  ctx.beginPath();
  ctx.arc(18, -6, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHole(ctx, x, y, sc) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.beginPath();
  ctx.ellipse(0, 4, 28, 16, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#2A241C";
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.strokeStyle = P.YEL;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-20, -8);
  ctx.lineTo(-30, -18);
  ctx.moveTo(16, -6);
  ctx.lineTo(28, -16);
  ctx.stroke();
  ctx.restore();
}

function drawBin(ctx, x, y, sc, dist, hopped) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.rotate(hopped ? 1.2 : dist < 16 ? 0.55 : 0.12);
  roundRect(ctx, -18, -30, 36, 46, 4);
  ctx.fillStyle = "#6E8A62";
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.INK;
  ctx.fillRect(-20, -34, 40, 7);
  ctx.restore();
}

function drawNpc(ctx, x, y, sc, h, dist, boil) {
  const colors = [P.BLUE, P.ORANGE, P.TEAL, P.PINK];
  const color = colors[Math.abs(Math.floor(hash(h.s) * 4)) % colors.length];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  if (h.type === "cutin" && h.crossT >= 0 && h.crossT < h.crossDur) ctx.rotate(-0.35);
  roundRect(ctx, -26, -40, 52, 78, 8);
  ctx.fillStyle = color;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(-16, -30, 32, 18);
  ctx.fillStyle = P.INK;
  ctx.fillRect(-18, 22, 12, 14);
  ctx.fillRect(8, 22, 12, 14);
  if (h.type === "cutin" && dist < 36) {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(24, -8);
    ctx.lineTo(46, -22 + (boil ? 3 : 0));
    ctx.stroke();
  }
  ctx.restore();
}

function drawCar(ctx, sim, boil) {
  const spot = project(0, sim.x);
  ctx.save();
  ctx.translate(spot.x, spot.y);
  const dive = sim.brakeInput * 0.18 + (sim.crashT > 0 ? 0.08 : 0);
  ctx.rotate(dive);
  const squash = 1 - Math.min(0.32, sim.crashT * 1.3);
  ctx.scale(0.9 + sim.brakeInput * 0.03, squash);
  roundRect(ctx, -28, 36, 62, 16, 4);
  ctx.fillStyle = P.INK;
  ctx.fill();
  roundRect(ctx, -36, -52, 72, 100, 14);
  ctx.fillStyle = sim.body < 40 ? "#D9C27A" : P.YEL;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(-24, -40, 48, 24);
  roundRect(ctx, -18, -18, 36, 24, 3);
  ctx.fillStyle = P.RED;
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  paintCenter(ctx, "У", -16, -20, 32, 24, 16, P.PAPER, true, false);
  const lamps = sim.brakeInput > 0.2 || sim.lastSelfBrake > 0.12;
  ctx.fillStyle = lamps ? P.RED : P.ORANGE;
  ctx.fillRect(-26, 28, 14, 8);
  ctx.fillRect(12, 28, 14, 8);
  ctx.fillStyle = P.INK;
  ctx.fillRect(-24, -50, 14, 8);
  ctx.fillRect(10, -50, 14, 8);
  const spin = sim.s * 2.4 + (boil ? 0.4 : 0);
  drawWheel(ctx, -26, -26, spin);
  drawWheel(ctx, 26, -26, spin);
  drawWheel(ctx, -26, 22, spin);
  drawWheel(ctx, 26, 22, spin);
  if (sim.body < 70) {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-8, 4);
    ctx.lineTo(10, 14);
    ctx.lineTo(-2, 24);
    ctx.stroke();
  }
  if (sim.cargoType) {
    const wob = Math.sin(sim.t * 10) * sim.brakeInput * 8;
    drawCargoIcon(ctx, wob, -78, sim.cargoType, 0.85, sim);
  }
  if (sim.crashT > 0) {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-48, -20);
    ctx.lineTo(-68, -36);
    ctx.moveTo(48, -10);
    ctx.lineTo(70, -28);
    ctx.moveTo(0, -60);
    ctx.lineTo(8, -84);
    ctx.stroke();
  }
  if (sim.nearT > 0) {
    ctx.strokeStyle = P.YEL;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(40, 8);
    ctx.lineTo(78, 2);
    ctx.moveTo(-40, 14);
    ctx.lineTo(-76, 22);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWheel(ctx, x, y, spin) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = P.INK;
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = P.PAPER;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.cos(spin) * 7, Math.sin(spin) * 7);
  ctx.lineTo(-Math.cos(spin) * 7, -Math.sin(spin) * 7);
  ctx.stroke();
  ctx.restore();
}

function drawCargoIcon(ctx, x, y, type, sc, sim) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  const hurt = sim && sim.cargo < 55;
  if (type === "cake") {
    roundRect(ctx, -22, -8, 44, 26, 5);
    ctx.fillStyle = hurt ? "#E7C2A2" : P.PINK;
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    ctx.lineTo(-8, hurt ? -14 : -24);
    ctx.moveTo(8, -8);
    ctx.lineTo(6, hurt ? -12 : -22);
    ctx.stroke();
    if (hurt) {
      ctx.fillStyle = P.PINK;
      ctx.beginPath();
      ctx.arc(0, 22, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const tilt = sim ? Math.sin((sim.t || 0) * 6) * (sim.brakeInput || 0) * 0.25 : 0;
    ctx.rotate(tilt);
    roundRect(ctx, -18, -16, 36, 30, 6);
    ctx.fillStyle = P.GLASS;
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
    ctx.fillStyle = P.ORANGE;
    ctx.beginPath();
    ctx.ellipse(tilt * 20, 2, 8, 5, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCabin(ctx, sim, state, boil, visual) {
  panel(ctx, 1056, 24, 520, 600, P.CABIN);
  ctx.save();
  ctx.beginPath();
  ctx.rect(1056, 24, 520, 600);
  ctx.clip();
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(1056, 24, 520, 118);
  ink(ctx, 6);
  ctx.beginPath();
  ctx.moveTo(1056, 142);
  ctx.lineTo(1576, 142);
  ctx.stroke();
  const exp = state.pose || expressionId(sim);
  drawAnton(ctx, exp, boil, visual, sim);
  if (sim.bubble && sim.bubbleT > 0) {
    roundRect(ctx, 1084, 156, 300, 52, 12);
    ctx.fillStyle = P.PAPER;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    paintCenter(ctx, sim.bubble, 1084, 156, 300, 52, 20, P.INK, false, false);
  }
  ctx.restore();
}

function drawAnton(ctx, exp, boil, lean, sim) {
  const ox = boil ? 1.6 : 0;
  const nod = lean * 18 + (exp === "belted" ? 22 : 0);
  ctx.save();
  ctx.translate(1316 + ox, 250 + nod * 0.35);

  roundRect(ctx, -92, 78, 184, 150, 18);
  ctx.fillStyle = P.TEAL;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();

  ctx.strokeStyle = P.INK;
  ctx.lineWidth = exp === "belted" ? 9 : 5;
  ctx.beginPath();
  ctx.moveTo(-70, 96);
  ctx.lineTo(exp === "belted" ? 8 : 20, 168);
  ctx.stroke();

  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-78, 150);
  ctx.quadraticCurveTo(-40, 210, 0, 196);
  ctx.moveTo(78, 150);
  ctx.quadraticCurveTo(40, 214, 0, 196);
  ctx.stroke();

  const wheel = Math.max(-0.45, Math.min(0.45, ((sim.targetX || 1.8) - (sim.x || 1.8)) * 0.4));
  ctx.save();
  ctx.translate(0, 198);
  ctx.rotate(wheel + (exp === "focused" ? -0.08 : 0));
  ctx.beginPath();
  ctx.ellipse(0, 0, 54, 22, 0, 0, Math.PI * 2);
  ctx.fillStyle = P.INK;
  ctx.fill();
  ctx.strokeStyle = P.PAPER;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-30, 0);
  ctx.lineTo(30, 0);
  ctx.moveTo(0, -12);
  ctx.lineTo(0, 12);
  ctx.stroke();
  ctx.fillStyle = P.SKIN;
  ctx.beginPath();
  ctx.arc(-34, 4, 12, 0, Math.PI * 2);
  ctx.arc(34, 4, 12, 0, Math.PI * 2);
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.ellipse(0, 8, 108, 96, 0, 0, Math.PI * 2);
  ctx.fillStyle = P.SKIN;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();

  ctx.fillStyle = P.SKIN;
  ctx.beginPath();
  ctx.ellipse(-100, 20, 16, 22, 0, 0, Math.PI * 2);
  ctx.ellipse(100, 28, 14, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();

  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  const hairs = [-34, -10, 14, 38];
  hairs.forEach((hx, i) => {
    const lift = exp === "furious" || exp === "proud" ? 10 : 0;
    ctx.moveTo(hx, -78);
    ctx.quadraticCurveTo(hx + (i - 1.5) * 6, -120 - lift - (boil && i % 2 ? 5 : 0), hx + 8, -96);
  });
  ctx.stroke();

  const look = lookFor(exp);
  eye(ctx, -30, -8, 28, 24, 8, look.left);
  eye(ctx, 28, 10, 16, 14, 5, look.right);
  brows(ctx, exp);
  mouth(ctx, exp);
  if (exp === "angry" || exp === "furious") {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(58, -20);
    ctx.lineTo(78, -28);
    ctx.moveTo(62, -4);
    ctx.lineTo(84, -4);
    ctx.moveTo(58, 12);
    ctx.lineTo(76, 18);
    ctx.stroke();
  }
  if (exp === "furious") {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-70, -70);
    ctx.quadraticCurveTo(-90, -100, -60, -110);
    ctx.moveTo(70, -64);
    ctx.quadraticCurveTo(96, -96, 64, -108);
    ctx.stroke();
  }
  ctx.restore();
}

function lookFor(exp) {
  if (exp === "focused") return { left: { x: 2, y: 6 }, right: { x: 1, y: 4 } };
  if (exp === "belted") return { left: { x: 0, y: -6 }, right: { x: 1, y: -4 } };
  if (exp === "ashamed") return { left: { x: -6, y: 3 }, right: { x: -4, y: 2 } };
  if (exp === "angry" || exp === "furious") return { left: { x: 3, y: 2 }, right: { x: 2, y: 1 } };
  if (exp === "proud") return { left: { x: 2, y: -2 }, right: { x: 0, y: 0 } };
  return { left: { x: 2, y: 2 }, right: { x: 0, y: 2 } };
}

function eye(ctx, x, y, rx, ry, pupil, look) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = P.WHITE;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + look.x, y + look.y, pupil, 0, Math.PI * 2);
  ctx.fillStyle = P.INK;
  ctx.fill();
}

function brows(ctx, exp) {
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  if (exp === "angry" || exp === "furious") {
    ctx.moveTo(-58, -40);
    ctx.lineTo(-8, -28);
    ctx.moveTo(10, -22);
    ctx.lineTo(48, -36);
  } else if (exp === "annoyed") {
    ctx.moveTo(-58, -36);
    ctx.lineTo(-12, -44);
    ctx.moveTo(12, -18);
    ctx.lineTo(46, -28);
  } else if (exp === "focused") {
    ctx.moveTo(-56, -34);
    ctx.lineTo(-10, -40);
    ctx.moveTo(14, -16);
    ctx.lineTo(46, -24);
  } else if (exp === "belted") {
    ctx.moveTo(-56, -50);
    ctx.lineTo(-12, -40);
    ctx.moveTo(12, -30);
    ctx.lineTo(46, -38);
  } else if (exp === "proud") {
    ctx.moveTo(-56, -42);
    ctx.quadraticCurveTo(-32, -54, -8, -40);
    ctx.moveTo(14, -20);
    ctx.quadraticCurveTo(32, -30, 48, -16);
  } else {
    ctx.moveTo(-56, -40);
    ctx.quadraticCurveTo(-32, -50, -10, -40);
    ctx.moveTo(14, -18);
    ctx.quadraticCurveTo(30, -26, 48, -16);
  }
  ctx.stroke();
}

function mouth(ctx, exp) {
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  if (exp === "angry" || exp === "furious") {
    ctx.moveTo(-24, 48);
    ctx.lineTo(26, 48);
    ctx.lineTo(18, 66);
    ctx.lineTo(-16, 66);
    ctx.closePath();
    ctx.fillStyle = "#7A3030";
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = P.PAPER;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-14, 54);
    ctx.lineTo(16, 54);
    ctx.stroke();
    return;
  }
  if (exp === "annoyed") ctx.moveTo(-20, 52), ctx.quadraticCurveTo(0, 46, 22, 58);
  else if (exp === "focused") ctx.moveTo(-16, 54), ctx.lineTo(18, 54);
  else if (exp === "belted") ctx.arc(0, 58, 12, 0, Math.PI * 2);
  else if (exp === "proud") ctx.moveTo(-26, 48), ctx.quadraticCurveTo(2, 74, 28, 44);
  else if (exp === "ashamed") ctx.moveTo(-16, 60), ctx.quadraticCurveTo(4, 50, 20, 58);
  else ctx.moveTo(-22, 52), ctx.quadraticCurveTo(0, 66, 24, 50);
  ctx.stroke();
}

function drawPatience(ctx, sim, paused) {
  roundRect(ctx, 1056, 640, 520, 96, 8);
  ctx.fillStyle = paused ? "#E7DCC6" : P.PAPER;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();
  const word = moodWord(sim.patience, sim.outburstT > 0);
  const glyph = moodGlyph(sim.patience, sim.outburstT > 0);
  paintCenter(ctx, word, 1072, 656, 150, 64, 22, P.INK, false, false);
  drawGlyph(ctx, 1236, 688, glyph);
  const x = 1264;
  const y = 664;
  const w = 286;
  const h = 46;
  const colors = [P.PAT_GREEN, P.PAT_YELLOW, P.PAT_RED];
  colors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + (w / 3) * i, y, w / 3 + 1, h);
  });
  ink(ctx, 4);
  ctx.strokeRect(x, y, w, h);
  const nx = x + (w * Math.max(0, Math.min(100, sim.patience))) / 100;
  ctx.beginPath();
  ctx.moveTo(nx, y - 8);
  ctx.lineTo(nx + 10, y + 10);
  ctx.lineTo(nx - 10, y + 10);
  ctx.closePath();
  ctx.fillStyle = P.INK;
  ctx.fill();
}

function drawGlyph(ctx, x, y, glyph) {
  ctx.fillStyle = P.INK;
  ctx.beginPath();
  if (glyph === "square") {
    ctx.rect(x - 10, y - 10, 20, 20);
    ctx.fill();
  } else if (glyph === "triangle") {
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x + 12, y + 10);
    ctx.lineTo(x - 12, y + 10);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPedal(ctx, visual, disabled) {
  const y = 748 + visual * 22;
  ctx.fillStyle = "rgba(28,22,30,0.25)";
  roundRect(ctx, 1168, 812, 280, 36, 10);
  ctx.fill();
  roundRect(ctx, 1148, y, 310, 96, 16);
  ctx.fillStyle = disabled ? "#B7A898" : P.RED;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();
  paintCenter(ctx, "ТОРМОЗ", 1148, y, 310, 96, 28, disabled ? P.INK : P.PAPER, true, false);
  if (visual > 0.4 && !disabled) {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(1132, y + 24);
    ctx.lineTo(1110, y + 6);
    ctx.moveTo(1474, y + 28);
    ctx.lineTo(1496, y + 8);
    ctx.stroke();
  }
}

function drawPause(ctx, state) {
  ctx.fillStyle = "rgba(28,22,30,0.4)";
  ctx.fillRect(0, 0, 1600, 900);
  roundRect(ctx, 500, 150, 600, 600, 20);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 8);
  ctx.stroke();
  paintCenter(ctx, "ПАУЗА", 540, 176, 520, 64, 40, P.INK, true, false);
  paintCenter(ctx, "Педаль выключена", 540, 244, 520, 36, 22, P.INK, false, false);
  button(ctx, "resume", 590, 300, 420, 76, "Продолжить", "primary");
  button(ctx, "retry", 590, 392, 420, 76, "Заново", "paper");
  button(ctx, "to-garage", 590, 484, 420, 76, "В гараж", "paper");
  button(ctx, "sound", 590, 584, 200, 72, state.save.settings.sound ? "Звук вкл" : "Звук выкл", "paper");
  button(ctx, "shake", 810, 584, 200, 72, state.save.settings.shake ? "Тряска вкл" : "Тряска выкл", "paper");
}

function drawResult(ctx, state) {
  const sim = state.session.sim;
  const graded = state.session.result;
  ctx.fillStyle = P.PAPER;
  ctx.fillRect(0, 0, 1600, 900);
  panel(ctx, 24, 24, 1552, 852, P.GRASS);
  const line = resultPhrase(sim, graded);
  roundRect(ctx, 80, 48, 1440, 72, 14);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  paintCenter(ctx, line, 80, 48, 1440, 72, 32, P.INK, true, false);

  ctx.save();
  ctx.translate(-780, 80);
  drawAnton(ctx, resultPose(sim, graded), 0, 0, sim);
  ctx.restore();

  const rows = [
    ["Машина", graded.body],
    ["Нервы", graded.mood],
    [sim.cargoType ? "Груз" : "Комфорт", graded.comfort],
  ];
  rows.forEach((row, i) => {
    const y = 180 + i * 120;
    paintCenter(ctx, row[0], 860, y, 220, 40, 24, P.INK, false, false);
    roundRect(ctx, 1100, y, 360, 40, 10);
    ctx.fillStyle = "#E7DCC6";
    ctx.fill();
    roundRect(ctx, 1100, y, Math.max(12, 3.6 * row[1]), 40, 10);
    ctx.fillStyle = row[1] >= 70 ? P.PAT_GREEN : row[1] >= 40 ? P.PAT_YELLOW : P.PAT_RED;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    paintCenter(ctx, String(Math.round(row[1])), 1470, y, 70, 40, 20, P.INK, false, false);
  });
  if (!sim.infinite) {
    const stars = "★".repeat(graded.stars) + "☆".repeat(3 - graded.stars);
    paintCenter(ctx, stars, 980, 540, 280, 56, 40, P.INK, false, false);
    paintCenter(ctx, `${Math.round(graded.percent)}%`, 1280, 548, 120, 40, 22, P.INK, false, false);
  }
  if (graded.badge) {
    roundRect(ctx, 900, 610, 560, 52, 12);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    paintCenter(ctx, "Почти не понадобился", 900, 610, 560, 52, 22, P.INK, false, false);
  }
  if (sim.infinite) {
    const bill = repairInvoice(sim.stats, sim.t);
    bill.lines.slice(0, 4).forEach((entry, i) => {
      paintCenter(ctx, `${entry[0]}  ${entry[1]}`, 900, 560 + i * 32, 520, 28, 16, P.INK, false, false);
    });
    paintCenter(ctx, `Итого ${bill.total}`, 900, 700, 520, 32, 22, P.INK, false, false);
  }
  const retryKind = graded.success ? "paper" : "primary";
  const nextKind = graded.success ? "primary" : "paper";
  button(ctx, "retry", 80, 760, 360, 80, "Ещё раз", retryKind);
  button(ctx, "next", 1160, 760, 360, 80, graded.success && !sim.infinite ? "Дальше" : "В гараж", nextKind);
}

function resultPhrase(sim, graded) {
  if (sim.infinite) return "Смета готова. Машина — нет.";
  if (!graded.success && sim.failReason === "cargo" && sim.cargoType === "cake") return "Крем на потолке.";
  if (!graded.success && sim.failReason === "cargo") return "Рыбка видела всё.";
  if (!graded.success) return "Ну что, по коням?";
  if (graded.badge) return "Ты почти не понадобился";
  if (graded.stars >= 3) return "Даже Антон удивился.";
  if (graded.stars >= 2) return "Доехали. Нервно, но да.";
  return "Живые. Это уже сюжет.";
}

function resultPose(sim, graded) {
  if (!graded.success) return "ashamed";
  if (graded.badge || graded.stars >= 2) return "proud";
  return "annoyed";
}
