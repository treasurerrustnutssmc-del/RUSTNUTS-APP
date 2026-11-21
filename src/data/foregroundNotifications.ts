// What a notification does when it arrives while the app is open (src/domain/notifications.ts,
// foregroundPlan decides). Android's chat and club channels don't pop up over an open app, so the club's
// own banner (src/ui/IncomingBanner.tsx) shows it at the top, and the phone files it and plays the
// channel's sound (the bike, for members who keep the rev; quiet when the phone is on silent). Nothing
// for the chat that's on screen. Set up once, from index.ts, before anything can arrive.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { bannerLine, foregroundPlan } from '../domain/notifications';
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

/** The banner, while it's on screen. Call what it returns when the banner goes (signed out). */
export function presentIncoming(show: Presenter): () => void {
  presenter = show;
  return () => {
    if (presenter === show) presenter = null;
  };
}

if (Platform.OS === 'ios' || Platform.OS === 'android') {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const data = (n.request.content.data ?? {}) as Record<string, unknown>;
      const plan = foregroundPlan(data, viewingChat(), { inAppBanner: presenter !== null });
      if (plan.inApp && presenter) {
        presenter({ id: n.request.identifier, title: n.request.content.title ?? 'Rustnuts', body: bannerLine(n.request.content.body ?? '', data), data });
      }
      return { shouldShowBanner: plan.phone.banner, shouldShowList: plan.phone.list, shouldPlaySound: plan.phone.sound, shouldSetBadge: false };
    },
  });
}
