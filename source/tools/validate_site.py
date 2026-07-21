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
TRACKED_LEARNING_ROUTES = {
    **CORE_LEARNING_ROUTES,
    'modules/integration-map.html': 'integration',
    'modules/fireball-case-study.html': 'fireball',
    'modules/runtime-reference.html': 'runtime',
}
CHECKPOINT_FOLLOWING_SECTION = {
    'modules/core-runtime.html': '설계-점검',
    'modules/stat-system.html': '설계-점검',
    'modules/effect-system.html': '설계-점검',
    'modules/skill-action-system.html': '설계-점검',
    'modules/combat-resolution-system.html': '설계-점검',
    'modules/status-system.html': '설계-점검',
    'modules/integration-map.html': '설계-점검',
    'modules/fireball-case-study.html': '요약',
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
    'implementation planning label': re.compile(r'\bMVP\b|다음\s*구현|추후\s*개발|\bREADME\b', re.I),
    'Unity audience marketing': re.compile(r'Unity(?:Engine|\s+Engine)?\s*(?:개발자|프로그래머)|Unity를\s*위한', re.I),
}
NAMESPACED_ID = re.compile(r'^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9_-]*)+$')
JSON_ID_KEYS = {
    'id', 'entityId', 'actorId', 'targetId', 'attacker', 'defender',
    'statusId', 'playerId', 'commandId', 'sourceId', 'instanceId',
    'definitionId', 'skillId', 'skillDefinitionId', 'modifierSourceId',
    'appliedBySourceId', 'statusInstanceId', 'formulaId', 'effect',
    'periodicEffect', 'randomStream', 'eventId', 'correlationId',
    'causationId', 'reactionId', 'planId', 'resourceId', 'bundleId',
    'operationId', 'handlerId', 'documentId', 'idempotencyKey',
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

def extract_csharp_declaration_from_source(source, declaration):
    # 실행 소스도 공개 코드 블록과 같은 균형 괄호 규칙으로 정규화한다.
    starts = [match.start() for match in re.finditer(re.escape(declaration), source)]
    matches = []
    for start in starts:
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

def walk_json_ids(value, path='$'):
    if isinstance(value, dict):
        for key, item in value.items():
            item_path = f'{path}.{key}'
            if key in JSON_ID_KEYS and isinstance(item, str) and not NAMESPACED_ID.fullmatch(item):
                yield item_path, item
            yield from walk_json_ids(item, item_path)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk_json_ids(item, f'{path}[{index}]')

def extract_enum_members(source, enum_name):
    match = re.search(rf'public\s+enum\s+{re.escape(enum_name)}\s*\{{([^}}]*)\}}', source, re.S)
    if not match:
        return None
    body = re.sub(r'//.*?$|/\*.*?\*/', '', match.group(1), flags=re.M | re.S)
    members = []
    for item in body.split(','):
        name = item.split('=', 1)[0].strip()
        if name:
            members.append(name)
    return members

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
tracked_metadata = sorted(
    (page.get('learningOrder'), page['file'])
    for page in pages
    if page['file'] in TRACKED_LEARNING_ROUTES
)
expected_tracked_metadata = [
    (index, file) for index, file in enumerate(TRACKED_LEARNING_ROUTES, start=1)
]
if tracked_metadata != expected_tracked_metadata:
    error(f'learning metadata differs from the nine-page path: {tracked_metadata}')
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
    if re.search(r'\b(?:player|enemy|crate)_\d+\b', article_text):
        error(f'{path.relative_to(ROOT)} article uses a non-namespaced entity example')
    for index, block in enumerate(article.select('code.language-json') if article else [], start=1):
        try:
            payload = json.loads(block.get_text())
        except json.JSONDecodeError:
            continue
        for json_path, identifier in walk_json_ids(payload):
            error(f'{path.relative_to(ROOT)} JSON block {index} has non-namespaced ID {json_path}={identifier!r}')

    relative_file = path.relative_to(ROOT).as_posix()
    language_badges = soup.select('[data-example-language="csharp"]')
    if len(language_badges) != 1:
        error(f'{relative_file} expected one C# language badge, got {len(language_badges)}')
    code_blocks = soup.select('#article-content pre > code')
    unlabeled_blocks = [block for block in code_blocks if not any(name.startswith('language-') for name in block.get('class', []))]
    if unlabeled_blocks:
        error(f'{relative_file} has {len(unlabeled_blocks)} code blocks without an explicit language label')
    if relative_file in TRACKED_LEARNING_ROUTES:
        if not soup.select_one('#article-content code.language-csharp'):
            error(f'{relative_file} has no C# implementation example')
        prefix = TRACKED_LEARNING_ROUTES[relative_file]
        checkpoints = soup.select('section[data-learning-checkpoint]')
        if len(checkpoints) != 1:
            error(f'{relative_file} expected one learning checkpoint, got {len(checkpoints)}')
        else:
            checkpoint = checkpoints[0]
            labelled_by = checkpoint.get('aria-labelledby')
            if not labelled_by or checkpoint.find(id=labelled_by) is None:
                error(f'{relative_file} checkpoint has no valid aria-labelledby target')
            expected_next_section = CHECKPOINT_FOLLOWING_SECTION.get(relative_file)
            next_section = checkpoint.find_next_sibling()
            if expected_next_section and (
                not next_section
                or next_section.name != 'h2'
                or next_section.get('id') != expected_next_section
            ):
                error(f'{relative_file} checkpoint must appear immediately before #{expected_next_section}')
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
    ('public interface IEffectExecutor', 'modules/effect-system.html', 'modules/integration-map.html'),
    ('public interface IEffectPlanner', 'modules/effect-system.html', 'modules/integration-map.html'),
    ('public interface ISkillRequestValidator', 'modules/skill-action-system.html', 'modules/integration-map.html'),
    ('public interface IStatusService', 'modules/status-system.html', 'modules/integration-map.html'),
    ('public interface IRuntimeCommitter', 'modules/runtime-reference.html', 'modules/integration-map.html'),
    ('public interface IReactionQueue', 'modules/runtime-reference.html', 'modules/integration-map.html'),
    ('public enum HitOutcome', 'modules/combat-resolution-system.html', 'modules/integration-map.html'),
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
elif 'DurationScale' in status_contract or 'SourceId' in status_contract:
    error('ApplyStatusRequest must not mix definition policy fields with the runtime request')

canonical_property_sets = [
    ('public sealed class SkillRequest', 'modules/skill-action-system.html', {'CasterId', 'SkillId', 'TargetId', 'RequestedTick', 'RootSeed'}),
    ('public sealed class SkillResult', 'modules/skill-action-system.html', {'Succeeded', 'FailureReason', 'Effects'}),
    ('public sealed class DamageResult', 'modules/combat-resolution-system.html', {'Outcome', 'Critical', 'RawDamage', 'ResolvedDamage', 'ShieldAbsorbed', 'FinalHpDamage', 'Overkill'}),
]
for declaration, file, expected_properties in canonical_property_sets:
    contract, count = extract_csharp_declaration(soups.get(ROOT/file), declaration)
    properties = set(re.findall(r'public\s+[\w<>,?\[\]]+\s+(\w+)\s*\{\s*get\s*;', contract or ''))
    if count != 1 or properties != expected_properties:
        error(f'{declaration} in {file} has properties {sorted(properties)}, expected {sorted(expected_properties)}')

canonical_skill_failures = [
    'NotLearned', 'OutOfResource', 'Cooldown',
    'ControlLocked', 'InvalidTarget', 'Interrupted',
]
skill_page_source = (soups.get(ROOT/'modules/skill-action-system.html')
                     .select_one('#article-content').get_text('\n'))
if extract_enum_members(skill_page_source, 'SkillFailureReason') != canonical_skill_failures:
    error('public SkillFailureReason differs from the canonical six reasons')

canonical_hit_outcomes = ['Hit', 'Miss', 'Blocked', 'Immune', 'Rejected']
combat_page_source = (soups.get(ROOT/'modules/combat-resolution-system.html')
                      .select_one('#article-content').get_text('\n'))
if extract_enum_members(combat_page_source, 'HitOutcome') != canonical_hit_outcomes:
    error('public HitOutcome differs from Hit/Miss/Blocked/Immune/Rejected')
for token in ('AvailableTargetHp', 'Overkill', 'ResolvedDamage = ShieldAbsorbed + FinalHpDamage + Overkill'):
    if token not in combat_page_source:
        error(f'public Combat lethal-damage contract missing {token}')

core_page_source = soups.get(ROOT/'modules/core-runtime.html').select_one('#article-content').get_text('\n')
for token in ('IsValid', 'TryCreate', 'TryValidate', 'ThrowIfInvalid', 'SourceKind.SkillExecution', 'SourceRef SkillExecution'):
    if token not in core_page_source:
        error(f'public Core contract missing canonical ID/source token: {token}')
for retired_source_shape in ('"kind": "status-instance"', '"sourceId": "status-instance'):
    if retired_source_shape in core_page_source:
        error(f'public Core JSON retains legacy SourceRef shape: {retired_source_shape}')
stat_page_source = soups.get(ROOT/'modules/stat-system.html').select_one('#article-content').get_text('\n')
if 'decimal GetValue(EntityId ownerId, EntityId statId, StatContext context)' not in stat_page_source:
    error('public IStatQuery must use strong EntityId owner/stat identifiers')
for token in ('SourceRef Source', 'EntityId StackRuleId', 'EntityId SkillId', 'ReadOnlyCollection<EntityId> TargetStatuses'):
    if token not in stat_page_source:
        error(f'public Stat model missing strong-type token: {token}')
for token in (
    'IEnumerable<string>? skillTags = null',
    'IEnumerable<string>? targetTags = null',
    'IEnumerable<EntityId>? targetStatuses = null',
    'decimal distance = 0m', 'string moment = "default"',
    'distance < 0m', 'string.IsNullOrWhiteSpace(moment)',
    'CopyTags', 'Stat context tags cannot be empty.',
):
    if token not in stat_page_source:
        error(f'public StatContext snippet missing actual contract token: {token}')
if any(token not in stat_page_source for token in ('질의 불변식', 'ownerId', 'context.OwnerId')):
    error('public Stat query must state the owner/context invariant')
status_page_source = soups.get(ROOT/'modules/status-system.html').select_one('#article-content').get_text('\n')
for token in ('EntityId StatusId', 'StatusResult Apply(ApplyStatusRequest request)', 'StatusResult Remove'):
    if token not in status_page_source:
        error(f'public Status contract missing canonical token: {token}')
for retired_policy in ('ordered_partial', 'rollback_on_failure', 'OrderedPartial', 'RollbackOnFailure'):
    if retired_policy in skill_page_source:
        error(f'public Skill page still teaches retired policy {retired_policy}')
for token in ('commit_then_react', 'StopPolicy', 'all_or_nothing'):
    if token not in skill_page_source:
        error(f'public Skill policy section missing {token}')
if 'public EntityId SkillId' not in skill_page_source or 'public string SkillId' in skill_page_source:
    error('public SkillRequest.SkillId must use EntityId')
effect_page_source = soups.get(ROOT/'modules/effect-system.html').select_one('#article-content').get_text('\n')
for token in (
    'public sealed record EffectContext',
    'EntityId CasterId', 'EntityId? InitialTargetId',
    'SourceRef Source', 'uint RandomSeed',
    'ValidEntityId(CasterId',
    'ValidOperationId(OperationId',
    'EntityId.ThrowIfInvalid(bundleId',
    'EffectBundlePlan Prepare',
):
    if token not in effect_page_source:
        error(f'public Effect contract missing canonical token: {token}')
for token in ('DamageRequest request = new(', 'SourceRef.SkillExecution', 'formulaId'):
    if token not in effect_page_source:
        error(f'public Effect DamageRequest handoff missing canonical token: {token}')
effect_page_soup = soups.get(ROOT/'modules/effect-system.html')
if effect_page_soup.select_one(
    'a[href="../source/csharp/GameSystemKnowledge.Reference/Contracts/Combat.cs"]'
) is None:
    error('public Effect DamageRequest handoff must link to the executable Combat.cs contract')
if effect_page_soup.select_one(
    'a[href="../modules/combat-resolution-system.html#csharp-combat-contracts"]'
) is None:
    error('public Effect DamageRequest handoff must link to the canonical Combat contract section')
if 'public EntityId FormulaId' not in combat_page_source or 'public string FormulaId' in combat_page_source:
    error('public Combat DamageRequest.FormulaId must use EntityId')
formula_stage = combat_page_source.find('draft = _formula.Apply')
critical_stage = combat_page_source.find('draft = _critical.Apply')
if formula_stage < 0 or critical_stage < 0 or formula_stage >= critical_stage:
    error('public Combat pipeline must calculate the formula before critical RawDamage')
public_contract_text = '\n'.join(
    soups.get(ROOT/path).select_one('#article-content').get_text('\n')
    for path in LEARNING_ROUTES
    if path != 'index.html'
)
for retired_source_token in ('StatModifier.SourceId', 'appliedBySourceId', 'modifierSourceId', '.0771'):
    if retired_source_token in public_contract_text:
        error(f'public learning content retains legacy contract token {retired_source_token}')
integration_source = soups.get(ROOT/'modules/integration-map.html').select_one('#article-content').get_text('\n')
for retired_publisher in ('SkillExecutor\nUI 로그', 'EffectExecutor\nDebugTrace', 'StatusController\n상태 아이콘'):
    if retired_publisher in integration_source:
        error(f'Integration event table retains non-commit publisher {retired_publisher!r}')
fireball_source = soups.get(ROOT/'modules/fireball-case-study.html').select_one('#article-content').get_text('\n')
fireball_trace_tokens = ('DamageCalculated trace', 'Atomic commit', 'outboxOrder=SkillCommitted → DamageCommitted')
if any(token not in fireball_source for token in fireball_trace_tokens):
    error('public Fireball trace must place calculation before the ordered atomic outbox')

fireball = soups.get(ROOT/'modules/fireball-case-study.html')
fireball_orchestration = [
    block.get_text('\n') for block in fireball.select('#article-content code.language-csharp')
    if 'FireballResult Execute' in block.get_text()
] if fireball else []
if len(fireball_orchestration) != 1:
    error(f'Fireball orchestration expected once, got {len(fireball_orchestration)}')
elif ('_effectPlanner.Prepare' not in fireball_orchestration[0]
      or 'release.EffectBundle' not in fireball_orchestration[0]
      or '_commitPlanFactory.Compose' not in fireball_orchestration[0]
      or '_runtimeCommitter.Commit' not in fireball_orchestration[0]
      or '_reactionQueue.Enqueue' not in fireball_orchestration[0]
      or '_effects.Execute' in fireball_orchestration[0]
      or '_combat.Resolve' in fireball_orchestration[0]):
    error('Fireball orchestration must prepare one atomic commit and enqueue post-commit reactions')

status = soups.get(ROOT/'modules/status-system.html')
status_tick_examples = [
    block.get_text('\n') for block in status.select('#article-content code.language-csharp')
    if 'AdvanceInstance' in block.get_text()
] if status else []
if len(status_tick_examples) != 1:
    error(f'Status tick example expected once, got {len(status_tick_examples)}')
elif (any(token not in status_tick_examples[0] for token in ('MaxCatchUpTicks', 'RecordCatchUpLimit', 'StatusRemoveReason.CatchUpLimited'))):
    error('Status tick example must enforce, trace, and classify the per-instance catch-up limit')
else:
    for token in ('BuildTickPlan', 'CommitPlan', '_runtimeCommitter.Commit', 'BuildRemovalPlan'):
        if token not in status_tick_examples[0]:
            error(f'Status tick example missing atomic planning token: {token}')
    for retired_tick_mutation in ('_effects.Execute', 'ScheduleNextTick()', 'Remove(status.InstanceId'):
        if retired_tick_mutation in status_tick_examples[0]:
            error(f'Status tick example directly mutates before commit: {retired_tick_mutation}')

home = soups.get(ROOT/'index.html')
if home:
    panels = home.select('section[data-learning-progress]')
    if len(panels) != 1:
        error(f'index.html expected one learning progress panel, got {len(panels)}')
    else:
        panel = panels[0]
        meter = panel.select_one('progress[data-learning-progress-meter]')
        if not meter or meter.get('max') != '9' or meter.get('value') != '0' or not meter.get('aria-label'):
            error('index.html learning progress meter requires max=9, value=0, and an accessible label')
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
    learning_path_hrefs = {
        item.get('href') for item in home.select('.learn-flow a[href]')
    }
    for required_path in (
        'modules/integration-map.html',
        'modules/fireball-case-study.html',
        'modules/runtime-reference.html',
    ):
        if required_path not in learning_path_hrefs:
            error(f'index.html learning path omits {required_path}')

# Diagram parity.
dots = sorted((ROOT/'source/diagrams').glob('*.dot'))
svgs = sorted((ROOT/'assets/diagrams').glob('*.svg'))
pngs = sorted((ROOT/'assets/diagrams').glob('*.png'))
if (len(dots),len(svgs),len(pngs)) != (34,34,34): error(f'diagram parity expected 34/34/34, got {len(dots)}/{len(svgs)}/{len(pngs)}')
for dot in dots:
    if not (ROOT/'assets/diagrams'/f'{dot.stem}.svg').exists(): error(f'missing SVG for {dot.name}')
    if not (ROOT/'assets/diagrams'/f'{dot.stem}.png').exists(): error(f'missing PNG for {dot.name}')
    diagram_text = dot.read_text(encoding='utf-8')
    if 'Noto Sans CJK KR' in diagram_text or 'Noto Sans KR' not in diagram_text:
        error(f'{dot.relative_to(ROOT)} must use the reproducible Noto Sans KR font family')
    if 'splines=ortho' in diagram_text and re.search(r'(?m)^\s*[^/\n]+->[^\n]+\blabel\s*=', diagram_text):
        error(f'{dot.relative_to(ROOT)} combines splines=ortho with edge labels')
    edge_counts = {}
    for line in diagram_text.splitlines():
        for statement in line.split('//', 1)[0].split(';'):
            chain = re.match(
                r'^\s*([A-Za-z_][\w]*(?::\w+)?(?:\s*->\s*[A-Za-z_][\w]*(?::\w+)?)+)',
                statement,
            )
            if not chain:
                continue
            node_ids = re.findall(r'([A-Za-z_][\w]*)(?::\w+)?', chain.group(1))
            for tail, head in zip(node_ids, node_ids[1:]):
                edge_counts[(tail, head)] = edge_counts.get((tail, head), 0) + 1
    duplicates = [f'{tail}->{head}' for (tail, head), count in edge_counts.items() if count > 1]
    if duplicates:
        error(f'{dot.relative_to(ROOT)} repeats directed edges: {duplicates}')
for diagram_path in dots + svgs:
    diagram_text = diagram_path.read_text(encoding='utf-8')
    if diagram_path.suffix == '.svg' and 'font-family="Noto Sans KR"' not in diagram_text:
        error(f'{diagram_path.relative_to(ROOT)} is stale or was rendered with the wrong font family')
    for label, pattern in PUBLIC_CONTENT_PATTERNS.items():
        if pattern.search(diagram_text):
            error(f'{diagram_path.relative_to(ROOT)} retains {label}')

diagram_contract_requirements = {
    'source/diagrams/03_component_diagram.dot': (
        'Stat Mutation Commit', 'state + outbox atomic', 'committed facts',
    ),
    'source/diagrams/04_calculation_activity_diagram.dot': (
        'filter expired without mutation', 'Return StatValue',
    ),
    'source/diagrams/06_modifier_application_sequence_diagram.dot': (
        'RuntimeCommitter', 'pure query', 'no domain event',
    ),
    'source/diagrams/08_stat_effect_system_map.dot': (
        'RuntimeCommitter', 'Committed Facts Bus', 'ReactionQueue',
    ),
    'source/diagrams/09_effect_component_diagram.dot': (
        'IEffectPlanner', 'EffectBundlePlan', 'RuntimeCommitter', 'ReactionQueue',
    ),
    'source/diagrams/10_effect_core_class_diagram.dot': (
        'IEffectExecutor', 'EffectBundleResult', 'IEffectOperationExecutor',
        'IEffectPlanner', 'EffectBundlePlan', 'DefinitionNormalizer',
        'EffectOperation', 'CommitThenReact', 'EffectResult',
    ),
    'source/diagrams/11_effect_execution_sequence_diagram.dot': (
        'RuntimeCommitter', '원자적 commit', 'ReactionQueue',
    ),
    'source/diagrams/13_effect_data_model_diagram.dot': (
        'primaryEffectIds[]', 'reactionIds[]', 'commit_then_react',
        'stableOrderKey', 'idempotencyKey',
    ),
    'source/diagrams/14_effect_lifecycle_state_diagram.dot': (
        'Planning', 'Prepared', 'Atomic Commit', 'Reaction Queued',
    ),
    'source/diagrams/15_fireball_effect_integration_diagram.dot': (
        'Mana 20', 'explicit single target', 'CommitThenReact', 'base 24',
        'spellPower 120', 'RuntimeCommitter', 'SkillCommitted', 'DamageCommitted', 'outbox #1', 'outbox #2', 'ReactionQueue',
        'duration 6', 'tick interval 2',
    ),
    'source/diagrams/16_core_runtime_component_diagram.dot': (
        'RuntimeCommitter', 'Durable Outbox', 'ReactionQueue',
    ),
    'source/diagrams/17_skill_core_class_diagram.dot': (
        'SkillExecution', 'PrepareRelease', 'read snapshot / plan mutation',
    ),
    'source/diagrams/18_skill_lifecycle_state_diagram.dot': (
        'SkillRuntime', 'SkillExecution', 'ISkillRequestValidator.Validate',
        'SkillReleasePlan', 'RuntimeCommitter',
    ),
    'source/diagrams/19_skill_execution_sequence_diagram.dot': (
        'ISkillRequestValidator.Validate', 'SkillReleasePlan',
        'IEffectPlanner.Prepare', 'RuntimeCommitter', 'Committed facts',
        'ReactionQueue', 'SkillResult',
    ),
    'source/diagrams/20_skill_timeline_activity_diagram.dot': (
        'CostPolicy.PayTiming', 'IEffectPlanner.Prepare', 'RuntimeCommitter', 'ReactionQueue',
    ),
    'source/diagrams/21_skill_data_model_diagram.dot': (
        'SkillMutation', 'SkillReleasePlan', 'EffectBundlePlan',
        'CommitPlan', 'CommitReceipt',
    ),
    'source/diagrams/22_combat_core_class_diagram.dot': (
        'Outcome: HitOutcome', 'Blocked', 'BlockPolicy', 'ICombatResolver', 'RuntimeCommitter',
        'AvailableTargetHp', 'Overkill',
    ),
    'source/diagrams/23_damage_resolution_activity_diagram.dot': (
        'Hit or Blocked?', 'BlockPolicy', 'Miss · Immune · Rejected', 'no HP/Shield mutation',
        'AvailableTargetHp', 'Overkill',
    ),
    'source/diagrams/24_damage_execution_sequence_diagram.dot': (
        'pure calculation', 'Outcome', 'Overkill', 'RuntimeCommitter', 'ReactionQueue',
    ),
    'source/diagrams/25_combat_data_model_diagram.dot': (
        'Outcome: HitOutcome', 'AvailableTargetHp', 'Overkill', 'CommitReceipt', 'same transaction',
    ),
    'source/diagrams/28_status_apply_sequence_diagram.dot': (
        'StatusCommitPlan', 'RuntimeCommitter', 'state + outbox atomic',
    ),
    'source/diagrams/29_status_tick_activity_diagram.dot': (
        'MaxCatchUpTicks', 'CatchUpLimited', 'trace dropped ticks', 'next advance',
        'ICombatResolver.Resolve', 'Tick CommitPlan', 'RuntimeCommitter.Commit once',
    ),
    'source/diagrams/30_status_data_model_diagram.dot': (
        'MaxCatchUpTicks', 'modifierSourceRef=SourceRef.Status',
    ),
    'source/diagrams/38_full_framework_dependency_map.dot': (
        'Line meaning', 'RuntimeCommitter', 'ReactionQueue', 'ApplyStatus command',
    ),
    'source/diagrams/39_runtime_ports_and_adapters.dot': (
        'atomic state / outbox', 'Runtime Kernel',
    ),
    'source/diagrams/40_resolve_commit_reaction_sequence.dot': (
        'state + outbox + processed command', 'Committed Facts Dispatch',
    ),
}
for relative_path, required_tokens in diagram_contract_requirements.items():
    diagram_text = (ROOT/relative_path).read_text(encoding='utf-8')
    missing = [token for token in required_tokens if token not in diagram_text]
    if missing:
        error(f'{relative_path} missing contract labels: {missing}')
    rendered_svg = ROOT/'assets/diagrams'/f'{Path(relative_path).stem}.svg'
    rendered_text = rendered_svg.read_text(encoding='utf-8')
    rendered_missing = [token for token in required_tokens if token not in rendered_text]
    if rendered_missing:
        error(f'{rendered_svg.relative_to(ROOT)} is stale or missing labels: {rendered_missing}')

gallery = soups.get(ROOT/'modules/diagram-gallery.html')
if gallery:
    gallery_path = ROOT/'modules/diagram-gallery.html'
    gallery_cards = gallery.select('.gallery .thumb')
    gallery_stems = []
    for index, card in enumerate(gallery_cards, start=1):
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
        if image:
            gallery_stems.append(Path(unquote(image['src'].split('?', 1)[0])).stem)
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
    expected_stems = {dot.stem for dot in dots}
    actual_stems = set(gallery_stems)
    if len(gallery_cards) != len(dots):
        error(f'diagram gallery expected {len(dots)} cards, got {len(gallery_cards)}')
    if len(gallery_stems) != len(actual_stems):
        error('diagram gallery contains duplicate diagram cards')
    missing_stems = sorted(expected_stems - actual_stems)
    extra_stems = sorted(actual_stems - expected_stems)
    if missing_stems: error(f'diagram gallery omits assets: {missing_stems}')
    if extra_stems: error(f'diagram gallery references unknown assets: {extra_stems}')

# Runtime artifacts.
kernel_source = ROOT/'source/runtime/runtime-kernel.js'
kernel_browser = ROOT/'assets/js/runtime-kernel.js'
if kernel_source.read_bytes() != kernel_browser.read_bytes(): error('browser/source runtime kernels are not byte-identical')
capstone_source = ROOT/'source/runtime/capstone-assessor.js'
capstone_browser = ROOT/'assets/js/capstone-assessor.js'
if not capstone_source.is_file() or not capstone_browser.is_file():
    error('capstone assessor source/browser artifacts are missing')
elif capstone_source.read_bytes() != capstone_browser.read_bytes():
    error('browser/source capstone assessors are not byte-identical')
else:
    capstone_text = capstone_source.read_text(encoding='utf-8')
    for token in (
        "CHALLENGE_ID = 'chain-lightning-shock.v1'", 'PASS_SCORE = 80',
        'assessCombatCapstone', 'runDesignProbes', 'DIMENSION_MINIMUMS',
        'resolve-mutation', 'unbounded-target-selection', 'missing-version-preconditions', 'duplicate-command-policy',
        'order-dependent-rng', 'reaction-rolls-back-primary', 'indirect-causation',
        'broken-status-provenance', 'ambiguous-status-time',
        'deterministic-reaction-order', 'retainedReactionIdempotencyKeys',
        'REACTION_WAVE_LIMIT_EXCEEDED', 'BUDGET_EXCEEDED',
        'contractSchemaVersion', 'replayFormatVersion', 'dataVersion',
        'targetOrderPolicyVersion',
    ):
        if token not in capstone_text:
            error(f'capstone assessor missing contract token: {token}')
    if re.search(r'\beval\s*\(|new\s+Function\b', capstone_text):
        error('capstone assessor must not execute learner-authored code')
    if 'createReferenceSubmission' in capstone_text:
        error('capstone assessor must not expose or embed a completed-answer generator')
kernel_text = kernel_source.read_text(encoding='utf-8')
for token in ('SOURCE_KINDS', 'HIT_OUTCOMES', "hitOutcome = 'Hit'", "? 'Hit' : 'Miss'"):
    if token not in kernel_text:
        error(f'runtime kernel missing HitOutcome contract token: {token}')
if re.search(r'outcome\.hit(?!Outcome)', kernel_text):
    error('runtime kernel still exposes a boolean hit result')
if 'finalHpDamage' not in kernel_text or re.search(r'\bhpDamage\b', kernel_text):
    error('runtime kernel must expose finalHpDamage consistently')
for token in (
    'validateCommandEnvelope', 'validateCommitPlan', 'validateInitialState',
    'parseCommandEnvelope', 'parseDomainEventEnvelope',
    'OUTBOX_STATE_VALIDATORS', 'validateTruthfulOutbox', 'OUTBOX_FACT_MISMATCH',
    '#state', '#processedCommands', '#outbox', '#isCommitting',
    'STORE_CLOCK_ADVANCERS', 'Object.preventExtensions(this)',
    '#isRecordingTrace', 'REACTION_TRACE_SIDE_EFFECT', 'STATUS_TIME_REGRESSION',
    'STATUS_PROVENANCE_MISMATCH', 'SOURCE_IDENTITY_MISMATCH',
    'defineDataProperty', 'integer-bps-half-away-from-zero-v1', 'Object.is(rounded, -0)',
    'RNG_KEY_SCHEMA_VERSION', 'CLOCK_DOMAIN',
):
    if token not in kernel_text:
        error(f'runtime kernel missing hardened public-boundary token: {token}')
contracts = sorted((ROOT/'source/contracts').glob('*.schema.json'))
adrs = sorted((ROOT/'source/adr').glob('ADR-*.md'))
required_contracts = {
    'command-envelope.schema.json',
    'commit-plan.schema.json',
    'domain-event-envelope.schema.json',
    'replay-fixture.schema.json',
    'source-ref.schema.json',
    'versioned-document.schema.json',
    'combat-capstone-submission.schema.json',
}
contract_names = {item.name for item in contracts}
if required_contracts - contract_names:
    error(f'missing contract schemas: {sorted(required_contracts-contract_names)}')
capstone_contract_path = ROOT/'source/contracts/combat-capstone-submission.schema.json'
if capstone_contract_path.is_file():
    capstone_contract = json.loads(capstone_contract_path.read_text(encoding='utf-8'))
    capstone_root_fields = {'schemaVersion', 'challengeId', 'ownership', 'resolve', 'commit', 'reaction', 'status', 'replay', 'scenarios'}
    if capstone_contract.get('additionalProperties') is not False:
        error('capstone submission schema must reject unknown top-level fields')
    if set(capstone_contract.get('required', [])) != capstone_root_fields:
        error('capstone submission schema required fields differ from the assessor contract')
    capstone_contract_text = json.dumps(capstone_contract, ensure_ascii=False)
    tick_offsets_contract = capstone_contract.get('properties', {}).get('status', {}).get('properties', {}).get('tickOffsets', {})
    if tick_offsets_contract.get('maxItems') != 8 or tick_offsets_contract.get('uniqueItems') is not True:
        error('capstone tickOffsets schema must match the assessor maximum and uniqueness rules')
    for token in (
        'reject-request', 'keyed-per-target', 'state-and-outbox-atomic',
        'keep-primary-and-dispatched-discard-undispatched-diagnostic-trace',
        'new-command-and-idempotency-keys-or-explicit-operator-policy',
        'last-transition-event', 'damage-tick-expire-status-remove-atomic',
        'targetOrderPolicyVersion', 'rollback-primary', 'sequential-consumption',
    ):
        if token not in capstone_contract_text:
            error(f'capstone submission schema missing discoverable candidate token: {token}')
if len(adrs) != 5: error(f'expected 5 ADRs, got {len(adrs)}')
for envelope_name in ('command-envelope.schema.json', 'domain-event-envelope.schema.json'):
    envelope_schema = json.loads((ROOT/'source/contracts'/envelope_name).read_text(encoding='utf-8'))
    if envelope_schema.get('additionalProperties') is not False:
        error(f'{envelope_name} must reject unknown top-level fields')
    if envelope_schema.get('properties', {}).get('schemaVersion', {}).get('const') != 1:
        error(f'{envelope_name} must accept only schemaVersion 1')
commit_plan_schema = json.loads((ROOT/'source/contracts/commit-plan.schema.json').read_text(encoding='utf-8'))
canonical_plan_fields = {'schemaVersion', 'planId', 'commandId', 'commitTick', 'preconditions', 'operations', 'eventBlueprints'}
if set(commit_plan_schema.get('required', [])) != canonical_plan_fields:
    error('CommitPlan schema required fields differ from the runtime contract')
if commit_plan_schema.get('additionalProperties') is not False:
    error('CommitPlan schema must reject unknown top-level fields')
if commit_plan_schema.get('properties', {}).get('schemaVersion', {}).get('const') != 1:
    error('CommitPlan schema must accept only schemaVersion 1')
operation_variants = commit_plan_schema.get('$defs', {}).get('operation', {}).get('oneOf', [])
if len(operation_variants) != 5:
    error('CommitPlan schema must define five canonical operation variants')
status_add_variants = [
    item for item in operation_variants
    if item.get('properties', {}).get('kind', {}).get('const') == 'status.add'
]
if not status_add_variants or status_add_variants[0].get('properties', {}).get('status', {}).get('$ref') != '#/$defs/statusInstance':
    error('CommitPlan status.add must reference the canonical StatusInstance schema')
source_ref_schema = json.loads((ROOT/'source/contracts/source-ref.schema.json').read_text(encoding='utf-8'))
if 'instanceId' in source_ref_schema.get('required', []):
    error('SourceRef schema must allow a System source without instanceId')
if not source_ref_schema.get('allOf'):
    error('SourceRef schema must conditionally require instanceId for skill/status sources')
reaction_adr = (ROOT/'source/adr/ADR-003-bounded-reaction-queue.md').read_text(encoding='utf-8')
if '오름차순' not in reaction_adr or '낮은 priority' not in reaction_adr:
    error('ADR-003 must define ascending numeric priority order')
runtime_fixtures = sorted((ROOT/'source/runtime/fixtures').glob('*.json'))
for item in contracts + runtime_fixtures:
    try:
        payload = json.loads(item.read_text(encoding='utf-8'))
        if item in runtime_fixtures:
            for json_path, identifier in walk_json_ids(payload):
                error(f'{item.relative_to(ROOT)} has non-canonical ID {json_path}={identifier!r}')
    except Exception as exc:
        error(f'invalid JSON {item.relative_to(ROOT)}: {exc}')
golden = json.loads((ROOT/'source/runtime/fixtures/fireball-golden-v1.json').read_text(encoding='utf-8'))
golden_outcome = golden.get('expected', {}).get('outcome', {})
if golden_outcome.get('hitOutcome') != 'Hit' or 'hit' in golden_outcome:
    error('Fireball golden fixture must use canonical hitOutcome instead of a hit boolean')
if golden_outcome.get('finalHpDamage') != 162 or 'hpDamage' in golden_outcome:
    error('Fireball golden fixture must use canonical finalHpDamage=162')
try:
    golden_input = golden['input']
    golden_expected = golden['expected']
    golden_target_id = golden_input['target']['id']
    golden_formula_damage = (
        golden_input['skill']['baseDamage'] +
        (golden_input['caster']['spellPower'] *
         golden_input['skill']['coefficientBps'] + 5_000) // 10_000
    )
    golden_tick_damage = (
        golden_outcome['burn']['rawTickDamage'] *
        (10_000 - golden_input['target']['fireResistanceBps']) + 5_000
    ) // 10_000
    fireball_golden_markers = {
        'formulaDamage': golden_formula_damage,
        'rawDamage': golden_outcome['rawDamage'],
        'resolvedDamage': golden_outcome['resolvedDamage'],
        'shieldAbsorbed': golden_outcome['shieldAbsorbed'],
        'finalHpDamage': golden_outcome['finalHpDamage'],
        'rawTickDamage': golden_outcome['burn']['rawTickDamage'],
        'resolvedTickDamage': golden_tick_damage,
        'finalTargetHp': golden_expected['finalState']['entities'][golden_target_id]['resources']['hp'],
    }
except (KeyError, TypeError, ValueError) as exc:
    error(f'Fireball golden fixture cannot produce public markers: {exc}')
else:
    for marker, value in fireball_golden_markers.items():
        if not re.search(rf'\b{re.escape(marker)}\s*=\s*{value}\b', fireball_source):
            error(f'public Fireball marker {marker} must match golden value {value}')
runtime_types = (ROOT/'source/runtime/runtime-kernel.d.ts').read_text(encoding='utf-8')
if "hitOutcome: 'Hit' | 'Miss' | 'Blocked' | 'Immune' | 'Rejected'" not in runtime_types:
    error('runtime declarations must expose the canonical HitOutcome union')
if runtime_types.count("hitOutcome: 'Hit' | 'Miss' | 'Blocked' | 'Immune' | 'Rejected'") < 2:
    error('runtime declarations must expose hitOutcome on resolved and committed damage')
if "readonly kind: 'system'" not in runtime_types or 'readonly instanceId?: NamespacedId' not in runtime_types:
    error('runtime declarations must allow System SourceRef to omit instanceId')
if 'finalHpDamage: number' not in runtime_types or re.search(r'\bhpDamage\b', runtime_types):
    error('runtime declarations must expose finalHpDamage consistently')
for token in (
    'export interface CommitPlan', 'readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION',
    'export interface CommandEnvelopeInput', 'export interface DomainEventEnvelopeInput',
    'parseCommandEnvelope', 'parseDomainEventEnvelope', 'targetShieldAfter: number',
    'plan: CommitPlan', 'ReadonlyArray<Readonly<DomainEventEnvelope>>',
    'readonly pending: ReadonlyArray<Readonly<Required<Reaction>>>',
    'RNG_KEY_SCHEMA_VERSION', "CLOCK_DOMAIN: 'simulation_tick'",
):
    if token not in runtime_types:
        error(f'runtime declarations missing hardened contract token: {token}')

# Buildable C# reference must mirror the public canonical contracts.
csharp_root = ROOT/'source/csharp'
required_csharp_files = {
    'GameSystemKnowledge.Reference/GameSystemKnowledge.Reference.csproj',
    'GameSystemKnowledge.Reference/Contracts/Identifiers.cs',
    'GameSystemKnowledge.Reference/Contracts/Stats.cs',
    'GameSystemKnowledge.Reference/Contracts/Effects.cs',
    'GameSystemKnowledge.Reference/Contracts/Status.cs',
    'GameSystemKnowledge.Reference/Contracts/Skills.cs',
    'GameSystemKnowledge.Reference/Contracts/Combat.cs',
    'GameSystemKnowledge.Reference/Runtime/Commit.cs',
    'GameSystemKnowledge.Reference/Systems/CombatResolver.cs',
    'GameSystemKnowledge.Reference/Systems/DictionaryStatQuery.cs',
    'GameSystemKnowledge.Reference/Systems/FireballReferenceScenario.cs',
    'GameSystemKnowledge.Reference/Systems/StatusCatchUpPolicy.cs',
    'GameSystemKnowledge.Reference.Verification/GameSystemKnowledge.Reference.Verification.csproj',
    'GameSystemKnowledge.Reference.Verification/Program.cs',
}
missing_csharp = sorted(
    relative for relative in required_csharp_files
    if not (csharp_root/relative).is_file()
)
if missing_csharp:
    error(f'missing C# reference files: {missing_csharp}')
else:
    identifier_source = (csharp_root/'GameSystemKnowledge.Reference/Contracts/Identifiers.cs').read_text(encoding='utf-8')
    stat_source = (csharp_root/'GameSystemKnowledge.Reference/Contracts/Stats.cs').read_text(encoding='utf-8')
    effect_source = (csharp_root/'GameSystemKnowledge.Reference/Contracts/Effects.cs').read_text(encoding='utf-8')
    status_source = (csharp_root/'GameSystemKnowledge.Reference/Contracts/Status.cs').read_text(encoding='utf-8')
    skill_source = (csharp_root/'GameSystemKnowledge.Reference/Contracts/Skills.cs').read_text(encoding='utf-8')
    combat_source = (csharp_root/'GameSystemKnowledge.Reference/Contracts/Combat.cs').read_text(encoding='utf-8')
    commit_source = (csharp_root/'GameSystemKnowledge.Reference/Runtime/Commit.cs').read_text(encoding='utf-8')
    resolver_source = (csharp_root/'GameSystemKnowledge.Reference/Systems/CombatResolver.cs').read_text(encoding='utf-8')
    scenario_source = (csharp_root/'GameSystemKnowledge.Reference/Systems/FireballReferenceScenario.cs').read_text(encoding='utf-8')
    catch_up_source = (csharp_root/'GameSystemKnowledge.Reference/Systems/StatusCatchUpPolicy.cs').read_text(encoding='utf-8')
    verifier_source = (csharp_root/'GameSystemKnowledge.Reference.Verification/Program.cs').read_text(encoding='utf-8')
    for declaration in (
        'public readonly record struct EntityId',
        'public enum SourceKind',
        'public readonly record struct SourceRef',
    ):
        public_contract, public_count = extract_csharp_declaration(
            soups.get(ROOT/'modules/core-runtime.html'),
            declaration,
        )
        source_contract, source_count = extract_csharp_declaration_from_source(
            identifier_source,
            declaration,
        )
        if public_count != 1 or source_count != 1 or public_contract != source_contract:
            error(f'public Core {declaration} must exactly match Contracts/Identifiers.cs')
    for token in ('SourceKind.SkillExecution', 'SourceRef SkillExecution', 'instanceId is null'):
        if token not in identifier_source:
            error(f'C# identifier contract missing {token}')
    if extract_enum_members(stat_source, 'ModifierOperation') != ['Add', 'PercentAdd', 'More', 'Less', 'Override']:
        error('C# reference ModifierOperation differs from the public five-stage contract')
    for token in (
        'EntityId statId', 'EntityId ModifierId', 'EntityId StatId', 'SourceRef Source',
        'IEnumerable<string>? skillTags = null',
        'IEnumerable<string>? targetTags = null',
        'IEnumerable<EntityId>? targetStatuses = null',
        'decimal distance = 0m', 'string moment = "default"',
        'distance < 0m', 'string.IsNullOrWhiteSpace(moment)',
        'CopyTags', 'Stat context tags cannot be empty.',
    ):
        if token not in stat_source:
            error(f'C# Stat contract missing {token}')
    for token in (
        'EntityId CasterId', 'EntityId? InitialTargetId',
        'SourceRef Source', 'uint RandomSeed', 'ReactionBudget',
        'if (maxBudget <= 0)',
        'ValidEntityId(CasterId',
        'private static EntityId ValidOperationId',
        'EntityId.ThrowIfInvalid(bundleId',
        'ValidSource(Source',
        'public interface IEffectExecutor', 'EffectOperationResult Execute',
        'EffectBundleResult Execute', 'public interface IEffectPlanner',
        'EffectBundlePlan Prepare',
    ):
        if token not in effect_source:
            error(f'C# Effect contract missing {token}')
    for token in ('EntityId StatusId', 'StatusResult Apply', 'StatusResult Remove', 'void AdvanceTo'):
        if token not in status_source:
            error(f'C# Status contract missing {token}')
    if extract_enum_members(skill_source, 'SkillFailureReason') != canonical_skill_failures:
        error('C# reference SkillFailureReason differs from the public enum')
    for token in ('public interface ISkillRequestValidator', 'SkillDecision Validate', 'public sealed class SkillResult'):
        if token not in skill_source:
            error(f'C# Skill contract missing {token}')
    if extract_enum_members(combat_source, 'HitOutcome') != canonical_hit_outcomes:
        error('C# reference HitOutcome differs from the public enum')
    for token in ('Outcome', 'Critical', 'RawDamage', 'ResolvedDamage', 'ShieldAbsorbed', 'FinalHpDamage', 'Overkill', 'AvailableTargetHp'):
        if f'public ' not in combat_source or token not in combat_source:
            error(f'C# reference DamageResult missing {token}')
    for token in (
        'command.fireball.cast.0001', 'entity.caster', 'entity.target',
        'combat.fire.v3', 'effect.fireball-damage', 'baseValue: 24',
        'scalingStatValue: 120m', 'Spend 20 mana', 'CommitThenReact',
        'SourceRef.SkillExecution', 'SkillCommitted', 'DamageCommitted',
        'effect.apply-burn', 'RequiresTargetAlive', 'TargetHpAfter',
        'TargetShieldResourceId',
    ):
        if token not in scenario_source:
            error(f'C# Fireball reference missing canonical fixture token: {token}')
    for token in (
        'VersionedResourceState', 'StateMutation', 'OutboxEvents',
        'CommittedOutboxEvent', 'GetValue', 'GetOutbox',
        'if (sequence <= 0)', 'CommitReceipt Committed(', 'CommitReceipt Empty(',
        'public interface IRuntimeCommitter', 'CommitReceipt Commit(CommitPlan plan)',
        'DeterministicBoundedReactionQueue', 'OrderBy(item => item.Priority)',
        'StableOrderKey', 'IdempotencyKey', 'BudgetCost', '_maxBudget',
        '_activeAcceptedCount', '_activeAcceptedBudget',
        'A reaction causation wave cannot be drained recursively',
        '_pending.Clear()', 'ValidatePostState', 'TargetShieldAfter',
        'ValidateContract', 'EntityId.ThrowIfInvalid(CasterId',
        'EntityId.ThrowIfInvalid(AttackerId',
        'must match the committed target shield resource',
    ):
        if token not in commit_source:
            error(f'C# runtime commit contract missing {token}')
    if 'RawDamage is the value entering mitigation' not in resolver_source:
        error('C# CombatResolver does not document post-critical RawDamage semantics')
    for token in ('long currentTick', 'long expiresAtTick', 'dueTickCount > maxCatchUpTicks'):
        if token not in catch_up_source:
            error(f'C# status catch-up policy missing tick contract token: {token}')
    if 'DateTimeOffset' in catch_up_source:
        error('C# status catch-up policy must use simulation ticks, not wall-clock time')
    for token in (
        'PASS:', '61_710u', 'HitOutcome.Blocked', 'DuplicateCommand',
        'CatchUpLimited', 'state and both outbox facts are stored together',
        'ascending priority and stable order key determine dispatch order',
        'lethal damage does not apply Burn to a dead target',
        'lethal damage is capped by available target HP',
        'post-shield damage beyond target HP becomes overkill',
        'expired status closes even within the cap',
        'reactions enqueued by dispatch stay in the same causation wave',
        'budget-exhausted work is discarded instead of deferred',
        'dispatch exceptions are surfaced to the caller',
        'effect plan requires at least one primary operation',
        'skill result keeps immutable effect results',
        'effect context rejects a default caster ID',
        'effect operation rejects a default operation ID',
        'effect bundle result rejects a default bundle ID',
        'invalidOutboxEvents', 'damage fact attacker',
        'damage fact shield resource',
    ):
        if token not in verifier_source:
            error(f'C# verifier missing contract assertion token: {token}')
    package = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))
    scripts = package.get('scripts', {})
    qa_runner = ROOT/'source/tools/run_qa.py'
    qa_runner_source = qa_runner.read_text(encoding='utf-8') if qa_runner.is_file() else ''
    if (
        'csharp:verify' not in scripts or
        'source/tools/run_qa.py' not in scripts.get('qa', '') or
        'csharp:verify' not in qa_runner_source
    ):
        error('package scripts must run the C# verifier as part of qa')

