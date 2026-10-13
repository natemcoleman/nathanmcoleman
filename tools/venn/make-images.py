"""Regenerates static/venn/og.png, apple-touch-icon.png and favicon-32.png.

Requires Python Playwright with Chromium:  python3 tools/venn/make-images.py
"""
import pathlib
from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).resolve().parent
out = here.parent.parent / 'static' / 'venn'
page_url = (here / 'images.html').as_uri()

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1200, 'height': 630})
    page.goto(page_url + '?type=og')
    page.wait_for_function("document.title === 'ready'")
    page.locator('#og').screenshot(path=str(out / 'og.png'))
    for size, name in [(180, 'apple-touch-icon.png'), (32, 'favicon-32.png')]:
        page.set_viewport_size({'width': size, 'height': size})
        page.goto(page_url + '?size=%d' % size)
        page.wait_for_function("document.title === 'ready'")
        page.locator('#icon').screenshot(path=str(out / name))
    browser.close()
print('wrote images to', out)
