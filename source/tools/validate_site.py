#!/usr/bin/env python3
from pathlib import Path
from urllib.parse import unquote
from bs4 import BeautifulSoup
import json, re, sys

ROOT = Path(__file__).resolve().parents[2]
errors = []
warnings = []

def error(message): errors.append(message)
def warn(message): warnings.append(message)

pages = json.loads((ROOT/'source/site-map.json').read_text(encoding='utf-8'))
html_paths = [ROOT/page['file'] for page in pages]
if len(pages) != 16: error(f'site-map page count expected 16, got {len(pages)}')
if len(set(page['file'] for page in pages)) != len(pages): error('duplicate page file in site-map')

soups = {}
for path in html_paths:
    if not path.exists():
        error(f'missing HTML: {path.relative_to(ROOT)}')
        continue
    soup = BeautifulSoup(path.read_text(encoding='utf-8'), 'html.parser')
    soups[path] = soup
    ids = [tag['id'] for tag in soup.select('[id]')]
    duplicates = sorted({item for item in ids if ids.count(item) > 1})
    if duplicates: error(f'{path.relative_to(ROOT)} duplicate IDs: {duplicates}')
    if len(soup.select('h1')) != 1: error(f'{path.relative_to(ROOT)} expected one h1')
    if len(soup.select('main')) != 1: error(f'{path.relative_to(ROOT)} expected one main')
    if not soup.select_one('a.skip-link[href="#main-content"]'): error(f'{path.relative_to(ROOT)} missing skip link')
    if len(soup.select('.drawer-groups a')) != 16: error(f'{path.relative_to(ROOT)} drawer does not expose 16 pages')
    if not soup.select_one('.top-nav a[data-runtime-nav]'): error(f'{path.relative_to(ROOT)} missing Runtime top-nav link')

    for tag in soup.select('[href], [src]'):
        attr = 'href' if tag.has_attr('href') else 'src'
        raw = tag.get(attr, '').strip()
        if not raw or raw.startswith(('#', 'mailto:', 'tel:', 'javascript:', 'data:')): continue
        if re.match(r'^https?://', raw):
            # External editorial citations are allowed; external runtime assets are not.
            if attr == 'src' or tag.name in ('link', 'script', 'img'): error(f'{path.relative_to(ROOT)} external runtime asset: {raw}')
            continue
        value = unquote(raw.split('?',1)[0])
        file_part, _, fragment = value.partition('#')
        target = (path.parent/file_part).resolve() if file_part else path
        try: target.relative_to(ROOT.resolve())
        except ValueError:
            error(f'{path.relative_to(ROOT)} link escapes package: {raw}'); continue
        if not target.exists():
            error(f'{path.relative_to(ROOT)} broken {attr}: {raw}'); continue
        if fragment and target.suffix.lower() in ('.html', '.htm'):
            target_soup = soups.get(target)
            if target_soup is None:
                target_soup = BeautifulSoup(target.read_text(encoding='utf-8'), 'html.parser')
                soups[target] = target_soup
            if target_soup.find(id=fragment) is None:
                error(f'{path.relative_to(ROOT)} missing fragment target: {raw}')

# Diagram parity.
dots = sorted((ROOT/'source/diagrams').glob('*.dot'))
svgs = sorted((ROOT/'assets/diagrams').glob('*.svg'))
pngs = sorted((ROOT/'assets/diagrams').glob('*.png'))
if (len(dots),len(svgs),len(pngs)) != (34,34,34): error(f'diagram parity expected 34/34/34, got {len(dots)}/{len(svgs)}/{len(pngs)}')
for dot in dots:
    if not (ROOT/'assets/diagrams'/f'{dot.stem}.svg').exists(): error(f'missing SVG for {dot.name}')
    if not (ROOT/'assets/diagrams'/f'{dot.stem}.png').exists(): error(f'missing PNG for {dot.name}')

gallery = soups.get(ROOT/'modules/diagram-gallery.html')
if gallery and len(gallery.select('.gallery .thumb')) != 34: error('diagram gallery expected 34 cards')

# Runtime artifacts.
kernel_source = ROOT/'source/runtime/runtime-kernel.js'
kernel_browser = ROOT/'assets/js/runtime-kernel.js'
if kernel_source.read_bytes() != kernel_browser.read_bytes(): error('browser/source runtime kernels are not byte-identical')
contracts = sorted((ROOT/'source/contracts').glob('*.schema.json'))
adrs = sorted((ROOT/'source/adr').glob('ADR-*.md'))
if len(contracts) != 4: error(f'expected 4 contract schemas, got {len(contracts)}')
if len(adrs) != 5: error(f'expected 5 ADRs, got {len(adrs)}')
for item in contracts + [ROOT/'source/runtime/fixtures/fireball-golden-v1.json', ROOT/'source/runtime/fixtures/save-player-v1.json']:
    try: json.loads(item.read_text(encoding='utf-8'))
    except Exception as exc: error(f'invalid JSON {item.relative_to(ROOT)}: {exc}')

runtime = soups.get(ROOT/'modules/runtime-reference.html')
required = ['[data-runtime-lab]','[data-runtime-form]','[data-runtime-check="duplicate"]','[data-runtime-check="conflict"]','[data-runtime-check="rollback"]','[data-runtime-cache-probe]','[data-runtime-migration-probe]']
if runtime:
    for selector in required:
        if not runtime.select_one(selector): error(f'runtime page missing selector {selector}')
    scripts=[tag.get('src') for tag in runtime.select('script[src]')]
    if '../assets/js/runtime-kernel.js' not in scripts: error('runtime page does not load browser kernel')

search = json.loads((ROOT/'source/search-index.json').read_text(encoding='utf-8'))
if len([x for x in search if x.get('type')=='page']) != 16: error('search index page count mismatch')
if not any(x.get('file')=='modules/runtime-reference.html' and x.get('type')=='section' for x in search): error('runtime sections missing from search index')

report = {
  'status': 'pass' if not errors else 'fail',
  'htmlPages': len(html_paths), 'searchEntries': len(search),
  'diagrams': {'dot':len(dots),'svg':len(svgs),'png':len(pngs)},
  'contracts':len(contracts),'adrs':len(adrs),
  'errors':errors,'warnings':warnings
}
print(json.dumps(report, ensure_ascii=False, indent=2))
sys.exit(1 if errors else 0)
