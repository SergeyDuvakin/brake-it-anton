/**
 * Original flat ink drawing. No photo textures, no gradients, no external sprites.
 * Calm Anton is a separate face from the angry reference sheet.
 */

import { PALETTE as P } from "./config.js";
import { expressionId, moodGlyph, moodWord, repairInvoice } from "./physics.js";
import { hazardWorldX } from "./sim.js";

const ROAD = { x: 24, y: 24, w: 1010, h: 852, carY: 668, top: 52, cx: 528, ppm: 7.2 };

function font(px, display = false) {
  return display ? `${px}px "Rubik Mono One", sans-serif` : `700 ${px}px "Balsamiq Sans", sans-serif`;
}

function ink(ctx, width = 6) {
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

function label(ctx, text, x, y, size, color = P.INK, align = "left", display = false) {
  ctx.font = font(size, display);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
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

function button(ctx, spots, id, x, y, w, h, text, kind = "paper") {
  spots.push({ id, x, y, w, h });
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = kind === "primary" ? P.TEAL : kind === "ink" ? P.INK : P.PAPER;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();
  label(ctx, text, x + w / 2, y + h / 2 + 1, 26, kind === "ink" ? P.YEL : P.INK, "center");
}

function project(ds, xm) {
  const y = ROAD.carY - ds * ROAD.ppm;
  const span = ROAD.carY - ROAD.top;
  const t = Math.max(0, Math.min(1, (ROAD.carY - y) / span));
  const half = 200 * (1 - t) + 86 * t;
  return {
    x: ROAD.cx + (xm / 4.5) * half,
    y,
    half,
    scale: 1 - t * 0.58,
    t,
  };
}

function hash(n) {
  let x = Math.imul(n | 0, 0x9e3779b1);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function render(ctx, state) {
  const spots = [];
  ctx.clearRect(0, 0, 1600, 900);
  ctx.fillStyle = P.PAPER;
  ctx.fillRect(0, 0, 1600, 900);
  if (state.screen === "garage") drawGarage(ctx, spots, state);
  else if (state.screen === "title") drawTitle(ctx, spots, state);
  else drawPlay(ctx, spots, state);
  if (state.notice) {
    roundRect(ctx, 360, 18, 880, 42, 12);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    label(ctx, state.notice, 800, 39, 18, P.INK, "center");
  }
  return spots;
}

function drawTitle(ctx, spots, state) {
  drawWorld(ctx, state.preview, 0);
  drawCabin(ctx, state.preview, state, 0, false);
  drawPatience(ctx, state.preview, false);
  drawPedal(ctx, 0, false);
  roundRect(ctx, 70, 250, 900, 340, 22);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 8);
  ctx.stroke();
  label(ctx, "ИНСТРУКТОР", 520, 320, 54, P.INK, "center", true);
  label(ctx, "Brake It, Anton", 520, 378, 22, P.INK, "center");
  label(ctx, "Он рулит. Ты только тормозишь.", 520, 430, 26, P.INK, "center");
  button(ctx, spots, "start", 120, 490, 380, 74, "В урок", "primary");
  button(ctx, spots, "garage", 530, 490, 380, 74, "Гараж", "paper");
}

function drawGarage(ctx, spots, state) {
  const { save } = state;
  roundRect(ctx, 24, 24, 1552, 852, 22);
  ctx.fillStyle = P.GRASS;
  ctx.fill();
  ink(ctx, 8);
  ctx.stroke();
  roundRect(ctx, 48, 48, 760, 96, 16);
  ctx.fillStyle = P.INK;
  ctx.fill();
  label(ctx, "ГАРАЖ", 80, 96, 36, P.YEL, "left", true);
  label(ctx, "Старый двор", 430, 86, 22, P.PAPER, "left");
  label(ctx, "Антон · жёлтая «У»", 430, 116, 18, P.YEL, "left");

  drawMiniYard(ctx, 70, 180);
  roundRect(ctx, 70, 560, 700, 150, 16);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  label(ctx, "Антон, новичок", 96, 598, 26, P.INK);
  label(ctx, "Газует сам. Обижается, если тормозить зря.", 96, 640, 20, P.INK);
  label(ctx, "Один район. Других учеников тут нет.", 96, 674, 18, P.INK);

  const missions = state.missions;
  missions.forEach((mission, index) => {
    const y = 170 + index * 108;
    const unlocked = mission.lesson <= save.unlocked;
    const best = save.best[mission.id] || 0;
    roundRect(ctx, 860, y, 660, 96, 16);
    const picked = state.selected === mission.id;
    ctx.fillStyle = !unlocked ? "#E4D8C4" : picked ? P.YEL : P.PAPER;
    ctx.fill();
    ink(ctx, 5);
    ctx.stroke();
    label(ctx, `${mission.lesson}. ${mission.title}`, 884, y + 32, 24, P.INK);
    label(ctx, unlocked ? mission.objective : "Сначала предыдущий урок", 884, y + 66, 18, P.INK);
    label(ctx, unlocked ? "★".repeat(best) + "☆".repeat(3 - best) : "закрыт", 1450, y + 48, 22, P.INK, "right");
    if (unlocked) spots.push({ id: `mission-${mission.id}`, x: 860, y, w: 660, h: 96 });
  });

  const infY = 170 + 4 * 108;
  if (save.infinite) {
    const bestM = save.bestMeters.infinite || 0;
    roundRect(ctx, 860, infY, 660, 96, 16);
    ctx.fillStyle = state.selected === "infinite" ? P.ORANGE : P.YEL;
    ctx.fill();
    ink(ctx, 5);
    ctx.stroke();
    label(ctx, "Последний урок", 884, infY + 32, 24, P.INK);
    label(ctx, bestM ? `рекорд ${bestM} м` : "Пока машина едет", 884, infY + 66, 18, P.INK);
    spots.push({ id: "mission-infinite", x: 860, y: infY, w: 660, h: 96 });
  } else {
    label(ctx, "Бесконечный урок откроется после первого.", 884, infY + 28, 18, P.INK);
  }

  button(ctx, spots, "sound", 70, 760, 220, 68, save.settings.sound ? "Звук: вкл" : "Звук: выкл", "paper");
  button(ctx, spots, "shake", 310, 760, 280, 68, save.settings.shake ? "Тряска: вкл" : "Тряска: выкл", "paper");
  button(ctx, spots, "go", 1180, 790, 340, 68, "В урок", "primary");
}

function drawMiniYard(ctx, x, y) {
  roundRect(ctx, x, y, 700, 350, 16);
  ctx.fillStyle = P.GRASS;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  const tiles = [
    [40, 30, P.PINK],
    [200, 40, P.BLUE],
    [40, 180, P.ORANGE],
    [210, 190, P.YEL],
  ];
  for (const [dx, dy, color] of tiles) {
    roundRect(ctx, x + dx, y + dy, 140, 110, 10);
    ctx.fillStyle = color;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
  }
  roundRect(ctx, x + 400, y + 30, 250, 280, 12);
  ctx.fillStyle = P.ROAD;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  label(ctx, "двор", x + 70, y + 84, 22, P.INK, "center");
  label(ctx, "только он", x + 250, y + 250, 18, P.INK, "center");
}

function drawPlay(ctx, spots, state) {
  const session = state.session;
  const sim = session.sim;
  const boil = state.save.settings.reducedMotion ? 0 : Math.floor(state.now / 110) % 2;
  const mag = state.save.settings.shake && !state.save.settings.reducedMotion ? sim.shake : 0;
  const held = session.phase === "drive" && (session.brakeHeld || session.keysDown.has("Space"));
  const visual = held ? Math.max(sim.brakeInput, 0.22) : 0;
  const paused = session.phase === "pause" || session.phase === "result";

  ctx.save();
  if (mag) ctx.translate((hash(sim.t * 60) - 0.5) * mag, (hash(sim.t * 40) - 0.5) * mag * 0.6);
  drawWorld(ctx, sim, boil);
  ctx.restore();
  drawCabin(ctx, sim, state, boil, visual);
  drawPatience(ctx, sim, paused);
  drawPedal(ctx, paused ? 0 : visual, paused);
  drawHud(ctx, spots, state, sim);

  if (session.phase === "drive" && !paused) {
    spots.push({ id: "pedal", x: 1088, y: 742, w: 460, h: 140 });
  }
  if (session.phase === "countdown") drawCountdown(ctx, session);
  if (session.phase === "pause") drawPause(ctx, spots, state);
  if (session.phase === "result") drawResult(ctx, spots, state);
  if (state.debug && session.phase === "drive") {
    label(
      ctx,
      `v ${Math.round(sim.v * 3.6)}  p ${sim.patience.toFixed(0)}  x ${sim.x.toFixed(2)}  ${sim.intent}`,
      50,
      820,
      16,
      P.INK,
    );
  }
}

function drawHud(ctx, spots, state, sim) {
  const mission = state.session.mission;
  roundRect(ctx, 44, 44, 230, 64, 12);
  ctx.fillStyle = P.INK;
  ctx.fill();
  const lesson = mission.infinite ? "∞" : String(mission.lesson).padStart(2, "0");
  label(ctx, `УРОК ${lesson}`, 159, 76, 26, P.YEL, "center", true);

  roundRect(ctx, 290, 50, 430, 52, 12);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  const goal = mission.infinite ? `${Math.floor(sim.s)} м` : mission.objective;
  label(ctx, goal, 308, 70, 22, P.INK);
  if (!mission.infinite) {
    const p = Math.max(0, Math.min(1, sim.s / mission.length));
    ctx.fillStyle = "#E7DCC6";
    ctx.fillRect(306, 88, 390, 8);
    ctx.fillStyle = P.PAT_GREEN;
    ctx.fillRect(306, 88, Math.max(0, 390 * p), 8);
  }
  if (mission.cargo === "cake" || mission.cargo === "fish") {
    drawCargoIcon(ctx, 680, 76, mission.cargo, 0.5);
  }

  roundRect(ctx, 948, 40, 64, 64, 12);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.fillStyle = P.INK;
  ctx.fillRect(968, 56, 8, 32);
  ctx.fillRect(984, 56, 8, 32);
  spots.push({ id: "pause", x: 940, y: 36, w: 76, h: 76 });

  if (state.hint && state.session.phase === "drive") {
    roundRect(ctx, 300, 790, 460, 48, 12);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    label(ctx, "Он рулит. Ты только тормозишь.", 530, 814, 18, P.INK, "center");
  }
}

function drawCountdown(ctx, session) {
  ctx.fillStyle = "rgba(28,22,30,0.28)";
  ctx.fillRect(24, 24, 1010, 852);
  roundRect(ctx, 250, 280, 540, 280, 20);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 8);
  ctx.stroke();
  label(ctx, String(session.countdown || 1), 520, 390, 92, P.INK, "center", true);
  const line = session.mission.blurb[session.countdown > 1 ? 0 : 1] || session.mission.blurb[0];
  label(ctx, line, 520, 490, 22, P.INK, "center");
}

function drawWorld(ctx, sim, boil) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ROAD.x, ROAD.y, ROAD.w, ROAD.h);
  ctx.clip();
  ctx.fillStyle = P.GRASS;
  ctx.fillRect(ROAD.x, ROAD.y, ROAD.w, ROAD.h);

  const far = project(88, 0);
  const nearL = project(-8, -4.6);
  const nearR = project(-8, 4.6);
  const farL = project(88, -4.6);
  const farR = project(88, 4.6);
  ctx.beginPath();
  ctx.moveTo(project(-8, -6.4).x, nearL.y);
  ctx.lineTo(project(88, -6.4).x, far.y);
  ctx.lineTo(project(88, 6.4).x, far.y);
  ctx.lineTo(project(-8, 6.4).x, nearR.y);
  ctx.closePath();
  ctx.fillStyle = P.SIDEWALK;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(nearL.x, nearL.y);
  ctx.lineTo(farL.x, farL.y);
  ctx.lineTo(farR.x, farR.y);
  ctx.lineTo(nearR.x, nearR.y);
  ctx.closePath();
  ctx.fillStyle = P.ROAD;
  ctx.fill();
  ctx.strokeStyle = P.PAPER;
  ctx.lineWidth = 5;
  ctx.stroke();

  for (const zone of sim.slippery || []) {
    if (zone.s1 < sim.s - 10 || zone.s0 > sim.s + 90) continue;
    const a = project(zone.s0 - sim.s, 0);
    const b = project(zone.s1 - sim.s, 0);
    ctx.fillStyle = "rgba(90,150,180,0.28)";
    ctx.fillRect(ROAD.x, Math.min(a.y, b.y), ROAD.w, Math.abs(a.y - b.y));
    if (a.y > ROAD.top && a.y < 860) {
      roundRect(ctx, a.x - 70, a.y - 18, 140, 32, 8);
      ctx.fillStyle = P.YEL;
      ctx.fill();
      ink(ctx, 3);
      ctx.stroke();
      label(ctx, "МОКРО", a.x, a.y - 2, 14, P.INK, "center");
    }
  }

  ctx.strokeStyle = P.PAPER;
  ctx.lineWidth = 4;
  ctx.setLineDash([16, 18]);
  ctx.beginPath();
  ctx.moveTo(project(-6, 0).x, project(-6, 0).y);
  ctx.lineTo(project(86, 0).x, project(86, 0).y);
  ctx.stroke();
  ctx.setLineDash([]);

  const start = Math.floor((sim.s - 12) / 26) * 26;
  for (let s = start; s < sim.s + 92; s += 26) {
    const ds = s - sim.s;
    const n = Math.round(s / 26);
    const color = [P.PINK, P.BLUE, P.YEL, P.ORANGE][Math.abs(n) % 4];
    const kind = Math.abs(n) % 5;
    for (const side of [-1, 1]) {
      const spot = project(ds, side * 7.5);
      if (spot.y < 10 || spot.y > 900) continue;
      if (kind === 0) drawTree(ctx, spot.x, spot.y, spot.scale, boil, n + side);
      else if (kind === 1 && side > 0) drawBench(ctx, spot.x, spot.y, spot.scale);
      else drawHouse(ctx, spot.x, spot.y, spot.scale, color, n * side, boil, Math.abs(n) % 7 === 0);
    }
  }

  for (const skid of sim.skids || []) {
    const spot = project(skid.s - sim.s, skid.x);
    if (spot.y < 20 || spot.y > 890) continue;
    ctx.strokeStyle = "rgba(28,22,30,0.45)";
    ctx.lineWidth = 4 * spot.scale;
    ctx.beginPath();
    ctx.moveTo(spot.x - 10 * spot.scale, spot.y);
    ctx.lineTo(spot.x - 8 * spot.scale, spot.y + 18 * spot.scale);
    ctx.moveTo(spot.x + 10 * spot.scale, spot.y);
    ctx.lineTo(spot.x + 8 * spot.scale, spot.y + 18 * spot.scale);
    ctx.stroke();
  }

  for (const h of sim.hazards) {
    const dist = h.s - sim.s;
    if (h.resolved && dist < -6) continue;
    if (dist < -8 || dist > 90) continue;
    drawHazard(ctx, sim, h, boil);
  }

  drawCar(ctx, sim, boil);
  ctx.restore();

  roundRect(ctx, ROAD.x, ROAD.y, ROAD.w, ROAD.h, 8);
  ink(ctx, 8);
  ctx.stroke();
}

