// Stage 7: "Who can help?" Members who can lend a hand with a skill, and the club's trusted mechanics.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useSocial } from '../data/social/SocialProvider';
import { displayName } from '../domain/profile';
import {
  canEditMechanic,
  hasVouched,
  HELP_SKILLS,
  helpersFor,
  listedMechanics,
  mechanicProblem,
  skillLabel,
  usedByLabel,
  vouchCount,
  type HelpSkill,
  type Mechanic,
  type MechanicInput,
} from '../domain/social/help';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import { MemberRow } from '../ui/MemberBits';
import {
  Body,
  Button,
  Card,
  ConfirmButton,
  Field,
  H2,
  IconBadge,
  Ionicons,
  KeyValue,
  ListRow,
  Notice,
  Screen,
  SectionTitle,
  Small,
  Toggle,
} from '../ui/primitives';

type Nav = NavigationProp<RootParams>;

/** A skill chip that can be picked: stencil, steel, the picked one in club red. 44pt tall. */
function SkillPick({ skill, selected, onPress, role = 'radio' }: { skill: HelpSkill; selected: boolean; onPress: () => void; role?: 'radio' | 'checkbox' }) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        minHeight: 44,
        paddingHorizontal: space.md,
        borderRadius: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: selected ? colors.redBright : pressed || hovered ? colors.steelHi : colors.steel,
      })}
    >
      {role === 'checkbox' && selected ? <Ionicons name="checkmark" size={16} color={colors.bone} /> : null}
      <Text style={[type.name, { color: selected ? colors.bone : colors.boneDim }]}>{skillLabel(skill)}</Text>
    </Pressable>
  );
}

function SkillGrid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Members tab: the way in
// ---------------------------------------------------------------------------

/** Members tab: a row into Who can help. */
export function WhoCanHelpRow({ last = false }: { last?: boolean }) {
  const navigation = useNavigation<Nav>();
  return (
    <ListRow
      left={<IconBadge icon="construct" tone="red" />}
      title="Who can help?"
      subtitle="Members who can lend a hand, and trusted mechanics"
      onPress={() => navigation.navigate('WhoCanHelp')}
      last={last}
    />
  );
}

// ---------------------------------------------------------------------------
// Who can help
// ---------------------------------------------------------------------------

export function WhoCanHelpScreen({ navigation }: RootScreen<'WhoCanHelp'>) {
  const { me, data, isDemo, refresh: refreshClub } = useClub();
  const { skills, mechanics, vouches, refresh } = useSocial();
  const [skill, setSkill] = useState<HelpSkill>('servicing');
  const helpers = helpersFor(me, data.members, skills, skill, data.positions);
  const shops = listedMechanics(mechanics, vouches);
  const mine = me ? skills.find((s) => s.memberId === me.id)?.skills ?? [] : [];

  return (
    <Screen onRefresh={isDemo ? undefined : () => Promise.all([refresh(), refreshClub()]).then(() => undefined)}>
      <SectionTitle title="Members who can help" />
      <SkillGrid>
        {HELP_SKILLS.map((s) => (
          <SkillPick key={s} skill={s} selected={s === skill} onPress={() => setSkill(s)} />
        ))}
      </SkillGrid>
      <Card style={{ padding: 0, gap: 0 }}>
        {helpers.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>{`Nobody’s ticked ${skillLabel(skill).toLowerCase()} yet.`}</Small>
          </View>
        ) : (
          helpers.map((m, i) => (
            <MemberRow
              key={m.id}
              member={m}
              data={data}
              last={i === helpers.length - 1}
              onPress={() => navigation.navigate('MemberDetail', { memberId: m.id })}
            />
          ))
        )}
      </Card>
      <Button
        label={mine.length ? 'Change your skills' : 'Add your skills'}
        kind="secondary"
        icon="hand-left-outline"
        onPress={() => navigation.navigate('MySkills')}
      />

      <SectionTitle title="Trusted mechanics" />
      <Card style={{ padding: 0, gap: 0 }}>
        {shops.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>No workshops on the list yet. Add one you trust.</Small>
          </View>
        ) : null}
        {shops.map((m) => (
          <ListRow
            key={m.id}
            left={<IconBadge icon="build-outline" />}
            title={m.name}
            subtitle={[m.suburb, m.speciality, usedByLabel(vouchCount(m.id, vouches))].filter(Boolean).join(' · ')}
            onPress={() => navigation.navigate('Mechanic', { mechanicId: m.id })}
          />
        ))}
        <ListRow
          last
          left={<IconBadge icon="add" tone="red" />}
          title="Add a workshop"
          onPress={() => navigation.navigate('EditMechanic', {})}
        />
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One workshop
// ---------------------------------------------------------------------------

