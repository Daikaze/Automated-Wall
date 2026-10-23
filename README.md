# Smart Wall Architect v0.1.0

Image-based wall drafting for **Foundry VTT v11 and v14**. Built for Inkarnate and other PNG/JPEG/WebP maps. **GM-only**, English UI.

**Prototype notice:** This is a heuristic edge/color line detector, not a trained AI model. It suggests candidate walls and possible gaps; its predictions can be wrong on textured maps, curved walls, furniture and shadows. Door and window candidates must be manually reviewed. Do NOT apply blindly.

## Features
- One module with V11 and V14 scene-control adapters.
- Open from the **Walls** controls; console fallback: \`game.modules.get("smart-wall-architect").api.open()\`.
- Scan Scene background or local PNG/JPG/WebP image, using horizontal, vertical and 45° raster line detection.
- Sensitivity, minimum segment length, and optional wall-color sampling.
- Pink proposed openings are never applied until a GM changes them to Door/Window/Wall.
- Canvas review: select, change type, manually draw or erase.
- Native Foundry Wall, Door and Window documents with standard movement, vision, light and sound settings.
- Preserve existing walls, skip near-exact duplicates, JSON backup export, Undo latest module batch.

## Install from Foundry
Module manifest URL:

\`https://raw.githubusercontent.com/Daikaze/Automated-Wall/main/module.json\`

The \`download\` URL points to a GitHub Release asset named \`smart-wall-architect.zip\`. A GitHub Actions workflow packages and publishes it after pushes to \`main\` when repository Actions have permission to write releases. If no release appears, use the ZIP from the project's GitHub releases once published or manually install source files under \`Data/modules/smart-wall-architect\`.

## Usage
1. Open a Scene with a PNG/JPG/WebP map.
2. Select the **Walls** controls and open **Smart Wall Architect**.
3. Click **Analyze Image**. Inspect the color-coded lines.
4. Fix mistakes, draw Doors/Windows, and convert any pink proposed openings you accept.
5. Optionally **Download wall backup**, then **Apply Reviewed Walls**.
6. Use **Undo Last Module Batch** to remove the last batch made by the module.

### Known limitations
- No reliable fully automatic door/window recognition from artwork yet.
- Long straight walls work better than irregular/curved ones.
- Walls are based on raster pixels; verify offsets and alignment before applying.
- Remote image sources may block readback of image pixels due to CORS. Use the Local image picker.
- The current undo is one batch per Scene, not full version history.
- Runtime testing inside Foundry v11 and v14 is still required.

## Development
\`node --test tests/detection.test.mjs\` tests the detection engine. The repository workflow validates scripts and creates versioned release ZIP files.

MIT licensed. Not affiliated with Foundry Gaming LLC.
