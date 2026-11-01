// The club shop: members order club gear in the app, into the same Make.com pipeline as the Discord
// /buy shop (Chris's), which numbers the order and emails the invoice with the club's bank details.
// Spec: docs/superpowers/specs/2026-11-01-in-app-merch-ordering-design.md (piece 3, member screens).

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useShopCart } from '../data/shopCartStore';
import { formatAuDate } from '../domain/dates';
import { formatCents, parseDollars } from '../domain/fees';
import { melbourneDate } from '../domain/rides';
import {
  STATES, STATUS_LABEL, cartSubtotal, designProblem, handedOverStatus, orderTotalCents, orderableDesigns, runsShop, shippingCents, shopOrderRef,
  signedInProblem, type DeliveryInput,
} from '../domain/shop';
import { keepsBooks } from '../domain/ledger';
import { seesShopAdmin, shopQueues } from '../domain/shopAdmin';
import { cartCount } from '../domain/shopCart';
import type { ClubData, ShippingMethod, ShopDelivery, ShopGarment, ShopOrder, ShopOrderLine, ShopOrderStatus } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import {
  Body, Button, Card, Chip, Choices, ConfirmButton, Field, H1, H2, IconBadge, Label, ListRow, Notice, Row, Screen, SectionTitle, Small, Stack,
  Toggle,
} from '../ui/primitives';
import { ActionWithReason, DateField, Fact, QtyStepper, styles, useDate, useRun } from './adminBits';

type Tone = 'ok' | 'warn' | 'danger' | 'steel' | 'bone';
export const SHOP_TONE: Record<ShopOrderStatus, Tone> = {
  held: 'warn', sent: 'bone', paid: 'ok', posted: 'steel', collected: 'steel', cancelled: 'steel',
};
const num = { fontVariant: ['tabular-nums' as const] };

/** Where the order stands, in a line, for the person who ordered it. */
const MEMBER_STATUS_LINE: Record<ShopOrderStatus, string> = {
  held: 'Kept in the app. The shop will send it on.',
  sent: 'Invoice emailed. Waiting for your payment.',
  paid: 'Paid. Being made up.',
  posted: 'Posted.',
  collected: 'Collected.',
  cancelled: 'Cancelled.',
};

const garmentsOf = (data: ClubData, designId: string): ShopGarment[] =>
  (data.shopGarments ?? []).filter((g) => g.designId === designId && g.onSale).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

/** "Hoodie, Tee and Cap" */
function namesLine(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "XL · Black · ×2" */
export const lineOptions = (l: Pick<ShopOrderLine, 'size' | 'colour' | 'qty'>): string =>
  [l.size, l.colour, `×${l.qty}`].filter((x): x is string => !!x).join(' · ');

const myShopOrders = (me: { id: string }, data: ClubData): ShopOrder[] =>
  (data.shopOrders ?? []).filter((o) => o.memberId === me.id).sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));

// ---------------------------------------------------------------------------
// On the Merch tab
// ---------------------------------------------------------------------------

export function ShopOrderRow({ order, last, onPress, showBuyer }: { order: ShopOrder; last: boolean; onPress: () => void; showBuyer: boolean }) {
  const items = order.lines.map((l) => `${l.designName} ${l.garmentName}${l.qty > 1 ? ` ×${l.qty}` : ''}`).join(', ');
  return (
    <ListRow
      last={last}
      title={showBuyer ? (order.roadName ?? order.buyerName) : `Order ${shopOrderRef(order)}`}
      subtitle={
        <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
          <Text style={styles.meta} numberOfLines={2}>{`${formatAuDate(melbourneDate(order.orderedAt))} · ${items}`}</Text>
          <Chip label={STATUS_LABEL[order.status]} tone={SHOP_TONE[order.status]} />
        </View>
      }
      right={<Text style={[type.name, num, { color: colors.boneDim }]}>{formatCents(orderTotalCents(order))}</Text>}
      onPress={onPress}
    />
  );
}

