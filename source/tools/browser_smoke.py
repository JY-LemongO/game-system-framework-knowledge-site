#!/usr/bin/env python3
from pathlib import Path
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
from urllib.parse import urlparse
import json, sys
from browser_launch import launch_chromium

ROOT = Path(__file__).resolve().parents[2]
pages = json.loads((ROOT/'source/site-map.json').read_text(encoding='utf-8'))
RUNTIME_PAGE = next((item for item in pages if item['file'] == 'modules/runtime-reference.html'), None)
RUNTIME_FILE = RUNTIME_PAGE['file'] if RUNTIME_PAGE else None
CORE_PAGES = sorted(
    (item for item in pages if item.get('learningTrack') == 'core'),
    key=lambda item: item.get('learningOrder', 0),
)
CORE_FILES = [item['file'] for item in CORE_PAGES]
SYSTEM_NAV_FILES = {
    'index.html', 'modules/core-runtime.html', 'modules/stat-system.html',
    'modules/effect-system.html', 'modules/skill-action-system.html',
    'modules/combat-resolution-system.html', 'modules/status-system.html',
    'modules/integration-map.html',
}
MOBILE_NAV_FILES = {'index.html', 'modules/integration-map.html'}
errors=[]
checks=[]
CSS=(ROOT/'assets/css/site.css').read_text(encoding='utf-8')
SCRIPT_MAP={
    'search-index.js':(ROOT/'assets/js/search-index.js').read_text(encoding='utf-8'),
    'runtime-kernel.js':(ROOT/'assets/js/runtime-kernel.js').read_text(encoding='utf-8'),
    'app.js':(ROOT/'assets/js/app.js').read_text(encoding='utf-8'),
}
PIXEL='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"%3E%3Crect width="1200" height="700" fill="%23f3f4f6"/%3E%3C/svg%3E'

def inline_page(file):
    soup=BeautifulSoup((ROOT/file).read_text(encoding='utf-8'),'html.parser')
    for link in list(soup.select('link[rel="stylesheet"]')):
        style=soup.new_tag('style'); style.string=CSS; link.replace_with(style)
    for script in list(soup.select('script[src]')):
        name=Path(script.get('src','')).name
        if name in SCRIPT_MAP:
            replacement=soup.new_tag('script'); replacement.string=SCRIPT_MAP[name]; script.replace_with(replacement)
        else:
            script.decompose()
    for image in soup.select('img[src]'):
        image['src']=PIXEL
    return '<!DOCTYPE html>\n'+str(soup)

def check(condition, label):
    checks.append({'label':label,'pass':bool(condition)})
    if not condition: errors.append(label)

