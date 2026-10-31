"""Chill soundtrack for the Hoodwink film (34 s), synced to promo-src/film.html.
Warm, soft, low-passed at 6 kHz: no shrill highs (house rule). Run: python promo-src/make-music.py -> promo-src/film-music.wav
Cues (film seconds): words 0.3 / 1.5 / 2.7 | scan 4.4 | checks settle 6.6 + i*0.24 | stamps 12.8 / 14.3 / 15.8 | counters 18.6-21.0, dumped 20.2 | launch bars 24.8 + i*0.7 | end card 29.6."""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import wave, os

SR = 44100
DUR = 34.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)

def tsec(d): return np.arange(int(SR * d)) / SR
def env(n, a, d, s, r, hold):
    """ADSR on n samples: attack a, decay d to level s, release r at the end of 'hold' seconds"""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), 1.0)
    e = np.where(t >= a, s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)), e)
    rel = np.clip((t - hold) / max(r, 1e-4), 0, 1)
    return e * (1 - rel)
def add(buf, x, t0, pan=0.0, gain=1.0):
    i = int(t0 * SR)
    if i >= N: return
    x = x[: N - i] * gain
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(x)] += x * l; R[i:i + len(x)] += x * r
def midi(m): return 440.0 * 2 ** ((m - 69) / 12)

def rhodes(freq, dur, vel=1.0, tail=1.2):
    n = int(SR * (dur + tail)); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) + 0.32 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t * 3) + 0.10 * np.sin(2 * np.pi * freq * 3 * t) * np.exp(-t * 6)
    x *= 1 + 0.06 * np.sin(2 * np.pi * 4.8 * t)                      # gentle tremolo
    return x * env(n, 0.006, 0.9, 0.35, 0.4, dur) * vel
def pad(freq, dur, tail=1.5):
    n = int(SR * (dur + tail)); t = np.arange(n) / SR
    x = np.zeros(n)
    for det in (-0.004, 0.0, 0.004):
        f = freq * (1 + det)
        x += np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 2 * t)
    return x / 3 * env(n, 1.3, 1.0, 0.8, 1.6, dur)
def bass(freq, dur):
    n = int(SR * (dur + 0.3)); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * freq * t) + 0.18 * np.sin(2 * np.pi * freq * 2 * t)) * env(n, 0.02, 0.5, 0.5, 0.2, dur)
def kick(vel=1.0):
    n = int(SR * 0.45); t = np.arange(n) / SR
    f = 52 + 70 * np.exp(-t * 28); ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 9) * vel
def hat(vel=1.0):
    n = int(SR * 0.09); x = rng.standard_normal(n)
    sos = butter(2, [2800, 5500], btype='band', fs=SR, output='sos'); x = sosfilt(sos, x)
    return x * np.exp(-np.arange(n) / SR * 55) * vel
def knock(freq=190, vel=1.0):                                        # soft muted tock for a refused attack
    n = int(SR * 0.28); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2.4 * t)) * np.exp(-t * 16) * vel
def chime(freq, vel=1.0):
    n = int(SR * 1.6); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * freq * t) + 0.2 * np.sin(2 * np.pi * freq * 2.01 * t)) * np.exp(-t * 2.6) * vel
def swell(n_s, f0, f1, vel=1.0):
    n = int(SR * n_s); x = rng.standard_normal(n)
    out = np.zeros(n); blocks = 24
    for b in range(blocks):
        a, z = b * n // blocks, (b + 1) * n // blocks
        fc = f0 * (f1 / f0) ** (b / blocks)
        sos = butter(2, fc, btype='low', fs=SR, output='sos'); out[a:z] = sosfilt(sos, x[a:z])
    e = (np.arange(n) / n) ** 2
    return out * e * vel

BPM = 84; beat = 60 / BPM; bar = 4 * beat
# Am9 | Fmaj7 | Cmaj7 | G6, two bars each
CH = [([45, 57, 60, 64, 67, 71], 33), ([41, 53, 57, 60, 64, 67], 29), ([48, 55, 59, 64, 67, 71], 36), ([43, 55, 59, 62, 64, 71], 31)]
PENT = {0: [69, 72, 74, 76, 79], 1: [65, 69, 72, 74, 77], 2: [72, 76, 79, 81, 84], 3: [67, 71, 74, 76, 79]}

# ---- harmony: pads from the first word to the end
t = 0.0; ci = 0
while t < DUR:
    notes, root = CH[ci % 4]
    vel = 0.5 if t < 4.5 else 0.8
    for m in notes[1:]: add(L, pad(midi(m), 2 * bar, 1.2), t, pan=rng.uniform(-.5, .5), gain=0.05 * vel)
    ci += 1; t += 2 * bar

