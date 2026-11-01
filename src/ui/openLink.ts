import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { opensInApp } from '../domain/inAppBrowser';
import { colors } from '../theme';

/**
 * Opens a link. Web pages (the club website, shop, sponsors) open in a browser sheet inside the
 * app: the close (X) button, and on Android the phone's back button, return to the screen you
 * were on. Facebook, Instagram, Spotify, YouTube, maps and the like go to their own apps, and
 * phone, text and email links go to the phone. On the web build every link opens in a new browser
 * tab, so the app stays open in its own tab.
 *
 * Rejects only when the phone can't open the link at all, so callers can show their own message.
 */
let sheetOpen = false;

export async function openLink(url: string): Promise<void> {
  if (Platform.OS !== 'web' && opensInApp(url)) {
    // A second tap while the sheet is already up (iOS throws for that) does nothing, rather than
    // leaving the app for Safari.
    if (sheetOpen) return;
    sheetOpen = true;
    try {
      await WebBrowser.openBrowserAsync(url, {
        toolbarColor: colors.ink,
        secondaryToolbarColor: colors.ink2,
        controlsColor: colors.redText,
        dismissButtonStyle: 'close',
        showTitle: true,
        enableBarCollapsing: true,
      });
      return;
    } catch {
      // No in-app browser on this phone (no browser supporting Custom Tabs): hand it to the phone.
    } finally {
      sheetOpen = false;
    }
  }
  await Linking.openURL(url);
}
