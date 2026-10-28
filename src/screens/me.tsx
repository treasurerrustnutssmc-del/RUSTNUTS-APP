import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { activePositions } from '../domain/access';
import { formatAuDate, parseAuDate, describeExpiry, typeDate } from '../domain/dates';
import { LICENCE_LABEL, ROLE_LABEL } from '../domain/labels';
import { displayName, hasEarnedDisc, initials } from '../domain/profile';
import { StandingCard } from './attendance';
import type { LicenceClass } from '../domain/types';
import type { RootScreen, TabScreen } from '../navigation/types';
// Lane E: notifications
import { NotificationSettings } from './notificationSettings';
// Stage 7: social extras
import { MeSocialSection } from './social';
import { colors, space, type } from '../theme';
import { formatCents, totalOwing } from '../domain/fees'; // Stage 4
import { seesReports } from '../domain/ledger'; // Stage 5B
import { asksToSign, currentRoadRules, myRoadRulesLine, needsSigning, roadRulesStatus } from '../domain/roadRules'; // Road Rules
import { MAX_RANGE, MIN_RANGE, RANGE_LIMITS } from '../domain/fuel'; // Ride planning extras
import { readRange } from './ridePlanning'; // Ride planning extras
import { DocumentsMeRow } from './documents'; // Stage 5C
import {
  Avatar,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Body,
  Field,
  Flannel,
  H1,
  H2,
  IconBadge,
  ListRow,
  LockNote,
  MemberDisc,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  StatusChip,
  Toggle,
} from '../ui/primitives';

/** Text box for DD/MM/YYYY dates. Empty is allowed; anything else must be a real date. */
function useDateField(initialIso: string | null) {
  const [text, setRawText] = useState(formatAuDate(initialIso));
  const setText = (typed: string) => setRawText(typeDate(typed));
  const trimmed = text.trim();
  const iso = trimmed ? parseAuDate(trimmed) : null;
  const error = trimmed && !iso ? 'Use DD/MM/YYYY, like 08/11/2026.' : null;
  return { text, setText, iso, error };
}

// ---------------------------------------------------------------------------
// Me tab
// ---------------------------------------------------------------------------

