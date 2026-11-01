// Text contrast, worked out the WCAG way, so a screen never has to guess whether a muted colour is
// readable on the surface it sits on. Pure: hex in, number out.

const AA_BODY = 4.5;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two #rrggbb colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The first colour in `candidates` (quietest first) that reads at 4.5:1 on `surface`. If none does, the one
 * with the most contrast, so a bad surface choice still gets the best available answer.
 */
export function pickReadable(candidates: string[], surface: string, minimum = AA_BODY): string {
  if (!candidates.length) throw new Error('pickReadable needs at least one colour to choose from');
  let best = candidates[0];
  let bestRatio = 0;
  for (const colour of candidates) {
    const ratio = contrastRatio(colour, surface);
    if (ratio >= minimum) return colour;
    if (ratio > bestRatio) {
      best = colour;
      bestRatio = ratio;
    }
  }
  return best;
}
