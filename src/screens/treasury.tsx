// Treasury: the funds' books, spending that needs two approvals (13.3), the monthly Treasurer's
// Report and the budgets (13.4), and the presented reports every member can read (13.8).

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { fyLabel, fyOf, formatCents, parseDollars } from '../domain/fees';
import {
  addFeeProblem,
  approveBudgetProblem,
  approveProblem,
  approvesFor,
  BANK_FEES,
  bankedLate,
  budgetLines,
  budgetOf,
  budgetVoteFits,
  CODE_LABEL,
  CREDIT_CODES,
  DEBIT_CODES,
  feesToAdd,
  floatFor,
  fundBalance,
  fundKey,
  fundName,
  isCredit,
  keepsBooks,
  monthEnd,
  monthOf,
  needsMyApproval,
  payProblem,
  presentProblem,
  reopenBudgetProblem,
  reportFor,
  seesAnyLedger,
  seesLedger,
  seesReports,
  updatedSince,
  voidProblem,
} from '../domain/ledger';
import { displayName } from '../domain/profile';
import type { EntryState, LedgerCode, LedgerEntry } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import {
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Divider,
  Field,
  H1,
  H2,
  IconBadge,
  Ionicons,
  KeyValue,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
} from '../ui/primitives';

type Nav = NavigationProp<RootParams>;
type Msg = { tone: 'ok' | 'danger'; text: string } | null;

/** Funds travel between screens by key: 'club' or a chapter id. */
const fundOf = (key: string): string | null => (key === 'club' ? null : key);
const num = { fontVariant: ['tabular-nums' as const] };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

const STATE_CHIP: Record<EntryState, { label: string; tone: 'ok' | 'warn' | 'steel' | 'bone' }> = {
  paid: { label: 'Paid', tone: 'ok' },
  approved: { label: 'Approved', tone: 'bone' },
  awaiting: { label: 'Needs approval', tone: 'warn' },
  void: { label: 'Void', tone: 'steel' },
};

const signedCents = (e: LedgerEntry) => (isCredit(e.code) ? formatCents(e.amountCents) : `−${formatCents(e.amountCents)}`);

function StepButton({ icon, label, disabled, onPress }: { icon: 'chevron-back' | 'chevron-forward'; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: pressed ? colors.steel : 'transparent', opacity: disabled ? 0.35 : 1 })}
    >
      <Ionicons name={icon} size={22} color={colors.bone} />
    </Pressable>
  );
}

/** Back and forward a month at a time, never past `latest`. */
function MonthStepper({ month, latest, onChange }: { month: string; latest: string; onChange: (month: string) => void }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <StepButton icon="chevron-back" label="Earlier month" disabled={false} onPress={() => onChange(addMonths(month, -1))} />
      <Text style={type.name}>{monthLabel(month)}</Text>
      <StepButton icon="chevron-forward" label="Later month" disabled={month >= latest} onPress={() => onChange(addMonths(month, 1))} />
    </Row>
  );
}

function useDate(initial: string) {
  const [text, setRaw] = useState(formatAuDate(initial));
  const iso = parseAuDate(text.trim());
  return { text, setText: (t: string) => setRaw(typeDate(t)), iso, error: text.trim() && !iso ? 'Use DD/MM/YYYY, like 08/11/2026.' : null };
}

function Amount({ cents, strong }: { cents: number; strong?: boolean }) {
  return <Text style={[type.name, num, !strong && { color: colors.boneDim }]}>{formatCents(cents)}</Text>;
}

function EntryRow({ entry, last, onPress }: { entry: LedgerEntry; last: boolean; onPress: () => void }) {
  const chip = STATE_CHIP[entry.state];
  return (
    <ListRow
      last={last}
      title={<Text style={[type.name, entry.state === 'void' && { color: colors.boneMute, textDecorationLine: 'line-through' }]} numberOfLines={1}>{entry.description}</Text>}
      subtitle={[CODE_LABEL[entry.code], entry.entryOn ? formatAuDate(entry.entryOn) : null, entry.state === 'paid' ? null : chip.label].filter(Boolean).join(' · ')}
      right={<Text style={[type.name, num, { color: isCredit(entry.code) ? colors.bone : colors.boneDim }]}>{signedCents(entry)}</Text>}
      onPress={onPress}
    />
  );
}

// ---------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------

