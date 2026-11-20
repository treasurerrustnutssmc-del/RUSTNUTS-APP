// The Treasurer's Report for a meeting, laid out like Jeff's October 2026 report: pick the period,
// read the cash position, each fund, the months, the read-out, receipts and payments and the
// checks, write the notes, then save it, share it as a PDF and present it to members (13.8). The
// treasurer can also attach their own PDF to a draft, which members open once it's presented.

import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { reportAssets, shareReportPdf } from '../data/reportPdf';
import { pickReportPdf } from '../data/reportPdfFile';
import { openLink } from '../ui/openLink';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { formatCents } from '../domain/fees';
import { CODE_LABEL, fundName, keepsBooks, seesAnyLedger, seesReports } from '../domain/ledger';
import {
  defaultPeriod, figuresFor, meetingChecks, meetingFigures, meetingLines, meetingProblem, monthName, monthRowLabel,
  MR_NOTES, MR_NOTES_MAX, preparedBy, readOut, readsEveryFund,
} from '../domain/meetingReport';
import { meetingReportFullHtml } from '../domain/meetingReportFullHtml';
import { meetingReportHtml } from '../domain/meetingReportHtml';
import { meetingStatement, noteParagraphs } from '../domain/meetingStatement';
import { melbourneDate, melbourneDateShown } from '../domain/rides';
import type { LedgerCode, LedgerEntry, MeetingFigures } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import {
  Body, Button, Card, Chip, Choices, ConfirmButton, Divider, Field, H1, H2, Ionicons, Notice, Row, Screen, Small, Stack,
} from '../ui/primitives';

type Msg = { tone: 'ok' | 'danger'; text: string } | null;
const num = { fontVariant: ['tabular-nums' as const] };

function useDate(initial: string) {
  const [text, setRaw] = useState(formatAuDate(initial));
  const iso = parseAuDate(text.trim());
  return { text, setText: (t: string) => setRaw(typeDate(t)), iso, error: text.trim() && !iso ? 'Use DD/MM/YYYY, like 21/10/2026.' : null };
}

function Amount({ cents, strong, out }: { cents: number; strong?: boolean; out?: boolean }) {
  return <Text style={[type.name, num, !strong && { color: colors.boneDim }]}>{out ? `(${formatCents(cents)})` : formatCents(cents)}</Text>;
}

function Line({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between', gap: space.md, flexWrap: 'nowrap' }}>
      {strong ? <Text style={[type.name, { flexShrink: 1 }]}>{label}</Text> : <Body style={{ flexShrink: 1 }}>{label}</Body>}
      {children}
    </Row>
  );
}

function CodeCard({ title, codes, total, lines }: {
  title: string; codes: { code: LedgerCode; cents: number }[]; total: number; lines?: Partial<Record<LedgerCode, LedgerEntry[]>>;
}) {
  const used = codes.filter((c) => c.cents > 0).sort((a, b) => b.cents - a.cents || a.code.localeCompare(b.code));
  return (
    <Card>
      <H2>{title}</H2>
      {used.length === 0 ? <Small>Nothing in this period.</Small> : null}
      {used.map((c) => (
        <View key={c.code} style={{ gap: 2 }}>
          <Line label={CODE_LABEL[c.code] ?? c.code}>
            <Amount cents={c.cents} />
          </Line>
          {(lines?.[c.code] ?? []).map((e) => (
            <Row key={e.id} style={{ justifyContent: 'space-between', gap: space.md, paddingLeft: space.md, flexWrap: 'nowrap' }}>
              <Small style={{ flexShrink: 1 }}>{`${formatAuDate(e.entryOn)} · ${e.description}`}</Small>
              <Small style={num}>{formatCents(e.amountCents)}</Small>
            </Row>
          ))}
        </View>
      ))}
      <Divider />
      <Line label={`Total ${title.toLowerCase()}`} strong>
        <Amount cents={total} strong />
      </Line>
    </Card>
  );
}

/** The statement every reader sees, as on Jeff's report. */
function Statement({ f, data, meetingOn }: { f: MeetingFigures; data: Parameters<typeof fundName>[1]; meetingOn: string }) {
  const s = meetingStatement(f, data, meetingOn);
  return (
    <Card>
      <Stack gap={2}>
        <H2>{s.title}</H2>
        <Text style={type.name}>{s.subtitle}</Text>
        <Small>{s.period}</Small>
      </Stack>
      <View style={{ gap: 2 }}>
        {s.rows.map((r, i) => (
          <View key={r.label} style={r.kind !== 'item' && i > 0 ? { marginTop: space.sm } : undefined}>
            {r.kind === 'item' ? (
              <Line label={r.label}>
                <Amount cents={r.cents ?? 0} />
              </Line>
            ) : (
              <Line label={r.label} strong>
                {r.cents === null ? null : <Amount cents={r.cents} strong />}
              </Line>
            )}
          </View>
        ))}
      </View>
    </Card>
  );
}

