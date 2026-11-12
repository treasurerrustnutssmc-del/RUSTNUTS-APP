import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clearIfOlder, dismissToast, initialToasts, pushToast, toastDuration } from '../domain/toast';
import { colors, fonts, radius, space } from '../theme';

type ToastAction = { label: string; onPress: () => void };
type ShowToast = (text: string, action?: ToastAction) => void;

const ToastContext = createContext<ShowToast>(() => undefined);
const ScreenChangeContext = createContext<(onTabs: boolean) => void>(() => undefined);

/** For the navigator: tell the toast the screen changed, and whether the tab bar is showing. */
export const useToastScreenChange = () => useContext(ScreenChangeContext);

/** A toast older than this is cleared when you move to another screen. */
const CLEAR_ON_NAVIGATE_AFTER_MS = 1500;

/** Show a short confirmation: show('Saved'), or show('Going', { label: 'Undo', onPress }). */
export const useToast = (): ShowToast => useContext(ToastContext);

/** Holds the one toast on screen. It sits just above the tab bar and never blocks taps outside itself. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(initialToasts);
  const insets = useSafeAreaInsets();
  const show = useCallback<ShowToast>(
    (text, action) => setState((s) => pushToast(s, { text, actionLabel: action?.label, onAction: action?.onPress })),
    [],
  );
  const toast = state.current;
  // The tab bar sits under the toast on the tabs; on a stack screen there is none, so it sits lower.
  const [onTabs, setOnTabs] = useState(true);
  const screenChanged = useCallback((tabs: boolean) => {
    setOnTabs(tabs);
    setState((s) => clearIfOlder(s, Date.now(), CLEAR_ON_NAVIGATE_AFTER_MS));
  }, []);
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = toast.id;
    // iOS ignores the live region, so say it out loud as well.
    AccessibilityInfo.announceForAccessibility(toast.text);
    const timer = setTimeout(() => setState((s) => dismissToast(s, id)), toastDuration(toast, screenReader));
    return () => clearTimeout(timer);
  }, [toast, screenReader]);

  return (
    <ToastContext.Provider value={show}>
      <ScreenChangeContext.Provider value={screenChanged}>{children}</ScreenChangeContext.Provider>
      {toast ? (
        <View pointerEvents="box-none" style={[styles.wrap, { bottom: (onTabs ? 84 : 24) + insets.bottom }]}>
          <View style={styles.toast} accessibilityLiveRegion="polite" role="status">
            <Text style={styles.text}>{toast.text}</Text>
            {toast.onAction && toast.actionLabel ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  toast.onAction?.();
                  setState((s) => dismissToast(s, toast.id));
                }}
                style={styles.action}
              >
                <Text style={styles.actionText}>{toast.actionLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    maxWidth: 520,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    minHeight: 48,
    backgroundColor: colors.steelHi,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
  },
  text: { flexShrink: 1, fontFamily: fonts.stencil, fontSize: 15, color: colors.bone, paddingVertical: space.sm },
  action: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  actionText: { fontFamily: fonts.stencil, fontSize: 15, color: colors.redText, textTransform: 'uppercase' },
});
