import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ClubProvider, useClub } from './src/data/ClubStore';
import { ChatProvider } from './src/data/chat/ChatProvider';
// Stage 7: social extras
import { SocialProvider } from './src/data/social/SocialProvider';
// Lane E: ride comms
import { RideVoiceProvider } from './src/data/rideVoice';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors } from './src/theme';
import { DemoBar } from './src/ui/DemoBar';
import { appMode, useAppMode } from './src/data/reviewMode';
import { RefreshBanner } from './src/ui/RefreshBanner';
// Lane E: share in
import { useWaitingShare } from './src/data/shareIn';
import { shareWaitStage } from './src/domain/shareIn';
import { ShareWaitingStrip } from './src/ui/ShareWaitingStrip';
import { useAppFonts } from './src/useAppFonts';

function Shell() {
  const { isDemo, loading, refreshError, level, needsApplication, loadError, me } = useClub();
  const insets = useSafeAreaInsets();
  // Lane E: share in. Shared in by someone without "Share to the club": say why nothing opened.
  const share = useWaitingShare(
    loading ? null : shareWaitStage({ level, needsApplication, loadError: loadError !== null, status: me?.status ?? null }),
  );
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.redText} />
      </View>
    );
  }
  if (!isDemo) {
    // Same tree whether or not the refresh or share strip shows, so the screens never reset. While
    // one shows, it takes the top safe area and the screens below don't pad for the notch twice.
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink }}>
        <RefreshBanner />
        {share ? <ShareWaitingStrip {...share} padTop={!refreshError} /> : null}
        <SafeAreaInsetsContext.Provider value={refreshError || share ? { ...insets, top: 0 } : insets}>
          <View style={{ flex: 1 }}>
            <RootNavigator />
          </View>
        </SafeAreaInsetsContext.Provider>
      </View>
    );
  }
  // The demo strip takes the top safe area, so screens below it don't pad for the notch twice.
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <DemoBar />
      {share ? <ShareWaitingStrip {...share} padTop={false} /> : null}
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={{ flex: 1 }}>
          <RootNavigator />
        </View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

// The phone-preview page already pads itself clear of the notch, so the app mustn't add it again.
const IN_PREVIEW_PAGE =
  Platform.OS === 'web' && (globalThis as { __RUSTNUTS_PREVIEW__?: boolean }).__RUSTNUTS_PREVIEW__ === true;
const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

// Store review demo: read whether this phone is in it before anything live starts.
void appMode.load();

export default function App() {
  const fontsReady = useAppFonts();
  const mode = useAppMode();
  // A new mode gets a fresh set of providers, so nothing of the live club lingers in the review demo.
  const content = fontsReady && mode !== 'loading' ? (
    <ClubProvider key={mode}>
      <ChatProvider>
        {/* Lane E: ride comms */}
        <RideVoiceProvider>
          {/* Stage 7: social extras */}
          <SocialProvider>
            <Shell />
          </SocialProvider>
        </RideVoiceProvider>
      </ChatProvider>
    </ClubProvider>
  ) : null;
  return (
    <SafeAreaProvider style={{ backgroundColor: colors.ink }}>
      <StatusBar style="light" />
      {content && IN_PREVIEW_PAGE ? (
        <SafeAreaInsetsContext.Provider value={NO_INSETS}>{content}</SafeAreaInsetsContext.Provider>
      ) : content ? (
        content
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.redText} />
        </View>
      )}
    </SafeAreaProvider>
  );
}