function drawHouse(ctx, x, y, sc, color, seed, boil, laundry) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  const ox = boil ? Math.sin(seed) * 1.2 : 0;
  roundRect(ctx, -48 + ox, -28, 96, 74, 4);
  ctx.fillStyle = color;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-56, -22);
  ctx.lineTo(-4, -64);
  ctx.lineTo(58, -20);
  ctx.closePath();
  ctx.fillStyle = color === P.YEL ? P.ORANGE : P.INK;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.PAPER;
  roundRect(ctx, -30, -8, 22, 18, 3);
  ctx.fill();
  roundRect(ctx, 8, -6, 18, 16, 3);
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  if (laundry) {
    ctx.fillStyle = P.PINK;
    ctx.fillRect(20, -58, 16, 12);
    ctx.fillStyle = P.GLASS;
    ctx.fillRect(38, -54, 14, 10);
  }
  ctx.restore();
}

function drawTree(ctx, x, y, sc, boil, seed) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.fillStyle = "#6E4A32";
  roundRect(ctx, -6, -4, 12, 28, 3);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(boil ? 2 : 0, -24, 26, 0, Math.PI * 2);
  ctx.fillStyle = "#7EAA55";
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc((seed % 2 ? -8 : 8), -30, 8, 0, Math.PI * 2);
  ctx.fillStyle = P.GRASS;
  ctx.fill();
  ctx.restore();
}

