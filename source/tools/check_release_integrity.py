#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VERSION_PATTERN = r"\d+\.\d+\.\d+-reference"


def read_text(relative_path: str) -> str:
    path = ROOT / relative_path
    if not path.is_file():
        raise ValueError(f"required version source is missing: {relative_path}")
    return path.read_text(encoding="utf-8")


def extract(relative_path: str, pattern: str, label: str) -> str:
    match = re.search(pattern, read_text(relative_path), re.MULTILINE)
    if not match:
        raise ValueError(f"{label} was not found in {relative_path}")
    return match.group("version")


def package_version() -> str:
    value = json.loads(read_text("package.json")).get("version")
    if not isinstance(value, str):
        raise ValueError("package.json.version must be a string")
    return value


def fixture_runtime_version() -> str:
    value = json.loads(read_text("source/runtime/fixtures/fireball-golden-v1.json")).get("runtimeVersion")
    if not isinstance(value, str):
        raise ValueError("fireball-golden-v1.json.runtimeVersion must be a string")
    return value


def validate_version(label: str, value: str) -> None:
    if not re.fullmatch(VERSION_PATTERN, value):
        raise ValueError(f"{label} has an invalid version: {value!r}")


def validate_group(name: str, expected: str, values: dict[str, str]) -> list[str]:
    errors: list[str] = []
    validate_version(name, expected)
    for label, value in values.items():
        try:
            validate_version(label, value)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if value != expected:
            errors.append(f"{label} is {value}, expected {expected} from {name}")
    return errors


def main() -> int:
    errors: list[str] = []
    try:
        release_version = read_text("VERSION").strip()
        runtime_version = extract(
            "source/runtime/runtime-kernel.js",
            rf"^\s*const RUNTIME_VERSION = '(?P<version>{VERSION_PATTERN})';\s*$",
            "runtime kernel version",
        )

        # 릴리스 판본과 커널 의미 버전은 서로 독립적으로 일치시킨다.
        errors.extend(
            validate_group(
                "VERSION",
                release_version,
                {
                    "package.json.version": package_version(),
                    "PHASE3_REFERENCE_IMPLEMENTATION.md edition": extract(
                        "PHASE3_REFERENCE_IMPLEMENTATION.md",
                        rf"^- 판본: `(?P<version>{VERSION_PATTERN})`\s*$",
                        "reference implementation edition",
                    ),
                    "CHANGELOG_PHASE3_RUNTIME.md latest release": extract(
                        "CHANGELOG_PHASE3_RUNTIME.md",
                        rf"^## (?P<version>{VERSION_PATTERN})(?:\s|$)",
                        "latest changelog release",
                    ),
                },
            )
        )
        errors.extend(
            validate_group(
                "source runtime RUNTIME_VERSION",
                runtime_version,
                {
                    "browser runtime RUNTIME_VERSION": extract(
                        "assets/js/runtime-kernel.js",
                        rf"^\s*const RUNTIME_VERSION = '(?P<version>{VERSION_PATTERN})';\s*$",
                        "browser runtime version",
                    ),
                    "TypeScript RUNTIME_VERSION": extract(
                        "source/runtime/runtime-kernel.d.ts",
                        rf"^export const RUNTIME_VERSION: '(?P<version>{VERSION_PATTERN})';\s*$",
                        "TypeScript runtime version",
                    ),
                    "golden fixture runtimeVersion": fixture_runtime_version(),
                    "Fireball public runtimeVersion": extract(
                        "modules/fireball-case-study.html",
                        rf'"runtimeVersion":\s*"(?P<version>{VERSION_PATTERN})"',
                        "Fireball public runtime version",
                    ),
                },
            )
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        errors.append(str(exc))

    if errors:
        print("Release integrity check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Release integrity verified (releaseVersion={release_version}, runtimeVersion={runtime_version})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
