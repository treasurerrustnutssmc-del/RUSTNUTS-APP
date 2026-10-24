// A ride's briefing card: the ride, its route, the Road Captain's hazards, changes and notes, the
// crew and who to call, all on one tall card to read in a car park, then Got it. Writers (the
// ride's crew managers and its Road Captain) also see who hasn't read it, and edit it.

import React, { useLayoutEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import {
  MAX_HAZARDS,
  NO_BRIEFING,
  SAFETY_LINE,
  STOPPED_RIDER,
  briefingCrew,
  briefingOf,
  editBriefingProblem,
  editStart,
  HAZARD_TOO_LONG,
  hazardTooLong,
  readBriefingProblem,
  readCount,
  readCountLine,
  readLine,
  readState,
  saveBriefingProblem,
  TEXT_TOO_LONG,
  textTooLong,
  unreadGoing,
  updatedLine,
  writesBriefing,
} from '../domain/briefings';
import { formatAuDate } from '../domain/dates';
import { ROLE_LABEL, ROLE_SHORT } from '../domain/labels';
import { displayName } from '../domain/profile';
import { melbourneDate, melbourneTime } from '../domain/rides';
import { routeOf, signedInProblem } from '../domain/routes';
import type { Ride } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import {
  Body,
  Button,
  Card,
  Chip,
  Divider,
  Field,
  H1,
  H2,
  Ionicons,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
} from '../ui/primitives';
import { OpenInMapsButton, RouteFacts, StopList } from '../ui/RouteBits';
import { weekday } from './rides';

function RideMissing() {
  return (
    <Screen>
      <Notice tone="warn" title="Ride not found">It may have come off the club calendar.</Notice>
    </Screen>
  );
}

/** "Sat 07/11/2026", the ride's Melbourne start date. */
const rideDate = (ride: Ride) => {
  const date = melbourneDate(ride.startsAt);
  return `${weekday(date)} ${formatAuDate(date)}`;
};

// ---------------------------------------------------------------------------
// The briefing card
// ---------------------------------------------------------------------------

export function BriefingScreen({ route: nav, navigation }: RootScreen<'Briefing'>) {
  const { me, data, readBriefing } = useClub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ride = data.rides.find((r) => r.id === nav.params.rideId);
  if (!ride || !me) return <RideMissing />;

  const now = new Date().toISOString();
  const briefing = briefingOf(ride.id, data);
  const canEdit = editBriefingProblem(me, ride, data, now) === null;
  const edit = () => navigation.navigate('EditBriefing', { rideId: ride.id });

  const opening = signedInProblem(me);
  if (opening) {
    return (
      <Screen>
        <Notice tone="warn">{opening}</Notice>
      </Screen>
    );
  }

  if (!briefing) {
    return (
      <Screen>
        <Notice title="No briefing yet">{NO_BRIEFING}</Notice>
        {canEdit ? <Button label="Write briefing" icon="create-outline" onPress={edit} /> : null}
      </Screen>
    );
  }

  const cancelled = !!ride.cancelledAt;
  const route = routeOf(ride.id, data);
  const crew = briefingCrew(ride.id, data);
  const state = readState(me, ride.id, data);
  const myRead = (data.briefingReads ?? []).find((r) => r.rideId === ride.id && r.memberId === me.id);
  const canRead = readBriefingProblem(me, ride, data) === null;
  const writer = writesBriefing(me, ride, data);
  const location = ride.location;

  const gotIt = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await readBriefing(ride.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card style={styles.card}>
        {/* 1. The ride */}
        <Stack gap={space.sm}>
          {cancelled ? <Chip label="Cancelled" tone="danger" /> : null}
          <H1 style={cancelled ? styles.struck : undefined}>{ride.title}</H1>
          <Row style={styles.fact}>
            <Ionicons name="calendar-outline" size={20} color={colors.boneMute} />
            <Text style={styles.factText}>{rideDate(ride)}</Text>
          </Row>
          <Row style={styles.fact}>
            <Ionicons name="time-outline" size={20} color={colors.boneMute} />
            <Text style={styles.factText}>{ride.allDay ? 'All day' : `Meet ${melbourneTime(ride.startsAt)}`}</Text>
          </Row>
          {location ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Meet at ${location}, open in maps`}
              onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(location)}`).catch(() => {})}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.place,
                (pressed || hovered) && { backgroundColor: colors.steel },
              ]}
            >
              <Ionicons name="location-outline" size={20} color={colors.redText} />
              <Text style={[styles.factText, { flex: 1, color: colors.bone }]}>{location}</Text>
              <Ionicons name="open-outline" size={16} color={colors.boneMute} />
            </Pressable>
          ) : null}
        </Stack>

        {/* 2. The route */}
        {route ? (
          <>
            <Divider />
            <Stack gap={space.md}>
              <H2>Route</H2>
              <Text style={styles.big}>{route.name}</Text>
              <RouteFacts route={route} />
              {route.stops.length > 0 ? <StopList stops={route.stops} flat /> : null}
              <OpenInMapsButton route={route} kind="secondary" />
            </Stack>
          </>
        ) : null}

        {/* 3. Hazards */}
        {briefing.hazards.length > 0 ? (
          <>
            <Divider />
            <Stack gap={space.md}>
              <H2>Hazards</H2>
              {briefing.hazards.map((h, i) => (
                <Row key={`${i}-${h}`} style={styles.hazard}>
                  <Ionicons name="warning" size={22} color={colors.warn} style={{ marginTop: 2 }} />
                  <Text selectable style={[styles.big, { flex: 1 }]}>
                    {h}
                  </Text>
                </Row>
              ))}
            </Stack>
          </>
        ) : null}

        {/* 4. Changes for this ride (constitution 7.10) */}
        {briefing.changes ? (
          <>
            <Divider />
            <Stack gap={space.md}>
              <H2>Changes for this ride</H2>
              <View style={styles.changes}>
                <Row style={styles.changesHead}>
                  <Ionicons name="alert-circle" size={20} color={colors.warn} />
                  <Text style={styles.changesLabel}>The RC has changed these Road Rules for this ride</Text>
                </Row>
                <Text selectable style={styles.changesText}>
                  {briefing.changes}
                </Text>
              </View>
            </Stack>
          </>
        ) : null}

        {/* 5. Notes */}
        {briefing.notes ? (
          <>
            <Divider />
            <Stack gap={space.md}>
              <H2>Notes</H2>
              <Text selectable style={styles.prose}>
                {briefing.notes}
              </Text>
            </Stack>
          </>
        ) : null}

        {/* 6. Crew */}
        <Divider />
        <Stack gap={space.md}>
          <H2>Crew</H2>
          {crew.rows.length === 0 ? <Body>No crew yet.</Body> : null}
          {crew.rows.map((r, i) => (
            <View
              key={`${r.role}-${i}`}
              style={styles.crewRow}
              accessible
              accessibilityLabel={`${ROLE_LABEL[r.role]}: ${r.name}`}
            >
              <View style={styles.crewTile}>
                <Text style={styles.crewTileText}>{ROLE_SHORT[r.role]}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.big}>{r.name}</Text>
                <Text style={styles.crewRole}>{ROLE_LABEL[r.role]}</Text>
              </View>
            </View>
          ))}
          {crew.firstAid ? (
            <Row style={styles.fact}>
              <Ionicons name="medkit-outline" size={20} color={colors.ok} />
              <Text style={[styles.factText, { color: colors.bone }]}>{`First aid: ${crew.firstAid}`}</Text>
            </Row>
          ) : (
            <Row style={styles.fact}>
              <Ionicons name="alert-circle" size={20} color={colors.warn} />
              <Text style={[styles.factText, { color: colors.warn }]}>No Tail Gunner yet</Text>
            </Row>
          )}
        </Stack>

        {/* 7. If something goes wrong (constitution 7.6) */}
        <Divider />
        <Stack gap={space.md}>
          <H2>If something goes wrong</H2>
          <Text style={styles.prose}>{SAFETY_LINE}</Text>
          <Text style={styles.prose}>{STOPPED_RIDER}</Text>
        </Stack>

        <Small>{updatedLine(briefing, data, now)}</Small>

        {/* 8. Got it */}
        {canRead ? (
          <>
            <Divider />
            <Stack gap={space.md}>
              {state === 'current' && myRead ? (
                <Stack gap={space.sm}>
                  <Row style={styles.readRow}>
                    <Ionicons name="checkmark-circle" size={22} color={colors.ok} />
                    <Text style={[styles.factText, { flex: 1, color: colors.bone }]}>{readLine(myRead.readAt, now)}</Text>
                  </Row>
                  <Button
                    label="Read again"
                    kind="quiet"
                    busy={busy}
                    accessibilityLabel="Read again: mark it read now"
                    onPress={gotIt}
                    style={styles.readAgain}
                  />
                </Stack>
              ) : (
                <>
                  {state === 'stale' && myRead ? (
                    <Notice tone="warn" title="Updated since you read it">
                      {`${readLine(myRead.readAt, now)}. Read it again, then tap Got it.`}
                    </Notice>
                  ) : null}
                  <Button
                    label="Got it"
                    icon="checkmark"
                    busy={busy}
                    accessibilityLabel="Got it: I’ve read the briefing"
                    onPress={gotIt}
                    style={styles.gotIt}
                  />
                </>
              )}
              <View accessibilityLiveRegion="polite" role="alert">
                {error ? <Notice tone="danger">{error}</Notice> : null}
              </View>
            </Stack>
          </>
        ) : null}
      </Card>

      {/* 9. For writers */}
      {writer ? (
        <WriterSection ride={ride} canEdit={canEdit} onEdit={edit} onMember={(memberId) => navigation.navigate('MemberDetail', { memberId })} />
      ) : null}
    </Screen>
  );
}

