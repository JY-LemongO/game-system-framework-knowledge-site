#!/usr/bin/env python3
"""Curate the static site so every visible page is learning-focused.

The script removes release notes, audits, roadmaps, and future implementation
pages from the published information architecture. It also applies a few
correctness and usability fixes discovered during the review.
"""

from __future__ import annotations

from pathlib import Path
import json
import re

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
MODULES = ROOT / "modules"
EXCLUDED_FILES = {
    "modules/phase3-readiness.html",
    "modules/implementation-roadmap.html",
    "modules/skill-combat-next.html",
    "modules/quality-audit.html",
}
EXCLUDED_SLUGS = "phase3-readiness|implementation-roadmap|skill-combat-next|quality-audit"
EXCLUDED_LINK = re.compile(
    rf'<a\b(?=[^>]*\bhref="(?:\.\./)?modules/(?:{EXCLUDED_SLUGS})\.html(?:#[^"]*)?")[^>]*>.*?</a>',
    re.DOTALL,
)


def require_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Missing expected content for {label}")
    return text.replace(old, new)


def replace_range(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"Missing start marker for {label}: {start_marker}")
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"Missing end marker for {label}: {end_marker}")
    return text[:start] + replacement + text[end:]


def replace_section(text: str, start_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"Missing section marker for {label}: {start_marker}")
    end = text.find("</section>", start)
    if end < 0:
        raise RuntimeError(f"Missing section end for {label}")
    end += len("</section>")
    return text[:start] + replacement + text[end:]


def replace_nav_labels(text: str) -> str:
    def top_nav(match: re.Match[str]) -> str:
        block = match.group(0)
        labels = {
            "Atlas": "학습 홈",
            "Architecture": "구조",
            "Case study": "예제",
            "Runtime": "실습",
        }
        for source, target in labels.items():
            block = re.sub(rf">\s*{re.escape(source)}\s*<", f">{target}<", block)
        return block

    def mobile_nav(match: re.Match[str]) -> str:
        block = match.group(0)
        labels = {"Atlas": "홈", "Map": "구조", "Search": "검색", "Docs": "문서"}
        for source, target in labels.items():
            block = re.sub(rf">\s*{re.escape(source)}\s*<", f">{target}<", block)
        return block

    text = re.sub(
        r'<nav aria-label="주요 탐색" class="top-nav">.*?</nav>',
        top_nav,
        text,
        flags=re.DOTALL,
    )
    text = re.sub(
        r'<nav aria-label="모바일 빠른 탐색" class="mobile-bar">.*?</nav>',
        mobile_nav,
        text,
        flags=re.DOTALL,
    )
    return text


def remove_fragment_link(text: str, fragment: str) -> str:
    pattern = re.compile(
        rf'<a\b(?=[^>]*\bhref="#{re.escape(fragment)}")[^>]*>.*?</a>',
        re.DOTALL,
    )
    return pattern.sub("", text)


def curate_common_html(text: str) -> str:
    text = EXCLUDED_LINK.sub("", text)
    text = replace_nav_labels(text)

    # Remove or rename empty/non-learning navigation groups after link pruning.
    text = re.sub(
        r'<section class="drawer-group"><h3>Maintenance</h3><div>\s*</div></section>',
        "",
        text,
    )
    drawer_labels = {
        "Foundation": "기반",
        "Core Systems": "핵심 시스템",
        "Architecture": "구조",
        "Practice": "사례 학습",
        "Reference": "참고",
        "Implementation": "실행 실습",
    }
    for source, target in drawer_labels.items():
        text = text.replace(f"<h3>{source}</h3>", f"<h3>{target}</h3>")

    runtime_drawer_old = (
        '<span>Executable</span><b>Runtime Reference</b><small>결정론적 Fireball, atomic commit, '
        'bounded reaction, contextual cache, schema migration의 실행 가능한 기준 구현</small>'
    )
    runtime_drawer_new = (
        '<span>실습</span><b>런타임 아키텍처</b><small>결정론적 실행, 원자적 상태 변경, '
        '반응 큐, 조건부 캐시와 마이그레이션을 직접 확인한다.</small>'
    )
    text = text.replace(runtime_drawer_old, runtime_drawer_new)

    common_replacements = {
        "Game architecture knowledgebase": "게임 시스템 아키텍처 학습",
        "Knowledge map": "학습 지도",
        "Search the system atlas": "게임 시스템 학습 검색",
        "On this page": "이 페이지",
        "Related paths": "연결 학습",
        ">Print<": ">인쇄<",
        "All docs": "전체 문서",
        "Offline-first · Executable reference · Release 3.2": "게임 시스템 설계 학습 자료",
        "Release 2부터 Effect System은": "현재 구조에서 Effect System은",
    }
    for source, target in common_replacements.items():
        text = text.replace(source, target)

    # Remove empty footer/navigation shells left by pruned links.
    text = re.sub(r'<section class="context-card">\s*<div class="context-title">\s*<span>연결 학습</span>\s*</div>\s*<div class="related-links">\s*</div>\s*</section>', "", text, flags=re.DOTALL)

    # Correct two learning statements that otherwise imply seed-only replay.
    text = text.replace(
        "SkillRequest와 seed만으로 주요 전투 결과를 재현할 수 있어야 한다.",
        "입력 스냅샷, Definition·공식·수치 정책 버전, 대상 정렬 규칙과 seed를 묶은 replay envelope로 주요 결과를 재현할 수 있어야 한다.",
    )
    text = re.sub(
        r"전투 로그 재현, 리플레이, 시뮬레이션 테스트를 생각하면 EffectContext에 randomSeed를 포함하는 편이 좋다\.\s*그래야 같은 입력으로 같은 결과를 재현할 수 있다\.",
        "전투 로그 재현, 리플레이, 시뮬레이션 테스트를 위해서는 randomSeed뿐 아니라 Definition·공식·입력 스냅샷·대상 정렬·수치 정책 버전을 함께 묶은 replay envelope를 기록해야 한다.",
        text,
    )
    return text


