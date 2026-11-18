# Stage 2 — crash scene («красивая и смешная авария»): implementation brief

Repo: `SergeyDuvakin/brake-it-anton`, base: `main` @ 8c45132 (after PR #36). One PR, branch `cursor/crash-scene-13c8`.
The storyboard, sprites and texts are approved by Sergey. Visual reference (exact look and timing):
- `/workspace/bia-pixel/crash/crash-car.mp4`, `crash-ped.mp4`, `crash-dog.mp4`, `crash-pothole.mp4` (and `.gif`; all four in a row: `crash-all.mp4`)
- `/workspace/bia-pixel/crash/storyboard-car.png`, `storyboard-variants.png`, `storyboard-dog.png`
- the reference renderer (Python): `/workspace/bia-pixel/crash/scenes.py` + `compose.py`. Every offset and timing below is copied from there.

**Hard rules**
- Integer ×4 for world/cabin art, `imageSmoothingEnabled = false`, no fractional positions. Shake offsets are multiples of 4 screen px.
- The cabin background stays fixed; only the Anton pose frame changes.
- Inanimate objects never move by themselves. Bins, lids, holes and parked cars keep their pose for the whole scene (dented sprites only swap the picture).
- People and dogs are never shown hurt: they jump away and stay angry.
- **Remove nothing old.** Classic renderer, `?art=classic` and old assets stay. The classic path only gets the same timing (freeze → result) and no new art.
- Commit identity: `-c user.name="Sergey Duvakin" -c user.email="sergeyduvakin@users.noreply.github.com"`.

---

## 1. Assets: copy and register

Copy `/workspace/bia-pixel/crash/final/` into `assets/pixel/`, keeping the sub-paths. Add each file to `assets/pixel/manifest.json` under a new `"crash"` block (any object with a `"file"` key is preloaded by `collectPngs`). Frame layouts are in `final/files.json`.

| File (under assets/pixel/) | Size | Frames | Use |
|---|---|---|---|
| `cabin/poses/bams-0.png`, `bams-1.png` | 125×150 each | 2 separate files | Anton «руки вверх», full cabin frame like the other poses, drawn at (1066,34) ×4. Alternate every 100 ms |
| `car/learner-crash.png` | 26×44 | 1 | Student car with crumpled hood. Same silhouette and anchor as `learner-normal.png` |
| `car/npc-white-up-crash.png` | 26×44 | 1 | Parked (`stopped`) car, crumpled rear. Same anchor as `npc-white-up.png` |
| `car/npc-blue-up-crash.png` | 26×44 | 1 | Cut-in (`cutin`) car, crumpled rear. Same anchor as `npc-blue-up.png` |
| `fx/stars.png` | 90×14 | 3 × (30×14), horizontal strip, frame i at x = 30·i | 3 stars circling over the hood, 100 ms/frame, loop |
| `fx/steam.png` | 56×14 | 4 × (14×14) | Steam from the hood, 150 ms/frame, loop. Frames 0–1 are reused as pothole dust |
| `fx/bams.png` | 192×46 | 2 × (96×46) | «БАМС!» burst, alternate every 66 ms |
| `fx/opa.png` | 128×32 | 2 × (64×32) | «ОПА!» (pedestrian), alternate every 66 ms |
| `fx/gav.png` | 120×30 | 2 × (60×30) | «ГАВ!» (dog), alternate every 66 ms |
| `fx/anger.png` | 5×5 | 1 | red «#» anger mark, blinks 100 ms on / 100 ms off |
| `fx/alarm.png` | 3×7 | 1 | small «!» over a startled pedestrian or dog |
| `world/sprites/ped-blue-react.png`, `ped-pink-react.png` | 60×20 | 5 × (12×20): 0 startle, 1 air, 2 land, 3 fist0, 4 fist1 | Pedestrian reaction. Use the colour that matches the pedestrian who was hit |
| `world/sprites/dog-react.png` | 48×12 | 3 × (16×12): 0 startle, 1 hop, 2 bark | Dog reaction |

All sprites face right. When a reaction runs to the left, mirror with `ctx.scale(-1, 1)` at an integer origin.

---

## 2. Rules (sim) — `js/sim.js`, `js/config.js`
1. **Pedestrian and dog hits end the run.** In `resolveHit`, if `h.type === "pedestrian" || h.type === "dog"` and `impact >= 1.2`, set `bodyLoss = 100`. This applies to cargo trips too. Below 1.2 m/s keep today's behaviour. Car, bin, lid and pothole damage rules stay as they are.
2. **Record the cause.** In `resolveHit` set `sim.lastHit = { id: h.id, type: h.type, t: sim.t, x: hazardWorldX(h, sim), color: h.color ?? null }`. For a pedestrian, `color` = "blue" | "pink" — the same rule as `pixel-world.js` line ~248: `(hash(String(h.id).length * 13 + (h.s | 0)) & 1) ? "blue" : "pink"`. Reuse that helper; do not duplicate it. Add `sim.failCause`: when `fail(sim, "body")` or `fail(sim, "cargo")` happens within 0.05 s of `lastHit.t`, `failCause = lastHit.type`; otherwise `failCause = failReason`.
3. **Soft bin/lid touch stays harmless.** `softTouch` at `v <= SAFE_SPEED.bin` (10.5): no body loss, no impact scene, «ФУХ.». Do not change it.
4. **Pothole while Anton is out.** If the pothole hit happens with `sim.attention === "asleep" || sim.attention === "drowsy"`:
   - do **not** `say("ОЙ!")` and do not queue «ЯМА ЖЕ!»;
   - the pose stays asleep;
   - the bounce and shake still play.

   In every other non-fatal pothole hit: «ОЙ!» now, and after 0.7 s «ЯМА ЖЕ!» via the normal bubble queue. Add `sim.potholeLineAt = sim.t + 0.7`, consumed in `stepSim`. The pothole pose and position never change.
5. **Pose:**
   - new expression `bams` (impact phase only);
   - `oy` for 0.7 s after a non-fatal pothole or car hit (when not asleep);
   - `grumble` on the loss result card.

   Add `bams: "bams"` to `PIXEL_POSE`. `pixelPoseFrame` picks `bams-0` / `bams-1` by `Math.floor(impactMs / 100) % 2`.

## 3. Session — `js/session.js` (new phase `impact`)
- In `sessionStep`, when `sim.done && !sim.success && (sim.failCause` is one of `pedestrian, dog, stopped, cutin, bin, roller, pothole)`:
  - set `session.phase = "impact"`, `session.impact = { kind, cause, ms: 0, hitX, hitColor }`;
  - kind: `pedestrian` → `ped`; `dog` → `dog`; everything else → `car`;
  - also set `session.result = grade(sim)`, `clearControls`, `snapRenderPose`.

  Any other ending (success, timeout, cargo spilled without a hit) goes straight to `result` as today.
- In the `impact` phase, `sessionStep(dt)` only advances `impact.ms += dt*1000`. The sim is **not** stepped. At `ms >= IMPACT_TOTAL_MS (1300)` → `phase = "result"`.
- Input in `impact`:
  - pedal and Anton taps are ignored, and so is `pauseSession` (it only acts in drive/countdown);
  - Enter, Space or a canvas tap after `ms >= 500` skips straight to `result`;
  - Esc does nothing;
  - KeyR is not active until `result`.
- `restartSession` works from `result` as today and clears `session.impact = null`.
- `tick()` in game.js: `settle()` still fires on the first `result` frame (the check `before !== "result"` already covers this). `audio.crash()` fires at the hit as today.
- Debug: add `impact: session?.impact ? { kind, cause, ms } : null` to `getState()`, and `debugImpact(kind)` for tests. It ends the current ride with a synthetic hit of that kind: set `sim.lastHit`, `fail(sim,"body")`, `failCause`.

## 4. Timeline — new pure module `js/impact.js` (unit-testable)
`impactFrame(kind, ms, opts)` returns a plain description that the renderer just draws:
`{ flash, shake:[dx,dy], pose, bubble, carSprite, npcSprite, fx:[{sheet, frame, dx, dy, flip}], react:{sheet, frame, dx, dy, flip}, fadeLevel, card }`.

Offsets are **native px relative to the student car's native top-left (cx, cy)**, the same point `drawPixelWorld` uses for `learner-*.png` (cy = CAR_CENTER_Y − 22 = 166). Mirror the x offsets (`dx' = 26 − dx − w`) when the reaction runs left: left when the car centre x < 0, otherwise right.

| ms | all kinds | car | ped | dog |
|---|---|---|---|---|
| 0–16.7 | flash: white 78 % over the world plate only (28,28,1000,844); world frozen as at the hit; pose unchanged | the parked/cut-in car drawn touching the bumper (as in the sim) | ped base sprite in front | dog base sprite in front |
| 16.7–33 | flash 43 % | | | |
| 33–900 | pose `bams` (100 ms alternate), bubble «ОЙ!» | carSprite `learner-crash`; npcSprite `npc-*-up-crash` for stopped/cutin (white = stopped, blue = cutin); `bams` (−96, −38) while ms < 566, frame (ms−33)/66 %2, x clamped ≥ 4 native in world; `stars` (−4, 0) from 66, frame (ms−66)/100 %3; `steam` (+4, −12) from 100, frame (ms−100)/150 %4 | carSprite `learner-brake`; `opa` (−56, −34) for 100–600; react: 33–100 frame 0 at (+8, −18) + `alarm` (+13, −25); 100–150 frame 1 (+8, −27); 150–200 frame 1 (+8, −25); 200–233 frame 1 (+8, −16); 233–333 frame 2 (+8, −9); 333–733 frames 3/4 alternating every 100 ms at (+8, −9) + `anger` (+20, −8) blinking; 733–900 step k = (ms−733)/42 → (+14,−16),(+20,−22),(+26,−22),(+30,−16) frame 1, then (+32,−12) frame 3 | carSprite `learner-brake`; react: 33–100 frame 0 at (+4, −14) + `alarm` (+15, −22); 100–400 frame 1 along (+8,−20),(+14,−25),(+20,−27),(+26,−25),(+30,−20),(+32,−15), 50 ms per point; 400–900 frames 2/0 alternating every 100 ms at (+32, −15) + `anger` (+45, −18) blinking; `gav` (+38, −44) for 400–850 |
| shake | | 33–200: [(4,−4),(−4,4),(4,0),(−4,0),(0,4)] screen px, 33 ms each | 33–100: (4,0) then (−4,0) | same as ped |
| 900–1300 | world fade: ordered Bayer 4×4 dither toward ink `#1C181C` on the **native** grid (one dither cell = one native px = 4×4 screen px), levels 2, 4, 6, 8 of 16, 100 ms each. Last frame of every effect is held. Cabin stays lit, pose `bams`, «ОЙ!» | | | |
| ≥ 1300 | phase `result` → pixel loss card (§6); world held at level 8; pose `grumble`, bubble «НУ ВОТ…» | | | |

- The hazard that was hit is **not** drawn from its sim pose during `impact` or on the card. For ped/dog the react sprite replaces it; for car kinds the crash sprite replaces it at its pose.
- `settings.reducedMotion` or `settings.shake === false` → no shake. `reducedMotion` → also no flash (a plain freeze for 33 ms) and the bursts do not alternate.
- The HUD (patience plate, pause) is drawn after the world and does **not** shake. The pause hotspot is not registered during `impact`.

## 5. Non-fatal hits (drive phase, no phase change)
- **Pothole (run continues):** during the first 66 ms after the hit (`sim.crashT > 0.24 − 0.066`):
  - the student car is drawn 1 native px higher (cy − 1);
  - the world blit shakes (4,0) then (−4,0), 33 ms each;
  - dust from `steam` frame (ms/100 | 0) (0 then 1) at (−7, −8) and (+20, −8) for the first 200 ms;
  - then «ОЙ!» → «ЯМА ЖЕ!» per §2.4; the pothole stays where it is.
- **Car/bin hit that does not end the run:** the same 2-step shake and «ОЙ!»; the sprite logic stays as today.
- **Soft bin/lid touch:** no shake, no «ОЙ!» (today's «ФУХ.»).

## 6. Pixel loss card (pixel mode only; classic keeps `drawResultScreen`)
Draw on the native grid, ×4:
- **Card:** 150×112 native at world-native (50,44), i.e. screen (228,204). 1 px ink border, cream `#FFF6E4`, beige bottom 2 px `#CCBE9E`, 2/3 px ink shadow at 35 %, corner pixels cut.
- **Title:** «НЕ ДОЕХАЛИ», Pixeloid 18 (2 px font grid), red `#E83428`, centred, top at y 8.
- **Icon:** at (12,30) inside the card: `learner-crash` for car kinds, ped react frame 3, or dog react frame 2. Native size.
- **Subtitle:** Pixeloid 9, ink, from x 46, y 36, line step 11. Text by `failCause`:
  - `stopped` → «Поцеловали / припаркованную / машину.» (approved)
  - `cutin` → «Не пропустили / выезжающую / машину.»
  - `pedestrian` → «Пешеход цел, / но очень зол. / Тормози раньше.»
  - `dog` → «Пёс цел, / но обиделся. / Тормози раньше.»
  - `bin` → «Бак устоял. / Машина — нет.»
  - `roller` → «Крышка люка / победила.»
  - `pothole` → «Яма оказалась / глубже.»
  - `cargo` → the existing `lossLine` text («Крем помялся» / «Рыбка разлилась»)
  - `timeout` → «Не успели.»
- **Buttons — keep the PR #36 ids and behaviour:**
  - big yellow **«ЕЩЁ РАЗ»** (hotspot id `retry`): native rect (14,78)–(133,100) inside the card, with the hand-placed 7×7 ↻ glyph at (+7, +8) of the button;
  - small cream chip **«В ГАРАЖ»** (hotspot id `to-garage`), centred 4 native px under the card;
  - keep the existing «момент» replay button (`momentButton`) where PR #36 has it.
  - Hit boxes: `retry` ≥ 48 CSS px tall at 844×390, same as the current test.
- Anton: `grumble` pose, bubble «НУ ВОТ…».
- **Success and infinite cards:** unchanged (old renderer).

## 7. Tests (must stay green: `npm test`, `npm run lint`, `npm run check`, `npx playwright test`)
**Unit (`test/sim.test.js`):**
1. `impactFrame` timeline:
   - flash only in [0,33);
   - shake only in [33,200) for car and [33,100) for ped/dog;
   - pose `bams-0`/`bams-1` alternate every 100 ms;
   - `bams` burst gone at ≥ 566;
   - fade levels 2/4/6/8 at 900/1000/1100/1200;
   - `card` true at ≥ 1300.
2. `sessionStep`: a run ended by a pedestrian, dog or parked car goes `drive → impact`. After 1.29 s total it is still `impact`; after 1.31 s it is `result` with `result` graded. `restartSession` from that result → `drive`, `impact === null`, `collisions === 0`.
3. Success and timeout endings go straight to `result` (no impact).
4. Pedestrian hit at ≥ 1.2 m/s ends the run on a cargo trip too; a dog hit at cruise ends the run.
5. Pothole hit with `attention = "asleep"`: no «ОЙ!» or «ЯМА ЖЕ!» bubble, pose stays asleep, `body > 0`, run continues, pothole `pose.x/pose.s` unchanged. Awake pothole hit: «ОЙ!» then «ЯМА ЖЕ!» about 0.7 s later.
6. Bin touched at 10 m/s: `body` unchanged, no impact, bin pose unchanged.
7. No static (bin, roller, pothole) or `stopped` hazard changes `pose` during `impact`.
8. Manifest lists every new PNG, and every listed PNG exists with the exact sizes from §1.

**E2E (`test/e2e.spec.js`):**
1. Lesson 1, no braking:
   - poll `getState()` every 30 ms; `phase` goes `drive → impact → result`;
   - `impact.kind === "ped"`; real time in `impact` is 1.2–1.8 s;
   - screenshots at ~60 ms (flash gone, «ОПА!» or bams pose present) and on the card.
2. On the card: `retry` hotspot with label «ЕЩЁ РАЗ» and `to-garage` with «В ГАРАЖ» are present. Clicking `retry` → `phase === "drive"`, `s < 5`, `collisions === 0`. A second crash plays `impact` again.
3. Hotkey R and tap-to-skip:
   - a tap during `impact` before 500 ms does nothing;
   - Space after 500 ms jumps to `result`;
   - R on the result restarts.
4. `debugImpact("car")` and `debugImpact("dog")` reach `result` with the matching subtitle labels.
5. `reducedMotion`: no world offset during impact (compare two frames 33 ms apart at the HUD-free world edge).

Existing tests that wait for `phase === "result"` after a collision should keep passing, because `result` arrives 1.3 s later. Raise any too-tight timeout instead of skipping the scene. Do not delete or weaken any test; if a dog-hit test assumed the dog was non-fatal, update it to the new rule and say so in the PR.

## 8. Done means
- One PR with: the assets copied plus manifest entries, `js/impact.js`, the session/sim/renderer changes and the tests.
- CI green.
- Screenshots in the PR at 1600×900: flash frame, БАМС frame, ped on hood, dog «ГАВ!», pothole bounce, loss card. Produce them with the debug API; don't hand-paint.
- Note in the PR that the classic path is untouched.
- **Do not merge.** Sergey reviews and approves.

---

## 9. Addendum (18.11): failCause values reserved for stage 3 (drift)
Stage 3 (`stage-interactions-brief.md`) adds Anton drifting off the road. Stage 2 does **not** implement drift. It only has to accept these causes so stage 3 plugs in without reworking the scene or the card:
- `sim.lastHit.type === "roadside"` (house, fence, lamp, bench, planter, hydrant, sidewalk bin), plus `lastHit.object = <sprite name>`.
- `failCause` values: `drift-sleep`, `drift-phone`, `drift-grope`, `flinch`. In `sessionStep` they go to `impact` with kind **`car`**:
  - the same flash, shake, `learner-crash`, `stars`, `steam` and «БАМС!» as a parked-car hit;
  - `npcSprite = null`: the roadside object stays exactly as drawn, because inanimate objects never change.
- Card icon `learner-crash`. Subtitles (text to be approved by Sergey in stage 3):
  - `drift-sleep` → «Антон уснул / за рулём.»
  - `drift-phone` → «Антон засмотрелся / в телефон.»
  - `drift-grope` → «Антон искал телефон / под ногами.»
  - `flinch` → «Антон дёрнулся. / Буди заранее.»
- Implementation in stage 2: list these four keys in the subtitle map and in the `impact` cause list. Unit test: a synthetic `failCause = "drift-phone"` reaches `impact` kind `car` and then the card with that subtitle. Nothing else.
