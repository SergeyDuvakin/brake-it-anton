# INTEGRATION — pixel restyle (assets/pixel → game code)

Brief for the code agent. All art in `assets/pixel/` is approved by Sergey Duvakin (17.11.2026): proto5 Anton (6 poses), the cabin with the seat, the centred pedal, no mood plate, and the proto4 car and city (the roof triangle with У stays as it is). The numbers below are taken from `manifest.json`. That file is the source of truth for every file, rect and anchor.

## 0. Standing rules (do not break)

1. **The player only brakes.** There is no steer, throttle or horn input. Anton drives; the player holds the pedal.
2. **Patience starts at 15 and rises 7.2/s** (`CFG.patienceStart`, `CFG.irritationRate`). Do not change `js/config.js`, `js/sim.js`, `js/physics.js` or `js/missions.js` gameplay values in this work.
3. **The cabin background is fixed.** Only Anton's pose changes: no camera shake inside the cabin, no moving window and no animated seat. The 6 pose frames carry identical background pixels.
4. **Inanimate road objects never move by themselves.** Bins, lids, holes, parked cars, buildings, trees and furniture move on screen only with the camera, using exactly the same rounding as the ground. Only pedestrians, dogs and cut-in cars follow their existing sim motion (`h.pose`).
   - **Takers come later. Do not add them now.**
5. Keep **`npm test`, `npm run lint` and `npm run test:e2e` green**. Also keep `npm run check` green. Update tests only where a test asserts old pixels or layout, and say so in the PR.
6. **No new art.** Use only these files. If something is missing (see §9), stop and ask; do not draw or generate a substitute.
7. Work on a feature branch and open a PR. Do not push to `main`.

## 1. Pixel rendering basics

- **Scale.** Integer **×4** only (`manifest.scale`). 1 art px = 4 screen px on the 1600×900 canvas. Never use ×3.5 or any fractional scale, and never use rotation other than the provided 90° files.
- **Smoothing.** Before every pixel blit set `ctx.imageSmoothingEnabled = false`. `draw.js:216`, `ui.js:730` and `cast.js` set it to `true` for the old art. Wrap the pixel draws in `save()/restore()` so the two paths do not leak into each other.
- **CSS.** Add `image-rendering: pixelated;` to `canvas` in `style.css`. The canvas is CSS-scaled to the viewport, so on non-integer device scales a few rows will be uneven; that is expected and acceptable.
- **Offscreen world.** Draw the world at native size into an offscreen canvas `world` of **250×211**. Use only integer coordinates, rounding every position with `Math.round` once.
  - Then blit it in one call: `ctx.drawImage(world, 28, 28, 1000, 844)`.
  - Draw the HUD in the same native buffer (gauge and pause, §6), so that it is snapped to the same grid.
- **Cabin.** Draw a 125×150 frame to `(1066, 34, 500, 600)`. That is `DRIVER_PLATE.x + CABIN_INSET` and `DRIVER_PLATE.y + CABIN_INSET`, at ×4.
- **1:1 assets** (`"scale": 1` in the manifest): the right-column plates and the pedal. Blit them at their screen xy without scaling. They are the approved screen-resolution drawings.
- **Text.**
  - Font: Pixeloid Sans Bold. Load it with `new FontFace("Pixeloid Sans", "url(assets/pixel/fonts/PixeloidSans-Bold.ttf)")`.
  - Native size is 9px. Draw at 9px into a small offscreen canvas and threshold the alpha: `a >= 128 → 255`, else 0. Canvas text is antialiased, and the art is not.
  - Then blit at ×4. Use ×3 or ×2 only where ×4 does not fit; the callout needs ×2.
  - Cache rendered strings.

## 2. What to replace

Create two new modules: `js/pixel-assets.js` (loading, §7) and `js/pixel-world.js` (world, §5). The old functions stay as the **fallback path**; do not delete them in this PR.

