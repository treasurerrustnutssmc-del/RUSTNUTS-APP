// Family view: Home, one ride and Me for partners and kids, who use the app with no Club rights.
// The Rides tab is the members' one (Family get no answers, crew or route library). What Family
// may see is decided by the database; see docs/superpowers/specs/2026-10-29-family-view-design.md.

import React from 'react';
import { Linking, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { describeExpiry, formatAuDate, weekday } from '../domain/dates';
import { nextRides } from '../domain/family';
import { displayName, initials } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import type { RootScreen, TabScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  H1,
  IconBadge,
  Ionicons,
  ListRow,
  LockNote,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  StatusChip,
} from '../ui/primitives';
import { ClubLinksSection } from './clubLinks';
import { SponsorsSection } from './sponsors'; // Sponsors
import { RideChip, RideRow, timeRange } from './rides';

const mapsUrl = (place: string) => `https://maps.google.com/?q=${encodeURIComponent(place)}`;

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export function FamilyHomeScreen({ navigation }: TabScreen<'Home'>) {
  const { me, data, today, isDemo, refresh } = useClub();
  if (!me) return null;
  const chapter = data.chapters.find((c) => c.id === me.chapterId);
  const coming = nextRides(data.rides, today);
  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Card>
        <H1>G’day, {displayName(me).split(' ')[0]}</H1>
        <Row style={{ gap: 6 }}>
          <StatusChip status={me.status} />
          {chapter ? <Chip label={`${chapter.name} chapter`} tone="bone" /> : null}
        </Row>
        <Body style={{ color: colors.boneDim }}>
          You’re in as family. You can see when the club’s riding and where it meets, show your card at club events, and
          keep your own details up to date.
        </Body>
      </Card>

      <SectionTitle
        title="Coming up"
        action={coming.length > 0 ? <Button label="All rides" kind="quiet" onPress={() => navigation.navigate('Rides')} /> : undefined}
      />
      {coming.length === 0 ? (
        <Notice title="No rides coming up.">New rides show up here once they’re on the club calendar.</Notice>
      ) : (
        <Card style={{ padding: 0, gap: 0 }}>
          {coming.map((ride, i) => (
            <RideRow
              key={ride.id}
              ride={ride}
              going={0}
              mine={null}
              spot={null}
              crewNeeded={false}
              big4={false}
              call={null}
              last={i === coming.length - 1}
              onPress={() => navigation.navigate('RideDetail', { rideId: ride.id })}
            />
          ))}
        </Card>
      )}

      <ClubLinksSection />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One ride
// ---------------------------------------------------------------------------

export function FamilyRideScreen({ route }: RootScreen<'RideDetail'>) {
  const { data } = useClub();
  const ride = data.rides.find((r) => r.id === route.params.rideId);
  if (!ride) {
    return (
      <Screen>
        <Notice tone="warn" title="Ride not found">It may have come off the club calendar.</Notice>
      </Screen>
    );
  }
  const date = melbourneDate(ride.startsAt);
  const cancelled = !!ride.cancelledAt;
  return (
    <Screen>
      <Card>
        <Row style={{ gap: 6 }}>
          <RideChip category={ride.category} />
          {cancelled ? <Chip label="Cancelled" tone="danger" /> : null}
        </Row>
        <H1 style={cancelled ? { textDecorationLine: 'line-through', color: colors.boneDim } : undefined}>{ride.title}</H1>
        <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
          <Ionicons name="calendar-outline" size={18} color={colors.boneDim} />
          <Text style={type.name}>
            {weekday(date)} {formatAuDate(date)}
          </Text>
        </Row>
        <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
          <Ionicons name="time-outline" size={18} color={colors.boneDim} />
          <Text style={type.name}>{timeRange(ride)}</Text>
        </Row>
        {ride.location ? (
          <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
            <Ionicons name="location-outline" size={18} color={colors.boneDim} />
            <Text style={[type.name, { flex: 1 }]}>{ride.location}</Text>
          </Row>
        ) : null}
        {ride.notes ? <Body selectable>{ride.notes}</Body> : null}
        {ride.location && !cancelled ? (
          <Button
            label="Open in maps"
            icon="map-outline"
            kind="secondary"
            onPress={() => Linking.openURL(mapsUrl(ride.location as string)).catch(() => {})}
          />
        ) : null}
      </Card>
      {cancelled ? null : (
        <Small style={{ textAlign: 'center' }}>Coming along on the back or in the car? Sort it with your rider.</Small>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

export function FamilyMeScreen({ navigation }: TabScreen<'Me'>) {
  const { me, data, today, signOut, isDemo } = useClub();
  if (!me) return null;
  const chapter = data.chapters.find((c) => c.id === me.chapterId);
  const bikes = data.bikes.filter((b) => b.memberId === me.id);
  const contacts = data.emergencyContacts.filter((c) => c.memberId === me.id);
  return (
    <Screen>
      <Card>
        <Row style={{ gap: space.lg, flexWrap: 'nowrap' }}>
          <Avatar text={initials(me)} size={64} />
          <View style={{ flex: 1, gap: 6 }}>
            <H1>{displayName(me)}</H1>
            <Small>
              {me.fullName} · {chapter?.name} chapter
            </Small>
            <Row style={{ gap: 6 }}>
              <StatusChip status={me.status} />
            </Row>
          </View>
        </Row>
        <Button label="Edit profile" kind="secondary" icon="create-outline" onPress={() => navigation.navigate('EditProfile')} />
      </Card>

      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          last
          left={<IconBadge icon="card-outline" tone="red" />}
          title="Membership card"
          subtitle="Show it at club events"
          onPress={() => navigation.navigate('MembershipCard')}
        />
      </Card>

      <SectionTitle title="Emergency contacts" action={<LockNote text="You + board" />} />
      <Card style={{ padding: 0, gap: 0 }}>
        {contacts.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Notice tone="warn" title="Add someone to call">
              If you’re on the back of a bike and something happens, this is who the Road Captain rings.
            </Notice>
          </View>
        ) : null}
        {contacts.map((c) => (
          <ListRow
            key={c.id}
            left={<IconBadge icon="medkit" />}
            title={c.name}
            subtitle={`${c.relationship} · ${c.phone}`}
            onPress={() => navigation.navigate('EditContact', { contactId: c.id })}
          />
        ))}
        <ListRow
          last
          left={<IconBadge icon="add" tone="red" />}
          title="Add an emergency contact"
          onPress={() => navigation.navigate('EditContact', {})}
        />
      </Card>

      <SectionTitle title="Garage" />
      <Card style={{ padding: 0, gap: 0 }}>
        {bikes.map((b) => {
          const reg = data.registrations.find((r) => r.bikeId === b.id);
          return (
            <ListRow
              key={b.id}
              left={<IconBadge icon="speedometer" tone={b.isProject ? 'steel' : 'red'} />}
              title={b.nickname ?? `${b.make} ${b.model}`}
              subtitle={
                b.isProject
                  ? `${b.year ?? ''} ${b.make} ${b.model} · project`.trim()
                  : `${reg?.rego ?? 'No rego'} · ${describeExpiry(reg?.regoExpiry ?? null, today)}`
              }
              onPress={() => navigation.navigate('EditBike', { bikeId: b.id })}
            />
          );
        })}
        <ListRow last left={<IconBadge icon="add" tone="red" />} title="Add a bike" onPress={() => navigation.navigate('EditBike', {})} />
      </Card>

      <ClubLinksSection />
      {/* Sponsors: anyone with the app sees them */}
      <SponsorsSection />

      <SectionTitle title="Privacy" />
      <Card>
        <Small>
          Club members can see your name, chapter and what you write about yourself. Your mobile, email and emergency
          contacts are for you and your chapter’s board.
        </Small>
      </Card>

      <Button label="Sign out" kind="secondary" icon="log-out-outline" onPress={() => signOut()} />
      {isDemo ? <Small style={{ textAlign: 'center' }}>Demo build: changes reset when you reload.</Small> : null}
    </Screen>
  );
}
