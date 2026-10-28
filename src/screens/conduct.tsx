// Conduct records (6.9, 14): the short factual record a board keeps of a conduct decision, which
// deletes itself after 12 months, and the member's review or appeal of it.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { isBoardOf } from '../domain/access';
import {
  appealBy, appealOpen, conductChapter, appealWord, CONDUCT_KINDS, conductFor, decisionDueOn, deleteOn, hearingDueOn, isFormal, KIND_LABEL,
  outcomeLabel, recordsConductFor, visibleConduct,
} from '../domain/conduct';
import { formatAuDate } from '../domain/dates';
import { displayName } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import type { AppealOutcome, ConductKind, ConductRecord, Member } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { space, type } from '../theme';
import {
  Body, Button, Card, Chip, Choices, ConfirmButton, Field, H1, IconBadge, ListRow, Notice, Screen, SectionTitle, Small, Stack,
} from '../ui/primitives';
import { ActionWithReason, DateField, Fact, MemberPicker, styles, useDate, useRun } from './adminBits';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function nameOf(id: string | null, members: Member[]): string {
  const m = id ? members.find((x) => x.id === id) : undefined;
  return m ? displayName(m) : 'A former member';
}

/** The record's state as a chip: an open review or appeal, a hold, or the day it goes. */
function StateChip({ r }: { r: ConductRecord }) {
  if (appealOpen(r)) return <Chip label={`${cap(appealWord(r.kind))} open`} tone="warn" icon="time-outline" />;
  if (r.holdUntil && r.holdUntil >= deleteOn({ ...r, holdUntil: null })) return <Chip label="Held" tone="steel" icon="lock-closed-outline" />;
  return <Chip label={`Goes ${formatAuDate(deleteOn(r))}`} tone="steel" />;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function ConductScreen({ route, navigation }: RootScreen<'Conduct'>) {
  const { me, data, today } = useClub();
  const mine = !!route.params?.mine;
  if (!me) return null;
  const records = mine ? conductFor(me.id, me, data, today) : visibleConduct(me, data, today);
  const open = records.filter(appealOpen);
  const rest = records.filter((r) => !appealOpen(r));
  const canRecord = !mine && recordsConductFor(me, data);

  const row = (r: ConductRecord, i: number, list: ConductRecord[]) => (
    <ListRow
      key={r.id}
      last={i === list.length - 1}
      left={<IconBadge icon={isFormal(r.kind) ? 'shield-outline' : 'document-text-outline'} />}
      title={mine || r.memberId === me.id ? KIND_LABEL[r.kind] : nameOf(r.memberId, data.members)}
      subtitle={
        <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
          <Text style={styles.meta}>{`${mine || r.memberId === me.id ? 'Decided' : KIND_LABEL[r.kind]} ${formatAuDate(r.decidedOn)}`}</Text>
          <StateChip r={r} />
        </View>
      }
      onPress={() => navigation.navigate('ConductRecord', { recordId: r.id })}
    />
  );

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>{mine ? 'Your records' : 'Conduct records'}</H1>
        <Small>Each record deletes itself 12 months after the decision, or after a suspension ends (6.9).</Small>
      </Stack>

      {canRecord ? (
        <Button label="Record a decision" icon="create-outline" onPress={() => navigation.navigate('RecordConduct')} style={{ minHeight: 56 }} />
      ) : null}

      {open.length > 0 ? (
        <>
          <SectionTitle title="Reviews and appeals" action={<Text style={styles.count}>{open.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>{open.map(row)}</Card>
        </>
      ) : null}

      <SectionTitle title="On record" action={<Text style={styles.count}>{rest.length}</Text>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {rest.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>{mine ? 'Nothing on your record.' : 'Nothing on record. Records older than 12 months are already gone.'}</Small>
          </View>
        ) : (
          rest.map(row)
        )}
      </Card>
      <Small>The Association Secretary keeps the legal register (15.6). These records are the club’s working copy.</Small>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One record
// ---------------------------------------------------------------------------

export function ConductRecordScreen({ route, navigation }: RootScreen<'ConductRecord'>) {
  const { me, data, today } = useClub();
  const r = me ? visibleConduct(me, data, today).find((x) => x.id === route.params.recordId) : undefined;
  if (!me || !r) {
    return (
      <Screen>
        <Notice tone="info" title="Not on record">
          This record isn’t there any more. Records go after 12 months, when they’re removed, or when a review sets them aside.
        </Notice>
      </Screen>
    );
  }
  const word = appealWord(r.kind);
  const chapter = data.chapters.find((c) => c.id === conductChapter(r, data));
  const board = isBoardOf(me, conductChapter(r, data), data.positions) && me.id !== r.memberId;
  const itsMine = me.id === r.memberId;

  return (
    <Screen>
      <Stack gap={space.sm}>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          <Chip label={KIND_LABEL[r.kind]} tone="bone" />
          <Chip label={isFormal(r.kind) ? 'Formal outcome' : 'Internal decision'} tone="steel" />
        </View>
        <H1>{itsMine ? 'Your record' : nameOf(r.memberId, data.members)}</H1>
        {chapter ? <Small>{`${chapter.name} chapter`}</Small> : null}
      </Stack>

      <Card>
        <Stack gap={space.sm}>
          <Fact icon="calendar-outline" text={`Decided ${formatAuDate(r.decidedOn)}`} />
          {!isFormal(r.kind) ? <Fact icon="mail-outline" text={`Written notice ${formatAuDate(r.noticeOn)}`} /> : null}
          {r.suspendedUntil ? <Fact icon="pause-circle-outline" text={`Suspended until ${formatAuDate(r.suspendedUntil)}`} /> : null}
          {r.rule ? <Fact icon="book-outline" text={`Rule: ${r.rule}`} /> : null}
        </Stack>
        <Body selectable>{r.summary}</Body>
        <Small>{`Recorded by ${nameOf(r.recordedBy, data.members)} on ${formatAuDate(melbourneDate(r.recordedAt))}`}</Small>
      </Card>

      <Card>
        <Fact icon="trash-outline" text={`Deletes itself on ${formatAuDate(deleteOn(r))}`} />
        {r.holdUntil ? <Small>{`Held until ${formatAuDate(r.holdUntil)}: ${r.holdReason}`}</Small> : null}
        {appealOpen(r) ? <Small>{`Kept while the ${word} is open, even past that day.`}</Small> : null}
      </Card>

      <AppealSection r={r} onGone={() => navigation.goBack()} />

      {board ? <BoardTools r={r} onGone={() => navigation.goBack()} /> : null}
    </Screen>
  );
}

function AppealSection({ r, onGone }: { r: ConductRecord; onGone: () => void }) {
  const { me, data, today, lodgeAppeal, withdrawAppeal } = useClub();
  const [grounds, setGrounds] = useState('');
  const { busy, msg, run } = useRun();
  const word = appealWord(r.kind);
  const a = r.appeal;
  const by = appealBy(r);
  const canLodge = !!me && (me.id === r.memberId || isBoardOf(me, conductChapter(r, data), data.positions));

  if (!a) {
    if (!canLodge) return null;
    if (today > by) {
      return (
        <>
          <SectionTitle title={cap(word)} />
          <Small>{`The window for a ${word} closed on ${formatAuDate(by)}.`}</Small>
        </>
      );
    }
    return (
      <>
        <SectionTitle title={me!.id === r.memberId ? `Ask for a ${word}` : `Lodge a ${word} for them`} />
        <Card>
          <Small>
            {isFormal(r.kind)
              ? `An appeal goes to a panel of three within 21 days (14.6). Lodge it by ${formatAuDate(by)}, 7 days from the vote.`
              : `A review goes to a panel of three within 21 days (14.6B). Ask by ${formatAuDate(by)}, 14 days from written notice.`}
          </Small>
          <Field label="Why" value={grounds} onChangeText={setGrounds} multiline maxLength={1000} placeholder="What you’d like the panel to look at" />
          <ActionWithReason
            label={`Lodge ${word}`}
            icon="paper-plane-outline"
            kind={me!.id === r.memberId ? 'primary' : 'secondary'}
            busy={busy === 'lodge'}
            reason={msg?.tone === 'danger' ? msg.text : null}
            onPress={() => run('lodge', () => lodgeAppeal(r.id, grounds))}
          />
        </Card>
      </>
    );
  }

  const settled = a.outcome !== null || a.withdrawnOn !== null;
  return (
    <>
      <SectionTitle title={cap(word)} />
      <Card>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          {a.withdrawnOn ? (
            <Chip label="Withdrawn" tone="steel" />
          ) : a.outcome ? (
            <Chip label={outcomeLabel(r.kind, a.outcome)} tone="ok" icon="checkmark" />
          ) : (
            <Chip label={a.hearingOn ? 'Hearing set' : 'Waiting for a panel'} tone="warn" icon="time-outline" />
          )}
        </View>
        <Stack gap={space.sm}>
          <Fact icon="paper-plane-outline" text={`Lodged ${formatAuDate(a.lodgedOn)} by ${nameOf(a.lodgedBy, data.members)}`} />
          {a.hearingOn ? <Fact icon="people-outline" text={`Hearing ${formatAuDate(a.hearingOn)}`} /> : null}
          {!settled && !a.hearingOn ? <Fact icon="alarm-outline" text={`Hearing due by ${formatAuDate(hearingDueOn(a.lodgedOn))}`} tone="warn" /> : null}
          {!settled && a.hearingOn && !isFormal(r.kind) ? (
            <Fact icon="alarm-outline" text={`Decision due by ${formatAuDate(decisionDueOn(a.hearingOn))}`} />
          ) : null}
          {a.decidedOn ? <Fact icon="checkmark-done-outline" text={`Decided ${formatAuDate(a.decidedOn)} by ${nameOf(a.decidedBy, data.members)}`} /> : null}
          {a.withdrawnOn ? <Fact icon="arrow-undo-outline" text={`Withdrawn ${formatAuDate(a.withdrawnOn)}`} /> : null}
        </Stack>
        <View style={styles.quote}>
          <Body selectable>{a.grounds}</Body>
        </View>
        {a.panelIds.length > 0 ? <Small>{`Panel: ${a.panelIds.map((id) => nameOf(id, data.members)).join(', ')}`}</Small> : null}
        {a.outcomeNote ? <Body selectable>{a.outcomeNote}</Body> : null}
        {!settled && me?.id === r.memberId ? (
          <ConfirmButton
            label={`Withdraw ${word}`}
            confirmLabel="Yes, withdraw"
            kind="secondary"
            confirmNote="The decision stands and the record goes on its usual day."
            onConfirm={() => run('withdraw', () => withdrawAppeal(r.id))}
          />
        ) : null}
        {msg?.tone === 'danger' && busy === null ? (
          <View accessibilityLiveRegion="polite" role="alert">
            <Notice tone="danger">{msg.text}</Notice>
          </View>
        ) : null}
      </Card>
      {!settled ? <HearingForm r={r} /> : null}
      {!settled ? <OutcomeForm r={r} onGone={onGone} /> : null}
    </>
  );
}

function HearingForm({ r }: { r: ConductRecord }) {
  const { me, data, today, setHearing } = useClub();
  const a = r.appeal!;
  const [panel, setPanel] = useState<string[]>(a.panelIds);
  const date = useDate(a.hearingOn ?? (hearingDueOn(a.lodgedOn) < today ? today : hearingDueOn(a.lodgedOn)));
  const { busy, msg, run } = useRun();
  if (!me || !isBoardOf(me, conductChapter(r, data), data.positions) || me.id === r.memberId || me.id === r.recordedBy) return null;
  const choices = data.members.filter(
    (m) => m.approval === 'approved' && m.status !== 'legacy' && m.id !== r.memberId && m.id !== r.recordedBy,
  );
  const chapterName = (m: Member) => data.chapters.find((c) => c.id === m.chapterId)?.name;
  return (
    <>
      <SectionTitle title={a.hearingOn ? 'Change the hearing' : 'Set up the hearing'} />
      <Card>
        <Small>Three people hear it, none of them the member or whoever recorded it (14.3).</Small>
        <MemberPicker label={`Panel (${panel.length} of 3)`} choices={choices} picked={panel} onChange={setPanel} multi sub={chapterName} />
        <DateField label="Hearing date" date={date} hint={`Due by ${formatAuDate(hearingDueOn(a.lodgedOn))}`} />
        <ActionWithReason
          label={a.hearingOn ? 'Save the hearing' : 'Set up the hearing'}
          icon="people-outline"
          kind="secondary"
          busy={busy === 'hearing'}
          reason={msg?.tone === 'danger' ? msg.text : null}
          onPress={() => run('hearing', () => setHearing(r.id, panel, date.iso), 'Hearing saved.')}
        />
        {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}
      </Card>
    </>
  );
}

function OutcomeForm({ r, onGone }: { r: ConductRecord; onGone: () => void }) {
  const { me, today, decideAppeal } = useClub();
  const a = r.appeal!;
  const [outcome, setOutcome] = useState<AppealOutcome | null>(null);
  const [note, setNote] = useState('');
  const { busy, msg, run } = useRun();
  if (!me || !a.panelIds.includes(me.id) || !a.hearingOn) return null;
  const formal = isFormal(r.kind);
  const options: { value: AppealOutcome; label: string }[] = formal
    ? [{ value: 'confirmed', label: 'Upheld' }, { value: 'set_aside', label: 'Revoked' }]
    : [{ value: 'confirmed', label: 'Confirmed' }, { value: 'varied', label: 'Varied' }, { value: 'set_aside', label: 'Set aside' }];
  const decide = () =>
    run('outcome', () => decideAppeal(r.id, outcome!, note)).then((done) => {
      if (done && outcome === 'set_aside') onGone();
    });
  const reason = msg?.tone === 'danger' ? msg.text : null;
  return (
    <>
      <SectionTitle title="The panel’s decision" />
      <Card>
        {today < a.hearingOn ? <Small>{`You can record it from the hearing, ${formatAuDate(a.hearingOn)}.`}</Small> : null}
        <Choices<AppealOutcome> options={options} value={outcome} onChange={setOutcome} />
        <Field
          label={outcome === 'varied' ? 'How it was varied' : 'Note'}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={1000}
          hint={outcome === 'varied' ? undefined : 'Optional. The member and the board see it.'}
        />
        {outcome === 'set_aside' ? (
          <Stack gap={space.sm}>
            <ConfirmButton
              label={formal ? 'Revoke it' : 'Set it aside'}
              confirmLabel="Yes, delete the record"
              confirmNote="Setting it aside deletes the record straight away (6.9)."
              onConfirm={decide}
            />
            <View accessibilityLiveRegion="polite" role="alert">{reason ? <Notice tone="danger">{reason}</Notice> : null}</View>
          </Stack>
        ) : (
          <ActionWithReason label="Record the decision" icon="checkmark" busy={busy === 'outcome'} reason={reason} onPress={() => (outcome ? decide() : undefined)} />
        )}
      </Card>
    </>
  );
}

function BoardTools({ r, onGone }: { r: ConductRecord; onGone: () => void }) {
  const { today, holdConduct, removeConduct } = useClub();
  const until = useDate(r.holdUntil);
  const [reason, setReason] = useState(r.holdReason);
  const { busy, msg, run } = useRun();
  return (
    <>
      <SectionTitle title="For the board" />
      <Card>
        <Text style={type.name}>{r.holdUntil ? 'Kept longer' : 'Keep it longer'}</Text>
        <Small>Only while an active disciplinary, grievance or legal matter needs it, for up to 7 years (6.9).</Small>
        <DateField label="Keep until" date={until} />
        <Field label="Which matter needs it" value={reason} onChangeText={setReason} multiline maxLength={300} />
        <ActionWithReason
          label={r.holdUntil ? 'Save the hold' : 'Keep it longer'}
          icon="lock-closed-outline"
          kind="secondary"
          busy={busy === 'hold'}
          reason={msg?.tone === 'danger' ? msg.text : null}
          onPress={() => run('hold', () => holdConduct(r.id, until.iso, reason), 'Hold saved.')}
        />
        {r.holdUntil ? (
          <ConfirmButton
            label="Let it go on its day"
            confirmLabel="Yes, let it go"
            kind="quiet"
            confirmNote={
              today >= deleteOn({ ...r, holdUntil: null }) && !appealOpen(r)
                ? 'It’s past its 12 months, so it’s deleted now.'
                : `It goes on ${formatAuDate(deleteOn({ ...r, holdUntil: null }))}.`
            }
            onConfirm={() => run('release', () => holdConduct(r.id, null, ''), 'It now goes on its usual day.')}
          />
        ) : null}
        {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}
      </Card>
      <ConfirmButton
        label="Remove record"
        confirmLabel="Yes, remove it"
        kind="secondary"
        confirmNote="For a record made by mistake. It’s deleted now and can’t be brought back."
        onConfirm={() => run('remove', () => removeConduct(r.id)).then((done) => done && onGone())}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Recording a decision
// ---------------------------------------------------------------------------

export function RecordConductScreen({ route, navigation }: RootScreen<'RecordConduct'>) {
  const { me, data, today, recordConduct } = useClub();
  const [memberId, setMemberId] = useState<string | null>(route.params?.memberId ?? null);
  const [kind, setKind] = useState<ConductKind | null>(null);
  const [summary, setSummary] = useState('');
  const [rule, setRule] = useState('');
  const decided = useDate(today);
  const notice = useDate(null);
  const suspended = useDate(null);
  const { busy, msg, run } = useRun();
  if (!me || !recordsConductFor(me, data)) {
    return (
      <Screen>
        <Notice tone="info">Only a chapter board or the NEC records conduct decisions.</Notice>
      </Screen>
    );
  }
  const choices = data.members.filter((m) => m.approval === 'approved' && m.id !== me.id && isBoardOf(me, m.chapterId, data.positions));
  const chapterName = (m: Member) => data.chapters.find((c) => c.id === m.chapterId)?.name;
  const internal = CONDUCT_KINDS.filter((k) => !isFormal(k));
  const formal = CONDUCT_KINDS.filter(isFormal);
  const pick = (k: ConductKind) => setKind(k);

  const save = () =>
    run('save', async () => {
      const id = await recordConduct({
        memberId: memberId ?? '',
        kind,
        summary,
        rule,
        decidedOn: decided.iso,
        noticeOn: kind && isFormal(kind) ? decided.iso : notice.text.trim() ? notice.iso : decided.iso,
        suspendedUntil: kind === 'suspension' ? suspended.iso || null : null,
      });
      navigation.replace('ConductRecord', { recordId: id });
    });

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Record a decision</H1>
        <Small>Keep it short and factual. The member sees it, and it deletes itself after 12 months (6.9).</Small>
      </Stack>

      <MemberPicker label="Who it’s about" choices={choices} picked={memberId ? [memberId] : []} onChange={(ids) => setMemberId(ids[0] ?? null)} sub={chapterName} />

      <Choices<ConductKind> label="Internal decision" options={internal.map((k) => ({ value: k, label: KIND_LABEL[k] }))} value={kind && !isFormal(kind) ? kind : null} onChange={pick} />
      <Choices<ConductKind> label="Formal outcome (14.4)" options={formal.map((k) => ({ value: k, label: KIND_LABEL[k] }))} value={kind && isFormal(kind) ? kind : null} onChange={pick} />
      {kind ? (
        <Small>
          {isFormal(kind)
            ? 'They can appeal within 7 days of the vote. The record goes 12 months after the decision.'
            : 'They can ask for a review within 14 days of written notice.'}
        </Small>
      ) : null}

      <Field label="What happened" value={summary} onChangeText={setSummary} multiline maxLength={1000} autoCapitalize="sentences" />
      <Field label="Rule" value={rule} onChangeText={setRule} maxLength={200} placeholder="6.9 vest direction" hint="Optional. The clause or Road Rule it falls under." />
      <DateField label={kind && isFormal(kind) ? 'Date of the vote' : 'Date of the decision'} date={decided} />
      {kind && !isFormal(kind) ? <DateField label="Written notice given" date={notice} hint="Blank means the day of the decision. The review window runs 14 days from here." /> : null}
      {kind === 'suspension' ? <DateField label="Suspended until" date={suspended} /> : null}

      <ActionWithReason label="Save record" icon="checkmark" big busy={busy === 'save'} reason={msg?.tone === 'danger' ? msg.text : null} onPress={save} />
    </Screen>
  );
}
