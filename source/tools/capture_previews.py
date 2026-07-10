#!/usr/bin/env python3
from pathlib import Path
from bs4 import BeautifulSoup
from urllib.parse import unquote
from playwright.sync_api import sync_playwright
import base64, mimetypes

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'PREVIEW'; OUT.mkdir(exist_ok=True)
CSS=(ROOT/'assets/css/site.css').read_text(encoding='utf-8')
SCRIPT_MAP={name:(ROOT/'assets/js'/name).read_text(encoding='utf-8') for name in ('search-index.js','runtime-kernel.js','app.js')}

def data_uri(path):
    mime=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    return f'data:{mime};base64,'+base64.b64encode(path.read_bytes()).decode('ascii')

def inline_page(file):
    path=ROOT/file
    soup=BeautifulSoup(path.read_text(encoding='utf-8'),'html.parser')
    for link in list(soup.select('link[rel="stylesheet"]')):
        style=soup.new_tag('style'); style.string=CSS; link.replace_with(style)
    for script in list(soup.select('script[src]')):
        name=Path(script.get('src','')).name
        if name in SCRIPT_MAP:
            replacement=soup.new_tag('script'); replacement.string=SCRIPT_MAP[name]; script.replace_with(replacement)
        else: script.decompose()
    for image in soup.select('img[src]'):
        raw=unquote(image['src'].split('?',1)[0])
        target=(path.parent/raw).resolve()
        if target.exists() and target.is_file(): image['src']=data_uri(target)
    return '<!DOCTYPE html>\n'+str(soup)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    context=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1)
    page=context.new_page(); page.set_content(inline_page('modules/runtime-reference.html'),wait_until='load'); page.wait_for_timeout(250)
    page.screenshot(path=str(OUT/'runtime-reference-desktop.png'),full_page=False)
    page.add_style_tag(content='.topbar,.system-dock,.mobile-bar,.context-rail,.scroll-progress,.skip-link{display:none!important}.page-shell{padding-top:0!important}.doc-main{padding-top:0!important}')
    page.locator('[data-runtime-lab]').screenshot(path=str(OUT/'runtime-workbench-desktop.png'))
    for key in ('duplicate','conflict','rollback'): page.locator(f'[data-runtime-check="{key}"]').click()
    box=page.locator('.probe-grid')
    box.screenshot(path=str(OUT/'runtime-hardening-probes.png'))
    page.locator('[data-runtime-cache-probe]').screenshot(path=str(OUT/'runtime-context-cache.png'))
    page.locator('[data-runtime-migration-probe]').screenshot(path=str(OUT/'runtime-schema-migration.png'))
    context.close()

    context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1)
    page=context.new_page(); page.set_content(inline_page('modules/runtime-reference.html'),wait_until='load'); page.wait_for_timeout(250)
    page.screenshot(path=str(OUT/'runtime-reference-mobile.png'),full_page=False)
    page.add_style_tag(content='.topbar,.system-dock,.mobile-bar,.context-rail,.scroll-progress,.skip-link{display:none!important}.page-shell{padding-top:0!important}.doc-main{padding-top:0!important}')
    page.locator('[data-runtime-lab]').screenshot(path=str(OUT/'runtime-workbench-mobile.png'))
    context.close(); browser.close()

for file in sorted(OUT.glob('*.png')):
    print(file.name, file.stat().st_size)
