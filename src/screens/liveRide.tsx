// Live ride mode: on ride day, riders who switch it on see where each other are, and can raise an
// emergency, say they've dropped out, or (leaders) set a regroup pin. Ride day only, opt-in,
// switches itself off, nothing kept. The rules are in src/domain/liveRide.ts.

import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { activeRide } from '../data/liveTracker';
import { smsUrl } from '../data/liveQueue';
import { useLiveRide } from '../data/useLiveRide';
import { awayText, isRideLeader, isStale, lastSeen, liveProblem, liveWindow, offTime, splitGroups, splitWarning } from '../domain/liveRide';
import { initials } from '../domain/profile';
import type { LatLng, LiveRider, Ride, RideAlert } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  ConfirmButton,
  H2,
  Ionicons,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
} from '../ui/primitives';

const open = (url: string) => Linking.openURL(url).catch(() => {});
const mapsUrl = (p: LatLng) => `https://maps.google.com/?q=${p.lat},${p.lng}`;
const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

// ---------------------------------------------------------------------------
// On the ride screen
// ---------------------------------------------------------------------------

/** Shown on a ride while its live window is open. */
export function LiveRideCard({ ride, onOpen }: { ride: Ride; onOpen: () => void }) {
  const { me } = useClub();
  const [sharingHere, setSharingHere] = useState(false);
  useEffect(() => {
    activeRide().then((a) => setSharingHere(a?.rideId === ride.id));
  }, [ride.id]);
  const now = new Date().toISOString();
  const w = liveWindow(ride);
  if (!w || liveProblem(me, ride, now)) return null;
  return (
    <Card>
      <Row style={{ gap: space.sm }}>
        <Ionicons name="navigate-circle" size={22} color={colors.redText} />
        <H2>Live ride</H2>
      </Row>
      <Body>
        {`Share your location with riders on this ride. Only riders sharing can see it. Switches off by ${offTime(w.closes, now)}. Nothing is kept.`}
      </Body>
      <Button label={sharingHere ? 'Open live ride' : 'Share my location'} icon="navigate" onPress={onOpen} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The live ride screen
// ---------------------------------------------------------------------------

export function LiveRideScreen({ route }: RootScreen<'LiveRide'>) {
  const { me, data } = useClub();
  const { rideId } = route.params;
  const ride = data.rides.find((r) => r.id === rideId);
  const live = useLiveRide(rideId);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!me || !ride) {
    return (
      <Screen>
        <Notice tone="warn" title="Ride not found">It may have come off the club calendar.</Notice>
      </Screen>
    );
  }

  const leader = isRideLeader(me.id, data.positions);
  const run = (key: string, fn: () => Promise<unknown>) => async () => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const unsentNotice =
    live.unsent.length > 0 ? (
      <Notice tone="danger" title="Alert not sent">
        <Stack gap={space.sm}>
          <Small style={{ color: colors.boneDim }}>
            {`An alert you raised with no signal couldn’t be sent: ${live.unsent[0].reason} Call 000 if you still need help.`}
          </Small>
          <Row style={{ gap: space.sm }}>
            <Button label="Call 000" icon="call" onPress={() => open('tel:000')} style={{ flexGrow: 1 }} />
            <Button label="Dismiss" kind="quiet" onPress={live.clearUnsent} />
          </Row>
        </Stack>
      </Notice>
    ) : null;

  const errorNotice = live.error ? (
    <View accessibilityLiveRegion="polite" role="alert">
      <Notice tone="danger">{live.error}</Notice>
    </View>
  ) : null;

  if (live.checking) {
    return (
      <Screen>
        <Small>Checking…</Small>
      </Screen>
    );
  }

  if (!live.sharing || !live.state?.me) {
    const problem = liveProblem(me, ride, now);
    const w = liveWindow(ride);
    return (
      <Screen>
        <Card>
          <H2>{ride.title}</H2>
          <Body>Share where you are with the riders on this ride, so the Road Captain and Tail Gunner can keep the group together and find you if something goes wrong.</Body>
          <Stack gap={space.xs}>
            <Fact icon="eye-outline" text="Only riders sharing on this ride can see you." />
            <Fact icon="time-outline" text={w ? `Switches itself off by ${offTime(w.closes, now)}.` : 'Switches itself off when the ride ends.'} />
            <Fact icon="trash-outline" text="Nothing is kept. It’s all deleted when the ride’s over." />
          </Stack>
          {problem ? <Notice tone="info">{problem}</Notice> : null}
          <Button label="Share my location" icon="navigate" busy={busy === 'start'} disabled={!!problem} onPress={run('start', live.start)} />
        </Card>
        {unsentNotice}
        {live.held > 0 ? (
          <Notice tone="warn" title="No signal">Your alert will send when you’re back in range. Calls to 000 can still work.</Notice>
        ) : null}
        {live.stopPending ? (
          <Notice tone="warn">You’ve stopped sharing on this phone. The other riders will see it when you’re back in range.</Notice>
        ) : live.offline && live.held === 0 ? (
          <Notice tone="warn">No signal. Try again when you’re back in range.</Notice>
        ) : null}
        {errorNotice}
      </Screen>
    );
  }

  const state = live.state;
  const meStops = state.me as { stopsAt: string };
  const myPos = live.myFix;
  const others = state.alerts.filter((a) => a.memberId !== me.id && !a.resolvedAt);
  const myEmergency = state.alerts.find((a) => a.memberId === me.id && a.kind === 'emergency' && !a.resolvedAt);
  const regroup = others.find((a) => a.kind === 'regroup') ?? state.alerts.find((a) => a.kind === 'regroup' && !a.resolvedAt);
  const urgent = others.filter((a) => a.kind !== 'regroup');
  const split = leader ? splitWarning(state.riders, now) : null;
  // Riders away from the main group, marked for leaders so they know who to wait for.
  const splitOff = new Set(split ? splitGroups(state.riders, now).slice(1).flat().map((r) => r.memberId) : []);
  const leaderPhones = state.riders.filter((r) => r.leader && r.phone && r.memberId !== me.id).map((r) => r.phone as string);
  const textUrl = smsUrl(Platform.OS, leaderPhones, `Rustnuts emergency. I'm here: ${myPos ? mapsUrl(myPos) : 'location unknown'}`);

  return (
    <Screen>
      <Card>
        <Row style={{ gap: space.sm, justifyContent: 'space-between' }}>
          <Chip label="Sharing" tone="ok" icon="radio-button-on" />
          <Text style={styles.stops}>{`Switches off ${offTime(meStops.stopsAt, now)}`}</Text>
        </Row>
        <Text style={type.name} numberOfLines={2}>{ride.title}</Text>
        {live.mode === 'foreground' ? (
          <Small>This phone only shares while Rustnuts is open. Allow location “all the time” to keep sharing with the screen off.</Small>
        ) : null}
        {live.mode === 'demo' ? <Small>Demo: the other riders are made up.</Small> : null}
        <ConfirmButton label="Stop sharing" confirmLabel="Stop now" kind="secondary" onConfirm={run('stop', live.stop)} />
      </Card>

      {unsentNotice}
      {live.offline ? (
        <Notice tone="warn" title="No signal">
          {live.held > 0
            ? 'Your alert will send when you’re back in range. Calls to 000 can still work.'
            : 'Showing the last update. Calls to 000 can still work.'}
        </Notice>
      ) : null}
      {errorNotice}

      {myEmergency ? (
        <Card style={styles.emergencyCard}>
          <H2 style={{ color: colors.danger }}>Emergency sent</H2>
          <Body>The riders sharing on this ride can see where you are.</Body>
          <Button label="Call 000" icon="call" onPress={() => open('tel:000')} style={styles.big} />
          {textUrl ? <Button label="Text my location" icon="chatbubble-outline" kind="secondary" onPress={() => open(textUrl)} /> : null}
          <Button label="I’m OK, cancel" kind="quiet" busy={busy === myEmergency.id} onPress={run(myEmergency.id, () => live.resolve(myEmergency.id))} />
        </Card>
      ) : null}

      {urgent.map((a) => (
        <AlertBlock
          key={a.id}
          alert={a}
          myPos={myPos}
          now={now}
          canClear={leader}
          busy={busy === a.id}
          onClear={run(a.id, () => live.resolve(a.id))}
          contacts={a.kind === 'emergency' ? state.contacts.filter((c) => c.memberId === a.memberId) : []}
        />
      ))}

      {split ? <Notice tone="warn" title="Group split">{split.replace(/^Group split: /, '')}</Notice> : null}

      {regroup ? (
        <Notice tone="info" title="Regroup here">
          <Stack gap={space.sm}>
            <Small style={{ color: colors.boneDim }}>
              {`${awayText(myPos, regroup.position) ?? 'Location unknown'} · set by ${regroup.name} ${lastSeen(regroup.createdAt, now)}`}
            </Small>
            {regroup.position ? <Button label="Open in maps" icon="map-outline" kind="secondary" onPress={() => open(mapsUrl(regroup.position as LatLng))} /> : null}
          </Stack>
        </Notice>
      ) : null}

      <Stack gap={space.sm}>
        {myEmergency ? null : (
          <ConfirmButton label="Emergency" confirmLabel="Send emergency" icon="warning" onConfirm={run('emergency', () => live.raise('emergency'))} style={styles.big} />
        )}
        <ConfirmButton label="I’ve dropped out" confirmLabel="Yes, I’m out" kind="secondary" icon="exit-outline" onConfirm={run('out', () => live.raise('out'))} />
        {leader ? (
          <Button label="Set regroup pin here" icon="flag-outline" kind="secondary" busy={busy === 'regroup'} onPress={run('regroup', () => live.raise('regroup'))} />
        ) : null}
        <Button label="Call 000" icon="call-outline" kind="quiet" onPress={() => open('tel:000')} />
      </Stack>

      <Stack gap={space.sm}>
        <SectionTitle title="Riders" action={<Text style={styles.count}>{state.riders.length}</Text>} />
        <Card style={{ padding: 0, gap: 0 }}>
          {state.riders.map((r, i) => (
            <RiderRow
              key={r.memberId}
              rider={r}
              me={me.id === r.memberId}
              behind={splitOff.has(r.memberId)}
              needsHelp={urgent.some((a) => a.kind === 'emergency' && a.memberId === r.memberId)}
              myPos={myPos}
              now={now}
              last={i === state.riders.length - 1}
            />
          ))}
        </Card>
      </Stack>
    </Screen>
  );
}

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <Row style={{ gap: space.sm, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={18} color={colors.boneMute} style={{ marginTop: 2 }} />
      <Body style={{ flex: 1 }}>{text}</Body>
    </Row>
  );
}

const ALERT_TITLE: Record<'emergency' | 'out', (name: string) => string> = {
  emergency: (name) => `${name} needs help`,
  out: (name) => `${name} has dropped out`,
};

function AlertBlock({
  alert,
  myPos,
  now,
  canClear,
  busy,
  onClear,
  contacts,
}: {
  alert: RideAlert;
  myPos: LatLng | null;
  now: string;
  canClear: boolean;
  busy: boolean;
  onClear: () => void;
  contacts: { id: string; name: string; relationship: string; phone: string }[];
}) {
  const kind = alert.kind === 'emergency' ? 'emergency' : 'out';
  return (
    <Notice tone={kind === 'emergency' ? 'danger' : 'warn'} title={ALERT_TITLE[kind](alert.name)}>
      <Stack gap={space.sm}>
        <Small style={{ color: colors.boneDim }}>{`${awayText(myPos, alert.position) ?? 'Location unknown'} · ${lastSeen(alert.createdAt, now)}`}</Small>
        <Row style={{ gap: space.sm }}>
          {alert.position ? (
            <Button label="Open in maps" icon="map-outline" kind="secondary" onPress={() => open(mapsUrl(alert.position as LatLng))} style={{ flexGrow: 1 }} />
          ) : null}
          {alert.phone ? (
            <Button label={`Call ${alert.name}`} icon="call-outline" kind="secondary" onPress={() => open(telUrl(alert.phone as string))} style={{ flexGrow: 1 }} />
          ) : null}
        </Row>
        {contacts.length > 0 ? (
          <Stack gap={space.xs}>
            <Text style={styles.contactsTitle}>Emergency contacts</Text>
            {contacts.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`Call ${c.name}, ${c.relationship}, ${c.phone}`}
                onPress={() => open(telUrl(c.phone))}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.contact, (pressed || hovered) && { backgroundColor: colors.steel }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={type.name} numberOfLines={1}>{c.name}</Text>
                  <Small>{`${c.relationship} · ${c.phone}`}</Small>
                </View>
                <Ionicons name="call" size={20} color={colors.bone} />
              </Pressable>
            ))}
          </Stack>
        ) : null}
        {canClear ? <Button label="Got them, clear" kind="quiet" busy={busy} onPress={onClear} /> : null}
      </Stack>
    </Notice>
  );
}