/**
 * The club shop at the top of the Merch tab: the designs this member may order, their cart and their
 * orders. Nothing shows until there's something on sale for them or an order of theirs.
 */
export function ClubShopSection() {
  const navigation = useNavigation<NavigationProp<RootParams>>();
  const { me, data } = useClub();
  const { cart } = useShopCart(me?.id ?? null);
  if (!me || signedInProblem(me)) return null;
  const designs = orderableDesigns(me, data).filter((d) => garmentsOf(data, d.id).length > 0);
  const mine = myShopOrders(me, data);
  const count = cartCount(cart);
  const admin = seesShopAdmin(me, data);
  if (designs.length === 0 && mine.length === 0 && count === 0 && !admin) return null;
  const q = admin ? shopQueues(data.shopOrders ?? []) : null;
  const toAct = q ? q.held.length + q.awaitingPayment.length + q.toHandOver.length : 0;

  return (
    <>
      <SectionTitle title="Club shop" />
      <Small>Order here and the invoice comes by email. Pay by bank transfer.</Small>
      {admin ? (
        <Card style={{ padding: 0, gap: 0 }}>
          <ListRow
            last
            left={<IconBadge icon="storefront-outline" tone="red" />}
            title="Run the club shop"
            subtitle={<Text style={styles.meta}>{toAct > 0 ? `${toAct} open ${toAct === 1 ? 'order' : 'orders'}` : runsShop(me, data) ? 'Orders, catalogue and shipping' : 'Orders to mark paid'}</Text>}
            onPress={() => navigation.navigate('ShopAdmin')}
          />
        </Card>
      ) : null}
      <Card style={{ padding: 0, gap: 0 }}>
        {designs.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>Nothing on sale for you right now.</Small>
          </View>
        ) : (
          designs.map((d, i) => {
            const garments = garmentsOf(data, d.id);
            const from = Math.min(...garments.map((g) => g.priceCents));
            return (
              <ListRow
                key={d.id}
                last={i === designs.length - 1 && count === 0}
                left={<IconBadge icon="shirt-outline" />}
                title={d.name}
                subtitle={<Text style={[styles.meta, num]} numberOfLines={2}>{`${namesLine(garments.map((g) => g.name))} · from ${formatCents(from)}`}</Text>}
                onPress={() => navigation.navigate('ShopDesign', { designId: d.id })}
              />
            );
          })
        )}
        {count > 0 ? (
          <ListRow
            last
            left={<IconBadge icon="cart-outline" tone="red" />}
            title="Your cart"
            subtitle={<Text style={styles.meta}>{`${count} ${count === 1 ? 'item' : 'items'} · ${formatCents(cartSubtotal(cart.lines, data))}`}</Text>}
            onPress={() => navigation.navigate('ShopCart')}
          />
        ) : null}
      </Card>

      {mine.length > 0 ? (
        <>
          <SectionTitle title="Your shop orders" />
          <Card style={{ padding: 0, gap: 0 }}>
            {mine.map((o, i) => (
              <ShopOrderRow key={o.id} order={o} showBuyer={false} last={i === mine.length - 1} onPress={() => navigation.navigate('ShopOrder', { orderId: o.id })} />
            ))}
          </Card>
          <Small>Orders made in Discord don’t show here.</Small>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// One design: its garments, each with sizes, colours and how many
// ---------------------------------------------------------------------------

function GarmentCard({ garment, onAdded }: { garment: ShopGarment; onAdded: () => void }) {
  const { me, data } = useClub();
  const { add } = useShopCart(me?.id ?? null);
  const [size, setSize] = useState<string | null>(garment.sizes.length === 1 ? garment.sizes[0] : null);
  const [colour, setColour] = useState<string | null>(garment.colours.length === 1 ? garment.colours[0] : null);
  const [qty, setQty] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const addIt = () => {
    const p = add({ garmentId: garment.id, size: garment.sizes.length ? size : null, colour: garment.colours.length ? colour : null, qty }, data);
    setProblem(p);
    setAdded(!p);
    if (!p) {
      setQty(1);
      onAdded();
    }
  };
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: space.md }}>
        <H2 style={{ flexShrink: 1 }}>{garment.name}</H2>
        <Text style={[type.name, num]}>{formatCents(garment.priceCents)}</Text>
      </Row>
      {garment.sizes.length > 1 ? (
        <Choices<string> label="Size" options={garment.sizes.map((s) => ({ value: s, label: s }))} value={size} onChange={(v) => { setSize(v); setAdded(false); }} />
      ) : garment.sizes.length === 1 ? <Text style={styles.meta}>{`Size ${garment.sizes[0]}`}</Text> : null}
      {garment.colours.length > 1 ? (
        <Choices<string> label="Colour" options={garment.colours.map((c) => ({ value: c, label: c }))} value={colour} onChange={(v) => { setColour(v); setAdded(false); }} />
      ) : garment.colours.length === 1 ? <Text style={styles.meta}>{`Colour ${garment.colours[0]}`}</Text> : null}
      <QtyStepper qty={qty} onChange={(n) => { setQty(n); setAdded(false); }} />
      <ActionWithReason label="Add to cart" icon="cart-outline" kind="secondary" reason={problem} onPress={addIt} />
      {added ? <Notice tone="ok">Added to your cart.</Notice> : null}
    </Card>
  );
}

