#!/usr/bin/env python3
"""Render every Graphviz DOT source to the public SVG and PNG assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "source" / "diagrams"
OUTPUT_DIR = ROOT / "assets" / "diagrams"
SOURCE_MANIFEST = OUTPUT_DIR / "source-manifest.json"


def find_dot() -> Path:
    configured = os.environ.get("GRAPHVIZ_DOT")
    candidates = [
        Path(configured) if configured else None,
        Path(shutil.which("dot")) if shutil.which("dot") else None,
        Path(r"C:\Program Files\Graphviz\bin\dot.exe"),
        Path(r"C:\Program Files (x86)\Graphviz\bin\dot.exe"),
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    raise SystemExit(
        "Graphviz 'dot' was not found. Install Graphviz or set GRAPHVIZ_DOT "
        "to the renderer executable."
    )


def render(dot: Path, source: Path, target: Path, output_format: str) -> None:
    command = [str(dot), f"-T{output_format}", "-Gdpi=96", str(source), "-o", str(target)]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8")
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    if result.returncode:
        raise SystemExit(f"Graphviz failed for {source.relative_to(ROOT)}")


def selected_sources(patterns: list[str]) -> list[Path]:
    sources = sorted(SOURCE_DIR.glob("*.dot"))
    if not patterns:
        return sources
    wanted = {pattern.removesuffix(".dot") for pattern in patterns}
    selected = [source for source in sources if source.stem in wanted or source.name in patterns]
    missing = sorted(wanted - {source.stem for source in selected})
    if missing:
        raise SystemExit(f"Unknown diagram source(s): {', '.join(missing)}")
    return selected


def source_digest(source: Path) -> str:
    canonical_text = source.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    return hashlib.sha256(canonical_text.encode("utf-8")).hexdigest()


def load_source_manifest() -> dict[str, str]:
    if not SOURCE_MANIFEST.is_file():
        return {}
    try:
        payload = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Invalid diagram source manifest: {error}") from error
    if payload.get("schemaVersion") != 1 or payload.get("algorithm") != "sha256":
        raise SystemExit("Invalid diagram source manifest header")
    sources = payload.get("sources")
    if not isinstance(sources, dict) or not all(
        isinstance(name, str) and isinstance(digest, str)
        for name, digest in sources.items()
    ):
        raise SystemExit("Invalid diagram source manifest entries")
    return sources


def write_source_manifest(entries: dict[str, str]) -> None:
    payload = {
        "schemaVersion": 1,
        "algorithm": "sha256",
        "sources": dict(sorted(entries.items())),
    }
    SOURCE_MANIFEST.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def asset_is_well_formed(path: Path, output_format: str) -> bool:
    if not path.is_file() or path.stat().st_size == 0:
        return False
    content = path.read_bytes()
    if output_format == "png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    return b"<svg" in content[:1024]


def check_generated_assets(sources: list[Path], require_complete_manifest: bool) -> list[str]:
    recorded = load_source_manifest()
    failures: list[str] = []
    if require_complete_manifest:
        all_source_names = {source.name for source in SOURCE_DIR.glob("*.dot")}
        missing = sorted(all_source_names - recorded.keys())
        extra = sorted(recorded.keys() - all_source_names)
        failures.extend(f"manifest missing {name}" for name in missing)
        failures.extend(f"manifest retains removed source {name}" for name in extra)

    for source in sources:
        digest = source_digest(source)
        if recorded.get(source.name) != digest:
            failures.append(f"source digest changed: {source.relative_to(ROOT)}")
        for output_format in ("svg", "png"):
            public = OUTPUT_DIR / f"{source.stem}.{output_format}"
            if not asset_is_well_formed(public, output_format):
                failures.append(f"missing or invalid asset: {public.relative_to(ROOT)}")

    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail when generated assets are stale")
    parser.add_argument("--only", nargs="*", default=[], metavar="STEM", help="render selected diagram stems")
    args = parser.parse_args()

    sources = selected_sources(args.only)
    if not sources:
        raise SystemExit("No DOT sources found")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if args.check:
        failures = check_generated_assets(sources, require_complete_manifest=not args.only)
        if failures:
            print("Stale diagram assets:", file=sys.stderr)
            for failure in failures:
                print(f"- {failure}", file=sys.stderr)
            return 1
        print(f"verified {len(sources)} diagram source(s)")
        return 0

    dot = find_dot()
    with tempfile.TemporaryDirectory(prefix="gsk-diagrams-") as temporary:
        temp_dir = Path(temporary)
        for source in sources:
            generated: dict[str, Path] = {}
            for output_format in ("svg", "png"):
                target = temp_dir / f"{source.stem}.{output_format}"
                render(dot, source, target, output_format)
                generated[output_format] = target

            for candidate in generated.values():
                shutil.copyfile(candidate, OUTPUT_DIR / candidate.name)
            print(f"rendered {source.stem}")

    recorded = load_source_manifest() if args.only else {}
    current_names = {source.name for source in SOURCE_DIR.glob("*.dot")}
    recorded = {name: digest for name, digest in recorded.items() if name in current_names}
    for source in sources:
        recorded[source.name] = source_digest(source)
    write_source_manifest(recorded)
    print(f"rendered {len(sources)} diagram source(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
