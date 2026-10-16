#!/usr/bin/env python3
"""
lift.py — lifts the screens and the kit of the drawing (v0/duo-phone.html) into the app.

    python3 scripts/lift.py --drawing <path to duo-phone.html>

The drawing is the app's authority on every screen and every word (LE DESSIN EST L'APP). This script reads it
and writes, next to itself:
    index.html            the template + the shipped screens
    css/app.css           the drawing's kit, minus what belongs to the bench (prototype chips, trays, the
                          three decision screens' own styles, the bench's phone frame)
    assets/fonts/*.woff2  the three fonts, decoded from the drawing
    assets/rings/*.mp4    the two Blender loops of ring A, decoded from the .b64 files beside the drawing

WHAT IS LEFT OUT, and why (each is a line in DECISIONS.md):
    - the "Prototype v0" chip on every screen, the dashed trays ("Prototype · et si…", "Temps ×1"), and every
      button that carries `data-cant` (the six shortcuts that skip a wait): they exist to walk a drawing, the
      app has no use for them;
    - the three decision screens `anneaux`, `kit`, `carte`;
    - `hors-ligne`: nothing goes online in this build (his answer 10 c), so the screen could never be reached
      and its words ("Your numbers live online") would be false. It comes back with the online store.

WHAT IS CHANGED, and why: the PATCHES below. Each one asserts that it matched exactly the number of times it
is expected to, so a redrawn drawing that moves a word makes this script fail loudly instead of shipping a
half-lifted screen.
"""
import argparse, base64, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DROP_SCREENS = {'anneaux', 'kit', 'carte', 'hors-ligne'}

# ─────────────────────────────────────────────────── css pruning
DENY = re.compile(r'\.(proto-chip|tray|trow|tchip|twin|col|chips|sws|sw|ksample|tys|ty|tsample|brow|rings|mstage|mbox|'
                  r'count|tiles|tile|dot|tl|ad|copyout|k)(?![\w-])|\.rl-|data-gold')
DENY_KEYFRAMES = {'k-mpush', 'k-msheet', 'k-mswap', 'k-mwait'}

def split_top(text, sep=','):
    out, depth, cur = [], 0, ''
    for ch in text:
        if ch in '([': depth += 1
        elif ch in ')]': depth -= 1
        if ch == sep and depth == 0:
            out.append(cur); cur = ''
        else:
            cur += ch
    out.append(cur)
    return out

def blocks(css):
    """split a css text into top-level items: ('comment', text) | ('rule', prelude, body)"""
    i, n, items = 0, len(css), []
    while i < n:
        if css[i].isspace():
            i += 1; continue
        if css.startswith('/*', i):
            j = css.index('*/', i) + 2
            items.append(('comment', css[i:j])); i = j; continue
        j = css.index('{', i)
        prelude = css[i:j].strip()
        depth, k = 1, j + 1
        while depth:
            ch = css[k]
            if ch == '{': depth += 1
            elif ch == '}': depth -= 1
            k += 1
        items.append(('rule', prelude, css[j + 1:k - 1])); i = k
    return items

def prune(css):
    out = []
    for it in blocks(css):
        if it[0] == 'comment':
            out.append(it[1]); continue
        _, prelude, body = it
        if prelude.startswith('@keyframes'):
            if prelude.split()[1] in DENY_KEYFRAMES: continue
            out.append('%s{%s}' % (prelude, body)); continue
        if prelude.startswith('@font-face'):
            out.append('%s{%s}' % (prelude, body)); continue
        if prelude.startswith('@media') or prelude.startswith('@supports'):
            inner = prune(body)
            if inner.strip(): out.append('%s{%s}' % (prelude, inner))
            continue
        keep = [s for s in split_top(prelude) if not DENY.search(s)]
        if keep:
            out.append('%s{%s}' % (','.join(x.strip() for x in keep), body))
    return '\n'.join(out)

# ─────────────────────────────────────────────────── screens
def expect(name, got, want):
    if got != want:
        sys.exit('lift: patch %r matched %d times, expected %d' % (name, got, want))

def patch_all(html, name, old, new, count):
    expect(name, html.count(old), count)
    return html.replace(old, new)

def patch_re(html, name, pattern, repl, count, flags=re.S):
    got = len(re.findall(pattern, html, flags))
    expect(name, got, count)
    return re.sub(pattern, repl, html, flags=flags)

def start_tag_patch(html, addr, fn):
    """rewrite the start tag of the element whose data-id is addr; exactly one"""
    pat = re.compile(r'<[a-z0-9]+\b[^>]*\bdata-id="%s"[^>]*>' % re.escape(addr))
    found = pat.findall(html)
    expect('start tag ' + addr, len(found), 1)
    return pat.sub(lambda m: fn(m.group(0)), html, count=1)

def drop_attr(tag, attr):
    return re.sub(r'\s%s="[^"]*"' % re.escape(attr), '', tag)

def set_attr(tag, attr, val):
    if re.search(r'\s%s="' % re.escape(attr), tag):
        return re.sub(r'(\s%s=")[^"]*(")' % re.escape(attr), lambda m: m.group(1) + val + m.group(2), tag)
    return tag[:-1] + ' %s="%s">' % (attr, val)