def curate_home(text: str) -> str:
    text = replace_range(
        text,
        '<h2 id="이번-2차-확장-범위">',
        '<section aria-labelledby="architecture-lens-title"',
        "",
        "home release history",
    )
    text = replace_range(
        text,
        '<h2 id="다음-확장-방향">',
        '<section class="runtime-launch" id="runtime-reference-launch">',
        "",
        "home future roadmap",
    )
    text = text.replace(
        '<span class="eyebrow">Knowledge Base · Release 3.2</span>',
        '<span class="eyebrow">Game System Architecture</span>',
    )
    text = text.replace('<span class="section-kicker">\n       System index\n      </span>', '<span class="section-kicker">\n       시스템 목록\n      </span>')
    text = text.replace('Architecture lens', '아키텍처 관점')
    text = text.replace('<span>\n        Overview\n       </span>', '<span>\n        개요\n       </span>')

    learning_launch = '''<section class="runtime-launch" id="runtime-reference-launch">
<div><span class="section-kicker">Interactive practice</span><h2 id="런타임-실습">설계를 실행하며 확인하기</h2><p>Fireball 한 번의 실행을 통해 결정론적 판정, 원자적 상태 변경, 후속 반응, 상태 tick과 replay trace가 어떻게 이어지는지 직접 확인한다.</p><div class="badges"><span class="badge">Deterministic replay</span><span class="badge">Atomic commit</span><span class="badge">Reaction queue</span><span class="badge">Context cache</span></div></div>
<a class="runtime-launch-console" href="modules/runtime-reference.html"><span><i></i>RUNTIME LAB</span><strong>실습<br/>열기</strong><small>replay · commit · reaction</small><b>→</b></a>
</section>'''
    text = replace_section(
        text,
        '<section class="runtime-launch" id="runtime-reference-launch">',
        learning_launch,
        "home runtime learning launch",
    )

    for fragment in ("이번-2차-확장-범위", "다음-확장-방향", "실행-가능한-phase3"):
        text = remove_fragment_link(text, fragment)
    text = text.replace(
        '</a></nav>',
        '</a><a href="#런타임-실습">런타임 실습</a></nav>',
        1,
    ) if '#런타임-실습' not in text else text

    readiness_pattern = re.compile(
        r'<a class="readiness-card" href="modules/runtime-reference\.html">.*?</a>',
        re.DOTALL,
    )
    text = readiness_pattern.sub(
        '<a class="readiness-card" href="modules/runtime-reference.html"><span>실행 실습</span><b>런타임 아키텍처 직접 확인</b><small>Replay · Commit · Reaction</small><i>→</i></a>',
        text,
    )
    return text


