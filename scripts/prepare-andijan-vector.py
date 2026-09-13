"""Export the supplied Andijan PDF without redrawing its geography.

One-time source preparation: Python + PyMuPDF 1.28.2 (not a web dependency).
Usage: python scripts/prepare-andijan-vector.py PATH_TO_Харита.pdf
"""

import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import pymupdf

EXPECTED_SHA256 = "acc3d11a437275ac098a7f9fb459eae385ae43d7fb48e3b7f40ac316d781445d"
DISTRICTS = {
    "АНДИЖОН": ("andijan", "Andijon"),
    "БУЛОҚБОШИ": ("buloqboshi", "Buloqboshi"),
    "ХЎЖАОБОД": ("xojaobod", "Xo‘jaobod"),
    "ПАХТАОБОД": ("paxtaobod", "Paxtaobod"),
    "ИЗБОСКАН": ("izboskan", "Izboskan"),
    "БАЛИҚЧИ": ("baliqchi", "Baliqchi"),
    "УЛУҒНОР": ("ulugnor", "Ulug‘nor"),
    "ОЛТИНКЎЛ": ("oltinkol", "Oltinko‘l"),
    "БЎЗ": ("boz", "Bo‘z"),
    "ШАХРИХОН": ("shahrixon", "Shahrixon"),
    "АСАКА": ("asaka", "Asaka"),
    "МАРХАМАТ": ("marhamat", "Marhamat"),
    "ЖАЛАҚУДУҚ": ("jalaquduq", "Jalaquduq"),
    "ҚЎРҒОНТЕПА": ("qorgontepa", "Qo‘rg‘ontepa"),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    args = parser.parse_args()
    source_hash = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
    if source_hash != EXPECTED_SHA256:
        raise ValueError("Unexpected PDF revision; review source before changing the fingerprint")
    root = Path(__file__).resolve().parents[1]
    with pymupdf.open(args.pdf) as doc:
        if len(doc) != 1:
            raise ValueError("Expected the reviewed single-page Andijan map")
        page = doc[0]
        svg = page.get_svg_image(text_as_path=True)
        tree = ET.fromstring(svg)
        for node in tree.iter():
            tag = node.tag.split("}")[-1]
            if tag in {"script", "foreignObject", "a", "style"}:
                raise ValueError(f"Unexpected active SVG content: {tag}")
            for key, value in node.attrib.items():
                attribute = key.split("}")[-1].lower()
                if attribute.startswith("on"):
                    raise ValueError("Unexpected SVG event handler")
                if attribute == "href" and not value.startswith(("#", "data:image/")):
                    raise ValueError("Unexpected external SVG resource")

        features = []
        for block in page.get_text("blocks"):
            raw = block[4].strip()
            normalized = "".join(raw.split())
            label = " ".join(raw.split())
            if normalized in DISTRICTS:
                feature_id, name = DISTRICTS[normalized]
                kind = "district"
            elif label.startswith("н.ст.") and len(label.removeprefix("н.ст.").strip()) > 2:
                feature_id = f"pdf-pump-{len(features)}"
                name, kind = label, "pump"
            elif "сув омбори" in label and "W=" not in label:
                feature_id = f"pdf-reservoir-{len(features)}"
                name, kind = label, "reservoir"
            elif label.startswith("Г/уз.") and len(label) > 8:
                feature_id = f"pdf-junction-{len(features)}"
                name, kind = label, "junction"
            else:
                continue
            features.append({
                "id": feature_id,
                "name": name,
                "sourceLabel": raw,
                "kind": kind,
                "bounds": [round(value, 4) for value in block[:4]],
            })
        if sum(f["kind"] == "district" for f in features) != 14:
            raise ValueError("Expected all 14 source district labels")
        manifest = {
            "source": "Харита.pdf",
            "page": 1,
            "sourceSha256": source_hash,
            "asset": "/regional-maps/andijan-detailed.svg",
            "assetSha256": hashlib.sha256(svg.encode("utf-8")).hexdigest(),
            "width": round(page.rect.width, 4),
            "height": round(page.rect.height, 4),
            "drawingObjects": len(page.get_drawings()),
            "coordinateSpace": "PDF page points; label bounds, not geographic feature boundaries",
            "converter": f"PyMuPDF {pymupdf.VersionBind}; get_svg_image(text_as_path=True)",
            "features": features,
        }
        (root / "apps/web/public/regional-maps/andijan-detailed.svg").write_bytes(svg.encode("utf-8"))
        (root / "apps/web/src/andijan-source-index.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"Exported {len(svg.encode('utf-8')):,} bytes; {manifest['drawingObjects']} drawing objects; {len(features)} navigation labels")


if __name__ == "__main__":
    main()
