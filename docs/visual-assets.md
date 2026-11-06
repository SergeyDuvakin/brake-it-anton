# Visual Assets Manifest — «Инструктор»

Canvas reference: 1600×900. Стиль: `/workspace/instructor-wacky/` (оригинальный Pillow-генератор `draw.py`, не финальный pipeline спрайтов).

Легенда статуса:
- **MVP** — нужно до playable prototype
- **Later** — после утверждения прототипа
- **Authored** — рисуем сами в утверждённом стиле
- **Procedural** — runtime (wobble seed, skid, shake)
- **Candidate** — внешний pack, лицензия проверена, но **в билд не кладём**, пока не скачаем zip + `License.txt` в репо

---

## 0. Источник правды по концепту

Приоритет статусов в данном манифесте выше старых заголовков внутри таблиц: дополнительные ученики/машины/районы и декоративные obstacles — только следующая стадия.

| Файл | Назначение | Лицензия |
|---|---|---|
| `/workspace/instructor-wacky/screen-concept.png` | утверждённый gameplay look | оригинал проекта |
| `/workspace/instructor-wacky/assets-sheet.png` | референс Антон/машина/педаль/пешеходы/собака | оригинал |
| `/workspace/instructor-wacky/draw.py` | генератор форм (не engine atlas) | оригинал |
| `/workspace/instructor-wacky/asset-licenses.md` | фиксация: сторонние ассеты в арт-тесте **не** использовались | — |

Шрифты концепта: Balsamiq Sans, Rubik Mono One — **SIL OFL 1.1** (Google Fonts). Перед релизом положить OFL в `licenses/fonts/`.

---

## 1. Внешние библиотеки — вердикт

| Pack | URL | License evidence | Вердикт для «Инструктора» |
|---|---|---|---|
| **Kenney UI Pack** | https://kenney.nl/assets/ui-pack · https://kenney-assets.itch.io/ui-pack | CC0 1.0 (страница itch + License.txt зеркала, creation 12-06-2024) | **Candidate**: только как референс пропорций кнопок/слайдеров. Финальные кнопки **перерисовать** wobble-ink, иначе стиль ломается. Опционально: 6 UI SFX из пака. |
| **Kenney «Interface Pack»** | https://kenney.nl/assets/interface-pack | **404 (проверено WebFetch 2026-11-06)** | **Не существует под этим именем.** Есть tag `interface` и отдельные паки (UI Pack, Mobile Controls, …). Не ссылаться как на источник. |
| **Kenney Input Prompts** | https://kenney.nl/assets/input-prompts | CC0 1.0 (License.txt в дистрибутиве 1.4; статья Kenney KB 2026-03-18) | **Candidate later**: иконки touch/keyboard в Settings / how-to. Не в gameplay HUD MVP. |
| **Kenney Emotes Pack** | https://kenney.nl/assets/emotes-pack · OGA mirror CC0 | CC0 | **Candidate limited**: только generic `!` / speech-balloon формы как черновик телеграфа. Финальный `!` — свой (жёлтый круг + INK). Не использовать пиксельные эмоуты. |
| **Kenney Impact Sounds** | https://kenney.nl/assets/impact-sounds | CC0 (Kenney support: все asset pages public domain CC0) | **Candidate MVP audio**: удары, thrud, лёгкие crash. |
| **Kenney Interface Sounds** | https://kenney.nl/assets/interface-sounds | CC0 (общая политика Kenney) | **Candidate**: клики меню, pause. |
| **Kenney Car Kit / Pixel Vehicle** | см. instructor-wacky/asset-licenses.md | CC0 | **Отклонено** — lowpoly/pixel, ломает стиль. |
| **Freesound** | https://freesound.org | **per-file** (CC0 / BY / BY-NC) | **Candidate only if filter=CC0**; каждый файл логировать. BY-NC запрещён для коммерции. |
| Hand-drawn 2D packs (generic itch) | — | разные | Не брать персонажей/машины «похожих». Только abstract UI, если CC0 и после redraw. |

**Правило:** персонажи, машины, районы, mission props, hazards с характером — **всегда Authored**. Чужие выразительные персонажи/торговые марки — запрет.

---

## 2. Naming convention

```
<category>_<subject>_<state>_<angle?>.png
```
Примеры: `student_anton_angry.png`, `car_hatch_yellow_025.png`, `ui_pedal_press.png`, `fx_skid_01.png`

Atlas later: `atlas_gameplay_mvp.png` + JSON — не обязателен для первого прототипа (отдельные PNG ок).

Pivot: указывать в манифесте движка как нормализованный (0–1) или px от top-left; ниже — **px от top-left исходника**.

---

## 3. MVP sprite list