def curate_runtime_page(text: str) -> str:
    text = text.replace('<title>Phase 3 Runtime Reference · GSF System Atlas</title>', '<title>런타임 아키텍처 실습 · GSF System Atlas</title>')
    text = text.replace(
        '결정론적 Fireball 실행, 원자적 commit, bounded reaction, contextual cache, schema migration을 직접 실행하는 Phase 3 기준 구현',
        'Fireball 예제로 결정론적 실행, 원자적 상태 변경, 반응 큐, 조건부 캐시와 스키마 마이그레이션을 학습하는 실습',
    )
    text = text.replace(
        '<div class="breadcrumb"><a href="../index.html">Atlas</a><span>/</span><span>Implementation</span><span>/</span><b>Runtime Reference</b></div>',
        '<div class="breadcrumb"><a href="../index.html">학습 홈</a><span>/</span><span>실습</span><span>/</span><b>런타임 아키텍처</b></div>',
    )
    text = text.replace('<span>Executable Reference</span>', '<span>실행 실습</span>')

    hero = '''<section class="hero runtime-hero" data-accent="violet">
<span class="eyebrow">Interactive Runtime Learning</span>
<h1>런타임 아키텍처<br/>실습</h1>
<p class="lead">같은 JavaScript 커널을 브라우저 실습과 Node 회귀 테스트가 공유한다. Fireball의 resolve·commit·reaction·status tick을 한 trace에서 따라가며, 설계 문장이 실제 상태 변경 규칙으로 어떻게 고정되는지 확인한다.</p>
<div class="badges"><span class="badge">Deterministic replay</span><span class="badge">Atomic commit</span><span class="badge">Bounded reaction</span><span class="badge">Schema migration</span></div>
<div class="hero-actions"><a class="button primary" href="#fireball-workbench">Fireball 실습 시작</a><a class="button secondary" href="#실행-아키텍처">개념부터 보기</a></div>
</section>'''
    text = replace_section(text, '<section class="hero runtime-hero"', hero, "runtime hero")
    text = replace_section(text, '<section aria-label="구현 상태" class="runtime-release-band">', "", "runtime release band")

    key_points = '''<h2 id="핵심-학습-포인트">핵심 학습 포인트</h2>
<div class="runtime-kpi-grid">
<article><span>결정론</span><strong>Versioned replay</strong><p>seed만 저장하지 않고 입력, Definition, 공식, 수치 정책과 정렬 의미를 함께 고정한다.</p></article>
<article><span>계산과 변경</span><strong>Resolve → Commit</strong><p>읽기 전용 snapshot에서 결과와 계획을 만든 뒤, 검증된 변경만 한 경계에서 반영한다.</p></article>
<article><span>후속 효과</span><strong>Bounded queue</strong><p>상태를 바꾸는 반응은 우선순위, 안정 정렬 키, 깊이와 예산을 가진 큐에서 직렬화한다.</p></article>
<article><span>시간과 저장</span><strong>Explicit policy</strong><p>tick 동률, catch-up 상한, 캐시 의존성, 순차 migration을 명시적인 계약으로 다룬다.</p></article>
</div>
<div class="callout"><b>학습 범위.</b> 이 실습은 단일 대상 Fireball과 메모리 상태 저장소를 사용해 핵심 계약을 작게 드러낸다. 범용 게임 엔진 전체가 아니라, 책임 경계와 실패 의미를 검증하기 위한 최소 수직 슬라이스다.</div>
'''
    text = replace_range(
        text,
        '<h2 id="구현-결론">',
        '<h2 id="실행-아키텍처">',
        key_points,
        "runtime learning summary",
    )

    learning_close = '''<h2 id="학습-정리">학습 정리</h2>
<div class="grid cols2">
<article class="card"><h3 id="replay-check">Replay를 검증할 때</h3><p>결과 hash만 비교하지 말고, 첫 번째로 갈라진 판정 key와 trace 단계까지 함께 비교한다. 그래야 데이터 변경과 실행 의미 변경을 구분할 수 있다.</p></article>
<article class="card"><h3 id="commit-check">Commit을 검증할 때</h3><p>중복 command, 오래된 version, 과거 tick, 부분 실패가 모두 상태와 event를 남기지 않는지 확인한다.</p></article>
<article class="card"><h3 id="cache-check">Cache를 검증할 때</h3><p>compute가 읽는 context path를 빠짐없이 dependency로 선언해야 한다. 선언이 불완전하면 빠른 오답이 만들어지므로, 안전한 기본값은 조건부 레이어를 캐시하지 않는 것이다.</p></article>
<article class="card"><h3 id="time-check">시간 정책을 검증할 때</h3><p>catch-up 상한에 걸린 tick을 버릴지, 합산할지, 다음 프레임으로 넘길지를 상태별 정책으로 명시한다. 이 실습은 상한을 넘긴 과거 tick을 추가 적용하지 않고 만료 시점에 상태를 닫는다.</p></article>
</div>
<div class="callout warn"><b>교차 구현 주의.</b> 브라우저와 Node는 같은 JavaScript 구현을 공유하므로 결과가 일치한다. 다른 언어나 엔진과 replay를 공유하려면 문자열 인코딩, canonical serialization, 정수 범위와 반올림을 byte 단위 적합성 테스트로 고정해야 한다.</div>
'''
    text = replace_range(
        text,
        '<h2 id="source-contracts">',
        '</article>',
        learning_close,
        "runtime source and roadmap removal",
    )

    pager = '''<nav aria-label="이전 및 다음 문서" class="doc-pager"><a class="prev" href="../modules/fireball-case-study.html"><span>← 이전</span><b>Fireball 예제</b><small>Skill부터 Status까지 이어지는 수직 슬라이스</small></a><a class="next" href="../modules/integration-map.html"><span>다음 →</span><b>통합 구조</b><small>시스템 간 의존성과 계약 방향</small></a></nav>'''
    text = re.sub(
        r'<nav aria-label="이전 및 다음 문서" class="doc-pager">.*?</nav>',
        pager,
        text,
        count=1,
        flags=re.DOTALL,
    )

    aside = '''<aside aria-label="페이지 보조 탐색" class="context-rail">
<section class="context-card toc-card"><div class="context-title"><span>이 페이지</span><button data-print-page="" type="button">인쇄</button></div><nav class="page-toc">
<a href="#핵심-학습-포인트">핵심 학습 포인트</a><a href="#실행-아키텍처">실행 아키텍처</a><a href="#fireball-workbench">Fireball 실습</a><a href="#failure-probes">실패 안전성</a><a href="#context-cache-lab">조건부 캐시</a><a href="#migration-lab">스키마 마이그레이션</a><a href="#deterministic-envelope">결정론 envelope</a><a href="#학습-정리">학습 정리</a>
</nav></section>
<section class="context-card"><div class="context-title"><span>연결 학습</span></div><div class="related-links"><a href="../modules/fireball-case-study.html"><span>사례</span><b>Fireball 예제</b></a><a href="../modules/integration-map.html"><span>구조</span><b>통합 구조</b></a><a href="../modules/core-runtime.html"><span>기반</span><b>Core Runtime</b></a></div></section>
<a class="readiness-card runtime-side-cta" href="#fireball-workbench"><span>직접 확인</span><b>Replay를 실행한다</b><small>같은 입력 · 같은 trace</small><i>↓</i></a>
</aside>'''
    text = replace_range(text, '<aside aria-label="페이지 보조 탐색" class="context-rail">', '</aside>', aside, "runtime side rail")
    # replace_range keeps the end marker, so remove the duplicate closing tag.
    text = text.replace('</aside></aside>', '</aside>', 1)

    runtime_strings = {
        "Fireball Replay Workbench": "Fireball 리플레이 실습",
        "Hardening Probes": "실패 안전성 실습",
        "Contextual Stat Cache Lab": "조건부 스탯 캐시 실습",
        "Schema Migration Lab": "스키마 마이그레이션 실습",
        "Decision trace": "판정 추적",
        "Committed events": "커밋된 이벤트",
        "Replay identity": "리플레이 식별",
        "Target snapshot": "대상 스냅샷",
        "Decision policy": "판정 정책",
        "Root seed": "루트 시드",
        "Spell power": "주문력",
        "Fire resist %": "화염 저항 %",
        "Hit chance %": "명중 확률 %",
        "Crit chance %": "치명타 확률 %",
        "Burn ratio %": "화상 비율 %",
        "Immutable outcome / plan JSON": "불변 결과 / 계획 JSON",
        "Final state JSON": "최종 상태 JSON",
        "Shared browser / Node kernel": "브라우저 / Node 공유 커널",
        "same browser / Node kernel": "브라우저 / Node 공유 커널",
        "post-commit only": "커밋 성공 후에만 발행",
        "Ready": "준비",
    }
    for source, target in runtime_strings.items():
        text = text.replace(source, target)

    text = text.replace(
        '<strong data-runtime-replay-status="">준비</strong>',
        '<strong aria-live="polite" data-runtime-replay-status="">준비</strong>',
    )
    return text