export function MechanicScreen({ route, navigation }: RootScreen<'Mechanic'>) {
  const { me, data } = useClub();
  const { ready, mechanics, vouches, vouchMechanic, archiveMechanic } = useSocial();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready) return <Loading />;
  const m = mechanics.find((x) => x.id === route.params.mechanicId);
  if (!m || !me) {
    return (
      <Screen>
        <Notice title="Not found">That workshop isn’t on the list.</Notice>
      </Screen>
    );
  }
  const adder = data.members.find((x) => x.id === m.addedBy);
  const count = vouchCount(m.id, vouches);
  const mine = hasVouched(m.id, me.id, vouches);
  // One change at a time, so a quick on-then-off can't land out of order.
  const act = (p: () => Promise<unknown>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    p()
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const site = m.website;

  return (
    <Screen>
      <Card>
        <H2>{m.name}</H2>
        {m.speciality ? <Body>{m.speciality}</Body> : null}
        {m.suburb ? <KeyValue label="Suburb" value={m.suburb} /> : null}
        <KeyValue label="Used by" value={count === 0 ? 'No one yet' : `${count} ${count === 1 ? 'member' : 'members'}`} />
        <KeyValue label="Added by" value={adder ? displayName(adder) : 'A former member'} />
        {m.notes ? <Body style={{ color: colors.boneDim }}>{m.notes}</Body> : null}
        {m.archivedAt ? <Notice tone="warn">Taken off the list.</Notice> : null}
      </Card>

      {m.phone ? (
        <Button label={`Call ${m.phone}`} icon="call-outline" onPress={() => Linking.openURL(`tel:${m.phone!.replace(/[^\d+]/g, '')}`)} />
      ) : null}
      {site ? <Button label="Open their website" kind="secondary" icon="open-outline" onPress={() => Linking.openURL(site)} /> : null}

      {!m.archivedAt ? (
        <Card>
          <Toggle
            label="I’ve used them"
            description="Tells other members you’d send your own bike there."
            value={mine}
            onChange={(v) => act(() => vouchMechanic(m.id, v))}
          />
        </Card>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {canEditMechanic(me, m, data.positions) && !m.archivedAt ? (
        <>
          <Button label="Edit" kind="secondary" icon="create-outline" onPress={() => navigation.navigate('EditMechanic', { mechanicId: m.id })} />
          <ConfirmButton
            label="Take off the list"
            confirmLabel="Take it off"
            icon="archive-outline"
            confirmNote="Members won’t see it any more. Its details are kept."
            onConfirm={() =>
              archiveMechanic(m.id)
                .then(() => navigation.goBack())
                .catch((e) => setError((e as Error).message))
            }
          />
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Add or change a workshop
// ---------------------------------------------------------------------------

function Loading() {
  return (
    <Screen>
      <ActivityIndicator color={colors.redText} />
    </Screen>
  );
}

export function EditMechanicScreen({ route, navigation }: RootScreen<'EditMechanic'>) {
  const { ready, mechanics } = useSocial();
  const id = route.params?.mechanicId;
  // Wait for the list, so changing a workshop never starts as adding a new one.
  if (!ready) return <Loading />;
  const existing = id ? mechanics.find((x) => x.id === id) : undefined;
  if (id && !existing) {
    return (
      <Screen>
        <Notice title="Not found">That workshop isn’t on the list.</Notice>
      </Screen>
    );
  }
  return <MechanicForm existing={existing} navigation={navigation} />;
}

function MechanicForm({ existing, navigation }: { existing: Mechanic | undefined; navigation: RootScreen<'EditMechanic'>['navigation'] }) {
  const { me, data } = useClub();
  const { mechanics, saveMechanic } = useSocial();
  const [input, setInput] = useState<MechanicInput>({
    id: existing?.id ?? null,
    name: existing?.name ?? '',
    suburb: existing?.suburb ?? '',
    phone: existing?.phone ?? '',
    website: existing?.website ?? '',
    speciality: existing?.speciality ?? '',
    notes: existing?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Omit<MechanicInput, 'id'>) => (v: string) => setInput((i) => ({ ...i, [k]: v }));

  const save = () => {
    setError(null);
    const problem = mechanicProblem(me, input, mechanics, data.positions);
    if (problem) return setError(problem);
    setBusy(true);
    saveMechanic(input)
      .then((id) => (existing ? navigation.goBack() : navigation.replace('Mechanic', { mechanicId: id })))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <Card>
        <Field label="Workshop name" value={input.name} onChangeText={set('name')} placeholder="Westside Moto Works" maxLength={80} />
        <Field label="Suburb" value={input.suburb} onChangeText={set('suburb')} placeholder="Sunshine" maxLength={60} />
        <Field label="Phone" value={input.phone} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={30} />
        <Field
          label="Website"
          value={input.website}
          onChangeText={set('website')}
          placeholder="https://"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={200}
        />
        <Field label="What they’re good at" value={input.speciality} onChangeText={set('speciality')} placeholder="Old Japanese, tyres, Harleys…" maxLength={80} />
        <Field label="Notes" value={input.notes} onChangeText={set('notes')} multiline placeholder="Who to ask for, prices, anything worth knowing" maxLength={500} />
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={existing ? 'Save' : 'Add to the list'} icon="checkmark" busy={busy} onPress={save} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Your skills
// ---------------------------------------------------------------------------

export function MySkillsScreen({ navigation }: RootScreen<'MySkills'>) {
  const { me } = useClub();
  const { ready, skills } = useSocial();
  if (!me) return null;
  if (!ready) return <Loading />;
  const mine = skills.find((s) => s.memberId === me.id)?.skills ?? [];
  return <SkillsForm mine={mine} onDone={() => navigation.goBack()} />;
}

function SkillsForm({ mine, onDone }: { mine: HelpSkill[]; onDone: () => void }) {
  const { setSkills } = useSocial();
  const [picked, setPicked] = useState<HelpSkill[]>(mine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (s: HelpSkill) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const save = () => {
    setError(null);
    setBusy(true);
    // Saved in the list's own order, whatever order they were tapped in.
    setSkills(HELP_SKILLS.filter((s) => picked.includes(s)))
      .then(onDone)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  return (
    <Screen>
      <Card>
        <Small>Members looking for a hand with one of these see you under Who can help, and can message you.</Small>
        <SkillGrid>
          {HELP_SKILLS.map((s) => (
            <SkillPick key={s} skill={s} role="checkbox" selected={picked.includes(s)} onPress={() => toggle(s)} />
          ))}
        </SkillGrid>
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Save" icon="checkmark" busy={busy} onPress={save} />
    </Screen>
  );
}