export function MeScreen({ navigation }: TabScreen<'Me'>) {
  const { me, data, today, saveProfile, signOut, isDemo } = useClub();
  const [shareError, setShareError] = useState<string | null>(null);
  if (!me) return null;
  const chapter = data.chapters.find((c) => c.id === me.chapterId);
  const bikes = data.bikes.filter((b) => b.memberId === me.id);
  const contacts = data.emergencyContacts.filter((c) => c.memberId === me.id);
  const positions = activePositions(me.id, data.positions);

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
              {positions.map((p) => (
                <Chip key={p.id} label={ROLE_LABEL[p.role]} tone="bone" />
              ))}
            </Row>
          </View>
        </Row>
        {hasEarnedDisc(me) ? (
          <Flannel style={{ padding: space.md }}>
            <Row style={{ gap: space.md, flexWrap: 'nowrap' }}>
              <MemberDisc size={72} />
              <View style={{ flex: 1, gap: 2 }}>
                <Body strong>Full member</Body>
                <Small style={{ color: colors.boneDim }}>
                  {me.patchedOn ? `Disc earned ${formatAuDate(me.patchedOn)}` : 'Disc earned'}
                </Small>
              </View>
            </Row>
          </Flannel>
        ) : me.status === 'introduced' || me.status === 'fng' ? (
          <Small>Your MEMBER disc is earned at full membership.</Small>
        ) : null}
        <Row style={{ gap: space.sm }}>
          <Button label="Edit profile" kind="secondary" icon="create-outline" onPress={() => navigation.navigate('EditProfile')} style={{ flex: 1 }} />
          <Button label="View" kind="quiet" onPress={() => navigation.navigate('MemberDetail', { memberId: me.id })} />
        </Row>
      </Card>

      {/* Attendance rules and the membership card */}
      {me.approval === 'approved' ? (
        <Card style={{ padding: 0, gap: 0 }}>
          <ListRow
            last
            left={<IconBadge icon="card-outline" tone="red" />}
            title="Membership card"
            subtitle="Show it at club events"
            onPress={() => navigation.navigate('MembershipCard')}
          />
        </Card>
      ) : null}
      <StandingCard member={me} />

      <SectionTitle title="Emergency contacts" action={<LockNote text="You + board" />} />
      <Card style={{ padding: 0, gap: 0 }}>
        {contacts.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Notice tone="warn" title="Add someone to call">
              If you go down on a ride, this is who the Road Captain rings.
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

      {/* Road Rules sign-off: for everyone who's asked to sign */}
      {asksToSign(me) ? <RoadRulesRow onOpen={() => navigation.navigate('RoadRules')} /> : null}
      {/* Stage 5C: document library */}
      <DocumentsMeRow />

      <SectionTitle title="Fees" action={<LockNote text="You + board" />} />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          left={<IconBadge icon="cash-outline" tone={totalOwing(me.id, data) > 0 ? 'red' : 'steel'} />}
          title={totalOwing(me.id, data) > 0 ? `${formatCents(totalOwing(me.id, data))} owing` : 'All paid up'}
          subtitle={me.onHiatus && totalOwing(me.id, data) === 0 ? 'On hiatus: no new fees while you’re away' : 'Charges, payments and receipts'}
          onPress={() => navigation.navigate('MemberFees', { memberId: me.id })}
          last={!seesReports(me)}
        />
        {/* Stage 5B: presented Treasurer's Reports (13.8) */}
        {seesReports(me) ? (
          <ListRow
            last
            left={<IconBadge icon="document-text-outline" />}
            title="Club finances"
            subtitle="The Treasurer’s Report each month"
            onPress={() => navigation.navigate('ClubFinances')}
          />
        ) : null}
      </Card>
      {/* Lane E: notifications */}
      <NotificationSettings />
      {/* Stage 7: social extras */}
      <MeSocialSection />

      <SectionTitle title="Privacy" />
      <Card>
        <Toggle
          label="Share my mobile with members"
          description="Your chapter board can always see it. Turn this on so other members can call you too."
          value={me.sharePhone}
          onChange={(v) => {
            setShareError(null);
            saveProfile({ fullName: me.fullName, roadName: me.roadName, bio: me.bio, sharePhone: v }, null).catch((e) =>
              setShareError(`Couldn’t change that: ${(e as Error).message}`),
            );
          }}
        />
        {shareError ? <Notice tone="danger">{shareError}</Notice> : null}
        {/* Lane E: live ride */}
        <Small>Live ride location sharing is always your choice, switches off after the ride, and keeps nothing.</Small>
      </Card>

      <Button label="Sign out" kind="secondary" icon="log-out-outline" onPress={() => signOut()} />
      {isDemo ? <Small style={{ textAlign: 'center' }}>Demo build: changes reset when you reload.</Small> : null}
    </Screen>
  );
}

