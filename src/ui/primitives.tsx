import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type HostInstance,
  type ImageSourcePropType,
  type ScrollViewInstance,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STATUS_LABEL, ROLE_SHORT } from '../domain/labels';
import type { MemberStatus, PositionRole } from '../domain/types';
import type { Compass } from '../domain/compass';
import { colors, fonts, MAX_CONTENT_WIDTH, radius, space, type } from '../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Lets a text box inside a Screen ask to be scrolled clear of the on-screen keyboard. */
type RevealField = { reveal: (field: HostInstance | null) => void; forget: (field: HostInstance | null) => void };
const RevealFieldContext = createContext<RevealField | null>(null);

/**
 * Phones only: while the keyboard is up, the page gets that much extra room at the bottom and
 * the focused box is scrolled up near the top, so you can always see what you're typing.
 * (On the web the browser does this itself.)
 */
function useKeyboardRoom() {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const contentRef = useRef<HostInstance>(null);
  const pending = useRef<HostInstance | null>(null);
  const waitingForRoom = useRef(false);
  const [keyboard, setKeyboard] = useState(0);

  const scrollTo = useCallback((field: HostInstance | null) => {
    const content = contentRef.current;
    if (!field || !content) return;
    field.measureLayout(
      content,
      (_x: number, y: number) => scrollRef.current?.scrollTo({ y: Math.max(0, y - space.xxl * 3), animated: true }),
      () => {},
    );
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const shown = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboard(e.endCoordinates.height);
      // Scroll once the extra room is laid out (onContentSizeChange), with a timer as a backstop.
      waitingForRoom.current = true;
      timer = setTimeout(() => {
        if (waitingForRoom.current) scrollTo(pending.current);
        waitingForRoom.current = false;
      }, 120);
    });
    // The box can stay focused when the keyboard is closed with the back gesture, so the field
    // is only forgotten when it loses focus, not here; tapping it again still scrolls to it.
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      shown.remove();
      hidden.remove();
      clearTimeout(timer);
    };
  }, [scrollTo]);

  const onContentSizeChange = useCallback(() => {
    if (!waitingForRoom.current) return;
    waitingForRoom.current = false;
    scrollTo(pending.current);
  }, [scrollTo]);

  const reveal = useCallback(
    (field: HostInstance | null) => {
      if (Platform.OS === 'web') return;
      pending.current = field;
      if (Keyboard.isVisible()) scrollTo(field); // moving between boxes with the keyboard already up
    },
    [scrollTo],
  );

  const forget = useCallback((field: HostInstance | null) => {
    if (pending.current === field) pending.current = null;
  }, []);

  const field = useMemo(() => ({ reveal, forget }), [reveal, forget]);
  return { scrollRef, contentRef, keyboard, field, onContentSizeChange };
}