function drawBench(ctx, x, y, sc) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.fillStyle = P.ORANGE;
  roundRect(ctx, -28, -8, 56, 14, 3);
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-20, 6);
  ctx.lineTo(-20, 18);
  ctx.moveTo(20, 6);
  ctx.lineTo(20, 18);
  ctx.stroke();
  ctx.restore();
}

function drawHazard(ctx, sim, h, boil) {
  const dist = h.s - sim.s;
  const hx = hazardWorldX(h, sim);
  const spot = project(dist, hx);
  if (spot.y < 0 || spot.y > 900) return;
  const sc = Math.max(0.35, spot.scale);
  if (h.type === "pedestrian") drawPed(ctx, spot.x, spot.y, sc, boil);
  else if (h.type === "dog") drawDog(ctx, spot.x, spot.y, sc, boil);
  else if (h.type === "pothole") drawHole(ctx, spot.x, spot.y, sc, boil);
  else if (h.type === "bin") drawBin(ctx, spot.x, spot.y, sc, dist);
  else drawNpc(ctx, spot.x, spot.y, sc, h, dist, boil);

  if (!h.resolved && dist < h.telegraph && dist > 2) {
    const bang = project(dist, hx);
    const by = bang.y - 34 * sc;
    ctx.beginPath();
    ctx.arc(bang.x, by, 16 * sc + 6, 0, Math.PI * 2);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    label(ctx, "!", bang.x, by + 1, Math.max(16, 22 * sc), P.INK, "center", true);
  }

  if (h.trust && !h.resolved && dist < h.telegraph && dist > 0 && h.committed !== "lunge") {
    const free = -Math.sign(h.x || 1) * 1.8;
    const chev = project(Math.max(6, Math.min(dist * 0.45, 22)), free);
    ctx.fillStyle = P.YEL;
    ctx.beginPath();
    ctx.moveTo(chev.x, chev.y - 16);
    ctx.lineTo(chev.x + 14, chev.y + 10);
    ctx.lineTo(chev.x - 14, chev.y + 10);
    ctx.closePath();
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
  }
}

