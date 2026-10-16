This folder is the Cohérence app that guides three five-minute coherence-breathing sessions a day and reads the heart through the phone's back camera, for Mehdi and Adri.

It is an iPhone web app (added to the home screen from Chrome): black and gold, English on screen, no server behind it. Everything a person does is kept on their phone (`DECISIONS.md` D50). The drawing it was lifted from is on the bench at `~/Work/PxN/redline/showcase/coherence/` (41 screens, `v0/duo-phone.html`; its decisions are D1–D49 there). This app's own decisions are D50 onward in `DECISIONS.md` here, in French like the drawing's. The brief is `~/Work/specs/coherence-fiche.md`.

## What it does

- **The test of the rhythm**, from day one: five rhythms (6.5 · 6 · 5.5 · 5 · 4.5 breaths a minute), two minutes each with a minute between, the finger on the back camera. The one where the heart's own wave is biggest and steadiest becomes the person's rhythm. Redone only by a button.
- **Three sessions a day** (morning, midday, late afternoon), five minutes each, guided by a ring (drawn live, or a Blender film) and a sound that rises on the inhale and falls on the exhale, eyes closed. The morning one also reads the heart: one minute at rest, then five minutes of guided breathing, then a coherence note. No reminders.
- **SOS** (one to three physiological sighs, about 30 seconds) and **cyclic sighing** (five minutes), kept apart from the sessions.
- **Home** (the three sessions filling with gold, regularity, the heart curve), **Progress** (weeks, calendar, one day), **Settings**.
- Two profiles, Adri and Mehdi, on the same phone: the code 2580 once per phone, then "Who's opening?" at each opening.

## Publish

```
bash ~/Work/Apps/coherence/deploy.sh
```

Needs Node and the Vercel command line (`npm i -g vercel`, already signed in). `deploy.sh` gives the build its version (`scripts/stamp.js`), creates and links the Vercel project `coherence` in the team `dogbynature` the first time (it refuses to publish over a project of that name it does not know), then runs `vercel deploy --prod`. It commits and pushes nothing. The address to use is the one printed after « Aliased ».

## On the iPhone, in this order

1. Set the iPhone's Auto-Lock to 5 minutes for the test (Settings → Display & Brightness → Auto-Lock): the page keeps the screen lit as best it can, but nothing proves it yet. In **Chrome**, open `<address>/lab/pulse.html` first. It says, in three lines and a sentence, whether the flash lights, whether the finger is seen, and whether a pulse comes out. Then « Enregistrer 40 s et analyser »: touch it *before* putting the finger on. It waits until it sees the finger, lets the picture settle for three seconds, then keeps 40 s of finger (a finger that leaves pauses the count; each pause is written in the report). « Copier avec les mesures brutes » gives a report (raw samples, with sums that catch a damaged paste) to send back so the thresholds can be tuned on real numbers; `node scripts/analyze-report.js` reads it (below).
2. Then Share → **Add to Home Screen**, and open the app **from its icon** (never from a browser tab: on iPhone the icon and the browser do not share their data — see below).
3. Do the test of the rhythm from the icon. The camera permission may be asked again at each opening of the app.

The version is at the very bottom of Settings; touching that line opens the Atelier (`/lab/index.html`): the pulse lab and the copy of the data.

### Reading what the lab copied

```
node scripts/analyze-report.js report.txt          # the text form (the pasted text, saved in a file; chat decoration around the JSON is fine)
node scripts/analyze-report.js report.txt --json   # the same, machine-readable
python3 scripts/plot-report.py report.txt out.png    # a picture: raw and band-passed signal, spectrogram, frame gaps (numpy, scipy, matplotlib)
```

It says what the phone saw (frames a second, holes, how the clock ticks; red and green levels, saturation, finger over the lens), whether a pulse exists in the signal **without using the beat detector** (the spectrum of ten-second windows: a steady pulse is a narrow peak between 0.7 and 3 Hz that stays put), what the app's own chain (`js/analysis.js`) makes of each channel and polarity and why beats are thrown out, which relaxed rule would have read it, and a verdict. The chain is run from `js/analysis.js` itself, patched *in memory* for the experiments: a patch that no longer matches stops the run loudly, and nothing shipped is changed.