I_BACK = ('<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" '
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>')
I_FWD = ('<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" '
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>')

def lift_screen(sid, html):
    # 1. the bench's own furniture
    html = re.sub(r'<button class="chip proto-chip"[^>]*>Prototype v0</button>', '', html)
    html = re.sub(r'<div class="tray"[^>]*>.*?</div></div>', '', html, flags=re.S)
    # the two dots buttons of the code screens stop being doors: the bench typed 2580 for the tester
    html = re.sub(r'<button class="dots ([^"]*)" type="button" data-id="([^"]+)" data-how="push" onclick="window.go\(\'qui\'\)" '
                  r'data-cant="[^"]*" aria-label="([^"]*)">(.*?)</button>',
                  lambda m: '<div class="dots %s" data-id="%s" data-how="dead" role="img" aria-label="%s">%s</div>'
                            % (m.group(1), m.group(2), m.group(3), m.group(4)), html, flags=re.S)
    # every remaining button that carries data-cant is a bench shortcut that skips a wait
    html = re.sub(r'<button[^>]*\bdata-cant="[^"]*"[^>]*>.*?</button>', '', html, flags=re.S)
    html = re.sub(r'\sdata-cant="[^"]*"', '', html)
    # 2. doors: onclick="window.go('x')" becomes data-go="x"
    html = re.sub(r'\sonclick="window\.go\(\'([a-z0-9-]+)\'\)"', r' data-go="\1"', html)
    return html

def patch_screens(screens):
    """screens: dict id -> html (already lifted). Returns the same dict, patched."""
    # who: the tap opens the profile, then goes to accueil or test-intro (or shows chargement when the load is slow)
    for a in ('qui/adri', 'qui/mehdi'):
        screens['qui'] = start_tag_patch(screens['qui'], a, lambda t: drop_attr(t, 'data-go'))
    # the finger screens: Begin waits for a steady pulse, then starts (or lands on one of the three failure screens)
    for sid in ('test-doigt', 'seance-doigt'):
        screens[sid] = start_tag_patch(screens[sid], sid + '/begin',
                                       lambda t: set_attr(drop_attr(t, 'data-go'), 'data-do', 'fingerBegin'))
    # accueil: the week card needs a session, the heart card needs a reading
    screens['accueil'] = start_tag_patch(screens['accueil'], 'accueil/week', lambda t: set_attr(t, 'data-when', '!nosessions'))
    screens['accueil'] = start_tag_patch(screens['accueil'], 'accueil/heart', lambda t: set_attr(t, 'data-when', '!noreadings'))
    # progres: the three metric cards need a reading; the "nothing here" note shows without one
    for k in ('rest', 'var', 'coh'):
        screens['progres'] = start_tag_patch(screens['progres'], 'progres/card-' + k, lambda t: set_attr(t, 'data-when', '!noreadings'))
    screens['progres'] = start_tag_patch(screens['progres'], 'progres/empty', lambda t: set_attr(t, 'data-when', 'noreadings'))
    # progres: real weeks on the axis, a month that moves, a calendar the script fills
    screens['progres'] = patch_all(screens['progres'], 'axis from', '<span>10 Aug</span>', '<span data-bind="wkFrom">10 Aug</span>', 3)
    screens['progres'] = patch_all(screens['progres'], 'axis to', '<span>28 Sep</span>', '<span data-bind="wkTo">28 Sep</span>', 3)
    screens['progres'] = patch_re(screens['progres'], 'calendar', r'<div class="cal" data-id="progres/calendar" data-how="dead">.*?</div>',
                                  '<div class="cal" data-id="progres/calendar" data-how="dead"></div>', 1)
    screens['progres'] = patch_all(
        screens['progres'], 'month label', '<p class="lbl">September 2026</p>',
        '<div class="calnav" data-id="progres/calnav" data-how="dead">'
        '<button class="ib" type="button" data-id="progres/prev-month" data-how="swap" data-do="calStep:-1" aria-label="Previous month">%s</button>'
        '<p class="lbl" data-bind="calTitle">September 2026</p>'
        '<button class="ib" type="button" data-id="progres/next-month" data-how="swap" data-do="calStep:1" aria-label="Next month">%s</button></div>'
        % (I_BACK, I_FWD), 1)
    # the "goes online when the connection is back" lines belong to a network that this build does not use
    for sid, k in (('fin-matin', 'fin-matin'), ('fin-seance', 'fin-seance')):
        screens[sid] = patch_re(screens[sid], 'saved line ' + sid, r'<p class="fine center" data-id="%s/saved"[^>]*>.*?</p>' % k, '', 1)
    # "today" is today, whatever day that is
    for sid in list(screens):
        screens[sid] = screens[sid].replace('data-do="day:29"', 'data-do="day:today"')
    # settings: the breathing ring, version A (a film) or B (drawn live) — kept on a bench screen in the drawing (his answer 6 b: B first, A selectable)
    screens['reglages'] = patch_all(
        screens['reglages'], 'ring row', '<div class="rw tap" role="button" tabindex="0" data-id="reglages/rhythm"',
        '<div class="rw tap" role="button" tabindex="0" data-id="reglages/ring" data-how="swap" data-do="ringToggle"><span class="rw-l"><b>Breathing ring</b>'
        '<small data-bind="rgRing">Version B · drawn live</small></span></div>'
        '<div class="rw tap" role="button" tabindex="0" data-id="reglages/rhythm"', 1)
    # settings: the numbers live on this phone (his answer 10 c); the version is real
    screens['reglages'] = patch_all(screens['reglages'], 'data row', '<small>Saved online, in your profile</small>', '<small data-bind="rgData">Saved on this phone</small>', 1)
    # (the version line is also the quiet door to the workshop: the pulse lab and the copy of the data — it looks the same as before)
    screens['reglages'] = patch_all(screens['reglages'], 'version', 'Cohérence · v0 prototype',
                                    '<a class="verlink" href="/lab/index.html">Cohérence · <span data-bind="version">1</span></a>', 1)
    return screens

# ─────────────────────────────────────────────────── main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--drawing', required=True, help='path to v0/duo-phone.html')
    ap.add_argument('--rings', help='folder holding ring-equal.b64 and ring-sigh.b64 (default: beside the drawing, one level up)')
    a = ap.parse_args()
    src = open(a.drawing, encoding='utf-8').read()

    # fonts and css
    m = re.search(r'<style>(.*?)</style>', src, re.S)
    css = m.group(1)
    fonts = {}
    def font_sub(mm):
        fam, weight, b = mm.group(1), mm.group(2), mm.group(3)
        slug = '%s-%s' % (fam.lower(), weight)
        fonts[slug] = base64.b64decode(b)
        return "@font-face{font-family:'%s';font-style:normal;font-weight:%s;font-display:block;src:url(/assets/fonts/%s.woff2) format('woff2')}" % (fam, weight, slug)
    css = re.sub(r"@font-face\{font-family:'(\w+)';font-style:normal;font-weight:(\d+);font-display:block;src:url\(data:font/woff2;base64,([A-Za-z0-9+/=]+)\) format\('woff2'\)\}",
                 font_sub, css)
    assert len(fonts) == 3, 'expected 3 fonts, got %d' % len(fonts)
    os.makedirs(os.path.join(ROOT, 'assets', 'fonts'), exist_ok=True)
    for slug, data in fonts.items():
        open(os.path.join(ROOT, 'assets', 'fonts', slug + '.woff2'), 'wb').write(data)
    css = prune(css)
    os.makedirs(os.path.join(ROOT, 'css'), exist_ok=True)
    open(os.path.join(ROOT, 'css', 'app.css'), 'w', encoding='utf-8').write(
        '/* lifted from the drawing by scripts/lift.py — never hand-edited; the app\'s own additions are in extra.css */\n' + css + '\n')

    # rings (ring A, the Blender loops)
    rdir = a.rings or os.path.dirname(os.path.dirname(os.path.abspath(a.drawing)))
    os.makedirs(os.path.join(ROOT, 'assets', 'rings'), exist_ok=True)
    for name in ('equal', 'sigh'):
        p = os.path.join(rdir, 'ring-%s.b64' % name)
        if os.path.exists(p):
            open(os.path.join(ROOT, 'assets', 'rings', 'ring-%s.mp4' % name), 'wb').write(base64.b64decode(open(p).read().strip()))
        else:
            print('lift: %s not found, ring A video not written' % p)

    # screens
    secs = re.findall(r'<section class="(scr[^"]*)" id="s-([^"]+)" data-id="([^"]+)">(.*?)</section>', src, re.S)
    assert len(secs) == 41, len(secs)
    screens, klass, order = {}, {}, []
    for cls, sid, did, inner in secs:
        if sid in DROP_SCREENS: continue
        screens[sid] = lift_screen(sid, inner); klass[sid] = cls; order.append(sid)
    screens = patch_screens(screens)
    body = ''.join('<section class="%s" id="s-%s" data-id="%s">%s</section>\n' % (klass[s].strip(), s, s, screens[s]) for s in order)
    for bad in ('proto-chip', 'data-cant', 'window.go', 'class="tray"', 'onclick='):
        assert bad not in body, 'lift left %r in the screens' % bad

    splash = open(os.path.join(HERE, 'splash-links.html')).read().strip() if os.path.exists(os.path.join(HERE, 'splash-links.html')) else ''
    tpl = open(os.path.join(HERE, 'index.template.html'), encoding='utf-8').read()
    html = tpl.replace('%%SCREENS%%', body).replace('%%SPLASH%%', splash)
    open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8').write(html)
    ids = re.findall(r'\bdata-id="([^"]+)"', html)
    print('lift: %d screens · %d addresses · index.html %d bytes · app.css %d bytes' % (len(order), len(set(ids)), len(html), len(css)))
    print('lift: screens: ' + ' '.join(order))

if __name__ == '__main__':
    main()
