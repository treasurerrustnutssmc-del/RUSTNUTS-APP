// Lane E: ride comms. The voice card on Live ride (one huge Connect before rolling out, one huge
// Disconnect after, a big Mute between) and the "On air" bar that shows on the tabs while connected.

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useRideVoice } from '../data/rideVoice';
import { voiceRoster, voiceStatus } from '../domain/rideVoice';
import type { RootParams } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import { Card, H2, Ionicons, Notice, Row, Small, type IconName } from '../ui/primitives';

function BigButton({ label, icon, tone, busy, disabled, checked, onPress }: {
  label: string;
  icon: IconName;
  tone: 'go' | 'stop' | 'plain';
  busy?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onPress: () => void;
}) {
  const t = tones[tone];
  return (
    <Pressable
      accessibilityRole={checked === undefined ? 'button' : 'switch'}
      accessibilityState={{ disabled: !!disabled, busy: !!busy, checked }}
      onPress={disabled || busy ? undefined : onPress}
      style={({ pressed }) => [styles.big, { backgroundColor: pressed ? t.active : t.bg, borderColor: t.border }, disabled && { opacity: 0.45 }]}
    >
      {busy ? <ActivityIndicator color={t.fg} /> : <Ionicons name={icon} size={30} color={t.fg} />}
      <Text style={[styles.bigText, { color: t.fg }]}>{label}</Text>
    </Pressable>
  );
}

const tones = {
  go: { bg: colors.redBright, active: colors.red, fg: colors.bone, border: colors.redBright },
  stop: { bg: colors.steel, active: colors.ink2, fg: colors.bone, border: colors.lineStrong },
  plain: { bg: 'transparent', active: colors.steel, fg: colors.bone, border: colors.lineStrong },
} as const;

/** The voice card. `problem` is the live ride's reason this member can't join now, if any. */
export function RideCommsCard({ rideId, problem }: { rideId: string; problem: string | null }) {
  const { me } = useClub();
  const voice = useRideVoice();
  const here = voice.rideId === rideId;
  const elsewhere = !!voice.rideId && !here;
  const on = here && (voice.state === 'connected' || voice.state === 'reconnecting');
  const roster = voiceRoster(voice.people, me?.id ?? null);

  return (
    <Card style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between', gap: space.sm }}>
        <H2>Ride comms</H2>
        {here ? (
          <Text accessibilityLiveRegion="polite" style={[styles.status, on && !voice.muted && styles.statusOn]}>
            {voiceStatus(voice.state, voice.people.length, voice.muted)}
          </Text>
        ) : null}
      </Row>
      {!on ? (
        <>
          <Small>Open mic with everyone on this ride. Nothing is recorded. Your headset’s play button may mute it too.</Small>
          {voice.mode === 'demo' ? <Small>Demo: the other riders are made up.</Small> : null}
          {problem ? <Notice>{problem}</Notice> : null}
          {elsewhere ? <Notice>You’re on another ride’s comms. Disconnect there first.</Notice> : null}
          <BigButton
            label="Connect"
            icon="mic"
            tone="go"
            busy={here && voice.state === 'connecting'}
            disabled={!!problem || elsewhere}
            onPress={() => void voice.connect(rideId)}
          />
          {here && voice.state === 'connecting' ? (
            <BigButton label="Cancel" icon="close" tone="plain" onPress={() => void voice.disconnect()} />
          ) : null}
        </>
      ) : (
        <>
          <BigButton
            label={voice.muted ? 'Unmute' : 'Mute'}
            icon={voice.muted ? 'mic-off' : 'mic'}
            tone={voice.muted ? 'go' : 'plain'}
            checked={voice.muted}
            onPress={() => void voice.setMuted(!voice.muted)}
          />
          <View style={styles.roster}>
            {roster.map((p) => (
              <View
                key={p.id}
                style={styles.person}
                accessible
                accessibilityLabel={`${p.id === me?.id ? `${p.name}, you` : p.name}${p.muted ? ', muted' : p.speaking ? ', speaking' : ''}`}
              >
                <View style={[styles.dot, p.speaking && !p.muted && styles.dotOn]} />
                <Text style={[type.name, { flex: 1 }]} numberOfLines={1}>{p.id === me?.id ? `${p.name} (you)` : p.name}</Text>
                {p.muted ? <Ionicons name="mic-off" size={18} color={colors.boneMute} /> : null}
              </View>
            ))}
          </View>
          <BigButton label="Disconnect" icon="close-circle" tone="stop" onPress={() => void voice.disconnect()} />
        </>
      )}
      {voice.error && (here || !voice.rideId) ? <Notice tone="danger">{voice.error}</Notice> : null}
    </Card>
  );
}

/** A slim bar above the tabs while connected; tapping it opens the ride's Live ride screen. */
export function OnAirBar() {
  const voice = useRideVoice();
  const { data } = useClub();
  const navigation = useNavigation<NativeStackNavigationProp<RootParams>>();
  if (!voice.rideId || voice.state === 'idle') return null;
  const ride = data.rides.find((r) => r.id === voice.rideId);
  const rideId = voice.rideId;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ride comms: ${voiceStatus(voice.state, voice.people.length, voice.muted)}. Open live ride.`}
      onPress={() => navigation.navigate('LiveRide', { rideId })}
      style={[styles.bar, voice.muted && styles.barMuted]}
    >
      <Ionicons name={voice.muted ? 'mic-off' : 'mic'} size={16} color={colors.bone} />
      <Text style={styles.barText} numberOfLines={1}>
        {voiceStatus(voice.state, voice.people.length, voice.muted)}
        {ride ? ` · ${ride.title}` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  big: {
    minHeight: 88,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  bigText: { fontFamily: fonts.stencil, fontSize: 28, letterSpacing: 1.5, textTransform: 'uppercase' },
  status: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.4, color: colors.boneMute },
  statusOn: { color: colors.ok },
  roster: { gap: space.xs, paddingVertical: space.sm },
  person: { flexDirection: 'row', gap: space.sm, alignItems: 'center', minHeight: 32 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.lineStrong },
  dotOn: { backgroundColor: colors.ok },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: 44,
    backgroundColor: colors.red,
  },
  barMuted: { backgroundColor: colors.steel },
  barText: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.4, color: colors.bone, flex: 1 },
});
