"""Upbeat original track for the RuntimeBrief promo (synthesized, no samples).

The tempo is set so the drop lands on the phone's entrance and the final hit on the end card.
Usage: [BARS=n] python3 music.py <total_s> <drop_s> <end_s> <out.wav> [whoosh_s ...]  (needs numpy and scipy)
"""
import os
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
TOTAL, DROP, END, OUT = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
WHOOSH = [float(x) for x in sys.argv[5:]]
N = int(TOTAL * SR)
rng = np.random.default_rng(11)

BARS = int(os.environ.get('BARS', 32))
SEC_B, SEC_C = round(BARS * 0.375), round(BARS * 0.75)
BAR = (END - DROP) / BARS  # ~1.97 s, about 122 BPM
BEAT = BAR / 4
SIX = BEAT / 4


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def lp(x, hz, order=2):
    return sosfilt(butter(order, hz, btype='low', fs=SR, output='sos'), x)


def hp(x, hz, order=2):
    return sosfilt(butter(order, hz, btype='high', fs=SR, output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=SR, output='sos'), x)


def saw(f, n, ph=0.0):
    t = np.arange(n) / SR
    return 2 * ((t * f + ph) % 1) - 1


# Buses: drums stay dry and centred; music goes through sidechain and reverb.
bus = {k: [np.zeros(N), np.zeros(N)] for k in ('drums', 'music', 'fx')}


def place(name, sig, start, gain=1.0, pan=0.5):
    i = int(round(start * SR))
    if i >= N or i + len(sig) <= 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    j = min(N, i + len(sig))
    s = sig[: j - i] * gain
    bus[name][0][i:j] += s * np.sqrt(1 - pan) * 1.414
    bus[name][1][i:j] += s * np.sqrt(pan) * 1.414


# ---- instruments -------------------------------------------------------------

def kick(t0, g=0.55):
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    f = 48 + 110 * np.exp(-t * 34)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    click = hp(rng.standard_normal(n), 3000) * np.exp(-t * 250) * 0.25
    place('drums', body + click, t0, g)


def clap(t0, g=0.32):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    noise = bp(rng.standard_normal(n), 900, 3500)
    e = np.zeros(n)
    for k, d in enumerate((0, 0.009, 0.018, 0.027)):
        e += np.where(t >= d, np.exp(-(t - d) * (140 if k < 3 else 16)), 0)
    place('drums', noise * e, t0, g)
    place('fx', noise * e, t0, g * 0.5)  # some clap into the reverb