runtime_page = next((page for page in pages if page['file'] == 'modules/runtime-reference.html'), None)
runtime = soups.get(ROOT/runtime_page['file']) if runtime_page else None
required = [
    '[data-runtime-lab]', '[data-runtime-form]', '[data-runtime-check="duplicate"]',
    '[data-runtime-check="conflict"]', '[data-runtime-check="rollback"]',
    '[data-runtime-cache-probe]', '[data-runtime-migration-probe]',
    '#middle-capstone', '[data-capstone-rubric]', '[data-capstone-lab]',
    '[data-capstone-editor]', '[data-capstone-assess]', '[data-capstone-reset]',
    '[data-capstone-gate="normal"]', '[data-capstone-gate="edge"]',
    '[data-capstone-gate="failure"]', '[data-capstone-evidence]', '[data-capstone-feedback]',
]
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
    probe_cards = runtime.select('.probe-card')
    if len(probe_cards) != 3:
        error(f'runtime page expected three explanatory probe cards, got {len(probe_cards)}')
    else:
        for index, card in enumerate(probe_cards, start=1):
            card_text = card.get_text(' ', strip=True)
            for label in ('예상 결과', '왜 유지해야 하나', '확인할 점'):
                if label not in card_text:
                    error(f'runtime probe card {index} missing {label}')
    source_links = runtime.select('#csharp-reference-source ~ .source-card-grid a[href*="../source/csharp/"]')
    if len(source_links) != 9:
        error(f'runtime page expected nine discoverable C# source links, got {len(source_links)}')
    runtime_text = runtime.select_one('#article-content').get_text('\n')
    verification_command = (
        'dotnet run --project '
        'source/csharp/GameSystemKnowledge.Reference.Verification/'
        'GameSystemKnowledge.Reference.Verification.csproj'
    )
    if verification_command not in runtime_text:
        error('runtime page must include the exact C# verification command')
    migration_heading = runtime.select_one('#migration-lab')
    migration_callout = migration_heading.find_previous_sibling() if migration_heading else None
    if not migration_callout or '선택 학습 · Advanced' not in migration_callout.get_text(' ', strip=True):
        error('runtime migration lab must be framed as optional Advanced learning')
    for token in (
        'Executable assessor, conceptual gameplay', 'production multi-target runtime',
        '정상·경계·실패 gate 모두 PASS', 'Critical 0개', '각 차원 최소 80%',
        'Junior → Middle', 'target:*', 'wildcard ID', '비영속 diagnostic',
        'contractSchemaVersion', 'replayFormatVersion', 'dataVersion', 'targetOrderPolicyVersion',
    ):
        if token not in runtime_text:
            error(f'runtime capstone missing evidence or pass-boundary token: {token}')
    rubric_points = []
    for row in runtime.select('[data-capstone-rubric] tbody tr'):
        cells = row.select('th, td')
        if len(cells) >= 2:
            match = re.search(r'\d+', cells[1].get_text(' ', strip=True))
            if match: rubric_points.append(int(match.group(0)))
    if rubric_points != [15, 20, 20, 20, 15, 10] or sum(rubric_points) != 100:
        error(f'runtime capstone rubric must expose canonical 100-point weights, got {rubric_points}')
    if '기준안 불러오기' in runtime_text or '정답 불러오기' in runtime_text:
        error('runtime capstone must not expose a one-click completed answer')
    schema_links = runtime.select('a[href="../source/contracts/combat-capstone-submission.schema.json"]')
    if len(schema_links) < 2:
        error('runtime capstone must link the candidate-token schema from its guide and editor help')
    scripts=[tag.get('src') for tag in runtime.select('script[src]')]
    if '../assets/js/runtime-kernel.js' not in scripts: error('runtime page does not load browser kernel')
    if '../assets/js/capstone-assessor.js' not in scripts: error('runtime page does not load capstone assessor')
    expected_runtime_scripts = ['../assets/js/runtime-kernel.js', '../assets/js/capstone-assessor.js', '../assets/js/app.js']
    runtime_script_positions = [scripts.index(item) for item in expected_runtime_scripts if item in scripts]
    if len(runtime_script_positions) == 3 and runtime_script_positions != sorted(runtime_script_positions):
        error('runtime page must load kernel, capstone assessor, then app')