/** The workings, for whoever reads every fund's lines: each line, the months and the read-out. */
function Workings({ f, lines }: { f: MeetingFigures; lines: Partial<Record<LedgerCode, LedgerEntry[]>> }) {
  const [each, setEach] = useState<'totals' | 'lines'>('totals');
  const shown = each === 'lines' ? lines : undefined;
  return (
    <>
      <Small>Only you see the workings below, and “Share the full workings” puts them in a PDF. Members see the statement above, your notes and your PDF.</Small>
      <Card>
        <H2>Month by month</H2>
        {f.months.map((m) => {
          const net = m.receiptsCents - m.paymentsCents;
          return (
            <View key={m.month} style={{ gap: 2 }}>
              <Line label={monthRowLabel(m)}>
                <Text style={[type.name, num, { color: net < 0 ? colors.boneDim : colors.bone }]}>{`${net > 0 ? '+' : ''}${formatCents(net)}`}</Text>
              </Line>
              <Small>{`In ${formatCents(m.receiptsCents)} · out ${formatCents(m.paymentsCents)}`}</Small>
            </View>
          );
        })}
      </Card>

      <Card>
        <H2>Meeting read-out</H2>
        <Body style={{ fontStyle: 'italic' }}>{`“${readOut(f)}”`}</Body>
      </Card>

      <Choices<'totals' | 'lines'>
        label="Receipts and payments"
        options={[
          { value: 'totals', label: 'Totals' },
          { value: 'lines', label: 'Each line' },
        ]}
        value={each}
        onChange={setEach}
      />
      <CodeCard title="Receipts" codes={f.credits} total={f.receiptsCents} lines={shown} />
      <CodeCard title="Payments" codes={f.debits} total={f.paymentsCents} lines={shown} />
    </>
  );
}

function Checks({ f }: { f: MeetingFigures }) {
  return (
    <Card>
      <H2>Basis and checks</H2>
      <Small>{`Worked out from ${f.lineCount} paid line${f.lineCount === 1 ? '' : 's'} dated ${formatAuDate(f.from)} to ${formatAuDate(f.to)}.`}</Small>
      {meetingChecks(f).map((c) => (
        <Row key={c.label} style={{ gap: space.sm, alignItems: 'flex-start' }}>
          <Ionicons name={c.ok ? 'checkmark-circle' : 'warning'} size={18} color={c.ok ? colors.ok : colors.danger} style={{ marginTop: 2 }} />
          <Body style={{ flex: 1 }}>{c.ok ? c.label : `Check failed: ${c.label}`}</Body>
        </Row>
      ))}
      <Small>Unaudited cash movement only. It doesn’t check cash on hand, the bank statement, stock, assets or unpaid bills.</Small>
    </Card>
  );
}

