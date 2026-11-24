// "Save" on a photo or video (gallery design, "anyone can download"). Phones download the file and
// open the share menu, where iPhones offer Save Image / Save Video and Android offers Photos, Drive
// and the rest. A button that saves straight into Photos needs expo-media-library, a native module
// that waits for the next app build. The web downloads the file.

import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { MediaSource } from './chat/chatContext';

export class SaveProblem extends Error {}

const ending = (kind: 'photo' | 'video', path: string) => {
  const m = /\.([a-z0-9]{2,4})$/i.exec(path);
  return m ? m[1].toLowerCase() : kind === 'video' ? 'mp4' : 'jpg';
};

/** The file's name when saved: rustnuts-<date>-<short id>.<ending>. */
export function saveName(kind: 'photo' | 'video', path: string, createdAt: string, id: string): string {
  return `rustnuts-${createdAt.slice(0, 10)}-${id.replace(/[^a-z0-9]/gi, '').slice(0, 8)}.${ending(kind, path)}`;
}

export async function saveToPhone(source: MediaSource, item: { kind: 'photo' | 'video'; path: string; createdAt: string; id: string }): Promise<void> {
  const name = saveName(item.kind, item.path, item.createdAt, item.id);
  // The demo's own pictures: a number on phones, an object with a uri on the web.
  const bundled = source as unknown as { uri?: string };
  const url =
    typeof source === 'string' ? source
    : typeof bundled === 'object' && bundled?.uri ? bundled.uri
    : (await Asset.fromModule(source as number).downloadAsync()).localUri ?? null;
  if (!url) throw new SaveProblem('That one couldn’t be saved. Try again.');
  if (Platform.OS === 'web') {
    const blob = await (await fetch(url)).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new SaveProblem('This phone can’t save from the app. Try again after an update.');
  let local: string;
  if (url.startsWith('file:')) {
    local = url;
  } else {
    const file = await File.downloadFileAsync(url, new File(Paths.cache, name), { idempotent: true });
    local = file.uri;
  }
  const mov = /\.mov$/i.test(name);
  await Sharing.shareAsync(local, {
    mimeType: item.kind === 'video' ? (mov ? 'video/quicktime' : 'video/mp4') : 'image/jpeg',
    UTI: item.kind === 'video' ? (mov ? 'com.apple.quicktime-movie' : 'public.mpeg-4') : 'public.jpeg',
    dialogTitle: item.kind === 'video' ? 'Save the video' : 'Save the photo',
  });
}