## Run it here

```
cd ~/Work/Apps/coherence
python3 -m http.server 8811
# then open http://localhost:8811/index.html?nosw       (?nosw keeps the service worker out of the way)
```

A computer has no fingertip and no torch: the pulse screens need either the tests' fake finger (below) or a phone. Change a screen by changing the drawing, not `index.html`:

```
python3 scripts/lift.py --drawing ~/Work/PxN/redline/showcase/coherence/v0/duo-phone.html     # index.html, css/app.css, fonts, ring films
python3 scripts/make-icons.py                                                                  # icons and launch screens (Playwright + Chromium)
node scripts/stamp.js                                                                          # version.js and sw.js (deploy.sh does it)
```

`lift.py` reads the ring films from `ring-equal.b64` and `ring-sigh.b64` beside the drawing; the decoded `assets/rings/*.mp4` are already here.

## Where things are

| path | what |
|---|---|
| `index.html` | **generated** by `scripts/lift.py`: the drawing's 37 screens in one page, `<section class="scr" id="s-<id>">`. Never edit by hand. |
| `css/app.css`, `css/extra.css` | the drawing's kit (generated) · what the app adds (hand-written) |
| `js/` | one global, `COH`; loaded in this order: `version` → `analysis` → `store` → `model` → `pulse` → `guide` → `nav` → `paint` → `flows` → `boot` |
| `js/analysis.js` | pure: frames of a fingertip video → beats, heart rate, variability (RMSSD), coherence, the two scores. Runs in Node too. |
| `js/store.js` | what is kept: documents behind `load(key)` / `save(key, doc)`, `exportAll()` / `importAll()` |
| `js/model.js` | pure questions the screens ask about what is kept (days, weeks, sessions, the half-finished test) |
| `js/pulse.js` | the back camera, the torch and its retries, the live reading |
| `js/guide.js` | the breath: one clock for ring, sound, words; screen wake lock |
| `js/nav.js`, `paint.js`, `flows.js`, `boot.js` | one screen at a time · the words and figures of each screen · the story between screens · first breath and updates |
| `sw.js`, `manifest.webmanifest` | offline copy (all-or-nothing install, Range for the films) · home-screen app |
| `lab/` | the Atelier: `index.html`, `pulse.html` (the pulse lab), `data.html` (copy and restore of the data). French, not cached offline. |
| `assets/` | fonts (Fraunces 500, Inter 400/500), icons, launch screens, the two ring films |
| `scripts/` | `lift.py`, `make-icons.py`, `stamp.js`, `analyze-report.js` (reads the lab's raw report), `plot-report.py` (draws it), `index.template.html`, `splash-links.html` (written by `make-icons.py`) |
| `tests/` | `unit/`, `e2e/`, `fixtures/` |
| `deploy.sh`, `vercel.json`, `.vercelignore` | publishing; headers (`noindex`, no cache for html/js/css/sw, one week for assets); what Vercel does not receive (tests, scripts, this file, any `.env*` file: `vercel link` writes a short-lived token in `.env.local`) |
| `DECISIONS.md` | D50 onward, in French |

## Tests

Unit (Node 22, no dependency). Days are local calendar days, so run it in a few time zones:

```
node --test tests/unit/*.test.js
TZ=Pacific/Auckland node --test tests/unit/*.test.js
TZ=America/Los_Angeles node --test tests/unit/*.test.js
```

`tests/unit/report-fixture.js` builds fake lab reports (a known heart, a finger that moves, a saturated channel, no finger…) for the tests of `scripts/analyze-report.js`.

End to end (Python 3.11, `pip install playwright`, a Chromium; a static server on port 8811 from this folder). Each script is a phone: Chromium at iPhone size, a fake clock (a six-minute session runs in seconds) and a fake finger injected in the page (`tests/e2e/fake-finger.js`, `COH_TEST.finger.cfg.mode` = `finger` · `none` · `dark`). No more than two at a time on two processors.

```
cd tests/e2e
python3 smoke.py                    # code → who → first screen
python3 flow_morning.py             # a whole morning session
python3 flow_test.py                # the test of five rhythms, whole
python3 flow_fail.py 1 2 3 4 5      # the five ways the pulse can be missing
python3 flow_misc.py A B C D E R    # sessions without a reading, pause / resume / stop, a phone that locks, the sighs · R: ring A, the Blender film
python3 flow_redo.py X Y W Z        # the test again: keep or use a different rhythm, a finished test nobody confirmed, a stale half-finished one
python3 flow_ui.py F F2 G H I J     # settings, progress, empty and locked states, reduced motion, storage refused
python3 sw_offline.py               # the offline copy and the update (on a throw-away copy, its own port)
python3 lab_pages.py K P D          # the Atelier: the door, the pulse lab, the copy of the data
python3 pulse_camera.py finger      # Chromium's fake camera plays a fingertip video (needs the fixtures below)
```

Environment: `COH_URL` (default `http://localhost:8811`), `COH_SHOTS` (screenshots, default `/tmp/coh-shots`), `CHROMIUM` (path of a Chromium or Chrome; by default the one of the workspace, else the one Playwright downloaded with `playwright install chromium`).

Fixtures: `tests/fixtures/finger-64.json` is the mean red and green of each frame of a simulated fingertip at 64 a minute. `make-fake-camera.py` turns it into the `.mjpeg` fake-camera videos (5 MB each, not kept in git, not shipped, only `pulse_camera.py` uses them):

```
python3 tests/fixtures/make-fake-camera.py tests/fixtures/finger-64.json tests/fixtures/finger-64.mjpeg
python3 tests/fixtures/make-fake-camera.py tests/fixtures/finger-64.json tests/fixtures/dark-64.mjpeg --dark
python3 tests/fixtures/make-fake-camera.py tests/fixtures/finger-64.json tests/fixtures/nofinger.mjpeg --nofinger
```

(needs `numpy` and `pillow`).

## What is kept, and where

`localStorage`, keys prefixed `coh:v1:`. `meta` is the phone's (code already given, sound, volume, ring, the mark's blink). `profile:adri` and `profile:mehdi` are one document each: `rhythm` (value, the five scores, date), `history` (rhythms replaced), `partial` (a half-finished test, valid 24 hours), `sessions`, `sos`, `cyc`. Every record has an `id`, a `ts` (ms) and a `day` (`YYYY-MM-DD`, local). A document that cannot be read is put aside under `coh:v1:corrupt:…`, never overwritten.

