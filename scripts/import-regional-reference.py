"""Import supplied workbooks as reference evidence, never as live telemetry.

Usage: python scripts/import-regional-reference.py --source-dir <folder>
Requires openpyxl. Input workbooks are never modified.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path

import openpyxl


def numeric(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value if math.isfinite(value) else None
    return None


def extract(folder):
    sources, records = [], []
    for source_id, name, groups in [
        ("savay-register", "Савай даханалар (2).xlsx", [(6, 65, "savay"), (68, 70, "oqbura")]),
        ("savay-supplement", "Савай даханалар.xlsx", [(6, 6, "savay")]),
    ]:
        path = folder / name
        book = openpyxl.load_workbook(path, data_only=True)
        formulas = openpyxl.load_workbook(path, data_only=False)
        sheet, original = book["Sheet1"], formulas["Sheet1"]
        sources.append({"id": source_id, "fileName": name,
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "sheet": "Sheet1", "excludedPlaceholderRows": 16 if source_id == "savay-supplement" else 0})
        for start, end, canal in groups:
            for row in range(start, end + 1):
                raw = {key: sheet.cell(row, col).value for col, key in enumerate(
                    ["sequence", "name", "capacity", "area", "smartWater", "annualVolume", "limit", "actual", "ratio"], 1)}
                issues = ["undated_snapshot", "location_missing"]
                if raw["annualVolume"] is not None:
                    issues.append("annual_volume_scale_unconfirmed")
                name_value = str(raw["name"]).strip() if raw["name"] is not None else None
                if name_value is None:
                    issues.append("name_missing")
                capacity = numeric(raw["capacity"])
                if raw["capacity"] == "30 м3/сек":
                    capacity = 30
                if raw["capacity"] is not None and capacity is None:
                    issues.append("capacity_ambiguous")
                area = numeric(raw["area"])
                if raw["area"] is not None and (area is None or (source_id == "savay-register" and row in (6, 59))):
                    area = None
                    issues.append("area_ambiguous")
                if raw["annualVolume"] is not None and numeric(raw["annualVolume"]) is None:
                    issues.append("annual_volume_ambiguous")
                limit, actual = numeric(raw["limit"]), numeric(raw["actual"])
                ratio = actual / limit * 100 if actual is not None and limit is not None and limit > 0 else None
                if actual is None:
                    issues.append("actual_missing")
                if limit is None:
                    issues.append("limit_missing")
                if ratio is None and raw["ratio"] is not None:
                    issues.append("ratio_without_inputs")
                if capacity is not None and actual is not None and actual > capacity:
                    issues.append("actual_above_stated_capacity")
                records.append({
                    "id": f"{source_id}-{canal}-{row}", "sourceId": source_id,
                    "sheet": "Sheet1", "row": row, "canal": canal, "name": name_value,
                    "raw": raw,
                    "formulas": {original.cell(row, col).coordinate: original.cell(row, col).value
                                 for col in range(1, 10) if original.cell(row, col).data_type == "f"},
                    "capacityM3s": capacity, "areaHa": area,
                    "annualVolumeM3": None,
                    "limitM3s": limit, "actualM3s": actual, "derivedRatioPercent": ratio,
                    "smartWater": {"бор": "present", "йук": "absent", "йуколган": "missing"}.get(raw["smartWater"], "unknown"),
                    "issues": issues, "coordinates": None, "observedAt": None,
                })
        book.close()
        formulas.close()
    return {"schemaVersion": 1, "classification": "user_supplied_reference",
            "importedOn": "2026-09-13", "sources": sources, "records": records}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "apps/web/src/regional-reference-snapshot.json")
    args = parser.parse_args()
    data = extract(args.source_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {len(data['records'])} reference records from {len(data['sources'])} workbooks")
