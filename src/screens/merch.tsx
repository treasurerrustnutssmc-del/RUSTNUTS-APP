// Merch (15.1, 13.1): boards put up club gear, someone else on the board says yes, members order
// with sizes, and payment by PayID, bank or cash lands in the books as Merchandise sales. No cards.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { formatAuDate } from '../domain/dates';
import { formatCents, parseDollars } from '../domain/fees';
import { fundName, keepsBooks } from '../domain/ledger';
import { runsScope } from '../domain/meetings';
import {
  decideMerchProblem, showsAppMerch, ITEM_STATUS_LABEL, MAX_QTY, ORDER_STATUS_LABEL, orderTotal, ordersToAct, visibleItems, visibleOrders,
} from '../domain/merch';
import { melbourneDate } from '../domain/rides';
import { displayName } from '../domain/profile';
import type { MerchItem, MerchOrder, MerchStatus, OrderStatus } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import {
  Body, Button, Card, Chip, Choices, ConfirmButton, Field, H1, H2, IconBadge, Ionicons, Label, ListRow, Notice, Row, Screen,
  SectionTitle, Small, Stack, Toggle,
} from '../ui/primitives';
import { ActionWithReason, DateField, Fact, styles, useDate, useRun } from './adminBits';
import { MerchShopRows } from './adminRows';

type Tone = 'ok' | 'warn' | 'danger' | 'steel' | 'bone';
const ITEM_TONE: Record<MerchStatus, Tone> = { proposed: 'warn', on_sale: 'ok', declined: 'danger', closed: 'steel' };
const ORDER_TONE: Record<OrderStatus, Tone> = {
  waiting: 'warn', approved: 'bone', paid: 'ok', handed_over: 'steel', declined: 'danger', cancelled: 'steel',
};
const num = { fontVariant: ['tabular-nums' as const] };

const scopeName = (chapterId: string | null, chapters: { id: string; name: string }[]) =>
  chapterId === null ? 'Whole club' : `${chapters.find((c) => c.id === chapterId)?.name ?? 'Chapter'} chapter`;

const sizesLine = (item: MerchItem) => (item.sizes.length === 0 ? 'One size' : item.sizes.join(' · '));

function ItemRow({ item, last, onPress }: { item: MerchItem; last: boolean; onPress: () => void }) {
  const { data } = useClub();
  return (
    <ListRow
      last={last}
      left={<IconBadge icon="shirt-outline" />}
      title={item.name}
      subtitle={<Text style={styles.meta}>{`${scopeName(item.chapterId, data.chapters)} · ${sizesLine(item)}`}</Text>}
      right={<Text style={[type.name, num]}>{formatCents(item.priceCents)}</Text>}
      onPress={onPress}
    />
  );
}

function OrderRow({ order, last, onPress, showBuyer }: { order: MerchOrder; last: boolean; onPress: () => void; showBuyer: boolean }) {
  const { data } = useClub();
  const item = (data.merchItems ?? []).find((i) => i.id === order.itemId);
  const buyer = data.members.find((m) => m.id === order.memberId);
  const what = `${order.size ? `${order.size} · ` : ''}×${order.qty}`;
  return (
    <ListRow
      last={last}
      title={showBuyer ? (buyer ? displayName(buyer) : 'A former member') : (item?.name ?? 'Merch')}
      subtitle={
        <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
          <Text style={styles.meta}>{showBuyer ? `${item?.name ?? 'Merch'} · ${what}` : what}</Text>
          <Chip label={ORDER_STATUS_LABEL[order.status]} tone={ORDER_TONE[order.status]} />
        </View>
      }
      right={<Text style={[type.name, num, { color: colors.boneDim }]}>{formatCents(orderTotal(order))}</Text>}
      onPress={onPress}
    />
  );
}

// ---------------------------------------------------------------------------
// The shop
// ---------------------------------------------------------------------------

/**
 * The Merch tab (and the Board's Merch screen): the two club stores first, then gear the board
 * sells in the app, which members only see when something is on sale or they have an order.
 */
