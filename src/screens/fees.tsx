// Fees: what you owe and how to pay it, a member's charges for the treasurer, and a chapter's
// rates, PayID details, claims to confirm and who still owes.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import {
  PAYING_STATUSES,
  canManageFees,
  canSeeFees,
  canSetFees,
  chargeBalance,
  chargesOf,
  dueState,
  formatCents,
  fyLabel,
  fyOf,
  parseDollars,
  paymentReference,
  paysFees,
  totalOwing,
} from '../domain/fees';
import { STATUS_LABEL } from '../domain/labels';
import { displayName, initials } from '../domain/profile';
import type { Charge, Member, MemberStatus, Payment, PaymentMethod } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Field,
  H1,
  H2,
  IconBadge,
  KeyValue,
  Label,
  ListRow,
  LockNote,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
} from '../ui/primitives';

type Nav = NavigationProp<RootParams>;

const METHOD_LABEL: Record<PaymentMethod, string> = { payid: 'PayID', bank: 'Bank transfer', cash: 'Cash', card: 'Card' };
const METHODS: PaymentMethod[] = ['payid', 'bank', 'cash'];

function chargeTitle(c: Charge) {
  if (c.kind === 'annual') return `Fees ${fyLabel(c.fy)}`;
  if (c.kind === 'continuation') return `FNG continuation ${fyLabel(c.fy)}`;
  return c.description ?? 'Charge';
}

function StateChip({ charge, payments, today }: { charge: Charge; payments: Payment[]; today: string }) {
  const b = chargeBalance(charge, payments);
  if (b.state === 'waived') return <Chip label="Waived" tone="steel" />;
  if (b.state === 'paid') return <Chip label="Paid" tone="ok" icon="checkmark" />;
  const due = dueState(charge, b, today);
  if (due === 'overdue') return <Chip label="Overdue" tone="danger" />;
  if (b.state === 'part') return <Chip label="Part paid" tone="warn" />;
  return <Chip label={due === 'soon' ? 'Due soon' : 'Owing'} tone={due === 'soon' ? 'warn' : 'bone'} />;
}