Behind the store there is a backend with two verbs, so a DOG-CORE backend (`coh_` tables) can be added later without touching the screens: implement `load(key)` and `save(key, doc)`, then a one-off copy from the phone (`Store.exportAll()` is the whole content; `importAll()` puts it back). If the browser refuses storage, a memory backend takes over for the visit and Settings says so.

On iPhone the home-screen app and Chrome keep **separate** data. The Atelier's « Tes données » page (`/lab/data.html`) saves a copy (`coherence-YYYY-MM-DD.json`) or restores one; to copy what the app holds, open it *from the app* (Settings → touch the version line), not from a browser tab.

## What is not proven yet

Only on the iPhone: that the flash lights from Chrome (it retries, keeps the camera open and, if it still will not, reads the pulse in ambient light when the signal is good enough); that a real finger passes the pulse thresholds (they were tuned on a simulated one: `js/analysis.js` `QUALITY`, `js/pulse.js` and `js/flows.js` constants); the camera permission inside the home-screen app; that the screen stays lit for five minutes and that the guide's sound is heard with the silent switch on; that the ring film plays; the path in iPhone settings shown when the camera is refused.

## Known limit

The heart variability read by a phone camera is inflated by the timing noise of each beat (in the simulated tests: +7 % on a clean signal, about +40 % on an ordinary one, up to ×2 on a bad one, against a chest strap). Follow a person's curve over weeks; do not compare the milliseconds with a strap, a watch or another person. The two scores (test out of 100, coherence out of 10) are this app's own and are not medical measures.
