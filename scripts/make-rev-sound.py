"""Makes assets/sounds/v_twin_rev_2.wav, the notification sound: a V-twin idling, blipped and settling.

Synthesised from scratch (no recording), so the club owns it outright. Run: python3 scripts/make-rev-sound.py
(needs numpy and scipy); it rebuilds the file byte for byte. `--rumble` makes the other candidate (a lazy
idle with two small blips) to scratch.wav instead, for comparing by ear.

Why a second version: the first put two thirds of its energy below 150 Hz, which a phone speaker can't
play, and squashed white-noise "rasp" twice through hard saturation. On a phone all that was left was hiss
and crackle. This one keeps the bike's lumpy beat (a 45-degree V-twin fires at uneven gaps of 315 and 405
crank degrees) but voices each firing through exhaust resonances between about 200 Hz and 2 kHz, where a
phone speaker is loud and clean, with one gentle saturation and almost no noise.
"""

import sys
import wave
from pathlib import Path

import numpy as np
from scipy import signal

RATE = 44_100


def blip():
    """Idle, one sharp blip of the throttle, settle back: 1.7 s."""
    length = 1.7

    def rpm(t: float) -> float:
        idle, peak = 900.0, 3900.0
        if t < 0.40:
            return idle
        if t < 0.62:
            x = (t - 0.40) / 0.22
            return idle + (peak - idle) * (1 - (1 - x) ** 2)
        if t < 0.70:
            return peak
        x = min((t - 0.70) / 0.75, 1.0)
        return idle + (peak - idle) * (1 - x) ** 1.8

    def throttle(t: float) -> float:
        return 0.45 if t < 0.40 else (1.0 if t < 0.70 else 0.3)

    return length, rpm, throttle


def rumble():
    """A lazy idle with two small blips: 1.9 s."""
    length = 1.9

    def rpm(t: float) -> float:
        def bump(c: float, w: float, h: float) -> float:
            return h * np.exp(-(((t - c) / w) ** 2))

        return 760.0 + bump(0.55, 0.12, 1300) + bump(1.15, 0.16, 2100)

    def throttle(t: float) -> float:
        return 0.5 + 0.5 * min(1.0, max(0.0, (rpm(t) - 760) / 1500))

    return length, rpm, throttle


def make(shape) -> np.ndarray:
    rng = np.random.default_rng(1903)
    length, rpm, throttle = shape()
    n = int(length * RATE)
    excitation = np.zeros(n + RATE // 5)
    # Each power stroke: a sharp pressure pulse, fast rise and a short fall.
    k = np.arange(int(0.012 * RATE)) / RATE
    pulse = (1 - np.exp(-k / 0.0004)) * np.exp(-k / 0.0009)
    t, gap, i = 0.03, 315, 0
    while t < length:
        front = 1.0 if i % 2 == 0 else 0.82  # the two cylinders never sound quite alike
        strength = (0.5 + 0.5 * throttle(t)) * front * rng.uniform(0.9, 1.08)
        j = int(t * RATE)
        excitation[j : j + len(pulse)] += strength * pulse
        t += 60.0 / rpm(t) * gap / 360.0 * rng.uniform(0.985, 1.015)
        gap = 405 if gap == 315 else 315
        i += 1
    excitation = excitation[:n]

    # A little turbulence that follows the firings (not bursts of static).
    env = signal.lfilter([1], [1, -0.995], np.abs(excitation))
    env /= env.max()
    x = excitation + rng.standard_normal(n) * env * 0.05

    # The exhaust: pipe resonances, weighted to where a phone speaker plays loud and clean.
    out = np.zeros(n)
    for freq, q, gain in [(110, 2.0, 0.25), (220, 3.0, 0.6), (380, 4.0, 1.0), (640, 5.0, 1.6), (1100, 4.5, 2.2), (1900, 4.0, 1.6), (3000, 3.0, 0.5)]:
        b, a = signal.iirpeak(freq / (RATE / 2), q)
        out += gain * signal.lfilter(b, a, x)
    out /= np.max(np.abs(out))
    out = np.tanh(out * 1.6) / np.tanh(1.6)  # one gentle saturation
    b, a = signal.butter(2, 120 / (RATE / 2), "high")
    out = signal.lfilter(b, a, out)
    b, a = signal.butter(4, 4500 / (RATE / 2), "low")
    out = signal.lfilter(b, a, out)

    fade_in, fade_out = int(0.015 * RATE), int(0.45 * RATE)
    out[:fade_in] *= np.linspace(0, 1, fade_in)
    out[-fade_out:] *= np.linspace(1, 0, fade_out) ** 2
    return out / np.max(np.abs(out)) * 0.84  # about -1.5 dBFS


def main() -> None:
    sounds = Path(__file__).resolve().parent.parent / "assets" / "sounds"
    candidate = "--rumble" in sys.argv
    out = make(rumble if candidate else blip)
    path = sounds / ("scratch.wav" if candidate else "v_twin_rev_2.wav")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((out * 32767).astype("<i2").tobytes())
    print(f"wrote {path} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
