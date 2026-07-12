#!/usr/bin/env python3
"""Render every Graphviz DOT source to the public SVG and PNG assets."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "source" / "diagrams"
OUTPUT_DIR = ROOT / "assets" / "diagrams"


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail when generated assets are stale")
    parser.add_argument("--only", nargs="*", default=[], metavar="STEM", help="render selected diagram stems")
    args = parser.parse_args()

    dot = find_dot()
    sources = selected_sources(args.only)
    if not sources:
        raise SystemExit("No DOT sources found")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    stale: list[Path] = []
    with tempfile.TemporaryDirectory(prefix="gsk-diagrams-") as temporary:
        temp_dir = Path(temporary)
        for source in sources:
            generated: dict[str, Path] = {}
            for output_format in ("svg", "png"):
                target = temp_dir / f"{source.stem}.{output_format}"
                render(dot, source, target, output_format)
                generated[output_format] = target

            if args.check:
                for output_format, candidate in generated.items():
                    public = OUTPUT_DIR / candidate.name
                    if not public.is_file() or public.read_bytes() != candidate.read_bytes():
                        stale.append(public.relative_to(ROOT))
            else:
                for candidate in generated.values():
                    shutil.copyfile(candidate, OUTPUT_DIR / candidate.name)
                print(f"rendered {source.stem}")

    if stale:
        print("Stale diagram assets:", file=sys.stderr)
        for path in stale:
            print(f"- {path}", file=sys.stderr)
        return 1

    mode = "verified" if args.check else "rendered"
    print(f"{mode} {len(sources)} diagram source(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
