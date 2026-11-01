// The website's tab and home-screen icons come from the app's own icon (assets/icon.png, the skull
// mascot on black), rendered once by scripts/build-site-icons.py into assets/site-icons and copied
// into the website clone by npm run build:site. One mascot everywhere, task 20 of the website list.

export type SiteIcon = { file: string; size: number; kind: 'png' | 'ico' };

/** Every icon file the website's <head> links, by its path at the site root. */
export const SITE_ICONS: readonly SiteIcon[] = [
  { file: 'favicon.ico', size: 32, kind: 'ico' },
  { file: 'favicon-16x16.png', size: 16, kind: 'png' },
  { file: 'favicon-32x32.png', size: 32, kind: 'png' },
  { file: 'apple-touch-icon.png', size: 180, kind: 'png' },
];

/** Where the rendered set lives in the app repo, beside source.sha256 (the icon.png it came from). */
export const SITE_ICONS_DIR = 'assets/site-icons';

/** Width and height of a PNG from its header, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** The square sizes inside an ICO file, or null when the bytes are not an ICO. */
export function icoSizes(bytes: Uint8Array): number[] | null {
  if (bytes.length < 6) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(0, true) !== 0 || dv.getUint16(2, true) !== 1) return null;
  const count = dv.getUint16(4, true);
  if (bytes.length < 6 + count * 16) return null;
  const sizes: number[] = [];
  for (let i = 0; i < count; i++) {
    const w = bytes[6 + i * 16];
    const h = bytes[7 + i * 16];
    sizes.push(w === h ? (w === 0 ? 256 : w) : -1); // -1: a frame that is not square
  }
  return sizes;
}

/** Why a rendered icon file is wrong for its slot, or null when it fits. */
export function siteIconProblem(icon: SiteIcon, bytes: Uint8Array): string | null {
  if (icon.kind === 'png') {
    const s = pngSize(bytes);
    if (!s) return `${icon.file} is not a PNG`;
    if (s.width !== icon.size || s.height !== icon.size) return `${icon.file} is ${s.width}x${s.height}, not ${icon.size}x${icon.size}`;
    return null;
  }
  const sizes = icoSizes(bytes);
  if (!sizes) return `${icon.file} is not an ICO`;
  if (!sizes.includes(16) || !sizes.includes(icon.size)) return `${icon.file} holds ${sizes.join(', ')}px, not 16 and ${icon.size}`;
  return null;
}
