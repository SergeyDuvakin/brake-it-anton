# assets/pixel — pixel restyle package (v1)

Approved by Sergey Duvakin on 17.11.2026. Native-resolution pixel art. The game draws it at an integer ×4 scale with smoothing off.

- `manifest.json` lists every file, its frame rects, anchors, the scale and the target positions on the 1600×900 canvas.
- `INTEGRATION.md` is the brief for the code change. This package has **no code changes**.

| Folder | Contents | Scale |
|---|---|---|
| `cabin/` | `bg.png` is the static cabin background: window, city, У sign, mirror and seat. `poses/*.png` holds 6 full 125×150 frames of Anton. `anton-poses-sheet.png` is the same 6 frames as one sheet. `seat.png` is a reference copy of the seat layer. | ×4 |
| `pedal/` | The centred pedal: `pedal-idle.png` and `pedal-pressed.png`, plus the parts `pedal-bracket.png` and `pedal-pad.png`. | 1:1 (screen px) |
| `car/` | The learner car in three states: `normal`, `brake` and `hazard`. NPC cars in `blue` and `white`, each facing `up`, `down`, `left` and `right`. All 26×44 native. | ×4 |
| `world/` | `road-straight-strip.png` is a 250×128 vertical loop. Overlays: the zebra, the stop line and the solid centre line. `sprites/` holds buildings, the tree, traffic lights, the zebra sign, street furniture, pedestrians and dogs. `shadows/` holds a shadow mask for each sprite. `junction-ground-250x211.png` is for Wave 2. `reference-scene-250x211.png` is the approved scene. | ×4 |
| `ui/` | `gauge-face.png` is the face without the needle. Also `pause-button.png`, the bubble 9-slice and tail, the world plate frame and corner mask, and the right-column plates (1:1). | ×4 / 1:1 |
| `fonts/` | Pixeloid Sans Bold with its OFL 1.1 license. | 9 px native |

## Sources and licences

- All drawings are original, hand-placed pixel art made for this game. They are built with PIL masks and stamps, with no AI generation and no third-party sprites. The source scripts live outside the repo (box: `/workspace/bia-pixel/tools4`, `tools5`, `tools6`).
- Font: **Pixeloid Sans**, Copyright © 2020-2025 GGBotNet (https://ggbot.net/fonts/), Reserved Font Name "Pixeloid", SIL Open Font License 1.1. See `fonts/OFL-LICENSE.txt`.
  - The official archive is at https://ggbot.itch.io/pixeloid-font. It only downloads through an interactive button, so the file was taken from a public mirror of the same release.
  - Before the font ships, re-download it from itch and compare the files.