| Old code | New behaviour (when `pixelReady()`) |
|---|---|
| `draw.js drawWorld()` (perspective road via `road.js project`) | `drawPixelWorld(ctx, sim, alpha)`: a top-down straight road, sprites and the car, then the corner mask and the world plate frame (§5). |
| `drawBuilding`, `drawTree` | `world/sprites/*` buildings and `tree`, placed deterministically by `s` (§5). |
| `drawPed` | `ped-{pink,blue}-{left,right}-{0,1}`. Face is the walking direction. Alternate steps every 0.25 s only while the walker moves, using the existing gait or `h.motion`. |
| `drawDog` | `dog-left` / `dog-right`, by direction. |
| `drawBin` | `trash-bin` (static). |
| `drawRoller` (the "lid" hazard) | `manhole` sprite, flat on the asphalt and static. |
| `drawNpc` (`stopped`, `cutin`) | `car/npc-white-up.png` for `stopped`, `car/npc-blue-up.png` for `cutin`, so the NPC travels the same way. Lateral motion is the sim's `h.pose.x` only. No rotation, no lean frames. |
| `drawCar` / `drawCarSprite` / `playerPlanImage` | `car/learner-*.png` (§4). |
| `drawHole` (pothole) | **No approved pixel sprite.** See §9. Keep the old draw only behind the fallback; ask Sergey for a pothole sprite before merging. |
| `drawDriverPlate()` | Blit `ui/plate-driver.png` at (1056, 24). |
| `cabin.js paintCabin()` | Blit the pixel pose frame (§3). **No crossfade, no sleep clips** in the pixel path: hard-cut between stills. Passenger portraits (`mission.portrait`, `drawPassenger`) keep their old art for now (§9). |
| Bubble in `drawCabin` (`1088,186,250,48`) | The pixel bubble: 9-slice `ui/bubble-9slice.png` (1px INK frame, CREAM fill) and `ui/bubble-tail.png`, text ×4. Approved example: «Я САМ!» at screen `1096,92`, size `220×56`, tail at x+140 pointing down to the head. Width = text width + 2×(1+2) native px, snapped to ×4, clamped to `DRIVER_PLATE`. If the text is wider than 118 native px, use text ×3. |
| `ui.js drawGauge()` | The pixel gauge (§6). |
| `ui.js drawPedalZone()` | `ui/plate-pedal.png` plus the pedal parts (§6). |
| Pause mark | `ui/pause-button.png` (§6). |
| `MOOD_TILE` | **Do not draw.** Removed by Sergey. Keep the constant only if tests need it. |
| `CALLOUT` (hint / «Ткни в него · F») | Same rect `1080,576,472,48`: the 9-slice at ×4 (118×12 native), Pixeloid ×2, INK on CREAM. |

Out of scope for this PR: title, garage, pause screen, result screen and countdown chip. They keep the current art.

## 3. Anton's poses → game states

Pixel frames: `drive`, `phone`, `asleep`, `oy`, `yasam`, `grumble` (`cabin/poses/<id>.png`, or `anton-poses-sheet.png` with `sheet_rect`).

Map the result of `cabinPoseId()` (unchanged) through `PIXEL_POSE`:

| `cabinPoseId` | pixel frame | why |
|---|---|---|
| `drive`, `focused` | `drive` | calm driving |
| `belted` | `oy` | belt yank / cargo flash startle. The countdown and the first 1.15 s also return `belted`. Map **countdown → `drive`** (check `phase === "countdown"` before the lookup). |
| `phone`, `stow` | `phone` | |
| `drowsy`, `asleep` | `asleep` | |
| `wake` | `oy` | |
| `earnest`, `preen`, `proud` | `yasam` | «Я САМ!», smug thumb up (the title screen uses `preen`) |
| `annoyed`, `angry`, `furious`, `ashamed` | `grumble` | «бубнит» |
| anything else | `drive` | |

- `cabinPoseId()` must keep returning the old ids, because tests and e2e read them. The mapping lives in the pixel draw only.
- Keep the old JPG poses as the fallback when the pixel set is not ready.

## 4. Car states

The learner car is 26×44 native: canvas incl. tyres and mirrors, body `3,1 20×40`, centre anchor `13,21`.

- **brake** when `sim.brakeInput > 0.05` (the brake lights are the feedback of the only input).
- **hazard** when `sim.crashT > 0.05`, damage stage ≥ 2, or the session result is a failure. While in hazard, blink **2 Hz**: 250 ms `learner-hazard`, 250 ms `learner-normal` (or `learner-brake` while braking). With `reducedMotion`, show `learner-hazard` steadily.
- **normal** otherwise.
- **No yaw / lean / squash frames.** Drop `YELLOW_LEFT/RIGHT/SMALL_*` and the crash squash in the pixel path.
- The road in the pixel path is straight (§9). Lateral offset = `pose.x` in metres × `WORLD_PX_PER_M`, rounded.
- Position on screen: native `(147 + dx, 146)`, i.e. screen `(616, 612)` at dx=0, body centre `(668, 696)`, own lane centre native x 159.5.
- Shadow: a rounded rect `5,3 20×40 r5` relative to the sprite. Draw it as rgba(0,0,0,0.2) on the asphalt before the car.
- Garage cars (`mint`, `blue`) have no pixel art yet. Use the learner sprite in the pixel path, or keep the fallback; flag it in the PR.

## 5. World: straight road, scrolling

