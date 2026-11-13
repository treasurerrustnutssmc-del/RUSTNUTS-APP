// Website links that open the app (https://www.rustnutssmc.com.au/open/…). A link that opened the
// app, or arrived while it was running, waits here until the signed-in screens can open it, the
// same way a tapped notification does (notificationTaps.tsx). Signed out, it waits five minutes
// for the sign-in. The web build never reads its own address, so none of this runs there.

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import { appLinkTarget, linkToOpen, type WaitingLink } from '../domain/appLinks';
import type { RootParams } from '../navigation/types';

let waiting: WaitingLink | null = null;
const listeners = new Set<() => void>();

function receive(url: string | null | undefined): boolean {
  const target = url ? appLinkTarget(url) : null;
  if (!target) return false;
  waiting = { target, at: Date.now() };
  listeners.forEach((l) => l());
  return true;
}

if (Platform.OS !== 'web') {
  // Read once, when the app starts: the link that opened it, if any.
  Linking.getInitialURL().then(receive).catch(() => {});
  Linking.addEventListener('url', ({ url }) => receive(url));
}

/** For links tapped inside the app (a ride link in a chat): opens them here, no browser. Returns
 *  false when the link isn't an app link, so the caller opens it as a web page. */
export function openAppLink(url: string): boolean {
  return Platform.OS !== 'web' && receive(url);
}

function LinkListener() {
  const navigation = useNavigation<NativeStackNavigationProp<RootParams>>();
  useEffect(() => {
    const open = () => {
      const ride = linkToOpen(waiting, Date.now());
      waiting = null; // opened once, even when the screens rebuild
      if (ride) navigation.navigate('RideDetail', ride);
    };
    open();
    listeners.add(open);
    return () => {
      listeners.delete(open);
    };
  }, [navigation]);
  return null;
}

/** Renders nothing. Put it inside the signed-in screens (members and Family). */
export function AppLinks() {
  return Platform.OS === 'web' ? null : <LinkListener />;
}
