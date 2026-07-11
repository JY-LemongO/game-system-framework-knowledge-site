#!/usr/bin/env python3
from pathlib import Path
from urllib.parse import unquote
from bs4 import BeautifulSoup
import json, re, sys

ROOT = Path(__file__).resolve().parents[2]
errors = []
warnings = []
REMOVED_ROUTES = {
    'modules/phase3-readiness.html',
    'modules/implementation-roadmap.html',
    'modules/skill-combat-next.html',
    'modules/quality-audit.html',
}
LEARNING_ROUTES = {
    'index.html',
    'modules/core-runtime.html',
    'modules/stat-system.html',
    'modules/effect-system.html',
    'modules/skill-action-system.html',
    'modules/combat-resolution-system.html',
    'modules/status-system.html',
    'modules/integration-map.html',
    'modules/fireball-case-study.html',
    'modules/runtime-reference.html',
    'modules/diagram-gallery.html',
    'modules/glossary.html',
}
CORE_LEARNING_ROUTES = {
    'modules/core-runtime.html': 'core',
    'modules/stat-system.html': 'stat',
    'modules/effect-system.html': 'effect',
    'modules/skill-action-system.html': 'skill',
    'modules/combat-resolution-system.html': 'combat',
    'modules/status-system.html': 'status',
}
SHELL_SELECTORS = ('.topbar', '.system-dock', '.site-footer', '[data-site-drawer]', '.mobile-bar')
SHELL_TEXT_PATTERNS = {
    'release label': re.compile(r'\brelease(?:\s+\d+(?:\.\d+)*)?\b', re.I),
    'build-plan label': re.compile(r'\bbuild\s*plan\b', re.I),
    'quality-audit label': re.compile(r'\bquality\s*audit\b', re.I),
    'product metadata': re.compile(r'\boffline-first\b|\blearning-focused\b', re.I),
}
PUBLIC_CONTENT_PATTERNS = {
    'future implementation label': re.compile(r'\bfuture\s*:|\bphase\s+\d+\b|구현\s*예정|향후\s*구현|로드맵', re.I),
    'Unity audience marketing': re.compile(r'Unity(?:Engine|\s+Engine)?\s*(?:개발자|프로그래머)|Unity를\s*위한', re.I),
}

def error(message): errors.append(message)
def warn(message): warnings.append(message)

def extract_csharp_declaration(soup, declaration):
    """Return one normalized C# declaration, including its balanced body."""
    matches = []
    for block in soup.select('#article-content code.language-csharp'):
        source = block.get_text('\n')
        start = source.find(declaration)
        if start < 0:
            continue
        opening = source.find('{', start)
        if opening < 0:
            continue
        depth = 0
        for index in range(opening, len(source)):
            if source[index] == '{':
                depth += 1
            elif source[index] == '}':
                depth -= 1
                if depth == 0:
                    matches.append(re.sub(r'\s+', ' ', source[start:index + 1]).strip())
                    break
    if len(matches) != 1:
        return None, len(matches)
    return matches[0], 1

pages = json.loads((ROOT/'source/site-map.json').read_text(encoding='utf-8'))
html_paths = [ROOT/page['file'] for page in pages]
page_files = [page['file'] for page in pages]
page_file_set = set(page_files)
expected_page_count = len(pages)
if len(page_file_set) != expected_page_count: error('duplicate page file in site-map')
if page_file_set != LEARNING_ROUTES:
    error(f'site-map differs from the 12 learning routes: missing={sorted(LEARNING_ROUTES-page_file_set)}, extra={sorted(page_file_set-LEARNING_ROUTES)}')
core_metadata = sorted(
    (page.get('learningOrder'), page['file'])
    for page in pages
    if page.get('learningTrack') == 'core'
)
expected_core_metadata = [(index, file) for index, file in enumerate(CORE_LEARNING_ROUTES, start=1)]
if core_metadata != expected_core_metadata:
    error(f'core learning metadata differs from the six-page path: {core_metadata}')
public_html = {'index.html'} | {path.relative_to(ROOT).as_posix() for path in (ROOT/'modules').glob('*.html')}
if public_html != LEARNING_ROUTES:
    error(f'public HTML differs from the 12 learning routes: missing={sorted(LEARNING_ROUTES-public_html)}, extra={sorted(public_html-LEARNING_ROUTES)}')