- Native view 250×211 at screen (28,28) ×4.
- Constants:
  - `WORLD_PX_PER_M = 32 / CFG.roadHalf` (≈ 9.85 native px per metre; one lane = 32 px = 3.25 m);
  - `ROAD_CX = 143.5`; `CAR_CENTER_Y = 167` (`sim.s` is the car centre; the nose is `CFG.carHalfFront` ahead, at native y 147).
- Camera: `camPx = Math.round(pose.s * WORLD_PX_PER_M)`, where `pose = renderPose(sim, alpha)` is already used by `placedScene`.
- Ground: `road-straight-strip.png` (250×128, loops vertically). Draw it at `y = (camPx % 128) - 128 + k*128` for k = 0..2, so the ground moves down as the car moves forward.
- Any world object at metres `(s, x)`:
  - `yNative = CAR_CENTER_Y - (Math.round(s * WORLD_PX_PER_M) - camPx)`;
  - `xNative = Math.round(ROAD_CX + x * WORLD_PX_PER_M)`;
  - The sprite is drawn at `(xNative - anchor[0], yNative - anchor[1])`.
  - Use **the same `camPx`** for ground and objects. Static things then stay locked to the asphalt pixel for pixel (rule 0.4).
  - Positive `x` is right, as in `road.js project`.
- Hazards: read `h.pose.s/x` (static ones never change) and `hazardWorldX()` exactly as `placedScene()` does. Do not add motion.
- Markings: use the approved overlays as they are.
  - `zebra-across-road.png` at native x 112 for crossings, wherever a mission authors a pedestrian crossing.
  - `stop-line-right-lane.png` at x 145.
  - `centre-solid-8.png` at x 143, repeated, for no-overtaking runs.
- Roadside dressing: deterministic, from a hash of 32 m blocks so it never pops or changes on replay.
  - Buildings:
    - left side: right-aligned to x ≤ 94;
    - right side: from x ≥ 193, max width 57;
    - `shop-grey` (62 wide) goes on the left only.
  - Trees go on the grass; bench, trash-bin, hydrant, planter and manhole on the sidewalks (x 96–111 / 176–191).
  - Never put dressing on the asphalt.
  - Buildings use the facade-bottom anchor. Their facades face south (the camera), as approved.
- Z-order:
  - ground and markings → shadows → all sprites sorted by anchor `yNative` ascending (footY) → the learner car among them by its tail y → HUD.
  - Then the corner mask (`ui/world-corner-mask.png`), then the frame (`ui/world-plate-frame.png`, 252×213 native at screen (24,24) ×4 = 1008×852).
  - `VIEW.panel` is 1010 wide. The art plate is 1008; use 1008 in the pixel path.
- Shadows: `world/shadows/<name>.png` (same size as the sprite). Fill its opaque pixels with rgba(0,0,0,0.2) before the sprite. Pre-tint them once into an offscreen canvas.
- Wave 2 (not now): `junction-ground-250x211.png` and `reference-scene-250x211.png` show the approved T-junction (stop line, zebras, traffic light, NPCs).

## 6. Patience gauge, pause, pedal

- **Gauge.**
  - `ui/gauge-face.png` (72×46) is drawn at native (3,3) in the world buffer, which is screen `(40, 40)` and 288×184. Its shadow (rgba 0.2) is a rounded rect at +2,+2 (r4); the pause button uses the same shadow. Replace `GAUGE.box` usage in the pixel path.
  - Needle:
    - angle `deg = patienceNeedleDegrees(sim.patience)` (unchanged; 180° = left/green at 0);
    - length 15 native px, 2 px thick, INK `#2A2430`, from the hub (36,39 in the face);
    - endpoints rounded to integers, drawn as native pixels;
    - then the hub cap: a 5×4 ink rect at hub −2,−2 with a 3×2 cream `#FFF6E4` inner at −1,−1.
  - **Readout must stay correct for e2e:**
    - `needleDeg` = the same degrees;
    - `hubX/hubY` = screen centre of the hub = `40 + 36*4 + 2`, `40 + 39*4 + 2`;
    - `tipX/tipY` = hub + 60·(cos, −sin).
- **Pause.** `ui/pause-button.png` (24×22) at native (223,3), which is screen `(920, 40)` and 96×88. Move `PAUSE_BUTTON` to `{x: 920, y: 40, w: 96, h: 88}` so the hit box equals the art. Update any e2e coordinates that click the old rect.
- **Pedal** (1:1 screen pixels, centred).
  - Plate: `ui/plate-pedal.png` at (1056, 660).
  - Bracket: `pedal-bracket.png` at (1281, 708); the pivot is at (1316, 724).
  - Pad: `pedal-pad.png` at `(1236, 738 + drop)`, where `drop = Math.round(brake * 7) * 4` (0..28).
  - Rod: fill `#4A4A52` at x 1308..1323 from y 732 to `padY + 4`, with 1px `#1C181C` edges on cols 1308 and 1323.
  - Order: plate, bracket, rod, pad. `pedal-idle.png` and `pedal-pressed.png` are the same drawing at drop 0 and 28, for reference or a two-frame fallback.
  - Keep `pedalHitBox()` = `PEDAL_ZONE` and `pedalDeg = pedalHingeDegrees(brake)` in the readout. The pad now slides instead of hinging; the readout value stays for tests.

