// GPX files in the web build: a hidden file input to pick one, and a download to hand it on.
// The preview runs inside a page whose URL the app doesn't control, so nothing here navigates.

import { MAX_BYTES, TOO_BIG, UNREADABLE } from '../domain/gpx';
import { routeFileName } from '../domain/routes';

/** Marks the hidden file input, so a new pick can clear away one left behind by an earlier pick. */
const PICKER_ATTR = 'data-rustnuts-gpx-picker';

/**
 * Calls `release` the next time the window gets focus back, which it does when the browser's
 * file chooser closes. Browsers without the input's cancel event never settle a backed-out pick,
 * so this is what frees the button. Returns a function that stops watching.
 */
export function releaseOnReturn(release: () => void): () => void {
  const onFocus = () => release();
  window.addEventListener('focus', onFocus, { once: true });
  return () => window.removeEventListener('focus', onFocus);
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

/** Downloads the route as `<route name>.gpx`, to open in OsmAnd or MyRoute. */
export async function openInMapsApp(name: string, gpx: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = routeFileName(name);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before letting the file go.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