for removed in sorted(REMOVED_ROUTES & page_file_set):
    error(f'removed route remains in site-map: {removed}')

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
    drawer_count = len(soup.select('.drawer-groups a'))
    if drawer_count != expected_page_count:
        error(f'{path.relative_to(ROOT)} drawer exposes {drawer_count} pages, expected {expected_page_count} from site-map')
    if any(page['file'] == 'modules/runtime-reference.html' for page in pages) and not soup.select_one('.top-nav a[data-runtime-nav]'):
        error(f'{path.relative_to(ROOT)} missing Runtime top-nav link')

    shell_text = ' '.join(node.get_text(' ', strip=True) for selector in SHELL_SELECTORS for node in soup.select(selector))
    for label, pattern in SHELL_TEXT_PATTERNS.items():
        if pattern.search(shell_text):
            error(f'{path.relative_to(ROOT)} shell retains {label}')

    article = soup.select_one('#article-content')
    article_text = article.get_text(' ', strip=True) if article else ''
    for label, pattern in PUBLIC_CONTENT_PATTERNS.items():
        if pattern.search(article_text):
            error(f'{path.relative_to(ROOT)} article retains {label}')

    relative_file = path.relative_to(ROOT).as_posix()
    language_badges = soup.select('[data-example-language="csharp"]')
    if len(language_badges) != 1:
        error(f'{relative_file} expected one C# language badge, got {len(language_badges)}')
    code_blocks = soup.select('#article-content pre > code')
    unlabeled_blocks = [block for block in code_blocks if not any(name.startswith('language-') for name in block.get('class', []))]
    if unlabeled_blocks:
        error(f'{relative_file} has {len(unlabeled_blocks)} code blocks without an explicit language label')
    if relative_file in CORE_LEARNING_ROUTES:
        if not soup.select_one('#article-content code.language-csharp'):
            error(f'{relative_file} has no C# implementation example')
        prefix = CORE_LEARNING_ROUTES[relative_file]
        checkpoints = soup.select('section[data-learning-checkpoint]')
        if len(checkpoints) != 1:
            error(f'{relative_file} expected one learning checkpoint, got {len(checkpoints)}')
        else:
            checkpoint = checkpoints[0]
            labelled_by = checkpoint.get('aria-labelledby')
            if not labelled_by or checkpoint.find(id=labelled_by) is None:
                error(f'{relative_file} checkpoint has no valid aria-labelledby target')
            next_section = checkpoint.find_next_sibling()
            if not next_section or next_section.name != 'h2' or next_section.get('id') != '설계-점검':
                error(f'{relative_file} checkpoint must appear immediately before design review')
            questions = checkpoint.select('details[data-checkpoint-question]')
            if len(questions) != 3:
                error(f'{relative_file} expected three checkpoint questions, got {len(questions)}')
            question_ids = []
            question_texts = []
            answer_texts = []
            for question in questions:
                question_id = question.get('data-question-id', '').strip()
                question_ids.append(question_id)
                if not question_id.startswith(f'{prefix}.q'):
                    error(f'{relative_file} invalid checkpoint question id: {question_id!r}')
                summaries = question.find_all('summary', recursive=False)
                if len(summaries) != 1 or not summaries[0].get_text(' ', strip=True):
                    error(f'{relative_file} checkpoint {question_id!r} requires one non-empty direct summary')
                else:
                    question_texts.append(summaries[0].get_text(' ', strip=True))
                answers = question.select('[data-answer-explanation]')
                if len(answers) != 1 or not answers[0].get_text(' ', strip=True):
                    error(f'{relative_file} checkpoint {question_id!r} requires one non-empty answer explanation')
                else:
                    answer_texts.append(answers[0].get_text(' ', strip=True))
                if question.select('a button, button a, summary a, summary button'):
                    error(f'{relative_file} checkpoint {question_id!r} nests interactive controls')
            if len(set(question_ids)) != len(question_ids):
                error(f'{relative_file} checkpoint question ids are not unique')
            if len(set(question_texts)) != len(question_texts):
                error(f'{relative_file} checkpoint question texts are not unique')
            if len(set(answer_texts)) != len(answer_texts):
                error(f'{relative_file} checkpoint answer explanations are not unique')
        if len(soup.select('a[href="#이해도-확인"]')) != 2:
            error(f'{relative_file} checkpoint must appear in desktop and dialog tables of contents')

    page_meta = next((page for page in pages if page['file'] == relative_file), None)
    page_title = soup.select_one('#article-content h1')
    if page_meta and page_title and page_title.get_text(' ', strip=True) != page_meta['title']:
        error(f'{relative_file} h1 does not match site-map title')
    description = soup.select_one('meta[name="description"]')
    if page_meta and (not description or description.get('content', '').strip() != page_meta['desc']):
        error(f'{relative_file} meta description does not match site-map')

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
        target_relative = target.relative_to(ROOT.resolve()).as_posix()
        if target_relative in REMOVED_ROUTES:
            error(f'{path.relative_to(ROOT)} links removed route: {raw}')
        if not target.exists():
            error(f'{path.relative_to(ROOT)} broken {attr}: {raw}'); continue
        if fragment and target.suffix.lower() in ('.html', '.htm'):
            target_soup = soups.get(target)
            if target_soup is None:
                target_soup = BeautifulSoup(target.read_text(encoding='utf-8'), 'html.parser')
                soups[target] = target_soup
            if target_soup.find(id=fragment) is None:
                error(f'{path.relative_to(ROOT)} missing fragment target: {raw}')