export function ShopDesignScreen({ route, navigation }: RootScreen<'ShopDesign'>) {
  const { me, data } = useClub();
  const { cart } = useShopCart(me?.id ?? null);
  const design = (data.shopDesigns ?? []).find((d) => d.id === route.params.designId);
  const [justAdded, setJustAdded] = useState(false);
  if (!me || !design) {
    return (
      <Screen>
        <Notice tone="info">That design isn’t in the shop.</Notice>
      </Screen>
    );
  }
  const problem = designProblem(me, design, data);
  const garments = garmentsOf(data, design.id);
  const count = cartCount(cart);
  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>{design.name}</H1>
        {design.blurb ? <Body>{design.blurb}</Body> : null}
      </Stack>
      {problem ? <Notice tone="info">{problem}</Notice> : null}
      {!problem && garments.length === 0 ? <Notice tone="info">Nothing of this design is on sale right now.</Notice> : null}
      {!problem ? garments.map((g) => <GarmentCard key={g.id} garment={g} onAdded={() => setJustAdded(true)} />) : null}
      {count > 0 ? (
        <Button
          label={`View cart · ${count} ${count === 1 ? 'item' : 'items'}`}
          icon="cart-outline"
          kind={justAdded ? 'primary' : 'secondary'}
          onPress={() => navigation.navigate('ShopCart')}
        />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// The cart
// ---------------------------------------------------------------------------

export function ShopCartScreen({ navigation }: RootScreen<'ShopCart'>) {
  const { me, data } = useClub();
  const { cart, setQty, remove } = useShopCart(me?.id ?? null);
  if (!me) return null;
  const garment = (id: string) => (data.shopGarments ?? []).find((g) => g.id === id);
  const design = (id: string | undefined) => (data.shopDesigns ?? []).find((d) => d.id === id);
  const gone = cart.lines.some((l) => {
    const g = garment(l.garmentId);
    const d = design(g?.designId);
    return !g?.onSale || !d || designProblem(me, d, data) !== null;
  });
  return (
    <Screen>
      <H1>Your cart</H1>
      {cart.lines.length === 0 ? (
        <Stack gap={space.md}>
          <Notice tone="info">Your cart is empty.</Notice>
          <Button label="Back to the shop" kind="secondary" onPress={() => navigation.goBack()} />
        </Stack>
      ) : (
        <>
          {cart.lines.map((l, i) => {
            const g = garment(l.garmentId);
            const d = design(g?.designId);
            return (
              <Card key={`${l.garmentId}-${l.size}-${l.colour}`}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: space.md }}>
                  <Text style={[type.name, { flexShrink: 1 }]}>{g && d ? `${d.name} ${g.name}` : 'No longer on sale'}</Text>
                  <Text style={[type.name, num]}>{g ? formatCents(g.priceCents * l.qty) : ''}</Text>
                </Row>
                {[l.size, l.colour].some(Boolean) ? <Text style={styles.meta}>{[l.size, l.colour].filter(Boolean).join(' · ')}</Text> : null}
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: space.md, flexWrap: 'wrap' }}>
                  <QtyStepper qty={l.qty} onChange={(n) => setQty(i, n)} label={null} />
                  <Button label="Remove" icon="trash-outline" kind="quiet" size="small" accessibilityLabel={`Remove ${g?.name ?? 'this line'}`} onPress={() => remove(i)} />
                </Row>
              </Card>
            );
          })}
          {gone ? <Notice tone="warn">Something in your cart is no longer on sale. Remove it to carry on.</Notice> : null}
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Label>Items</Label>
              <Text style={[type.name, num]}>{formatCents(cartSubtotal(cart.lines, data))}</Text>
            </Row>
            <Small>Shipping is added at checkout.</Small>
          </Card>
          <Button label="Checkout" icon="arrow-forward" disabled={gone} onPress={() => navigation.navigate('ShopCheckout')} style={{ minHeight: 56 }} />
        </>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export function ShopCheckoutScreen({ navigation }: RootScreen<'ShopCheckout'>) {
  const { me, data, placeShopOrder, refresh } = useClub();
  const { cart, sent } = useShopCart(me?.id ?? null);
  // A send whose answer was lost may still have landed: once the orders reload and it's there, go to it.
  const landed = me ? (data.shopOrders ?? []).find((o) => o.memberId === me.id && o.clientRef === cart.clientRef) : undefined;
  const mine = me ? (data.privates ?? []).find((p) => p.memberId === me.id) : undefined;
  const saved = !!mine?.street;
  const [email, setEmail] = useState(mine?.email ?? '');
  const [phone, setPhone] = useState(mine?.phone ?? '');
  const [delivery, setDelivery] = useState<ShopDelivery>(saved ? 'ship' : 'collect');
  const [street, setStreet] = useState(mine?.street ?? '');
  const [suburb, setSuburb] = useState(mine?.suburb ?? '');
  const [state, setState] = useState<string | null>(mine?.state ?? null);
  const [postcode, setPostcode] = useState(mine?.postcode ?? '');
  const [method, setMethod] = useState<ShippingMethod>('standard');
  const [saveAddress, setSaveAddress] = useState(true);
  const { busy, msg, run } = useRun();
  useEffect(() => {
    if (!landed || busy) return;
    sent();
    navigation.popToTop();
    navigation.navigate('ShopOrder', { orderId: landed.id });
  }, [landed, busy, sent, navigation]);
  if (!me) return null;
  if (cart.lines.length === 0) {
    return (
      <Screen>
        <Notice tone="info">Your cart is empty.</Notice>
      </Screen>
    );
  }
  const d: DeliveryInput = { delivery, street, suburb, state: state ?? '', postcode, shippingMethod: delivery === 'ship' ? method : null };
  const items = cartSubtotal(cart.lines, data);
  const shipping = shippingCents(d, data);
  const knownShipping = delivery === 'collect' || (state !== null && (data.shopShipping ?? []).some((s) => s.state === state && s.method === method));
  const costFor = (m: ShippingMethod) => (data.shopShipping ?? []).find((s) => s.state === state && s.method === m)?.cents;
  const methodLabel = (m: ShippingMethod, name: string) => {
    const c = costFor(m);
    return c === undefined ? name : `${name} · ${formatCents(c)}`;
  };
  const addressChanged = delivery === 'ship'
    && (street.trim() !== (mine?.street ?? '') || suburb.trim() !== (mine?.suburb ?? '') || (state ?? '') !== (mine?.state ?? '') || postcode.trim() !== (mine?.postcode ?? ''));

  const send = () =>
    run('send', async () => {
      const ref = cart.clientRef;
      let r: Awaited<ReturnType<typeof placeShopOrder>>;
      try {
        r = await placeShopOrder({
          clientRef: ref, lines: cart.lines, email, phone, delivery, street, suburb, state: state ?? '', postcode,
          shippingMethod: delivery === 'ship' ? method : null, saveAddress: delivery === 'ship' && (!saved || addressChanged) && saveAddress,
        });
      } catch (e) {
        refresh().catch(() => {}); // it may have landed anyway (see above)
        throw e;
      }
      sent();
      navigation.popToTop();
      const fresh = r.status === 'sent' || r.status === 'held';
      navigation.navigate('ShopOrder', fresh ? { orderId: r.orderId, justSent: r.status as 'sent' | 'held' } : { orderId: r.orderId });
    });

  return (
    <Screen>
      <H1>Checkout</H1>

      <Card>
        <H2>Your details</H2>
        <Fact icon="person-outline" text={me.roadName ? `${me.fullName} · ${me.roadName}` : me.fullName} />
        <Field
          label="Email for the invoice"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          maxLength={200}
          hint={mine?.email && email.trim() !== mine.email ? 'For this order only. Your saved email stays as it is.' : undefined}
        />
        <Field label="Mobile" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={30} hint="Optional." />
      </Card>

      <Card>
        <H2>Getting it</H2>
        <Choices<ShopDelivery>
          options={[{ value: 'ship', label: 'Ship to me' }, { value: 'collect', label: 'Collect at the next club meeting' }]}
          value={delivery}
          onChange={setDelivery}
        />
        {delivery === 'ship' ? (
          <Stack gap={space.md}>
            <Field label="Street" value={street} onChangeText={setStreet} autoComplete="street-address" maxLength={120} placeholder="14 Gear St" />
            <Field label="Suburb" value={suburb} onChangeText={setSuburb} maxLength={60} placeholder="Footscray" />
            <Choices<string> label="State" options={STATES.map((s) => ({ value: s, label: s }))} value={state} onChange={setState} />
            <Field label="Postcode" value={postcode} onChangeText={setPostcode} keyboardType="number-pad" autoComplete="postal-code" maxLength={4} placeholder="3011" />
            <Choices<ShippingMethod>
              label="Shipping"
              options={[{ value: 'standard', label: methodLabel('standard', 'Standard') }, { value: 'express', label: methodLabel('express', 'Express') }]}
              value={method}
              onChange={setMethod}
            />
            {!saved || addressChanged ? (
              <Toggle label="Save for next time" description="Kept on your profile. Seen by you, your chapter’s board and the national office-bearers." value={saveAddress} onChange={setSaveAddress} />
            ) : null}
          </Stack>
        ) : (
          <Small>Pick it up from the shop at the next club meeting.</Small>
        )}
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Label>Items</Label>
          <Text style={[type.name, num]}>{formatCents(items)}</Text>
        </Row>
        {delivery === 'ship' ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>Shipping</Label>
            <Text style={[type.name, num]}>{knownShipping ? formatCents(shipping) : 'On the invoice'}</Text>
          </Row>
        ) : null}
        <Row style={{ justifyContent: 'space-between' }}>
          <Label>Total</Label>
          <Text style={[type.h2, num]}>{formatCents(items + shipping)}</Text>
        </Row>
        <Small>Your invoice is the final word on the total.</Small>
      </Card>

      <ActionWithReason label="Send order" icon="send" big busy={busy === 'send'} reason={msg?.tone === 'danger' ? msg.text : null} onPress={send} />
      <Small>
        Your name, contact details, address and items go to the club’s order system (Make.com, Google Sheets and Resend), which emails your
        invoice. Pay by bank transfer once it arrives.
      </Small>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One order
// ---------------------------------------------------------------------------

/** How to pay a shop order. The invoice carries the club's account (the Club fund's), so the app doesn't repeat one. */
function HowToPayShop({ order }: { order: ShopOrder }) {
  return (
    <Card>
      <H2>How to pay</H2>
      <Body>Bank transfer to the account on your invoice.</Body>
      <View style={{ gap: 2 }}>
        <Label>Put this in the description</Label>
        <Body>The order number on your invoice (it starts RSMC#).</Body>
      </View>
      <Text style={[type.name, num]}>{`Amount: the total on your invoice, about ${formatCents(orderTotalCents(order))}`}</Text>
    </Card>
  );
}

export function ShopOrderScreen({ route }: RootScreen<'ShopOrder'>) {
  const { me, data, today, cancelShopOrder, payShopOrder, handOverShopOrder, resendShopOrder } = useClub();
  const order = (data.shopOrders ?? []).find((o) => o.id === route.params.orderId);
  const { busy, msg, run: runAny } = useRun();
  const [last, setLast] = useState('');
  const run = (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setLast(key);
    return runAny(key, fn, ok);
  };
  const paidOn = useDate(today);
  const [amount, setAmount] = useState(order ? (orderTotalCents(order) / 100).toFixed(2) : '');
  if (!me || !order) {
    return (
      <Screen>
        <Notice tone="info">That order isn’t here.</Notice>
      </Screen>
    );
  }
  const mine = order.memberId === me.id;
  const justSent = mine ? route.params.justSent : undefined;
  const failed = msg?.tone === 'danger' ? msg.text : null;
  const fail = (key: string) => (last === key ? failed : null);
  const runs = runsShop(me, data);
  const keeper = keepsBooks(me, null, data.positions);
  const canCancel = (mine && (order.status === 'held' || order.status === 'sent')) || (runs && !mine && (order.status === 'held' || order.status === 'sent'));
  const cents = parseDollars(amount);

  return (
    <Screen>
      <Stack gap={space.sm}>
        <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
          <Chip label={STATUS_LABEL[order.status]} tone={SHOP_TONE[order.status]} />
        </Row>
        <H1>{`Order ${shopOrderRef(order)}`}</H1>
        <Text style={[type.h2, num]}>{formatCents(orderTotalCents(order))}</Text>
        {mine ? <Small>{MEMBER_STATUS_LINE[order.status]}</Small> : null}
      </Stack>

      {justSent === 'sent' ? (
        <Notice tone="ok" title="Order sent">
          {`Your invoice with the club’s bank details is on its way to ${order.email}. Pay by bank transfer; the order number on the invoice is the reference.`}
        </Notice>
      ) : null}
      {justSent === 'held' ? (
        <Notice tone="info" title="Order kept">We’ve kept your order; the shop will send it on. Your invoice comes by email once it has.</Notice>
      ) : null}

      <Card>
        {order.lines.map((l) => (
          <Row key={l.id} style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.name}>{`${l.designName} ${l.garmentName}`}</Text>
              <Text style={styles.meta}>{lineOptions(l)}</Text>
            </View>
            <Text style={[type.name, num]}>{formatCents(l.unitCents * l.qty)}</Text>
          </Row>
        ))}
        <View style={{ height: 1, backgroundColor: colors.line }} />
        {order.delivery === 'ship' ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>Shipping</Label>
            <Text style={[type.name, num]}>{formatCents(order.shippingCents)}</Text>
          </Row>
        ) : null}
        <Row style={{ justifyContent: 'space-between' }}>
          <Label>Total</Label>
          <Text style={[type.name, num]}>{formatCents(orderTotalCents(order))}</Text>
        </Row>
        <Small>The invoice is the final word on the total.</Small>
      </Card>

      <Card>
        <Stack gap={space.sm}>
          {!mine ? <Fact icon="person-outline" text={order.roadName ? `${order.buyerName} · ${order.roadName}` : order.buyerName} /> : null}
          {order.delivery === 'ship' ? (
            <Fact
              icon="cube-outline"
              text={`${order.shippingMethod === 'express' ? 'Express' : 'Standard'} to ${[order.street, order.suburb, order.state, order.postcode].filter(Boolean).join(', ') || 'the address on the invoice'}`}
            />
          ) : (
            <Fact icon="people-outline" text="Collect at the next club meeting" />
          )}
          <Fact icon="mail-outline" text={order.email || 'No email'} />
          {order.phone ? <Fact icon="call-outline" text={order.phone} /> : null}
          <Fact icon="calendar-outline" text={`Ordered ${formatAuDate(melbourneDate(order.orderedAt))}`} />
          {order.paidOn ? <Fact icon="cash-outline" text={`Paid ${formatAuDate(order.paidOn)}${order.paidCents !== null ? ` · ${formatCents(order.paidCents)}` : ''}`} tone="ok" /> : null}
          {order.handedOverOn ? (
            <Fact icon="bag-check-outline" text={`${order.status === 'collected' ? 'Collected' : 'Posted'} ${formatAuDate(order.handedOverOn)}`} />
          ) : null}
          {order.cancelledAt ? <Fact icon="close-circle-outline" text={`Cancelled ${formatAuDate(melbourneDate(order.cancelledAt))}`} /> : null}
        </Stack>
      </Card>

      {mine && order.status === 'sent' ? <HowToPayShop order={order} /> : null}

      {order.status === 'held' && runs ? (
        <>
          <SectionTitle title="Not sent to Make" />
          <Card>
            <Small>{order.makeError ? `Last try: ${order.makeError}` : 'Make hasn’t taken this order yet.'}</Small>
            <ActionWithReason
              label="Send to Make again"
              icon="refresh"
              busy={busy === 'resend'}
              reason={fail('resend')}
              onPress={() => run('resend', async () => {
                const status = await resendShopOrder(order.id);
                if (status === 'held') throw new Error('Make still didn’t take it. Try again later.');
              }, 'Sent. Make is emailing the invoice.')}
            />
          </Card>
        </>
      ) : null}

      {order.status === 'sent' && keeper && !mine ? (
        <>
          <SectionTitle title="Money in" />
          <Card>
            <Small>Marking it paid adds a Merchandise sales line (CR-005) to the Club fund for the amount received.</Small>
            <DateField label="Paid on" date={paidOn} />
            <Field
              label="Amount received"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              hint="The app’s total is filled in. Change it if the invoice or the transfer differs."
              error={amount.trim() && cents === null ? 'Enter an amount, like 82 or 82.50.' : null}
            />
            <ActionWithReason
              label="Mark paid"
              icon="cash-outline"
              busy={busy === 'pay'}
              reason={fail('pay')}
              onPress={() => run('pay', async () => {
                if (cents === null) throw new Error('Enter the amount received.');
                if (!paidOn.iso) throw new Error('Pick the day it was paid.');
                await payShopOrder(order.id, paidOn.iso, cents);
              }, 'Paid, and in the Club fund’s books.')}
            />
          </Card>
        </>
      ) : null}
      {order.status === 'sent' && keeper && mine ? <Small>Someone else records your own payment.</Small> : null}

      {order.status === 'paid' && runs ? (
        <ActionWithReason
          label={handedOverStatus(order) === 'posted' ? 'Mark posted' : 'Mark collected'}
          icon={handedOverStatus(order) === 'posted' ? 'cube-outline' : 'bag-check-outline'}
          busy={busy === 'hand'}
          reason={fail('hand')}
          onPress={() => run('hand', () => handOverShopOrder(order.id), handedOverStatus(order) === 'posted' ? 'Marked posted.' : 'Marked collected.')}
        />
      ) : null}

      {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}

      {canCancel ? (
        <Stack gap={space.sm}>
          <ConfirmButton
            label="Cancel order"
            confirmLabel="Yes, cancel it"
            kind="secondary"
            confirmNote={
              order.status !== 'sent' ? undefined
                : mine ? 'Your invoice has already been emailed. Reply to that email to tell the shop it’s cancelled.'
                  : 'Their invoice has already been emailed. Let them know it’s cancelled.'
            }
            onConfirm={() => run('cancel', () => cancelShopOrder(order.id), mine ? 'Cancelled. If your invoice came, reply to it to tell the shop.' : 'Cancelled.')}
          />
          {busy === 'cancel' ? <Small>Cancelling…</Small> : null}
          {fail('cancel') ? <Notice tone="danger">{fail('cancel')}</Notice> : null}
        </Stack>
      ) : null}

    </Screen>
  );
}

