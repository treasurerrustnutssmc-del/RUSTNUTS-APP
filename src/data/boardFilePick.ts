// Picking a file or a photo for Board files on the phone. The web build has its own version beside
// this one (boardFilePick.web.ts). The rules (a kind the club keeps, 20 MB or less) are checked by
// addBoardFileProblem before anything goes up.

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import type { PickedBoardFile } from '../domain/boardFiles';
import { formatAuDate } from '../domain/dates';
import { melbourneDate } from '../domain/rides';

export type PickedBoardUpload = PickedBoardFile & { uri: string };

/** One file from the phone's files. Null when they back out. */
export async function pickBoardFile(): Promise<PickedBoardUpload | null> {
  // Every file shows: Android greys out files its file app or Drive doesn't label, so asking for
  // types can leave nothing to tap. addBoardFileProblem checks the pick.
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets || result.assets.length === 0) return null;
  const a = result.assets[0];
  return { uri: a.uri, name: a.name ?? '', size: typeof a.size === 'number' ? a.size : null, mimeType: a.mimeType ?? null };
}

/** One photo from the phone's library, as a JPEG. Null when they back out. */
export async function pickBoardPhoto(): Promise<PickedBoardUpload | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsMultipleSelection: false });
  if (result.canceled || result.assets.length === 0) return null;
  const a = result.assets[0];
  // Below full quality the phone hands back a JPEG, even when the original's name says .HEIC, so the
  // name takes the ending of what was actually picked.
  const mimeType = a.mimeType ?? 'image/jpeg';
  const ending = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const base = (a.fileName ?? '').replace(/\.[a-z0-9]+$/i, '').trim() || `Photo ${formatAuDate(melbourneDate(new Date().toISOString())).replace(/\//g, '-')}`;
  return { uri: a.uri, name: `${base}.${ending}`, size: a.fileSize ?? null, mimeType: ending === 'jpg' ? 'image/jpeg' : mimeType };
}

/** The picked file's bytes, to upload. */
export function boardFileBytes(file: PickedBoardUpload): Promise<ArrayBuffer> {
  return new File(file.uri).arrayBuffer();
}
