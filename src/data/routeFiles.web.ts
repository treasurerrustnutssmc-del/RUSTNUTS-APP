// GPX files in the web build: a hidden file input to pick one, and a download to hand it on.
// The preview runs inside a page whose URL the app doesn't control, so nothing here navigates.

import { TOO_BIG } from '../domain/gpx';
import { routeFileName } from '../domain/routes';

const MAX_BYTES = 5 * 1024 * 1024;
const UNREADABLE = 'That file couldn’t be read. Try picking it again.';

/** Opens the browser's file chooser and reads the file as text. Null when they back out. */
export function pickGpxFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
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
