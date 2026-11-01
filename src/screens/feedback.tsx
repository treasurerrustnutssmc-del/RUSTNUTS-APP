// Feedback & issues. Members: a card on Me opens a form (what it is, what happened, where, a
// screenshot) and shows their own reports with the keepers' replies. Keepers (Treasurer, NEC):
// the "App feedback" section on the Board screen, with status buttons, a reply and Email.
// Spec: docs/superpowers/specs/2026-11-01-app-feedback-design.md

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { PickProblem, pickMedia } from '../data/chat/media';
import { useClub } from '../data/ClubStore';
import { useFeedback } from '../data/feedback';
import type { PickedMedia } from '../domain/chat';
import { formatAuDate } from '../domain/dates';
import {
  FEEDBACK_KINDS,
  FEEDBACK_MAX,
  FEEDBACK_REPLY_MAX,
  FEEDBACK_WHERE_MAX,
  deviceLine,
  feedbackKindLabel,
  feedbackMailto,
  feedbackStatusLabel,
  isFeedbackKeeper,
  sendFeedbackProblem,
  type Feedback,
  type FeedbackStatus,
} from '../domain/feedback';
import { melbourneDate } from '../domain/rides';
import type { RootParams } from '../navigation/types';
import { colors, radius, space, type } from '../theme';
import { Body, Button, Card, Chip, Choices, Field, IconBadge, ListRow, Notice, Row, Screen, SectionTitle, Small } from '../ui/primitives';
import { openLink } from '../ui/openLink';

type Nav = NavigationProp<RootParams>;

/** The section on Me (members and Family). */
export function FeedbackRow() {
  const navigation = useNavigation<Nav>();
  return (
    <>
      <SectionTitle title="The app" />
      <Card style={{ padding: 0, gap: 0 }}>
      <ListRow
        last
        left={<IconBadge icon="construct-outline" tone="red" />}
        title="Feedback & issues"
        subtitle="Something broken, or an idea? Tell us."
        onPress={() => navigation.navigate('Feedback')}
      />
      </Card>
    </>
  );
}

const KIND_OPTIONS = FEEDBACK_KINDS.map((k) => ({ value: k, label: feedbackKindLabel(k) }));
const statusTone = (s: FeedbackStatus): 'red' | 'warn' | 'ok' => (s === 'new' ? 'red' : s === 'looking' ? 'warn' : 'ok');

/** The member's screen: the form, then their own reports. */
export function FeedbackScreen() {
  const { me } = useClub();
  const { ready, feedback, loadError, details, send } = useFeedback();
  const [kind, setKind] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [where, setWhere] = useState('');
  const [shot, setShot] = useState<PickedMedia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const pick = () => {
    setError(null);
    pickMedia('library', 1, true)
      .then(([picked]) => {
        if (picked) setShot(picked);
      })
      .catch((e) => setError(e instanceof PickProblem ? e.message : 'That picture couldn’t be opened. Try another.'));
  };

  const submit = () => {
    if (busy) return;
    setError(null);
    setSent(null);
    const draft = { kind: kind ?? '', body, whereInApp: where };
    const problem = sendFeedbackProblem(me, { ...draft, sentToday: 0 });
    if (problem) return setError(problem);
    setBusy(true);
    send(draft, shot)
      .then(() => {
        setKind(null);
        setBody('');
        setWhere('');
        setShot(null);
        setSent('Thanks. It’s with the club.');
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  const mine = feedback.filter((f) => f.memberId === me.id);
  return (
    <Screen>
      <Card>
        <Body>Found something broken, or got an idea for the app? Say it here and the people who look after the app will see it.</Body>
        <Choices label="What is it?" options={KIND_OPTIONS} value={kind as (typeof FEEDBACK_KINDS)[number] | null} onChange={setKind} />
        <Field
          label="Tell us"
          value={body}
          onChangeText={setBody}
          multiline
          placeholder="What happened, or what you’d like"
          maxLength={FEEDBACK_MAX}
          hint={`${body.length} of ${FEEDBACK_MAX.toLocaleString('en-AU')}`}
        />
        <Field label="Where in the app?" value={where} onChangeText={setWhere} placeholder="Rides, the map" hint="Optional." maxLength={FEEDBACK_WHERE_MAX} />
        {shot ? (
          <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'center' }}>
            <Image source={{ uri: shot.uri }} style={{ width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.steel }} contentFit="cover" accessibilityLabel="Your screenshot" />
            <Button label="Take it off" kind="quiet" size="small" icon="close" onPress={() => setShot(null)} />
          </Row>
        ) : (
          <Button label="Add a screenshot" kind="secondary" icon="image-outline" onPress={pick} />
        )}
        <Small>Sent with: {deviceLine(details)}</Small>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {sent ? <Notice tone="info">{sent}</Notice> : null}
        <Button label="Send" icon="send" onPress={submit} busy={busy} />
      </Card>

      <SectionTitle title="Your reports" action={<Small>{mine.length}</Small>} />
      {loadError ? (
        <Notice tone="danger">{loadError}</Notice>
      ) : !ready ? (
        <Card>
          <Small>Loading…</Small>
        </Card>
      ) : mine.length === 0 ? (
        <Card>
          <Small>Nothing sent yet. What you send shows here, with the reply.</Small>
        </Card>
      ) : (
        mine.map((f) => <MyReportCard key={f.id} report={f} />)
      )}
    </Screen>
  );
}

function ReportHeader({ report, who }: { report: Feedback; who?: string }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ gap: 2 }}>
        {who ? <Text style={type.name}>{who}</Text> : null}
        <Small>{formatAuDate(melbourneDate(report.createdAt))}{report.whereInApp ? ` · ${report.whereInApp}` : ''}</Small>
      </View>
      <Row style={{ gap: space.sm }}>
        <Chip label={feedbackKindLabel(report.kind)} tone="bone" />
        <Chip label={feedbackStatusLabel(report.status)} tone={statusTone(report.status)} />
      </Row>
    </View>
  );
}

