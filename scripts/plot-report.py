#!/usr/bin/env python3
"""plot-report.py — a picture of what the lab copied with « Copier avec les mesures brutes ».

    python3 scripts/plot-report.py report.txt [out.png]

Four panels: the raw red and green of every frame; the same, band-passed (0.5–6 Hz) with the peaks a plain
peak finder sees; the spectrogram of ten-second windows (a steady pulse is one bright line that stays put);
the gaps between frames and the levels. Needs numpy, scipy and matplotlib. A tool for whoever tunes the reading;
nothing here is shipped.
"""
import json, sys
import numpy as np
from scipy import signal
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def load(path):
    text = open(path, encoding='utf8').read()
    a, b = text.index('{'), text.rindex('}')
    rep = json.loads(text[a:b + 1])
    s = rep['samples']
    t = s['t0'] + np.array(s['dt'], float) / 1000.0
    return rep, t, np.array(s['r'], float), np.array(s['g'], float), s.get('segs')


def resample(t, x, fs=30.0):
    grid = np.arange(t[0], t[-1], 1 / fs)
    return grid, np.interp(grid, t, x)


def bandpass(x, fs=30.0, lo=0.5, hi=6.0):
    sos = signal.butter(2, [lo, hi], btype='band', fs=fs, output='sos')
    return signal.sosfiltfilt(sos, x - np.mean(x))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else path.rsplit('.', 1)[0] + '.png'
    rep, t, r, g, segs = load(path)
    t0 = t[0]
    fs = 30.0
    tg, rg = resample(t, r, fs)
    _, gg = resample(t, g, fs)
    br, bg = bandpass(rg, fs), bandpass(gg, fs)

    fig, ax = plt.subplots(4, 1, figsize=(13, 14), gridspec_kw={'height_ratios': [1.1, 1.4, 1.3, 0.8]})
    # 1. the raw channels
    a = ax[0]
    a.plot(t - t0, r, color='#c0392b', lw=0.8, label='red')
    a.set_ylabel('red (0–255)', color='#c0392b'); a.set_ylim(min(r.min() - 2, 250), 256) if r.min() > 150 else None
    a2 = a.twinx(); a2.plot(t - t0, g, color='#27ae60', lw=0.8, label='green'); a2.set_ylabel('green (0–255)', color='#27ae60')
    if segs:
        for s0, s1 in segs:
            a.axvspan(s0 - t0, s1 - t0, color='#d9aa52', alpha=0.10)
    a.set_title('%s · %s · %d frames · %.1f s · torch %s · clock %s' % (rep.get('version'), (rep.get('ua') or '')[:70], len(t), t[-1] - t0, rep.get('torch'), rep.get('timeSrc')), fontsize=9)
    a.set_xlabel('seconds')

    # 2. band-passed, with peaks of a plain finder (for the eye only: the app's own chain is in analyze-report.js)
    a = ax[1]
    for name, x, col in (('red', br, '#c0392b'), ('green', bg, '#27ae60')):
        # both polarities are plausible: draw the one whose peaks are the most regular
        best = None
        for sign in (1, -1):
            pk, _ = signal.find_peaks(sign * x, distance=int(0.35 * fs), prominence=0.5 * np.std(x))
            reg = np.std(np.diff(pk)) / max(1, np.mean(np.diff(pk))) if len(pk) > 4 else 9
            if best is None or reg < best[0]:
                best = (reg, sign, pk)
        reg, sign, pk = best
        off = 0 if name == 'red' else -4.2 * np.std(x)
        a.plot(tg - t0, x + off, color=col, lw=0.9)
        a.plot(tg[pk] - t0, x[pk] + off, 'o', color='k', ms=3)
        a.text(0.005, 0.97 if name == 'red' else 0.47, '%s: %d peaks, spread of gaps %.0f %% (polarity %+d)' % (name, len(pk), 100 * reg, sign), transform=a.transAxes, fontsize=8, va='top')
    a.set_ylabel('band-passed 0.5–6 Hz'); a.set_xlabel('seconds')

    # 3. spectrogram (red and green added in power), in beats a minute
    a = ax[2]
    W = int(10 * fs); hop = int(1 * fs); N = 4096
    rows, times = [], []
    for s in range(0, len(rg) - W, hop):
        seg = np.zeros(N)
        pw = 0
        for x in (rg, gg):
            y = signal.detrend(x[s:s + W]) * np.hanning(W)
            seg_f = np.abs(np.fft.rfft(y, N)) ** 2
            pw = pw + seg_f
        rows.append(pw); times.append(tg[s] - t0 + 5)
    f = np.fft.rfftfreq(N, 1 / fs)
    sel = (f >= 0.3) & (f <= 4.0)
    M = np.log10(np.array(rows)[:, sel].T + 1e-9)
    if M.size:
        a.imshow(M, aspect='auto', origin='lower', extent=[times[0], times[-1], f[sel][0] * 60, f[sel][-1] * 60], cmap='magma', vmin=np.percentile(M, 30), vmax=np.percentile(M, 99.5))
        # the strongest line between 0.7 and 3 Hz in each window
        band = (f[sel] >= 0.7) & (f[sel] <= 3.0)
        pk = [f[sel][band][np.argmax(np.array(rows)[i][sel][band])] * 60 for i in range(len(rows))]
        a.plot(times, pk, '.', color='cyan', ms=3)
    a.set_ylabel('beats a minute'); a.set_xlabel('seconds'); a.set_title('spectrogram of 10 s windows (cyan: strongest line 42–180 a minute)', fontsize=9)

    # 4. gaps between frames and the levels
    a = ax[3]
    d = np.diff(t) * 1000
    d = d[d < 200]
    a.hist(d, bins=np.arange(0, 120, 1), color='#7f8c8d')
    a.set_xlabel('ms between frames (median %.1f, 5–95 %% %.1f–%.1f)' % (np.median(d), np.percentile(d, 5), np.percentile(d, 95)))
    a.set_ylabel('frames')
    fig.tight_layout()
    fig.savefig(out, dpi=80)
    print('wrote', out)


if __name__ == '__main__':
    main()