function drawPed(ctx, x, y, sc, boil) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  const step = boil ? 4 : -4;
  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-8, 10);
  ctx.lineTo(-12, 36 + step);
  ctx.moveTo(8, 10);
  ctx.lineTo(14, 36 - step);
  ctx.stroke();
  roundRect(ctx, -18, -18, 36, 34, 8);
  ctx.fillStyle = P.PINK;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -36, 16, 0, Math.PI * 2);
  ctx.fillStyle = P.SKIN;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.WHITE;
  ctx.beginPath();
  ctx.arc(-2, -38, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.INK;
  ctx.beginPath();
  ctx.arc(-1, -38, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.INK;
  roundRect(ctx, 10, -8, 10, 16, 2);
  ctx.fill();
  ctx.restore();
}

function drawDog(ctx, x, y, sc, boil) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.fillStyle = "#8A5A3A";
  roundRect(ctx, -28, -16, 56, 28, 4);
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.INK;
  const leg = boil ? 4 : 0;
  ctx.fillRect(-20, 10, 6, 12 + leg);
  ctx.fillRect(-6, 10, 6, 14 - leg);
  ctx.fillRect(8, 10, 6, 12 + leg);
  ctx.fillRect(18, 10, 6, 10);
  ctx.beginPath();
  ctx.arc(24, -8, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHole(ctx, x, y, sc) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.strokeStyle = P.YEL;
  ctx.lineWidth = 4;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 18, Math.sin(a) * 12);
    ctx.lineTo(Math.cos(a) * 30, Math.sin(a) * 20);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#2A241C";
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.restore();
}