export function Screen({
  children,
  scroll = true,
  padTop = false,
  onRefresh,
  scroller,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padTop?: boolean;
  /** Pull down to refresh (live data only). */
  onRefresh?: () => Promise<void>;
  /** Hands over the scroll view, for a screen that jumps to a place in its content. */
  scroller?: (view: ScrollViewInstance | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const { scrollRef, contentRef, keyboard, field, onContentSizeChange } = useKeyboardRoom();
  const [refreshing, setRefreshing] = useState(false);
  const refreshControl = onRefresh ? (
    <RefreshControl
      refreshing={refreshing}
      tintColor={colors.redText}
      colors={[colors.redBright]}
      onRefresh={() => {
        setRefreshing(true);
        onRefresh().finally(() => setRefreshing(false));
      }}
    />
  ) : undefined;
  const inner = (
    <View
      ref={contentRef}
      style={[
        styles.screenInner,
        { paddingTop: padTop ? insets.top + space.lg : space.lg, paddingBottom: insets.bottom + space.xxl + keyboard },
      ]}
    >
      {children}
    </View>
  );
  return (
    <RevealFieldContext.Provider value={scroll ? field : null}>
      <View style={styles.screen}>
        {scroll ? (
          <ScrollView
            ref={(view) => {
              scrollRef.current = view;
              scroller?.(view);
            }}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={refreshControl}
            onContentSizeChange={onContentSizeChange}
          >
            {inner}
          </ScrollView>
        ) : (
          inner
        )}
      </View>
    </RevealFieldContext.Provider>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Stack({ children, gap = space.md, style }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function Display({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[type.display, style]}>{children}</Text>;
}

export function H1({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[type.h1, style]}>{children}</Text>;
}

export function H2({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[type.h2, styles.upper, style]}>{children}</Text>;
}

export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[type.label, style]}>{children}</Text>;
}

type TextProps = { children: React.ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean };

export function Body({ children, style, strong, numberOfLines, selectable }: TextProps & { strong?: boolean }) {
  return (
    <Text numberOfLines={numberOfLines} selectable={selectable} style={[strong ? type.bodyStrong : type.body, style]}>
      {children}
    </Text>
  );
}

export function Small({ children, style, numberOfLines, selectable }: TextProps) {
  return (
    <Text numberOfLines={numberOfLines} selectable={selectable} style={[type.small, style]}>
      {children}
    </Text>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      {/* A long title gives way so the action beside it (often a lock note) is never cut off. */}
      <H2 style={{ flexShrink: 1 }}>{title}</H2>
      {action ? <View style={{ flexShrink: 0 }}>{action}</View> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chips and badges
// ---------------------------------------------------------------------------

type ChipTone = 'red' | 'redOutline' | 'steel' | 'bone' | 'ok' | 'warn' | 'danger';

/**
 * A small stencil label. `active` is for a chip inside a Pressable: pressed or hovered, a steel chip
 * lifts to steelHi with a stronger edge (its opaque fill would hide the Pressable's own highlight).
 */
export function Chip({ label, tone = 'steel', icon, active = false }: { label: string; tone?: ChipTone; icon?: IconName; active?: boolean }) {
  const t = chipTones[tone];
  const lift = active && tone === 'steel' ? { backgroundColor: colors.steelHi, borderColor: colors.lineStrong } : null;
  return (
    <View style={[styles.chip, { backgroundColor: t.bg, borderColor: t.border }, lift]}>
      {icon ? <Ionicons name={icon} size={11} color={t.fg} /> : null}
      {/* Upper-cased here, not by textTransform: Android measures the lower-case text and clips the end. */}
      <Text style={[styles.chipText, { color: t.fg }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

const chipTones: Record<ChipTone, { bg: string; fg: string; border: string }> = {
  red: { bg: colors.red, fg: colors.bone, border: colors.red },
  redOutline: { bg: 'transparent', fg: colors.redText, border: colors.redBright },
  steel: { bg: colors.steel, fg: colors.boneDim, border: colors.steel },
  bone: { bg: 'transparent', fg: colors.boneDim, border: colors.lineStrong },
  ok: { bg: colors.okBg, fg: colors.ok, border: 'transparent' },
  warn: { bg: colors.warnBg, fg: colors.warn, border: 'transparent' },
  danger: { bg: colors.dangerBg, fg: colors.danger, border: 'transparent' },
};

const statusTone: Record<MemberStatus, ChipTone> = {
  full: 'red',
  nomad: 'red',
  fng: 'redOutline',
  introduced: 'bone',
  supporter: 'steel',
  family: 'steel',
  legacy: 'bone',
};

export function StatusChip({ status }: { status: MemberStatus }) {
  return <Chip label={STATUS_LABEL[status]} tone={statusTone[status]} />;
}

export function RoleChip({ role }: { role: PositionRole }) {
  return <Chip label={ROLE_SHORT[role]} tone="bone" />;
}

export function Avatar({ text, size = 44 }: { text: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'quiet';
type ButtonSize = 'regular' | 'small';

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
  size = 'regular',
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  /** Small: a compact button that sits at the start of its line, for a minor act on one item (a step-down under a seat). */
  size?: ButtonSize;
  style?: StyleProp<ViewStyle>;
  /** When the label alone wouldn't say what it acts on, such as "Take off" beside a name. */
  accessibilityLabel?: string;
}) {
  const k = buttonKinds[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      aria-disabled={!!disabled}
      aria-busy={!!busy}
      onPress={disabled || busy ? undefined : onPress}
      hitSlop={size === 'small' ? 4 : undefined}
      style={({ pressed, hovered, focused }: { pressed: boolean; hovered?: boolean; focused?: boolean }) => [
        styles.button,
        size === 'small' && styles.buttonSmall,
        { backgroundColor: pressed || hovered ? k.bgActive : k.bg, borderColor: k.border },
        focused && styles.focusRing,
        disabled && styles.disabled,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={k.fg} /> : icon ? <Ionicons name={icon} size={size === 'small' ? 16 : 18} color={k.fg} /> : null}
      <Text style={[styles.buttonText, size === 'small' && styles.buttonTextSmall, { color: k.fg }]}>{label}</Text>
    </Pressable>
  );
}

const buttonKinds: Record<ButtonKind, { bg: string; bgActive: string; fg: string; border: string }> = {
  primary: { bg: colors.redBright, bgActive: colors.red, fg: colors.bone, border: colors.redBright },
  secondary: { bg: 'transparent', bgActive: colors.steel, fg: colors.bone, border: colors.lineStrong },
  danger: { bg: 'transparent', bgActive: colors.dangerBg, fg: colors.danger, border: colors.danger },
  quiet: { bg: 'transparent', bgActive: colors.steel, fg: colors.boneDim, border: 'transparent' },
};

/** Two-tap confirm for anything you'd regret (the preview page can't show pop-up dialogs). */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  kind = 'danger',
  icon,
  style,
  accessibilityLabel,
  confirmNote,
  disabled,
  size,
  confirmAccessibilityLabel,
}: {
  label: string;
  confirmLabel: string;
  /** For the confirm step, when its short label ("Yes, step down") wouldn't say which item it acts on. */
  confirmAccessibilityLabel?: string;
  onConfirm: () => void;
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  /** For the first button, when its label alone wouldn't say what it acts on. */
  accessibilityLabel?: string;
  /** A line shown above the confirm step, for what confirming will do when the label can't fit it. */
  confirmNote?: string;
  /** Off, and back to the first step if it was armed, while there's a reason it can't go ahead. */
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (armed && disabled) setArmed(false);
  if (!armed || disabled) {
    return (
      <Button
        label={label}
        kind={kind}
        icon={icon}
        disabled={disabled}
        size={size}
        onPress={() => setArmed(true)}
        style={style}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }
  const confirm = (
    <Row style={[{ gap: space.sm }, confirmNote ? null : style]}>
      <Button label={confirmLabel} kind="danger" size={size} accessibilityLabel={confirmAccessibilityLabel} onPress={() => { setArmed(false); onConfirm(); }} style={size === 'small' ? { flexShrink: 1 } : { flex: 1 }} />
      <Button label="Cancel" kind="quiet" size={size} onPress={() => setArmed(false)} />
    </Row>
  );
  if (!confirmNote) return confirm;
  return (
    <View style={[{ gap: space.sm }, style]}>
      <View accessibilityLiveRegion="polite">
        <Body strong>{confirmNote}</Body>
      </View>
      {confirm}
    </View>
  );
}

export function Field({
  label,
  hint,
  error,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const [focused, setFocused] = useState(false);
  const reveal = useContext(RevealFieldContext);
  const box = useRef<HostInstance>(null);
  return (
    <View style={styles.field} ref={box}>
      <Label>{label}</Label>
      <TextInput
        placeholderTextColor={colors.boneMute}
        {...input}
        onFocus={(e) => {
          setFocused(true);
          reveal?.reveal(box.current); // the label comes into view too, not just the box
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          reveal?.forget(box.current);
          input.onBlur?.(e);
        }}
        style={[
          styles.input,
          focused && { borderColor: colors.redBright },
          !!error && { borderColor: colors.danger },
          input.multiline && { minHeight: 96, textAlignVertical: 'top' },
          input.style,
        ]}
      />
      {error ? <Small style={{ color: colors.danger }}>{error}</Small> : hint ? <Small>{hint}</Small> : null}
    </View>
  );
}

export function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.toggle} accessibilityRole="switch" accessibilityState={{ checked: value }} aria-checked={value}>
      <View style={{ flex: 1, gap: 2 }}>
        <Body strong>{label}</Body>
        {description ? <Small>{description}</Small> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.steelHi, true: colors.redBright }}
        thumbColor={colors.bone}
        {...({ activeThumbColor: colors.bone } as object)}
      />
    </Pressable>
  );
}

export function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.field}>
      {label ? <Label>{label}</Label> : null}
      <View style={styles.choices}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => [
                styles.choice,
                selected && styles.choiceSelected,
                pressed && !selected && { backgroundColor: colors.steelHi },
              ]}
            >
              <Text style={[styles.choiceText, selected && { color: colors.bone }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  last,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const content = (
    <>
      {left}
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        {typeof title === 'string' ? <Text numberOfLines={2} style={type.name}>{title}</Text> : title}
        {typeof subtitle === 'string' ? <Small numberOfLines={2}>{subtitle}</Small> : subtitle}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.boneMute} /> : null}
    </>
  );
  if (!onPress) return <View style={[styles.listRow, last && styles.listRowLast]}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.listRow,
        last && styles.listRowLast,
        (pressed || hovered) && { backgroundColor: colors.steel },
      ]}
    >
      {content}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type NoticeTone = 'info' | 'ok' | 'warn' | 'danger';

export function Notice({ tone = 'info', title, children }: { tone?: NoticeTone; title?: string; children?: React.ReactNode }) {
  const t = {
    info: { bg: colors.steel, fg: colors.boneDim, icon: 'information-circle' as IconName },
    ok: { bg: colors.okBg, fg: colors.ok, icon: 'checkmark-circle' as IconName },
    warn: { bg: colors.warnBg, fg: colors.warn, icon: 'alert-circle' as IconName },
    danger: { bg: colors.dangerBg, fg: colors.danger, icon: 'warning' as IconName },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg }]}>
      <Ionicons name={t.icon} size={20} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={[type.name, { color: t.fg }]}>{title}</Text> : null}
        {typeof children === 'string' ? <Small style={{ color: colors.boneDim }}>{children}</Small> : children}
      </View>
    </View>
  );
}

