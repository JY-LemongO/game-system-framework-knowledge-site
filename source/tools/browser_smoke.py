#!/usr/bin/env python3
from pathlib import Path
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
import json, re, shutil, sys

ROOT = Path(__file__).resolve().parents[2]
pages = json.loads((ROOT/'source/site-map.json').read_text(encoding='utf-8'))
errors=[]
checks=[]

CORE_CSS=(ROOT/'assets/css/site-core.css').read_text(encoding='utf-8')
GUARD_CSS=(ROOT/'assets/css/site.css').read_text(encoding='utf-8')
GUARD_CSS=re.sub(r'^\s*@import\s+url\([^)]*\);\s*', '', GUARD_CSS, count=1)
CSS=CORE_CSS+'\n'+GUARD_CSS

CORE_SCRIPT=(ROOT/'assets/js/app-core.js').read_text(encoding='utf-8')
BOOTSTRAP=(ROOT/'assets/js/app.js').read_text(encoding='utf-8')
LOADER="""  const core = document.createElement('script');
  core.src = `${prefix}assets/js/app-core.js`;
  core.async = false;
  core.onload = postCoreLocalization;
  core.onerror = () => console.error('GSF core interaction script could not be loaded.');
  document.body.appendChild(core);"""
INLINE_LOADER=f"  (0, eval)({json.dumps(CORE_SCRIPT)});\n  postCoreLocalization();"
if LOADER not in BOOTSTRAP:
    raise RuntimeError('app.js core loader block changed; update smoke inlining contract')
INLINE_APP=BOOTSTRAP.replace(LOADER, INLINE_LOADER)

SCRIPT_MAP={
    'search-index.js':(ROOT/'assets/js/search-index.js').read_text(encoding='utf-8'),
    'runtime-kernel.js':(ROOT/'assets/js/runtime-kernel.js').read_text(encoding='utf-8'),
    'app.js':INLINE_APP,
}
PIXEL='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"%3E%3Crect width="1200" height="700" fill="%23f3f4f6"/%3E%3C/svg%3E'
EXCLUDED=('phase3-readiness.html','implementation-roadmap.html','skill-combat-next.html','quality-audit.html')
EXCLUDED_ENTRY_KEYS={
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
    'modules/runtime-reference.html|#p3f-equipment',
}


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
    executable=shutil.which('chromium') or shutil.which('chromium-browser') or p.chromium.executable_path
    browser=p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
    for viewport_name, viewport in [('desktop',{'width':1440,'height':1000}),('mobile',{'width':390,'height':844})]:
        context=browser.new_context(viewport=viewport, device_scale_factor=1)
        for item in pages:
            page=context.new_page()
            js_errors=[]
            page.on('pageerror', lambda exc, bucket=js_errors: bucket.append(str(exc)))
            page.set_content(inline_page(item['file']), wait_until='load')
            page.wait_for_timeout(100)
            overflow=page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check(overflow <= 1, f'{viewport_name}:{item["file"]}:no-horizontal-overflow')
            check(not js_errors, f'{viewport_name}:{item["file"]}:no-js-errors' + (f' ({js_errors})' if js_errors else ''))
            check(page.locator('h1').count()==1, f'{viewport_name}:{item["file"]}:one-h1')
            excluded_links=sum(page.locator(f'a[href*="{name}"]').count() for name in EXCLUDED)
            check(excluded_links==0, f'{viewport_name}:{item["file"]}:no-non-learning-links')
            page.close()
        context.close()

    context=browser.new_context(viewport={'width':1440,'height':1000})

    home=context.new_page(); home_errors=[]
    home.on('pageerror', lambda exc: home_errors.append(str(exc)))
    home.set_content(inline_page('index.html'), wait_until='load')
    home.wait_for_timeout(120)
    home_text=home.locator('body').inner_text()
    check('이번 2차 확장 범위' not in home_text,'home:no-release-history')
    check('다음 확장 방향' not in home_text,'home:no-future-roadmap')
    check(home.locator('#런타임-실습').count()==1,'home:runtime-learning-entry')
    check(not home_errors,'home:no-js-errors' + (f' ({home_errors})' if home_errors else ''))
    home.close()

    page=context.new_page(); runtime_errors=[]
    page.on('pageerror', lambda exc: runtime_errors.append(str(exc)))
    page.set_content(inline_page('modules/runtime-reference.html'), wait_until='load')
    page.wait_for_timeout(180)
    check(page.locator('h1').inner_text().replace('\n',' ')=='런타임 아키텍처 실습','runtime:learning-title')
    check(page.locator('#다음-생산-구현').count()==0,'runtime:no-future-implementation')
    check(page.locator('#source-contracts').count()==0,'runtime:no-artifact-index')
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

    learning_pages=page.evaluate("window.__GSF_SITE__.pages.map(item => item.file)")
    check(not any(any(name in file for name in EXCLUDED) for file in learning_pages),'global-search:no-excluded-pages')
    learning_entry_keys=set(page.evaluate("window.__GSF_SITE__.entries.map(item => `${item.file}|${item.anchor || ''}`)"))
    check(not (learning_entry_keys & EXCLUDED_ENTRY_KEYS),'global-search:no-excluded-sections')
    check('modules/runtime-reference.html|#학습-정리' in learning_entry_keys,'global-search:learning-summary-indexed')

    page.locator('[data-search-open]').first.click()
    check(page.locator('[data-command-palette]').evaluate('el => el.open'),'global-search:dialog-open')
    page.locator('#command-input').fill('런타임 아키텍처')
    page.wait_for_timeout(80)
    check(page.locator('.command-result').count()>=1,'global-search:runtime-learning-result')
    page.keyboard.press('Escape')

    page.evaluate('window.__printCalls=0; window.print=()=>window.__printCalls++')
    page.locator('[data-print-page]').click()
    check(page.evaluate('window.__printCalls')==1,'print:context-button-works')

    page.locator('img.zoomable').first.click()
    check(page.locator('[data-diagram-modal]').evaluate('el => el.open'),'diagram:modal-open')
    page.keyboard.press('Escape')
    context.close(); browser.close()

report={'status':'pass' if not errors else 'fail','checks':len(checks),'passed':sum(1 for item in checks if item['pass']),'errors':errors}
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if errors else 0)