# ---- bass from 4.5 s
t = 4.5; ci = 0
while t < 33.0:
    notes, root = CH[int((t - 4.5) // (2 * bar)) % 4]
    for k, off in enumerate([0, 2.5 * beat, 4 * beat, 6.5 * beat]):
        if t + off < 33.0: add(L, bass(midi(root), 1.4 * beat), t + off, gain=0.30 if k % 2 == 0 else 0.20)
    t += 2 * bar

# ---- gentle drums: kick on 1 and the 'and' of 3, soft hat; absent in the rewind and at the end card
def drums_on(x): return 4.5 <= x < 29.4
t = 4.5; step = 0
while t < 30.0:
    pos = step % 8
    if drums_on(t) and pos in (0, 5): add(L, kick(0.5 if pos == 0 else 0.35), t, gain=0.5)
    if drums_on(t) and step % 2 == 1: add(L, hat(0.5), t, pan=0.25, gain=0.07)
    t += beat / 2; step += 1

# ---- rhodes arpeggios, a little echo later
def echo(x, d1=0.36, fb=0.35, taps=3):
    out = np.zeros(len(x) + int(SR * d1 * taps) + 1)
    out[:len(x)] += x
    for k in range(1, taps + 1): out[int(SR * d1 * k):int(SR * d1 * k) + len(x)] += x * fb ** k
    return out
t = 8.0
pat = [0, 2, 1, 3, 2, 4, 3, 1]
while t < 29.4:
    if True:
        bi = int((t - 4.5) // (2 * bar)) % 4
        k = int(round((t - 8.0) / (beat / 2))) % 8
        m = PENT[bi][pat[k]]
        add(L, echo(rhodes(midi(m), 0.5, 0.55)), t, pan=-0.3 + 0.6 * ((k % 4) / 3), gain=0.10)
    t += beat

# ---- scene cues
for tt, f in [(0.3, 220.0), (1.5, 196.0), (2.7, 147.0)]:           # three words: low, lower, lowest
    add(L, knock(f, 1.0), tt, gain=0.35)
add(L, swell(1.4, 250, 3000, 1.0), 3.0, gain=0.10)                  # into the scan
add(L, rhodes(midi(57), 2.5, 0.8), 4.4, gain=0.12)
for i in range(16):                                                   # each check settles: tiny soft ticks
    add(L, chime(midi(84 if i % 2 else 81), 0.5), 6.6 + i * 0.24, pan=-0.4 + 0.04 * i, gain=0.018)
add(L, chime(midi(76), 0.9), 10.6, gain=0.08)                        # scan done
for tt in (12.8, 14.3, 15.8):                                        # stamps: dead link, borrowed post, copycat
    add(L, knock(140, 1.0), tt, gain=0.42); add(L, knock(95, 0.8), tt + 0.04, gain=0.25)
for i, tt in enumerate((18.6, 19.4, 20.2, 21.0)):                    # track-record counters
    add(L, chime(midi(72 + 2 * i), 0.7), tt, gain=0.06)
add(L, knock(120, 1.0), 20.25, gain=0.40); add(L, pad(midi(45), 2.0), 20.2, gain=0.07)  # dumped
for i in range(4): add(L, knock(180 - i * 10, 1.0), 24.8 + i * 0.7, gain=0.2)
add(L, swell(1.4, 250, 2800, 1.0), 28.4, gain=0.10)                 # lift into the end card
for m in (45, 52, 57, 64, 71): add(L, pad(midi(m), 3.4, 1.6), 29.6, pan=rng.uniform(-.4, .4), gain=0.075)
add(L, chime(midi(81), 1.0), 29.65, gain=0.06)
add(L, bass(midi(33), 3.6), 29.6, gain=0.30)

# ---- mirror to the right channel with a short decorrelated copy for width, then reverb
R[:] = L * 0.0 + R
mono = L + R
w = np.zeros(N); w[int(SR * 0.017):] = mono[:N - int(SR * 0.017)]
Lw = mono * 0.78 + w * 0.22; Rw = mono * 0.78 + np.roll(w, int(SR * 0.006)) * 0.22
ir_n = int(SR * 2.2); tt = np.arange(ir_n) / SR
ir = rng.standard_normal(ir_n) * np.exp(-tt * 2.6)
ir = sosfilt(butter(2, 4500, btype='low', fs=SR, output='sos'), ir); ir /= np.sqrt(np.sum(ir ** 2))
irR = np.roll(ir, 211)
wetL = fftconvolve(Lw, ir)[:N]; wetR = fftconvolve(Rw, irR)[:N]
outL = Lw + 0.30 * wetL; outR = Rw + 0.30 * wetR

# ---- master: high-pass 30 Hz, low-pass 6 kHz, soft clip, fades, normalise
sos_hp = butter(2, 30, btype='high', fs=SR, output='sos'); sos_lp = butter(4, 6000, btype='low', fs=SR, output='sos')
y = np.stack([sosfilt(sos_lp, sosfilt(sos_hp, outL)), sosfilt(sos_lp, sosfilt(sos_hp, outR))])
y = np.tanh(y * 1.4) / 1.4
fi = np.clip(np.arange(N) / (SR * 0.8), 0, 1); fo = np.clip((N - np.arange(N)) / (SR * 2.2), 0, 1)
y *= fi * fo
y *= 0.45 / np.max(np.abs(y))                                        # peak about -7 dBFS, moderate
pcm = (y.T * 32767).astype('<i2')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'film-music.wav')
with wave.open(out, 'wb') as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR); f.writeframes(pcm.tobytes())

# ---- report: levels and spectrum, since nobody can listen here
rms = 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9); peak = 20 * np.log10(np.max(np.abs(y)))
spec = np.abs(np.fft.rfft(y[0])) ** 2; fr = np.fft.rfftfreq(N, 1 / SR)
hi = spec[fr > 8000].sum() / spec.sum(); mid = spec[(fr > 3000) & (fr <= 8000)].sum() / spec.sum()
print(f'wrote {out}  {DUR}s  RMS {rms:.1f} dBFS  peak {peak:.1f} dBFS  energy >8 kHz {hi * 100:.4f}%  3-8 kHz {mid * 100:.2f}%')
sec = [20 * np.log10(np.sqrt(np.mean(y[:, int(a * SR):int((a + 2.5) * SR)] ** 2)) + 1e-9) for a in np.arange(0, 32, 2.5)]
print('RMS per 2.5 s (dBFS):', ' '.join(f'{v:.0f}' for v in sec))