function drawBin(ctx, x, y, sc, dist) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.rotate(dist < 18 ? 0.5 : 0.15);
  roundRect(ctx, -16, -28, 32, 40, 4);
  ctx.fillStyle = "#6E8A62";
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.INK;
  ctx.fillRect(-18, -32, 36, 6);
  ctx.restore();
}

function drawNpc(ctx, x, y, sc, h, dist, boil) {
  const colors = [P.BLUE, P.ORANGE, P.TEAL, P.PINK];
  const color = colors[Math.abs(hash(h.s) * 4 | 0) % colors.length];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  if (h.type === "cutin" && dist > 8) ctx.rotate(-0.4);
  roundRect(ctx, -22, -36, 44, 70, 8);
  ctx.fillStyle = color;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(-14, -28, 28, 16);
  ctx.fillStyle = P.INK;
  ctx.fillRect(-16, 20, 10, 12);
  ctx.fillRect(6, 20, 10, 12);
  if (h.type === "cutin" && dist < 40) {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(22, -10);
    ctx.lineTo(40, -24 + (boil ? 2 : 0));
    ctx.stroke();
  }
  ctx.restore();
}

function drawCar(ctx, sim, boil) {
  const spot = project(0, sim.x);
  ctx.save();
  ctx.translate(spot.x, spot.y);
  ctx.rotate(sim.brakeInput * 0.16);
  const squash = 1 - Math.min(0.28, sim.crashT);
  ctx.scale(1.05, squash);
  // Flat ink puddle. No translucent ellipse: that read as a soft shine under the roof.
  roundRect(ctx, -26, 34, 58, 14, 4);
  ctx.fillStyle = P.INK;
  ctx.fill();
  ink(ctx, 4);
  ctx.stroke();
  roundRect(ctx, -32, -48, 64, 92, 12);
  ctx.fillStyle = P.YEL;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.fillStyle = P.GLASS;
  ctx.fillRect(-22, -36, 44, 22);
  roundRect(ctx, -16, -20, 32, 22, 3);
  ctx.fillStyle = P.RED;
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  label(ctx, "У", 0, -9, 16, P.PAPER, "center", true);
  const lamps = sim.brakeInput > 0.2 || sim.lastSelfBrake > 0.12;
  ctx.fillStyle = lamps ? P.ORANGE : P.INK;
  ctx.fillRect(-22, -46, 12, 8);
  ctx.fillRect(10, -46, 12, 8);
  const spin = sim.s * 2.2 + (boil ? 0.3 : 0);
  drawWheel(ctx, -24, -24, spin);
  drawWheel(ctx, 24, -24, spin);
  drawWheel(ctx, -24, 24, spin);
  drawWheel(ctx, 24, 24, spin);
  if (sim.body < 66) {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-10, 8);
    ctx.lineTo(6, 16);
    ctx.lineTo(-4, 24);
    ctx.stroke();
  }
  if (sim.body < 33) {
    ctx.fillStyle = "#D9C27A";
    ctx.fillRect(8, -4, 16, 10);
    ctx.strokeStyle = P.INK;
    ctx.strokeRect(8, -4, 16, 10);
  }
  if (sim.cargoType) drawCargoIcon(ctx, 0, -62, sim.cargoType, 0.7);
  ctx.restore();
}

