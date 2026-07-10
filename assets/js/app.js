(() => {
  'use strict';

  const body = document.body;
  if (!body) return;

  const prefix = body.dataset.prefix || '';
  const currentFile = body.dataset.pageFile || 'index.html';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const excludedPages = new Set([
    'modules/phase3-readiness.html',
    'modules/implementation-roadmap.html',
    'modules/skill-combat-next.html',
    'modules/quality-audit.html'
  ]);

  const excludedSearchSections = new Set([
    'index.html|#이번-2차-확장-범위',
    'index.html|#새로-추가된-문서',
    'index.html|#함께-보강된-문서',
    'index.html|#다음-확장-방향',
    'index.html|#equipment-item-system',
    'index.html|#progression-reward-system',
    'modules/runtime-reference.html|#source-contracts',
    'modules/runtime-reference.html|#다음-생산-구현',
    'modules/runtime-reference.html|#p3e-adapter',
    'modules/runtime-reference.html|#p3e-authority',
    'modules/runtime-reference.html|#p3e-multitarget',
    'modules/runtime-reference.html|#p3f-equipment'
  ]);

  const redirectTargets = {
    'modules/phase3-readiness.html': 'runtime-reference.html#핵심-학습-포인트',
    'modules/implementation-roadmap.html': '../index.html#추천-학습-루트',
    'modules/skill-combat-next.html': 'integration-map.html',
    'modules/quality-audit.html': '../index.html'
  };

  function normalizedFileFromHref(href = '') {
    try {
      return href.split('#')[0].split('?')[0].replace(/^\.\//, '').replace(/^\.\.\//, '');
    } catch (_) {
      return '';
    }
  }

  function isExcludedHref(href = '') {
    const normalized = normalizedFileFromHref(href);
    return excludedPages.has(normalized) || [...excludedPages].some(file => normalized.endsWith(file));
  }

  function replaceText(root, source, target) {
    if (!root || !source || source === target) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('script, style, pre, code')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.includes(source) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => { node.nodeValue = node.nodeValue.replaceAll(source, target); });
  }

  function removeSiblingRange(start, endExclusive) {
    if (!start?.parentNode) return;
    let node = start;
    while (node && node !== endExclusive) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
  }

  function setLeadingLabel(label, text) {
    if (!label) return;
    const node = Array.from(label.childNodes).find(item => item.nodeType === Node.TEXT_NODE && item.nodeValue.trim());
    if (node) node.nodeValue = text;
    else label.prepend(document.createTextNode(text));
  }

  function transformSearchEntry(entry) {
    if (entry.file === 'index.html' && entry.anchor === '#실행-가능한-phase3') {
      return {
        ...entry,
        anchor: '#런타임-실습',
        title: '설계를 실행하며 확인하기',
        desc: 'Fireball 실행으로 결정론적 판정, 원자적 상태 변경, 후속 반응과 상태 tick을 확인한다.'
      };
    }
    if (entry.file === 'modules/runtime-reference.html' && entry.anchor === '#구현-결론') {
      return {
        ...entry,
        anchor: '#핵심-학습-포인트',
        title: '핵심 학습 포인트',
        desc: '결정론, Resolve와 Commit 분리, bounded reaction, 시간·캐시·마이그레이션 정책을 요약한다.'
      };
    }
    if (entry.file === 'modules/runtime-reference.html') {
      return {
        ...entry,
        short: '런타임 실습',
        title: entry.type === 'page' ? '런타임 아키텍처 실습' : entry.title,
        group: '실행 실습'
      };
    }
    return entry;
  }

  function ensureSearchEntry(entries, candidate) {
    if (!entries.some(entry => entry.file === candidate.file && entry.anchor === candidate.anchor)) entries.push(candidate);
  }

  function filterSearchData() {
    const data = window.__GSF_SITE__;
    if (!data) return;
    const keep = entry => !excludedPages.has(entry.file) && !excludedSearchSections.has(`${entry.file}|${entry.anchor || ''}`);

    if (Array.isArray(data.pages)) {
      data.pages = data.pages.filter(keep).map(page => {
        if (page.file !== 'modules/runtime-reference.html') return page;
        return {
          ...page,
          short: '런타임 실습',
          title: '런타임 아키텍처 실습',
          desc: 'Fireball 예제로 결정론적 실행, 원자적 상태 변경, 반응 큐, 조건부 캐시와 마이그레이션을 확인하는 실습',
          group: '실행 실습',
          level: 'Interactive'
        };
      });
    }

    if (Array.isArray(data.entries)) {
      data.entries = data.entries.map(transformSearchEntry).filter(keep);
      ensureSearchEntry(data.entries, {
        type: 'section', file: 'modules/runtime-reference.html', anchor: '#학습-정리',
        title: '학습 정리', short: '런타임 실습',
        desc: 'Replay, Commit, Cache, 시간 정책을 실제 구현에 적용할 때의 검증 기준을 정리한다.',
        group: '실행 실습', level: 'H2', text: 'runtime replay commit cache time learning'
      });
    }
  }

  function pruneNavigation() {
    $$('a[href]').forEach(link => {
      if (isExcludedHref(link.getAttribute('href') || '')) link.remove();
    });

    const topLabels = new Map([
      ['Atlas', '학습 홈'], ['Architecture', '구조'], ['Case study', '예제'], ['Runtime', '실습']
    ]);
    $$('.top-nav a').forEach(link => {
      const key = link.textContent.trim();
      if (topLabels.has(key)) link.textContent = topLabels.get(key);
    });

    const mobileLabels = new Map([
      ['Atlas', '홈'], ['Map', '구조'], ['Search', '검색'], ['Docs', '문서']
    ]);
    $$('.mobile-bar span').forEach(span => {
      const key = span.textContent.trim();
      if (mobileLabels.has(key)) span.textContent = mobileLabels.get(key);
    });

    const drawerLabels = new Map([
      ['Foundation', '기반'], ['Core Systems', '핵심 시스템'], ['Architecture', '구조'],
      ['Practice', '사례 학습'], ['Reference', '참고'], ['Implementation', '실행 실습'],
      ['Maintenance', '유지 관리']
    ]);
    $$('.drawer-group').forEach(group => {
      const title = $('h3', group);
      if (title && drawerLabels.has(title.textContent.trim())) title.textContent = drawerLabels.get(title.textContent.trim());
      if (!$('a', group)) group.remove();
    });

    $$('.drawer-groups a[href*="runtime-reference.html"]').forEach(link => {
      const type = $('span', link);
      const title = $('b', link);
      const desc = $('small', link);
      if (type) type.textContent = '실습';
      if (title) title.textContent = '런타임 아키텍처';
      if (desc) desc.textContent = '결정론적 실행, 원자적 상태 변경, 반응 큐, 조건부 캐시와 마이그레이션을 직접 확인한다.';
    });

    $$('.related-links').forEach(links => {
      if (!$('a', links)) links.closest('.context-card')?.remove();
    });

    const dockAll = $('.system-dock-all');
    if (dockAll) dockAll.textContent = '전체 문서';
    const brandSmall = $('.brand-copy small');
    if (brandSmall) brandSmall.textContent = '게임 시스템 아키텍처 학습';
    const drawerKicker = $('.site-drawer .section-kicker');
    if (drawerKicker) drawerKicker.textContent = '학습 지도';
    const commandTitle = $('#command-title');
    if (commandTitle) commandTitle.textContent = '게임 시스템 학습 검색';

    $$('.context-title span').forEach(span => {
      if (span.textContent.trim() === 'On this page') span.textContent = '이 페이지';
      if (span.textContent.trim() === 'Related paths') span.textContent = '연결 학습';
    });

    $$('[data-print-page]').forEach(button => {
      button.textContent = '인쇄';
      button.setAttribute('data-print', '');
    });

    const footer = $('.site-footer');
    if (footer) {
      const span = $('span', footer);
      if (span) span.textContent = '게임 시스템 설계 학습 자료';
      $$('a', footer).forEach(link => {
        if (isExcludedHref(link.getAttribute('href') || '')) link.remove();
      });
    }
  }

  function sanitizeExcludedPage() {
    const target = redirectTargets[currentFile];
    if (!target) return false;

    document.title = '학습 경로 안내 · GSF System Atlas';
    const article = $('#article-content');
    if (article) {
      article.innerHTML = `
        <section class="hero" data-accent="violet">
          <span class="eyebrow">Learning path</span>
          <h1>학습 경로 안내</h1>
          <p class="lead">이 문서는 현재 학습 목차에서 제외되었습니다. 개념 설명과 실행 예제가 있는 학습 페이지로 이어집니다.</p>
          <div class="hero-actions"><a class="button primary" href="${target}">학습 계속하기</a></div>
        </section>`;
    }
    $('.context-rail')?.remove();
    $('[data-toc-open]')?.remove();
    $('.doc-pager')?.remove();

    if (['http:', 'https:', 'file:'].includes(location.protocol)) queueMicrotask(() => location.replace(target));
    return true;
  }

  function curateHome() {
    const architecture = $('[data-architecture-lens]');
    removeSiblingRange(document.getElementById('이번-2차-확장-범위'), architecture);

    const launch = $('#runtime-reference-launch');
    removeSiblingRange(document.getElementById('다음-확장-방향'), launch);

    const eyebrow = $('.hero .eyebrow');
    if (eyebrow) eyebrow.textContent = 'Game System Architecture';
    const meta = $('.doc-meta > span:first-child');
    if (meta?.textContent.trim() === 'Overview') meta.textContent = '개요';

    $$('.section-kicker').forEach(kicker => {
      if (kicker.textContent.trim() === 'System index') kicker.textContent = '시스템 목록';
      if (kicker.textContent.trim() === 'Architecture lens') kicker.textContent = '아키텍처 관점';
    });

    if (launch) {
      launch.innerHTML = `
        <div>
          <span class="section-kicker">Interactive practice</span>
          <h2 id="런타임-실습">설계를 실행하며 확인하기</h2>
          <p>Fireball 한 번의 실행을 통해 결정론적 판정, 원자적 상태 변경, 후속 반응, 상태 tick과 replay trace가 어떻게 이어지는지 직접 확인한다.</p>
          <div class="badges"><span class="badge">Deterministic replay</span><span class="badge">Atomic commit</span><span class="badge">Reaction queue</span><span class="badge">Context cache</span></div>
        </div>
        <a class="runtime-launch-console" href="modules/runtime-reference.html"><span><i></i>RUNTIME LAB</span><strong>실습<br>열기</strong><small>replay · commit · reaction</small><b>→</b></a>`;
    }

    const sideCta = $('a.readiness-card[href*="runtime-reference.html"]');
    if (sideCta) sideCta.innerHTML = '<span>실행 실습</span><b>런타임 아키텍처 직접 확인</b><small>Replay · Commit · Reaction</small><i>→</i>';

    const pageToc = $('.page-toc');
    if (pageToc && !pageToc.querySelector('a[href="#런타임-실습"]')) {
      const link = document.createElement('a');
      link.href = '#런타임-실습';
      link.textContent = '런타임 실습';
      pageToc.appendChild(link);
    }
  }

  function curateRuntime() {
    document.title = '런타임 아키텍처 실습 · GSF System Atlas';
    const description = $('meta[name="description"]');
    if (description) description.content = 'Fireball 예제로 결정론적 실행, 원자적 상태 변경, 반응 큐, 조건부 캐시와 스키마 마이그레이션을 학습하는 실습';

    const breadcrumb = $('.breadcrumb');
    if (breadcrumb) breadcrumb.innerHTML = '<a href="../index.html">학습 홈</a><span>/</span><span>실습</span><span>/</span><b>런타임 아키텍처</b>';
    const meta = $('.doc-meta > span:first-child');
    if (meta) meta.textContent = '실행 실습';

    const hero = $('.runtime-hero');
    if (hero) {
      hero.innerHTML = `
        <span class="eyebrow">Interactive Runtime Learning</span>
        <h1>런타임 아키텍처<br>실습</h1>
        <p class="lead">같은 JavaScript 커널을 브라우저 실습과 Node 회귀 테스트가 공유한다. Fireball의 resolve·commit·reaction·status tick을 한 trace에서 따라가며, 설계 문장이 실제 상태 변경 규칙으로 어떻게 고정되는지 확인한다.</p>
        <div class="badges"><span class="badge">Deterministic replay</span><span class="badge">Atomic commit</span><span class="badge">Bounded reaction</span><span class="badge">Schema migration</span></div>
        <div class="hero-actions"><a class="button primary" href="#fireball-workbench">Fireball 실습 시작</a><a class="button secondary" href="#실행-아키텍처">개념부터 보기</a></div>`;
    }

    $('.runtime-release-band')?.remove();

    const architectureHeading = document.getElementById('실행-아키텍처');
    const conclusionHeading = document.getElementById('구현-결론');
    if (conclusionHeading && architectureHeading) {
      removeSiblingRange(conclusionHeading, architectureHeading);
      architectureHeading.insertAdjacentHTML('beforebegin', `
        <h2 id="핵심-학습-포인트">핵심 학습 포인트</h2>
        <div class="runtime-kpi-grid">
          <article><span>결정론</span><strong>Versioned replay</strong><p>seed만 저장하지 않고 입력, Definition, 공식, 수치 정책과 정렬 의미를 함께 고정한다.</p></article>
          <article><span>계산과 변경</span><strong>Resolve → Commit</strong><p>읽기 전용 snapshot에서 결과와 계획을 만든 뒤, 검증된 변경만 한 경계에서 반영한다.</p></article>
          <article><span>후속 효과</span><strong>Bounded queue</strong><p>상태를 바꾸는 반응은 우선순위, 안정 정렬 키, 깊이와 예산을 가진 큐에서 직렬화한다.</p></article>
          <article><span>시간과 저장</span><strong>Explicit policy</strong><p>tick 동률, catch-up 상한, 캐시 의존성, 순차 migration을 명시적인 계약으로 다룬다.</p></article>
        </div>
        <div class="callout"><b>학습 범위.</b> 이 실습은 단일 대상 Fireball과 메모리 상태 저장소를 사용해 핵심 계약을 작게 드러낸다. 범용 게임 엔진 전체가 아니라 책임 경계와 실패 의미를 검증하기 위한 최소 수직 슬라이스다.</div>`);
    }

    const article = $('#article-content');
    const sourceHeading = document.getElementById('source-contracts');
    if (article && sourceHeading) {
      let node = sourceHeading;
      while (node) {
        const next = node.nextSibling;
        node.remove();
        node = next;
      }
      article.insertAdjacentHTML('beforeend', `
        <h2 id="학습-정리">학습 정리</h2>
        <div class="grid cols2">
          <article class="card"><h3 id="replay-check">Replay를 검증할 때</h3><p>결과 hash만 비교하지 말고 첫 번째로 갈라진 판정 key와 trace 단계까지 함께 비교한다. 그래야 데이터 변경과 실행 의미 변경을 구분할 수 있다.</p></article>
          <article class="card"><h3 id="commit-check">Commit을 검증할 때</h3><p>중복 command, 오래된 version, 과거 tick, 부분 실패가 모두 상태와 event를 남기지 않는지 확인한다.</p></article>
          <article class="card"><h3 id="cache-check">Cache를 검증할 때</h3><p>compute가 읽는 context path를 빠짐없이 dependency로 선언해야 한다. 선언이 불완전하면 빠른 오답이 만들어지므로 안전한 기본값은 조건부 레이어를 캐시하지 않는 것이다.</p></article>
          <article class="card"><h3 id="time-check">시간 정책을 검증할 때</h3><p>catch-up 상한에 걸린 tick을 버릴지, 합산할지, 다음 프레임으로 넘길지를 상태별 정책으로 명시한다.</p></article>
        </div>
        <div class="callout warn"><b>교차 구현 주의.</b> 브라우저와 Node는 같은 JavaScript 구현을 공유한다. 다른 언어나 엔진과 replay를 공유하려면 문자열 인코딩, canonical serialization, 정수 범위와 반올림을 byte 단위 적합성 테스트로 고정해야 한다.</div>`);
    }

    const pager = $('.doc-pager');
    if (pager) pager.innerHTML = '<a class="prev" href="../modules/fireball-case-study.html"><span>← 이전</span><b>Fireball 예제</b><small>Skill부터 Status까지 이어지는 수직 슬라이스</small></a><a class="next" href="../modules/integration-map.html"><span>다음 →</span><b>통합 구조</b><small>시스템 간 의존성과 계약 방향</small></a>';

    const rail = $('.context-rail');
    if (rail) {
      rail.innerHTML = `
        <section class="context-card toc-card"><div class="context-title"><span>이 페이지</span><button data-print-page data-print type="button">인쇄</button></div><nav class="page-toc">
          <a href="#핵심-학습-포인트">핵심 학습 포인트</a><a href="#실행-아키텍처">실행 아키텍처</a><a href="#fireball-workbench">Fireball 실습</a><a href="#failure-probes">실패 안전성</a><a href="#context-cache-lab">조건부 캐시</a><a href="#migration-lab">스키마 마이그레이션</a><a href="#deterministic-envelope">결정론 envelope</a><a href="#학습-정리">학습 정리</a>
        </nav></section>
        <section class="context-card"><div class="context-title"><span>연결 학습</span></div><div class="related-links"><a href="../modules/fireball-case-study.html"><span>사례</span><b>Fireball 예제</b></a><a href="../modules/integration-map.html"><span>구조</span><b>통합 구조</b></a><a href="../modules/core-runtime.html"><span>기반</span><b>Core Runtime</b></a></div></section>
        <a class="readiness-card runtime-side-cta" href="#fireball-workbench"><span>직접 확인</span><b>Replay를 실행한다</b><small>같은 입력 · 같은 trace</small><i>↓</i></a>`;
    }

    const headingLabels = {
      'fireball-workbench': 'Fireball 리플레이 실습',
      'failure-probes': '실패 안전성 실습',
      'context-cache-lab': '조건부 스탯 캐시 실습',
      'migration-lab': '스키마 마이그레이션 실습'
    };
    Object.entries(headingLabels).forEach(([id, text]) => {
      const heading = document.getElementById(id);
      if (heading) heading.textContent = text;
    });

    const legends = ['리플레이 식별', '대상 스냅샷', '판정 정책'];
    $$('.runtime-form legend').forEach((legend, index) => {
      if (legends[index]) legend.textContent = legends[index];
    });
    const labels = ['루트 시드', '주문력', 'HP', '보호막', '화염 저항 %', '명중 확률 %', '치명타 확률 %', '화상 비율 %'];
    $$('.runtime-form fieldset label').forEach((label, index) => {
      if (labels[index]) setLeadingLabel(label, labels[index]);
    });

    replaceText(article, 'Decision trace', '판정 추적');
    replaceText(article, 'Committed events', '커밋된 이벤트');
    replaceText(article, 'post-commit only', '커밋 성공 후에만 발행');
    replaceText(article, 'Immutable outcome / plan JSON', '불변 결과 / 계획 JSON');
    replaceText(article, 'Final state JSON', '최종 상태 JSON');
    replaceText(article, 'Shared browser / Node kernel', '브라우저 / Node 공유 커널');
    $('[data-runtime-replay-status]')?.setAttribute('aria-live', 'polite');
  }

  function removeBrokenHashLinks() {
    $$('a[href^="#"]').forEach(link => {
      const raw = link.getAttribute('href') || '';
      if (raw === '#') return;
      let id = '';
      try { id = decodeURIComponent(raw.slice(1)); } catch (_) { id = raw.slice(1); }
      if (id && !document.getElementById(id)) link.remove();
    });
  }

  function synchronizeMobileToc() {
    const source = $('.page-toc');
    const target = $('[data-toc-dialog] nav');
    if (source && target) target.innerHTML = source.innerHTML;
  }

  function applyLearningCorrections() {
    replaceText(document.body, 'Release 2부터 Effect System은', '현재 구조에서 Effect System은');
    replaceText(
      document.body,
      'SkillRequest와 seed만으로 주요 전투 결과를 재현할 수 있어야 한다.',
      '입력 스냅샷, Definition·공식·수치 정책 버전, 대상 정렬 규칙과 seed를 묶은 replay envelope로 주요 결과를 재현할 수 있어야 한다.'
    );
    replaceText(
      document.body,
      '전투 로그 재현, 리플레이, 시뮬레이션 테스트를 생각하면 EffectContext에 randomSeed를 포함하는 편이 좋다. 그래야 같은 입력으로 같은 결과를 재현할 수 있다.',
      '전투 로그 재현, 리플레이, 시뮬레이션 테스트를 위해서는 randomSeed뿐 아니라 Definition·공식·입력 스냅샷·대상 정렬·수치 정책 버전을 함께 묶은 replay envelope를 기록해야 한다.'
    );
  }

  function postCoreLocalization() {
    const metricLabels = new Map([
      ['Decision', '판정'], ['Resolved', '저항 적용 피해'], ['Shield', '보호막'],
      ['HP damage', 'HP 피해'], ['Burn', '화상'], ['Final HP', '최종 HP']
    ]);
    $$('.runtime-metrics > div > span').forEach(span => {
      const key = span.textContent.trim();
      if (metricLabels.has(key)) span.textContent = metricLabels.get(key);
    });

    const calculatorLabels = {
      'calc-base': '기본값', 'calc-flat': '고정 가산', 'calc-inc': '증가 %',
      'calc-more': '독립 배율 %', 'calc-clamp': '최대 제한'
    };
    Object.entries(calculatorLabels).forEach(([id, text]) => {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) label.textContent = text;
    });
    const result = $('.calc .result');
    if (result) result.textContent = result.textContent.replace('Final Value', '최종값');
  }

  filterSearchData();
  pruneNavigation();
  const sanitized = sanitizeExcludedPage();

  if (!sanitized) {
    if (currentFile === 'index.html') curateHome();
    if (currentFile === 'modules/runtime-reference.html') curateRuntime();
    applyLearningCorrections();
  }

  removeBrokenHashLinks();
  synchronizeMobileToc();

  const core = document.createElement('script');
  core.src = `${prefix}assets/js/app-core.js`;
  core.async = false;
  core.onload = postCoreLocalization;
  core.onerror = () => console.error('GSF core interaction script could not be loaded.');
  document.body.appendChild(core);
})();
