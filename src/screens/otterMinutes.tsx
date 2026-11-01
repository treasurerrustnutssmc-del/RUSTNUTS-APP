// Draft from Otter: whoever runs a meeting picks (or pastes) the Otter transcript, the club's AI
// drafts the minutes, who was there and the action items, and they check and change everything
// before Use this draft saves it through the meeting's usual actions.
// Spec: docs/superpowers/specs/2026-11-01-otter-minutes-design.md ("The screen")

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useMinutesApi, type DraftResult } from '../data/minutesApi';
import { sampleTranscript } from '../data/minutesDemo';
import { pickTranscript } from '../data/transcriptFile';
import { formatAuDate } from '../domain/dates';
import { attendanceSessionFor, draftMinutesProblem, transcriptProblem, draftPlan, wordCount } from '../domain/otterMinutes';
import { melbourneDate } from '../domain/rides';
import type { RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import { Button, Card, ConfirmButton, Field, H1, Notice, Screen, SectionTitle, Small, Stack } from '../ui/primitives';
import { RadioRow } from './adminBits';

const HOW_TO = 'In Otter, open the recording, tap ⋯ › Export › Text (.txt) and save it to the phone. Or copy the transcript in Otter and paste it here.';
const PRIVACY = 'The transcript goes to Anthropic, the club’s AI provider, to write the draft and isn’t kept. It comes out of the Ask the club budget.';

const toggle = <T,>(set: Set<T>, id: T): Set<T> => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** "Heard as …" only when the recording called them something other than their name or road name. */
function heardAs(heard: string, person: { name: string; roadName: string | null } | undefined): string | undefined {
  const same = (a: string | null) => !!a && a.trim().toLowerCase() === heard.trim().toLowerCase();
  return person && !same(person.name) && !same(person.roadName) ? `Heard as “${heard}”` : undefined;
}

export function OtterMinutesScreen({ route, navigation }: RootScreen<'OtterMinutes'>) {
  const club = useClub();
  const { me, data, isDemo, today, saveMinutes, markAttendance, saveActionItem } = club;
  const api = useMinutesApi();
  const meeting = (data.meetings ?? []).find((m) => m.id === route.params.meetingId);
  const [transcript, setTranscript] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [minutes, setMinutes] = useState('');
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState<Set<number>>(new Set());

  const now = new Date().toISOString();
  const blocked = draftMinutesProblem(me, meeting, data, now);
  if (!meeting || blocked) {
    return (
      <Screen>
        <Notice tone="warn" title="Can’t draft these minutes">{blocked ?? 'No such meeting.'}</Notice>
      </Screen>
    );
  }
  const day = formatAuDate(melbourneDate(meeting.startsAt));
  const nameOf = (id: string) => {
    const p = result?.people.find((x) => x.id === id);
    return p ? (p.roadName ? `${p.name} (${p.roadName})` : p.name) : 'Someone';
  };

  const pick = async () => {
    setError(null);
    try {
      const file = await pickTranscript();
      if (!file) return;
      setTranscript(file.text);
      setFileName(file.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const draftIt = async () => {
    const problem = transcriptProblem(transcript);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const got = await api.draft(meeting, transcript);
      setResult(got);
      setMinutes(got.draft.minutes);
      setPresent(new Set(got.draft.present.flatMap((p) => (p.memberId ? [p.memberId] : []))));
      setKeep(new Set(got.draft.actionItems.flatMap((a, i) => (a.ownerId ? [i] : []))));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!result) {
    const words = wordCount(transcript);
    return (
      <Screen>
        <Stack gap={space.xs}>
          <H1>Get the transcript</H1>
          <Small>{`${meeting.title} · ${day}`}</Small>
        </Stack>
        <Card>
          <Small>{HOW_TO}</Small>
          <Button label="Pick the file" icon="document-text-outline" kind="secondary" onPress={pick} disabled={busy} />
          <Field
            label="Or paste it"
            value={transcript}
            onChangeText={(t) => {
              setTranscript(t);
              setFileName(null);
            }}
            multiline
            placeholder="Speaker 1  0:00  Righto, let’s get going…"
            style={{ minHeight: 160, maxHeight: 320 }}
          />
          {words ? <Small>{`${fileName ? `${fileName} · ` : ''}About ${words.toLocaleString('en-AU')} words`}</Small> : null}
          {isDemo && !transcript ? (
            <Button label="Use a sample transcript" kind="quiet" icon="flask-outline" onPress={() => setTranscript(sampleTranscript(meeting, data))} />
          ) : null}
        </Card>
        <View accessibilityLiveRegion="polite" role="alert">
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </View>
        <Button label={busy ? 'Writing the minutes…' : 'Draft the minutes'} icon="sparkles-outline" busy={busy} disabled={!transcript.trim()} onPress={draftIt} />
        {busy ? <Small style={styles.center}>This takes about a minute for an hour’s meeting.</Small> : null}
        <Small>{PRIVACY}</Small>
      </Screen>
    );
  }

  const { draft } = result;
  const session = attendanceSessionFor(meeting, data);
  const matched = draft.present.filter((p) => p.memberId);
  const unmatched = draft.present.filter((p) => !p.memberId).map((p) => p.heard);
  const ownerless = draft.actionItems.filter((a) => !a.ownerId);
  const plan = draftPlan(
    me,
    meeting,
    {
      minutes,
      present: [...present],
      actionItems: draft.actionItems.flatMap((a, i) => (a.ownerId && keep.has(i) ? [{ title: a.title, ownerId: a.ownerId, dueOn: a.dueOn }] : [])),
    },
    data,
    today,
  );

  const use = async () => {
    if (!plan.minutes) return setError('The minutes are empty.');
    setBusy(true);
    setError(null);
    try {
      await saveMinutes(meeting.id, plan.minutes);
      if (plan.sessionId) for (const id of plan.markPresent) await markAttendance(plan.sessionId, id, true);
      for (const item of plan.actionItems) await saveActionItem(item);
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const replacing = !!meeting.minutes?.trim();

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Check the draft</H1>
        <Small>{`${meeting.title} · ${day}. Nothing is saved until you tap Use this draft.`}</Small>
      </Stack>

      {draft.checkThese.length ? (
        <Notice tone="warn" title="Check these">
          {draft.checkThese.map((c) => `• ${c}`).join('\n')}
        </Notice>
      ) : null}

      <Card>
        <Field label="Minutes" value={minutes} onChangeText={setMinutes} multiline style={{ minHeight: 260 }} />
      </Card>

      <Stack gap={space.sm}>
        <SectionTitle title="Who was there" />
        {matched.length ? (
          <Card style={styles.list}>
            {matched.map((p, i) => (
              <RadioRow
                key={p.memberId!}
                multi
                label={nameOf(p.memberId!)}
                sub={heardAs(p.heard, result.people.find((x) => x.id === p.memberId))}
                on={present.has(p.memberId!)}
                last={i === matched.length - 1}
                onPress={() => setPresent((s) => toggle(s, p.memberId!))}
              />
            ))}
          </Card>
        ) : null}
        {unmatched.length ? <Small>{`Heard but not matched to a member: ${unmatched.join(', ')}.`}</Small> : null}
        {draft.apologies.length ? (
          <Small>{`Apologies: ${draft.apologies.map((a) => (a.memberId ? nameOf(a.memberId) : a.heard)).join(', ')}.`}</Small>
        ) : null}
        <Small>
          {session
            ? `Ticks mark attendance on the meeting check-in for ${formatAuDate(session.heldOn)}.`
            : meeting.chapterId
              ? 'No meeting check-in was opened that day, so attendance isn’t ticked. The minutes still list who was there.'
              : 'Attendance is counted at chapter meetings, so nothing is ticked for this one. The minutes still list who was there.'}
        </Small>
      </Stack>

      {draft.actionItems.length ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Action items" />
          {draft.actionItems.some((a) => a.ownerId) ? (
            <Card style={styles.list}>
              {draft.actionItems.map((a, i) =>
                a.ownerId ? (
                  <RadioRow
                    key={i}
                    multi
                    label={a.title}
                    sub={`${nameOf(a.ownerId)}${a.dueOn ? ` · by ${formatAuDate(a.dueOn)}` : ''}`}
                    on={keep.has(i)}
                    last={i === draft.actionItems.length - 1 || draft.actionItems.slice(i + 1).every((x) => !x.ownerId)}
                    onPress={() => setKeep((s) => toggle(s, i))}
                  />
                ) : null,
              )}
            </Card>
          ) : null}
          {ownerless.length ? (
            <Small>{`No owner heard, so add these by hand if they’re needed: ${ownerless.map((a) => `${a.title} (${a.ownerHeard || 'nobody named'})`).join('; ')}.`}</Small>
          ) : null}
          {plan.skippedActions.length ? (
            <Text style={styles.warn}>{`Can’t own an action item here, so these won’t be added: ${plan.skippedActions.join('; ')}.`}</Text>
          ) : null}
        </Stack>
      ) : null}

      <View accessibilityLiveRegion="polite" role="alert">
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
      {replacing ? (
        <ConfirmButton label="Use this draft" confirmLabel="Replace the draft minutes" kind="primary" icon="checkmark" onConfirm={use} />
      ) : (
        <Button label="Use this draft" icon="checkmark" busy={busy} onPress={use} />
      )}
      <Small>
        {`Saves the minutes as the meeting’s draft${plan.markPresent.length ? `, ticks ${plan.markPresent.length} ${plan.markPresent.length === 1 ? 'person' : 'people'} as there` : ''}${plan.actionItems.length ? ` and adds ${plan.actionItems.length} action ${plan.actionItems.length === 1 ? 'item' : 'items'}` : ''}. You still share and confirm the minutes as usual (10.8).`}
      </Small>
      <Button label="Start again" kind="secondary" icon="refresh" disabled={busy} onPress={() => setResult(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0, padding: 0 },
  center: { textAlign: 'center' },
  warn: { ...type.small, color: colors.warn },
});
