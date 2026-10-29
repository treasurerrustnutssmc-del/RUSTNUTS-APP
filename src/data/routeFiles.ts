// GPX files on the phone: picking one to upload, and handing a route to a maps app. The web
// build has its own version beside this one (routeFiles.web.ts).
//
// Picking allows any file type, because many phones don't know a GPX MIME type; `readGpx` then
// says whether it really is one. Opening writes `<route name>.gpx` to the cache and opens the
// share sheet, where OsmAnd and MyRoute both take GPX files. Sending to Garmin does the same with
// the Garmin-ready copy, for Tread, Explore and Drive to take.

import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { garminFileName, garminGpx } from '../domain/garmin';
import { MAX_BYTES, TOO_BIG, UNREADABLE } from '../domain/gpx';
import { routeFileName } from '../domain/routes';

/**
 * Calls `release` if the file chooser may have closed without telling us. On a phone the pick
 * always settles, so there's nothing to watch. Returns a function that stops watching.
 */
export function releaseOnReturn(release: () => void): () => void {
  return () => {};
}

/** Lets the member pick a file and reads it as text. Null when they back out. */
export async function pickGpxFile(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets || result.assets.length === 0) return null;
  const asset = result.assets[0];
  // Don't read a huge file into memory just to refuse it.
  if (asset.size !== undefined && asset.size > MAX_BYTES) throw new Error(TOO_BIG);
  try {
    const text = await new File(asset.uri).text();
    return { name: asset.name, text };
  } catch {
    throw new Error(UNREADABLE);
  }
}

/** Writes a GPX file to the cache and opens the share sheet with it. */
async function shareGpx(file: File, gpx: string, dialogTitle: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone can’t share files with other apps.');
  file.create({ overwrite: true, intermediates: true });
  await file.write(gpx);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/gpx+xml', UTI: 'com.topografix.gpx', dialogTitle });
}

/** Writes the route's GPX to the cache and opens the share sheet, so a maps app can take it. */
export async function openInMapsApp(name: string, gpx: string): Promise<void> {
  await shareGpx(new File(Paths.cache, routeFileName(name)), gpx, 'Open in maps app');
}

/** Writes the Garmin-ready copy to its own cache folder and opens the share sheet for a Garmin app. */
export async function sendToGarmin(name: string, gpx: string): Promise<void> {
  const copy = garminGpx(gpx, name);
  if (typeof copy === 'string') throw new Error(copy);
  await shareGpx(new File(Paths.cache, 'garmin', garminFileName(name)), copy.gpx, 'Send to Garmin');
}