export function LockNote({ text = 'Board only' }: { text?: string }) {
  return (
    <Row style={{ gap: 4 }}>
      <Ionicons name="lock-closed" size={11} color={colors.boneMute} />
      <Label>{text}</Label>
    </Row>
  );
}

export function KeyValue({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  const color = tone ? { ok: colors.ok, warn: colors.warn, danger: colors.danger }[tone] : colors.bone;
  return (
    <View style={styles.kv}>
      <Small style={{ flexShrink: 0 }}>{label}</Small>
      {typeof value === 'string' ? (
        <Text style={[type.name, { color, textAlign: 'right', flexShrink: 1 }]}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

// The club's real artwork. Never retype RUSTNUTS in a lookalike font: the stencil wordmark and the
// EST 2019 logo are the club's trademarks. The club uses the logo with the Australian flag.
const LOGO_RATIO = 765 / 1093;
const SKULL_RATIO = 192 / 143;

export function Logo({ width = 260 }: { width?: number }) {
  const inner = width - space.md * 2;
  return (
    <View style={styles.logoPlate}>
      <Image
        source={require('../../assets/logo.png')}
        style={{ width: inner, height: Math.round(inner * LOGO_RATIO) }}
        resizeMode="contain"
        accessibilityLabel="Rustnuts SMC, established 2019"
      />
    </View>
  );
}

/** The skull on its own, for headers and small spaces. */
export function Skull({ size = 28 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/skull.png')}
      style={{ width: size, height: Math.round(size * SKULL_RATIO) }}
      resizeMode="contain"
      accessibilityLabel="Rustnuts"
    />
  );
}

/**
 * Club flannel, used as an accent only (splash, headers, the disc moment). A dark wash keeps
 * whatever sits on top readable in the sun.
 */
export function Flannel({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <ImageBackground
      source={require('../../assets/flannel.jpg')}
      resizeMode="repeat"
      imageStyle={{ borderRadius: radius.md }}
      style={[styles.flannel, style]}
    >
      <View style={styles.flannelWash} pointerEvents="none" />
      {children}
    </ImageBackground>
  );
}

const DISC_ART: Record<Compass, ImageSourcePropType> = {
  west: require('../../assets/member-disc-west.png'),
  north: require('../../assets/member-disc-north.png'),
  national: require('../../assets/member-disc-national.png'),
  plain: require('../../assets/member-disc.png'),
};

const DISC_LABEL: Record<Compass, string> = {
  west: 'Member disc, West compass',
  north: 'Member disc, North compass',
  national: 'Member disc, National compass',
  plain: 'Member disc',
};

/**
 * The embroidered MEMBER disc in its Chapter Compass Ring (see compassFor). Only shown once
 * someone is a full member (see hasEarnedDisc).
 */
export function MemberDisc({ size = 64, compass }: { size?: number; compass: Compass }) {
  return (
    <Image
      source={DISC_ART[compass]}
      style={{ width: size, height: size }}
      accessibilityLabel={DISC_LABEL[compass]}
    />
  );
}

export function IconBadge({ icon, tone = 'steel' }: { icon: IconName; tone?: 'steel' | 'red' }) {
  return (
    <View style={[styles.iconBadge, { backgroundColor: tone === 'red' ? colors.red : colors.steel }]}>
      <Ionicons name={icon} size={18} color={colors.bone} />
    </View>
  );
}

export { Ionicons };
export type { IconName };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  scrollContent: { flexGrow: 1 },
  screenInner: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    gap: space.lg,
  },
  card: {
    backgroundColor: colors.ink2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  upper: { textTransform: 'uppercase' },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, marginTop: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
    // A long label (a chip with dates) wraps inside the chip rather than running off the card.
    maxWidth: '100%',
  },
  chipText: { fontFamily: fonts.stencil, fontSize: 11.5, letterSpacing: 1, flexShrink: 1 },
  avatar: {
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.redBright,
  },
  avatarText: { fontFamily: fonts.stencil, color: colors.bone, letterSpacing: 0.5 },
  button: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  // Small still clears a 48 touch target with its hitSlop on phones, and 44 without it.
  buttonSmall: { minHeight: 44, paddingHorizontal: space.md, alignSelf: 'flex-start', maxWidth: '100%' },
  // Centred and shrinkable, so a label that has to wrap stays in the middle of its button.
  buttonText: { fontFamily: fonts.stencil, fontSize: 16, letterSpacing: 1.2, textTransform: 'uppercase', textAlign: 'center', flexShrink: 1 },
  buttonTextSmall: { fontSize: 13, letterSpacing: 0.8 },
  focusRing: { outlineColor: colors.redText, outlineWidth: 2, outlineStyle: 'solid' } as ViewStyle,
  disabled: { opacity: 0.45 },
  field: { gap: 6 },
  input: {
    minHeight: 48,
    backgroundColor: colors.steel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    color: colors.bone,
    fontSize: 16,
    fontFamily: fonts.body,
  },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  choice: {
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.steel,
    justifyContent: 'center',
  },
  choiceSelected: { backgroundColor: colors.red, borderColor: colors.redBright },
  choiceText: { fontFamily: fonts.stencil, fontSize: 15, letterSpacing: 0.4, color: colors.boneDim },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  listRowLast: { borderBottomWidth: 0 },
  notice: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.lg, paddingVertical: 2 },
  divider: { height: 1, backgroundColor: colors.line },
  flannel: { borderRadius: radius.md, overflow: 'hidden', padding: space.lg, gap: space.md },
  flannelWash: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(17,16,16,0.76)' },
  logoPlate: { backgroundColor: '#FFFFFF', borderRadius: radius.md, padding: space.md, alignSelf: 'center' },
  iconBadge: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
