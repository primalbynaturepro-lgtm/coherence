#!/usr/bin/env python3
"""make-icons.py — the app icon, the tab icon and the launch screens, drawn from one small piece of SVG.

The icon is the breathing ring, cut in three like the ring of the three daily sessions, on the app's black, with a gold
point at its centre. Run it again after changing the drawing:

    python3 scripts/make-icons.py

Needs Playwright with a Chromium (the same one the tests use). Writes:
    assets/icons/favicon.svg, favicon-32.png, apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png
    assets/splash/<w>x<h>.png                 one launch screen per iPhone size
    scripts/splash-links.html                 the <link rel="apple-touch-startup-image"> lines lift.py puts in index.html
"""
import math, os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICONS = os.path.join(ROOT, 'assets', 'icons')
SPLASH = os.path.join(ROOT, 'assets', 'splash')
BG, GOLD, GOLD_HI, GOLD_LO, CREAM = '#0A0908', '#D9AA52', '#F3D9A0', '#A67C32', '#F4EDDC'


def arc(cx, cy, r, a0, a1):
    p = lambda a: (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
    (x0, y0), (x1, y1) = p(a0), p(a1)
    return 'M%.2f %.2f A%d %d 0 0 1 %.2f %.2f' % (x0, y0, r, r, x1, y1)


def ring_svg(size=1024, radius=320, stroke=68, glow=True, rounded=False, id_='c'):
    """the mark on a square of `size`: three arcs (same geometry as the app's small session rings) and a point in the middle"""
    c = size / 2
    k = size / 1024.0
    arcs = ''.join('<path d="%s"/>' % arc(c, c, radius * k, -90 + i * 120 + 14, -90 + (i + 1) * 120 - 14) for i in range(3))
    bg = '<rect width="%d" height="%d"%s fill="%s"/>' % (size, size, (' rx="%d"' % round(size * 0.22)) if rounded else '', BG)
    halo = ('<circle cx="%g" cy="%g" r="%g" fill="url(#h%s)"/>' % (c, c, 520 * k, id_)) if glow else ''
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">'
        '<defs>'
        '<radialGradient id="h%s" cx="50%%" cy="50%%" r="50%%"><stop offset="0" stop-color="%s" stop-opacity=".20"/><stop offset=".62" stop-color="%s" stop-opacity=".05"/><stop offset="1" stop-color="%s" stop-opacity="0"/></radialGradient>'
        '<linearGradient id="g%s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%s"/><stop offset=".55" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>'
        '</defs>%s%s'
        '<g fill="none" stroke="url(#g%s)" stroke-width="%g" stroke-linecap="round">%s</g>'
        '<circle cx="%g" cy="%g" r="%g" fill="%s"/>'
        '</svg>'
    ) % (size, size, size, size, id_, GOLD, GOLD, GOLD, id_, GOLD_HI, GOLD, GOLD_LO, bg, halo, id_, stroke * k, arcs, c, c, 34 * k, GOLD_HI)


# launch screens (CSS px width, height, device pixel ratio) — the iPhones in use today; an unknown model gets the black of the app
SPLASHES = [
    (430, 932, 3), (440, 956, 3), (393, 852, 3), (402, 874, 3), (390, 844, 3), (428, 926, 3), (375, 812, 3), (414, 896, 3), (414, 896, 2), (375, 667, 2),
]


def splash_html(w, h):
    s = min(w, h) * 0.30
    return ('<!doctype html><meta charset="utf-8"><style>'
            '@font-face{font-family:F;src:url(../assets/fonts/fraunces-500.woff2) format("woff2");font-weight:500}'
            'html,body{margin:0;height:100%%;background:%s}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:%dpx}'
            '.w{font:500 %dpx/1 F,Georgia,serif;color:%s;letter-spacing:.01em}svg{display:block}'
            '</style>%s<div class="w">Cohérence</div>') % (BG, round(min(w, h) * 0.05), round(min(w, h) * 0.085), CREAM, ring_svg(round(s), glow=True, id_='s').replace('width="%d" height="%d"' % (round(s), round(s)), 'width="%d" height="%d"' % (round(s), round(s))))


def main():
    os.makedirs(ICONS, exist_ok=True); os.makedirs(SPLASH, exist_ok=True)
    with open(os.path.join(ICONS, 'favicon.svg'), 'w', encoding='utf-8') as f:
        f.write(ring_svg(256, radius=80, stroke=17, glow=False, rounded=True, id_='f').replace('viewBox="0 0 256 256" width="256" height="256"', 'viewBox="0 0 256 256"'))
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get('CHROMIUM') or ('/opt/pw-browsers/chromium' if os.path.exists('/opt/pw-browsers/chromium') else None), args=['--no-sandbox', '--allow-file-access-from-files'])
        def shot(html, w, h, dpr, out, file_name=None):
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr)
            page = ctx.new_page()
            if file_name:
                path = os.path.join(HERE, file_name)
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(html)
                page.goto('file://' + path)
                page.evaluate('document.fonts.ready')
                page.wait_for_timeout(300)
                page.screenshot(path=out)
                os.remove(path)
            else:
                page.set_content('<style>html,body{margin:0;background:%s}</style>' % BG + html)
                page.screenshot(path=out)
            ctx.close()
        for name, size, glow in (('apple-touch-icon.png', 180, True), ('icon-192.png', 192, True), ('icon-512.png', 512, True), ('icon-maskable-512.png', 512, True)):
            svg = ring_svg(size, glow=glow, id_='i')
            if 'maskable' in name:                                       # the system may cut a circle out of the middle 80%: keep the ring well inside
                svg = ring_svg(size, radius=270, stroke=58, glow=glow, id_='m')
            shot(svg, size, size, 1, os.path.join(ICONS, name))
        shot(ring_svg(32, radius=300, stroke=96, glow=False, id_='t'), 32, 32, 1, os.path.join(ICONS, 'favicon-32.png'))
        links = []
        for (w, h, d) in SPLASHES:
            name = '%dx%d.png' % (w * d, h * d)
            shot(splash_html(w, h), w, h, d, os.path.join(SPLASH, name), file_name='_splash.html')
            links.append('<link rel="apple-touch-startup-image" media="(device-width: %dpx) and (device-height: %dpx) and (-webkit-device-pixel-ratio: %d) and (orientation: portrait)" href="/assets/splash/%s">' % (w, h, d, name))
        b.close()
    with open(os.path.join(HERE, 'splash-links.html'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(links) + '\n')
    print('icons:', sorted(os.listdir(ICONS)))
    print('splash:', sorted(os.listdir(SPLASH)))


if __name__ == '__main__':
    main()
