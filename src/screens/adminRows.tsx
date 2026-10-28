// Stage 5D's ways in: rows on the Board screen, the Me screen and the Chapters screen.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React from 'react';
import { useClub } from '../data/ClubStore';
import { appealOpen, conductFor, recordsConductFor, visibleConduct } from '../domain/conduct';
import { ordersToAct, visibleItems } from '../domain/merch';
import { contributionsToDecide } from '../domain/national';
import type { RootParams } from '../navigation/types';
import { Card, IconBadge, ListRow, SectionTitle } from '../ui/primitives';

type Nav = NavigationProp<RootParams>;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Board screen: Conduct records, Merch and National, each with what's waiting. */
export function BoardAdminCard() {
  const { me, data, today } = useClub();
  const navigation = useNavigation<Nav>();
  if (!me) return null;
  const records = visibleConduct(me, data, today).filter((r) => r.memberId !== me.id);
  const open = records.filter(appealOpen).length;
  const orders = ordersToAct(me, data).length;
  const waitingItems = visibleItems(me, data).filter((i) => i.status === 'proposed').length;
  const decide = contributionsToDecide(me, data).length;
  const proposals = (data.chapterProposals ?? []).filter((p) => p.status === 'proposed').length;
  const showConduct = recordsConductFor(me, data) || records.length > 0;
  const merchNotes = [orders > 0 ? count(orders, 'order') + ' to act on' : null, waitingItems > 0 ? count(waitingItems, 'item') + ' waiting' : null].filter(Boolean);
  const nationalNotes = [decide > 0 ? `${decide} to decide` : null, proposals > 0 ? count(proposals, 'new chapter') : null].filter(Boolean);
  return (
    <Card style={{ padding: 0, gap: 0 }}>
      {showConduct ? (
        <ListRow
          left={<IconBadge icon="shield-outline" tone={open > 0 ? 'red' : 'steel'} />}
          title="Conduct records"
          subtitle={open > 0 ? `${count(open, 'review or appeal', 'reviews or appeals')} open` : `${count(records.length, 'record')} · each goes after 12 months`}
          onPress={() => navigation.navigate('Conduct')}
        />
      ) : null}
      <ListRow
        left={<IconBadge icon="shirt-outline" tone={orders > 0 ? 'red' : 'steel'} />}
        title="Merch"
        subtitle={merchNotes.length > 0 ? merchNotes.join(' · ') : 'Club gear, orders and approvals'}
        onPress={() => navigation.navigate('Merch')}
      />
      <ListRow
        last
        left={<IconBadge icon="flag-outline" tone={decide > 0 ? 'red' : 'steel'} />}
        title="National"
        subtitle={nationalNotes.length > 0 ? nationalNotes.join(' · ') : 'Contributions and new chapters'}
        onPress={() => navigation.navigate('National')}
      />
    </Card>
  );
}

/** Me screen: Merch for everyone, and their own records when there are any. */
export function MeAdminSection() {
  const { me, data, today } = useClub();
  const navigation = useNavigation<Nav>();
  if (!me || me.approval !== 'approved') return null;
  const mine = conductFor(me.id, me, data, today);
  const myOrders = (data.merchOrders ?? []).filter((o) => o.memberId === me.id && (o.status === 'approved' || o.status === 'waiting'));
  const toPay = myOrders.filter((o) => o.status === 'approved').length;
  return (
    <>
      <SectionTitle title={mine.length > 0 ? 'Club gear and records' : 'Club gear'} />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          last={mine.length === 0}
          left={<IconBadge icon="shirt-outline" tone={toPay > 0 ? 'red' : 'steel'} />}
          title="Merch"
          subtitle={toPay > 0 ? `${count(toPay, 'order')} to pay` : myOrders.length > 0 ? `${count(myOrders.length, 'order')} waiting` : 'Tees, hoodies and patches'}
          onPress={() => navigation.navigate('Merch')}
        />
        {mine.length > 0 ? (
          <ListRow
            last
            left={<IconBadge icon="document-text-outline" />}
            title="Your records"
            subtitle={mine.some(appealOpen) ? 'Review or appeal open' : `${count(mine.length, 'record')} · you can ask for a review`}
            onPress={() => navigation.navigate('Conduct', { mine: true })}
          />
        ) : null}
      </Card>
    </>
  );
}

/** Chapters screen: new chapters and national contributions. */
export function ChaptersNationalRow() {
  const { data } = useClub();
  const navigation = useNavigation<Nav>();
  const open = (data.chapterProposals ?? []).filter((p) => p.status === 'proposed').length;
  return (
    <Card style={{ padding: 0, gap: 0 }}>
      <ListRow
        last
        left={<IconBadge icon="map-outline" />}
        title="New chapters"
        subtitle={open > 0 ? `${count(open, 'proposal')} open · contributions` : 'Propose one, and national contributions'}
        onPress={() => navigation.navigate('National')}
      />
    </Card>
  );
}
