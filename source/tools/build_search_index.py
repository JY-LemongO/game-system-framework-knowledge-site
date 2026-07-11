#!/usr/bin/env python3
from pathlib import Path
from bs4 import BeautifulSoup
import json, re

ROOT = Path(__file__).resolve().parents[2]
SITE_MAP = ROOT / 'source' / 'site-map.json'
OUT_JSON = ROOT / 'source' / 'search-index.json'
OUT_JS = ROOT / 'assets' / 'js' / 'search-index.js'

pages = json.loads(SITE_MAP.read_text(encoding='utf-8'))
entries = []

def compact_description(value, limit=168):
    text = ' '.join(str(value or '').split())
    if len(text) <= limit:
        return text
    clipped = text[:limit + 1]
    boundary = clipped.rfind(' ')
    if boundary < int(limit * 0.65):
        boundary = limit
    return clipped[:boundary].rstrip() + '…'

for page_order, page in enumerate(pages):
    path = ROOT / page['file']
    soup = BeautifulSoup(path.read_text(encoding='utf-8'), 'html.parser')
    article = soup.select_one('#article-content')
    entries.append({
        'type': 'page', 'file': page['file'], 'anchor': '', 'title': page['title'],
        'short': page['short'], 'desc': compact_description(page['desc'], 150), 'group': page['group'],
        'level': page['level'], 'text': page.get('key', ''), 'pageOrder': page_order
    })
    if not article:
        continue
    for heading in article.select('h2[id], h3[id]'):
        title = ' '.join(heading.get_text(' ', strip=True).split())
        if not title:
            continue
        desc = ''
        node = heading.find_next_sibling()
        scanned = 0
        while node and scanned < 4:
            if getattr(node, 'name', None) in ('h2', 'h3'):
                break
            if getattr(node, 'name', None) in ('pre', 'table') or (hasattr(node, 'select_one') and node.select_one('pre, table')):
                node = node.find_next_sibling()
                scanned += 1
                continue
            text = ' '.join(node.get_text(' ', strip=True).split()) if hasattr(node, 'get_text') else ''
            if text:
                desc = compact_description(text)
                break
            node = node.find_next_sibling()
            scanned += 1
        entries.append({
            'type': 'section', 'file': page['file'], 'anchor': '#' + heading['id'],
            'title': title, 'short': page['short'], 'desc': desc,
            'group': page['group'], 'level': heading.name.upper(), 'text': page.get('key', ''),
            'pageOrder': page_order
        })

OUT_JSON.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
payload = {'pages': pages, 'entries': entries}
OUT_JS.write_text('window.__GSF_SITE__=' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
print(json.dumps({'pages': len(pages), 'entries': len(entries), 'output': str(OUT_JS.relative_to(ROOT))}, ensure_ascii=False))
