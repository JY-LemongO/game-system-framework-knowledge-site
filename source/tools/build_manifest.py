#!/usr/bin/env python3
"""Build or verify the repository's deterministic SHA-256 manifest."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "MANIFEST.sha256"
EXCLUDED_FILES = {".gitignore", ".nojekyll", "MANIFEST.sha256"}
EXCLUDED_PREFIXES = (".github/",)


def repository_files() -> list[Path]:
    env = os.environ.copy()
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    result = subprocess.run(
        [
            "git",
            "-c",
            f"safe.directory={ROOT.as_posix()}",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
    )
    relative_paths = result.stdout.decode("utf-8").split("\0")
    files = []
    for raw in relative_paths:
        relative = raw.replace("\\", "/")
        if not relative or relative in EXCLUDED_FILES or relative.startswith(EXCLUDED_PREFIXES):
            continue
        path = ROOT / relative
        if path.is_file():
            files.append(path)
    return sorted(files, key=lambda path: path.relative_to(ROOT).as_posix())


def build_text() -> str:
    lines = []
    for path in repository_files():
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        relative = path.relative_to(ROOT).as_posix()
        lines.append(f"{digest}  ./{relative}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail when MANIFEST.sha256 is stale")
    args = parser.parse_args()
    expected = build_text()
    if args.check:
        actual = MANIFEST.read_text(encoding="utf-8") if MANIFEST.exists() else ""
        if actual != expected:
            print("MANIFEST.sha256 is stale; run npm run manifest", file=sys.stderr)
            return 1
        print(f"MANIFEST.sha256 verified ({expected.count(chr(10))} files)")
        return 0
    MANIFEST.write_text(expected, encoding="utf-8", newline="\n")
    print(f"MANIFEST.sha256 updated ({expected.count(chr(10))} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
