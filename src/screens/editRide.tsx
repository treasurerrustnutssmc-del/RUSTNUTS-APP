// Rides made in the app: the form for making a ride or changing one, used by the people who run a
// ride's crew (the chapter's board or ride committee, or the NEC). Calendar rides are changed in the
// calendar. The rules and words are in src/domain/newRide.ts; the database applies the same ones.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { RIDE_CATEGORIES, RIDE_CATEGORY_LABEL } from '../domain/labels';
import {
  CALENDAR_RIDE, DATE_HINT, isAppRide, managesCategory, MAX_RIDE_LOCATION, MAX_RIDE_NOTES, MAX_RIDE_TITLE, readRideTime, RIDE_END, RIDE_START,
  rideEnd, rideStart, saveRideProblem, TIME_HINT, type RideInput,
} from '../domain/newRide';
import { melbourneHhmm } from '../domain/business';
import { lastDay, melbourneDate } from '../domain/rides';
import { typeTime } from '../domain/ridePlan';
import type { RideCategory } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { space } from '../theme';
import { Button, Card, Choices, Field, Notice, Screen, Small, Toggle } from '../ui/primitives';

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
  const { me, data, saveRide } = useClub();
  const rideId = nav.params?.rideId;
  const ride = rideId ? data.rides.find((r) => r.id === rideId) : undefined;
  const allowed = RIDE_CATEGORIES.filter((c) => managesCategory(me, c, data));
  const ownSlug = data.chapters.find((c) => c.id === me?.chapterId)?.slug;
  const firstCategory: RideCategory = allowed.find((c) => c === ownSlug) ?? allowed[0] ?? 'club';

  const [title, setTitle] = useState(ride?.title ?? '');
  const [allDay, setAllDay] = useState(ride?.allDay ?? false);
  const [dateText, setDateText] = useState(ride ? formatAuDate(melbourneDate(ride.startsAt)) : '');
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
      if (!ride) navigation.replace('RideDetail', { rideId: id });
    }, () => { if (ride) navigation.goBack(); });

  return (
    <Screen>
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
      <Button label={ride ? 'Save changes' : 'Make the ride'} icon="checkmark" busy={busy} onPress={save} />
      {ride ? null : <Small style={{ textAlign: 'center' }}>Members see it in Rides straight away. Those who asked for new-ride alerts hear about it.</Small>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
});
