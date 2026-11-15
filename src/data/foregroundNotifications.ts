// What a notification does when it arrives while the app is open (src/domain/notifications.ts,
// foregroundPlan decides). Android's chat and club channels don't pop up over an open app, so the club's
// own banner (src/ui/IncomingBanner.tsx) shows it at the top and the app plays the bike itself. Nothing
// for the chat that's on screen. Set up once, from index.ts, before anything can arrive.

import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { foregroundPlan } from '../domain/notifications';
import { viewingChat } from './viewingChat';

/** One notification for the club's banner. */
export interface IncomingNotice {
  id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

type Presenter = (n: IncomingNotice) => void;

let presenter: Presenter | null = null;
let revSound = true;

/** The banner, while it's on screen, and whether this member wants the bike. Call what it returns
 *  when the banner goes (signed out). */
export function presentIncoming(show: Presenter, wantsRev: boolean): () => void {
  presenter = show;
  revSound = wantsRev;
  return () => {
    if (presenter === show) presenter = null;
  };
}

let player: AudioPlayer | null = null;

/** The Harley rev (the same file the phone build bundles for pushes). A problem just means no sound. */
function playRev(): void {
  try {
    player ??= createAudioPlayer(require('../../assets/sounds/v_twin_rev_2.wav'));
    void Promise.resolve(player.seekTo(0))
      .then(() => player?.play())
      .catch(() => undefined);
  } catch {
    player = null;
  }
}

if (Platform.OS === 'ios' || Platform.OS === 'android') {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const data = (n.request.content.data ?? {}) as Record<string, unknown>;
      const plan = foregroundPlan(data, viewingChat(), { inAppBanner: presenter !== null, revSound });
      if (plan.inApp && presenter) {
        presenter({ id: n.request.identifier, title: n.request.content.title ?? 'Rustnuts', body: n.request.content.body ?? '', data });
      }
      if (plan.playRev) playRev();
      return { shouldShowBanner: plan.phone.banner, shouldShowList: plan.phone.list, shouldPlaySound: plan.phone.sound, shouldSetBadge: false };
    },
  });
}