# Repeated public C# contracts must stay byte-for-byte equivalent after whitespace normalization.
contract_pairs = [
    ('public sealed class DamageRequest', 'modules/effect-system.html', 'modules/combat-resolution-system.html'),
    ('public interface IEffectExecutor', 'modules/effect-system.html', 'modules/integration-map.html'),
    ('public interface ISkillService', 'modules/skill-action-system.html', 'modules/integration-map.html'),
    ('public interface IStatusService', 'modules/status-system.html', 'modules/integration-map.html'),
    ('public interface IReactionQueue', 'modules/runtime-reference.html', 'modules/integration-map.html'),
]
for declaration, left_file, right_file in contract_pairs:
    left, left_count = extract_csharp_declaration(soups.get(ROOT/left_file), declaration)
    right, right_count = extract_csharp_declaration(soups.get(ROOT/right_file), declaration)
    if left_count != 1 or right_count != 1:
        error(f'{declaration} expected once in {left_file} and {right_file}, got {left_count}/{right_count}')
    elif left != right:
        error(f'{declaration} differs between {left_file} and {right_file}')

status_contract, status_contract_count = extract_csharp_declaration(
    soups.get(ROOT/'modules/status-system.html'),
    'public sealed class ApplyStatusRequest',
)
if status_contract_count != 1 or 'public SourceRef Source { get; }' not in status_contract:
    error('ApplyStatusRequest must preserve its structured SourceRef contract')

canonical_property_sets = [
    ('public sealed class SkillRequest', 'modules/skill-action-system.html', {'CasterId', 'SkillId', 'TargetId', 'RequestedTick', 'RootSeed'}),
    ('public sealed class EffectContext', 'modules/effect-system.html', {'CasterId', 'InitialTargetId', 'Source', 'RandomSeed'}),
    ('public sealed class DamageResult', 'modules/combat-resolution-system.html', {'Hit', 'Critical', 'RawDamage', 'ResolvedDamage', 'ShieldAbsorbed', 'FinalHpDamage'}),
]
for declaration, file, expected_properties in canonical_property_sets:
    contract, count = extract_csharp_declaration(soups.get(ROOT/file), declaration)
    properties = set(re.findall(r'public\s+[\w<>,?\[\]]+\s+(\w+)\s*\{\s*get\s*;', contract or ''))
    if count != 1 or properties != expected_properties:
        error(f'{declaration} in {file} has properties {sorted(properties)}, expected {sorted(expected_properties)}')

fireball = soups.get(ROOT/'modules/fireball-case-study.html')
fireball_orchestration = [
    block.get_text('\n') for block in fireball.select('#article-content code.language-csharp')
    if 'FireballResult Execute' in block.get_text()
] if fireball else []
if len(fireball_orchestration) != 1:
    error(f'Fireball orchestration expected once, got {len(fireball_orchestration)}')
elif ('_effects.Execute' not in fireball_orchestration[0]
      or 'release.EffectBundle' not in fireball_orchestration[0]
      or '_combat.Resolve' in fireball_orchestration[0]):
    error('Fireball orchestration must enter Combat through the Effect layer')

status = soups.get(ROOT/'modules/status-system.html')
status_tick_examples = [
    block.get_text('\n') for block in status.select('#article-content code.language-csharp')
    if 'AdvanceInstance' in block.get_text()
] if status else []
if len(status_tick_examples) != 1:
    error(f'Status tick example expected once, got {len(status_tick_examples)}')
