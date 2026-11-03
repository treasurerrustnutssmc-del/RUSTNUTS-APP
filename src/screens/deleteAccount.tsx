// Delete my account (both app stores require it). Says plainly what goes, what the club keeps,
// and that the club membership itself isn't touched. Keep in step with site/delete-account.html.

import React, { useState } from 'react';
import { View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { deleteAccountProblem, stepDownSeats, type SeatToStepDown } from '../domain/account';
import { seatTitle } from '../domain/home';
import { ROLE_LABEL } from '../domain/labels';
import { Body, Card, ConfirmButton, H2, Notice, Screen, Small } from '../ui/primitives';
import { colors, space } from '../theme';

const DELETED = [
  'Your sign-in. Signing in again with this email starts a new request to join',
  'Contact details, licence and first aid dates',
  'Emergency contacts, bikes and regos',
  'Chat messages and reactions',
  'Ride sign-ups, crew spots, ratings and charity sign-ups',
  'Swap and sell listings, build threads, bragging rights nominations, skills and your birthday',
  'Notification settings and this phone’s alerts',
];

const KEPT = [
  'If the club loaded your place from its roster: the roster keeps your name, email, membership level and dates',
  'Fees, payments and anything in the club’s books',
  'Copies of your club shop orders in the club’s order system (Make.com, Google Sheets, Docs and Drive, and Resend), as financial records',
  'Meeting minutes, votes and action items',
  'Attendance, status changes, 5.5 notices and conduct records',
  'Board seats you held in the past',
  'Rusty Bus bookings and logs, routes you uploaded and past merch orders',
  'Anything someone has reported (a message, a post or your profile), as it was when reported, for the board to deal with',
  'On the website photo crew: photos you put on the club website from your phone (take them down first if you want them gone)',
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

/** Each seat in the way: a step-down for the ones they can end themselves (the same one as on their
 *  member page), and who records the change for the rest. */
function StepDownSeats({ seats }: { seats: SeatToStepDown[] }) {
  const { data, endPosition } = useClub();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <H2>Your seats</H2>
      {error ? <Small style={{ color: colors.warn }}>{error}</Small> : null}
      {seats.map(({ position: p, selfEnd, note }) => {
        const role = seatTitle(p, data.chapters, ROLE_LABEL);
        return selfEnd ? (
          <ConfirmButton
            key={p.id}
            label={`Step down as ${role}`}
            confirmLabel="Yes, step down"
            confirmAccessibilityLabel={`Yes, step down as ${role}`}
            kind="secondary"
            size="small"
            onConfirm={() => endPosition(p.id).then(() => setError(null), (e: Error) => setError(e.message))}
          />
        ) : (
          <Body key={p.id}>{`${role}: ${note}`}</Body>
        );
      })}
    </Card>
  );
}

export function DeleteAccountScreen() {
  const { me, data, today, deleteMyAccount, isDemo } = useClub();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Someone who signed in but hasn't asked to join has no member record, only the sign-in.
  const problem = me ? deleteAccountProblem(me, data.positions) : null;
  const seats = problem ? stepDownSeats(me, data, today) : [];

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
      {seats.length > 0 ? <StepDownSeats seats={seats} /> : null}
      <Card>
        <H2>Deleted straight away</H2>
        <List items={DELETED} />
        <Small>Nobody can open the photos from what’s deleted. The board clears the files themselves.</Small>
      </Card>
      <Card>
        <H2>Kept by the club</H2>
        <List items={KEPT} />
        <Small>The roster, the shop order copies and anything reported keep your name. Everything else here shows as “Former member”; names typed into free text (for example minutes) aren’t changed. The club has to keep its books and minutes.</Small>
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