function Reply({ report }: { report: Feedback }) {
  if (!report.reply) return null;
  return (
    <View style={{ borderLeftWidth: 2, borderLeftColor: colors.redBright, paddingLeft: space.md, gap: 2 }}>
      <Small>Reply{report.repliedAt ? ` · ${formatAuDate(melbourneDate(report.repliedAt))}` : ''}</Small>
      <Body>{report.reply}</Body>
    </View>
  );
}

function MyReportCard({ report }: { report: Feedback }) {
  return (
    <Card style={report.status === 'done' ? { opacity: 0.75 } : undefined}>
      <ReportHeader report={report} />
      <Body>{report.body}</Body>
      <Reply report={report} />
    </Card>
  );
}

/** A screenshot on a report: a thumbnail that opens full size. */
function Screenshot({ path, screenshotUrl }: { path: string; screenshotUrl: (p: string) => Promise<string> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    screenshotUrl(path).then(
      (u) => live && setUrl(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [path, screenshotUrl]);
  if (failed) return <Small>The screenshot couldn’t be loaded.</Small>;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="Open the screenshot full size"
      onPress={() => url && openLink(url)}
      style={{ width: 96, height: 96, borderRadius: radius.sm, backgroundColor: colors.steel, overflow: 'hidden' }}
    >
      {url ? <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={120} /> : null}
    </Pressable>
  );
}

/** "App feedback" on the Board screen, for the keepers. */
export function AppFeedbackSection({ onDone }: { onDone: (msg: string) => void }) {
  const { me, data } = useClub();
  const { ready, feedback, loadError, answer, screenshotUrl } = useFeedback();
  if (!isFeedbackKeeper(me, data.positions)) return null;
  const open = feedback.filter((f) => f.status !== 'done');
  return (
    <>
      <SectionTitle title="App feedback" action={<Small>{open.length}</Small>} />
      {loadError ? (
        <Notice tone="danger">{loadError}</Notice>
      ) : !ready ? (
        <Card>
          <Small>Loading…</Small>
        </Card>
      ) : feedback.length === 0 ? (
        <Card>
          <Small>Nobody has sent feedback yet. Members send it from Me › Feedback & issues.</Small>
        </Card>
      ) : (
        feedback.map((f) => <KeeperCard key={f.id} report={f} onDone={onDone} answer={answer} screenshotUrl={screenshotUrl} />)
      )}
    </>
  );
}

function KeeperCard({
  report,
  onDone,
  answer,
  screenshotUrl,
}: {
  report: Feedback;
  onDone: (msg: string) => void;
  answer: (id: string, status: string, reply: string) => Promise<void>;
  screenshotUrl: (p: string) => Promise<string>;
}) {
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = report.status === 'done';
  const first = report.memberName.split(' ')[0];

  const email = () => {
    setError(null);
    const to = feedbackMailto(report);
    if (!to) return setError('No email address on file for them.');
    Linking.openURL(to).catch(() => setError(`This device can’t open mail from here. Write to ${report.memberEmail}.`));
  };
  const save = (status: FeedbackStatus, words: string, said: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    answer(report.id, status, words)
      .then(() => {
        setReply('');
        onDone(said);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Card style={done ? { opacity: 0.7 } : undefined}>
      <ReportHeader report={report} who={report.memberName} />
      <View style={{ borderLeftWidth: 2, borderLeftColor: colors.lineStrong, paddingLeft: space.md }}>
        <Body selectable>{report.body}</Body>
      </View>
      {report.screenshotPath ? <Screenshot path={report.screenshotPath} screenshotUrl={screenshotUrl} /> : null}
      <Small>Sent with: {deviceLine(report)}</Small>
      <Reply report={report} />
      <Field
        label={report.reply ? 'New reply' : 'Reply'}
        value={reply}
        onChangeText={setReply}
        multiline
        placeholder="What you found, or what happens next"
        maxLength={FEEDBACK_REPLY_MAX}
        hint={`${first} gets it as a notification.`}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Row style={{ gap: space.sm }}>
        <Button
          label="Send reply"
          icon="send"
          style={{ flex: 1 }}
          disabled={!reply.trim()}
          busy={busy}
          onPress={() => save(report.status === 'new' ? 'looking' : report.status, reply, `Reply sent to ${first}.`)}
          accessibilityLabel={`Send a reply to ${report.memberName}`}
        />
        <Button label="Email" kind="secondary" icon="mail" onPress={email} accessibilityLabel={`Email ${report.memberName}`} />
      </Row>
      <Row style={{ gap: space.sm }}>
        {report.status !== 'looking' ? (
          <Button label="Looking into it" kind="secondary" size="small" icon="search" disabled={busy} onPress={() => save('looking', reply, `${first}’s report: looking into it.`)} accessibilityLabel={`Mark ${report.memberName}’s report looking into it`} />
        ) : null}
        {!done ? (
          <Button label="Done" kind="secondary" size="small" icon="checkmark" disabled={busy} onPress={() => save('done', reply, `${first}’s report is done.`)} accessibilityLabel={`Mark ${report.memberName}’s report done`} />
        ) : (
          <Button label="Reopen" kind="quiet" size="small" icon="refresh" disabled={busy} onPress={() => save('new', reply, `${first}’s report is open again.`)} accessibilityLabel={`Reopen ${report.memberName}’s report`} />
        )}
      </Row>
    </Card>
  );
}
