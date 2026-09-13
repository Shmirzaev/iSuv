"""Prepare browser-size copies and hashes of supplied reference maps without georeferencing.

Usage: python scripts/prepare-regional-maps.py --source-dir <folder> --clipboard-dir <folder>
Requires Pillow and pdftoppm on PATH. Originals remain untouched.
"""

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--source-dir", type=Path, required=True)
parser.add_argument("--clipboard-dir", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = root / "apps/web/public/regional-maps"
output.mkdir(parents=True, exist_ok=True)
manifest = []
inputs = [
    ("savay-area", args.clipboard_dir / "codex-clipboard-cf8c1886-8241-49f0-968e-ea91c94fc5c0.png"),
    ("andijan-irrigation", args.clipboard_dir / "codex-clipboard-0b6e7109-c047-4a3b-89ec-e4d21fdf9be2.png"),
    ("naryn-network", args.clipboard_dir / "codex-clipboard-7ce789e3-00f9-465b-808f-5bb54bb18dee.png"),
    ("fergana-valley", args.source_dir / "Водий харитаси.jpg"),
]
# The supplied valley image is 30,000 x 25,646 pixels. Decode a JPEG draft first.
Image.MAX_IMAGE_PIXELS = None
for key, path in inputs:
    with Image.open(path) as img:
        dimensions = img.size
        img.draft("RGB", (3200, 3200))
        img.thumbnail((3200, 3200))
        img.convert("RGB").save(output / f"{key}.webp", "WEBP", quality=90)
        manifest.append({"id": key, "fileName": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                         "originalSize": list(dimensions), "displaySize": list(img.size), "georeferenced": False})
pdf = args.source_dir / "Харита.pdf"
with tempfile.TemporaryDirectory(prefix="isuv-map-") as temp:
    preview = Path(temp) / "andijan"
    subprocess.run(["pdftoppm", "-f", "1", "-singlefile", "-scale-to", "3200", "-png", str(pdf), str(preview)], check=True)
    with Image.open(preview.with_suffix(".png")) as img:
        img.convert("RGB").save(output / "andijan-reference.webp", "WEBP", quality=90)
        manifest.append({"id": "andijan-reference", "fileName": pdf.name, "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
                         "page": 1, "displaySize": list(img.size), "georeferenced": False})
cdr = args.source_dir / "Савай.CDR"
manifest.append({"id": "savay-corel", "fileName": cdr.name, "sha256": hashlib.sha256(cdr.read_bytes()).hexdigest(),
                 "format": "CorelDRAW RIFF CDRD", "status": "no_local_vector_decoder", "georeferenced": False})
(root / "docs/reference/regional-map-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(manifest) - 1} map previews; CDR fingerprint retained without invented geometry")