glossary = soups.get(ROOT/'modules/glossary.html')
runtime_glossary_ids = {
    'idempotency', 'outbox', 'optimistic-version', 'context-fingerprint',
    'stable-order-key', 'replay-envelope', 'invariant',
    'correlation-causation', 'runtime-snapshot', 'atomic-commit-glossary',
    'reaction-queue', 'bps', 'clock-domain', 'stop-policy',
}
if glossary:
    missing_terms = sorted(term for term in runtime_glossary_ids if glossary.find(id=term) is None)
    if missing_terms:
        error(f'glossary missing Runtime contract terms: {missing_terms}')
    glossary_text = glossary.select_one('#article-content').get_text('\n')
    for retired_glossary_token in ('Operation과 SourceId', 'C# 식별자 타입 EntityId SourceId'):
        if retired_glossary_token in glossary_text:
            error(f'glossary retains legacy source contract: {retired_glossary_token}')
    if 'System은 생략할 수 있다' not in glossary_text:
        error('glossary must explain optional System SourceRef instanceId')

app_source = (ROOT/'assets/js/app.js').read_text(encoding='utf-8')
for token in ("'읽기 완료'", '학습 포인트:', 'data-horizontal-scroll-hint', 'initialiseCapstoneAssessor', 'JSON PARSE FAIL'):
    if token not in app_source:
        error(f'app.js missing learning UX token: {token}')
if not re.search(r'Number\.isInteger\(\w+\.learningOrder\)', app_source):
    error('app.js must derive progress pages from integer learningOrder metadata')
if '학습 완료' in app_source:
    error('app.js must not present reading progress as learning mastery')

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
