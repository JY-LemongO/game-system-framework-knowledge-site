#!/usr/bin/env python3
from pathlib import Path
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
import json, sys

ROOT = Path(__file__).resolve().parents[2]
pages = json.loads((ROOT/'source/site-map.json').read_text(encoding='utf-8'))
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
    browser=p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
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
            page.close()
        context.close()

    context=browser.new_context(viewport={'width':1440,'height':1000})
    page=context.new_page(); runtime_errors=[]
    page.on('pageerror', lambda exc: runtime_errors.append(str(exc)))
    page.set_content(inline_page('modules/runtime-reference.html'), wait_until='load')
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
    page.locator('#command-input').fill('Runtime Reference')
    page.wait_for_timeout(80)
    check(page.locator('.command-result').count()>=1,'global-search:runtime-result')
    page.keyboard.press('Escape')
    page.locator('img.zoomable').first.click()
    check(page.locator('[data-diagram-modal]').evaluate('el => el.open'),'diagram:modal-open')
    page.keyboard.press('Escape')
    context.close(); browser.close()

report={'status':'pass' if not errors else 'fail','checks':len(checks),'passed':sum(1 for item in checks if item['pass']),'errors':errors}
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if errors else 0)
