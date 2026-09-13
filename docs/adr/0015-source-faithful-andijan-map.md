# ADR-0015: Preserve the detailed Andijan PDF as the default map

Date: 2026-09-14. Status: Accepted. Supersedes ADR-0014's default presentation, not its reference-data boundaries.

## Context and correction

The user explicitly asked why the Andijan detail from `Харита.pdf` was missing. P8-002/P8-003 based the default atlas on the separate five-zone Andijan irrigation screenshot, not on the detailed PDF. Those inputs depict related geography but are not interchangeable and have different coordinate spaces. Adding labels to the approximate redraw did not preserve the PDF's dense canal network.

Visual and text inspection of the actual single-page PDF confirms 3,841 drawing objects, detailed waterways, district boundaries, station symbols and original labels. The PDF's page is 841.92 by 595.32 points. These are drawing coordinates, not a geographic CRS.

## Decision

Use a source-faithful SVG conversion of the complete PDF as the default `#map` canvas. Preserve paths, glyph outlines and embedded source images. Do not generate or redraw replacement geography. The UI's pan, wheel/pinch/click zoom, fullscreen, keyboard controls and source-label hit targets sit above the original artwork. A fingerprinted index extracts 14 district, 18 named pump, three reservoir and six hydro-junction label bounds for navigation. These are label positions, not surveyed feature locations or official boundaries. Unindexed labels and symbols remain visible in the complete drawing.

Expose the original Andijan irrigation image and Savay detail directly in the view selector. Keep their image-coordinate navigation separate from PDF page coordinates. Approximate legacy irrigation polygons and Savay river traces are transparent hit targets only, not replacement visible geography. Keep the valley and basin-network references available in the source gallery. The illustrated renderer and generated background remain historical, unused by the default workspace.

Retain all 64 source-linked Excel records unchanged. Only the two explicit named Savay/Oqbura canal sections link to their existing 61/3 records. PDF pumps, numbered source marks and reservoir capacity labels do not become telemetry, devices, observed accumulated volumes, allocation plans or verified accounting topology. Historical source names stay intact.

## Preparation and integrity

`scripts/prepare-andijan-vector.py` uses PyMuPDF 1.28.2 as an optional, one-time local conversion tool, not an application/runtime dependency. It verifies the reviewed source SHA-256, checks page count and district-label extraction, and rejects active SVG content/external resources. Source/asset fingerprints, conversion version, dimensions and label bounds are committed in `andijan-source-index.json`. SVG bytes are preserved across platforms by `.gitattributes` and a unit-test checksum. The browser embeds the result as an SVG image, not unsanitized inline document markup.

Regeneration from the reviewed original:

```text
python scripts/prepare-andijan-vector.py "PATH_TO/Харита.pdf"
pnpm exec prettier --write apps/web/src/andijan-source-index.json
```

The conversion tool must be installed separately in a local preparation environment. Normal installs, tests, builds and deployments consume committed assets and require neither Python nor the original PDF.

## Alternatives and consequences

A more detailed manual/AI redraw can omit or invent source geography. A fixed-size raster loses legibility at close zoom. A surveyed geographic map would need B-002 inputs. The SVG retains the existing source detail at 1,686,376 bytes, loaded separately from application JavaScript. Some original labels are embedded bitmaps, so those retain their original resolution. No modern basemap, GPS alignment, live readings, control capability or public deployment is implied.

Primary-agent self-review and browser/unit verification replace agent delegation for this slice, following the user's explicit no-subagent instruction.
