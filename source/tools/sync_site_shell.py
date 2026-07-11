#!/usr/bin/env python3
from pathlib import Path
from urllib.parse import unquote
import argparse
import html
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
SITE_MAP = ROOT / 'source' / 'site-map.json'
ANCHOR_WITH_DESCRIPTION = re.compile(
    r'(?P<prefix><a\b[^>]*href="(?P<href>[^"]+)"[^>]*>'
    r'(?:(?!</a>).)*?<small>)'
    r'(?P<description>(?:(?!</small>).)*)'
    r'(?P<suffix></small>(?:(?!</a>).)*?</a>)'
)


def resolve_page_file(current_path, href):
    raw = unquote(href.split('?', 1)[0].split('#', 1)[0]).strip()
    if not raw or raw.startswith(('http://', 'https://', 'mailto:', 'tel:')):
        return None
    target = (current_path.parent / raw).resolve()
    try:
        return target.relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return None


def update_navigation_line(line, current_path, descriptions):
    if 'class="drawer-groups"' not in line and not re.search(r'class="(?:prev|next)"', line):
        return line

    def replace(match):
        target_file = resolve_page_file(current_path, match.group('href'))
        description = descriptions.get(target_file)
        if description is None:
            return match.group(0)
        return match.group('prefix') + html.escape(description, quote=False) + match.group('suffix')

    return ANCHOR_WITH_DESCRIPTION.sub(replace, line)


def expected_html(path, descriptions):
    original = path.read_bytes().decode('utf-8')
    return ''.join(
        update_navigation_line(line, path, descriptions)
        for line in original.splitlines(keepends=True)
    )


def main():
    parser = argparse.ArgumentParser(description='Synchronize drawer and pager descriptions from site-map.json')
    parser.add_argument('--check', action='store_true', help='fail when navigation descriptions are stale')
    args = parser.parse_args()

    pages = json.loads(SITE_MAP.read_text(encoding='utf-8'))
    descriptions = {page['file']: page['desc'] for page in pages}
    stale = []

    for page in pages:
        path = ROOT / page['file']
        current = path.read_bytes().decode('utf-8')
        expected = expected_html(path, descriptions)
        if current == expected:
            continue
        stale.append(page['file'])
        if not args.check:
            path.write_bytes(expected.encode('utf-8'))

    if args.check and stale:
        print(f'site shell descriptions are stale: {", ".join(stale)}', file=sys.stderr)
        return 1

    action = 'verified' if args.check else 'updated'
    print(f'site shell descriptions {action} ({len(pages)} pages)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