export function TreasuryScreen({ navigation }: RootScreen<'Treasury'>) {
  const { me, data, today, addFeePayment, setCashFloat } = useClub();
  const [msg, setMsg] = useState<Msg>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!me || !seesAnyLedger(me, data)) {
    return (
      <Screen>
        <Notice tone="info">Only the treasurers, the boards and the National Auditor see the books.</Notice>
      </Screen>
    );
  }
  const funds = [null, ...data.chapters.map((c) => c.id)].filter((f) => seesLedger(me, f, data.positions));
  const kept = funds.filter((f) => keepsBooks(me, f, data.positions));
  const waiting = needsMyApproval(me, data);
  const fees = feesToAdd(me, data);
  const lastMonth = addMonths(monthOf(today), -1);
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: (e as Error).message });
  const memberName = (id: string) => {
    const m = data.members.find((x) => x.id === id);
    return m ? displayName(m) : 'Member';
  };

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Treasury</H1>
        <Small>{`${fyLabel(fyOf(today))} · balances as of today`}</Small>
      </Stack>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      {waiting.length > 0 ? (
        <>
          <SectionTitle title="Needs your approval" action={<Text style={[type.name, { color: colors.boneMute }]}>{waiting.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {waiting.map((e, i) => (
              <ListRow
                key={e.id}
                last={i === waiting.length - 1}
                left={<IconBadge icon="hand-left-outline" tone="red" />}
                title={e.description}
                subtitle={`${fundName(e.chapterId, data)} · ${e.payeeName ?? (e.payeeMemberId ? memberName(e.payeeMemberId) : '')} · ${e.approvals.length} of 2`}
                right={<Text style={[type.name, num]}>{formatCents(e.amountCents)}</Text>}
                onPress={() => navigation.navigate('LedgerEntry', { entryId: e.id })}
              />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle title="Funds" />
      <Card style={{ padding: 0, gap: 0 }}>
        {funds.map((f, i) => (
          <ListRow
            key={fundKey(f)}
            last={i === funds.length - 1}
            left={<IconBadge icon={f === null ? 'shield-outline' : 'flag-outline'} />}
            title={fundName(f, data)}
            subtitle={keepsBooks(me, f, data.positions) ? 'You keep these books' : approvesFor(me, f, data.positions) ? 'You approve spending' : 'Read only'}
            right={<Text style={[type.name, num]}>{formatCents(fundBalance(f, today, data))}</Text>}
            onPress={() => navigation.navigate('Ledger', { fund: fundKey(f) })}
          />
        ))}
      </Card>

      {kept.length > 0 ? (
        <Row style={{ gap: space.sm }}>
          <Button style={{ flex: 1 }} label="Money in" kind="secondary" icon="arrow-down" onPress={() => navigation.navigate('NewEntry', { kind: 'credit' })} />
          <Button style={{ flex: 1 }} label="Money out" kind="secondary" icon="arrow-up" onPress={() => navigation.navigate('NewEntry', { kind: 'debit' })} />
        </Row>
      ) : null}

      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          left={<IconBadge icon="document-text-outline" />}
          title="Treasurer’s Report"
          subtitle={`${monthLabel(lastMonth)}${(data.treasurerReports ?? []).some((r) => r.month === lastMonth) ? ' · presented' : ''}`}
          onPress={() => navigation.navigate('MonthReport', { month: lastMonth })}
        />
        <ListRow
          last
          left={<IconBadge icon="pie-chart-outline" />}
          title="Budgets"
          subtitle={fyLabel(fyOf(today))}
          onPress={() => navigation.navigate('Budget', { fund: fundKey(funds[0]) })}
        />
      </Card>

      {fees.length > 0 ? (
        <>
          <SectionTitle title="Fees to add" action={<Text style={[type.name, { color: colors.boneMute }]}>{fees.length}</Text>} />
          <Small>Confirmed fee payments that aren’t in the ledger yet. Each goes in as Member fees on the day it was paid.</Small>
          <Card style={{ padding: 0, gap: 0 }}>
            {fees.map(({ payment, chapterId, memberId }, i) => (
              <ListRow
                key={payment.id}
                last={i === fees.length - 1}
                title={memberName(memberId)}
                subtitle={`${fundName(chapterId, data)} · paid ${formatAuDate(payment.paidOn)} · ${formatCents(payment.amountCents)}`}
                right={
                  <Button
                    label="Add"
                    kind="quiet"
                    icon="add"
                    busy={busyId === payment.id}
                    disabled={addFeeProblem(me, payment.id, data) !== null}
                    accessibilityLabel={`Add ${memberName(memberId)}’s fees to the ledger`}
                    onPress={() => {
                      if (busyId) return;
                      setBusyId(payment.id);
                      addFeePayment(payment.id)
                        .then(() => setMsg({ tone: 'ok', text: 'Added to the ledger.' }), fail)
                        .finally(() => setBusyId(null));
                    }}
                  />
                }
              />
            ))}
          </Card>
        </>
      ) : null}

      {kept.includes(null) ? <FloatCard fy={fyOf(today)} current={floatFor(fyOf(today), data)} onSave={(c) => setCashFloat(fyOf(today), c).then(() => setMsg({ tone: 'ok', text: 'Cash float saved.' }), fail)} /> : null}
    </Screen>
  );
}

function FloatCard({ fy, current, onSave }: { fy: number; current: number; onSave: (cents: number) => Promise<void> }) {
  const [text, setText] = useState((current / 100).toFixed(2).replace(/\.00$/, ''));
  const [busy, setBusy] = useState(false);
  const cents = text.trim() === '0' ? 0 : parseDollars(text);
  return (
    <>
      <SectionTitle title="Cash float" />
      <Card>
        <Small>{`Cash held in the tin for ${fyLabel(fy)}. The report takes it off the total to show what’s in the bank.`}</Small>
        <Field label="Float" value={text} onChangeText={setText} keyboardType="decimal-pad" error={text.trim() && cents === null ? 'Enter an amount, like 400.' : null} />
        <Button
          label="Save float"
          kind="secondary"
          busy={busy}
          disabled={cents === null || cents === current}
          onPress={() => {
            setBusy(true);
            onSave(cents!).finally(() => setBusy(false));
          }}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// One fund's ledger
// ---------------------------------------------------------------------------

export function LedgerScreen({ route, navigation }: RootScreen<'Ledger'>) {
  const { me, data, today, setOpening } = useClub();
  const fund = fundOf(route.params.fund);
  const [month, setMonth] = useState(monthOf(today));
  const [msg, setMsg] = useState<Msg>(null);
  if (!me || !seesLedger(me, fund, data.positions)) {
    return (
      <Screen>
        <Notice tone="info">You can’t see this fund’s books.</Notice>
      </Screen>
    );
  }
  const entries = (data.ledger ?? []).filter((e) => e.chapterId === fund);
  const unpaid = entries.filter((e) => e.entryOn === null && e.state !== 'void');
  const end = monthEnd(month);
  const inMonth = entries
    .filter((e) => e.entryOn !== null && e.entryOn >= month && e.entryOn <= end)
    .sort((a, b) => (b.entryOn! + b.recordedAt).localeCompare(a.entryOn! + a.recordedAt));
  const keeper = keepsBooks(me, fund, data.positions);
  const fy = fyOf(today);
  const opening = (data.fundOpenings ?? []).find((o) => o.chapterId === fund && o.fy === fy);

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>{`${fundName(fund, data)} fund`}</H1>
        <Text style={[type.h2, num]}>{formatCents(fundBalance(fund, today, data))}</Text>
        <Small>Balance today</Small>
      </Stack>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      {unpaid.length > 0 ? (
        <>
          <SectionTitle title="Not paid yet" action={<Text style={[type.name, { color: colors.boneMute }]}>{unpaid.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {unpaid.map((e, i) => (
              <EntryRow key={e.id} entry={e} last={i === unpaid.length - 1} onPress={() => navigation.navigate('LedgerEntry', { entryId: e.id })} />
            ))}
          </Card>
        </>
      ) : null}

      <MonthStepper month={month} latest={monthOf(today)} onChange={setMonth} />
      <Card style={{ padding: 0, gap: 0 }}>
        {inMonth.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>Nothing paid or banked this month.</Small>
          </View>
        ) : (
          inMonth.map((e, i) => (
            <EntryRow key={e.id} entry={e} last={i === inMonth.length - 1} onPress={() => navigation.navigate('LedgerEntry', { entryId: e.id })} />
          ))
        )}
      </Card>
      <Small>{`Balance at ${formatAuDate(end)}: ${formatCents(fundBalance(fund, end, data))}`}</Small>

      {keeper ? (
        <OpeningCard
          key={`${fy}-${opening?.amountCents ?? 'none'}`}
          fy={fy}
          current={opening?.amountCents ?? null}
          onSave={(c) => setOpening(fund, fy, c).then(() => setMsg({ tone: 'ok', text: 'Opening balance saved.' }), (e) => setMsg({ tone: 'danger', text: (e as Error).message }))}
        />
      ) : null}
    </Screen>
  );
}

function OpeningCard({ fy, current, onSave }: { fy: number; current: number | null; onSave: (cents: number) => Promise<void> }) {
  const [text, setText] = useState(current === null ? '' : (current / 100).toFixed(2).replace(/\.00$/, ''));
  const [busy, setBusy] = useState(false);
  const negative = text.trim().startsWith('-');
  const dollars = parseDollars(negative ? text.trim().slice(1) : text);
  const cents = text.trim() === '0' ? 0 : dollars === null ? null : negative ? -dollars : dollars;
  return (
    <>
      <SectionTitle title="Opening balance" />
      <Card>
        <Small>{`What the fund held on 01/07/${fy}, from last year’s closing statement. Later years carry forward on their own.`}</Small>
        <Field label={`Opening for ${fyLabel(fy)}`} value={text} onChangeText={setText} keyboardType="numbers-and-punctuation" placeholder="2540" error={text.trim() && cents === null ? 'Enter an amount, like 2540.' : null} />
        <Button
          label="Save opening balance"
          kind="secondary"
          busy={busy}
          disabled={cents === null || cents === current}
          onPress={() => {
            setBusy(true);
            onSave(cents!).finally(() => setBusy(false));
          }}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// One entry
// ---------------------------------------------------------------------------

export function LedgerEntryScreen({ route }: RootScreen<'LedgerEntry'>) {
  const { me, data, today, approveDebit, payDebit, voidEntry } = useClub();
  const entry = (data.ledger ?? []).find((e) => e.id === route.params.entryId);
  const paidOn = useDate(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  if (!me || !entry || !seesLedger(me, entry.chapterId, data.positions)) {
    return (
      <Screen>
        <Notice tone="info">You can’t see this entry.</Notice>
      </Screen>
    );
  }
  const memberName = (id: string | null) => {
    const m = id ? data.members.find((x) => x.id === id) : undefined;
    return m ? displayName(m) : 'Someone';
  };
  const credit = isCredit(entry.code);
  const chip = STATE_CHIP[entry.state];
  const approveWhy = entry.state === 'awaiting' ? approveProblem(me, entry.id, data) : null;
  const canApprove = entry.state === 'awaiting' && approveWhy === null;
  const keeper = keepsBooks(me, entry.chapterId, data.positions);
  const run = (p: Promise<void>, text: string) => {
    setBusy(true);
    setMsg(null);
    p.then(() => setMsg({ tone: 'ok', text }), (e) => setMsg({ tone: 'danger', text: (e as Error).message })).finally(() => setBusy(false));
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md }}>
          <H1 style={{ flex: 1 }}>{entry.description}</H1>
          <Chip label={chip.label} tone={chip.tone} />
        </Row>
        <Text style={[type.h1, num, entry.state === 'void' && { color: colors.boneMute, textDecorationLine: 'line-through' }]}>{signedCents(entry)}</Text>
      </Stack>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {bankedLate(entry) ? (
        <Notice tone="warn" title="Banked late">
          Money has to be banked within five working days of coming in (13.1).
        </Notice>
      ) : null}
      {entry.state === 'void' ? <Notice tone="info" title="Void">{`${entry.voidReason ?? ''} It stays in the books and counts for nothing.`}</Notice> : null}

      <Card>
        <KeyValue label="Fund" value={fundName(entry.chapterId, data)} />
        <KeyValue label="Code" value={`${entry.code} ${CODE_LABEL[entry.code]}`} />
        {credit && entry.receivedOn ? <KeyValue label="Came in" value={formatAuDate(entry.receivedOn)} /> : null}
        <KeyValue label={credit ? 'Banked' : 'Paid'} value={entry.entryOn ? formatAuDate(entry.entryOn) : 'Not yet'} />
        {!credit ? <KeyValue label="Paid to" value={entry.payeeName ?? memberName(entry.payeeMemberId)} /> : null}
        <KeyValue label="Recorded by" value={`${memberName(entry.recordedBy)}, ${formatAuDate(entry.recordedAt.slice(0, 10))}`} />
      </Card>

      {!credit && entry.code !== BANK_FEES ? (
        <>
          <SectionTitle title="Approvals" action={<Text style={[type.name, num, { color: colors.boneMute }]}>{`${Math.min(entry.approvals.length, 2)} of 2`}</Text>} />
          <Card>
            {entry.approvals.length === 0 ? <Small>Nobody yet.</Small> : null}
            {entry.approvals.map((a) => (
              <Row key={a.memberId} style={{ justifyContent: 'space-between' }}>
                <Text style={type.name}>{memberName(a.memberId)}</Text>
                <Text style={[type.name, { color: colors.boneDim }]}>{formatAuDate(a.approvedAt.slice(0, 10))}</Text>
              </Row>
            ))}
            <Small>Two people approve spending before it’s paid, and the person being paid can’t be one of them (13.3).</Small>
            {canApprove ? <Button label="Approve this payment" icon="checkmark" busy={busy} onPress={() => run(approveDebit(entry.id), 'Approved.')} /> : null}
            {entry.state === 'awaiting' && approveWhy && approvesFor(me, entry.chapterId, data.positions) ? <Small>{approveWhy}</Small> : null}
          </Card>
        </>
      ) : null}

      {keeper && entry.state === 'approved' ? (
        <>
          <SectionTitle title="Pay it" />
          <Card>
            <Field label="Paid on" value={paidOn.text} onChangeText={paidOn.setText} keyboardType="number-pad" placeholder="DD/MM/YYYY" error={paidOn.error} />
            <Button
              label="Mark as paid"
              kind="secondary"
              icon="cash-outline"
              busy={busy}
              disabled={!paidOn.iso || payProblem(me, entry.id, paidOn.iso, data, today) !== null}
              onPress={() => run(payDebit(entry.id, paidOn.iso!), 'Marked as paid.')}
            />
            {paidOn.iso && payProblem(me, entry.id, paidOn.iso, data, today) ? <Small>{payProblem(me, entry.id, paidOn.iso, data, today)}</Small> : null}
          </Card>
        </>
      ) : null}

      {keeper && entry.state !== 'void' ? (
        <>
          <SectionTitle title="Void it" />
          <Card>
            <Small>A mistake is voided, never deleted. The line stays with your reason.</Small>
            <Field label="Why" value={reason} onChangeText={setReason} placeholder="Entered twice" />
            <ConfirmButton
              label="Void this entry"
              confirmLabel="Void it"
              kind="danger"
              disabled={voidProblem(me, entry.id, reason, data) !== null}
              onConfirm={() => run(voidEntry(entry.id, reason), 'Voided.')}
            />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// New entry
// ---------------------------------------------------------------------------

export function NewEntryScreen({ route, navigation }: RootScreen<'NewEntry'>) {
  const { me, data, today, recordCredit, recordDebit } = useClub();
  const kept = [null, ...data.chapters.map((c) => c.id)].filter((f) => keepsBooks(me, f, data.positions));
  const [kind, setKind] = useState<'credit' | 'debit'>(route.params?.kind ?? 'credit');
  const [fund, setFund] = useState<string>(fundKey(route.params?.fund ? fundOf(route.params.fund) : (kept.find((f) => f !== null) ?? kept[0] ?? null)));
  const [code, setCode] = useState<LedgerCode>(kind === 'credit' ? 'CR-001' : 'DB-001');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const received = useDate(today);
  const banked = useDate(today);
  const [payeeMode, setPayeeMode] = useState<'member' | 'other'>('other');
  const [payeeName, setPayeeName] = useState('');
  const [search, setSearch] = useState('');
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me || kept.length === 0) {
    return (
      <Screen>
        <Notice tone="info">Only a fund’s treasurer, or the National Chairman or Secretary, keeps its books.</Notice>
      </Screen>
    );
  }
  const chapterId = fundOf(fund);
  const cents = parseDollars(amount);
  const bank = kind === 'debit' && code === BANK_FEES;
  const codes = kind === 'credit' ? CREDIT_CODES : DEBIT_CODES;
  const matches =
    search.trim().length < 2
      ? []
      : data.members
          .filter((m) => m.approval === 'approved' && `${m.fullName} ${m.roadName ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
          .slice(0, 5);
  const payee = payeeId ? data.members.find((m) => m.id === payeeId) : undefined;

  const save = async () => {
    setError(null);
    if (cents === null) return setError('Enter an amount, like 250 or 125.50.');
    setBusy(true);
    try {
      const id =
        kind === 'credit'
          ? await recordCredit({ chapterId, code, description, amountCents: cents, receivedOn: received.iso, entryOn: banked.iso ?? '' })
          : await recordDebit({
              chapterId,
              code,
              description,
              amountCents: cents,
              payeeMemberId: !bank && payeeMode === 'member' ? payeeId : null,
              payeeName: bank ? null : payeeMode === 'member' ? null : payeeName,
              paidOn: bank ? banked.iso : null,
            });
      navigation.replace('LedgerEntry', { entryId: id });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Choices<'credit' | 'debit'>
        options={[
          { value: 'credit', label: 'Money in' },
          { value: 'debit', label: 'Money out' },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setCode(k === 'credit' ? 'CR-001' : 'DB-001');
        }}
      />
      {kept.length > 1 ? (
        <Choices<string> label="Fund" options={kept.map((f) => ({ value: fundKey(f), label: fundName(f, data) }))} value={fund} onChange={setFund} />
      ) : (
        <Small>{`${fundName(kept[0], data)} fund`}</Small>
      )}
      <Choices<LedgerCode> label="Code" options={codes.map((c) => ({ value: c, label: CODE_LABEL[c] }))} value={code} onChange={setCode} />
      <Field label="What it’s for" value={description} onChangeText={setDescription} placeholder={kind === 'credit' ? 'Raffle at the Toy Run' : 'Gazebo for events'} />
      <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="125.50" error={amount.trim() && cents === null ? 'Enter an amount, like 250 or 125.50.' : null} />

      {kind === 'credit' ? (
        <>
          <Field label="Came in on" value={received.text} onChangeText={received.setText} keyboardType="number-pad" placeholder="DD/MM/YYYY" error={received.error} hint="The day the cash or transfer reached the club." />
          <Field label="Banked on" value={banked.text} onChangeText={banked.setText} keyboardType="number-pad" placeholder="DD/MM/YYYY" error={banked.error} hint="Within five working days (13.1)." />
        </>
      ) : bank ? (
        <Field label="Taken on" value={banked.text} onChangeText={banked.setText} keyboardType="number-pad" placeholder="DD/MM/YYYY" error={banked.error} hint="Bank fees go straight in as paid." />
      ) : (
        <>
          <Choices<'member' | 'other'>
            label="Paid to"
            options={[
              { value: 'other', label: 'A business or person' },
              { value: 'member', label: 'A member' },
            ]}
            value={payeeMode}
            onChange={setPayeeMode}
          />
          {payeeMode === 'other' ? (
            <Field label="Who" value={payeeName} onChangeText={setPayeeName} placeholder="Bunnings Ringwood" />
          ) : payee ? (
            <Card style={{ padding: 0, gap: 0 }}>
              <ListRow last title={displayName(payee)} subtitle="Tap to change" onPress={() => setPayeeId(null)} />
            </Card>
          ) : (
            <>
              <Field label="Find the member" value={search} onChangeText={setSearch} placeholder="Name or road name" autoCapitalize="words" />
              {matches.length > 0 ? (
                <Card style={{ padding: 0, gap: 0 }}>
                  {matches.map((m, i) => (
                    <ListRow key={m.id} last={i === matches.length - 1} title={displayName(m)} onPress={() => setPayeeId(m.id)} />
                  ))}
                </Card>
              ) : null}
            </>
          )}
          <Small>It waits for two approvals before it can be paid (13.3).</Small>
        </>
      )}

      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={kind === 'credit' ? 'Add money in' : bank ? 'Add bank fee' : 'Add for approval'} icon="checkmark" busy={busy} onPress={save} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// The monthly Treasurer's Report
// ---------------------------------------------------------------------------

function ReportLines({ lines, total, label }: { lines: { code: LedgerCode; cents: number }[]; total: number; label: string }) {
  return (
    <Card>
      <H2>{label}</H2>
      {lines.map((l) => (
        <Row key={l.code} style={{ justifyContent: 'space-between' }}>
          <Body style={l.cents === 0 ? { color: colors.boneMute } : undefined}>{`${l.code.slice(3)}  ${CODE_LABEL[l.code]}`}</Body>
          <Text style={[type.name, num, { color: l.cents === 0 ? colors.boneMute : colors.boneDim }]}>{formatCents(l.cents)}</Text>
        </Row>
      ))}
      <Divider />
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={type.name}>Total</Text>
        <Amount cents={total} strong />
      </Row>
    </Card>
  );
}

export function MonthReportScreen({ route, navigation }: RootScreen<'MonthReport'>) {
  const { me, data, today, presentReport } = useClub();
  const [msg, setMsg] = useState<Msg>(null);
  const month = route.params.month;
  const presented = (data.treasurerReports ?? []).find((r) => r.month === month);
  const books = seesAnyLedger(me, data);
  if (!me || !(books || (presented && seesReports(me)))) {
    return (
      <Screen>
        <Notice tone="info">This month’s report hasn’t been presented to members yet.</Notice>
      </Screen>
    );
  }
  const report = reportFor(month, data);
  const presentWhy = presentProblem(me, month, data, today);
  const funds = [null, ...data.chapters.map((c) => c.id)];

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>{monthLabel(month)}</H1>
        <Small>{fyLabel(fyOf(month))}</Small>
        {presented ? <Chip label={`Presented ${formatAuDate(presented.presentedAt.slice(0, 10))}`} tone="ok" icon="checkmark" /> : null}
      </Stack>
      {books ? <MonthStepper month={month} latest={monthOf(today)} onChange={(m) => navigation.setParams({ month: m })} /> : null}

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {presented && updatedSince(report, presented.presentedAt) ? (
        <Notice tone="warn" title="Changed since it was presented">
          An entry in this month was changed after the report went to members. The figures below are today’s.
        </Notice>
      ) : null}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={type.name}>Opening balance</Text>
          <Amount cents={report.openingCents} strong />
        </Row>
      </Card>
      <ReportLines label="Credits" lines={report.credits} total={report.creditTotal} />
      <ReportLines label="Debits" lines={report.debits} total={report.debitTotal} />

      <Card>
        <H2>Closing balance</H2>
        {funds.map((f) => (
          <Row key={fundKey(f)} style={{ justifyContent: 'space-between' }}>
            <Body>{`${fundName(f, data)} fund`}</Body>
            <Amount cents={report.funds[fundKey(f)] ?? 0} />
          </Row>
        ))}
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={type.name}>Total</Text>
          <Amount cents={report.totalCents} strong />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Body>Less cash float</Body>
          <Amount cents={report.floatCents} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={type.name}>In the bank</Text>
          <Text style={[type.h2, num]}>{formatCents(report.bankCents)}</Text>
        </Row>
      </Card>

      {keepsBooks(me, null, data.positions) && !presented ? (
        presentWhy ? (
          <Small>{presentWhy}</Small>
        ) : (
          <ConfirmButton
            label="Present to members"
            confirmLabel="Present it"
            confirmNote="Every member can read it from Me, and it can’t be taken back."
            icon="megaphone-outline"
            kind="primary"
            onConfirm={() => presentReport(month).then(() => setMsg({ tone: 'ok', text: 'Presented. Members can read it from Me.' }), (e) => setMsg({ tone: 'danger', text: (e as Error).message }))}
          />
        )
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export function BudgetScreen({ route, navigation }: RootScreen<'Budget'>) {
  const { me, data, today, saveBudget, approveBudget, reopenBudget } = useClub();
  const fund = fundOf(route.params.fund);
  const thisFy = fyOf(today);
  const [fy, setFy] = useState(route.params.fy ?? thisFy);
  const [msg, setMsg] = useState<Msg>(null);
  const [key, setKey] = useState(0);
  if (!me || !seesLedger(me, fund, data.positions)) {
    return (
      <Screen>
        <Notice tone="info">You can’t see this fund’s budget.</Notice>
      </Screen>
    );
  }
  const funds = [null, ...data.chapters.map((c) => c.id)].filter((f) => seesLedger(me, f, data.positions));
  const budget = budgetOf(fund, fy, data);
  const lines = budgetLines(fund, fy, data);
  const keeper = keepsBooks(me, fund, data.positions);
  const done = (text: string) => {
    setMsg({ tone: 'ok', text });
    setKey((k) => k + 1);
  };
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: (e as Error).message });
  const votes = (data.votes ?? []).filter((v) => budgetVoteFits(v, fund)).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const approvedBy = budget?.approvedVoteId ? (data.votes ?? []).find((v) => v.id === budget.approvedVoteId) : undefined;
  const canReopen = !!budget?.approvedAt && reopenBudgetProblem(me, fund, fy, data) === null;
  const canApprove = !!budget && !budget.approvedAt && votes.length > 0 && approveBudgetProblem(me, fund, fy, votes[0].id, data) === null;

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>{`${fundName(fund, data)} budget`}</H1>
        {funds.length > 1 ? (
          <Choices<string>
            options={funds.map((f) => ({ value: fundKey(f), label: fundName(f, data) }))}
            value={fundKey(fund)}
            onChange={(f) => navigation.setParams({ fund: f })}
          />
        ) : null}
        <Choices<string>
          options={[thisFy - 1, thisFy, thisFy + 1].map((y) => ({ value: String(y), label: fyLabel(y) }))}
          value={String(fy)}
          onChange={(v) => setFy(Number(v))}
        />
        {budget?.approvedAt ? (
          <Chip label={`Approved ${formatAuDate(budget.approvedAt.slice(0, 10))}`} tone="ok" icon="checkmark" />
        ) : budget ? (
          <Chip label="Draft" tone="warn" />
        ) : null}
      </Stack>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {approvedBy ? <Small>{`Approved by the vote “${approvedBy.question}”.`}</Small> : null}

      <Card>
        {lines.length === 0 ? <Small>No budget or spending yet for this year.</Small> : null}
        {lines.map((l) => {
          const over = !isCredit(l.code) && l.leftCents !== null && l.leftCents < 0;
          const note =
            l.budgetCents === null
              ? 'Not in the budget'
              : isCredit(l.code)
                ? `of ${formatCents(l.budgetCents)} budgeted`
                : over
                  ? `${formatCents(-l.leftCents!)} over the ${formatCents(l.budgetCents)} budget`
                  : `of ${formatCents(l.budgetCents)} · ${formatCents(l.leftCents!)} left`;
          return (
            <View key={l.code} style={{ gap: 2 }}>
              <Row style={{ justifyContent: 'space-between', gap: space.md }}>
                <Body style={{ flex: 1 }} numberOfLines={1}>{CODE_LABEL[l.code]}</Body>
                <Text style={[type.name, num]}>{formatCents(l.actualCents)}</Text>
              </Row>
              <Small style={over ? { color: colors.warn } : undefined}>{note}</Small>
            </View>
          );
        })}
      </Card>

      {keeper && !budget?.approvedAt ? <BudgetEditor key={`${fundKey(fund)}-${fy}-${key}`} lines={budget?.lines ?? {}} onSave={(l) => saveBudget(fund, fy, l).then(() => done('Budget saved. The board approves it with a vote (13.4).'), fail)} /> : null}

      {budget && !budget.approvedAt ? (
        canApprove ? (
          <ApproveBudget key={`approve-${key}`} votes={votes.map((v) => ({ value: v.id, label: v.question }))} onApprove={(voteId) => approveBudget(fund, fy, voteId).then(() => done('Budget approved and locked.'), fail)} />
        ) : (
          <Small>{fund === null ? 'The NEC approves this budget with a carried vote (13.4).' : 'The chapter board approves this budget with a carried board vote (13.4).'}</Small>
        )
      ) : null}

      {canReopen ? (
        <ConfirmButton label="Reopen to change it" confirmLabel="Reopen budget" confirmNote="It goes back to draft and needs a new vote." kind="quiet" icon="lock-open-outline" onConfirm={() => reopenBudget(fund, fy).then(() => done('Reopened as a draft.'), fail)} />
      ) : null}
    </Screen>
  );
}

function BudgetEditor({ lines, onSave }: { lines: Partial<Record<LedgerCode, number>>; onSave: (lines: Partial<Record<LedgerCode, number>>) => Promise<void> }) {
  const [text, setText] = useState<Partial<Record<LedgerCode, string>>>(
    Object.fromEntries(Object.entries(lines).map(([c, n]) => [c, ((n ?? 0) / 100).toFixed(2).replace(/\.00$/, '')])),
  );
  const [busy, setBusy] = useState(false);
  const parsed = Object.entries(text).flatMap(([c, t]) => {
    if (!t || !t.trim()) return [];
    const cents = t.trim() === '0' ? 0 : parseDollars(t);
    return [[c, cents] as const];
  });
  const bad = parsed.some(([, c]) => c === null);
  const field = (c: LedgerCode) => (
    <Field
      key={c}
      label={CODE_LABEL[c]}
      value={text[c] ?? ''}
      onChangeText={(t) => setText((s) => ({ ...s, [c]: t }))}
      keyboardType="decimal-pad"
      placeholder="0"
      error={text[c]?.trim() && parsed.find(([k]) => k === c)?.[1] === null ? 'Enter an amount, like 500.' : null}
    />
  );
  return (
    <>
      <SectionTitle title="Set the budget" />
      <Card>
        <H2>Money in</H2>
        {CREDIT_CODES.map(field)}
        <Divider />
        <H2>Money out</H2>
        {DEBIT_CODES.map(field)}
        <Button
          label="Save budget"
          kind="secondary"
          busy={busy}
          disabled={bad}
          onPress={() => {
            setBusy(true);
            onSave(Object.fromEntries(parsed) as Partial<Record<LedgerCode, number>>).finally(() => setBusy(false));
          }}
        />
      </Card>
    </>
  );
}

function ApproveBudget({ votes, onApprove }: { votes: { value: string; label: string }[]; onApprove: (voteId: string) => Promise<void> }) {
  const [voteId, setVoteId] = useState<string | null>(votes.length === 1 ? votes[0].value : null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <SectionTitle title="Approve it" />
      <Card>
        <Small>Pick the carried vote that approved this budget (13.4).</Small>
        <Choices<string> options={votes} value={voteId} onChange={setVoteId} />
        <Button
          label="Approve budget"
          icon="checkmark"
          busy={busy}
          disabled={!voteId}
          onPress={() => {
            setBusy(true);
            onApprove(voteId!).finally(() => setBusy(false));
          }}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Club finances, for members
// ---------------------------------------------------------------------------

export function ClubFinancesScreen({ navigation }: RootScreen<'ClubFinances'>) {
  const { me, data } = useClub();
  if (!seesReports(me)) {
    return (
      <Screen>
        <Notice tone="info">Club finances are for members.</Notice>
      </Screen>
    );
  }
  const reports = [...(data.treasurerReports ?? [])].sort((a, b) => b.month.localeCompare(a.month));
  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Club finances</H1>
        <Small>The Treasurer’s Report for each month, once it’s been presented. Every member can read them (13.8).</Small>
      </Stack>
      <Card style={{ padding: 0, gap: 0 }}>
        {reports.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>No reports presented yet.</Small>
          </View>
        ) : (
          reports.map((r, i) => (
            <ListRow
              key={r.month}
              last={i === reports.length - 1}
              left={<IconBadge icon="document-text-outline" />}
              title={monthLabel(r.month)}
              subtitle={`Presented ${formatAuDate(r.presentedAt.slice(0, 10))}`}
              right={<Text style={[type.name, num, { color: colors.boneDim }]}>{formatCents(reportFor(r.month, data).bankCents)}</Text>}
              onPress={() => navigation.navigate('MonthReport', { month: r.month })}
            />
          ))
        )}
      </Card>
    </Screen>
  );
}

/** For the Board tab: the way into the books, for anyone who keeps, approves or audits them. */
export function TreasuryRow({ last }: { last?: boolean }) {
  const { me, data } = useClub();
  const navigation = useNavigation<Nav>();
  if (!seesAnyLedger(me, data)) return null;
  const waiting = needsMyApproval(me, data).length;
  const fees = feesToAdd(me, data).length;
  const notes = [waiting > 0 ? `${waiting} to approve` : null, fees > 0 ? `${fees} fee${fees === 1 ? '' : 's'} to add` : null].filter(Boolean);
  return (
    <ListRow
      last={last}
      left={<IconBadge icon="wallet-outline" tone={waiting > 0 ? 'red' : 'steel'} />}
      title="Treasury"
      subtitle={notes.length > 0 ? notes.join(' · ') : 'Ledger, monthly report and budgets'}
      onPress={() => navigation.navigate('Treasury')}
    />
  );
}