/** Who among the Going riders hasn't read it (or read an older version), and Edit. */
function WriterSection({
  ride,
  canEdit,
  onEdit,
  onMember,
}: {
  ride: Ride;
  canEdit: boolean;
  onEdit: () => void;
  onMember: (memberId: string) => void;
}) {
  const { data } = useClub();
  const unread = unreadGoing(ride, data);
  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Not read yet" action={<Text style={styles.count}>{unread.length}</Text>} />
      <Text style={styles.countLine}>{readCountLine(readCount(ride, data))}</Text>
      <Card style={{ padding: 0, gap: 0 }}>
        {unread.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Text style={type.name}>Everyone going has read it</Text>
          </View>
        ) : (
          unread.map((m, i) => (
            <ListRow
              key={m.id}
              last={i === unread.length - 1}
              title={displayName(m)}
              subtitle={readState(m, ride.id, data) === 'stale' ? 'Read an earlier version' : 'Hasn’t read it'}
              onPress={() => onMember(m.id)}
            />
          ))
        )}
      </Card>
      {canEdit ? <Button label="Edit briefing" icon="create-outline" kind="secondary" onPress={onEdit} /> : null}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Write or edit the briefing
// ---------------------------------------------------------------------------

export function EditBriefingScreen({ route: nav, navigation }: RootScreen<'EditBriefing'>) {
  const { me, data, saveBriefing } = useClub();
  const ride = data.rides.find((r) => r.id === nav.params.rideId);
  const existing = ride ? briefingOf(ride.id, data) : undefined;
  // Each hazard line keeps its own key, so removing one never moves another's text or focus.
  const [start] = useState(() => editStart(existing));
  const [hazards, setHazards] = useState(() => start.hazards.map((text, key) => ({ key, text })));
  const nextKey = useRef(start.hazards.length);
  const [changes, setChanges] = useState(start.changes);
  const [notes, setNotes] = useState(start.notes);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: existing ? 'Edit briefing' : 'Write briefing' });
  }, [navigation, existing]);

  if (!ride || !me) return <RideMissing />;
  const blocked = editBriefingProblem(me, ride, data, new Date().toISOString());
  if (blocked) {
    return (
      <Screen>
        <Notice tone="warn">{blocked}</Notice>
      </Screen>
    );
  }

  const full = hazards.length >= MAX_HAZARDS;
  const setLine = (key: number, text: string) => setHazards((now) => now.map((h) => (h.key === key ? { ...h, text } : h)));
  const removeLine = (key: number) =>
    setHazards((now) => (now.length === 1 ? [{ ...now[0], text: '' }] : now.filter((h) => h.key !== key)));
  const addLine = () => {
    if (full) return;
    const line = { key: nextKey.current++, text: '' };
    setHazards((now) => [...now, line]);
    setFocusKey(line.key);
  };

  const save = async () => {
    if (saving) return;
    setError(null);
    const input = { hazards: hazards.map((h) => h.text), changes, notes };
    const problem = saveBriefingProblem(me, ride, input, data, new Date().toISOString());
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await saveBriefing(ride.id, input);
      // Back to the card: the one it was opened from, or (from the ride screen's Write briefing) a new one.
      const { routes, index } = navigation.getState();
      if (routes[index - 1]?.name === 'Briefing') navigation.goBack();
      else navigation.replace('Briefing', { rideId: ride.id });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.rideLine}>
        {ride.title}
        <Text style={styles.rideDate}>{` · ${rideDate(ride)}`}</Text>
      </Text>

      <Stack gap={space.md}>
        <SectionTitle title="Hazards" />
        <Small>One short line each, 12 at most. Blank lines are left out.</Small>
        {hazards.map((h, i) => {
          const tooLong = hazardTooLong(h.text);
          const only = hazards.length === 1 && h.text === '';
          return (
            <View key={h.key} style={{ gap: 6 }}>
              <Row style={styles.hazardLine}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Field
                    label={`Hazard ${i + 1}`}
                    accessibilityLabel={`Hazard ${i + 1}`}
                    value={h.text}
                    onChangeText={(t) => setLine(h.key, t)}
                    placeholder={i === 0 ? 'e.g. Gravel on the Ballan turn' : undefined}
                    autoFocus={h.key === focusKey}
                    autoCapitalize="sentences"
                    returnKeyType="done"
                    style={tooLong ? { borderColor: colors.danger } : undefined}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove hazard ${i + 1}`}
                  accessibilityState={{ disabled: only }}
                  aria-disabled={only}
                  disabled={only}
                  onPress={() => removeLine(h.key)}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.remove,
                    !only && (pressed || hovered) && { backgroundColor: colors.steel },
                    only && { opacity: 0.45 },
                  ]}
                >
                  <Ionicons name="close" size={22} color={colors.boneDim} />
                </Pressable>
              </Row>
              {tooLong ? <Small style={{ color: colors.danger }}>{HAZARD_TOO_LONG}</Small> : null}
            </View>
          );
        })}
        <Button label="Add hazard" icon="add" kind="secondary" disabled={full} onPress={addLine} />
        {full ? <Small>That’s 12, the most a briefing holds.</Small> : null}
      </Stack>

      <Stack gap={space.md}>
        <SectionTitle title="Changes for this ride" />
        <Field
          label="Road Rules changed for this ride"
          value={changes}
          onChangeText={setChanges}
          placeholder="e.g. Single file through Myrniong"
          multiline
          autoCapitalize="sentences"
          hint="Only for a one-off change because of safety, traffic, weather or the roads (constitution 7.10). Leave it empty if there’s none."
          error={textTooLong(changes) ? TEXT_TOO_LONG : null}
        />
      </Stack>

      <Stack gap={space.md}>
        <SectionTitle title="Notes" />
        <Field
          label="Anything else riders need to know"
          value={notes}
          onChangeText={setNotes}
          placeholder="Fuel, breakfast, what to bring"
          multiline
          autoCapitalize="sentences"
          error={textTooLong(notes) ? TEXT_TOO_LONG : null}
        />
      </Stack>

      <Stack gap={space.sm}>
        <Button label="Save briefing" icon="checkmark" busy={saving} onPress={save} />
        <Small>Riders who read an earlier version are asked to read it again.</Small>
        <View accessibilityLiveRegion="polite" role="alert">
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </View>
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xl, paddingVertical: space.xl },
  struck: { textDecorationLine: 'line-through', color: colors.boneMute },
  fact: { gap: space.sm, flexWrap: 'nowrap' },
  factText: { fontFamily: fonts.stencil, fontSize: 18, lineHeight: 24, letterSpacing: 0.4, color: colors.boneDim, flexShrink: 1 },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    marginHorizontal: -space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  /** The card's big stencil: hazards, the route's name and the crew's names. */
  big: { fontFamily: fonts.stencil, fontSize: 19, lineHeight: 26, letterSpacing: 0.4, color: colors.bone },
  hazard: { gap: space.md, alignItems: 'flex-start', flexWrap: 'nowrap' },
  // A whole amber edge, not a side stripe: the one block on the card that changes the rules.
  changes: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.warn,
    backgroundColor: colors.warnBg,
  },
  changesHead: { gap: space.sm, alignItems: 'flex-start', flexWrap: 'nowrap' },
  changesLabel: { fontFamily: fonts.stencil, fontSize: 15, lineHeight: 20, letterSpacing: 0.3, color: colors.warn, flex: 1 },
  changesText: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25, fontWeight: '600', color: colors.bone },
  prose: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25, color: colors.boneDim },
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  crewTile: {
    width: 48,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.steel,
    borderRadius: radius.sm,
  },
  crewTileText: { fontFamily: fonts.stencil, fontSize: 18, letterSpacing: 1, color: colors.bone },
  crewRole: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.4, color: colors.boneMute },
  readRow: { gap: space.sm, flexWrap: 'nowrap' },
  gotIt: { minHeight: 64 },
  readAgain: { alignSelf: 'flex-start', marginLeft: -space.lg },
  count: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
  countLine: { fontFamily: fonts.stencil, fontSize: 14, lineHeight: 18, letterSpacing: 0.3, color: colors.boneDim },
  rideLine: { ...type.name, fontSize: 18, lineHeight: 24 },
  rideDate: { color: colors.boneDim },
  hazardLine: { gap: space.sm, alignItems: 'flex-end', flexWrap: 'nowrap' },
  remove: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
});
