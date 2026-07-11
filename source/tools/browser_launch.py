"""Portable Chromium discovery for local Playwright tooling."""

from pathlib import Path
import os
import shutil


LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage']


def _candidate_paths():
    explicit = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or os.environ.get('CHROMIUM_PATH')
    if explicit:
        yield Path(explicit).expanduser()

    for command in ('chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'msedge'):
        resolved = shutil.which(command)
        if resolved:
            yield Path(resolved)

    local_app_data = os.environ.get('LOCALAPPDATA')
    program_files = os.environ.get('PROGRAMFILES')
    program_files_x86 = os.environ.get('PROGRAMFILES(X86)')
    for base, relative in (
        (local_app_data, 'Microsoft/Edge/Application/msedge.exe'),
        (local_app_data, 'Google/Chrome/Application/chrome.exe'),
        (program_files, 'Microsoft/Edge/Application/msedge.exe'),
        (program_files, 'Google/Chrome/Application/chrome.exe'),
        (program_files_x86, 'Microsoft/Edge/Application/msedge.exe'),
        (program_files_x86, 'Google/Chrome/Application/chrome.exe'),
    ):
        if base:
            yield Path(base) / relative


def launch_chromium(playwright):
    """Launch an explicit/system Chromium, then fall back to Playwright channels."""
    attempted = []
    seen = set()
    for candidate in _candidate_paths():
        key = str(candidate.resolve()) if candidate.exists() else str(candidate)
        if key in seen or not candidate.is_file():
            continue
        seen.add(key)
        try:
            return playwright.chromium.launch(
                executable_path=str(candidate),
                headless=True,
                args=LAUNCH_ARGS,
            )
        except Exception as exc:
            attempted.append(f'{candidate}: {exc}')

    try:
        return playwright.chromium.launch(headless=True, args=LAUNCH_ARGS)
    except Exception as exc:
        attempted.append(f'Playwright managed Chromium: {exc}')

    for channel in ('msedge', 'chrome'):
        try:
            return playwright.chromium.launch(channel=channel, headless=True, args=LAUNCH_ARGS)
        except Exception as exc:
            attempted.append(f'{channel} channel: {exc}')

    detail = '\n'.join(attempted)
    raise RuntimeError(
        'No usable Chromium browser was found. Install Playwright Chromium or set '
        'PLAYWRIGHT_CHROMIUM_EXECUTABLE/CHROMIUM_PATH.\n' + detail
    )
