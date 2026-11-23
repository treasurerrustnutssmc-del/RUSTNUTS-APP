// Ride comms bubbles (Jeff, 22 Nov 2026): while a ride's comms are on, a round bubble floats on the
// right edge of every screen, one per ride, with how many are connected and its own Emergency
// button that buzzes only the riders on that ride. Tap the bubble for its comms; drag it up or down.
// The rules for which bubbles show are commsBubbles (src/domain/commsBubbles.ts).
// Spec: docs/superpowers/specs/2026-11-23-ride-comms-bubbles-design.md.
//
// DESIGN.md's Flat Clubhouse Rule says nothing floats: this is the one thing that does, because Jeff
// asked for it. It still has no shadow; a ring on steel stands it off the screen.

import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Keyboard, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClub } from '../data/ClubStore';
import { cancelRideEmergency, raiseRideEmergency, sendHeldEmergency, useCommsCounts } from '../data/commsBubblesData';
import { activeRide } from '../data/liveTracker';
import { useRideVoice } from '../data/rideVoice';
import { bubbleLabel, commsBubbles, sosArmed, SOS_ARM_MS, type Bubble } from '../domain/commsBubbles';
import { liveProblem } from '../domain/liveRide';
import { calledOffIds } from '../domain/rideCalls';
import { legLabel } from '../domain/rideLegs';
import { defaultCategories } from '../domain/rides';
import { voiceStatus } from '../domain/rideVoice';
import type { RootParams } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import { Button, Ionicons, Small } from './primitives';

const BUBBLE = 56;
const SOS = 48;
const GAP = space.md;
/** Roughly a bubble with its name under it. */
const ROW = BUBBLE + 22 + GAP;

type Sos =
  | { state: 'sending' }
  | { state: 'sent'; alertId: string }
  | { state: 'held'; pressedAt: string }
  /** The club refused it for good (the ride ended, or you can't be on it): the button can be pressed again. */
  | { state: 'refused'; reason: string };

/** Which screen is showing: the live ride screen's ride, or the photo viewer (no bubbles there). */
function useScreen(navigation: NavigationContainerRefWithCurrent<RootParams>) {
  const read = useCallback(() => {
    const route = navigation.isReady() ? navigation.getCurrentRoute() : undefined;
    return {
      ready: !!route,
      rideId: route?.name === 'LiveRide' ? ((route.params as { rideId?: string } | undefined)?.rideId ?? null) : null,
      viewer: route?.name === 'MediaViewer',
    };
  }, [navigation]);
  const [screen, setScreen] = useState(read);
  useEffect(() => {
    // The container may not be ready when this first renders.
    const t = setTimeout(() => setScreen(read()), 0);
    const off = navigation.addListener('state', () => setScreen(read()));
    return () => {
      clearTimeout(t);
      off();
    };
  }, [navigation, read]);
  return screen;
}

