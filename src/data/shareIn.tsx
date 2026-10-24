// Lane E: share in. Things shared into the app from another app's Share button open "Share to the
// club". Mounted inside the signed-in tabs, so a share waits until the member is signed in.
// Receiving needs a build with the expo-sharing plugin; the web can't receive, and the library
// throws there, so nothing is mounted on the web.

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ImageManipulator } from 'expo-image-manipulator';
import { useIncomingShare } from 'expo-sharing';
import { createVideoPlayer } from 'expo-video';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { mediaProblem, type PickedMedia } from '../domain/chat';
import { itemFromPayload, sharedDraft, type SharedMedia } from '../domain/shareIn';
import type { RootParams } from '../navigation/types';

export const SHARE_UNREADABLE = 'That couldn’t be opened. Try sharing it again.';

/** Photos and videos need their width and height before they can go up. */
async function measure(m: SharedMedia): Promise<PickedMedia> {
  if (m.kind === 'photo') {
    const image = await ImageManipulator.manipulate(m.uri).renderAsync();
    return { ...m, width: image.width, height: image.height, durationMs: null };
  }
  const player = createVideoPlayer(m.uri);
  try {
    const [still] = await player.generateThumbnailsAsync(0);
    if (!still) throw new Error('No still');
    const durationMs = player.duration > 0 ? Math.round(player.duration * 1000) : null;
    return { ...m, width: still.width, height: still.height, durationMs };
  } finally {
    player.release();
  }
}

/** The draft "Share to the club" opens with: what came across, measured, and notes on the rest. */
async function readyDraft(items: ReturnType<typeof itemFromPayload>[]): Promise<RootParams['ShareIn']> {
  const draft = sharedDraft(items);
  const notes = [...draft.notes];
  const media: PickedMedia[] = [];
  let unreadable = false;
  for (const m of draft.media) {
    try {
      const measured = await measure(m);
      const problem = mediaProblem(measured);
      if (problem) {
        if (!notes.includes(problem)) notes.push(problem);
      } else {
        media.push(measured);
      }
    } catch {
      unreadable = true;
    }
  }
  if (unreadable) notes.push('One of those couldn’t be opened, so it was left out.');
  return { text: draft.text, media, notes };
}

function Listener() {
  const share = useIncomingShare();
  const navigation = useNavigation<NativeStackNavigationProp<RootParams>>();
  const busy = useRef(false);
  const { resolvedSharedPayloads, isResolving, error, clearSharedPayloads, refreshSharePayloads } = share;

  useEffect(() => {
    if (busy.current || isResolving) return;
    if (!error && resolvedSharedPayloads.length === 0) return;
    busy.current = true;
    const items = resolvedSharedPayloads.map(itemFromPayload);
    // Cleared and read again, so sharing the same thing twice still opens.
    clearSharedPayloads();
    refreshSharePayloads();
    (error ? Promise.resolve({ text: '', media: [], notes: [SHARE_UNREADABLE] }) : readyDraft(items))
      .then((params) => navigation.navigate('ShareIn', params))
      .catch(() => navigation.navigate('ShareIn', { text: '', media: [], notes: [SHARE_UNREADABLE] }))
      .finally(() => {
        busy.current = false;
      });
  }, [resolvedSharedPayloads, isResolving, error]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export function IncomingShare() {
  return Platform.OS === 'web' ? null : <Listener />;
}
