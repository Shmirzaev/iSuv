# Savay and Oqbura supplied sources

Reviewed: 2026-09-13. Imported as user-supplied reference information, not synthetic measurements or certified live data.

## Workbook reconciliation

| Source | Range | Handling |
|---|---|---|
| Савай даханалар (2).xlsx | Sheet1!A6:I65 | 60 Savay rows, including unnamed row 46 with an equipment entry |
| Савай даханалар (2).xlsx | Sheet1!A68:I70 | 3 Oqbura-say records, preserving the separate canal group |
| Савай даханалар.xlsx | Sheet1!A6:I6 | Бирлашган, retained as a separate supplementary source record |
| Савай даханалар.xlsx | Sheet1!A7:I22 | 16 numbered placeholders without substantive data, excluded |

Total: 64 reference records, 63 named. A numeric sequence is unique only within its source/group; it is not a station UUID or map key. Neither file is assumed to supersede the other.

Column C: stated capacity in m³/s. D: served area in hectares. E: Aqlli suv inventory statement. F: annual average volume (header m³, scale not established). G/H: sheet limit/actual discharge in m³/s. I: percent of limit, not percent deviation. No stage measurements, observation dates, GPS coordinates, device identifiers, calibration or approval records are supplied.

## Data issues retained

- Main C6 explicitly says `30 м3/сек`, normalized as 30 m³/s, preserving the source cell.
- Main D6 (`13.261`) and D59 (`1.573`) may use ambiguous separators; normalized area is null pending confirmation.
- Main F23 (`58,449,6`), C35 (`0,80/0,25`) and D48 (`1,32,2`) are retained verbatim, not guessed.
- All annual-volume entries remain raw with unconfirmed scale and are excluded from sums/calculations. Large scale differences between the upper and lower register cannot be silently repaired.
- Main H35 and H60:H65 are blank while I35 and I60:I65 have cached zeroes. Derived percentages stay null. The explicit H6 zero remains zero.
- `бор`, `йук`, `йуколган` mean present, absent and reported missing equipment. They do not prove current online/offline state.
- Several actual readings exceed stated capacities. These discrepancies are source-review flags, not automated alarms.
- Limits have no effective dates or approvals. Derived actual/limit percentages are descriptive only; no compliance, approved allocation or incident is inferred.

## Map review

Five optimized map images are available: Savay project area, Andijan irrigation systems, Andijan reference PDF, Naryn-Karadarya network scheme and the Fergana Valley irrigation map. The original valley image is 30,000 × 25,646 pixels; the application uses a browser-size WebP copy. Source hashes and image dimensions are in `docs/reference/regional-map-manifest.json`.

The source PDF contains one landscape page with Andijan district names and canal/pump/reservoir labels. Its raster preview was visually inspected. The network scheme shows directed connections as drawn, but no machine-readable topology is inferred from it. Existing map numbers are left in the source illustration and are not linked to spreadsheet sequence numbers.

`Савай.CDR` is a RIFF CDRD CorelDRAW drawing, not a ZIP container. A local compatible vector decoder is unavailable. Its hash and format are recorded; it is not claimed as decoded, imported GIS or verified detailed topology. A PDF or SVG export is needed for that review.

## Reproduction

Use Python with openpyxl for workbook extraction, and Pillow plus Poppler `pdftoppm` for preview preparation:

```text
python scripts/import-regional-reference.py --source-dir <source-folder>
python scripts/prepare-regional-maps.py --source-dir <source-folder> --clipboard-dir <attachment-folder>
pnpm exec prettier --write apps/web/src/regional-reference-snapshot.json
pnpm verify
```

Original files are read-only inputs. Generated application data retains original cells, formulas, workbook hashes and sheet row references. No original files or operational database records are overwritten. The source folder is not copied wholesale.

## Needed for a geographic operational import

Provide a station crosswalk to spreadsheet rows, surveyed coordinates with CRS, directed network connections, measurement dates, device identities and approval references. Confirm annual-volume units/scale, ambiguous capacity and area entries, and whether the supplementary Бирлашган row belongs in the main register. Until then, the default maps and register provide reference context while synthetic operational workflows remain separate.