### 3.1 Student — Anton (shell default) · Authored · MVP
Базовый размер листа: **512×640** transparent PNG (голова+торс+руль в кадре). Pivot: `(256, 520)` (низ руля / пояс).

| Asset | Frames | FPS / timing | Notes |
|---|---|---|---|
| `student_anton_calm_a/b.png` | 2 boil | swap 110 ms | mismatched eyes, рот-линия |
| `student_anton_focused_a/b.png` | 2 | 110 ms | взгляд вперёд-вниз |
| `student_anton_annoyed_a/b.png` | 2 | 110 ms | |
| `student_anton_angry_a/b.png` | 2 | 110 ms | оскал + 3 штриха |
| `student_anton_furious_a/b.png` | 2 | 100 ms | + steam procedural optional |
| `student_anton_belted_a/b.png` | 2 | 110 ms | вжат в ремень, 400 ms hold |
| `student_anton_proud.png` | 1 (+opt boil) | — | results |
| `student_anton_ashamed.png` | 1 | — | results |

Руль можно отдельным слоем `prop_wheel.png` **256×160**, pivot center, лёгкий rotate ±8° при манёвре — Later optional; в MVP руль впечён в спрайт стейта.

### 3.2 Students — остальные трое · Authored · Later
Те же стейты `calm/focused/annoyed/angry/belted` (furious можно шарить с angry+tint). Размер как у Антона.

| ID | MVP frames min | Unique prop |
|---|---|---|
| `student_gennady_*` | calm, annoyed, angry, belted ×2 boil | кепка, усы |
| `student_asya_*` | calm, focused, angry, belted ×2 | телефон |
| `student_profi_*` | calm, annoyed, angry, belted ×2 | очки |

### 3.3 Cars · Authored · hatch MVP / остальные Later
Размер кадра: **256×320**. Pivot: `(128, 200)` (центр кузова ближе к низу для top-down).

| Asset | Angles | Boil | Brake feel tag |
|---|---|---|---|
| `car_hatch_yellow_{000,012,025,m012,m025}_a/b.png` | 5 | 2 | snappy |
| `car_sedan_teal_{...}_a/b.png` | 5 | 2 | delayed |
| `car_van_pink_{...}_a/b.png` | 5 | 2 | heavy dive |

Крыша «У»: красный прямоугольник — часть спрайта хэтча. Skid marks — `fx_skid_streak.png` 64×256, tiled procedural.

### 3.4 Districts · Authored · yard MVP / остальные Later
Не 15 уровней арта: **3 набора тайлов/домов**, миссии переставляют hazards.

| Pack | Pieces | Size guide |
|---|---|---|
| `district_yard_*` | 4 house L, 4 house R, 2 bush, sidewalk strip, road strip | house ~200×180 |
| `district_center_*` | 4+4 taller houses, 2 signs scribble, 1 bench | |
| `district_edge_*` | 3 warehouses, cones crate, fence | |

Road mesh/strip может быть **Procedural** poly + overlay dashed line procedural.

### 3.5 Mission props · Authored · торт+аквариум MVP / остальные Later
| Asset | Size | Pivot | Use |
|---|---|---|---|
| `prop_cake.png` | 128×128 | center | крыша/багаж + results icon |
| `prop_aquarium.png` | 128×128 | center | рыбка силуэт |
| `prop_motherinlaw.png` | 160×200 | feet | пассажир-карикатура |
| `prop_eggs_crate.png` | 128×96 | center | optional 4th delivery |
| `prop_fishbowl_leak_fx` | 2 frames | — | Later fail state |

(В брифе акцент на торт/аквариум/теща — первые три обязательны; eggs — spare.)

### 3.6 Obstacles / actors · Authored · базовые четыре MVP / остальные Later
Размер пешехода ~**96×160**, dog **110×70**.

| Asset | Frames | Notes |
|---|---|---|
| `ped_oneeye_pink_walk_a/b.png` | 2 | одна странность: 1 глаз |
| `ped_oneeye_blue_idle.png` | 1–2 | |
| `ped_granny_slow_a/b.png` | 2 | Later ok to stub with recolor |
| `cyclist_side_a/b.png` | 2 | top-down-ish |
| `dog_rect_brown_a/b.png` | 2 | утверждённый прямоугольник |
| `obst_trashbin.png` | 1 | |
| `obst_cone.png` | 1 | |
| `obst_kiosk.png` | 1 | для Геннадия |
| `npc_car_blocky_{color}_{angle}.png` | 3 angles × 2 colors | простые, без «У» |

Hazard telegraph: `ui_marker_bang.png` 64×64 (жёлтый круг + `!`).