function drawWheel(ctx, x, y, spin) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = P.INK;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = P.PAPER;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.cos(spin) * 6, Math.sin(spin) * 6);
  ctx.lineTo(-Math.cos(spin) * 6, -Math.sin(spin) * 6);
  ctx.stroke();
  ctx.restore();
}

function drawCargoIcon(ctx, x, y, type, sc) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  if (type === "cake") {
    roundRect(ctx, -18, -10, 36, 22, 4);
    ctx.fillStyle = P.PINK;
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
    ctx.strokeStyle = P.INK;
    ctx.beginPath();
    ctx.moveTo(-6, -10);
    ctx.lineTo(-6, -22);
    ctx.moveTo(6, -10);
    ctx.lineTo(6, -22);
    ctx.stroke();
  } else {
    roundRect(ctx, -16, -14, 32, 26, 6);
    ctx.fillStyle = P.GLASS;
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
    ctx.fillStyle = P.ORANGE;
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 5, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCabin(ctx, sim, state, boil, visual) {
  roundRect(ctx, 1056, 24, 520, 600, 8);
  ctx.fillStyle = P.CABIN;
  ctx.fill();
  ink(ctx, 8);
  ctx.stroke();
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
    roundRect(ctx, 1080, 156, 280, 48, 12);
    ctx.fillStyle = P.PAPER;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    label(ctx, sim.bubble, 1220, 180, 20, P.INK, "center");
  }
  ctx.restore();
}