elif (any(token not in status_tick_examples[0] for token in ('MaxCatchUpTicks', 'RecordCatchUpLimit', 'StatusRemoveReason.CatchUpLimited'))):
    error('Status tick example must enforce, trace, and classify the per-instance catch-up limit')

home = soups.get(ROOT/'index.html')
if home:
    panels = home.select('section[data-learning-progress]')
    if len(panels) != 1:
        error(f'index.html expected one learning progress panel, got {len(panels)}')
    else:
        panel = panels[0]
        meter = panel.select_one('progress[data-learning-progress-meter]')
        if not meter or meter.get('max') != '6' or meter.get('value') != '0' or not meter.get('aria-label'):
            error('index.html learning progress meter requires max=6, value=0, and an accessible label')
        if len(panel.select('[data-learning-progress-count]')) != 1:
            error('index.html learning progress count is missing or duplicated')
        resume = panel.select_one('a[data-learning-resume]')
        if not resume or resume.get('href') != 'modules/core-runtime.html':
            error('index.html initial learning resume link must target Core Runtime')
        reset = panel.select_one('button[data-learning-reset][type="button"]')
        if not reset:
            error('index.html learning reset control must be a button')
        status = panel.select_one('[data-learning-progress-status][role="status"][aria-live="polite"]')
        if not status:
            error('index.html learning progress live status is missing')

# Diagram parity.
dots = sorted((ROOT/'source/diagrams').glob('*.dot'))
svgs = sorted((ROOT/'assets/diagrams').glob('*.svg'))
pngs = sorted((ROOT/'assets/diagrams').glob('*.png'))
if (len(dots),len(svgs),len(pngs)) != (34,34,34): error(f'diagram parity expected 34/34/34, got {len(dots)}/{len(svgs)}/{len(pngs)}')
for dot in dots:
    if not (ROOT/'assets/diagrams'/f'{dot.stem}.svg').exists(): error(f'missing SVG for {dot.name}')
    if not (ROOT/'assets/diagrams'/f'{dot.stem}.png').exists(): error(f'missing PNG for {dot.name}')
for diagram_path in dots + svgs:
    diagram_text = diagram_path.read_text(encoding='utf-8')
    for label, pattern in PUBLIC_CONTENT_PATTERNS.items():
        if pattern.search(diagram_text):
            error(f'{diagram_path.relative_to(ROOT)} retains {label}')

diagram_contract_requirements = {
    'source/diagrams/10_effect_core_class_diagram.dot': (
        'IEffectExecutor', 'EffectBundleResult', 'IEffectOperationExecutor',
        'ReactionDefinition[]', 'CommitThenReact', 'FailureReason',
    ),
    'source/diagrams/29_status_tick_activity_diagram.dot': (
        'MaxCatchUpTicks', 'CatchUpLimited', 'trace dropped ticks', 'next advance',
    ),
}
for relative_path, required_tokens in diagram_contract_requirements.items():
    diagram_text = (ROOT/relative_path).read_text(encoding='utf-8')
    missing = [token for token in required_tokens if token not in diagram_text]
    if missing:
        error(f'{relative_path} missing contract labels: {missing}')

gallery = soups.get(ROOT/'modules/diagram-gallery.html')
if gallery:
    gallery_path = ROOT/'modules/diagram-gallery.html'
    for index, card in enumerate(gallery.select('.gallery .thumb'), start=1):
        references = []
        image = card.select_one('img[src]')
        svg_link = card.select_one('a[href$=".svg"]')
        if image and image.get('src', '').lower().split('?', 1)[0].endswith('.svg'):
            references.append(image['src'])
        if svg_link:
            references.append(svg_link['href'])
        if not references:
            error(f'diagram gallery card {index} has no SVG reference')
            continue
        for raw in references:
            value = unquote(raw.split('?', 1)[0])
            target = (gallery_path.parent/value).resolve()
            try:
                target.relative_to((ROOT/'assets/diagrams').resolve())
            except ValueError:
                error(f'diagram gallery card {index} SVG escapes diagram assets: {raw}')
                continue
            if target.suffix.lower() != '.svg' or not target.is_file():
                error(f'diagram gallery card {index} invalid SVG: {raw}')