function RiderRow({
  rider,
  me,
  behind,
  needsHelp,
  myPos,
  now,
  last,
}: {
  rider: LiveRider;
  me: boolean;
  behind: boolean;
  needsHelp: boolean;
  myPos: LatLng | null;
  now: string;
  last: boolean;
}) {
  const stale = !rider.updatedAt || isStale(rider.updatedAt, now);
  const where = me ? 'You' : (awayText(myPos, rider.position) ?? 'Finding them…');
  const seen = rider.updatedAt ? lastSeen(rider.updatedAt, now) : 'no fix yet';
  const label = [rider.name, needsHelp ? 'needs help' : null, rider.leader ? 'leader' : null, behind ? 'split off from the group' : null, where, seen].filter(Boolean).join(', ');
  const pos = rider.position;
  return (
    <View style={[styles.rider, last && { borderBottomWidth: 0 }]}>
      <Pressable
        accessibilityRole={pos ? 'link' : undefined}
        accessibilityLabel={pos ? `${label}, open in maps` : label}
        disabled={!pos}
        onPress={() => pos && open(mapsUrl(pos))}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.riderMain, pos && (pressed || hovered) && { backgroundColor: colors.steel }]}
      >
        <View style={stale && styles.faded}>
          <Avatar text={initials({ roadName: rider.name, fullName: rider.name })} size={40} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Row style={{ gap: 6 }}>
            <Text style={type.name} numberOfLines={1}>{rider.name}</Text>
            {needsHelp ? <Chip label="Help" tone="danger" icon="warning" /> : null}
            {rider.leader ? <Chip label="Leader" tone="bone" /> : null}
            {behind ? <Chip label="Split off" tone="warn" /> : null}
          </Row>
          <Text style={[styles.where, stale && { color: colors.boneMute }]} numberOfLines={1}>{`${where} · ${seen}`}</Text>
        </View>
        {pos && !me ? <Ionicons name="map-outline" size={18} color={colors.boneMute} /> : null}
      </Pressable>
      {rider.phone && !me ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Call ${rider.name}`}
          onPress={() => open(telUrl(rider.phone as string))}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.call, (pressed || hovered) && { backgroundColor: colors.steel }]}
        >
          <Ionicons name="call-outline" size={20} color={colors.bone} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stops: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.4, color: colors.boneDim },
  emergencyCard: { borderColor: colors.danger },
  big: { minHeight: 56 },
  count: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
  contactsTitle: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.6, color: colors.bone, textTransform: 'uppercase', marginTop: space.xs },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  rider: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line },
  riderMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.md, minHeight: 56 },
  where: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.3, color: colors.boneDim },
  call: { width: 56, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: colors.line },
  faded: { opacity: 0.5 },
});