export function CommsBubbles({ navigation }: { navigation: NavigationContainerRefWithCurrent<RootParams> }) {
  const { me, data, isDemo } = useClub();
  const voice = useRideVoice();
  const screen = useScreen(navigation);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [now, setNow] = useState(() => new Date().toISOString());
  const [sharing, setSharing] = useState<{ rideId: string; meId: string } | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [sos, setSos] = useState<Record<string, Sos>>({});
  const [armed, setArmed] = useState<{ rideId: string; at: number } | null>(null);
  const [sosError, setSosError] = useState<string | null>(null);
  const [calm, setCalm] = useState(false);

  const [typing, setTyping] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setCalm).catch(() => undefined);
    // Out of the way while the keyboard is up, so they never sit over a send button.
    const up = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
    const down = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => {
      up.remove();
      down.remove();
    };
  }, []);

  // Looked at each minute: the clock (windows open and close) and the share saved on this phone.
  useEffect(() => {
    const look = () => {
      setNow(new Date().toISOString());
      if (!isDemo) activeRide().then((a) => setSharing(a ? { rideId: a.rideId, meId: a.meId } : null)).catch(() => undefined);
    };
    look();
    const t = setInterval(look, 60_000);
    return () => clearInterval(t);
  }, [isDemo]);

  // Only ask the club for counts while some ride's comms could be on.
  const anyOn = !!me && data.rides.some((r) => !liveProblem(me, r, now));
  const counts = useCommsCounts(anyOn, isDemo);
  const onAir =
    voice.rideId && (voice.state === 'connected' || voice.state === 'reconnecting')
      ? { rideId: voice.rideId, connected: Math.max(1, voice.people.length) }
      : null;
  const calledOff = useMemo(() => calledOffIds(data), [data]);
  // Live on this phone (sending, sent or waiting for signal): its bubble stays.
  const sosRides = Object.entries(sos).filter(([, s]) => s.state !== 'refused').map(([id]) => id);
  const bubbles = me
    ? commsBubbles({
        me, rides: data.rides, rsvps: data.rsvps, categories: defaultCategories(me, data.chapters), now, sharing, calledOff,
        counts, onAir, hidden, screenRideId: screen.rideId, sos: sosRides,
      })
    : [];

  // A held emergency keeps trying until it's through (or the club refuses it for good).
  const held = Object.entries(sos).flatMap(([id, s]) => (s.state === 'held' ? [`${id}|${s.pressedAt}`] : [])).join(',');
  useEffect(() => {
    if (!held) return undefined;
    const t = setInterval(() => {
      for (const entry of held.split(',')) {
        const [id, pressedAt] = entry.split('|');
        sendHeldEmergency(id, pressedAt).then((r) => {
          if (r.state === 'sent') setSos((s) => ({ ...s, [id]: { state: 'sent', alertId: r.alertId } }));
          else if (r.state === 'refused') setSos((s) => ({ ...s, [id]: { state: 'refused', reason: r.reason } }));
        }).catch(() => undefined);
      }
    }, 15_000);
    return () => clearInterval(t);
  }, [held]);

  // The Emergency button disarms itself.
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed((a) => (a && !sosArmed(a.at, Date.now()) ? null : a)), SOS_ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  // Dragged up and down the right edge, never under the header or the tab bar.
  const [drag] = useState(() => new Animated.Value(0));
  const top = insets.top + 72;
  const bottomLimit = height - insets.bottom - 96 - ROW * Math.max(1, bubbles.length);
  const defaultY = Math.max(top, Math.round(height * 0.42) - ROW);
  const minY = top - defaultY;
  const maxY = Math.max(minY, bottomLimit - defaultY);
  const pan = useMemo(() => {
    const clamp = (y: number) => Math.min(maxY, Math.max(minY, y));
    const from = { y: 0 };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => drag.stopAnimation((v) => {
        from.y = v;
      }),
      onPanResponderMove: (_e, g) => drag.setValue(clamp(from.y + g.dy)),
    });
  }, [drag, minY, maxY]);
  // More bubbles (or a turned phone) can leave a dragged stack too low: pull it back in.
  useEffect(() => {
    drag.stopAnimation((v) => drag.setValue(Math.min(maxY, Math.max(minY, v))));
  }, [drag, minY, maxY]);

  // The one moment: a bubble pops in when its ride's comms come on.
  const ids = bubbles.map((b) => b.ride.id).join(',');
  const [pop] = useState(() => new Animated.Value(1));
  const lastIds = useRef('');
  useEffect(() => {
    const added = ids.split(',').some((id) => id && !lastIds.current.split(',').includes(id));
    lastIds.current = ids;
    if (!added || calm) return;
    pop.setValue(0.6);
    Animated.timing(pop, { toValue: 1, duration: 240, easing: Easing.out(Easing.exp), useNativeDriver: true }).start();
  }, [ids, calm, pop]);

  if (!screen.ready || screen.viewer || typing || bubbles.length === 0) return null;

  const openRide = open ? bubbles.find((b) => b.ride.id === open) ?? null : null;

  const fireSos = async (b: Bubble) => {
    const id = b.ride.id;
    if (sos[id] && sos[id].state !== 'refused') return; // one press, one emergency
    setArmed(null);
    setSosError(null);
    setSos((s) => ({ ...s, [id]: { state: 'sending' } }));
    const res = await raiseRideEmergency(id);
    if (res.sent) {
      setSos((s) => ({ ...s, [id]: { state: 'sent', alertId: res.alertId } }));
      AccessibilityInfo.announceForAccessibility(`Emergency sent to everyone on ${b.ride.title}.`);
    } else if ('held' in res) {
      setSos((s) => ({ ...s, [id]: { state: 'held', pressedAt: res.pressedAt } }));
      AccessibilityInfo.announceForAccessibility('No signal. Your emergency will send when you are back in range. Call 000 if you can.');
    } else {
      setSos((s) => ({ ...s, [id]: { state: 'refused', reason: res.error } }));
      AccessibilityInfo.announceForAccessibility(`Emergency not sent. ${res.error} Call 000 if you need help.`);
    }
    setOpen(id);
  };

  const cancelSos = async (rideId: string, alertId: string) => {
    setSosError(null);
    const err = await cancelRideEmergency(alertId);
    if (err) setSosError(err);
    else setSos((s) => {
      const next = { ...s };
      delete next[rideId];
      return next;
    });
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Near the top, beside the bubbles, so it has the height it needs wherever they've been dragged. */}
      {openRide ? (
        <Panel
          top={top - space.lg}
          bubble={openRide}
          sos={sos[openRide.ride.id] ?? null}
          sosError={sosError}
          onClose={() => setOpen(null)}
          onHide={() => {
            setHidden((h) => [...h, openRide.ride.id]);
            setOpen(null);
          }}
          onOpenRide={() => {
            setOpen(null);
            navigation.navigate('LiveRide', { rideId: openRide.ride.id });
          }}
          onCancelSos={(alertId) => void cancelSos(openRide.ride.id, alertId)}
          onConnect={() => setHidden((h) => h.filter((id) => id !== openRide.ride.id))}
        />
      ) : null}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.stack, { top: defaultY, right: space.sm + insets.right, transform: [{ translateY: drag }] }]}
        {...pan.panHandlers}
      >
        <View pointerEvents="box-none" style={{ gap: GAP }}>
          {bubbles.map((b) => (
            <Animated.View key={b.ride.id} style={[styles.row, { transform: [{ scale: pop }] }]} pointerEvents="box-none">
              <SosButton
                bubble={b}
                sos={sos[b.ride.id] ?? null}
                armed={armed?.rideId === b.ride.id}
                onArm={() => {
                  setOpen(null); // the armed pill needs the room
                  setArmed({ rideId: b.ride.id, at: Date.now() });
                }}
                onFire={() => void fireSos(b)}
                onOpen={() => setOpen(b.ride.id)}
              />
              <BubbleButton bubble={b} open={open === b.ride.id} onPress={() => setOpen((o) => (o === b.ride.id ? null : b.ride.id))} />
            </Animated.View>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

function BubbleButton({ bubble, open, onPress }: { bubble: Bubble; open: boolean; onPress: () => void }) {
  const { ride, connected, onAir } = bubble;
  const label = bubbleLabel(ride.title);
  const who = `${connected} connected`;
  return (
    <View style={styles.bubbleWrap} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Ride comms, ${ride.title}, ${onAir ? `you’re on air, ${who}` : who}`}
        accessibilityHint="Opens this ride’s comms"
        style={({ pressed }) => [styles.bubble, onAir ? styles.bubbleOnAir : null, pressed ? { backgroundColor: colors.steelHi } : null]}
      >
        <Ionicons name={onAir ? 'mic' : 'headset'} size={24} color={colors.bone} />
        <View style={[styles.count, onAir ? styles.countOnAir : null]}>
          <Text style={styles.countText} allowFontScaling={false}>{connected > 99 ? '99+' : String(connected)}</Text>
        </View>
      </Pressable>
      <Text style={styles.name} numberOfLines={1} allowFontScaling={false} importantForAccessibility="no" pointerEvents="none">{label}</Text>
    </View>
  );
}

function SosButton({ bubble, sos, armed, onArm, onFire, onOpen }: {
  bubble: Bubble; sos: Sos | null; armed: boolean; onArm: () => void; onFire: () => void; onOpen: () => void;
}) {
  const title = bubble.ride.title;
  if (sos?.state === 'sending') {
    return (
      <View accessible accessibilityLabel={`Sending emergency, ${title}`} style={[styles.sosPill, styles.sosSent]}>
        <Ionicons name="warning" size={18} color={colors.ink} />
        <Text style={styles.sosSentText}>Sending…</Text>
      </View>
    );
  }
  if (sos && sos.state !== 'refused') {
    const held = sos.state === 'held';
    return (
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={held ? `Emergency waiting for signal, ${title}` : `Emergency sent, ${title}`}
        style={[styles.sosPill, styles.sosSent]}
      >
        <Ionicons name={held ? 'cloud-offline' : 'warning'} size={18} color={colors.ink} />
        <Text style={styles.sosSentText}>{held ? 'Waiting' : 'Sent'}</Text>
      </Pressable>
    );
  }
  if (armed) {
    return (
      <Pressable
        onPress={onFire}
        accessibilityRole="button"
        accessibilityLabel={`Send emergency to everyone on ${title}`}
        style={({ pressed }) => [styles.sosPill, styles.sosSent, pressed ? { opacity: 0.85 } : null]}
      >
        <Ionicons name="warning" size={18} color={colors.ink} />
        <Text style={styles.sosSentText}>Send emergency</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onArm}
      accessibilityRole="button"
      accessibilityLabel={`Emergency, ${title}`}
      accessibilityHint="Tap again to send it to everyone on this ride"
      style={({ pressed }) => [styles.sos, pressed ? { backgroundColor: colors.dangerBg } : null]}
    >
      <Ionicons name="warning" size={22} color={colors.danger} />
    </Pressable>
  );
}

function Panel({ top, bubble, sos, sosError, onClose, onHide, onOpenRide, onCancelSos, onConnect }: {
  top: number;
  bubble: Bubble; sos: Sos | null; sosError: string | null; onClose: () => void; onHide: () => void; onOpenRide: () => void;
  onCancelSos: (alertId: string) => void;
  /** Joining from the bubble brings it back for good if it was hidden. */
  onConnect: () => void;
}) {
  const { data } = useClub();
  const voice = useRideVoice();
  const { width } = useWindowDimensions();
  const { ride, connected, onAir } = bubble;
  const leg = legLabel(ride.id, data);
  const onOther = !onAir && !!voice.rideId && voice.rideId !== ride.id && voice.state !== 'idle';
  const busy = voice.state === 'connecting' && voice.rideId === ride.id;
  const status = onAir ? voiceStatus(voice.state, connected, voice.muted) : `${connected} connected`;
  const canCall = voice.mode === 'live' || voice.mode === 'demo';
  return (
    <View style={[styles.panel, { top, width: Math.max(200, Math.min(300, width - BUBBLE - 190)) }]}>
      <View style={styles.panelHead}>
        <View style={{ flex: 1 }}>
          <Text style={type.name} numberOfLines={2} accessibilityRole="header">{ride.title}</Text>
          {leg ? <Small>{leg}</Small> : null}
          <Text style={[styles.status, onAir ? { color: colors.redText } : null]}>{status}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={styles.close}>
          <Ionicons name="close" size={22} color={colors.boneMute} />
        </Pressable>
      </View>
      {sos?.state === 'sent' ? (
        <View style={styles.sosNote}>
          <Text style={styles.sosNoteTitle}>Emergency sent</Text>
          <Small style={{ color: colors.boneDim }}>Everyone on this ride’s comms or sharing their location has been buzzed. Call 000 if you need to.</Small>
          <Button label="I’m OK, cancel" kind="quiet" size="small" onPress={() => onCancelSos(sos.alertId)} />
        </View>
      ) : sos?.state === 'sending' ? (
        <View style={styles.sosNote}>
          <Text style={styles.sosNoteTitle}>Sending…</Text>
        </View>
      ) : sos?.state === 'held' ? (
        <View style={styles.sosNote}>
          <Text style={styles.sosNoteTitle}>No signal</Text>
          <Small style={{ color: colors.boneDim }}>Your emergency will send when you’re back in range. Calls to 000 can still work.</Small>
        </View>
      ) : sos?.state === 'refused' ? (
        <View style={styles.sosNote}>
          <Text style={styles.sosNoteTitle}>Emergency not sent</Text>
          <Small style={{ color: colors.boneDim }}>{`${sos.reason} Call 000 if you need help.`}</Small>
        </View>
      ) : null}
      {sosError ? <Small style={{ color: colors.danger }}>{sosError}</Small> : null}
      {voice.error && (onAir || voice.rideId === ride.id || voice.state === 'idle') ? (
        <Small style={{ color: colors.danger }}>{voice.error}</Small>
      ) : null}
      {onAir ? (
        <View style={[styles.stackedButtons, styles.wide]}>
          <Button
            label={voice.muted ? 'Unmute' : 'Mute'}
            icon={voice.muted ? 'mic-off' : 'mic'}
            kind="secondary"
            size="small"
            onPress={() => void voice.setMuted(!voice.muted)}
            style={styles.wide}
          />
          <Button label="Disconnect" icon="call-outline" kind="secondary" size="small" onPress={() => void voice.disconnect()} style={styles.wide} />
        </View>
      ) : canCall ? (
        <Button
          label={onOther ? 'Switch to this ride' : 'Connect'}
          icon="headset"
          size="small"
          busy={busy}
          style={styles.wide}
          onPress={async () => {
            onConnect();
            if (onOther) await voice.disconnect();
            await voice.connect(ride.id);
          }}
        />
      ) : null}
      <Button label="Open live ride" icon="navigate" kind="secondary" size="small" onPress={onOpenRide} style={styles.wide} />
      {/* A ride with an emergency on keeps its bubble, so there's nothing to hide. */}
      {sos ? null : <Button label="Hide bubble" kind="quiet" size="small" onPress={onHide} style={styles.wide} />}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end', gap: space.sm },
  bubbleWrap: { alignItems: 'center', width: BUBBLE + 8 },
  bubble: {
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    backgroundColor: colors.steel,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleOnAir: { borderColor: colors.redBright, borderWidth: 3 },
  count: {
    position: 'absolute',
    top: -4,
    left: -6,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 5,
    borderRadius: 12,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countOnAir: { borderColor: colors.redBright },
  countText: { fontFamily: fonts.stencil, fontSize: 13, color: colors.bone, letterSpacing: 0.4 },
  name: {
    marginTop: space.xs,
    maxWidth: BUBBLE + 24,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.ink,
    overflow: 'hidden',
    fontFamily: fonts.stencil,
    fontSize: 11.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.bone,
  },
  sos: {
    marginTop: (BUBBLE - SOS) / 2,
    width: SOS,
    height: SOS,
    borderRadius: SOS / 2,
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosPill: {
    marginTop: (BUBBLE - SOS) / 2,
    height: SOS,
    minWidth: SOS,
    borderRadius: SOS / 2,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  sosSent: { backgroundColor: colors.danger },
  sosSentText: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink },
  panel: {
    position: 'absolute',
    left: space.lg,
    backgroundColor: colors.ink2,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  panelHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  wide: { alignSelf: 'stretch' },
  status: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.4, color: colors.boneDim, marginTop: 2 },
  close: { width: 44, height: 44, marginTop: -10, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
  stackedButtons: { gap: space.sm },
  sosNote: { gap: space.xs, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.dangerBg },
  sosNoteTitle: { fontFamily: fonts.stencil, fontSize: 15, letterSpacing: 0.6, color: colors.danger, textTransform: 'uppercase' },
});
