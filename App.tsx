import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ClubProvider, useClub } from './src/data/ClubStore';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors } from './src/theme';
import { DemoBar } from './src/ui/DemoBar';
import { RefreshBanner } from './src/ui/RefreshBanner';
import { useAppFonts } from './src/useAppFonts';

function Shell() {
  const { isDemo, loading, refreshError } = useClub();
  const insets = useSafeAreaInsets();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.redText} />
      </View>
    );
  }
  if (!isDemo) {
    // Same tree whether or not the refresh strip shows, so the screens never reset. While it
    // shows, it takes the top safe area and the screens below don't pad for the notch twice.
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink }}>
        <RefreshBanner />
        <SafeAreaInsetsContext.Provider value={refreshError ? { ...insets, top: 0 } : insets}>
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

export default function App() {
  const fontsReady = useAppFonts();
  const content = fontsReady ? (
    <ClubProvider>
      <Shell />
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