# Runtime artifacts.
kernel_source = ROOT/'source/runtime/runtime-kernel.js'
kernel_browser = ROOT/'assets/js/runtime-kernel.js'
if kernel_source.read_bytes() != kernel_browser.read_bytes(): error('browser/source runtime kernels are not byte-identical')
contracts = sorted((ROOT/'source/contracts').glob('*.schema.json'))
adrs = sorted((ROOT/'source/adr').glob('ADR-*.md'))
required_contracts = {
    'command-envelope.schema.json',
    'domain-event-envelope.schema.json',
    'replay-fixture.schema.json',
    'source-ref.schema.json',
    'versioned-document.schema.json',
}
contract_names = {item.name for item in contracts}
if required_contracts - contract_names:
    error(f'missing contract schemas: {sorted(required_contracts-contract_names)}')
if len(adrs) != 5: error(f'expected 5 ADRs, got {len(adrs)}')
for item in contracts + [ROOT/'source/runtime/fixtures/fireball-golden-v1.json', ROOT/'source/runtime/fixtures/save-player-v1.json']:
    try: json.loads(item.read_text(encoding='utf-8'))
    except Exception as exc: error(f'invalid JSON {item.relative_to(ROOT)}: {exc}')

runtime_page = next((page for page in pages if page['file'] == 'modules/runtime-reference.html'), None)
runtime = soups.get(ROOT/runtime_page['file']) if runtime_page else None
required = ['[data-runtime-lab]','[data-runtime-form]','[data-runtime-check="duplicate"]','[data-runtime-check="conflict"]','[data-runtime-check="rollback"]','[data-runtime-cache-probe]','[data-runtime-migration-probe]']
if runtime:
    if not runtime.select_one('[data-simulator-language="javascript"]'):
        error('runtime page does not identify the JavaScript simulator')
    runtime_title = runtime.select_one('#article-content .hero h1, #article-content > h1, #article-content h1')
    if not runtime_title:
        error('runtime page missing learning title')
    elif runtime_title.get_text(' ', strip=True) != runtime_page['title']:
        error(f'runtime title does not match site-map: {runtime_title.get_text(" ", strip=True)!r} != {runtime_page["title"]!r}')
    for selector in required:
        if not runtime.select_one(selector): error(f'runtime page missing selector {selector}')
    scripts=[tag.get('src') for tag in runtime.select('script[src]')]
    if '../assets/js/runtime-kernel.js' not in scripts: error('runtime page does not load browser kernel')

search = json.loads((ROOT/'source/search-index.json').read_text(encoding='utf-8'))
leaked_answers = [item for item in search if '정답과 해설' in item.get('desc', '')]
if leaked_answers:
    error(f'search descriptions expose checkpoint answers: {[item.get("file", "") + item.get("anchor", "") for item in leaked_answers]}')
required_section_descriptions = {
    ('index.html', '#학습-방식-선택'),
    ('modules/core-runtime.html', '#안티패턴'),
    ('modules/stat-system.html', '#핵심-객체-읽기'),
    ('modules/effect-system.html', '#핵심-객체-상세'),
    ('modules/skill-action-system.html', '#fireball-실행-예시'),
    ('modules/combat-resolution-system.html', '#설계-변형-포인트'),
    ('modules/status-system.html', '#rage-freeze-poison-예시'),
}
search_lookup = {(item.get('file'), item.get('anchor')): item for item in search}
empty_required_descriptions = sorted(
    key for key in required_section_descriptions
    if not search_lookup.get(key, {}).get('desc', '').strip()
)
if empty_required_descriptions:
    error(f'search lost nested-card section descriptions: {empty_required_descriptions}')
search_pages = [item for item in search if item.get('type') == 'page']
if len(search_pages) != expected_page_count:
    error(f'search index exposes {len(search_pages)} pages, expected {expected_page_count} from site-map')
search_page_files = {item.get('file') for item in search_pages}
if search_page_files != page_file_set:
    error(f'search index page files differ from site-map: missing={sorted(page_file_set-search_page_files)}, extra={sorted(search_page_files-page_file_set)}')
if runtime_page and not any(x.get('file')==runtime_page['file'] and x.get('type')=='section' for x in search):
    error('runtime sections missing from search index')

report = {
  'status': 'pass' if not errors else 'fail',
  'htmlPages': len(html_paths), 'searchEntries': len(search),
  'diagrams': {'dot':len(dots),'svg':len(svgs),'png':len(pngs)},
  'contracts':len(contracts),'adrs':len(adrs),
  'errors':errors,'warnings':warnings
}
print(json.dumps(report, ensure_ascii=False, indent=2))
sys.exit(1 if errors else 0)
