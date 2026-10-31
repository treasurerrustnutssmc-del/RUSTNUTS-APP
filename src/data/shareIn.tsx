// Lane E: share in. Things shared into the app from another app's Share button open "Share to the
// club". Mounted inside the signed-in tabs, so a share waits until the member is signed in.
// Receiving needs a build with the expo-sharing plugin. The web can't receive, and a build without
// the module (an older build given this code over the air) mustn't crash, so the library is only
// loaded when its native module is there, and anything it throws leaves the app running.

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';
import type * as Sharing from 'expo-sharing';
import { createVideoPlayer } from 'expo-video';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { mediaProblem, type PickedMedia } from '../domain/chat';
import { itemFromPayload, letsGoOfShare, sharedDraft, type IncomingPayload, type SharedItem, type SharedMedia, type ShareWaitStage } from '../domain/shareIn';
import type { RootParams } from '../navigation/types';

export const SHARE_UNREADABLE = 'That couldn’t be opened. Try sharing it again.';
const VIDEO_LENGTH_UNKNOWN = 'A video’s length couldn’t be read, so it was left out.';
const UNREADABLE_ITEM = 'One of those couldn’t be opened, so it was left out.';

const canReceive = Platform.OS !== 'web' && requireOptionalNativeModule('ExpoSharing') != null;

// The library shares one folder for everything shared in, and names files as they were named (two
// edited iPhone photos are both FullSizeRender.jpg), so each one is copied to a name of its own.
const shelf = () => new Directory(Paths.cache, 'shared-in');

function clearShelf() {
  try {
    const dir = shelf();
    if (dir.exists) dir.delete();
  } catch {
    // Only tidying; the system clears the cache too.
  }
}

async function ownCopy(m: SharedMedia, index: number): Promise<SharedMedia> {
  const dir = shelf();
  dir.create({ intermediates: true, idempotent: true });
  const source = new File(m.uri);
  const copy = new File(dir, `${Date.now()}-${index}${source.extension || (m.kind === 'video' ? '.mp4' : '.jpg')}`);
  await source.copy(copy);
  return { ...m, uri: copy.uri, fileSize: m.fileSize ?? copy.size };
}

function videoLength(uri: string): Promise<{ durationMs: number | null; width: number; height: number }> {
  const player = createVideoPlayer(uri);
  return new Promise<number | null>((resolve) => {
    const done = (seconds: number | null) => {
      clearTimeout(timer);
      sub.remove();
      failed.remove();
      resolve(seconds != null && seconds > 0 ? Math.round(seconds * 1000) : null);
    };
    const timer = setTimeout(() => done(player.duration || null), 8000);
    const sub = player.addListener('sourceLoad', (e) => done(e.duration));
    const failed = player.addListener('statusChange', (e) => e.status === 'error' && done(null));
    if (player.duration > 0) done(player.duration);
  })
    .then(async (durationMs) => {
      const [still] = await player.generateThumbnailsAsync(0);
      if (!still) throw new Error('No still');
      const size = { durationMs, width: still.width, height: still.height };
      still.release();
      return size;
    })
    .finally(() => player.release());
}

/** Photos and videos need their width and height before they can go up, and videos their length. */
async function measure(m: SharedMedia): Promise<PickedMedia> {
  if (m.kind === 'photo') {
    const image = await ImageManipulator.manipulate(m.uri).renderAsync();
    try {
      return { ...m, width: image.width, height: image.height, durationMs: null };
    } finally {
      image.release();
    }
  }
  return { ...m, ...(await videoLength(m.uri)) };
}