## 7. Preloading and fallbacks

- `js/pixel-assets.js`:
  - `whenPixelReady()` fetches `assets/pixel/manifest.json`, then loads every PNG in it and the FontFace;
  - `pixelReady()` returns true only when all of them have loaded;
  - `pixelImage(path)` returns a loaded image.
  - Pattern: copy `cabin.js` (`globalThis.Image` check, so Node tests stay inert and return `false`).
- Start loading at boot, next to `whenCabinReady()`. Until ready, and permanently on any load error, render the **current** art path. Log once; never show a blank frame.
- A URL flag, `?art=classic` or the existing settings object, may force the old path for comparison. Default is the pixel path once ready.
- Deploy: `.github/workflows/deploy-pages.yml` whitelists asset folders.
  - Add `mkdir -p .pages-dist/assets/pixel` and `cp -a assets/pixel/. .pages-dist/assets/pixel/`, plus a `test -f .pages-dist/assets/pixel/manifest.json`.
  - Extend the "pages bundle" unit test if it enumerates assets.
- Licences:
  - add Pixeloid Sans to `licenses/NOTICE.md`;
  - copy `assets/pixel/fonts/OFL-LICENSE.txt` to `licenses/fonts/OFL-Pixeloid.txt`.
- Size: the package is about 0.5 MB. The existing "cabin frames < 2.5 MB" test only walks `assets/cabin`.

## 8. Tests to add or keep

- Unit (node):
  - the pose map covers every `CABIN_POSES` id;
  - `WORLD_PX_PER_M` and the `s → yNative` function: a static hazard's `yNative − groundOffset` is constant while `sim.s` changes (rule 0.4);
  - the pedal drop is 0..28 in steps of 4;
  - the gauge readout degrees are unchanged.
- e2e:
  - existing needle/pedal readout tests still pass;
  - add a screenshot smoke test that the world view, cabin and pedal render with the pixel path (no blank, `imageSmoothingEnabled === false` at blit time if you expose it).
- Run `npm test`, `npm run lint`, `npm run check` and `npm run test:e2e`. All must pass before the PR is ready.
- Do not claim testing on a physical phone unless it was done.

## 9. Known gaps and risks (decide with Sergey, do not improvise)

1. **Look-ahead distance.** Top-down at ×4 shows about **15 m** ahead of the nose (147 native px ÷ 9.85). The perspective view showed `VIEW.look` = 72 m, and missions telegraph hazards at 48–78 m. At `storySpeedCap` 22 m/s that is about 0.7 s of warning, versus about 3 s now.
   - Do **not** retune CFG or missions in this PR. Implement the mapping in one function `dsToNativeY(ds)` (identity scale by default), and measure the warning time in a test or log.
   - Options for Sergey:
     - (a) accept and retune speeds or telegraphs later;
     - (b) compressed far zone: true scale near the car, compressed above it. The ground strip must then be remapped row by row with the same function, so static objects stay locked to the asphalt;
     - (c) an edge "что-то впереди" indicator.
2. **Curves.** `routeYaw` / curved routes have no top-down art. The pixel path draws the road straight and ignores yaw. The T-junction is Wave 2.
3. **Pothole** has no approved pixel sprite. The roller (lid) uses `manhole`; bin uses `trash-bin`.
4. **Only 6 poses vs 15 ids.** There are no sleep/wake clips and no crossfade, and several moods share `grumble` / `yasam`.
5. **Passenger portraits** (`students/*.jpg`) and garage cars `mint`/`blue` stay in the old style.
6. **Layout drift.** World plate 1008 vs `VIEW.panel` 1010. `PAUSE_BUTTON` moves to (920,40). `MOOD_TILE` is no longer drawn. The gauge moves to (40,40, 288×184).
7. **Car size.** The pixel body is 20×40 native = 80×160 screen ≈ 2.0×4.1 m, versus the physics box 1.7×3.4 m (`carHalfW`, `carHalfFront`, `carHalfBack`). The visuals will touch about 1–2 px before a physics contact. Do not change the physics.
8. **The 1:1 plates and pedal** use the approved screen-resolution drawing, including the small round-corner marks inside them. They are intentional; keep them as they are.
9. **Font source.** Pixeloid came from a public mirror (OFL 1.1, same release). Swap in the official itch.io archive file when available.
