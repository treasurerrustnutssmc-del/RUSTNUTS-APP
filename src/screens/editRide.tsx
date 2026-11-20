// Rides made in the app: the form for making a ride or changing one, used by the people who run a
// ride's crew (the chapter's board or ride committee, or the NEC). Calendar rides are changed in the
// calendar. The rules and words are in src/domain/newRide.ts; the database applies the same ones.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { formatAuDate, parseAuDate, typeDate, weekday } from '../domain/dates';
import { RIDE_CATEGORIES, RIDE_CATEGORY_LABEL } from '../domain/labels';
import {
  CALENDAR_RIDE, DATE_HINT, isAppRide, managesCategory, MAX_RIDE_LOCATION, MAX_RIDE_NOTES, MAX_RIDE_TITLE, readRideTime, RIDE_END, RIDE_START,
  rideEnd, rideStart, saveRideProblem, TIME_HINT, type RideInput,
} from '../domain/newRide';
import { melbourneHhmm } from '../domain/business';
import { lastDay, melbourneDate } from '../domain/rides';
import { legsOf, linkableRides, nextLegDraft, setLegsProblem, tripAfterSave } from '../domain/rideLegs';
import { typeTime } from '../domain/ridePlan';
import type { RideCategory } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import { colors, space } from '../theme';
import { Button, Card, Choices, ConfirmButton, Field, ListRow, Notice, Screen, Small, Toggle } from '../ui/primitives';

const nowIso = () => new Date().toISOString();

