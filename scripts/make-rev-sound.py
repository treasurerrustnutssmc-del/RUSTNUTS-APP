"""Makes assets/sounds/v_twin_rev.wav, the notification sound: a V-twin idling, blipped and settling.

Synthesised from scratch (no recording), so the club owns it outright. Run: python3 scripts/make-rev-sound.py
(needs numpy and scipy). A 45-degree V-twin fires at uneven gaps of 315 and 405 crank degrees, which
is the lumpy "potato" beat; each firing is a pressure kick rung through an exhaust's resonances.
"""

import wave
from pathlib import Path

import numpy as np
from scipy import signal

RATE = 44_100
LENGTH = 2.4  # seconds; iPhone allows up to 30
rng = np.random.default_rng(1903)


def rpm_at(t: float) -> float:
    """Idle, a quick blip, then back down to a lumpy idle."""
    idle, peak = 820.0, 4300.0
    if t < 0.55:
        return idle + 40 * np.sin(t * 9)
    if t < 0.85:  # throttle snapped open
        x = (t - 0.55) / 0.30
        return idle + (peak - idle) * (1 - (1 - x) ** 2.2)
    if t < 0.95:
        return peak
    x = min((t - 0.95) / 0.9, 1.0)  # throttle shut, revs fall
    return idle + (peak - idle) * (1 - x) ** 1.6


def throttle_at(t: float) -> float:
    if t < 0.55:
        return 0.35
    if t < 0.95:
        return 1.0
    return 0.18 if t < 1.6 else 0.3


def firings():
    """(time, strength) for each power stroke."""
    t, gap_deg, n = 0.04, 315, 0
    while t < LENGTH:
        thr = throttle_at(t)
        front = 1.0 if n % 2 == 0 else 0.86  # the two cylinders never sound quite alike
        yield t, (0.45 + 0.55 * thr) * front * rng.uniform(0.85, 1.12)
        rev_seconds = 60.0 / rpm_at(t)
        t += rev_seconds * gap_deg / 360.0 * rng.uniform(0.97, 1.03)
        gap_deg = 405 if gap_deg == 315 else 315
        n += 1


def exhaust_kick() -> np.ndarray:
    """One firing as heard at the pipe: a thump plus raspy mid-range from the baffles."""
    n = int(0.09 * RATE)
    t = np.arange(n) / RATE
    thump = sum(a * np.exp(-t / d) * np.sin(2 * np.pi * f * t) for f, a, d in [(62, 1.0, 0.025), (124, 0.7, 0.018), (310, 0.55, 0.012)])
    rasp = rng.standard_normal(n) * np.exp(-t / 0.006)
    b, a = signal.butter(2, [500 / (RATE / 2), 2600 / (RATE / 2)], btype="band")
    return thump + 0.9 * signal.lfilter(b, a, rasp)


def main() -> None:
    out = np.zeros(int(LENGTH * RATE) + RATE // 10)
    kick = exhaust_kick()
    for when, strength in firings():
        i = int(when * RATE)
        seg = out[i : i + len(kick)]
        seg += strength * kick[: len(seg)]
    # A couple of pops on the overrun, as the revs fall.
    for when in (1.18, 1.31, 1.52):
        i = int(when * RATE)
        n = int(0.03 * RATE)
        pop = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.004 * RATE)) * 0.9
        out[i : i + n] += pop
    out = out[: int(LENGTH * RATE)]

    # Grit: drive it hard so the harmonics land where a phone speaker can play them.
    out = np.tanh(out * 3.2)
    b, a = signal.butter(2, 90 / (RATE / 2), btype="high")  # phone speakers can't do the deep end anyway
    out = signal.lfilter(b, a, out)
    b, a = signal.butter(2, 6000 / (RATE / 2), btype="low")
    out = signal.lfilter(b, a, out)
    # Lift the 800 Hz–2 kHz bark, where small speakers are loudest.
    b, a = signal.butter(2, [800 / (RATE / 2), 2000 / (RATE / 2)], btype="band")
    out = out + 0.6 * signal.lfilter(b, a, out)

    fade_in = int(0.01 * RATE)
    fade_out = int(0.35 * RATE)
    out[:fade_in] *= np.linspace(0, 1, fade_in)
    out[-fade_out:] *= np.linspace(1, 0, fade_out) ** 1.5
    # Squash the peaks so it's loud enough to hear in a pocket, then sit just under full scale.
    out = np.tanh(out / np.max(np.abs(out)) * 2.0)
    out = out / np.max(np.abs(out)) * 0.89  # about -1 dBFS

    path = Path(__file__).resolve().parent.parent / "assets" / "sounds" / "v_twin_rev.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((out * 32767).astype("<i2").tobytes())
    print(f"wrote {path} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
