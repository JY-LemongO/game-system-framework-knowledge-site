#!/usr/bin/env python3
"""Run the canonical repository QA stages and write commit-keyed evidence."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[2]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run_text(command: list[str]) -> str:
    result = subprocess.run(
        command,
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return (result.stdout or result.stderr).strip()


def git_text(*arguments: str) -> str:
    return run_text(["git", *arguments])


def chromium_version() -> str:
    try:
        from browser_launch import launch_chromium
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = launch_chromium(playwright)
            try:
                return browser.version
            finally:
                browser.close()
    except Exception as exc:  # Tool evidence must not replace the actual smoke gate.
        return f"unavailable ({type(exc).__name__})"


def run_stage(name: str, command: list[str]) -> tuple[dict[str, object], str]:
    print(f"\n=== QA stage: {name} ===", flush=True)
    started = time.perf_counter()
    output_parts: list[str] = []
    try:
        process = subprocess.Popen(
            command,
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        assert process.stdout is not None
        for line in process.stdout:
            print(line, end="", flush=True)
            output_parts.append(line)
        exit_code = process.wait()
    except OSError as exc:
        message = f"Unable to start {' '.join(command)}: {exc}\n"
        print(message, end="", file=sys.stderr, flush=True)
        output_parts.append(message)
        exit_code = 127

    duration_ms = round((time.perf_counter() - started) * 1000)
    return (
        {
            "name": name,
            "status": "pass" if exit_code == 0 else "fail",
            "exitCode": exit_code,
            "durationMs": duration_ms,
            "command": command,
        },
        "".join(output_parts),
    )


def stage_metrics(name: str, output: str) -> dict[str, object]:
    if name == "javascript":
        results = re.findall(r"^(\d+)/(\d+) (?:capstone )?tests passed", output, re.MULTILINE)
        return {
            "tests": sum(int(total) for _, total in results),
            "passed": sum(int(passed) for passed, _ in results),
        }
    if name == "csharp":
        match = re.search(r"PASS: (\d+) contract assertions", output)
        return {"assertions": int(match.group(1))} if match else {}
    if name == "static-validation":
        json_start = output.find("{\n")
        json_end = output.rfind("}")
        if json_start >= 0 and json_end >= json_start:
            try:
                report = json.loads(output[json_start:json_end + 1])
                return {
                    "htmlPages": report.get("htmlPages"),
                    "searchEntries": report.get("searchEntries"),
                    "contractSchemas": report.get("contracts"),
                    "architectureDecisionRecords": report.get("adrs"),
                    "diagrams": report.get("diagrams"),
                    "errors": len(report.get("errors", [])),
                    "warnings": len(report.get("warnings", [])),
                }
            except json.JSONDecodeError:
                return {}
    if name == "browser-smoke":
        json_start = output.find("{\n")
        json_end = output.rfind("}")
        if json_start >= 0 and json_end >= json_start:
            try:
                report = json.loads(output[json_start:json_end + 1])
                return {
                    "checks": report.get("checks"),
                    "passed": report.get("passed"),
                    "errors": len(report.get("errors", [])),
                }
            except json.JSONDecodeError:
                return {}
    return {}


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    npm = shutil.which("npm")
    if npm is None:
        print("npm is required to run repository QA.", file=sys.stderr)
        return 127

    head_sha = git_text("rev-parse", "HEAD") or "unknown"
    release_version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    runtime_source = (ROOT / "source/runtime/runtime-kernel.js").read_text(encoding="utf-8")
    runtime_match = re.search(r"const RUNTIME_VERSION = '([^']+)';", runtime_source)
    runtime_version = runtime_match.group(1) if runtime_match else "unknown"
    artifact_path = ROOT / ".artifacts" / "qa" / head_sha / "qa-results.json"

    stage_specs = [
        ("version-integrity", [npm, "run", "version:check"]),
        ("javascript", [npm, "run", "test"]),
        ("csharp", [npm, "run", "csharp:verify"]),
        ("site-shell", [npm, "run", "site-shell:check"]),
        ("diagrams", [npm, "run", "diagrams:check"]),
        ("search-index", [npm, "run", "search-index"]),
        ("static-validation", [npm, "run", "validate"]),
        ("manifest", [npm, "run", "manifest:check"]),
        ("browser-smoke", [npm, "run", "smoke"]),
    ]
    stages: list[dict[str, object]] = []
    evidence: dict[str, object] = {
        "schemaVersion": 1,
        "evidenceStatus": "ci-artifact" if os.environ.get("CI", "").lower() in {"1", "true", "yes"} else "local",
        "status": "running",
        "releaseVersion": release_version,
        "runtimeVersion": runtime_version,
        "commitSha": head_sha,
        "workingTreeDirty": bool(git_text("status", "--porcelain")),
        "startedAt": utc_now(),
        "completedAt": None,
        "tools": {
            "node": run_text([shutil.which("node") or "node", "--version"]),
            "dotnetSdk": run_text([shutil.which("dotnet") or "dotnet", "--version"]),
            "python": platform.python_version(),
            "chromium": chromium_version(),
        },
        "stages": stages,
    }

    exit_code = 0
    try:
        for name, command in stage_specs:
            stage, output = run_stage(name, command)
            metrics = stage_metrics(name, output)
            if metrics:
                stage["metrics"] = metrics
            stages.append(stage)
            if stage["status"] != "pass":
                exit_code = int(stage["exitCode"])
                break
    except Exception as exc:
        exit_code = 1
        stages.append({
            "name": "qa-runner",
            "status": "fail",
            "exitCode": exit_code,
            "durationMs": 0,
            "error": f"{type(exc).__name__}: {exc}",
        })
        print(f"QA runner failed: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
    finally:
        evidence["status"] = "pass" if exit_code == 0 else "fail"
        evidence["completedAt"] = utc_now()
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(f"\nQA evidence: {artifact_path.relative_to(ROOT).as_posix()}", flush=True)

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
