(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const body = document.body;
  const prefix = body?.dataset.prefix || '';
  const currentFile = body?.dataset.pageFile || 'index.html';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dialogOpeners = new WeakMap();

  const safeStorage = {
    get(key, fallback = null) {
      try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (_) { /* private/file mode */ }
    }
  };

  function normalise(value = '') {
    return String(value)
      .normalize('NFKC')
      .toLocaleLowerCase('ko-KR')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/[_/\\|·•—–-]+/g, ' ')
      .replace(/[^\p{L}\p{N}+#.% ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;inset:auto auto -1000px -1000px;opacity:0';
      document.body.appendChild(area);
      area.select();
      try {
        if (!document.execCommand('copy')) throw new Error('copy failed');
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        area.remove();
      }
    });
  }

  function closeDialog(dialog, returnFocus = true) {
    if (!dialog?.open) return;
    dialog.close();
    if (returnFocus) {
      const opener = dialogOpeners.get(dialog);
      if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
    }
  }

  function openDialog(dialog, opener = document.activeElement) {
    if (!dialog) return;
    $$('dialog[open]').forEach(other => {
      if (other !== dialog) closeDialog(other, false);
    });
    dialogOpeners.set(dialog, opener);
    if (!dialog.open) dialog.showModal();
  }

  function initialiseDialogs() {
    $$('[data-dialog-close]').forEach(button => {
      button.addEventListener('click', () => closeDialog(button.closest('dialog')));
    });

    $$('dialog').forEach(dialog => {
      dialog.addEventListener('cancel', event => {
        event.preventDefault();
        closeDialog(dialog);
      });
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const inside = event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom;
        if (!inside || event.target === dialog) closeDialog(dialog);
      });
    });

    const drawer = $('[data-site-drawer]');
    $$('[data-menu-open]').forEach(button => {
      button.addEventListener('click', () => openDialog(drawer, button));
    });

    const tocDialog = $('[data-toc-dialog]');
    $$('[data-toc-open]').forEach(button => {
      button.addEventListener('click', () => openDialog(tocDialog, button));
    });
    $$('[data-toc-dialog] a').forEach(link => {
      link.addEventListener('click', () => closeDialog(tocDialog, false));
    });
  }

  function initialiseTheme() {
    const html = document.documentElement;
    const button = $('[data-theme-toggle]');
    const label = $('[data-theme-label]');
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const order = ['system', 'light', 'dark'];
    const labels = { system: '시스템 테마', light: '라이트 테마', dark: '다크 테마' };

    function resolvedTheme(mode) {
      return mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    }

    function apply(mode, persist = true) {
      const next = order.includes(mode) ? mode : 'system';
      const resolved = resolvedTheme(next);
      html.dataset.theme = next;
      html.classList.toggle('dark', resolved === 'dark');
      if (label) label.textContent = labels[next];
      if (button) {
        button.setAttribute('aria-label', `${labels[next]} 사용 중. 다음 테마로 전환`);
        button.dataset.themeState = next;
      }
      const themeMeta = $('meta[name="theme-color"]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
      themeMeta.content = resolved === 'dark' ? '#111319' : '#f5f5f2';
      if (persist) safeStorage.set('gsf-theme', next);
    }

    apply(safeStorage.get('gsf-theme', html.dataset.theme || 'system'), false);
    button?.addEventListener('click', () => {
      const current = html.dataset.theme || 'system';
      apply(order[(order.indexOf(current) + 1) % order.length]);
    });
    media.addEventListener?.('change', () => {
      if ((html.dataset.theme || 'system') === 'system') apply('system', false);
    });
  }

  function initialiseFocusMode() {
    const button = $('[data-focus-toggle]');
    if (!button) return;
    const saved = safeStorage.get('gsf-focus', 'off') === 'on';

    function apply(active, persist = true) {
      body.classList.toggle('is-focus', active);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? '집중 모드 종료' : '집중 모드 전환');
      if (persist) safeStorage.set('gsf-focus', active ? 'on' : 'off');
    }

    apply(saved, false);
    button.addEventListener('click', () => apply(!body.classList.contains('is-focus')));
  }

  function initialiseScrollProgress() {
    const bar = $('.scroll-progress span');
    if (!bar) return;
    let ticking = false;
    function update() {
      const root = document.documentElement;
      const max = Math.max(1, root.scrollHeight - root.clientHeight);
      const progress = Math.min(1, Math.max(0, root.scrollTop / max));
      bar.style.width = `${(progress * 100).toFixed(2)}%`;
      ticking = false;
    }
    function requestUpdate() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }
    addEventListener('scroll', requestUpdate, { passive: true });
    addEventListener('resize', requestUpdate, { passive: true });
    update();
  }

  function initialiseReadingTime() {
    const output = $('[data-reading-time]');
    const article = $('#article-content');
    if (!output || !article) return;
    const clone = article.cloneNode(true);
    $$('pre, code, svg, .doc-pager', clone).forEach(node => node.remove());
    const text = clone.textContent.replace(/\s+/g, ' ').trim();
    const latinWords = (text.match(/[A-Za-z0-9_+#.-]+/g) || []).length;
    const koreanChars = (text.match(/[가-힣]/g) || []).length;
    const otherWords = Math.max(0, text.split(/\s+/).length - latinWords);
    const units = latinWords + otherWords + koreanChars / 2.4;
    const minutes = Math.max(1, Math.round(units / 240));
    output.textContent = `약 ${minutes}분`;
    output.title = '본문 기준 예상 읽기 시간';
  }

  function initialiseHeadingAnchors() {
    const article = $('#article-content');
    if (!article) return;
    $$('h2[id], h3[id]', article).forEach(heading => {
      if ($('.heading-anchor', heading)) return;
      const headingTitle = heading.textContent.trim();
      const button = document.createElement('button');
      button.className = 'heading-anchor';
      button.type = 'button';
      button.setAttribute('aria-label', `${headingTitle} 섹션 링크 복사`);
      button.title = '섹션 링크 복사';
      button.textContent = '#';
      button.addEventListener('click', async event => {
        event.stopPropagation();
        const url = `${location.href.split('#')[0]}#${encodeURIComponent(heading.id)}`;
        try {
          await copyText(url);
          history.replaceState(null, '', `#${heading.id}`);
          button.textContent = '✓';
          button.setAttribute('aria-label', '섹션 링크가 복사됨');
          setTimeout(() => {
            button.textContent = '#';
            button.setAttribute('aria-label', `${headingTitle} 섹션 링크 복사`);
          }, 1300);
        } catch (_) {
          location.hash = heading.id;
        }
      });
      heading.appendChild(button);
    });
  }

  function initialiseTocSpy() {
    const links = [...$$('.page-toc a'), ...$$('[data-toc-dialog] nav a')];
    const map = new Map();
    links.forEach(link => {
      const id = decodeURIComponent((link.getAttribute('href') || '').replace(/^#/, ''));
      if (!id) return;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(link);
    });
    const headings = [...map.keys()].map(id => document.getElementById(id)).filter(Boolean);
    if (!headings.length) return;

    function activate(id) {
      links.forEach(link => link.classList.remove('is-active'));
      (map.get(id) || []).forEach(link => link.classList.add('is-active'));
    }

    if (!('IntersectionObserver' in window)) {
      activate(headings[0].id);
      return;
    }

    const visible = new Map();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => visible.set(entry.target.id, entry));
      const candidates = headings
        .map(heading => visible.get(heading.id))
        .filter(entry => entry?.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
      if (candidates[0]) activate(candidates[0].target.id);
      else {
        const above = headings.filter(h => h.getBoundingClientRect().top < 180);
        activate((above.at(-1) || headings[0]).id);
      }
    }, { rootMargin: '-18% 0px -68% 0px', threshold: [0, 0.01, 1] });
    headings.forEach(heading => observer.observe(heading));
    activate((location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1))))?.id || headings[0].id);
  }

  function inferCodeLabel(pre) {
    const code = $('code', pre);
    const className = code?.className || pre.className || '';
    const classMatch = className.match(/(?:language-|lang-)([\w#+.-]+)/i);
    if (classMatch) return classMatch[1];
    const sample = (code?.textContent || pre.textContent || '').trim();
    if (/^(class|interface|enum|record|struct|public|private|protected|using|namespace)\b/m.test(sample)) return 'contract / pseudo code';
    if (/^(GET|POST|PUT|PATCH|DELETE)\s+\//m.test(sample)) return 'api';
    if (/^[\w.-]+:\s/m.test(sample) && !/[;{}]/.test(sample)) return 'data / schema';
    return 'example';
  }

  function initialiseCodeBlocks() {
    $$('#article-content pre').forEach(pre => {
      if (pre.parentElement?.classList.contains('codewrap')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'codewrap';
      pre.before(wrapper);
      wrapper.appendChild(pre);

      const head = document.createElement('div');
      head.className = 'code-head';
      const label = document.createElement('span');
      label.textContent = inferCodeLabel(pre);
      const button = document.createElement('button');
      button.className = 'code-copy';
      button.type = 'button';
      button.textContent = '복사';
      button.setAttribute('aria-label', '코드 복사');
      button.addEventListener('click', async () => {
        try {
          await copyText(pre.innerText);
          button.textContent = '복사됨';
          button.setAttribute('aria-label', '코드가 복사됨');
        } catch (_) {
          button.textContent = '복사 실패';
        }
        setTimeout(() => {
          button.textContent = '복사';
          button.setAttribute('aria-label', '코드 복사');
        }, 1400);
      });
      head.append(label, button);
      wrapper.prepend(head);
    });
  }

  function initialiseArchitectureLens() {
    $$('[data-architecture-lens]').forEach((lens, lensIndex) => {
      const tabs = $$('[data-lens-tab]', lens);
      const views = $$('[data-lens-view]', lens);
      if (!tabs.length || !views.length) return;

      tabs.forEach((tab, index) => {
        const key = tab.dataset.lensTab;
        const panel = views.find(view => view.dataset.lensView === key);
        const tabId = `lens-${lensIndex}-tab-${key}`;
        const panelId = `lens-${lensIndex}-panel-${key}`;
        tab.id = tabId;
        tab.setAttribute('aria-controls', panelId);
        tab.tabIndex = index === 0 ? 0 : -1;
        if (panel) {
          panel.id = panelId;
          panel.setAttribute('aria-labelledby', tabId);
        }
      });

      function switchTo(key, focus = false) {
        const update = () => {
          tabs.forEach(tab => {
            const active = tab.dataset.lensTab === key;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            if (active && focus) tab.focus();
          });
          views.forEach(view => {
            const active = view.dataset.lensView === key;
            view.classList.toggle('is-active', active);
            view.hidden = !active;
          });
        };
        update();
      }

      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => switchTo(tab.dataset.lensTab));
        tab.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          let next = index;
          if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = tabs.length - 1;
          switchTo(tabs[next].dataset.lensTab, true);
        });
      });
    });
  }

  function initialiseFilters() {
    $$('[data-filter]').forEach(input => {
      const group = document.querySelector(`[data-group="${CSS.escape(input.dataset.filter)}"]`);
      if (!group) return;
      const items = $$('[data-item]', group);
      const status = document.createElement('span');
      status.className = 'sr-only';
      status.setAttribute('aria-live', 'polite');
      input.insertAdjacentElement('afterend', status);

      function filter() {
        const query = normalise(input.value);
        const tokens = query.split(' ').filter(Boolean);
        let count = 0;
        items.forEach(item => {
          const haystack = normalise(item.dataset.item || item.textContent);
          const visible = tokens.every(token => haystack.includes(token));
          item.hidden = !visible;
          if (visible) count += 1;
        });
        status.textContent = query ? `${count}개 결과` : `${items.length}개 항목`;
      }
      input.addEventListener('input', filter);
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape' && input.value) {
          input.value = '';
          filter();
        }
      });
      filter();
    });
  }

  function subsequenceScore(query, value) {
    if (!query || !value) return 0;
    let qi = 0;
    let streak = 0;
    let score = 0;
    for (let i = 0; i < value.length && qi < query.length; i += 1) {
      if (value[i] === query[qi]) {
        qi += 1;
        streak += 1;
        score += 1 + streak * 0.35;
      } else {
        streak = 0;
      }
    }
    return qi === query.length ? score / Math.max(value.length, 1) : 0;
  }

  function scoreSearchEntry(entry, query) {
    const title = normalise(entry.title);
    const short = normalise(entry.short);
    const desc = normalise(entry.desc);
    const text = normalise(entry.text);
    const group = normalise(`${entry.group || ''} ${entry.level || ''}`);
    const haystack = `${title} ${short} ${desc} ${text} ${group}`;
    const tokens = query.split(' ').filter(Boolean);
    if (!tokens.length) return entry.type === 'page' ? 20 : 0;
    let score = 0;
    for (const token of tokens) {
      let tokenScore = 0;
      if (title === token) tokenScore = Math.max(tokenScore, 150);
      if (title.startsWith(token)) tokenScore = Math.max(tokenScore, 110);
      if (title.includes(token)) tokenScore = Math.max(tokenScore, 80);
      if (short.startsWith(token)) tokenScore = Math.max(tokenScore, 75);
      if (short.includes(token)) tokenScore = Math.max(tokenScore, 65);
      if (desc.includes(token)) tokenScore = Math.max(tokenScore, 42);
      if (text.includes(token)) tokenScore = Math.max(tokenScore, 30);
      if (group.includes(token)) tokenScore = Math.max(tokenScore, 20);
      if (!tokenScore && token.length > 1) {
        const fuzzy = Math.max(subsequenceScore(token, title), subsequenceScore(token, short));
        if (fuzzy > 0.08) tokenScore = 8 + fuzzy * 35;
      }
      if (!tokenScore) return 0;
      score += tokenScore;
    }
    if (entry.type === 'page') score += 10;
    if (entry.file === currentFile) score += 5;
    return score;
  }

  function initialiseCommandPalette() {
    const dialog = $('[data-command-palette]');
    const input = $('.command-input', dialog || document);
    const results = $('.command-results', dialog || document);
    const data = window.__GSF_SITE__ || {};
    const entries = Array.isArray(data.entries) ? data.entries : (Array.isArray(data.pages) ? data.pages.map(page => ({ ...page, type: 'page', anchor: '', text: page.key })) : []);
    if (!dialog || !input || !results) return;
    let activeIndex = 0;
    let currentResults = [];

    const commandKey = navigator.platform?.toLowerCase().includes('mac') ? '⌘ K' : 'Ctrl K';
    $$('.command-trigger kbd, .drawer-search kbd').forEach(kbd => { kbd.textContent = commandKey; });

    function hrefFor(entry) {
      const anchor = entry.anchor || '';
      if (entry.file === currentFile && anchor) return anchor;
      return `${prefix}${entry.file}${anchor}`;
    }

    function makeResult(entry, index) {
      const link = document.createElement('a');
      link.className = 'command-result';
      link.id = `command-option-${index}`;
      link.href = hrefFor(entry);
      link.setAttribute('role', 'option');
      link.setAttribute('aria-selected', String(index === activeIndex));
      link.dataset.index = String(index);

      const type = document.createElement('span');
      type.textContent = entry.type === 'section' ? entry.level || 'SECTION' : entry.level || 'PAGE';
      const copy = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = entry.title || entry.short || 'Untitled';
      const description = document.createElement('small');
      description.textContent = entry.type === 'section'
        ? `${entry.short || ''}${entry.desc ? ` · ${entry.desc}` : ''}`
        : entry.desc || entry.group || '';
      copy.append(title, description);
      const arrow = document.createElement('i');
      arrow.textContent = '↵';
      link.append(type, copy, arrow);
      link.addEventListener('mouseenter', () => setActive(index, false));
      link.addEventListener('click', () => closeDialog(dialog, false));
      return link;
    }

    function setActive(index, scroll = true) {
      const options = $$('.command-result', results);
      if (!options.length) {
        activeIndex = 0;
        input.removeAttribute('aria-activedescendant');
        return;
      }
      activeIndex = Math.max(0, Math.min(index, options.length - 1));
      options.forEach((option, optionIndex) => {
        const active = optionIndex === activeIndex;
        option.classList.toggle('is-active', active);
        option.setAttribute('aria-selected', String(active));
      });
      input.setAttribute('aria-activedescendant', options[activeIndex].id);
      if (scroll) options[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function render(value = '') {
      const query = normalise(value);
      currentResults = entries
        .map(entry => ({ entry, score: scoreSearchEntry(entry, query) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || ((a.entry.type === 'page') === (b.entry.type === 'page') ? 0 : (a.entry.type === 'page' ? -1 : 1)) || String(a.entry.title).localeCompare(String(b.entry.title), 'ko'))
        .slice(0, query ? 18 : 12)
        .map(item => item.entry);
      activeIndex = 0;
      results.replaceChildren();
      if (!currentResults.length) {
        const empty = document.createElement('p');
        empty.className = 'command-empty';
        empty.textContent = '일치하는 문서나 섹션이 없습니다. 다른 핵심 용어로 검색해 보세요.';
        results.appendChild(empty);
        input.removeAttribute('aria-activedescendant');
        return;
      }
      const fragment = document.createDocumentFragment();
      currentResults.forEach((entry, index) => fragment.appendChild(makeResult(entry, index)));
      results.appendChild(fragment);
      setActive(0, false);
    }

    function open(opener) {
      const drawer = $('[data-site-drawer]');
      if (drawer?.open) closeDialog(drawer, false);
      openDialog(dialog, opener);
      input.value = '';
      render('');
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    }

    $$('[data-search-open]').forEach(button => button.addEventListener('click', () => open(button)));
    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog(dialog);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((activeIndex + 1) % Math.max(currentResults.length, 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((activeIndex - 1 + Math.max(currentResults.length, 1)) % Math.max(currentResults.length, 1));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setActive(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setActive(currentResults.length - 1);
      } else if (event.key === 'Enter' && currentResults[activeIndex]) {
        event.preventDefault();
        location.href = hrefFor(currentResults[activeIndex]);
        closeDialog(dialog, false);
      }
    });

    addEventListener('keydown', event => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open(document.activeElement);
      } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey && !dialog.open) {
        event.preventDefault();
        open(document.activeElement);
      }
    });

    render('');
  }

  function initialiseDiagramViewer() {
    const dialog = $('[data-diagram-modal]');
    const canvas = $('[data-diagram-canvas]', dialog || document);
    const modalImage = $('img', canvas || dialog || document);
    const title = $('#diagram-modal-title');
    const original = $('[data-open-original]', dialog || document);
    const resetButton = $('[data-zoom-reset]', dialog || document);
    const zoomIn = $('[data-zoom-in]', dialog || document);
    const zoomOut = $('[data-zoom-out]', dialog || document);
    if (!dialog || !canvas || !modalImage) return;

    let scale = 1;
    let x = 0;
    let y = 0;
    let dragging = false;
    let pointerStart = null;

    function applyTransform() {
      modalImage.style.left = `calc(50% + ${x}px)`;
      modalImage.style.top = `calc(50% + ${y}px)`;
      modalImage.style.transform = `translate(-50%, -50%) scale(${scale})`;
      canvas.classList.toggle('is-zoomed', scale > 1.01);
      if (resetButton) resetButton.textContent = `${Math.round(scale * 100)}%`;
    }

    function reset() {
      scale = 1;
      x = 0;
      y = 0;
      dragging = false;
      applyTransform();
    }

    function setScale(next, originX = canvas.clientWidth / 2, originY = canvas.clientHeight / 2) {
      const previous = scale;
      scale = Math.max(0.5, Math.min(5, next));
      if (scale === previous) return;
      const rect = canvas.getBoundingClientRect();
      const localX = originX - rect.left - rect.width / 2;
      const localY = originY - rect.top - rect.height / 2;
      const ratio = scale / previous;
      x = localX - (localX - x) * ratio;
      y = localY - (localY - y) * ratio;
      if (scale <= 1) { x = 0; y = 0; }
      applyTransform();
    }

    function metadataFor(image) {
      const container = image.closest('.diagram, .thumb') || image.parentElement;
      const heading = container?.querySelector('.dh strong, h3, h2');
      const sourceLink = container?.querySelector('.da a[href$=".svg"], .da a[href$=".png"], a[href$=".svg"], a[href$=".png"]');
      return {
        title: heading?.textContent.trim() || image.alt || 'Diagram',
        src: image.currentSrc || image.getAttribute('src'),
        original: sourceLink?.href || image.currentSrc || image.src
      };
    }

    function open(image) {
      const meta = metadataFor(image);
      if (!meta.src) return;
      reset();
      modalImage.src = meta.src;
      modalImage.alt = image.alt || meta.title;
      if (title) title.textContent = meta.title;
      if (original) original.href = meta.original;
      openDialog(dialog, image);
    }

    $$('img.zoomable, img[data-zoom]').forEach(image => {
      image.tabIndex = image.tabIndex >= 0 ? image.tabIndex : 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', `${image.alt || '다이어그램'} 크게 보기`);
      image.addEventListener('click', () => open(image));
      image.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open(image);
        }
      });
    });

    zoomIn?.addEventListener('click', () => setScale(scale + 0.25));
    zoomOut?.addEventListener('click', () => setScale(scale - 0.25));
    resetButton?.addEventListener('click', reset);
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      setScale(scale + (event.deltaY < 0 ? 0.18 : -0.18), event.clientX, event.clientY);
    }, { passive: false });

    canvas.addEventListener('pointerdown', event => {
      if (scale <= 1 || event.button !== 0) return;
      dragging = true;
      pointerStart = { pointerX: event.clientX, pointerY: event.clientY, x, y };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', event => {
      if (!dragging || !pointerStart) return;
      x = pointerStart.x + event.clientX - pointerStart.pointerX;
      y = pointerStart.y + event.clientY - pointerStart.pointerY;
      applyTransform();
    });
    function endDrag(event) {
      dragging = false;
      pointerStart = null;
      canvas.classList.remove('is-dragging');
      if (event?.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('dblclick', event => setScale(scale > 1 ? 1 : 2, event.clientX, event.clientY));
    modalImage.addEventListener('dragstart', event => event.preventDefault());
    dialog.addEventListener('close', () => {
      modalImage.removeAttribute('src');
      reset();
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === '+' || event.key === '=') setScale(scale + 0.25);
      if (event.key === '-') setScale(scale - 0.25);
      if (event.key === '0') reset();
    });
  }

  function initialiseCalculator() {
    const box = $('.calc');
    if (!box) return;
    if (!box.children.length) {
      const fields = [
        ['base', 'Base', 100],
        ['flat', 'Flat Add', 20],
        ['inc', 'Increase %', 30],
        ['more', 'More %', 20],
        ['clamp', 'Max Clamp', 9999]
      ];
      fields.forEach(([key, labelText, value]) => {
        const field = document.createElement('div');
        const id = `calc-${key}`;
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = labelText;
        const input = document.createElement('input');
        input.id = id;
        input.type = 'number';
        input.inputMode = 'decimal';
        input.step = 'any';
        input.value = String(value);
        input.dataset.calcKey = key;
        field.append(label, input);
        box.appendChild(field);
      });
      const result = document.createElement('output');
      result.className = 'result';
      result.setAttribute('aria-live', 'polite');
      box.appendChild(result);
      const note = document.createElement('p');
      note.className = 'calc-note';
      note.textContent = 'min(clamp, (base + flat) × (1 + increase/100) × (1 + more/100))';
      box.appendChild(note);
    }

    const result = $('.result', box);
    function calculate() {
      const values = {};
      $$('input[data-calc-key]', box).forEach(input => {
        values[input.dataset.calcKey] = Number.parseFloat(input.value) || 0;
      });
      const raw = (values.base + values.flat) * (1 + values.inc / 100) * (1 + values.more / 100);
      const finalValue = Math.min(values.clamp, raw);
      if (result) result.textContent = `Final Value = ${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(finalValue)}`;
    }
    box.addEventListener('input', calculate);
    calculate();
  }

  function initialiseSteppers() {
    $$('.stepper').forEach(stepper => {
      const buttons = $$('.steps button', stepper);
      const panelTitle = $('.panel h3', stepper);
      const panelText = $('.panel p', stepper);
      if (!buttons.length || !panelTitle || !panelText) return;
      const records = buttons.map(button => ({
        title: button.dataset.title || button.textContent.trim(),
        text: button.dataset.description || button.getAttribute('aria-description') || ''
      }));
      function show(index, focus = false) {
        buttons.forEach((button, buttonIndex) => {
          const active = index === buttonIndex;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
          button.tabIndex = active ? 0 : -1;
        });
        panelTitle.textContent = records[index].title;
        if (records[index].text) panelText.textContent = records[index].text;
        if (focus) buttons[index].focus();
      }
      buttons.forEach((button, index) => {
        button.type = 'button';
        button.addEventListener('click', () => show(index));
        button.addEventListener('keydown', event => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          let next = index;
          if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
          if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = buttons.length - 1;
          show(next, true);
        });
      });
      show(0);
    });
  }

  function initialisePrintAndImages() {
    $$('[data-print], .print-page').forEach(button => button.addEventListener('click', () => print()));
    $$('#article-content img').forEach((image, index) => {
      if (!image.hasAttribute('decoding')) image.decoding = 'async';
      if (!image.hasAttribute('loading') && index > 0) image.loading = 'lazy';
    });
    addEventListener('beforeprint', () => {
      $$('#article-content img').forEach(image => image.loading = 'eager');
    });
  }

  function initialiseCurrentNavigation() {
    const current = currentFile.replace(/^\.\//, '');
    $$('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || /^(?:https?:|mailto:|tel:|javascript:)/i.test(href)) return;
      const clean = href.split('#')[0].replace(/^\.\//, '').replace(/^\.\.\//, '');
      if (clean === current || (current.startsWith('modules/') && `modules/${clean.replace(/^modules\//, '')}` === current)) {
        if (link.closest('.top-nav, .drawer-groups')) link.setAttribute('aria-current', 'page');
      }
    });
  }

  function initialiseRuntimeReference() {
    const lab = $('[data-runtime-lab]');
    const G = window.GSFRuntime;
    if (!lab || !G) return;

    const format = value => new Intl.NumberFormat('ko-KR').format(value);
    const json = value => JSON.stringify(value, null, 2);
    const setText = (selector, value, root = document) => {
      const node = $(selector, root);
      if (node) node.textContent = String(value);
    };
    const numberValue = key => {
      const input = $(`[data-runtime-key="${key}"]`, lab);
      const value = Number(input?.value);
      return Number.isFinite(value) ? Math.trunc(value) : 0;
    };
    const percentBps = key => Math.max(0, Math.min(100, numberValue(key))) * 100;

    function inputFromForm() {
      const hp = Math.max(1, numberValue('targetHp'));
      const shield = Math.max(0, numberValue('shield'));
      return {
        rootSeed: Math.max(0, Math.min(0xffffffff, numberValue('rootSeed'))),
        caster: { spellPower: Math.max(0, numberValue('spellPower')) },
        target: {
          hp,
          maxHp: hp,
          shield,
          maxShield: Math.max(200, shield),
          fireResistanceBps: percentBps('resistancePercent')
        },
        skill: {
          hitChanceBps: percentBps('hitChancePercent'),
          critChanceBps: percentBps('critChancePercent')
        },
        burn: { ratioBps: percentBps('burnRatioPercent') },
        simulateStatusTicks: Boolean($('[data-runtime-key="simulateStatusTicks"]', lab)?.checked)
      };
    }

    function metric(label, value, detail = '') {
      const div = document.createElement('div');
      const span = document.createElement('span');
      const strong = document.createElement('strong');
      const small = document.createElement('small');
      span.textContent = label;
      strong.textContent = String(value);
      small.textContent = detail;
      div.append(span, strong, small);
      return div;
    }

    function renderReplay(result, replay) {
      const outcome = result.resolution.outcome;
      const target = result.finalState.entities[result.input.target.id];
      const metrics = $('[data-runtime-metrics]', lab);
      if (metrics) {
        metrics.replaceChildren(
          metric('Decision', outcome.hit ? (outcome.critical ? 'CRITICAL' : 'HIT') : 'MISS', `roll ${result.resolution.decisions.hitRollBps} / ${result.resolution.decisions.critRollBps}`),
          metric('Resolved', format(outcome.resolvedDamage), `raw ${format(outcome.rawDamage)}`),
          metric('Shield', format(outcome.shieldAbsorbed), `remaining ${format(target.resources.shield)}`),
          metric('HP damage', format(outcome.hpDamage), `impact HP ${format(outcome.targetHpAfter)}`),
          metric('Burn', format(result.outbox.filter(event => event.type === 'StatusTicked').reduce((sum, event) => sum + event.payload.hpDamage, 0)), `${result.statusAdvance.tickCount} committed ticks`),
          metric('Final HP', format(target.resources.hp), `${Object.keys(target.statuses).length} active status`)
        );
      }

      const replayOkay = replay.match && replay.traceMatch && replay.finalStateMatch;
      const status = $('[data-runtime-replay-status]', lab);
      if (status) {
        status.textContent = replayOkay ? 'MATCH' : 'DIVERGED';
        status.dataset.state = replayOkay ? 'pass' : 'fail';
      }
      setText('[data-runtime-replay-hash]', result.replayHash, lab);
      setText('[data-runtime-trace-hash]', result.traceHash, lab);
      setText('[data-runtime-trace-count]', `${result.trace.length} stages`, lab);
      const golden = $('[data-runtime-golden-hash]');
      if (golden) golden.textContent = `${result.replayHash.slice(0, 8)}…`;

      const traceList = $('[data-runtime-trace]', lab);
      if (traceList) {
        traceList.replaceChildren(...result.trace.map(record => {
          const li = document.createElement('li');
          const seq = document.createElement('span');
          const copy = document.createElement('div');
          const name = document.createElement('b');
          const detail = document.createElement('small');
          seq.textContent = String(record.sequence).padStart(2, '0');
          name.textContent = record.stage.replaceAll('_', ' ');
          detail.textContent = `tick ${record.tick} · ${Object.keys(record.payload || {}).slice(0, 3).join(' · ') || 'no payload'}`;
          copy.append(name, detail);
          li.append(seq, copy);
          return li;
        }));
      }

      const eventList = $('[data-runtime-events]', lab);
      if (eventList) {
        eventList.replaceChildren(...result.outbox.map((event, index) => {
          const li = document.createElement('li');
          const seq = document.createElement('span');
          const copy = document.createElement('div');
          const name = document.createElement('b');
          const detail = document.createElement('small');
          seq.textContent = String(index + 1).padStart(2, '0');
          name.textContent = event.type;
          detail.textContent = `tick ${event.occurredTick} · ${event.eventId.slice(-8)}`;
          copy.append(name, detail);
          li.append(seq, copy);
          return li;
        }));
      }
      setText('[data-runtime-plan]', json({ decisions: result.resolution.decisions, outcome, plan: result.resolution.plan }), lab);
      setText('[data-runtime-state]', json(result.finalState), lab);
    }

    function runReplay() {
      try {
        const input = inputFromForm();
        const result = G.runFireballScenario(input);
        const replay = G.verifyReplay(input);
        renderReplay(result, replay);
      } catch (error) {
        const status = $('[data-runtime-replay-status]', lab);
        if (status) {
          status.textContent = error.code || 'ERROR';
          status.dataset.state = 'fail';
        }
        setText('[data-runtime-plan]', json(error.toJSON ? error.toJSON() : { message: String(error) }), lab);
      }
    }

    const form = $('[data-runtime-form]', lab);
    form?.addEventListener('submit', event => {
      event.preventDefault();
      runReplay();
    });
    form?.addEventListener('reset', () => requestAnimationFrame(runReplay));

    const probes = {
      duplicate: () => {
        const result = G.demonstrateDuplicateCommand(inputFromForm());
        return { pass: result.duplicateDetected && result.stateUnchanged, code: result.error?.code, evidence: result.stateUnchanged ? 'state hash unchanged' : 'state changed' };
      },
      conflict: () => {
        const result = G.demonstrateVersionConflict(inputFromForm());
        return { pass: result.rejected && result.noPartialMutation, code: result.error?.code, evidence: result.noPartialMutation ? 'no partial mutation' : 'state changed' };
      },
      rollback: () => {
        const result = G.demonstrateAtomicRollback(inputFromForm());
        return { pass: result.rolledBack, code: result.error?.code, evidence: result.rolledBack ? 'working copy discarded' : 'partial state detected' };
      }
    };
    $$('[data-runtime-check]', document).forEach(button => {
      button.addEventListener('click', () => {
        const key = button.dataset.runtimeCheck;
        const output = $(`[data-runtime-check-output="${key}"]`);
        try {
          const result = probes[key]();
          if (output) {
            output.textContent = `${result.pass ? 'PASS' : 'FAIL'} · ${result.code} · ${result.evidence}`;
            output.dataset.state = result.pass ? 'pass' : 'fail';
          }
        } catch (error) {
          if (output) {
            output.textContent = `ERROR · ${error.code || error.message}`;
            output.dataset.state = 'fail';
          }
        }
      });
    });

    function runCacheProbe() {
      const root = $('[data-runtime-cache-probe]');
      if (!root) return;
      const cache = new G.ContextualStatCache({ maxEntries: 8 });
      let computes = 0;
      const evaluate = context => cache.evaluate({
        entityId: 'entity.caster',
        statId: 'stat.fire-damage',
        ownerVersion: 7,
        dependencies: ['target.id', 'target.tags', 'distanceBand'],
        context,
        compute: () => {
          computes += 1;
          return 100 + (context.target.tags.includes('status.burning') ? 30 : 0) + (context.distanceBand === 'far' ? 20 : 0);
        }
      });
      const firstContext = { target: { id: 'entity.target-a', tags: ['status.burning'] }, distanceBand: 'far' };
      const first = evaluate(firstContext);
      const repeated = evaluate({ distanceBand: 'far', target: { tags: ['status.burning'], id: 'entity.target-a' } });
      const other = evaluate({ target: { id: 'entity.target-b', tags: [] }, distanceBand: 'near' });
      const pattern = [first, repeated, other].map(item => item.cacheHit ? 'HIT' : 'MISS').join(' → ');
      setText('[data-runtime-cache-status]', pattern === 'MISS → HIT → MISS' ? 'PASS' : 'FAIL', root);
      const status = $('[data-runtime-cache-status]', root);
      if (status) status.dataset.state = pattern === 'MISS → HIT → MISS' ? 'pass' : 'fail';
      setText('[data-runtime-cache-pattern]', pattern, root);
      setText('[data-runtime-cache-computes]', computes, root);
      setText('[data-runtime-cache-values]', [first.value, repeated.value, other.value].join(' · '), root);
      setText('[data-runtime-cache-fingerprint]', first.fingerprint.hash, root);
      setText('[data-runtime-cache-details]', json({ dependencies: first.fingerprint.dependencies, first: { cacheHit: first.cacheHit, cacheKey: first.cacheKey, value: first.value }, repeated: { cacheHit: repeated.cacheHit, cacheKey: repeated.cacheKey, value: repeated.value }, otherTarget: { cacheHit: other.cacheHit, cacheKey: other.cacheKey, value: other.value }, cache: cache.stats() }), root);
    }
    $('[data-runtime-cache-run]')?.addEventListener('click', runCacheProbe);

    function runMigrationProbe() {
      const root = $('[data-runtime-migration-probe]');
      if (!root) return;
      const source = { schemaVersion: 1, playerId: 'player.demo', profile: { displayName: 'Aria' }, resources: { health: 420, mana: 95 }, inventory: ['item.ember-ring'] };
      const registry = new G.SchemaMigrationRegistry({ currentVersion: 3, minimumSupportedVersion: 1 });
      registry.register({ migrationId: 'migration.player.v1-v2', fromVersion: 1, toVersion: 2, migrate: document => ({ ...document, schemaVersion: 2, resources: { hp: document.resources.health, mana: document.resources.mana } }) });
      registry.register({ migrationId: 'migration.player.v2-v3', fromVersion: 2, toVersion: 3, migrate: document => ({ schemaVersion: 3, playerId: document.playerId, profile: document.profile, resources: document.resources, inventory: document.inventory, migratedAtPolicy: 'logical-version-only' }) });
      try {
        const before = G.canonicalStringify(source);
        const result = registry.migrate(source);
        const sourceUnchanged = before === G.canonicalStringify(source);
        setText('[data-runtime-migration-status]', sourceUnchanged && result.appliedMigrations.length === 2 ? 'PASS' : 'FAIL', root);
        const status = $('[data-runtime-migration-status]', root);
        if (status) status.dataset.state = sourceUnchanged ? 'pass' : 'fail';
        setText('[data-runtime-migration-before]', json(source), root);
        setText('[data-runtime-migration-after]', json(result.document), root);
        const list = $('[data-runtime-migration-audit]', root);
        if (list) list.replaceChildren(...result.appliedMigrations.map(step => {
          const li = document.createElement('li');
          const title = document.createElement('b');
          const hashes = document.createElement('code');
          title.textContent = `${step.migrationId} · v${step.fromVersion} → v${step.toVersion}`;
          hashes.textContent = `${step.beforeHash} → ${step.afterHash}`;
          li.append(title, hashes);
          return li;
        }));
      } catch (error) {
        setText('[data-runtime-migration-status]', error.code || 'ERROR', root);
      }
    }
    $('[data-runtime-migration-run]')?.addEventListener('click', runMigrationProbe);

    runReplay();
    runCacheProbe();
    runMigrationProbe();
  }

  initialiseDialogs();
  initialiseTheme();
  initialiseFocusMode();
  initialiseScrollProgress();
  initialiseReadingTime();
  initialiseHeadingAnchors();
  initialiseTocSpy();
  initialiseCodeBlocks();
  initialiseArchitectureLens();
  initialiseFilters();
  initialiseCommandPalette();
  initialiseDiagramViewer();
  initialiseCalculator();
  initialiseSteppers();
  initialisePrintAndImages();
  initialiseCurrentNavigation();
  initialiseRuntimeReference();
})();