function drawAnton(ctx, exp, boil, lean, sim) {
  const ox = boil ? 1.6 : 0;
  const nod = lean * 16 + (exp === "belted" ? 18 : 0);
  ctx.save();
  ctx.translate(1316 + ox, 250 + nod * 0.25);

  roundRect(ctx, -92, 78, 184, 150, 18);
  ctx.fillStyle = P.TEAL;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();

  ctx.strokeStyle = P.INK;
  ctx.lineWidth = exp === "belted" ? 8 : 5;
  ctx.beginPath();
  ctx.moveTo(-70, 96);
  ctx.lineTo(20, 168);
  ctx.stroke();

  ctx.strokeStyle = P.INK;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-78, 150);
  ctx.quadraticCurveTo(-40, 210, 0, 196);
  ctx.moveTo(78, 150);
  ctx.quadraticCurveTo(40, 214, 0, 196);
  ctx.stroke();

  const wheel = Math.max(-0.4, Math.min(0.4, ((sim.targetX || 1.8) - sim.x) * 0.35));
  ctx.save();
  ctx.translate(0, 198);
  ctx.rotate(wheel);
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
    const lift = exp === "furious" ? 8 : 0;
    ctx.moveTo(hx, -78);
    ctx.quadraticCurveTo(hx + (i - 1.5) * 6, -118 - lift - (boil && i % 2 ? 4 : 0), hx + 8, -96);
  });
  ctx.stroke();

  const look = lookFor(exp);
  eye(ctx, -30, -8, 27, 23, 8, look.left);
  eye(ctx, 28, 10, 15, 13, 5, look.right);
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
  if (exp === "proud") return { left: { x: 2, y: -1 }, right: { x: 0, y: 1 } };
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
    ctx.lineTo(-10, -38);
    ctx.moveTo(14, -16);
    ctx.lineTo(46, -22);
  } else if (exp === "belted") {
    ctx.moveTo(-56, -48);
    ctx.lineTo(-12, -40);
    ctx.moveTo(12, -28);
    ctx.lineTo(46, -36);
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
  if (exp === "annoyed") {
    ctx.moveTo(-20, 52);
    ctx.quadraticCurveTo(0, 46, 22, 58);
  } else if (exp === "focused") {
    ctx.moveTo(-16, 54);
    ctx.lineTo(18, 54);
  } else if (exp === "belted") {
    ctx.arc(0, 56, 10, 0, Math.PI * 2);
  } else if (exp === "proud") {
    ctx.moveTo(-22, 50);
    ctx.quadraticCurveTo(4, 70, 26, 46);
  } else if (exp === "ashamed") {
    ctx.moveTo(-16, 60);
    ctx.quadraticCurveTo(4, 50, 20, 58);
  } else {
    ctx.moveTo(-18, 54);
    ctx.quadraticCurveTo(0, 62, 20, 52);
  }
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
  label(ctx, word, 1084, 688, 26, P.INK);
  drawGlyph(ctx, 1200, 688, glyph, sim.patience);
  const x = 1236;
  const y = 664;
  const w = 310;
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
  roundRect(ctx, 1168, 812, 250, 36, 10);
  ctx.fill();
  roundRect(ctx, 1188, y, 250, 92, 16);
  ctx.fillStyle = disabled ? "#B7A898" : P.RED;
  ctx.fill();
  ink(ctx, 6);
  ctx.stroke();
  label(ctx, "ТОРМОЗ", 1313, y + 48, 28, disabled ? P.INK : P.PAPER, "center", true);
  if (visual > 0.4 && !disabled) {
    ctx.strokeStyle = P.INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(1160, y + 20);
    ctx.lineTo(1140, y + 4);
    ctx.moveTo(1450, y + 24);
    ctx.lineTo(1472, y + 8);
    ctx.stroke();
  }
}

