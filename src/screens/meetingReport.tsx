// The Treasurer's Report for a meeting, laid out like Jeff's October 2026 report: pick the period,
// read the cash position, each fund, the months, the read-out, receipts and payments and the
// checks, write the notes, then save it, share it as a PDF and present it to members (13.8).

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { reportAssets, shareReportPdf } from '../data/reportPdf';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { formatCents } from '../domain/fees';
import { CODE_LABEL, fundKey, fundName, keepsBooks, seesAnyLedger, seesReports } from '../domain/ledger';
import {
  bankCents, defaultPeriod, figuresFor, meetingChecks, meetingFigures, meetingLines, meetingProblem, monthName, monthRowLabel,
  MR_NOTES, MR_NOTES_MAX, preparedBy, readOut, readsEveryFund,
} from '../domain/meetingReport';
import { meetingReportHtml } from '../domain/meetingReportHtml';
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
          <Line label={CODE_LABEL[c.code]}>
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

function Figures({ f, lines, data }: { f: MeetingFigures; lines?: Partial<Record<LedgerCode, LedgerEntry[]>>; data: Parameters<typeof fundName>[1] }) {
  const [each, setEach] = useState<'totals' | 'lines'>('totals');
  const shown = each === 'lines' ? lines : undefined;
  const change = bankCents(f, 'closing') - bankCents(f, 'opening');
  const funds = [...data.chapters.map((c) => c.id), null];
  return (
    <>
      <Card>
        <H2>Cash position</H2>
        <Line label={`Opening bank balance at ${formatAuDate(f.from)}`}>
          <Amount cents={bankCents(f, 'opening')} />
        </Line>
        <Line label="Receipts">
          <Amount cents={f.receiptsCents} />
        </Line>
        <Line label="Payments">
          <Amount cents={f.paymentsCents} out />
        </Line>
        <Divider />
        <Line label={`In the bank at ${formatAuDate(f.to)}`} strong>
          <Text style={[type.h2, num]}>{formatCents(bankCents(f, 'closing'))}</Text>
        </Line>
        <Line label="Recorded cash float">
          <Amount cents={f.floatCents} />
        </Line>
        <Line label="Total recorded cash funds" strong>
          <Amount cents={f.closingCents} strong />
        </Line>
        <Small>
          {change === 0
            ? 'The bank balance didn’t change over the period.'
            : `The bank balance ${change > 0 ? 'increased' : 'decreased'} by ${formatCents(Math.abs(change))} over the period.`}
        </Small>
      </Card>

      <Card>
        <H2>Funds</H2>
        {funds.map((id) => {
          const m = f.funds[fundKey(id)] ?? { openingCents: 0, receiptsCents: 0, paymentsCents: 0, closingCents: 0 };
          return (
            <View key={fundKey(id)} style={{ gap: 2 }}>
              <Line label={id === null ? 'Club / shared funds' : `${fundName(id, data)} Chapter`}>
                <Amount cents={m.closingCents} />
              </Line>
              <Small>{`Opened ${formatCents(m.openingCents)} · in ${formatCents(m.receiptsCents)} · out ${formatCents(m.paymentsCents)}`}</Small>
            </View>
          );
        })}
        <Divider />
        <Line label="Total" strong>
          <Amount cents={f.closingCents} strong />
        </Line>
        <Small>Allocations within the one bank account, not separate balances. The Club fund holds the cash float.</Small>
      </Card>

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

      {lines ? (
        <Choices<'totals' | 'lines'>
          label="Receipts and payments"
          options={[
            { value: 'totals', label: 'Totals' },
            { value: 'lines', label: 'Each line' },
          ]}
          value={each}
          onChange={setEach}
        />
      ) : null}
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
  const { me, data, today, saveMeetingReport, presentMeetingReport, deleteMeetingReport } = useClub();
  const id = route.params?.id ?? null;
  const report = id ? (data.meetingReports ?? []).find((r) => r.id === id) : undefined;
  const keeper = keepsBooks(me, null, data.positions);
  const start = report ?? defaultPeriod(data, today);
  const from = useDate(start.fromOn);
  const to = useDate(start.toOn);
  const [notes, setNotes] = useState(report?.notes ?? '');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<'save' | 'pdf' | null>(null);

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

  const pdf = async () => {
    if (!figures) return;
    setBusy('pdf');
    setMsg(null);
    try {
      const assets = await reportAssets();
      const html = meetingReportHtml({
        figures,
        data,
        notes,
        preparedBy: preparedBy(report?.presentedBy ?? report?.savedBy ?? me.id, data),
        preparedOn: report?.presentedAt ? report.presentedAt.slice(0, 10) : today,
        lines,
        ...assets,
      });
      await shareReportPdf(html, `Rustnuts Treasurer's Report ${figures.from} to ${figures.to}.pdf`);
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
          <Chip label={`Presented ${formatAuDate(report.presentedAt.slice(0, 10))}`} tone="ok" icon="checkmark" />
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

      {figures ? <Figures f={figures} lines={lines} data={data} /> : null}

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
          {report.notes.trim().split(/\n\s*\n/).map((p, i) => (
            <Body key={i}>{p.trim()}</Body>
          ))}
        </Card>
      ) : null}

      {figures ? <Checks f={figures} /> : null}

      <Stack gap={space.sm}>
        {editable ? (
          <Button label="Save draft" kind="secondary" icon="save-outline" busy={busy === 'save'} disabled={!!problem || !dirty} onPress={save} />
        ) : null}
        {figures ? (
          <Button label="Share as PDF" kind="secondary" icon="share-outline" busy={busy === 'pdf'} disabled={!!busy} onPress={pdf} />
        ) : null}
        {editable && report ? (
          dirty ? (
            <Small>Save the draft before presenting it.</Small>
          ) : (
            <ConfirmButton
              label="Present to members"
              confirmLabel="Present it"
              confirmNote="Every member can read it from Me, with your notes, and it can’t be changed after."
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