def hat(t0, g=0.08, open_=False, pan=0.6):
    n = int((0.22 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    v = hp(rng.standard_normal(n), 7500, 4) * np.exp(-t * (18 if open_ else 95))
    place('drums', v, t0, g, pan)


def crash(t0, g=0.16):
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    v = hp(rng.standard_normal(n), 4500, 2) * np.exp(-t * 2.2)
    place('drums', v, t0, g, 0.45)
    place('drums', hp(rng.standard_normal(n), 4500, 2) * np.exp(-t * 2.2), t0, g, 0.55)


def riser(t_end, dur, g=0.12):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    steps = 24
    for k in range(steps):  # band sweeps upward in steps, crossfaded
        a, b = k * n // steps, (k + 1) * n // steps
        lo = 300 * (14 ** (k / steps))
        seg = bp(noise, lo, min(lo * 3, 20000))[a:b]
        out[a:b] = seg
    out *= (t / dur) ** 2
    place('fx', out, t_end - dur, g, 0.4)
    place('fx', out, t_end - dur + 0.013, g, 0.6)


def whoosh(t_mid, g=0.07):
    dur = 0.7
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    steps = 14
    for k in range(steps):
        a, b = k * n // steps, (k + 1) * n // steps
        lo = 500 * (6 ** (k / steps))
        out[a:b] = bp(noise, lo, lo * 2.5)[a:b]
    out *= np.sin(np.pi * t / dur) ** 2
    place('fx', out, t_mid - dur * 0.6, g, 0.35)
    place('fx', out, t_mid - dur * 0.6 + 0.012, g, 0.65)


def supersaw(notes, t0, dur, g, cutoff):
    n = int((dur + 0.25) * SR)
    t = np.arange(n) / SR
    for note in notes:
        f = midi(note)
        for d, pan in ((-14, 0.15), (-5, 0.4), (5, 0.6), (14, 0.85)):
            v = saw(f * 2 ** (d / 1200), n, rng.random())
            e = np.minimum(1, t / 0.008) * np.where(t < dur, 1, np.exp(-(t - dur) * 18))
            place('music', lp(v * e, cutoff), t0, g / len(notes), pan)


def bass(note, t0, dur, g=0.3):
    n = int((dur + 0.05) * SR)
    t = np.arange(n) / SR
    f = midi(note)
    v = 0.7 * saw(f, n) + 0.6 * np.sin(2 * np.pi * f * t)
    e = np.minimum(1, t / 0.004) * np.exp(-t * 3) * np.where(t < dur, 1, np.exp(-(t - dur) * 60))
    v = lp(v * e, 1400)
    place('music', v, t0, g)


def pluck(note, t0, g=0.11, pan=0.5, bright=3200):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = midi(note)
    v = saw(f, n) * 0.6 + np.sign(np.sin(2 * np.pi * f * t)) * 0.25
    v *= np.exp(-t * 9) * np.minimum(1, t / 0.002)
    v = lp(v, bright) * 0.9 + lp(v, 900) * 0.3
    place('music', v, t0, g * 1.3, pan)


def lead(note, t0, dur, g=0.13):
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    f = midi(note)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(1, t / 0.25)
    ph = np.cumsum(f * vib) / SR
    v = (2 * (ph % 1) - 1) * 0.5 + np.sin(2 * np.pi * ph) * 0.7
    e = np.minimum(1, t / 0.01) * np.where(t < dur, 1 - 0.25 * np.minimum(1, t / 0.5), 0.75 * np.exp(-(t - dur) * 9))
    v = lp(v * e, 3800)
    place('music', v, t0, g, 0.45)
    place('music', v, t0 + 0.011, g * 0.6, 0.6)


def pad(notes, t0, dur, g=0.06):
    n = int((dur + 1.5) * SR)
    t = np.arange(n) / SR
    for note in notes:
        for d, pan in ((-8, 0.3), (8, 0.7)):
            v = saw(midi(note) * 2 ** (d / 1200), n, rng.random())
            e = np.minimum(1, t / 0.6) * np.where(t < dur, 1, np.exp(-(t - dur) * 2.5))
            place('music', lp(v * e, 1800), t0, g / len(notes), pan)


# ---- arrangement --------------------------------------------------------------
# F - C - Dm - Bb, one chord per bar.
CHORDS = [[65, 69, 72, 76], [60, 64, 67, 72], [62, 65, 69, 72], [58, 62, 65, 69]]
ROOTS = [41, 36, 38, 34]
HOOK = [  # (eighth index, midi, length in eighths) per bar of the 4-bar loop
    [(0, 77, 2), (2, 76, 1), (3, 77, 2), (5, 72, 1), (6, 69, 2)],
    [(0, 79, 2), (2, 76, 2), (4, 72, 2), (6, 74, 1), (7, 76, 1)],
    [(0, 77, 2), (2, 76, 1), (3, 74, 2), (5, 69, 1), (6, 72, 2)],
    [(0, 74, 2), (2, 72, 2), (4, 70, 1), (5, 69, 1), (6, 67, 2)],
]

bar_t = lambda b: DROP + b * BAR

# Intro: filtered chords opening up, hats, a riser into the drop.
intro_bars = int(np.floor(DROP / BAR))
for b in range(-intro_bars, 0):
    t0 = bar_t(b)
    k = (b + intro_bars) / max(1, intro_bars)
    supersaw(CHORDS[b % 4], t0, BAR * 0.95, 0.10, 500 + 2500 * k)
    if b >= -2:
        for i in range(8):
            hat(t0 + i * BEAT / 2 + BEAT / 2 * (i % 2 == 0), 0.04 + 0.03 * k, pan=0.4 + 0.2 * (i % 2))
riser(DROP, BAR * 1.6, 0.14)
# A chime as the app icon appears on the title card.
lead(84, 0.33, 0.5, 0.06)
pluck(77, 0.33, 0.07)
pluck(81, 0.58, 0.05, pan=0.6)

for b in range(BARS):
    t0 = bar_t(b)
    c = b % 4
    section = 0 if b < SEC_B else (1 if b < SEC_C else 2)
    last_of_phrase = b % 8 == 7
    # drums
    for i in range(4):
        if not (last_of_phrase and i == 3 and section > 0):
            kick(t0 + i * BEAT)
        if i in (1, 3):
            clap(t0 + i * BEAT)
    for i in range(16 if section > 0 else 8):
        step = SIX if section > 0 else BEAT / 2
        accent = 1.0 if (i % 2 == 1) else 0.55
        hat(t0 + i * step, 0.07 * accent, pan=0.38 + 0.24 * (i % 2))
    if section > 0:
        for i in range(4):
            hat(t0 + i * BEAT + BEAT / 2, 0.05, open_=True, pan=0.62)
    if last_of_phrase:  # snare fill into the next phrase
        for i in range(8):
            clap(t0 + 3 * BEAT + i * SIX / 2, 0.08 + 0.03 * i)
    if b % 8 == 0:
        crash(t0, 0.13 if b else 0.18)
    # bass: driving eighths, octave on the off-beats
    for i in range(8):
        note = ROOTS[c] + (12 if i % 2 else 0)
        bass(note, t0 + i * BEAT / 2, BEAT / 2 * 0.8, 0.26 if i % 2 == 0 else 0.2)
    # chord stabs on the off-beats
    for i in range(4):
        supersaw(CHORDS[c], t0 + i * BEAT + BEAT / 2, BEAT * 0.35, 0.14, 2600 + 900 * section)
    # pluck arpeggio from the second phrase
    if b >= max(1, BARS // 8):
        tones = CHORDS[c] + [CHORDS[c][1] + 12]
        pattern = [0, 2, 1, 3, 4, 2, 3, 1, 0, 2, 4, 3, 1, 2, 3, 4]
        for i, p in enumerate(pattern):
            pluck(tones[p] + 12, t0 + i * SIX, 0.05 + 0.02 * section, pan=0.3 + 0.4 * (i % 2))
    # hook melody in the second half, an octave up in the last section
    if section >= 1:
        up = 12 if section == 2 else 0
        for idx, note, length in HOOK[c]:
            lead(note + up, t0 + idx * BEAT / 2, length * BEAT / 2 * 0.9,
                 0.15 if section == 1 else 0.12)
    if b == SEC_C - 1:
        riser(bar_t(SEC_C), BAR, 0.12)

# Ending: one big F hit and a ring-out.
crash(END, 0.2)
kick(END, 0.65)
supersaw([53, 65, 69, 72, 77], END, 0.35, 0.16, 4000)
pad([65, 69, 72, 76], END, TOTAL - END - 1.2, 0.09)
bass(29, END, 1.2, 0.3)
lead(77, END, 1.6, 0.08)
for t in WHOOSH:
    whoosh(t)

# ---- mix ---------------------------------------------------------------------
# Sidechain: duck the music bus on every kick.
duck = np.ones(N)
for b in list(range(BARS)):
    for i in range(4):
        i0 = int(bar_t(b) * SR + i * BEAT * SR)
        m = int(0.28 * SR)
        if 0 <= i0 < N - m:
            duck[i0:i0 + m] = np.minimum(duck[i0:i0 + m], 1 - 0.55 * np.exp(-np.arange(m) / SR * 11))
music = [bus['music'][0] * duck, bus['music'][1] * duck]

# Ping-pong delay on the music (dotted eighth), then reverb on mids and highs.
d = int(BEAT * 0.75 * SR)
for src, dst in ((0, 1), (1, 0)):
    echo = np.zeros(N)
    echo[d:] = music[src][:-d] * 0.22
    music[dst] += lp(hp(echo, 400), 5000)

ir_n = int(1.8 * SR)
ir_t = np.arange(ir_n) / SR
send = [hp(music[0] + bus['fx'][0], 350, 4), hp(music[1] + bus['fx'][1], 350, 4)]
irs = [lp(rng.standard_normal(ir_n) * np.exp(-ir_t * 3.2), 7000) / 70 for _ in range(2)]
L = music[0] + bus['fx'][0] + bus['drums'][0] + fftconvolve(send[0], irs[0])[:N]
R = music[1] + bus['fx'][1] + bus['drums'][1] + fftconvolve(send[1], irs[1])[:N]

L, R = hp(L, 30), hp(R, 30)
fade = np.ones(N)
fi = int(0.05 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fo = int(3.0 * SR)
fade[-fo:] = np.linspace(1, 0, fo) ** 1.6
L, R = L * fade, R * fade
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = np.tanh(L / peak * 1.6) / np.tanh(1.6), np.tanh(R / peak * 1.6) / np.tanh(1.6)
L, R = L * 0.84, R * 0.84
pcm = (np.stack([L, R], axis=1) * 32767).astype('<i2')
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f'wrote {OUT}: {TOTAL:.2f}s at {60 / BEAT:.1f} BPM')
