// Running the club shop: the orders (resend, mark paid, posted or collected), the catalogue (designs,
// garments, prices, on or off sale), the shipping table and the shop runners.
// Spec: docs/superpowers/specs/2026-11-01-in-app-merch-ordering-design.md (piece 4).

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { formatCents, parseDollars } from '../domain/fees';
import { displayName } from '../domain/profile';
import { STATES, SHIPPING_METHODS, holdsShopSeat, runsShop } from '../domain/shop';
import { ELIGIBILITY_LABEL, listFromText, seesShopAdmin, shopQueues } from '../domain/shopAdmin';
import type { ShippingMethod, ShopEligibility, ShopGarment, ShopOrder } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import {
  Button, Card, Chip, Choices, ConfirmButton, Field, H1, H2, IconBadge, Label, ListRow, Notice, Row, Screen, SectionTitle, Small, Stack, Toggle,
} from '../ui/primitives';
import { ActionWithReason, MemberPicker, styles, useRun } from './adminBits';
import { ShopOrderRow } from './shop';

const num = { fontVariant: ['tabular-nums' as const] };
const DONE_SHOWN = 20;

function OrderList({ title, note, orders, onOpen }: { title: string; note?: string; orders: ShopOrder[]; onOpen: (o: ShopOrder) => void }) {
  if (orders.length === 0) return null;
  return (
    <>
      <SectionTitle title={title} action={<Text style={styles.count}>{orders.length}</Text>} />
      {note ? <Small>{note}</Small> : null}
      <Card style={{ padding: 0, gap: 0 }}>
        {orders.map((o, i) => <ShopOrderRow key={o.id} order={o} showBuyer last={i === orders.length - 1} onPress={() => onOpen(o)} />)}
      </Card>
    </>
  );
}

export function ShopAdminScreen({ navigation }: RootScreen<'ShopAdmin'>) {
  const { me, data } = useClub();
  if (!me || !seesShopAdmin(me, data)) {
    return (
      <Screen>
        <Notice tone="info">Only the people who run the shop and the treasurers see this.</Notice>
      </Screen>
    );
  }
  const runs = runsShop(me, data);
  const q = shopQueues(data.shopOrders ?? []);
  const open = (o: ShopOrder) => navigation.navigate('ShopOrder', { orderId: o.id });
  const designs = [...(data.shopDesigns ?? [])].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const garmentCount = (id: string) => (data.shopGarments ?? []).filter((g) => g.designId === id).length;
  const nothingOpen = q.held.length + q.awaitingPayment.length + q.toHandOver.length === 0;

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Club shop</H1>
        <Small>Orders from the app’s Merch tab. Discord orders stay in the Orders sheet.</Small>
      </Stack>

      {nothingOpen ? <Notice tone="info">No open orders.</Notice> : null}
      <OrderList title="Not sent to Make" note="Saved in the app, but Make hasn’t taken them. Open one to send it again." orders={q.held} onOpen={open} />
      <OrderList title="Waiting for payment" note="Invoice emailed. A treasurer marks it paid when the money lands." orders={q.awaitingPayment} onOpen={open} />
      <OrderList title="Paid, to post or hand over" orders={q.toHandOver} onOpen={open} />
      <OrderList title="Done" orders={q.done.slice(0, DONE_SHOWN)} onOpen={open} />

      {runs ? (
        <>
          <SectionTitle title="Catalogue" />
          <Card style={{ padding: 0, gap: 0 }}>
            {designs.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <Small>No designs yet.</Small>
              </View>
            ) : (
              designs.map((d, i) => (
                <ListRow
                  key={d.id}
                  last={i === designs.length - 1}
                  left={<IconBadge icon="shirt-outline" />}
                  title={d.name}
                  subtitle={
                    <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
                      <Text style={styles.meta}>{`${ELIGIBILITY_LABEL[d.eligibility]} · ${garmentCount(d.id)} ${garmentCount(d.id) === 1 ? 'garment' : 'garments'}`}</Text>
                      {!d.onSale ? <Chip label="Off sale" tone="steel" /> : null}
                    </View>
                  }
                  onPress={() => navigation.navigate('ShopDesignEdit', { designId: d.id })}
                />
              ))
            )}
          </Card>
          <Button label="Add a design" kind="secondary" icon="add" onPress={() => navigation.navigate('ShopDesignEdit', {})} />

          <SectionTitle title="Shipping" />
          <Card style={{ padding: 0, gap: 0 }}>
            <ListRow
              last
              left={<IconBadge icon="cube-outline" />}
              title="Shipping costs"
              subtitle={`${(data.shopShipping ?? []).length} of ${STATES.length * SHIPPING_METHODS.length} set · copy of Make’s table`}
              onPress={() => navigation.navigate('ShopShipping')}
            />
          </Card>

          <SectionTitle title="Shop runners" />
          <Small>The NEC Chair and Secretary, the Presidents and the Treasurers run the shop. They can name others to help.</Small>
          <ShopRunners />
        </>
      ) : null}
    </Screen>
  );
}

