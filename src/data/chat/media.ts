// Picking photos and videos on the phone, and getting them ready to upload: photos are shrunk to
// 2048 px JPEGs (a phone photo goes from about 4 MB to about 400 KB), and videos get a still for
// the chat and the feeds.

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { createVideoPlayer } from 'expo-video';
import { Platform } from 'react-native';
import { MAX_MEDIA, MAX_VIDEO_MS, mediaProblem, type PickedMedia } from '../../domain/chat';

const LONGEST_SIDE = 2048;

export class PickProblem extends Error {}

/** Opens the photo library (several at once) or the camera. Nothing picked gives an empty list. */
export async function pickMedia(source: 'library' | 'camera', room = MAX_MEDIA, photosOnly = false): Promise<PickedMedia[]> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: photosOnly ? ['images'] : ['images', 'videos'],
    quality: 1,
    videoMaxDuration: MAX_VIDEO_MS / 1000,
  };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const allowed = await ImagePicker.requestCameraPermissionsAsync();
    if (!allowed.granted) throw new PickProblem('Rustnuts needs the camera for that. Turn it on in your phone’s settings.');
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: Math.max(room, 1) });
  }
  if (result.canceled) return [];
  const picked = result.assets.map((a): PickedMedia => ({
    uri: a.uri,
    kind: a.type === 'video' || a.type === 'pairedVideo' ? 'video' : 'photo',
    // iPhones give a video's length (and sometimes its size) with fractions; the club keeps whole numbers.
    width: Math.round(a.width),
    height: Math.round(a.height),
    durationMs: a.duration == null ? null : Math.round(a.duration),
    fileSize: a.fileSize ?? a.file?.size ?? null,
    mimeType: a.mimeType ?? a.file?.type ?? null,
  }));
  const problem = picked.map(mediaProblem).find(Boolean);
  if (problem) throw new PickProblem(problem);
  return picked;
}

export interface Upload {
  bytes: ArrayBuffer;
  contentType: string;
  width: number;
  height: number;
}

async function bytesOf(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') return (await fetch(uri)).arrayBuffer();
  return new File(uri).arrayBuffer();
}

async function shrunkJpeg(source: Parameters<typeof ImageManipulator.manipulate>[0], width: number, height: number): Promise<Upload> {
  const context = ImageManipulator.manipulate(source);
  const longest = Math.max(width, height);
  if (longest > LONGEST_SIDE) {
    context.resize(width >= height ? { width: LONGEST_SIDE } : { height: LONGEST_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return { bytes: await bytesOf(saved.uri), contentType: 'image/jpeg', width: saved.width, height: saved.height };
}

/** The file to upload, and for a video its still (none on the web, where the chat shows a plain tile). */
export async function prepareUpload(p: PickedMedia): Promise<{ file: Upload; poster: Upload | null }> {
  if (p.kind === 'photo') return { file: await shrunkJpeg(p.uri, p.width, p.height), poster: null };
  const contentType = p.mimeType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4'; // others are refused when picked
  const file = { bytes: await bytesOf(p.uri), contentType, width: p.width, height: p.height };
  if (Platform.OS === 'web') return { file, poster: null };
  const player = createVideoPlayer(p.uri);
  try {
    const [still] = await player.generateThumbnailsAsync(0);
    return { file, poster: still ? await shrunkJpeg(still, still.width, still.height) : null };
  } catch {
    return { file, poster: null };
  } finally {
    player.release();
  }
}