with sync_playwright() as p:
    browser=launch_chromium(p)
    for viewport_name, viewport in [('desktop',{'width':1440,'height':1000}),('mobile',{'width':390,'height':844})]:
        context=browser.new_context(viewport=viewport, device_scale_factor=1)
        for item in pages:
            page=context.new_page()
            js_errors=[]
            page.on('pageerror', lambda exc, bucket=js_errors: bucket.append(str(exc)))
            page.set_content(inline_page(item['file']), wait_until='load')
            page.wait_for_timeout(60)
            overflow=page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check(overflow <= 1, f'{viewport_name}:{item["file"]}:no-horizontal-overflow')
            check(not js_errors, f'{viewport_name}:{item["file"]}:no-js-errors' + (f' ({js_errors})' if js_errors else ''))
            check(page.locator('h1').count()==1, f'{viewport_name}:{item["file"]}:one-h1')
            reading_time=page.locator('[data-reading-time]')
            if reading_time.count():
                check(reading_time.inner_text().startswith('학습 약 '), f'{viewport_name}:{item["file"]}:learning-time-label')
            if page.locator('.page-toc a').count():
                check(page.locator('.page-toc a[aria-current="location"]').count()>=1, f'{viewport_name}:{item["file"]}:toc-current-location')
            if page.locator('#article-content table').count():
                first_table=page.locator('#article-content table').first
                check(bool(first_table.get_attribute('aria-labelledby')), f'{viewport_name}:{item["file"]}:table-labelled')
                check(first_table.locator('th:not([scope])').count()==0, f'{viewport_name}:{item["file"]}:table-header-scope')
            if item['file'] in SYSTEM_NAV_FILES:
                check(page.locator('.system-dock a[aria-current="page"]').count()==1, f'{viewport_name}:{item["file"]}:system-nav-current')
            if viewport_name == 'mobile':
                check(not page.locator('.system-dock').is_visible(), f'{viewport_name}:{item["file"]}:system-dock-hidden')
                check(page.locator('.mobile-bar').is_visible(), f'{viewport_name}:{item["file"]}:single-bottom-nav-visible')
                check(page.locator('[data-focus-toggle]').is_visible(), f'{viewport_name}:{item["file"]}:focus-toggle-reachable')
                check(not page.locator('.breadcrumb').is_visible(), f'{viewport_name}:{item["file"]}:breadcrumb-hidden')
                if item['file'] in MOBILE_NAV_FILES:
                    check(page.locator('.mobile-bar a[aria-current="page"]').count()==1, f'{viewport_name}:{item["file"]}:mobile-nav-current')
            page.close()
        context.close()

    # Learning progress needs a stable HTTP origin so localStorage survives reload and navigation.
    context=browser.new_context(viewport={'width':1440,'height':1000})
    page=context.new_page(); progress_errors=[]
    page.on('pageerror', lambda exc: progress_errors.append(str(exc)))

    def fulfill_learning_site(route):
        file=urlparse(route.request.url).path.lstrip('/') or 'index.html'
        if file in {item['file'] for item in pages}:
            route.fulfill(status=200, content_type='text/html; charset=utf-8', body=inline_page(file))
        else:
            route.fulfill(status=404, content_type='text/plain', body='Not found')

    context.route('http://gsf.test/**', fulfill_learning_site)
    page.goto('http://gsf.test/index.html', wait_until='load')
    page.wait_for_timeout(80)
    check(page.locator('[data-learning-progress]').is_visible(),'learning-progress:home-visible')
    check(page.locator('[data-learning-progress-count]').inner_text()=='0 / 6','learning-progress:initial-count')
    check(page.locator('[data-learning-progress-meter]').evaluate('el => el.value')==0,'learning-progress:initial-meter')
    check(page.locator('[data-learning-resume]').get_attribute('href').endswith('modules/core-runtime.html'),'learning-progress:initial-core-link')

    page.goto('http://gsf.test/modules/core-runtime.html', wait_until='load')
    page.wait_for_timeout(80)
    check(page.locator('details[data-checkpoint-question]').count()==3,'learning-checkpoint:three-questions')
    first_summary=page.locator('details[data-checkpoint-question] summary').first
    first_summary.focus(); page.keyboard.press('Enter')
    check(page.locator('details[data-checkpoint-question]').first.evaluate('el => el.open'),'learning-checkpoint:keyboard-opens-answer')
    check(first_summary.evaluate('el => getComputedStyle(el).outlineStyle')!='none','learning-checkpoint:focus-visible')
    complete=page.locator('[data-learning-complete]')
    complete.focus(); page.keyboard.press('Enter')
    check(complete.get_attribute('aria-pressed')=='true','learning-progress:core-completed')
    saved=page.evaluate("JSON.parse(localStorage.getItem('gsf-learning-progress-v1'))")
    check(saved.get('version')==1 and saved.get('completed')==[CORE_FILES[0]] and saved.get('lastVisited')==CORE_FILES[0],'learning-progress:stored-contract')
    page.reload(wait_until='load'); page.wait_for_timeout(80)
    check(page.locator('[data-learning-complete]').get_attribute('aria-pressed')=='true','learning-progress:completion-survives-reload')

    page.goto('http://gsf.test/index.html', wait_until='load'); page.wait_for_timeout(80)
    check(page.locator('[data-learning-progress-count]').inner_text()=='1 / 6','learning-progress:home-count-after-completion')
    check(page.locator('[data-learning-progress-meter]').evaluate('el => el.value')==1,'learning-progress:home-meter-after-completion')
    check(page.locator('[data-learning-resume]').get_attribute('href').endswith('modules/stat-system.html'),'learning-progress:resume-next-incomplete')

    page.evaluate("localStorage.setItem('gsf-learning-progress-v1', '{broken')")
    page.reload(wait_until='load'); page.wait_for_timeout(80)
    check(page.locator('[data-learning-progress-count]').inner_text()=='0 / 6','learning-progress:corrupt-state-recovers')
    page.evaluate("([files]) => localStorage.setItem('gsf-learning-progress-v1', JSON.stringify({version:1, completed:files, lastVisited:files[files.length-1]}))", [CORE_FILES])
    page.reload(wait_until='load'); page.wait_for_timeout(80)
    check(page.locator('[data-learning-progress-count]').inner_text()=='6 / 6','learning-progress:all-complete-count')
    check(page.locator('[data-learning-resume]').get_attribute('href').endswith('modules/integration-map.html'),'learning-progress:all-complete-integration-link')
    page.once('dialog', lambda dialog: dialog.accept())
    page.locator('[data-learning-reset]').click()
    check(page.locator('[data-learning-progress-count]').inner_text()=='0 / 6','learning-progress:reset-count')
    check(page.evaluate("localStorage.getItem('gsf-learning-progress-v1')") is None,'learning-progress:reset-storage')

    page.set_viewport_size({'width':320,'height':844})
    page.goto('http://gsf.test/modules/core-runtime.html', wait_until='load'); page.wait_for_timeout(80)
    for details in page.locator('details[data-checkpoint-question]').all():
        details.locator('summary').click()
    overflow=page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    check(overflow <= 1,'learning-checkpoint:mobile-320-no-horizontal-overflow')
    complete_box=page.locator('[data-learning-complete]').bounding_box()
    check(bool(complete_box) and complete_box['width'] <= 320 and complete_box['height'] >= 44,'learning-progress:mobile-complete-control-size')
    check(not progress_errors,'learning-progress:no-page-errors' + (f' ({progress_errors})' if progress_errors else ''))
    context.close()

    blocked_context=browser.new_context(viewport={'width':390,'height':844})
    blocked_context.add_init_script("""
      for (const method of ['getItem', 'setItem', 'removeItem']) {
        Storage.prototype[method] = function () { throw new DOMException('Storage blocked', 'SecurityError'); };
      }
    """)
    blocked_context.route('http://gsf.test/**', fulfill_learning_site)
    blocked_page=blocked_context.new_page(); blocked_errors=[]
    blocked_page.on('pageerror', lambda exc: blocked_errors.append(str(exc)))
    blocked_page.goto('http://gsf.test/index.html', wait_until='load'); blocked_page.wait_for_timeout(80)
    check(blocked_page.locator('[data-learning-progress]').is_visible(),'learning-progress:blocked-storage-panel-visible')
    check('저장할 수 없습니다' in blocked_page.locator('[data-learning-progress-status]').inner_text(),'learning-progress:blocked-storage-warning')
    blocked_page.goto('http://gsf.test/modules/core-runtime.html', wait_until='load'); blocked_page.wait_for_timeout(80)
    blocked_complete=blocked_page.locator('[data-learning-complete]')
    blocked_complete.click()
    check(blocked_complete.get_attribute('aria-pressed')=='false','learning-progress:blocked-storage-no-false-completion')
    check('저장할 수 없습니다' in blocked_page.locator('[data-learning-status]').inner_text(),'learning-progress:blocked-storage-toggle-warning')
    check(not blocked_errors,'learning-progress:blocked-storage-no-page-errors' + (f' ({blocked_errors})' if blocked_errors else ''))
    blocked_context.close()

    nojs_context=browser.new_context(viewport={'width':390,'height':844}, java_script_enabled=False)
    nojs_context.route('http://gsf.test/**', fulfill_learning_site)
    nojs_page=nojs_context.new_page()
    nojs_page.goto('http://gsf.test/modules/core-runtime.html', wait_until='load')
    check(nojs_page.locator('#article-content').is_visible(),'learning-progress:nojs-core-content-visible')
    check(nojs_page.locator('[data-learning-checkpoint]').is_visible(),'learning-progress:nojs-checkpoint-visible')
    check(nojs_page.locator('[data-learning-completion]').count()==0,'learning-progress:nojs-dynamic-completion-absent')
    nojs_page.goto('http://gsf.test/index.html', wait_until='load')
    check(not nojs_page.locator('[data-learning-progress]').is_visible(),'learning-progress:nojs-panel-hidden')
    check(nojs_page.locator('.system-card').count()==6,'learning-progress:nojs-learning-links-visible')
    nojs_context.close()

    if not RUNTIME_FILE:
        raise RuntimeError('site-map does not declare modules/runtime-reference.html')
    context=browser.new_context(viewport={'width':1440,'height':1000})
    page=context.new_page(); runtime_errors=[]
    page.on('pageerror', lambda exc: runtime_errors.append(str(exc)))
    page.set_content(inline_page(RUNTIME_FILE), wait_until='load')
    page.wait_for_timeout(120)
    check(page.locator('[data-runtime-replay-status]').inner_text()=='MATCH','runtime:initial-replay-match')
    check(page.locator('[data-runtime-cache-status]').inner_text()=='PASS','runtime:cache-pass')
    check(page.locator('[data-runtime-migration-status]').inner_text()=='PASS','runtime:migration-pass')
    for key in ('duplicate','conflict','rollback'):
        page.locator(f'[data-runtime-check="{key}"]').click()
        check(page.locator(f'[data-runtime-check-output="{key}"]').inner_text().startswith('PASS'),f'runtime:{key}-probe-pass')
    page.locator('[data-runtime-key="rootSeed"]').fill('101')
    page.locator('[data-runtime-form] button[type="submit"]').click()
    check(page.locator('[data-runtime-replay-status]').inner_text()=='MATCH','runtime:changed-input-replay-match')
    check(page.locator('[data-runtime-trace] li').count()>=8,'runtime:trace-rendered')
    check(page.locator('[data-runtime-events] li').count()>=2,'runtime:events-rendered')
    check(not runtime_errors,'runtime:no-js-errors' + (f' ({runtime_errors})' if runtime_errors else ''))
    page.locator('[data-search-open]').first.click()
    check(page.locator('[data-command-palette]').evaluate('el => el.open'),'global-search:dialog-open')
    check(page.locator('#command-input').get_attribute('role')=='combobox','global-search:combobox-role')
    check(page.locator('#command-input').get_attribute('aria-expanded')=='true','global-search:expanded-state')
    check(page.locator('#command-input').get_attribute('aria-autocomplete')=='list','global-search:list-autocomplete')
    page.locator('#command-input').fill(RUNTIME_PAGE['title'])
    page.wait_for_timeout(80)
    runtime_results=page.locator('.command-result').filter(has_text=RUNTIME_PAGE['title'])
    check(runtime_results.count()>=1,'global-search:runtime-title-result')
    check(bool(page.locator('#command-result-status').inner_text()),'global-search:result-count-status')
    page.keyboard.press('Escape')
    check(page.locator('#command-input').get_attribute('aria-expanded')=='false','global-search:collapsed-state')
    page.evaluate('window.__printCalled=false; window.print=()=>{window.__printCalled=true}')
    page.locator('[data-print-page]').first.click()
    check(page.evaluate('window.__printCalled'),'print:data-print-page-listener')
    page.locator('img.zoomable').first.click()
    check(page.locator('[data-diagram-modal]').evaluate('el => el.open'),'diagram:modal-open')
    page.keyboard.press('Escape')
    context.close(); browser.close()

report={'status':'pass' if not errors else 'fail','checks':len(checks),'passed':sum(1 for item in checks if item['pass']),'errors':errors}
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if errors else 0)