/** The draft "Share to the club" opens with: what came across, measured, and notes on the rest. */
async function readyDraft(items: SharedItem[]): Promise<RootParams['ShareIn']> {
  const draft = sharedDraft(items);
  const notes = [...draft.notes];
  const note = (n: string) => {
    if (!notes.includes(n)) notes.push(n);
  };
  const media: PickedMedia[] = [];
  for (const [i, m] of draft.media.entries()) {
    // Too big is refused before a copy is made.
    const early = m.fileSize != null ? mediaProblem({ ...m, width: 0, height: 0, durationMs: null }) : null;
    if (early) {
      note(early);
      continue;
    }
    try {
      const measured = await measure(await ownCopy(m, i));
      const problem = measured.kind === 'video' && measured.durationMs === null ? VIDEO_LENGTH_UNKNOWN : mediaProblem(measured);
      if (problem) note(problem);
      else media.push(measured);
    } catch {
      note(UNREADABLE_ITEM);
    }
  }
  if (!draft.text && media.length === 0 && notes.length === 0) notes.push(SHARE_UNREADABLE);
  return { text: draft.text, media, notes };
}

/** Before a link is looked up (or when it can't be, with no signal), what the other app handed over. */
const unresolved = (p: Sharing.SharePayload): IncomingPayload => ({
  ...p,
  contentUri: null,
  contentType: null,
  contentMimeType: null,
  contentSize: null,
});

function Listener() {
  // Loaded here, not imported, so a build without the module never loads it.
  const { useIncomingShare } = require('expo-sharing') as typeof Sharing; // eslint-disable-line @typescript-eslint/no-require-imports
  const share = useIncomingShare();
  const navigation = useNavigation<NativeStackNavigationProp<RootParams>>();
  const busy = useRef(false);
  const [finished, setFinished] = useState(0); // runs the check again for anything shared meanwhile
  const { sharedPayloads, resolvedSharedPayloads, isResolving, error, clearSharedPayloads, refreshSharePayloads } = share;

  useEffect(clearShelf, []); // copies from last time were either sent or left behind

  useEffect(() => {
    if (busy.current || isResolving) return;
    const payloads: IncomingPayload[] = error ? sharedPayloads.map(unresolved) : resolvedSharedPayloads;
    if (payloads.length === 0) return;
    busy.current = true;
    // Cleared and read again, so sharing the same thing twice still opens.
    clearSharedPayloads();
    refreshSharePayloads();
    readyDraft(payloads.map(itemFromPayload))
      .catch(() => ({ text: '', media: [], notes: [SHARE_UNREADABLE] }))
      .then((params) => navigation.navigate('ShareIn', params))
      .finally(() => {
        busy.current = false;
        setFinished((n) => n + 1);
      });
  }, [finished, sharedPayloads, resolvedSharedPayloads, isResolving, error]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Whatever the library throws, the app carries on without share in. */
class Contained extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * For everyone without "Share to the club" (the listener above is only mounted for members): whether
 * to show the waiting-share strip. The share is only looked at here, so a signed-out one stays with
 * the phone and opens once they sign in. It's let go when they tap the strip's button, and, for
 * anyone who can never open it, when they leave the app (see letsGoOfShare).
 */
export function useWaitingShare(stage: ShareWaitStage | null): { stage: ShareWaitStage; dismiss: () => void } | null {
  // Which stage the strip is showing for, so moving on (signing in, being approved) drops it.
  const [shownFor, setShownFor] = useState<ShareWaitStage | null>(null);
  useEffect(() => {
    if (!canReceive || stage === null) return;
    const check = () => {
      try {
        setShownFor(sharing().getSharedPayloads().length > 0 ? stage : null);
      } catch {
        setShownFor(null);
      }
    };
    check();
    // A share from another app brings this one back to the front, so it's checked again then.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
      else if (state === 'background' && letsGoOfShare(stage, 'background')) letGo();
    });
    return () => {
      sub.remove();
      setShownFor(null); // so a later visit to this stage never starts with an old strip
    };
  }, [stage]);
  if (stage === null || shownFor !== stage) return null;
  return {
    stage,
    dismiss: () => {
      letGo();
      setShownFor(null);
    },
  };
}

/** Loaded when needed, not imported, so a build without the module never loads it. */
const sharing = () => require('expo-sharing') as typeof Sharing; // eslint-disable-line @typescript-eslint/no-require-imports

function letGo() {
  try {
    sharing().clearSharedPayloads();
  } catch {
    // Nothing more to do; the strip goes either way.
  }
}

export function IncomingShare() {
  return canReceive ? (
    <Contained>
      <Listener />
    </Contained>
  ) : null;
}