export function MerchScreen() {
  const navigation = useNavigation<NavigationProp<RootParams>>();
  const { me, data } = useClub();
  if (!me) return null;
  const items = visibleItems(me, data);
  const onSale = items.filter((i) => i.status === 'on_sale');
  const runs = (i: MerchItem) => runsScope(me, i.chapterId, data.positions);
  const waitingItems = items.filter((i) => i.status === 'proposed' && runs(i));
  const past = items.filter((i) => (i.status === 'declined' || i.status === 'closed') && runs(i));
  const toAct = ordersToAct(me, data);
  const mine = visibleOrders(me, data).filter((o) => o.memberId === me.id);
  const canPropose = runsScope(me, null, data.positions) || data.chapters.some((c) => runsScope(me, c.id, data.positions));
  const openItem = (i: MerchItem) => navigation.navigate('MerchItem', { itemId: i.id });
  const openOrder = (o: MerchOrder) => navigation.navigate('MerchOrder', { orderId: o.id });

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Merch</H1>
        <Small>Members’ designs are in the club Discord, public ones on the website.</Small>
      </Stack>
      <Card style={{ padding: 0, gap: 0 }}>
        <MerchShopRows />
      </Card>

      {toAct.length > 0 ? (
        <>
          <SectionTitle title="Orders to act on" action={<Text style={styles.count}>{toAct.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {toAct.map((o, i) => <OrderRow key={o.id} order={o} showBuyer last={i === toAct.length - 1} onPress={() => openOrder(o)} />)}
          </Card>
        </>
      ) : null}

      {showsAppMerch(me, data) || canPropose ? (
        <>
          <SectionTitle title="On sale in the app" />
          <Small>Board-run gear. Pay by PayID, bank transfer or cash once the board says yes. No cards.</Small>
          <Card style={{ padding: 0, gap: 0 }}>
            {onSale.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <Small>Nothing on sale right now.</Small>
              </View>
            ) : (
              onSale.map((it, i) => <ItemRow key={it.id} item={it} last={i === onSale.length - 1} onPress={() => openItem(it)} />)
            )}
          </Card>

        </>
      ) : null}

      {mine.length > 0 ? (
        <>
          <SectionTitle title="Your orders" />
          <Card style={{ padding: 0, gap: 0 }}>
            {mine.map((o, i) => <OrderRow key={o.id} order={o} showBuyer={false} last={i === mine.length - 1} onPress={() => openOrder(o)} />)}
          </Card>
        </>
      ) : null}

      {waitingItems.length > 0 ? (
        <>
          <SectionTitle title="Waiting for a yes" action={<Text style={styles.count}>{waitingItems.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {waitingItems.map((it, i) => <ItemRow key={it.id} item={it} last={i === waitingItems.length - 1} onPress={() => openItem(it)} />)}
          </Card>
        </>
      ) : null}

      {canPropose ? <Button label="Put up an item" kind="secondary" icon="add" onPress={() => navigation.navigate('ProposeMerch')} /> : null}

      {past.length > 0 ? (
        <>
          <SectionTitle title="Closed and declined" />
          <Card style={{ padding: 0, gap: 0 }}>
            {past.map((it, i) => <ItemRow key={it.id} item={it} last={i === past.length - 1} onPress={() => openItem(it)} />)}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One item
// ---------------------------------------------------------------------------

function QtyStepper({ qty, onChange }: { qty: number; onChange: (n: number) => void }) {
  const step = (icon: 'remove' | 'add', label: string, to: number, disabled: boolean) => (
    <Pressable
      onPress={() => onChange(to)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1,
        borderColor: colors.lineStrong, backgroundColor: pressed ? colors.steel : 'transparent', opacity: disabled ? 0.45 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={colors.bone} />
    </Pressable>
  );
  return (
    <View style={{ gap: 6 }}>
      <Label>How many</Label>
      <Row style={{ gap: space.md }}>
        {step('remove', 'One fewer', qty - 1, qty <= 1)}
        <Text style={[type.h2, num, { minWidth: 32, textAlign: 'center' }]} accessibilityLiveRegion="polite">{qty}</Text>
        {step('add', 'One more', qty + 1, qty >= MAX_QTY)}
      </Row>
    </View>
  );
}

export function MerchItemScreen({ route, navigation }: RootScreen<'MerchItem'>) {
  const { me, data, orderMerch, decideMerch, closeMerch } = useClub();
  const item = me ? visibleItems(me, data).find((i) => i.id === route.params.itemId) : undefined;
  const [size, setSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const { busy, msg, run } = useRun();
  if (!me || !item) {
    return (
      <Screen>
        <Notice tone="info">That item isn’t here.</Notice>
      </Screen>
    );
  }
  const runs = runsScope(me, item.chapterId, data.positions);
  const seesOrders = runs || keepsBooks(me, item.chapterId, data.positions);
  const orders = seesOrders ? visibleOrders(me, data).filter((o) => o.itemId === item.id) : [];
  const fail = msg?.tone === 'danger' ? msg.text : null;
  const proposer = data.members.find((m) => m.id === item.proposedBy);
  const yesProblem = decideMerchProblem(me, item.id, true, '', data);

  return (
    <Screen>
      <Stack gap={space.sm}>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          <Chip label={ITEM_STATUS_LABEL[item.status]} tone={ITEM_TONE[item.status]} />
          <Chip label={scopeName(item.chapterId, data.chapters)} tone="steel" />
          {item.patchedOnly ? <Chip label="Full and Nomad only" tone="bone" /> : null}
        </View>
        <H1>{item.name}</H1>
        <Text style={[type.h2, num]}>{formatCents(item.priceCents)}</Text>
      </Stack>

      <Card>
        {item.details ? <Body>{item.details}</Body> : null}
        <Fact icon="resize-outline" text={sizesLine(item)} />
        {runs ? <Small>{`Put up by ${proposer ? displayName(proposer) : 'a former member'}`}</Small> : null}
      </Card>

      {item.status === 'declined' ? <Notice tone="danger" title="Declined">{item.declineReason || 'No reason given.'}</Notice> : null}

      {item.status === 'on_sale' && me.status !== 'legacy' ? (
        <>
          <SectionTitle title="Order" />
          <Card>
            {item.sizes.length > 0 ? (
              <Choices<string> label="Size" options={item.sizes.map((s) => ({ value: s, label: s }))} value={size} onChange={setSize} />
            ) : null}
            <QtyStepper qty={qty} onChange={setQty} />
            <Field label="Note" value={note} onChangeText={setNote} maxLength={300} hint="Optional, for the board." />
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={type.name}>Total</Text>
              <Text style={[type.h2, num]}>{formatCents(item.priceCents * qty)}</Text>
            </Row>
            <ActionWithReason
              label="Order"
              icon="bag-add-outline"
              big
              busy={busy === 'order'}
              reason={fail}
              onPress={() =>
                run('order', async () => {
                  const id = await orderMerch({ itemId: item.id, size: item.sizes.length > 0 ? size : null, qty, note });
                  navigation.replace('MerchOrder', { orderId: id });
                })
              }
            />
            <Small>The board says yes, then you pay by PayID, bank or cash.</Small>
          </Card>
        </>
      ) : null}

      {item.status === 'proposed' && runs ? (
        <>
          <SectionTitle title="Your call" />
          <Card>
            <Small>Someone on the board other than whoever put it up says yes (15.1). Club-wide gear is the NEC’s call.</Small>
            {yesProblem && item.proposedBy === me.id ? (
              <Notice tone="info">You put it up, so someone else on the board gives the yes.</Notice>
            ) : (
              <ActionWithReason
                label="Say yes, put it on sale"
                icon="checkmark"
                busy={busy === 'yes'}
                reason={fail}
                onPress={() => run('yes', () => decideMerch(item.id, true, ''), 'It’s on sale.')}
              />
            )}
            <Field label="Reason for a no" value={reason} onChangeText={setReason} maxLength={300} />
            <ConfirmButton label="Say no" confirmLabel="Yes, decline it" kind="secondary" onConfirm={() => run('no', () => decideMerch(item.id, false, reason), 'Declined.')} />
          </Card>
        </>
      ) : null}

      {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}

      {seesOrders && orders.length > 0 ? (
        <>
          <SectionTitle title="Orders" action={<Text style={styles.count}>{orders.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {orders.map((o, i) => (
              <OrderRow key={o.id} order={o} showBuyer last={i === orders.length - 1} onPress={() => navigation.navigate('MerchOrder', { orderId: o.id })} />
            ))}
          </Card>
        </>
      ) : null}

      {item.status === 'on_sale' && runs ? (
        <ConfirmButton
          label="Stop selling"
          confirmLabel="Yes, close it"
          kind="secondary"
          confirmNote="Orders already in carry on. Nobody can order it after this."
          onConfirm={() => run('close', () => closeMerch(item.id), 'Closed.')}
        />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One order
// ---------------------------------------------------------------------------

function HowToPayMerch({ item, order }: { item: MerchItem; order: MerchOrder }) {
  const { data } = useClub();
  const d = item.chapterId ? (data.paymentDetails ?? []).find((x) => x.chapterId === item.chapterId) : undefined;
  const buyer = data.members.find((m) => m.id === order.memberId);
  const ref = `${(buyer?.roadName ?? buyer?.fullName.split(' ').pop() ?? 'MEMBER').toUpperCase().slice(0, 18)} MERCH`;
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
              {d.payidName ? <Small>{`Account name ${d.payidName}`}</Small> : null}
            </View>
          ) : null}
        </Stack>
      ) : (
        <Small>
          {item.chapterId
            ? 'The chapter treasurer hasn’t added payment details yet. Ask them how to pay, or pay cash.'
            : 'Pay the National Treasurer, or your chapter treasurer in cash, and they’ll mark it paid.'}
        </Small>
      )}
      <View style={{ gap: 2 }}>
        <Label>Put this in the description</Label>
        <Text selectable style={[type.h2, { letterSpacing: 2 }]}>{ref}</Text>
      </View>
      <Text style={[type.name, num]}>{`Amount ${formatCents(orderTotal(order))}`}</Text>
    </Card>
  );
}

export function MerchOrderScreen({ route, navigation }: RootScreen<'MerchOrder'>) {
  const { me, data, today, decideOrder, payOrder, handOver, cancelOrder } = useClub();
  const order = me ? visibleOrders(me, data).find((o) => o.id === route.params.orderId) : undefined;
  const item = order ? (data.merchItems ?? []).find((i) => i.id === order.itemId) : undefined;
  const [reason, setReason] = useState('');
  const paidOn = useDate(today);
  const { busy, msg, run } = useRun();
  if (!me || !order || !item) {
    return (
      <Screen>
        <Notice tone="info">That order isn’t here.</Notice>
      </Screen>
    );
  }
  const mine = order.memberId === me.id;
  const runs = runsScope(me, item.chapterId, data.positions);
  const keeper = keepsBooks(me, item.chapterId, data.positions);
  const buyer = data.members.find((m) => m.id === order.memberId);
  const fail = msg?.tone === 'danger' ? msg.text : null;
  const canCancel = (mine || runs) && (order.status === 'waiting' || order.status === 'approved');

  return (
    <Screen>
      <Stack gap={space.sm}>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          <Chip label={ORDER_STATUS_LABEL[order.status]} tone={ORDER_TONE[order.status]} />
        </View>
        <H1>{item.name}</H1>
        <Text style={[type.h2, num]}>{formatCents(orderTotal(order))}</Text>
      </Stack>

      <Card>
        <Stack gap={space.sm}>
          {!mine ? <Fact icon="person-outline" text={buyer ? displayName(buyer) : 'A former member'} /> : null}
          <Fact icon="resize-outline" text={`${order.size ?? 'One size'} · ×${order.qty} at ${formatCents(order.unitCents)}`} />
          <Fact icon="calendar-outline" text={`Ordered ${formatAuDate(melbourneDate(order.orderedAt))}`} />
          {order.paidOn ? <Fact icon="cash-outline" text={`Paid ${formatAuDate(order.paidOn)}`} tone="ok" /> : null}
          {order.handedOverOn ? <Fact icon="bag-check-outline" text={`Handed over ${formatAuDate(order.handedOverOn)}`} /> : null}
        </Stack>
        {order.note ? <Body selectable>{order.note}</Body> : null}
        {order.ledgerEntryId && keeper ? (
          <Small>{`In the ${fundName(item.chapterId, data)} ledger as Merchandise sales.`}</Small>
        ) : null}
      </Card>

      {order.status === 'declined' ? <Notice tone="danger" title="Declined">{order.declineReason || 'No reason given.'}</Notice> : null}
      {order.status === 'waiting' && mine ? <Notice tone="info">Waiting for the board’s yes. Don’t pay until then.</Notice> : null}
      {order.status === 'approved' && mine ? <HowToPayMerch item={item} order={order} /> : null}

      {order.status === 'waiting' && runs && !mine ? (
        <>
          <SectionTitle title="Your call" />
          <Card>
            <ActionWithReason label="Say yes" icon="checkmark" busy={busy === 'yes'} reason={fail} onPress={() => run('yes', () => decideOrder(order.id, true, ''), 'Approved. They’ll be shown how to pay.')} />
            <Field label="Reason for a no" value={reason} onChangeText={setReason} maxLength={300} />
            <ConfirmButton label="Say no" confirmLabel="Yes, decline it" kind="secondary" onConfirm={() => run('no', () => decideOrder(order.id, false, reason), 'Declined.')} />
          </Card>
        </>
      ) : null}

      {order.status === 'approved' && keeper && !mine ? (
        <>
          <SectionTitle title="Money in" />
          <Card>
            <Small>Marking it paid adds a Merchandise sales line to the books, banked that day.</Small>
            <DateField label="Paid on" date={paidOn} />
            <ActionWithReason
              label="Mark paid"
              icon="cash-outline"
              busy={busy === 'pay'}
              reason={fail}
              onPress={() => run('pay', () => payOrder(order.id, paidOn.iso), 'Paid, and in the ledger.')}
            />
          </Card>
        </>
      ) : null}

      {order.status === 'paid' && runs ? (
        <ActionWithReason label="Handed over" icon="bag-check-outline" busy={busy === 'hand'} reason={fail} onPress={() => run('hand', () => handOver(order.id), 'Marked as handed over.')} />
      ) : null}

      {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}

      {canCancel ? (
        <ConfirmButton
          label="Cancel order"
          confirmLabel="Yes, cancel it"
          kind="secondary"
          confirmNote={order.status === 'approved' ? 'Only before it’s paid. If you’ve already paid, tell the treasurer instead.' : undefined}
          onConfirm={() => run('cancel', () => cancelOrder(order.id)).then((done) => done && navigation.goBack())}
        />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Putting an item up
// ---------------------------------------------------------------------------

export function ProposeMerchScreen({ navigation }: RootScreen<'ProposeMerch'>) {
  const { me, data, proposeMerch } = useClub();
  const scopes = me
    ? ([null, ...data.chapters.map((c) => c.id)] as (string | null)[]).filter((c) => runsScope(me, c, data.positions))
    : [];
  const [scope, setScope] = useState<string>(scopes.length === 1 ? (scopes[0] ?? 'club') : (me?.chapterId && scopes.includes(me.chapterId) ? me.chapterId : 'club'));
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [sizes, setSizes] = useState('S, M, L, XL, 2XL');
  const [price, setPrice] = useState('');
  const [patchedOnly, setPatchedOnly] = useState(false);
  const { busy, msg, run } = useRun();
  if (!me || scopes.length === 0) {
    return (
      <Screen>
        <Notice tone="info">Only a chapter board or the NEC puts up merch (15.1).</Notice>
      </Screen>
    );
  }
  const cents = parseDollars(price);
  const sizeList = sizes.split(',').map((s) => s.trim()).filter(Boolean);
  const save = () =>
    run('save', async () => {
      if (cents === null) throw new Error('Enter a price from $0.01 to $1,000.');
      const id = await proposeMerch({ chapterId: scope === 'club' ? null : scope, name, details, sizes: sizeList, priceCents: cents, patchedOnly });
      navigation.replace('MerchItem', { itemId: id });
    });
  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Put up an item</H1>
        <Small>Someone else on the board says yes before it goes on sale (15.1).</Small>
      </Stack>
      {scopes.length > 1 ? (
        <Choices<string>
          label="For"
          options={scopes.map((c) => ({ value: c ?? 'club', label: c === null ? 'Whole club' : (data.chapters.find((x) => x.id === c)?.name ?? '') }))}
          value={scope}
          onChange={setScope}
        />
      ) : null}
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} placeholder="Club tee" />
      <Field label="Details" value={details} onChangeText={setDetails} multiline maxLength={500} hint="Optional. Colour, print, what it’s made of." />
      <Field label="Sizes" value={sizes} onChangeText={setSizes} autoCapitalize="characters" hint="Separate with commas. Leave blank for one size." />
      <Field label="Price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="35" error={price.trim() && cents === null ? 'Enter an amount, like 35 or 12.50.' : null} />
      <Card>
        <Toggle label="Full and Nomad members only" description="For anything carrying the patch." value={patchedOnly} onChange={setPatchedOnly} />
      </Card>
      <ActionWithReason label="Put it up" icon="checkmark" big busy={busy === 'save'} reason={msg?.tone === 'danger' ? msg.text : null} onPress={save} />
    </Screen>
  );
}