function drawPause(ctx, spots, state) {
  ctx.fillStyle = "rgba(28,22,30,0.4)";
  ctx.fillRect(0, 0, 1600, 900);
  roundRect(ctx, 540, 200, 520, 500, 20);
  ctx.fillStyle = P.PAPER;
  ctx.fill();
  ink(ctx, 8);
  ctx.stroke();
  label(ctx, "ПАУЗА", 800, 260, 40, P.INK, "center", true);
  label(ctx, "Педаль выключена", 800, 314, 22, P.INK, "center");
  button(ctx, spots, "resume", 610, 360, 380, 72, "Продолжить", "primary");
  button(ctx, spots, "retry", 610, 450, 380, 72, "Заново", "paper");
  button(ctx, spots, "to-garage", 610, 540, 380, 72, "В гараж", "paper");
  const sound = state.save.settings.sound ? "Звук вкл" : "Звук выкл";
  const shake = state.save.settings.shake ? "Тряска вкл" : "Тряска выкл";
  button(ctx, spots, "sound", 610, 620, 180, 56, sound, "paper");
  button(ctx, spots, "shake", 810, 620, 180, 56, shake, "paper");
}

function drawResult(ctx, spots, state) {
  const sim = state.session.sim;
  const graded = state.session.result;
  ctx.fillStyle = P.PAPER;
  ctx.fillRect(0, 0, 1600, 900);
  roundRect(ctx, 24, 24, 1552, 852, 18);
  ctx.fillStyle = P.GRASS;
  ctx.fill();
  ink(ctx, 8);
  ctx.stroke();
  const line = resultPhrase(sim, graded);
  label(ctx, line, 800, 78, 36, P.INK, "center", true);
  ctx.save();
  ctx.translate(-860, 30);
  drawAnton(ctx, resultPose(sim, graded), 0, 0, sim);
  ctx.restore();
  const rows = [
    ["Машина", graded.body],
    ["Нервы", graded.mood],
    [sim.cargoType ? "Груз" : "Комфорт", graded.comfort],
  ];
  rows.forEach((row, i) => {
    const y = 180 + i * 110;
    label(ctx, row[0], 860, y, 26, P.INK);
    roundRect(ctx, 1060, y - 18, 420, 40, 10);
    ctx.fillStyle = "#E7DCC6";
    ctx.fill();
    roundRect(ctx, 1060, y - 18, Math.max(8, 4.2 * row[1]), 40, 10);
    ctx.fillStyle = row[1] >= 70 ? P.PAT_GREEN : row[1] >= 40 ? P.PAT_YELLOW : P.PAT_RED;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    label(ctx, String(Math.round(row[1])), 1500, y, 22, P.INK, "right");
  });
  if (!sim.infinite) {
    const stars = "★".repeat(graded.stars) + "☆".repeat(3 - graded.stars);
    label(ctx, stars, 1180, 520, 42, P.INK, "left");
    label(ctx, `${Math.round(graded.percent)}%`, 1420, 524, 22, P.INK, "left");
  }
  if (graded.badge) {
    roundRect(ctx, 860, 560, 520, 48, 12);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 4);
    ctx.stroke();
    label(ctx, "Почти не понадобился", 1120, 584, 22, P.INK, "center");
  }
  if (sim.infinite) {
    const bill = repairInvoice(sim.stats, sim.t);
    bill.lines.slice(0, 4).forEach((entry, i) => {
      label(ctx, `${entry[0]}  ${entry[1]}`, 880, 560 + i * 28, 16, P.INK);
    });
    label(ctx, `Итого ${bill.total}`, 880, 680, 22, P.INK);
  }
  const primary = graded.success ? "paper" : "primary";
  button(ctx, spots, "retry", 200, 760, 340, 78, "Ещё раз", primary);
  button(ctx, spots, "next", 1040, 760, 340, 78, graded.success && !sim.infinite ? "Дальше" : "В гараж", "primary");
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