function useDate(initial: string) {
  const [text, setRaw] = useState(formatAuDate(initial));
  const iso = parseAuDate(text.trim());
  return { text, setText: (t: string) => setRaw(typeDate(t)), iso, error: text.trim() && !iso ? 'Use DD/MM/YYYY, like 08/11/2026.' : null };
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

/** What you owe, on your Home screen. Nothing shows once you're square. */
export function HomeFeesCard() {
  const { me, data, today } = useClub();
  const navigation = useNavigation<Nav>();
  if (!me) return null;
  const owing = totalOwing(me.id, data);
  const claimed = (data.payments ?? []).filter(
    (p) => p.state === 'claimed' && chargesOf(me.id, data).some((c) => c.id === p.chargeId),
  );
  if (owing === 0) return null;
  const charges = chargesOf(me.id, data).filter((c) => chargeBalance(c, data.payments ?? []).owingCents > 0);
  const firstDue = charges.map((c) => c.dueOn).sort()[0];
  const overdue = firstDue < today;
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <H2>Fees</H2>
        {overdue ? <Chip label="Overdue" tone="danger" /> : <Text style={[type.name, { color: colors.boneDim }]}>{`Due ${formatAuDate(firstDue)}`}</Text>}
      </Row>
      <Text style={[type.h1, { fontVariant: ['tabular-nums'] }]}>{formatCents(owing)}</Text>
      {claimed.length > 0 ? (
        <Small>{`You’ve told the treasurer about ${formatCents(claimed.reduce((s, p) => s + p.amountCents, 0))}. It comes off once they confirm it.`}</Small>
      ) : null}
      <Button label="Pay your fees" kind="secondary" icon="card-outline" onPress={() => navigation.navigate('MemberFees', { memberId: me.id })} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// One member's fees
// ---------------------------------------------------------------------------

function PaymentForm({
  charge,
  mode,
  defaultCents,
  onDone,
}: {
  charge: Charge;
  mode: 'claim' | 'record';
  defaultCents: number;
  onDone: (msg: string) => void;
}) {
  const { today, claimPayment, recordPayment } = useClub();
  const [amount, setAmount] = useState((defaultCents / 100).toFixed(2).replace(/\.00$/, ''));
  const paidOn = useDate(today);
  const [method, setMethod] = useState<PaymentMethod>(mode === 'claim' ? 'payid' : 'cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = parseDollars(amount);

  const send = async () => {
    setError(null);
    if (cents === null) return setError('Enter an amount, like 250 or 125.50.');
    if (!paidOn.iso) return setError('Use DD/MM/YYYY, like 08/11/2026.');
    setBusy(true);
    try {
      await (mode === 'claim' ? claimPayment : recordPayment)(charge.id, cents, paidOn.iso, method, reference);
      onDone(
        mode === 'claim'
          ? `Thanks. The treasurer will confirm your ${formatCents(cents)} once it shows in the account.`
          : `${formatCents(cents)} recorded, with a receipt.`,
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Stack gap={space.md}>
      <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
        <View style={{ flex: 1 }}>
          <Field label="Amount ($)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={mode === 'claim' ? 'Paid on' : 'Received on'} value={paidOn.text} onChangeText={paidOn.setText} keyboardType="number-pad" error={paidOn.error} />
        </View>
      </Row>
      <Choices<PaymentMethod> label="How" options={METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
      {method !== 'cash' ? (
        <Field label="Bank reference (optional)" value={reference} onChangeText={setReference} autoCapitalize="characters" maxLength={40} />
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={mode === 'claim' ? 'Tell the treasurer' : 'Record payment'} kind={mode === 'claim' ? 'primary' : 'secondary'} busy={busy} onPress={send} />
    </Stack>
  );
}

function ChargeCard({ charge, member, lead, onDone }: { charge: Charge; member: Member; lead: boolean; onDone: (msg: string) => void }) {
  const { me, data, today, waiveCharge, confirmPayment, rejectPayment } = useClub();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payments = (data.payments ?? []).filter((p) => p.chargeId === charge.id).sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const balance = chargeBalance(charge, data.payments ?? []);
  const isSelf = me?.id === member.id;
  const manager = canManageFees(me, charge.chapterId, data.positions);
  const pendingCents = payments.filter((p) => p.state === 'claimed').reduce((sum, p) => sum + p.amountCents, 0);
  // Your own fees are always claimed, even by a treasurer: someone else confirms them.
  const claimMode = isSelf;
  const [busyId, setBusyId] = useState<string | null>(null);
  // A member can't say they've paid more than is left once their waiting claims are counted.
  const leftCents = claimMode ? Math.max(0, balance.owingCents - pendingCents) : balance.owingCents;
  const act = (fn: () => Promise<void>, msg: string, id: string | null = null) => {
    if (busyId) return;
    setError(null);
    setBusyId(id ?? 'any');
    fn().then(
      () => onDone(msg),
      (e) => {
        setError((e as Error).message);
        setBusyId(null);
      },
    );
  };

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap', gap: space.sm }}>
        <Text style={[type.name, { flex: 1 }]}>{chargeTitle(charge)}</Text>
        <StateChip charge={charge} payments={data.payments ?? []} today={today} />
      </Row>
      <Stack gap={2}>
        <KeyValue label="Amount" value={formatCents(charge.amountCents)} />
        {balance.paidCents > 0 ? <KeyValue label="Paid" value={formatCents(balance.paidCents)} tone="ok" /> : null}
        {balance.owingCents > 0 ? <KeyValue label="Still owing" value={formatCents(balance.owingCents)} /> : null}
        <KeyValue label="Due" value={formatAuDate(charge.dueOn)} />
      </Stack>

      {payments.map((p) => (
        <View key={p.id} style={{ gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={type.name}>{`${formatCents(p.amountCents)} · ${formatAuDate(p.paidOn)}`}</Text>
            {p.state === 'confirmed' ? (
              <Chip label={p.receiptNo ?? 'Confirmed'} tone="ok" icon="receipt-outline" />
            ) : p.state === 'claimed' ? (
              <Chip label="Waiting on treasurer" tone="warn" />
            ) : (
              <Chip label="Not received" tone="danger" />
            )}
          </Row>
          <Small>{[METHOD_LABEL[p.method], p.reference].filter(Boolean).join(' · ')}</Small>
          {manager && !isSelf && p.state === 'claimed' ? (
            <Stack gap={space.xs}>
              <Button label="It’s in the account" kind="secondary" icon="checkmark" busy={busyId === p.id} onPress={() => act(() => confirmPayment(p.id), 'Payment confirmed, with a receipt.', p.id)} />
              <ConfirmButton label="Not received" confirmLabel="Mark not received" kind="quiet" onConfirm={() => act(() => rejectPayment(p.id), 'Marked as not received.')} />
            </Stack>
          ) : null}
        </View>
      ))}

      {leftCents > 0 && (isSelf || manager) ? (
        open ? (
          <PaymentForm charge={charge} mode={claimMode ? 'claim' : 'record'} defaultCents={leftCents} onDone={onDone} />
        ) : (
          <Button label={claimMode ? 'I’ve paid this' : 'Record a payment'} kind={claimMode && lead ? 'primary' : 'secondary'} onPress={() => setOpen(true)} />
        )
      ) : null}
      {manager && !isSelf && balance.owingCents > 0 ? (
        <ConfirmButton label="Waive it" confirmLabel={`Waive ${formatCents(balance.owingCents)}`} kind="quiet" onConfirm={() => act(() => waiveCharge(charge.id), 'Charge waived.')} />
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Card>
  );
}

function HowToPay({ member }: { member: Member }) {
  const { data } = useClub();
  const d = (data.paymentDetails ?? []).find((x) => x.chapterId === member.chapterId);
  const chapter = data.chapters.find((c) => c.id === member.chapterId);
  return (
    <Card>
      <H2>How to pay</H2>
      {d?.payid || d?.bsb ? (
        <Stack gap={space.sm}>
          {d.payid ? (
            <View style={{ gap: 2 }}>
              <Label>PayID</Label>
              <Body strong selectable>{d.payid}</Body>
              {d.payidName ? <Small>{`Shows as ${d.payidName}`}</Small> : null}
            </View>
          ) : null}
          {d.bsb ? (
            <View style={{ gap: 2 }}>
              <Label>Bank transfer</Label>
              <Body strong selectable>{`BSB ${d.bsb} · Account ${d.accountNo ?? ''}`}</Body>
            </View>
          ) : null}
          <View style={{ gap: 2 }}>
            <Label>Put this in the description</Label>
            <Text selectable style={[type.h2, { letterSpacing: 2 }]}>{paymentReference(member)}</Text>
          </View>
          <Small>Then tap “I’ve paid this” below, so the treasurer knows to look for it.</Small>
        </Stack>
      ) : (
        <Small>{`The ${chapter?.name ?? ''} treasurer hasn’t added the chapter’s PayID yet. Ask them how to pay.`}</Small>
      )}
    </Card>
  );
}

function AddChargeForm({ member, onDone }: { member: Member; onDone: (msg: string) => void }) {
  const { today, raiseCharge } = useClub();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const due = useDate(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setError(null);
    const cents = parseDollars(amount);
    if (cents === null) return setError('Enter an amount, like 45 or 12.50.');
    if (!due.iso) return setError('Use DD/MM/YYYY, like 08/11/2026.');
    setBusy(true);
    try {
      await raiseCharge(member.id, description, cents, due.iso);
      onDone(`${formatCents(cents)} for ${description.trim()} added.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card>
      <H2>Add a charge</H2>
      <Field label="What it’s for" value={description} onChangeText={setDescription} placeholder="Patches, shirt, event" maxLength={60} />
      <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
        <View style={{ flex: 1 }}>
          <Field label="Amount ($)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Due" value={due.text} onChangeText={due.setText} keyboardType="number-pad" error={due.error} />
        </View>
      </Row>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Add charge" kind="secondary" busy={busy} onPress={add} />
    </Card>
  );
}

export function MemberFeesScreen({ route }: RootScreen<'MemberFees'>) {
  const { me, data } = useClub();
  const [msg, setMsg] = useState<string | null>(null);
  const [key, setKey] = useState(0); // remounts the cards so their forms close after a save
  const member = data.members.find((m) => m.id === route.params.memberId);
  if (!member || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Member not found" />
      </Screen>
    );
  }
  const isSelf = me.id === member.id;
  const manager = canManageFees(me, member.chapterId, data.positions);
  if (!isSelf && !canSeeFees(me, member.chapterId, data.positions)) {
    return (
      <Screen>
        <Notice tone="info">Fees are between each member and their chapter’s board.</Notice>
      </Screen>
    );
  }
  const charges = chargesOf(member.id, data);
  const owing = totalOwing(member.id, data);
  const waiting = (data.payments ?? [])
    .filter((p) => p.state === 'claimed' && charges.some((c) => c.id === p.chargeId))
    .reduce((sum, p) => sum + p.amountCents, 0);
  // Only the first charge with money left on it gets the red "I've paid this".
  const leadId = charges.find((c) => {
    const pending = (data.payments ?? []).filter((p) => p.chargeId === c.id && p.state === 'claimed').reduce((sum, p) => sum + p.amountCents, 0);
    return chargeBalance(c, data.payments ?? []).owingCents - pending > 0;
  })?.id;
  const done = (m: string) => {
    setMsg(m);
    setKey((k) => k + 1);
  };

  return (
    <Screen>
      <Row style={{ gap: space.md, flexWrap: 'nowrap' }}>
        <Avatar text={initials(member)} size={56} />
        <View style={{ flex: 1, gap: 4 }}>
          <H1>{isSelf ? 'Your fees' : displayName(member)}</H1>
          <Row style={{ gap: 6 }}>
            <Text style={[type.name, { color: owing > 0 ? colors.bone : colors.ok }]}>
              {owing > 0 ? `${formatCents(owing)} owing` : 'All paid up'}
            </Text>
            {member.onHiatus ? <Chip label="On hiatus: no fees" icon="pause" /> : null}
          </Row>
        </View>
        <LockNote text={isSelf ? 'You + board' : 'Board only'} />
      </Row>

      {msg ? (
        <Notice tone="ok" title="Done">
          {msg}
        </Notice>
      ) : null}

      {isSelf && owing > waiting ? <HowToPay member={member} /> : null}

      {charges.length === 0 ? (
        <Card>
          <Small>{isSelf ? 'Nothing to pay. Fees show up here once the treasurer raises them each July.' : 'No charges yet.'}</Small>
        </Card>
      ) : (
        charges.map((c) => <ChargeCard key={`${c.id}-${key}`} charge={c} member={member} lead={c.id === leadId} onDone={done} />)
      )}

      {manager && member.approval === 'approved' ? <AddChargeForm key={`add-${key}`} member={member} onDone={done} /> : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// A chapter's fees
// ---------------------------------------------------------------------------

function RatesCard({ chapterId, fy, onDone }: { chapterId: string; fy: number; onDone: (msg: string) => void }) {
  const { me, data, setFeeRate, setContinuationFee } = useClub();
  const canSet = canSetFees(me, chapterId, data.positions);
  const rates = (data.feeRates ?? []).filter((r) => r.chapterId === chapterId && r.fy === fy);
  const cont = (data.continuationFees ?? []).find((f) => f.chapterId === chapterId && f.fy === fy);
  const dollars = (c: number | undefined) => (c === undefined ? '' : (c / 100).toFixed(2).replace(/\.00$/, ''));
  const [amounts, setAmounts] = useState<Partial<Record<MemberStatus, string>>>(
    Object.fromEntries(PAYING_STATUSES.map((s) => [s, dollars(rates.find((r) => r.status === s)?.amountCents)])),
  );
  const [contText, setContText] = useState(dollars(cont?.amountCents));
  const due = useDate(rates[0]?.dueOn ?? `${fy}-07-31`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canSet) {
    return (
      <Card>
        <H2>{`Fees ${fyLabel(fy)}`}</H2>
        {rates.length === 0 ? <Small>Not set yet.</Small> : null}
        {PAYING_STATUSES.map((s) => {
          const r = rates.find((x) => x.status === s);
          return r ? <KeyValue key={s} label={STATUS_LABEL[s]} value={formatCents(r.amountCents)} /> : null;
        })}
        {cont ? <KeyValue label="FNG continuation" value={formatCents(cont.amountCents)} /> : null}
        {rates[0] ? <KeyValue label="Due" value={formatAuDate(rates[0].dueOn)} /> : null}
      </Card>
    );
  }

  const save = async () => {
    setError(null);
    if (!due.iso) return setError('Use DD/MM/YYYY, like 31/07/2027.');
    // A rate that's already set can be changed but not cleared (there's no way to un-set one yet).
    const cleared = PAYING_STATUSES.filter((st) => !(amounts[st] ?? '').trim() && rates.some((r) => r.status === st));
    if (cleared.length || (!contText.trim() && cont)) {
      return setError('A fee that’s already set can’t be left blank. Put the amount back in, or ask Claude to add a way to stop charging it.');
    }
    const toSave = PAYING_STATUSES.flatMap((st) => {
      const t = (amounts[st] ?? '').trim();
      return t ? [{ s: st, cents: parseDollars(t) }] : [];
    });
    if (toSave.some((x) => x.cents === null)) return setError('Enter amounts like 250 or 125.50.');
    const contCents = contText.trim() ? parseDollars(contText) : undefined;
    if (contCents === null) return setError('Enter the continuation fee like 50.');
    setBusy(true);
    try {
      for (const x of toSave) await setFeeRate(chapterId, fy, x.s, x.cents!, due.iso);
      if (contCents !== undefined) await setContinuationFee(chapterId, fy, contCents);
      onDone(`Fees for ${fyLabel(fy)} saved.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <H2>{`Fees ${fyLabel(fy)}`}</H2>
      <Small>The board sets these. Leave a status blank if it doesn’t pay. Members on hiatus aren’t charged.</Small>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: space.md }}>
        {PAYING_STATUSES.map((st) => (
          <View key={st} style={{ width: '47%', flexGrow: 1 }}>
            <Field
              label={`${STATUS_LABEL[st]} ($)`}
              value={amounts[st] ?? ''}
              onChangeText={(t) => setAmounts({ ...amounts, [st]: t })}
              keyboardType="decimal-pad"
              placeholder="–"
            />
          </View>
        ))}
        <View style={{ width: '47%', flexGrow: 1 }}>
          <Field label="Continuation ($)" value={contText} onChangeText={setContText} keyboardType="decimal-pad" placeholder="–" />
        </View>
      </View>
      <Small>The continuation fee is added when a review past twelve months says carry on.</Small>
      <Field label="Due by" value={due.text} onChangeText={due.setText} keyboardType="number-pad" error={due.error} />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Save fees" kind="secondary" busy={busy} onPress={save} />
    </Card>
  );
}

function PayIdCard({ chapterId, onDone }: { chapterId: string; onDone: (msg: string) => void }) {
  const { data, setPaymentDetails } = useClub();
  const d = (data.paymentDetails ?? []).find((x) => x.chapterId === chapterId);
  const [payid, setPayid] = useState(d?.payid ?? '');
  const [payidName, setPayidName] = useState(d?.payidName ?? '');
  const [bsb, setBsb] = useState(d?.bsb ?? '');
  const [accountNo, setAccountNo] = useState(d?.accountNo ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await setPaymentDetails({ chapterId, payid, payidName, bsb, accountNo });
      onDone('Payment details saved. Members see them on their fees.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <H2>Where members pay</H2>
      <Field label="PayID" value={payid} onChangeText={setPayid} autoCapitalize="none" keyboardType="email-address" placeholder="Email or mobile" />
      <Field label="PayID shows as" value={payidName} onChangeText={setPayidName} placeholder="Account name" />
      <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
        <View style={{ flex: 1 }}>
          <Field label="BSB" value={bsb} onChangeText={setBsb} keyboardType="number-pad" maxLength={7} />
        </View>
        <View style={{ flex: 2 }}>
          <Field label="Account" value={accountNo} onChangeText={setAccountNo} keyboardType="number-pad" maxLength={12} />
        </View>
      </Row>
      <Small>Approved members can see these.</Small>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Save payment details" kind="secondary" busy={busy} onPress={save} />
    </Card>
  );
}

export function ChapterFeesScreen({ route, navigation }: RootScreen<'ChapterFees'>) {
  const { me, data, today, raiseFees, confirmPayment, rejectPayment } = useClub();
  const chapter = data.chapters.find((c) => c.id === route.params.chapterId);
  const thisFy = fyOf(today);
  const [fy, setFy] = useState(thisFy);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [key, setKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!chapter || !me || !canSeeFees(me, chapter.id, data.positions)) {
    return (
      <Screen>
        <Notice tone="info">Only the chapter’s board can see its fees.</Notice>
      </Screen>
    );
  }
  const manager = canManageFees(me, chapter.id, data.positions);
  const payments = data.payments ?? [];
  const charges = (data.charges ?? []).filter((c) => c.chapterId === chapter.id);
  // This year and next, plus any earlier year someone still owes for.
  const years = [
    ...new Set([...charges.filter((c) => c.fy < thisFy && chargeBalance(c, payments).owingCents > 0).map((c) => c.fy), thisFy, thisFy + 1]),
  ].sort((a, b) => a - b);
  const chargeById = new Map(charges.map((c) => [c.id, c]));
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  const claims = payments.filter((p) => p.state === 'claimed' && chargeById.has(p.chargeId));
  const yearCharges = charges.filter((c) => c.fy === fy);
  const collected = payments
    .filter((p) => p.state === 'confirmed' && yearCharges.some((c) => c.id === p.chargeId))
    .reduce((s, p) => s + p.amountCents, 0);
  const owingBy = new Map<string, number>();
  for (const c of yearCharges) {
    const o = chargeBalance(c, payments).owingCents;
    if (o > 0) owingBy.set(c.memberId, (owingBy.get(c.memberId) ?? 0) + o);
  }
  const outstanding = [...owingBy.entries()].sort((a, b) => b[1] - a[1]);
  const notRaised = data.members.filter(
    (m) =>
      m.chapterId === chapter.id &&
      paysFees(m) &&
      (data.feeRates ?? []).some((r) => r.chapterId === chapter.id && r.fy === fy && r.status === m.status) &&
      !charges.some((c) => c.memberId === m.id && c.fy === fy && c.kind === 'annual'),
  );
  const done = (text: string) => {
    setMsg({ tone: 'ok', text });
    setKey((k) => k + 1);
  };
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: (e as Error).message });

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>{`${chapter.name} fees`}</H1>
        <Choices<string>
          options={years.map((y) => ({ value: String(y), label: fyLabel(y) }))}
          value={String(fy)}
          onChange={(v) => setFy(Number(v))}
        />
      </Stack>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card>
        <Row style={{ gap: space.xxl }}>
          <View style={{ gap: 2 }}>
            <H1 style={{ fontVariant: ['tabular-nums'] }}>{formatCents(collected)}</H1>
            <Small>collected</Small>
          </View>
          <View style={{ gap: 2 }}>
            <H1 style={{ fontVariant: ['tabular-nums'] }}>{formatCents([...owingBy.values()].reduce((s, n) => s + n, 0))}</H1>
            <Small>still owing</Small>
          </View>
        </Row>
        {manager && notRaised.length > 0 ? (
          <ConfirmButton
            label={`Raise ${fyLabel(fy)} fees`}
            confirmLabel={`Charge ${notRaised.length} ${notRaised.length === 1 ? 'member' : 'members'}`}
            kind="secondary"
            icon="add-circle-outline"
            onConfirm={() =>
              raiseFees(chapter.id, fy).then((n) => done(`${n} ${n === 1 ? 'member' : 'members'} charged for ${fyLabel(fy)}. They see it on their Home screen.`), fail)
            }
          />
        ) : manager ? (
          <Small>{yearCharges.some((c) => c.kind === 'annual') ? 'Everyone who pays has been charged for this year.' : 'Set this year’s fees below, then raise them.'}</Small>
        ) : null}
        <Small>Members on hiatus aren’t charged.</Small>
      </Card>

      {claims.length > 0 ? (
        <>
          <SectionTitle title="Check the account" action={<Text style={[type.name, { color: colors.boneMute }]}>{claims.length}</Text>} />
          {claims.map((p) => {
            const c = chargeById.get(p.chargeId)!;
            const m = memberById.get(c.memberId);
            return (
              <Card key={p.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={type.name}>{m ? displayName(m) : 'Member'}</Text>
                  <Text style={type.name}>{formatCents(p.amountCents)}</Text>
                </Row>
                <Small>{[`Says paid ${formatAuDate(p.paidOn)}`, METHOD_LABEL[p.method], p.reference].filter(Boolean).join(' · ')}</Small>
                {!manager ? <Small>The treasurer confirms these.</Small> : null}
                {manager && c.memberId === me.id ? <Small>Your own: the National Chairman or Secretary confirms it.</Small> : null}
                {manager && c.memberId !== me.id ? (
                  <Stack gap={space.xs}>
                    <Button
                      label="It’s in the account"
                      kind="secondary"
                      icon="checkmark"
                      busy={busyId === p.id}
                      onPress={() => {
                        if (busyId) return;
                        setBusyId(p.id);
                        confirmPayment(p.id)
                          .then(() => done('Payment confirmed, with a receipt.'), fail)
                          .finally(() => setBusyId(null));
                      }}
                    />
                    <ConfirmButton label="Not received" confirmLabel="Mark not received" kind="quiet" onConfirm={() => rejectPayment(p.id).then(() => done('Marked as not received.'), fail)} />
                  </Stack>
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}

      <SectionTitle title="Still owing" action={<Text style={[type.name, { color: colors.boneMute }]}>{outstanding.length}</Text>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {outstanding.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>Nobody owes anything for this year.</Small>
          </View>
        ) : (
          outstanding.map(([memberId, cents], i) => {
            const m = memberById.get(memberId);
            if (!m) return null;
            return (
              <ListRow
                key={memberId}
                last={i === outstanding.length - 1}
                left={<Avatar text={initials(m)} size={40} />}
                title={displayName(m)}
                subtitle={STATUS_LABEL[m.status]}
                right={<Text style={type.name}>{formatCents(cents)}</Text>}
                onPress={() => navigation.navigate('MemberFees', { memberId })}
              />
            );
          })
        )}
      </Card>

      <SectionTitle title="Settings" />
      <RatesCard key={`rates-${fy}-${key}`} chapterId={chapter.id} fy={fy} onDone={done} />
      {manager ? <PayIdCard key={`payid-${key}`} chapterId={chapter.id} onDone={done} /> : null}
    </Screen>
  );
}

/** For the Board tab: a way into each chapter's fees the viewer can see. */
export function BoardFees() {
  const { me, data } = useClub();
  const navigation = useNavigation<Nav>();
  const chapters = data.chapters.filter((c) => canSeeFees(me, c.id, data.positions));
  if (chapters.length === 0) return null;
  return (
    <>
      <SectionTitle title="Fees" />
      <Card style={{ padding: 0, gap: 0 }}>
        {chapters.map((c, i) => {
          const charges = (data.charges ?? []).filter((x) => x.chapterId === c.id);
          const owing = charges.reduce((s, x) => s + chargeBalance(x, data.payments ?? []).owingCents, 0);
          const claims = (data.payments ?? []).filter((p) => p.state === 'claimed' && charges.some((x) => x.id === p.chargeId)).length;
          return (
            <ListRow
              key={c.id}
              last={i === chapters.length - 1}
              left={<IconBadge icon="cash-outline" tone={claims > 0 ? 'red' : 'steel'} />}
              title={`${c.name} fees`}
              subtitle={claims > 0 ? `${claims} to check in the account · ${formatCents(owing)} owing` : `${formatCents(owing)} owing`}
              onPress={() => navigation.navigate('ChapterFees', { chapterId: c.id })}
            />
          );
        })}
      </Card>
    </>
  );
}