function ShopRunners() {
  const { me, data, nameShopRunner, unnameShopRunner } = useClub();
  const [picked, setPicked] = useState<string[]>([]);
  const { busy, msg, run } = useRun();
  if (!me) return null;
  const runners = data.shopRunners ?? [];
  const names = holdsShopSeat(me, data.positions);
  const nameOf = (id: string) => {
    const m = data.members.find((x) => x.id === id);
    return m ? displayName(m) : 'A former member';
  };
  const choices = data.members.filter(
    (m) => m.approval === 'approved' && m.status !== 'legacy' && m.status !== 'family' && !runners.some((r) => r.memberId === m.id),
  );
  return (
    <>
      <Card style={{ padding: 0, gap: 0 }}>
        {runners.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>Nobody named yet.</Small>
          </View>
        ) : (
          runners.map((r, i) => (
            <ListRow
              key={r.memberId}
              last={i === runners.length - 1}
              left={<IconBadge icon="person-outline" />}
              title={nameOf(r.memberId)}
              subtitle={<Text style={styles.meta}>{`Named by ${r.namedBy ? nameOf(r.namedBy) : 'the club'}`}</Text>}
              right={
                names ? (
                  <ConfirmButton
                    label="Take off"
                    confirmLabel="Yes"
                    size="small"
                    kind="secondary"
                    accessibilityLabel={`Take ${nameOf(r.memberId)} off the shop runners`}
                    onConfirm={() => run(`off-${r.memberId}`, () => unnameShopRunner(r.memberId), `${nameOf(r.memberId)} no longer runs the shop.`)}
                  />
                ) : undefined
              }
            />
          ))
        )}
      </Card>
      {names ? (
        <Card>
          <MemberPicker label="Name a shop runner" choices={choices} picked={picked} onChange={setPicked} />
          <ActionWithReason
            label="Name them"
            icon="person-add-outline"
            kind="secondary"
            busy={busy === 'name'}
            reason={msg?.tone === 'danger' ? msg.text : null}
            onPress={() => {
              const id = picked[0];
              if (!id) return;
              run('name', async () => {
                await nameShopRunner(id);
                setPicked([]);
              }, `${nameOf(id)} now runs the shop.`);
            }}
          />
        </Card>
      ) : null}
      {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// A design and its garments
// ---------------------------------------------------------------------------

const intOr = (text: string, fallback: number) => (/^-?\d+$/.test(text.trim()) ? Number(text.trim()) : fallback);

export function ShopDesignEditScreen({ route, navigation }: RootScreen<'ShopDesignEdit'>) {
  const { me, data, setShopDesign } = useClub();
  const design = route.params.designId ? (data.shopDesigns ?? []).find((d) => d.id === route.params.designId) : undefined;
  const [name, setName] = useState(design?.name ?? '');
  const [eligibility, setEligibility] = useState<ShopEligibility>(design?.eligibility ?? 'any');
  const [blurb, setBlurb] = useState(design?.blurb ?? '');
  const [sort, setSort] = useState(String(design?.sort ?? (data.shopDesigns ?? []).length + 1));
  const [onSale, setOnSale] = useState(design?.onSale ?? true);
  const { busy, msg, run } = useRun();
  if (!me || !runsShop(me, data)) {
    return (
      <Screen>
        <Notice tone="info">Only the people who run the shop change the catalogue.</Notice>
      </Screen>
    );
  }
  if (route.params.designId && !design) {
    return (
      <Screen>
        <Notice tone="info">That design isn’t in the shop.</Notice>
      </Screen>
    );
  }
  const garments = design
    ? (data.shopGarments ?? []).filter((g) => g.designId === design.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    : [];
  const save = () =>
    run('save', async () => {
      if (!/^-?\d+$/.test(sort.trim())) throw new Error('Sort order is a whole number.');
      const id = await setShopDesign({ id: design?.id ?? null, name, eligibility, blurb, sort: intOr(sort, 0), onSale });
      if (!design) navigation.replace('ShopDesignEdit', { designId: id });
    }, design ? 'Saved.' : undefined);

  return (
    <Screen>
      <H1>{design ? design.name : 'New design'}</H1>
      <Field label="Name" value={name} onChangeText={setName} maxLength={60} placeholder="Better with you" />
      <Choices<ShopEligibility>
        label="Who can order it"
        options={(['any', 'patched', 'family'] as ShopEligibility[]).map((e) => ({ value: e, label: ELIGIBILITY_LABEL[e] }))}
        value={eligibility}
        onChange={setEligibility}
      />
      <Field label="About it" value={blurb} onChangeText={setBlurb} multiline maxLength={300} hint="Optional. Shown above the garments." />
      <Field label="Sort order" value={sort} onChangeText={setSort} keyboardType="number-pad" hint="Lower numbers show first." />
      <Card>
        <Toggle label="On sale" description="Off sale hides it from members. Orders already in carry on." value={onSale} onChange={setOnSale} />
      </Card>
      <ActionWithReason label={design ? 'Save design' : 'Add design'} icon="checkmark" busy={busy === 'save'} reason={msg?.tone === 'danger' ? msg.text : null} onPress={save} />
      {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}

      {design ? (
        <>
          <SectionTitle title="Garments" />
          <Card style={{ padding: 0, gap: 0 }}>
            {garments.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <Small>No garments yet. Add one so members can order this design.</Small>
              </View>
            ) : (
              garments.map((g, i) => <GarmentRow key={g.id} garment={g} last={i === garments.length - 1} onPress={() => navigation.navigate('ShopGarmentEdit', { designId: design.id, garmentId: g.id })} />)
            )}
          </Card>
          <Button label="Add a garment" kind="secondary" icon="add" onPress={() => navigation.navigate('ShopGarmentEdit', { designId: design.id })} />
        </>
      ) : null}
    </Screen>
  );
}

function GarmentRow({ garment, last, onPress }: { garment: ShopGarment; last: boolean; onPress: () => void }) {
  const options = [garment.sizes.length ? garment.sizes.join(' ') : 'One size', garment.colours.length ? garment.colours.join(', ') : null].filter(Boolean).join(' · ');
  return (
    <ListRow
      last={last}
      title={garment.name}
      subtitle={
        <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
          <Text style={styles.meta} numberOfLines={2}>{options}</Text>
          {!garment.onSale ? <Chip label="Off sale" tone="steel" /> : null}
        </View>
      }
      right={<Text style={[type.name, num, { color: colors.boneDim }]}>{formatCents(garment.priceCents)}</Text>}
      onPress={onPress}
    />
  );
}

export function ShopGarmentEditScreen({ route, navigation }: RootScreen<'ShopGarmentEdit'>) {
  const { me, data, setShopGarment } = useClub();
  const design = (data.shopDesigns ?? []).find((d) => d.id === route.params.designId);
  const garment = route.params.garmentId ? (data.shopGarments ?? []).find((g) => g.id === route.params.garmentId) : undefined;
  const [name, setName] = useState(garment?.name ?? '');
  const [price, setPrice] = useState(garment ? (garment.priceCents / 100).toFixed(2) : '');
  const [sizes, setSizes] = useState(garment ? garment.sizes.join(', ') : 'S, M, L, XL, 2XL, 3XL');
  const [colours, setColours] = useState(garment ? garment.colours.join(', ') : 'Black');
  const [sort, setSort] = useState(String(garment?.sort ?? (data.shopGarments ?? []).filter((g) => g.designId === route.params.designId).length + 1));
  const [onSale, setOnSale] = useState(garment?.onSale ?? true);
  const { busy, msg, run } = useRun();
  if (!me || !runsShop(me, data)) {
    return (
      <Screen>
        <Notice tone="info">Only the people who run the shop change the catalogue.</Notice>
      </Screen>
    );
  }
  if (!design || (route.params.garmentId && !garment)) {
    return (
      <Screen>
        <Notice tone="info">That garment isn’t in the shop.</Notice>
      </Screen>
    );
  }
  const cents = parseDollars(price);
  const save = () =>
    run('save', async () => {
      if (cents === null) throw new Error('Enter a price from $0.01 to $1,000.');
      if (!/^-?\d+$/.test(sort.trim())) throw new Error('Sort order is a whole number.');
      await setShopGarment({
        id: garment?.id ?? null, designId: design.id, name, priceCents: cents, sizes: listFromText(sizes), colours: listFromText(colours),
        sort: intOr(sort, 0), onSale,
      });
      navigation.goBack();
    });
  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>{garment ? `${design.name} ${garment.name}` : 'New garment'}</H1>
        {!garment ? <Small>{`For the ${design.name} design.`}</Small> : null}
      </Stack>
      <Field label="Name" value={name} onChangeText={setName} maxLength={60} placeholder="Hoodie" />
      <Field
        label="Price"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder="65"
        error={price.trim() && cents === null ? 'Enter an amount, like 65 or 32.50.' : null}
      />
      <Field label="Sizes" value={sizes} onChangeText={setSizes} autoCapitalize="characters" hint="Separate with commas, up to 12. Leave blank for one size." />
      <Field label="Colours" value={colours} onChangeText={setColours} hint="Separate with commas, up to 12. Leave blank for no colour pick." />
      <Field label="Sort order" value={sort} onChangeText={setSort} keyboardType="number-pad" hint="Lower numbers show first." />
      <Card>
        <Toggle label="On sale" description="Off sale hides it from members." value={onSale} onChange={setOnSale} />
      </Card>
      <ActionWithReason label={garment ? 'Save garment' : 'Add garment'} icon="checkmark" busy={busy === 'save'} reason={msg?.tone === 'danger' ? msg.text : null} onPress={save} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// The shipping table (a copy of Make's, so the cart can show a total)
// ---------------------------------------------------------------------------

function ShippingState({ state }: { state: string }) {
  const { data, setShopShipping } = useClub();
  const cost = (m: ShippingMethod) => (data.shopShipping ?? []).find((s) => s.state === state && s.method === m)?.cents;
  const show = (c: number | undefined) => (c === undefined ? '' : (c / 100).toFixed(2));
  const [standard, setStandard] = useState(show(cost('standard')));
  const [express, setExpress] = useState(show(cost('express')));
  const { busy, msg, run } = useRun();
  const save = () =>
    run('save', async () => {
      for (const [method, text] of [['standard', standard], ['express', express]] as [ShippingMethod, string][]) {
        if (!text.trim()) continue;
        const cents = parseDollars(text);
        if (cents === null) throw new Error('Enter a shipping cost from $0 to $1,000.');
        if (cents === cost(method)) continue;
        await setShopShipping({ state, method, cents });
      }
    }, `${state} saved.`);
  return (
    <Card>
      <H2>{state}</H2>
      <Row style={{ gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Field label="Standard" value={standard} onChangeText={setStandard} keyboardType="decimal-pad" placeholder="Not set" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Express" value={express} onChangeText={setExpress} keyboardType="decimal-pad" placeholder="Not set" />
        </View>
      </Row>
      <ActionWithReason label={`Save ${state}`} kind="secondary" busy={busy === 'save'} reason={msg?.tone === 'danger' ? msg.text : null} onPress={save} />
      {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}
    </Card>
  );
}

export function ShopShippingScreen() {
  const { me, data } = useClub();
  if (!me || !runsShop(me, data)) {
    return (
      <Screen>
        <Notice tone="info">Only the people who run the shop change shipping.</Notice>
      </Screen>
    );
  }
  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Shipping costs</H1>
        <Small>
          A copy of the shipping table in Make, so the cart can show a total. Make works out the invoice from its own table, so change both
          together. A state left blank shows “On the invoice” at checkout.
        </Small>
      </Stack>
      <Label>Dollars per order</Label>
      {STATES.map((s) => <ShippingState key={s} state={s} />)}
    </Screen>
  );
}
