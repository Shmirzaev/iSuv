# Regional atlas artwork and source review

Generated 2026-09-13 using the built-in image-generation tool. Its interface does not expose a model selector, so this work does not claim use of the requested exact model name “GPT Image 2.5”. No CLI/API key or external paid hosting was used.

Selected output: `apps/web/public/regional-maps/atlas-terrain.png`. Original generated output remains under the local Codex generated-images directory. The image was visually inspected: it has no labels, borders or waterways; its soft field/terrain pattern is decorative only. Code draws the interactive features, with an approximate-reference notice.

## Source interpretation

- The valley image provides wider Fergana context. It is not a separate collection of unrelated operational sites.
- The Andijan irrigation map shows five irrigation-system areas: Andijonsoy, Shahrixonsoy, Savay–Oqbura, Qoradaryo–Maylisoy and Ulug‘nor–Mazgilsoy. These are the overview's selectable areas, not asserted administrative districts.
- The Savay project-area image supplies a closer view with Qo‘rg‘ontepa, Jalalquduq and Xo‘jaobod areas, Savay/Oqbura, Shahrixonsoy, Janubiy Farg‘ona canal and local canals. Paths simplify the source artwork and do not assert exact borders. Surrounding areas without a traced detail view are not invented.
- The PDF and basin network diagram remain source references. This change does not convert their drawing layout into a calibrated hydraulic graph or assert flow directions from line geometry.
- Savay/Oqbura register links are by their explicit named spreadsheet sections, not by guessed numbered-point matches. No new intake or pump pins are added.

## Final prompt

Use case: stylized-concept.
Asset type: background artwork for an interactive irrigation atlas of Andijan, Uzbekistan.
Input images: image 1 and image 2 are reference maps for the region's landscape character ONLY, not edit targets.
Primary request: generate a beautiful, restrained top-down cartographic terrain background for a regional water map, landscape 3:2 composition. Irrigated valley plain through the center, very faint patchwork fields, soft pale sage and warm ivory colors, subtle hill relief along the far northeast and southeast margins. Professional calm atlas design, legible under vector labels and colored area overlays.
Critical constraints: NO text, NO labels, NO legends, NO markers, NO borders, NO regional boundary lines, NO roads, NO rivers, NO canals, NO lakes, NO diagram or UI elements. The application will draw all geographic features in a separate code layer derived from the supplied maps. This is decorative terrain illustration only, not a claim of accurate elevation or satellite imagery. Keep the entire center low-contrast and uncluttered. No perspective, no 3D tilt, no frame, no watermark.
