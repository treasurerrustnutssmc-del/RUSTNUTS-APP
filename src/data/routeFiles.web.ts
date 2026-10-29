// GPX files in the web build: a hidden file input to pick one, and a download to hand it on.
// The preview runs inside a page whose URL the app doesn't control, so nothing here navigates.

import { garminFileName, garminGpx } from '../domain/garmin';
import { MAX_BYTES, TOO_BIG, UNREADABLE } from '../domain/gpx';
import { routeFileName } from '../domain/routes';
import { releaseAfterReturn, type ReturnWatch } from './pickGuard';

/** Marks the hidden file input, so a new pick can clear away one left behind by an earlier pick. */
const PICKER_ATTR = 'data-rustnuts-gpx-picker';

/** How many file choices have arrived, from any pick: releaseAfterReturn's sign that a file came. */
let changes = 0;

const browserWindow: ReturnWatch = {
  onFocusOnce(fn) {
    window.addEventListener('focus', fn, { once: true });
    return () => window.removeEventListener('focus', fn);
  },
  changes: () => changes,
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

/**
 * Calls `release` a moment after the window gets focus back, which it does when the browser's
 * file chooser closes, unless a file arrived. Browsers without the input's cancel event never
 * settle a backed-out pick, so this is what frees the button. Returns a function that stops watching.
 */
export function releaseOnReturn(release: () => void): () => void {
  return releaseAfterReturn(browserWindow, release);
}

/** Opens the browser's file chooser and reads the file as text. Null when they back out. */
export function pickGpxFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    // An earlier pick the browser never reported back on leaves its input behind.
    document.querySelectorAll(`input[${PICKER_ATTR}]`).forEach((old) => old.remove());
    const input = document.createElement('input');
    input.setAttribute(PICKER_ATTR, '');
    input.type = 'file'; // any type: readGpx says whether it's GPX
    input.style.display = 'none';
    const done = () => input.remove();
    input.addEventListener('change', () => {
      changes += 1;
      const file = input.files?.[0];
      done();
      if (!file) return resolve(null);
      if (file.size > MAX_BYTES) return reject(new Error(TOO_BIG));
      file.text().then(
        (text) => resolve({ name: file.name, text }),
        () => reject(new Error(UNREADABLE)),
      );
    });
    // Browsers that fire it tell us the chooser was closed; others leave the promise waiting.
    input.addEventListener('cancel', () => {
      done();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Downloads a GPX file under the given name. */
function downloadGpx(fileName: string, gpx: string): void {
  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before letting the file go.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Downloads the route as `<route name>.gpx`, to open in OsmAnd or MyRoute. */
export async function openInMapsApp(name: string, gpx: string): Promise<void> {
  downloadGpx(routeFileName(name), gpx);
}

/** Downloads the Garmin-ready copy, to copy onto a unit over USB or open in BaseCamp. */
export async function sendToGarmin(name: string, gpx: string): Promise<void> {
  const copy = garminGpx(gpx, name);
  if (typeof copy === 'string') throw new Error(copy);
  downloadGpx(garminFileName(name), copy.gpx);
}