/** Me: where you stand with the Road Rules ("Signed until", "Due" in amber, "Not signed" in red). */
function RoadRulesRow({ onOpen }: { onOpen: () => void }) {
  const { me, data, today } = useClub();
  if (!me) return null;
  const status = roadRulesStatus(me, data, today);
  const line = myRoadRulesLine(status);
  const current = currentRoadRules(data);
  const color = line.tone === 'warn' ? colors.warn : line.tone === 'danger' ? colors.danger : colors.bone;
  return (
    <>
      <SectionTitle title="Road Rules" />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          last
          left={<IconBadge icon="document-text-outline" tone={needsSigning(status.state) ? 'red' : 'steel'} />}
          title={<Text style={[type.name, { color }]}>{line.text}</Text>}
          subtitle={current ? `Version ${current.number}: read it and sign once a year` : 'The NEC publishes them here'}
          onPress={onOpen}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Edit profile
// ---------------------------------------------------------------------------

export function EditProfileScreen({ navigation }: RootScreen<'EditProfile'>) {
  const { me, data, saveProfile } = useClub();
  const priv = data.privates.find((p) => p.memberId === me?.id);
  const [fullName, setFullName] = useState(me?.fullName ?? '');
  const [roadName, setRoadName] = useState(me?.roadName ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [phone, setPhone] = useState(priv?.phone ?? '');
  const [email, setEmail] = useState(priv?.email ?? '');
  const [licenceClass, setLicenceClass] = useState<LicenceClass | null>(priv?.licenceClass ?? null);
  const licence = useDateField(priv?.licenceExpiry ?? null);
  const firstAid = useDateField(priv?.firstAidExpiry ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const save = async () => {
    setError(null);
    if (licence.error || firstAid.error) {
      setError('Fix the dates marked in red.');
      return;
    }
    setBusy(true);
    try {
      await saveProfile(
        { fullName, roadName, bio, sharePhone: me.sharePhone },
        { email, phone, licenceClass, licenceExpiry: licence.iso, firstAidExpiry: firstAid.iso },
      );
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <H2>About you</H2>
        <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" />
        <Field label="Road name" value={roadName} onChangeText={setRoadName} hint="Leave blank if you don't have one yet." />
        <Field label="A bit about you" value={bio} onChangeText={setBio} multiline placeholder="What you ride, how long you've been riding…" />
      </Card>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <H2>Contact</H2>
          <LockNote text="You + board" />
        </Row>
        <Field label="Mobile" value={phone} onChangeText={setPhone} keyboardType="phone-pad" inputMode="tel" autoComplete="tel" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" inputMode="email" />
      </Card>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <H2>Licence</H2>
          <LockNote text="You + board" />
        </Row>
        <Choices<LicenceClass>
          label="Licence type"
          options={(Object.keys(LICENCE_LABEL) as LicenceClass[]).map((k) => ({ value: k, label: LICENCE_LABEL[k] }))}
          value={licenceClass}
          onChange={setLicenceClass}
        />
        <Field label="Licence expiry" value={licence.text} onChangeText={licence.setText} placeholder="DD/MM/YYYY" inputMode="numeric" maxLength={10} error={licence.error} />
        <Field
          label="First aid certificate expiry"
          value={firstAid.text}
          onChangeText={firstAid.setText}
          placeholder="DD/MM/YYYY"
          inputMode="numeric"
          maxLength={10}
          error={firstAid.error}
          hint="Required for Tail Gunners. Leave blank if you don't have one."
        />
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Save" icon="checkmark" onPress={save} busy={busy} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Add or edit a bike
// ---------------------------------------------------------------------------

export function EditBikeScreen({ route, navigation }: RootScreen<'EditBike'>) {
  const { data, saveBike, removeBike, setBikeRange } = useClub();
  const bike = route.params.bikeId ? data.bikes.find((b) => b.id === route.params.bikeId) : undefined;
  const reg = bike ? data.registrations.find((r) => r.bikeId === bike.id) : undefined;
  const [make, setMake] = useState(bike?.make ?? '');
  const [model, setModel] = useState(bike?.model ?? '');
  const [year, setYear] = useState(bike?.year ? String(bike.year) : '');
  const [nickname, setNickname] = useState(bike?.nickname ?? '');
  const [isProject, setIsProject] = useState(bike?.isProject ?? false);
  const [rego, setRego] = useState(reg?.rego ?? '');
  const expiry = useDateField(reg?.regoExpiry ?? null);
  const [range, setRange] = useState(bike?.rangeKm != null ? String(bike.rangeKm) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const yearError = year.trim() && !/^\d{4}$/.test(year.trim()) ? 'Use a four-digit year.' : null;
  // Ride planning extras: the range, on a bike that's already in the garage.
  const rangeKm = readRange(range);
  const rangeError = rangeKm !== null && (Number.isNaN(rangeKm) || rangeKm < MIN_RANGE || rangeKm > MAX_RANGE) ? RANGE_LIMITS : null;

  const save = async () => {
    setError(null);
    if (yearError || expiry.error || rangeError) {
      setError('Fix the fields marked in red.');
      return;
    }
    setBusy(true);
    try {
      await saveBike(
        { id: bike?.id ?? null, make, model, year: year.trim() ? Number(year) : null, nickname: nickname.trim() || null, isProject },
        { rego: isProject ? null : rego, regoExpiry: isProject ? null : expiry.iso },
      );
      if (bike && rangeKm !== (bike.rangeKm ?? null)) await setBikeRange(bike.id, rangeKm);
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Field label="Make" value={make} onChangeText={setMake} placeholder="Harley-Davidson" />
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Field label="Model" value={model} onChangeText={setModel} placeholder="Softail Slim" />
          </View>
        </Row>
        <Field label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" inputMode="numeric" maxLength={4} error={yearError} />
        <Field label="Nickname" value={nickname} onChangeText={setNickname} placeholder="Old Faithful" hint="Optional. Shows in the garage instead of the model." />
        <Toggle label="Project bike" description="Off the road for now. No rego needed." value={isProject} onChange={setIsProject} />
        {bike && !isProject ? (
          <Field
            label="Range to the fuel light (km)"
            value={range}
            onChangeText={setRange}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={4}
            placeholder="220"
            error={rangeError}
            hint="Optional. Ride planners keep fuel stops inside the smallest tank in the pack."
          />
        ) : null}
        {!bike && !isProject ? <Small>Add the bike first, then come back to set its range for fuel stops.</Small> : null}
      </Card>
      {!isProject ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>Registration</H2>
            <LockNote text="You + board" />
          </Row>
          <Field label="Rego" value={rego} onChangeText={setRego} autoCapitalize="characters" placeholder="1AB 2CD" />
          <Field label="Rego expiry" value={expiry.text} onChangeText={expiry.setText} placeholder="DD/MM/YYYY" inputMode="numeric" maxLength={10} error={expiry.error} hint="You'll get a reminder 30 days before." />
        </Card>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={bike ? 'Save bike' : 'Add bike'} icon="checkmark" onPress={save} busy={busy} />
      {bike ? (
        <ConfirmButton
          label="Remove this bike"
          confirmLabel="Yes, remove it"
          icon="trash-outline"
          onConfirm={() => {
            removeBike(bike.id)
              .then(() => navigation.goBack())
              .catch((e: Error) => setError(e.message));
          }}
        />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Add or edit an emergency contact
// ---------------------------------------------------------------------------

const RELATIONSHIPS = ['Partner', 'Wife', 'Husband', 'Mum', 'Dad', 'Brother', 'Sister', 'Mate'];

export function EditContactScreen({ route, navigation }: RootScreen<'EditContact'>) {
  const { data, saveContact, removeContact } = useClub();
  const contact = route.params.contactId ? data.emergencyContacts.find((c) => c.id === route.params.contactId) : undefined;
  const [name, setName] = useState(contact?.name ?? '');
  const [relationship, setRelationship] = useState(contact?.relationship ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await saveContact({ id: contact?.id ?? null, name, relationship, phone });
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Notice title="Who sees this">Only you and your chapter board. On ride day, the Road Captain uses it if something goes wrong.</Notice>
      <Card>
        <Field label="Name" value={name} onChangeText={setName} autoComplete="name" />
        <Choices
          label="They're your"
          options={RELATIONSHIPS.map((r) => ({ value: r, label: r }))}
          value={RELATIONSHIPS.includes(relationship) ? relationship : null}
          onChange={setRelationship}
        />
        <Field label="Or type it" value={relationship} onChangeText={setRelationship} placeholder="Daughter, neighbour…" />
        <Field label="Mobile" value={phone} onChangeText={setPhone} keyboardType="phone-pad" inputMode="tel" />
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={contact ? 'Save contact' : 'Add contact'} icon="checkmark" onPress={save} busy={busy} />
      {contact ? (
        <ConfirmButton
          label="Remove this contact"
          confirmLabel="Yes, remove"
          icon="trash-outline"
          onConfirm={() => {
            removeContact(contact.id)
              .then(() => navigation.goBack())
              .catch((e: Error) => setError(e.message));
          }}
        />
      ) : null}
    </Screen>
  );
}

