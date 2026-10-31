// Delete my account (both app stores require it). Says plainly what goes, what the club keeps
// without a name, and that the club membership itself isn't touched.

import React, { useState } from 'react';
import { View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { deleteAccountProblem } from '../domain/account';
import { Body, Card, ConfirmButton, H2, Notice, Screen, Small } from '../ui/primitives';
import { space } from '../theme';

const DELETED = [
  'Your sign-in, so this email can’t open the app any more',
  'Contact details, licence and first aid dates',
  'Emergency contacts, bikes and regos',
  'Chat messages and reactions',
  'Ride sign-ups, crew spots, ratings and charity sign-ups',
  'Swap and sell listings, build threads, bragging rights nominations, skills and your birthday',
  'Notification settings and this phone’s alerts',
];

const KEPT = [
  'Fees, payments and anything in the club’s books',
  'Meeting minutes, votes and action items',
  'Attendance, status changes, 5.5 notices and conduct records',
  'Board seats you held in the past',
  'Chat messages someone has reported, for the board to deal with',
];

function List({ items }: { items: string[] }) {
  return (
    <View style={{ gap: space.xs }}>
      {items.map((t) => (
        <Body key={t}>{`•  ${t}`}</Body>
      ))}
    </View>
  );
}

export function DeleteAccountScreen() {
  const { me, data, deleteMyAccount, isDemo } = useClub();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Someone who signed in but hasn't asked to join has no member record, only the sign-in.
  const problem = me ? deleteAccountProblem(me, data.positions) : null;

  const remove = () => {
    setError(null);
    setBusy(true);
    deleteMyAccount().catch((e: Error) => {
      setError(`Couldn’t delete your account: ${e.message}`);
      setBusy(false);
    });
  };

  return (
    <Screen>
      {problem ? <Notice tone="warn" title="Step down first">{problem}</Notice> : null}
      <Card>
        <H2>Deleted straight away</H2>
        <List items={DELETED} />
        <Small>Nobody can open the photos from what’s deleted. The board clears the files themselves.</Small>
      </Card>
      <Card>
        <H2>Kept by the club, without your name</H2>
        <List items={KEPT} />
        <Small>These show as “Former member”. The club has to keep its books and minutes.</Small>
      </Card>
      <Card>
        <H2>Not changed</H2>
        <Body>
          Your club membership. Deleting the app account isn’t resigning: talk to your chapter Secretary for that.
        </Body>
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!problem ? (
        <ConfirmButton
          label={busy ? 'Deleting…' : 'Delete my account'}
          confirmLabel="Yes, delete it for good"
          confirmNote="This can’t be undone."
          icon="trash-outline"
          disabled={busy}
          onConfirm={remove}
        />
      ) : null}
      {isDemo ? <Small style={{ textAlign: 'center' }}>Demo build: nothing real is deleted.</Small> : null}
    </Screen>
  );
}