def curate_site_map() -> list[dict]:
    path = ROOT / "source" / "site-map.json"
    pages = json.loads(path.read_text(encoding="utf-8"))
    curated: list[dict] = []
    group_names = {
        "Foundation": "기반",
        "Core Systems": "핵심 시스템",
        "Architecture": "구조",
        "Practice": "사례 학습",
        "Reference": "참고",
    }
    for page in pages:
        if page["file"] in EXCLUDED_FILES:
            continue
        page = dict(page)
        page["group"] = group_names.get(page["group"], page["group"])
        if page["file"] == "index.html":
            page.update(title="게임 시스템 설계 지식 베이스", level="개요")
        elif page["file"] == "modules/runtime-reference.html":
            page.update(
                short="런타임 실습",
                title="런타임 아키텍처 실습",
                desc="Fireball 예제로 결정론적 실행, 원자적 상태 변경, 반응 큐, 조건부 캐시와 마이그레이션을 확인하는 실습",
                key="runtime replay commit reaction cache migration fireball 실습",
                group="실행 실습",
                level="Interactive",
            )
        curated.append(page)
    path.write_text(json.dumps(curated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return curated


def patch_runtime_kernel() -> None:
    source_path = ROOT / "source" / "runtime" / "runtime-kernel.js"
    browser_path = ROOT / "assets" / "js" / "runtime-kernel.js"
    text = source_path.read_text(encoding="utf-8")

    text = require_replace(
        text,
        "    for (const value of ['baseDamage', 'coefficientBps', 'hitChanceBps', 'critChanceBps', 'critMultiplierBps', 'manaCost', 'cooldownTicks']) requireInteger(input.skill[value], `skill.${value}`, 0, value.endsWith('Bps') ? 100_000 : Number.MAX_SAFE_INTEGER);",
        "    for (const value of ['baseDamage', 'coefficientBps', 'critMultiplierBps', 'manaCost', 'cooldownTicks']) requireInteger(input.skill[value], `skill.${value}`, 0, value.endsWith('Bps') ? 100_000 : Number.MAX_SAFE_INTEGER);\n    for (const value of ['hitChanceBps', 'critChanceBps']) requireInteger(input.skill[value], `skill.${value}`, 0, BASIS_POINTS);",
        "probability range validation",
    )

    text = require_replace(
        text,
        "    commit(command, plan, trace = null) {\n      domainAssert(command.commandId === plan.commandId, 'COMMAND_PLAN_MISMATCH', 'commit', 'Plan does not belong to command.');",
        "    commit(command, plan, trace = null) {\n      domainAssert(isPlainObject(plan), 'INVALID_PLAN', 'commit', 'Plan must be a plain object.');\n      requireId(plan.planId, 'plan.planId');\n      requireInteger(plan.schemaVersion, 'plan.schemaVersion', 1);\n      requireInteger(plan.commitTick, 'plan.commitTick', 0);\n      domainAssert(plan.commitTick >= this.tick, 'COMMIT_TICK_REGRESSION', 'commit', 'Commit tick cannot move behind the store clock.', { storeTick: this.tick, commitTick: plan.commitTick });\n      domainAssert(command.commandId === plan.commandId, 'COMMAND_PLAN_MISMATCH', 'commit', 'Plan does not belong to command.');",
        "monotonic commit tick",
    )

    old_advance = """    const commits = [];
    const perStatusCount = new Map();
    let catchUpLimited = false;
    let guard = 0;
    while (guard < 10_000) {
      guard += 1;
      const candidate = listStatuses(store).find(item => item.status.nextTickAt <= targetTick && item.status.nextTickAt <= item.status.expireTick);
      if (!candidate) break;
      const status = candidate.status;
      const count = perStatusCount.get(status.instanceId) ?? 0;
      if (count >= status.maxCatchUpTicks) {
        catchUpLimited = true;
        break;
      }
      const entity = store.getEntity(candidate.entityId);
      const actualDamage = Math.min(entity.resources.hp, status.tickDamage);
      const shouldExpire = status.nextTickAt >= status.expireTick;
      const command = createCommandEnvelope({ commandId: `command.${hashHex([status.instanceId, 'tick', status.nextTickAt])}`, actorId: status.sourceRef, requestedTick: status.nextTickAt, correlationId: status.correlationId, causationId: status.causationId, dataVersion: status.dataVersion, payload: { targetId: entity.id, statusInstanceId: status.instanceId } });
      const operations = [];
      if (actualDamage) operations.push({ order: 10, kind: 'resource.delta', entityId: entity.id, resource: 'hp', delta: -actualDamage, key: 'tick-damage' });
      operations.push(shouldExpire || entity.resources.hp - actualDamage <= 0
        ? { order: 20, kind: 'status.remove', entityId: entity.id, instanceId: status.instanceId, key: 'expire' }
        : { order: 20, kind: 'status.patch', entityId: entity.id, instanceId: status.instanceId, patch: { nextTickAt: status.nextTickAt + status.intervalTicks }, key: 'schedule-next' });
      const events = [{ type: 'StatusTicked', payload: { targetId: entity.id, statusInstanceId: status.instanceId, definitionId: status.definitionId, hpDamage: actualDamage, tickAt: status.nextTickAt } }];
      if (shouldExpire || entity.resources.hp - actualDamage <= 0) events.push({ type: 'StatusExpired', payload: { targetId: entity.id, statusInstanceId: status.instanceId, definitionId: status.definitionId, expireTick: status.expireTick } });
      const planBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: command.commandId, commitTick: status.nextTickAt, preconditions: [{ entityId: entity.id, expectedVersion: entity.version }], operations, eventBlueprints: events };
      commits.push(store.commit(command, { ...planBase, planId: `plan.${hashHex(planBase)}` }, trace));
      perStatusCount.set(status.instanceId, count + 1);
    }
    if (catchUpLimited) {
      for (const candidate of listStatuses(store).filter(item => item.status.expireTick <= targetTick)) {"""

    new_advance = """    const commits = [];
    const perStatusCount = new Map();
    const limitedStatusIds = new Set();
    let catchUpLimited = false;
    let guard = 0;
    while (guard < 10_000) {
      guard += 1;
      const candidate = listStatuses(store).find(item => !limitedStatusIds.has(item.status.instanceId) && item.status.nextTickAt <= targetTick && item.status.nextTickAt <= item.status.expireTick);
      if (!candidate) break;
      const status = candidate.status;
      const count = perStatusCount.get(status.instanceId) ?? 0;
      if (count >= status.maxCatchUpTicks) {
        catchUpLimited = true;
        limitedStatusIds.add(status.instanceId);
        trace?.record('status_catchup_limited', targetTick, { statusInstanceId: status.instanceId, processedTicks: count, maxCatchUpTicks: status.maxCatchUpTicks });
        continue;
      }
      const entity = store.getEntity(candidate.entityId);
      const actualDamage = Math.min(entity.resources.hp, status.tickDamage);
      const targetDefeated = entity.resources.hp - actualDamage <= 0;
      const shouldExpire = status.nextTickAt >= status.expireTick;
      const shouldRemove = shouldExpire || targetDefeated;
      const command = createCommandEnvelope({ commandId: `command.${hashHex([status.instanceId, 'tick', status.nextTickAt])}`, actorId: status.sourceRef, requestedTick: status.nextTickAt, correlationId: status.correlationId, causationId: status.causationId, dataVersion: status.dataVersion, payload: { targetId: entity.id, statusInstanceId: status.instanceId } });
      const operations = [];
      if (actualDamage) operations.push({ order: 10, kind: 'resource.delta', entityId: entity.id, resource: 'hp', delta: -actualDamage, key: 'tick-damage' });
      operations.push(shouldRemove
        ? { order: 20, kind: 'status.remove', entityId: entity.id, instanceId: status.instanceId, key: 'expire' }
        : { order: 20, kind: 'status.patch', entityId: entity.id, instanceId: status.instanceId, patch: { nextTickAt: status.nextTickAt + status.intervalTicks }, key: 'schedule-next' });
      const events = [{ type: 'StatusTicked', payload: { targetId: entity.id, statusInstanceId: status.instanceId, definitionId: status.definitionId, hpDamage: actualDamage, tickAt: status.nextTickAt } }];
      if (shouldRemove) events.push({ type: shouldExpire ? 'StatusExpired' : 'StatusRemoved', payload: { targetId: entity.id, statusInstanceId: status.instanceId, definitionId: status.definitionId, expireTick: status.expireTick, reason: shouldExpire ? 'duration-ended' : 'target-defeated' } });
      const planBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: command.commandId, commitTick: status.nextTickAt, preconditions: [{ entityId: entity.id, expectedVersion: entity.version }], operations, eventBlueprints: events };
      commits.push(store.commit(command, { ...planBase, planId: `plan.${hashHex(planBase)}` }, trace));
      perStatusCount.set(status.instanceId, count + 1);
    }
    if (catchUpLimited) {
      for (const candidate of listStatuses(store).filter(item => limitedStatusIds.has(item.status.instanceId) && item.status.expireTick <= targetTick)) {"""
    text = require_replace(text, old_advance, new_advance, "per-status catch-up")

    source_path.write_text(text, encoding="utf-8")
    browser_path.write_text(text, encoding="utf-8")


def patch_runtime_tests() -> None:
    path = ROOT / "source" / "runtime" / "tests" / "runtime-kernel.test.cjs"
    text = path.read_text(encoding="utf-8")

    text = require_replace(
        text,
        "test('namespaced ID가 아닌 command identifier는 계약 단계에서 거부한다', () => {\n  const code = errorCode(() => G.createCommandEnvelope({ commandId: 'bad', actorId: 'entity.actor', requestedTick: 0, correlationId: 'correlation.test', payload: {} }));\n  assert.equal(code, 'INVALID_ID');\n});",
        "test('식별자와 확률 범위는 계약 단계에서 검증한다', () => {\n  const code = errorCode(() => G.createCommandEnvelope({ commandId: 'bad', actorId: 'entity.actor', requestedTick: 0, correlationId: 'correlation.test', payload: {} }));\n  assert.equal(code, 'INVALID_ID');\n  assert.equal(errorCode(() => G.normalizeScenarioInput({ skill: { hitChanceBps: 10_001 } })), 'INTEGER_OUT_OF_RANGE');\n  assert.equal(errorCode(() => G.normalizeScenarioInput({ skill: { critChanceBps: 10_001 } })), 'INTEGER_OUT_OF_RANGE');\n});",
        "probability contract regression",
    )

    text = require_replace(
        text,
        "  assert.equal(probe.rolledBack, true);\n  assert.equal(probe.error.code, 'RESOURCE_OVERFLOW');\n});",
        "  assert.equal(probe.rolledBack, true);\n  assert.equal(probe.error.code, 'RESOURCE_OVERFLOW');\n\n  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });\n  const store = new G.StateStore(G.createInitialState(input));\n  const forward = G.createCommandEnvelope({ commandId: 'command.clock.forward', actorId: input.caster.id, requestedTick: input.tick + 1, correlationId: 'correlation.clock.forward', dataVersion: input.dataVersion, payload: {} });\n  const forwardBase = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, commandId: forward.commandId, commitTick: input.tick + 1, preconditions: [], operations: [], eventBlueprints: [] };\n  store.commit(forward, { ...forwardBase, planId: `plan.${G.hashHex(forwardBase)}` });\n  const backward = G.createCommandEnvelope({ commandId: 'command.clock.backward', actorId: input.caster.id, requestedTick: input.tick, correlationId: 'correlation.clock.backward', dataVersion: input.dataVersion, payload: {} });\n  const backwardBase = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, commandId: backward.commandId, commitTick: input.tick, preconditions: [], operations: [], eventBlueprints: [] };\n  assert.equal(errorCode(() => store.commit(backward, { ...backwardBase, planId: `plan.${G.hashHex(backwardBase)}` })), 'COMMIT_TICK_REGRESSION');\n});",
        "commit clock regression",
    )

    text = require_replace(
        text,
        "  const expiration = result.outbox.find(event => event.type === 'StatusExpired' && event.payload.catchUpLimited);\n  assert.ok(expiration);\n});",
        "  const expiration = result.outbox.find(event => event.type === 'StatusExpired' && event.payload.catchUpLimited);\n  assert.ok(expiration);\n\n  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });\n  const state = JSON.parse(G.canonicalStringify(G.createInitialState(input)));\n  const target = state.entities[input.target.id];\n  target.statuses = {\n    'status-instance.a': { instanceId: 'status-instance.a', definitionId: 'status.burn-a', sourceRef: input.caster.id, targetId: input.target.id, correlationId: 'correlation.catchup', causationId: 'event.catchup', dataVersion: input.dataVersion, appliedTick: input.tick, nextTickAt: input.tick + 1, expireTick: input.tick + 10, intervalTicks: 1, tickDamage: 1, maxCatchUpTicks: 1 },\n    'status-instance.b': { instanceId: 'status-instance.b', definitionId: 'status.burn-b', sourceRef: input.caster.id, targetId: input.target.id, correlationId: 'correlation.catchup', causationId: 'event.catchup', dataVersion: input.dataVersion, appliedTick: input.tick, nextTickAt: input.tick + 3, expireTick: input.tick + 3, intervalTicks: 3, tickDamage: 1, maxCatchUpTicks: 1 },\n  };\n  const store = new G.StateStore(state);\n  const advanced = G.advanceStatuses(store, input.tick + 3);\n  assert.equal(advanced.catchUpLimited, true);\n  assert.ok(store.outbox.some(event => event.type === 'StatusTicked' && event.payload.statusInstanceId === 'status-instance.b'));\n});",
        "multi-status catch-up regression",
    )
    path.write_text(text, encoding="utf-8")


def patch_app_js() -> None:
    path = ROOT / "assets" / "js" / "app.js"
    text = path.read_text(encoding="utf-8")
    text = require_replace(
        text,
        "$$('[data-print], .print-page').forEach(button => button.addEventListener('click', () => print()));",
        "$$('[data-print], [data-print-page], .print-page').forEach(button => button.addEventListener('click', () => print()));",
        "print button selector",
    )
    labels = {
        "['base', 'Base', 100]": "['base', '기본값', 100]",
        "['flat', 'Flat Add', 20]": "['flat', '고정 가산', 20]",
        "['inc', 'Increase %', 30]": "['inc', '증가 %', 30]",
        "['more', 'More %', 20]": "['more', '독립 배율 %', 20]",
        "['clamp', 'Max Clamp', 9999]": "['clamp', '최대 제한', 9999]",
        "`Final Value = ${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(finalValue)}`": "`최종값 = ${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(finalValue)}`",
        "metric('Decision'": "metric('판정'",
        "metric('Resolved'": "metric('저항 적용 피해'",
        "metric('Shield'": "metric('보호막'",
        "metric('HP damage'": "metric('HP 피해'",
        "metric('Burn'": "metric('화상'",
        "metric('Final HP'": "metric('최종 HP'",
    }
    for source, target in labels.items():
        text = text.replace(source, target)
    path.write_text(text, encoding="utf-8")


def patch_validation_tools() -> None:
    validate = ROOT / "source" / "tools" / "validate_site.py"
    text = validate.read_text(encoding="utf-8")
    text = require_replace(
        text,
        "if len(pages) != 16: error(f'site-map page count expected 16, got {len(pages)}')",
        "if not pages: error('site-map must contain at least one learning page')",
        "dynamic site-map count",
    )
    text = require_replace(
        text,
        "if len(soup.select('.drawer-groups a')) != 16: error(f'{path.relative_to(ROOT)} drawer does not expose 16 pages')",
        "if len(soup.select('.drawer-groups a')) != len(pages): error(f'{path.relative_to(ROOT)} drawer does not expose all {len(pages)} learning pages')",
        "dynamic drawer count",
    )
    text = require_replace(
        text,
        "if len([x for x in search if x.get('type')=='page']) != 16: error('search index page count mismatch')",
        "if len([x for x in search if x.get('type')=='page']) != len(pages): error('search index page count mismatch')",
        "dynamic search page count",
    )
    validate.write_text(text, encoding="utf-8")

    smoke = ROOT / "source" / "tools" / "browser_smoke.py"
    text = smoke.read_text(encoding="utf-8")
    text = text.replace("import json, sys", "import json, sys, shutil")
    text = require_replace(
        text,
        "browser=p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])",
        "executable = shutil.which('chromium') or shutil.which('chromium-browser') or p.chromium.executable_path\n    browser=p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])",
        "portable Chromium path",
    )
    text = text.replace("page.locator('#command-input').fill('Runtime Reference')", "page.locator('#command-input').fill('런타임 아키텍처')")
    text = text.replace("'global-search:runtime-result'", "'global-search:runtime-learning-result'")
    smoke.write_text(text, encoding="utf-8")


def verify_learning_only(pages: list[dict]) -> None:
    banned_visible_phrases = (
        "이번 2차 확장 범위",
        "다음 확장 방향",
        "다음 생산 구현",
        "Phase 3 준비",
        "Quality audit",
        "Build plan",
        "Release 3.2",
    )
    for page in pages:
        path = ROOT / page["file"]
        if not path.exists():
            raise RuntimeError(f"Missing curated page: {page['file']}")
        soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
        visible = " ".join(soup.get_text(" ", strip=True).split())
        for phrase in banned_visible_phrases:
            if phrase in visible:
                raise RuntimeError(f"Non-learning phrase remains in {page['file']}: {phrase}")
        for link in soup.select("a[href]"):
            href = link.get("href", "")
            if any(slug in href for slug in ("phase3-readiness", "implementation-roadmap", "skill-combat-next", "quality-audit")):
                raise RuntimeError(f"Excluded link remains in {page['file']}: {href}")
        if len(soup.select(".drawer-groups a")) != len(pages):
            raise RuntimeError(f"Drawer count mismatch in {page['file']}")


def main() -> None:
    pages = curate_site_map()

    for html_path in sorted([ROOT / page["file"] for page in pages]):
        text = html_path.read_text(encoding="utf-8")
        text = curate_common_html(text)
        if html_path == ROOT / "index.html":
            text = curate_home(text)
        elif html_path == MODULES / "runtime-reference.html":
            text = curate_runtime_page(text)
        html_path.write_text(text, encoding="utf-8")

    for file_name in EXCLUDED_FILES:
        path = ROOT / file_name
        if path.exists():
            path.unlink()

    patch_runtime_kernel()
    patch_runtime_tests()
    patch_app_js()
    patch_validation_tools()
    verify_learning_only(pages)
    print(json.dumps({"status": "ok", "learningPages": len(pages), "removedPages": sorted(EXCLUDED_FILES)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