### 3.7 Brake pedal & cabin chrome · Authored · MVP
| Asset | Size | States |
|---|---|---|
| `ui_pedal_idle.png` | 280×140 | |
| `ui_pedal_press.png` | 280×140 | squash + lines |
| `ui_patience_track.png` | 330×46 | 3 segments baked or separate |
| `ui_patience_needle.png` | 32×80 | pivot bottom center |
| `ui_mood_circle.png` / `_square` / `_triangle` | 48×48 | colorblind glyphs |
| `ui_lesson_chip.png` | 230×64 | 9-slice optional |
| `ui_objective_card.png` | 420×52 | |
| `ui_pause_icon.png` | 56×56 | |
| `ui_panel_paper_9slice.png` | 64×64 corners | menus |

Текст «ТОРМОЗ» — **впечён** в педаль или runtime Rubik Mono One (предпочтительно runtime для локализации later).

### 3.8 Shell screens art · Authored · MVP
| Screen | Assets |
|---|---|
| Garage/Map | `bg_garage.png` 1600×900, `map_tile_yard/center/edge.png`, `card_student_frame.png`, `card_car_frame.png`, `btn_primary.png`, `btn_secondary.png` |
| Pause | reuse paper panel + dim; buttons |
| Results | `results_meter_frame.png` ×3, `stamp_pass.png`, `stamp_fail.png`, `btn_retry.png`, `btn_next.png` |
| Settings | Later; Input Prompts candidates |

### 3.9 FX · Mixed
| Asset | Type | Notes |
|---|---|---|
| `fx_dust_puff_01..03.png` | Authored 64×64 | |
| `fx_anger_steam_a/b.png` | Authored | |
| `fx_skid_streak.png` | Authored | |
| Screen shake / nose dip | **Procedural** | |
| Confetti perfect | Authored 32×32 ×4 colors | Later |

---

## 4. Audio assets (visual-adjacent, for complete design handoff)

| ID | Source plan | Status |
|---|---|---|
| `sfx_brake_short.wav` | Authored or Kenney Impact **candidate** | MVP |
| `sfx_brake_hold_loop.wav` | Authored | MVP |
| `sfx_crash_cartoon.wav` | Kenney Impact candidate / Authored | MVP |
| `sfx_ui_click.wav` | Kenney Interface Sounds candidate | MVP |
| `sfx_patience_warn.wav` | Authored | MVP |
| `mus_radio_anton_loop.ogg` | Authored simple loop | MVP |
| `mus_radio_gennady/asya/profi` | Authored | Later |
| VO one-liners | Authored or silent text-only MVP | Text-first MVP ok |

Любой Kenney/Freesound файл: пока не скачан с `License.txt` в репо → статус **candidate not yet licensed in project tree / not used**.

---

## 5. Animation sheet summary (MVP fps)

| Subject | Frame count | Effective FPS |
|---|---|---|
| Boil A/B characters & car | 2 | ~9 fps swap (110 ms) |
| Ped walk | 2 | 6–8 fps |
| Pedal press | 2 states (not loop) | event |
| Crash squash | 3 key poses | 12 fps once |
| Telegraph bang pulse | scale pulse procedural | 1.5 Hz |

---

## 6. MVP vs Later (явный scope)

### Изначальный проверочный прототип
- **Только Антон** с полным набором стейтов calm / focused / annoyed / angry / belted / crash / результат.
- **Одна машина** `car_hatch_yellow`, пять углов × два boil кадра.
- **Один район** `district_yard`.
- Груз: торт и аквариум, с реакциями на торможение.
- Четыре типа опасности: пешеход, собака, бак, выезжающая NPC-машина.
- HUD: педаль, терпение+глифы, урок/цель, пауза, результат; минимальный garage shell.
- Аудио: педаль, тормоз, авария, UI, один radio loop; текстовые реплики вместо записанного голоса допустимы.

### После проверки механики
- Геннадий, Ася, «профи»; остальные две машины; центральный и загородный районы.
- Тёща, поездка на экзамен и новые hazards (велосипедист, конус, ларёк и т.п.).
- Полные стейты всех учеников, уникальная музыка, больше повреждений/эмоций.
- Settings art и Input Prompts, повторы/свидетельства, atlas packing.
- Новые фигуры рисуются, не реализуются случайным recolor чужих героев.

---

## 7. Production path recommendation

1. Перерисовать утверждённые формы из `draw.py` **вручную** (Krita/Procreate) → boiling A/B.
2. Экспорт PNG @2× (3200 по ширине листа) → downscale в движке для soft edges optional; или 1× чёткий ink.
3. Не тащить Kenney UI PNG as-is в HUD.
4. Звук: скачать Kenney Impact + Interface, положить License.txt, выбрать 5–8 клипов, остальное выкинуть.
