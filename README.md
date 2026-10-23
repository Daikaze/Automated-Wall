# Smart Wall Architect 0.1.0

**A first playable prototype for Foundry VTT v11 and v14** for raster battle maps from Inkarnate or any other source. English UI. GM only.

> This is a **semi-automatic, rule-based image detector**. It is not an AI vision model. It will produce imperfect / false-positive wall lines on artistic battle maps. It **does not automatically claim to distinguish doors and windows**. Possible gaps are REVIEW proposals and are not applied until the GM marks them as Door, Window, or Wall.

## Features implemented

- Button in the **Walls** scene controls (compatible adapters for v11 array and v14 record formats).
- Read scene background, or choose a local PNG / JPG / WebP with a file picker.
- Local edge / color-matching line analysis, oriented horizontally, vertically or at ±45°.
- Automatic proposals of gaps between collinear walls; never applied without human review.
- Color-coded preview (yellow walls, purple doors, cyan windows, pink review proposals).
- Select individual lines, change types, delete lines; drag to draw new lines of each type.
- Adjustable detection sensitivity, minimum segment length and optional wall-color sample (click one wall pixel in the preview).
- Scrollable zoom and resizable / draggable preview window.
- Safely create Foundry-native Wall documents after confirmation; existing walls are never automatically erased.
- Default duplicates filter; export a JSON backup of current walls; undo the last module batch using stored ids.
- Entirely local scan; no servers, no image uploads, no API keys.

## Install

1. Unzip `smart-wall-architect-v0.2.0.zip`.
2. Copy the `smart-wall-architect` folder to your Foundry user data `Data/modules/` directory.
3. Restart Foundry if necessary, enable **Smart Wall Architect** under Game Settings → Manage Modules.
4. Open a scene that uses a PNG/JPG/WebP battle map, then select the **Walls** tool and click the Smart Wall Architect icon (drafting compass icon).
5. Click **Analyze Image**. Check each proposed line; convert candidate openings with the **Selected segment** dropdown, or draw your own door/window by dragging.
6. Click **Download existing walls backup** if desired, and **Apply Reviewed Walls**.
7. **Undo Last Module Batch** removes only the latest batch recorded by this module for this scene.

If scene-control integration conflicts with another module, GM users may open the browser console (F12) and run:

```js
game.modules.get('smart-wall-architect').api.open()
```

## Important limitations

- Image-only recognition cannot reliably infer which colored marks are walls, doors, windows, furniture, shadows, or map-grid lines. Preview and review are essential. Complex Inkarnate styles may need sampling or manual adjustment.
- Auto scanner currently primarily handles long straight segments at 0°, 45°, 90°, and 135°. Curved walls and irregular diagonals can be added manually.
- Backgrounds with offsets should be checked carefully after apply. Position mapping uses Foundry SceneDimensions sceneX/sceneY, sceneWidth/sceneHeight, and background offsets.
- The **local image** option is for scanning an image aligned to the Scene background. If its crop/aspect/placement differs from the Scene image, coordinates will not match.
- It scans the Scene background; it does not merge separate overhead tiles into the raster.
- Requires an ordinary raster background, not a video. Remote image hosts that block cross-origin pixel access require a local image copy.
- Undo only remembers one batch per Scene and will remove those ids even if the GM subsequently manually edits them. Download a backup first if needed.
- Code/API integration was statically checked and image-analysis unit-tested; an actual Foundry V11/V14 runtime was **not available** in this environment for end-to-end UI testing.

## Technical layout

- `scripts/main.mjs` - runtime integration, editor, image loading, Foundry Wall creation
- `scripts/detection.mjs` - isolated raster scan + openings proposal engine
- `styles/main.css` - interface styling
- `tests/detection.test.mjs` - synthetic raster tests (run with Node v22, `node --test tests/`)

## Roadmap

- v0.2: stronger region segmentation and per-map recognition templates, diagonal/curved tracing
- v0.3: robust door-arc and window-pattern classifiers, review confidence and learning from corrections
- v0.4: in-canvas editing mode and optional ML classification (without requiring a paid cloud API)

MIT licensed. This module is not affiliated with Foundry Gaming LLC.

## v0.2.0 — Inkarnate castle feedback

- New stone/wood/any-material mask and orientation-aware gradients reduce decorative false positives.
- 45° detection OFF by default; enable only if needed.
- Drag-select a building/room scan area to skip gardens, roads and unrelated decorations; **Full map** resets the selection.
- Scan preserves hand-added walls and manually reviewed segments.
- Multiple wall-colour samples supported. Do not sample grass: a green sample will be flagged as potentially foliage.
- **Connected Wall Chain**: click corners to add seamlessly connected walls. Use right-click, Escape or Finish chain to stop.
- All predictions remain drafts. Door/window labels still require a GM review.

Known limitation: organic/curved masonry and arbitrary diagonals are not fully recovered by this local heuristic detector.