/** Runs a save with a busy flag and its refusal on screen. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>, after?: () => void) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await action();
      setBusy(false);
      after?.();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function EditRideScreen({ route: nav, navigation }: RootScreen<'EditRide'>) {
  const { me, data, saveRide, setRideLegs } = useClub();
  const rideId = nav.params?.rideId;
  const ride = rideId ? data.rides.find((r) => r.id === rideId) : undefined;
  // Start the next leg: a new ride filled in from the trip it follows, linked as its next leg on save.
  const nextLegOf = !rideId ? nav.params?.nextLegOf : undefined;
  const draft = nextLegOf && data.rides.some((r) => r.id === nextLegOf) ? nextLegDraft(nextLegOf, data) : null;
  const allowed = RIDE_CATEGORIES.filter((c) => managesCategory(me, c, data));
  const ownSlug = data.chapters.find((c) => c.id === me?.chapterId)?.slug;
  const firstCategory: RideCategory =
    (draft && allowed.includes(draft.category) ? draft.category : null) ?? allowed.find((c) => c === ownSlug) ?? allowed[0] ?? 'club';

  const [title, setTitle] = useState(ride?.title ?? draft?.title ?? '');
  const [allDay, setAllDay] = useState(ride?.allDay ?? false);
  const [dateText, setDateText] = useState(ride ? formatAuDate(melbourneDate(ride.startsAt)) : draft?.dateIso ? formatAuDate(draft.dateIso) : '');
  const [timeText, setTimeText] = useState(ride && !ride.allDay ? melbourneHhmm(ride.startsAt) : '');
  const [hasEnd, setHasEnd] = useState(!!ride?.endsAt);
  const [endDateText, setEndDateText] = useState(ride?.endsAt ? formatAuDate(ride.allDay ? lastDay(ride) : melbourneDate(ride.endsAt)) : '');
  const [endTimeText, setEndTimeText] = useState(ride?.endsAt && !ride.allDay ? melbourneHhmm(ride.endsAt) : '');
  const [category, setCategory] = useState<RideCategory>(ride?.category ?? firstCategory);
  const [location, setLocation] = useState(ride?.location ?? '');
  const [notes, setNotes] = useState(ride?.notes ?? '');
  const [website, setWebsite] = useState(ride?.website ?? true);
  const { busy, error, setError, run } = useAction();

  if (!me) return null;
  if (rideId && !ride) {
    return (
      <Screen>
        <Notice tone="warn" title="Ride not found">It may have come off the club calendar.</Notice>
      </Screen>
    );
  }
  if (ride && !isAppRide(ride)) {
    return (
      <Screen>
        <Notice tone="warn" title="From the club calendar">{CALENDAR_RIDE}</Notice>
      </Screen>
    );
  }

  const set = <T,>(fn: (v: T) => void) => (v: T) => { setError(null); fn(v); };
  const dateTyped = dateText.trim();
  const dateIso = dateTyped ? parseAuDate(dateTyped) : null;
  const dateError = dateTyped.length >= 10 && !dateIso ? DATE_HINT : null;
  const timeTyped = timeText.trim();
  const time = timeTyped ? readRideTime(timeTyped) : null;
  const timeError = !allDay && timeTyped.length >= 4 && !time ? TIME_HINT : null;
  const endDateTyped = endDateText.trim();
  const endDateIso = endDateTyped ? parseAuDate(endDateTyped) : null;
  const endDateError = hasEnd && endDateTyped.length >= 10 && !endDateIso ? DATE_HINT : null;
  const endTimeTyped = endTimeText.trim();
  const endTime = endTimeTyped ? readRideTime(endTimeTyped) : null;
  const endTimeError = hasEnd && !allDay && endTimeTyped.length >= 4 && !endTime ? TIME_HINT : null;

  const input = (): RideInput => {
    if (!dateIso || (!allDay && !time)) throw new Error(RIDE_START);
    const startsAt = rideStart(dateIso, time, allDay);
    if (!startsAt) throw new Error(RIDE_START);
    let endsAt: string | null = null;
    if (hasEnd) {
      // A half-typed end is refused, never saved as no end; an all-day end on an earlier day too.
      if (!endDateIso || (!allDay && !endTime)) throw new Error(RIDE_END);
      if (allDay && endDateIso < dateIso) throw new Error(RIDE_END);
      endsAt = rideEnd(endDateIso, endTime, allDay);
      if (!endsAt) throw new Error(RIDE_END);
    }
    return { title, startsAt, endsAt, allDay, category, location, notes, website };
  };

  const save = () =>
    run(async () => {
      const built = input();
      const problem = saveRideProblem(me, ride, built, data, nowIso());
      if (problem) throw new Error(problem);
      const id = await saveRide(built, ride?.id);
      if (!ride && nextLegOf) {
        // Saved; linking it is a second step, so a refusal there still leaves the new ride to open.
        try {
          await setRideLegs(tripAfterSave(nextLegOf, id, data));
        } catch (e) {
          navigation.replace('RideDetail', { rideId: id });
          throw new Error(`The ride is saved, but it isn’t linked as the next leg: ${(e as Error).message}`);
        }
      }
      if (!ride) navigation.replace('RideDetail', { rideId: id });
    }, () => { if (ride) navigation.goBack(); });

  return (
    <Screen>
      {draft && nextLegOf ? (
        <Notice title={`Leg ${(legsOf(nextLegOf, data)?.length ?? 1) + 1}`}>
          {`Once saved, this ride becomes the next leg after ${data.rides.find((r) => r.id === nextLegOf)?.title ?? 'that ride'}. Check the date and set the start time.`}
        </Notice>
      ) : null}
      <Card>
        <Field
          label="Title"
          value={title}
          onChangeText={set(setTitle)}
          placeholder="West breakfast run"
          maxLength={MAX_RIDE_TITLE + 20}
          hint={`3 to ${MAX_RIDE_TITLE} characters.`}
        />
        <Field
          label="Date"
          value={dateText}
          onChangeText={(t) => { setError(null); setDateText(typeDate(t)); }}
          placeholder="DD/MM/YYYY"
          inputMode="numeric"
          maxLength={10}
          error={dateError}
          hint="Today or later."
        />
        <Toggle label="All day" value={allDay} onChange={set(setAllDay)} />
        {allDay ? null : (
          <Field
            label="Start time"
            value={timeText}
            onChangeText={(t) => { setError(null); setTimeText(typeTime(t)); }}
            placeholder="09:30"
            inputMode="numeric"
            keyboardType="number-pad"
            maxLength={5}
            error={timeError}
            hint="24-hour, Melbourne time."
          />
        )}
        <Toggle label={allDay ? 'Ends on another day' : 'Has an end time'} value={hasEnd} onChange={set(setHasEnd)} />
        {hasEnd ? (
          <View style={styles.pair}>
            <View style={styles.half}>
              <Field
                label={allDay ? 'Last day' : 'End date'}
                value={endDateText}
                onChangeText={(t) => { setError(null); setEndDateText(typeDate(t)); }}
                placeholder="DD/MM/YYYY"
                inputMode="numeric"
                maxLength={10}
                error={endDateError}
              />
            </View>
            {allDay ? null : (
              <View style={styles.half}>
                <Field
                  label="End time"
                  value={endTimeText}
                  onChangeText={(t) => { setError(null); setEndTimeText(typeTime(t)); }}
                  placeholder="13:00"
                  inputMode="numeric"
                  keyboardType="number-pad"
                  maxLength={5}
                  error={endTimeError}
                />
              </View>
            )}
          </View>
        ) : null}
        <Choices<RideCategory>
          label="Chapter or colour"
          options={allowed.map((c) => ({ value: c, label: RIDE_CATEGORY_LABEL[c] }))}
          value={category}
          onChange={set(setCategory)}
        />
        <Field
          label="Meeting place"
          value={location}
          onChangeText={set(setLocation)}
          placeholder="Caltex Laverton North"
          maxLength={MAX_RIDE_LOCATION + 20}
          hint={`Optional. ${MAX_RIDE_LOCATION} characters at most. Opens in maps from the ride.`}
        />
        <Field
          label="Notes"
          value={notes}
          onChangeText={set(setNotes)}
          multiline
          placeholder="KSU 8:30. Breakfast at Daylesford, home by lunch."
          hint={`Optional. ${MAX_RIDE_NOTES} characters at most. Members only.`}
        />
        <Toggle
          label="Show on the website"
          description="The site shows the title, when, chapter and meeting place. Notes stay in the app."
          value={website}
          onChange={set(setWebsite)}
        />
      </Card>
      <View accessibilityLiveRegion="polite" role="alert">
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
      <Button label={ride ? 'Save changes' : 'Create ride'} icon="checkmark" busy={busy} onPress={save} />
      {ride ? null : <Small style={{ textAlign: 'center' }}>Members see it in Rides straight away. Those who asked for new-ride alerts hear about it.</Small>}
    </Screen>
  );
}

/** Rides ridden in legs: tick the rides that make up the trip; they're numbered in start order. */
export function RideLegsScreen({ route: nav, navigation }: RootScreen<'RideLegs'>) {
  const { me, data, setRideLegs } = useClub();
  const rideId = nav.params.rideId;
  const now = nowIso();
  const choices = linkableRides(me, rideId, data, now);
  const current = legsOf(rideId, data);
  const [picked, setPicked] = useState<string[]>(current ? current.map((r) => r.id) : [rideId]);
  const { busy, error, setError, run } = useAction();
  if (!me) return null;
  const toggle = (id: string) => {
    setError(null);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  // Numbered in start order, the way riders ride them.
  const ordered = choices.filter((r) => picked.includes(r.id)).map((r) => r.id);
  const save = (ids: string[]) =>
    run(async () => {
      const problem = setLegsProblem(me, ids, data, now);
      if (problem) throw new Error(problem);
      await setRideLegs(ids);
    }, () => navigation.goBack());
  return (
    <Screen>
      <Small>Tick the rides that make up the trip. They’re numbered by when they start. Each leg keeps its own route, crew, chat and ride comms.</Small>
      <Card style={{ padding: 0, gap: 0 }}>
        {choices.map((r, i) => {
          const day = melbourneDate(r.startsAt);
          const on = picked.includes(r.id);
          const no = ordered.indexOf(r.id);
          return (
            <ListRow
              key={r.id}
              checked={on}
              left={<Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? colors.redText : colors.boneMute} />}
              last={i === choices.length - 1}
              title={r.title}
              subtitle={`${on && ordered.length >= 2 ? `Leg ${no + 1} · ` : ''}${weekday(day)} ${formatAuDate(day)}${r.allDay ? '' : ` · ${melbourneHhmm(r.startsAt)}`}`}
              onPress={() => toggle(r.id)}
            />
          );
        })}
      </Card>
      <View accessibilityLiveRegion="polite" role="alert">
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
      <Button
        label={ordered.length >= 2 ? `Save ${ordered.length} legs` : 'Tick two or more rides'}
        icon="checkmark"
        busy={busy}
        disabled={ordered.length < 2}
        onPress={() => save(ordered)}
      />
      {current ? (
        <ConfirmButton
          label="Unlink the legs"
          confirmLabel="Yes, unlink them"
          confirmNote="The rides stay as they are; they just stop being one trip."
          kind="quiet"
          disabled={busy}
          onConfirm={() => save([rideId])}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
});