export function MeetingReportScreen({ route, navigation }: RootScreen<'MeetingReport'>) {
  const {
    me, data, today, saveMeetingReport, presentMeetingReport, deleteMeetingReport, attachMeetingReportPdf, removeMeetingReportPdf, meetingReportPdfUrl,
  } = useClub();
  const id = route.params?.id ?? null;
  const report = id ? (data.meetingReports ?? []).find((r) => r.id === id) : undefined;
  const keeper = keepsBooks(me, null, data.positions);
  const start = report ?? defaultPeriod(data, today);
  const from = useDate(start.fromOn);
  const to = useDate(start.toOn);
  const [notes, setNotes] = useState(report?.notes ?? '');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<'save' | 'pdf' | 'full' | 'attach' | 'open' | null>(null);

  const allowed = report
    ? report.presentedAt ? seesReports(me) || seesAnyLedger(me, data) : keeper
    : !id && keeper;
  if (!me || !allowed) {
    return (
      <Screen>
        <Notice tone="info">{id && !report ? 'That report isn’t here any more.' : 'This report hasn’t been presented to members yet.'}</Notice>
      </Screen>
    );
  }

  const editable = keeper && !report?.presentedAt;
  const input = { fromOn: from.iso ?? '', toOn: to.iso ?? '', notes };
  const problem = editable ? meetingProblem(me, report?.id ?? null, input, data, today) : null;
  const rangeOk = !!from.iso && !!to.iso && (problem === null || problem === MR_NOTES);
  const local = readsEveryFund(me, data);
  const fromOn = editable && rangeOk ? input.fromOn : report?.fromOn;
  const toOn = editable && rangeOk ? input.toOn : report?.toOn;
  // Whoever reads every fund works it out here; anyone else sees the database's figures as last saved.
  const figures = fromOn && toOn ? (local ? meetingFigures(fromOn, toOn, data) : report ? figuresFor(report, data) : null) : null;
  const lines = local && figures ? meetingLines(figures.from, figures.to, data) : undefined;
  const dirty = !report || report.fromOn !== input.fromOn || report.toOn !== input.toOn || report.notes !== notes;
  const meetingOn = report?.presentedAt ? melbourneDate(report.presentedAt) : today;
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: (e as Error).message });

  const save = () => {
    setBusy('save');
    setMsg(null);
    saveMeetingReport(report?.id ?? null, input)
      .then((saved) => {
        setMsg({ tone: 'ok', text: 'Draft saved.' });
        if (!report) navigation.setParams({ id: saved });
      }, fail)
      .finally(() => setBusy(null));
  };

  const attach = async () => {
    if (!report || busy) return;
    setMsg(null);
    // Busy from the tap, so a second tap can't open a second picker (iOS refuses that). On the web
    // a backed-out chooser may never report, so the web build frees the button once it's open.
    setBusy('attach');
    try {
      const picking = pickReportPdf();
      if (Platform.OS === 'web') setBusy(null);
      const file = await picking;
      if (!file) return;
      setBusy('attach');
      await attachMeetingReportPdf(report.id, file);
      setMsg({ tone: 'ok', text: 'Your PDF is attached.' });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const openOwn = async () => {
    if (!report?.pdfPath) return;
    setBusy('open');
    setMsg(null);
    // The web build opens the tab during the tap (browsers block one opened after a wait) and
    // points it at the signed address once it comes back. Phones use the in-app browser sheet.
    const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
    try {
      const url = await meetingReportPdfUrl(report.pdfPath);
      if (tab) tab.location.href = url;
      else await openLink(url);
    } catch (e) {
      tab?.close();
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  // The members' one-page statement, or (for whoever reads every fund) the full workings.
  const pdf = async (kind: 'pdf' | 'full') => {
    if (!figures) return;
    setBusy(kind);
    setMsg(null);
    try {
      const assets = await reportAssets();
      const html = kind === 'full'
        ? meetingReportFullHtml({
          figures,
          data,
          notes,
          preparedBy: preparedBy(report?.presentedBy ?? report?.savedBy ?? me.id, data),
          preparedOn: meetingOn,
          lines,
          ...assets,
        })
        : meetingReportHtml({ figures, data, notes, meetingOn, ...assets });
      const name = kind === 'full' ? 'Treasurer\'s workings' : 'Treasurer\'s Report';
      await shareReportPdf(html, `Rustnuts ${name} ${figures.from} to ${figures.to}.pdf`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const title = figures ? `${monthName(figures.to)} ${figures.to.slice(0, 4)}` : 'New report';
  const changedSince = report?.presentedAt && figures?.lastChangeAt && figures.lastChangeAt > report.presentedAt;

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>{title}</H1>
        {figures ? <Small>{`Reporting period ${formatAuDate(figures.from)} to ${formatAuDate(figures.to)}`}</Small> : null}
        {report?.presentedAt ? (
          <Chip label={`Presented ${melbourneDateShown(report.presentedAt)}`} tone="ok" icon="checkmark" />
        ) : report ? (
          <Chip label="Draft" tone="warn" />
        ) : null}
      </Stack>

      {editable ? (
        <Card>
          <Row style={{ gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Field label="From" value={from.text} onChangeText={from.setText} keyboardType="number-pad" placeholder="DD/MM/YYYY" error={from.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="To" value={to.text} onChangeText={to.setText} keyboardType="number-pad" placeholder="DD/MM/YYYY" error={to.error} />
            </View>
          </Row>
          {problem && problem !== MR_NOTES && !from.error && !to.error ? <Notice tone="warn">{problem}</Notice> : null}
        </Card>
      ) : null}

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {changedSince ? (
        <Notice tone="warn" title="Changed since it was presented">
          A line in this period was changed after the report went to members. The figures below are today’s.
        </Notice>
      ) : null}
      {editable && !local && report ? (
        <Small>You don’t read every fund’s lines, so these are the figures as last saved. Save to bring them up to date.</Small>
      ) : null}
      {editable && !local && !report ? <Notice tone="info">Save the draft to work out the figures.</Notice> : null}

      {figures ? <Statement f={figures} data={data} meetingOn={meetingOn} /> : null}

      {editable ? (
        <Card>
          <H2>Treasurer’s notes</H2>
          <Field
            label="Notes for the meeting"
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={MR_NOTES_MAX}
            placeholder="Membership and payment classification, anything to follow up"
            hint="Members read these once it’s presented. A blank line starts a new paragraph."
            error={problem === MR_NOTES ? MR_NOTES : null}
          />
        </Card>
      ) : report?.notes.trim() ? (
        <Card>
          <H2>Treasurer’s notes</H2>
          {noteParagraphs(report.notes).map((p, i) => (
            <Body key={i}>
              {p.lead ? <Text style={{ fontWeight: '700' }}>{`${p.lead} `}</Text> : null}
              {p.text}
            </Body>
          ))}
        </Card>
      ) : null}

      {editable || report?.pdfPath ? (
        <Card>
          <H2>{editable ? 'Your own PDF' : 'The treasurer’s PDF'}</H2>
          {!report ? (
            <Small>Save the draft first, then attach your PDF.</Small>
          ) : report.pdfPath && report.pdfName ? (
            <Row style={{ gap: space.sm, alignItems: 'center' }}>
              <Ionicons name="document-text-outline" size={20} color={colors.boneMute} />
              <Text style={[type.name, { flex: 1 }]} numberOfLines={2}>{report.pdfName}</Text>
            </Row>
          ) : (
            <Small>Made your report somewhere else? Attach the PDF here and members can open it once it’s presented.</Small>
          )}
          {report?.pdfPath ? (
            editable ? (
              <Row style={{ gap: space.sm }}>
                <Button style={{ flex: 1 }} label="Open" kind="secondary" icon="open-outline" busy={busy === 'open'} disabled={!!busy} onPress={openOwn} />
                <Button style={{ flex: 1 }} label="Replace" kind="secondary" icon="attach-outline" busy={busy === 'attach'} disabled={!!busy} onPress={attach} />
              </Row>
            ) : (
              <Button label="Open the PDF" kind="secondary" icon="open-outline" busy={busy === 'open'} disabled={!!busy} onPress={openOwn} />
            )
          ) : editable && report ? (
            <Button label="Attach a PDF" kind="secondary" icon="attach-outline" busy={busy === 'attach'} disabled={!!busy} onPress={attach} />
          ) : null}
          {editable && report?.pdfPath ? (
            <ConfirmButton
              label="Remove the PDF"
              confirmLabel="Remove it"
              confirmNote="The PDF comes off this draft. The report and the books don’t change."
              icon="trash-outline"
              disabled={!!busy}
              onConfirm={() => removeMeetingReportPdf(report.id).then(() => setMsg({ tone: 'ok', text: 'PDF removed.' }), fail)}
            />
          ) : null}
          {editable && report ? <Small>PDF only, up to 10 MB. It’s locked with the report once you present it.</Small> : null}
        </Card>
      ) : null}

      {figures && lines ? <Workings f={figures} lines={lines} /> : null}
      {figures && lines ? <Checks f={figures} /> : null}

      <Stack gap={space.sm}>
        {editable ? (
          <Button label="Save draft" kind="secondary" icon="save-outline" busy={busy === 'save'} disabled={!!problem || !dirty} onPress={save} />
        ) : null}
        {figures ? (
          <Button label="Share as PDF" kind="secondary" icon="share-outline" busy={busy === 'pdf'} disabled={!!busy || (editable && !local && dirty)} onPress={() => pdf('pdf')} />
        ) : null}
        {figures && lines ? (
          <Button label="Share the full workings" kind="secondary" icon="document-text-outline" busy={busy === 'full'} disabled={!!busy} onPress={() => pdf('full')} />
        ) : null}
        {editable && report ? (
          dirty ? (
            <Small>Save the draft before presenting it.</Small>
          ) : (
            <ConfirmButton
              label="Present to members"
              confirmLabel="Present it"
              confirmNote={`Every member can read it from Me, with your notes${report.pdfPath ? ' and your PDF' : ''}, and it can’t be changed after.`}
              icon="megaphone-outline"
              kind="primary"
              onConfirm={() => presentMeetingReport(report.id).then(() => setMsg({ tone: 'ok', text: 'Presented. Members can read it from Me.' }), fail)}
            />
          )
        ) : null}
        {editable && report ? (
          <ConfirmButton
            label="Delete draft"
            confirmLabel="Delete it"
            confirmNote="The draft and its notes go. The books don’t change."
            icon="trash-outline"
            onConfirm={() => deleteMeetingReport(report.id).then(() => navigation.goBack(), fail)}
          />
        ) : null}
      </Stack>
    </Screen>
  );
}
