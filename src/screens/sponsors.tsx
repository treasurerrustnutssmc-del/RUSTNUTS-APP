// The club's sponsors: who backs the club, a link to each, and any deal for members. The board
// looks after the list. Anyone with the app sees it; the deals are for approved members only.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import type { MediaSource } from '../data/chat/chatContext';
import { PickProblem, pickMedia } from '../data/chat/media';
import { useClub } from '../data/ClubStore';
import { useSponsors } from '../data/sponsors';
import type { PickedMedia } from '../domain/chat';
import {
  canKeepSponsors,
  MAX_SPONSOR_BLURB,
  MAX_SPONSOR_DEAL,
  MAX_SPONSOR_NAME,
  MAX_SPONSOR_URL,
  siteLabel,
  sponsorProblem,
  sponsorsFor,
  type Sponsor,
} from '../domain/sponsors';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, radius, space, type } from '../theme';
import {
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Field,
  IconBadge,
  Ionicons,
  Label,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
} from '../ui/primitives';

type Nav = NavigationProp<RootParams>;

const WHOLE_CLUB = 'club';
const LOGO_TILE = 64;
// DESIGN.md's logo plate: logos are made for white, the club's and the sponsors'.
const LOGO_PLATE = '#FFFFFF';

// ---------------------------------------------------------------------------
// Me, the welcome screen and the waiting screen: the way in
// ---------------------------------------------------------------------------

export function SponsorsSection() {
  const navigation = useNavigation<Nav>();
  const { me } = useClub();
  const member = me?.approval === 'approved';
  return (
    <>
      <SectionTitle title="Sponsors" />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          last
          left={<IconBadge icon="ribbon-outline" />}
          title="Club sponsors"
          subtitle={member ? 'Who backs the club, and deals for members' : 'The businesses that back the club'}
          onPress={() => navigation.navigate('Sponsors')}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** A logo on a white plate (logos are made for white), or a steel tile when there's none. */
function LogoTile({ path, name, size = LOGO_TILE }: { path: string | null; name: string; size?: number }) {
  const { logoUrl } = useSponsors();
  const [source, setSource] = useState<{ path: string; value: MediaSource | 'failed' } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    logoUrl(path).then(
      (value) => live && setSource({ path, value }),
      () => live && setSource({ path, value: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [path, logoUrl]);
  const shown = source && source.path === path && source.value !== 'failed' ? source.value : null;
  const failed = source?.path === path && source.value === 'failed';
  if (!path || failed) {
    return (
      <View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colors.steel, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="storefront-outline" size={size / 2.6} color={colors.boneMute} />
      </View>
    );
  }
  return (
    <View
      style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: LOGO_PLATE, padding: space.xs, alignItems: 'center', justifyContent: 'center' }}
    >
      {shown ? (
        <Image source={shown} style={{ width: '100%', height: '100%' }} contentFit="contain" transition={120} accessibilityLabel={`${name} logo`} />
      ) : (
        <ActivityIndicator color={colors.boneMute} />
      )}
    </View>
  );
}

function SponsorCard({ sponsor, keeper }: { sponsor: Sponsor; keeper: boolean }) {
  const navigation = useNavigation<Nav>();
  const { data } = useClub();
  const [linkError, setLinkError] = useState(false);
  const chapter = data.chapters.find((c) => c.id === sponsor.chapterId);
  return (
    <Card>
      <Row style={{ gap: space.md, alignItems: 'center' }}>
        <LogoTile path={sponsor.logoPath} name={sponsor.name} />
        <View style={{ flex: 1, minWidth: 0, gap: space.xs, alignItems: 'flex-start' }}>
          <Text style={[type.name, { fontSize: 18, lineHeight: 24 }]}>{sponsor.name}</Text>
          <Chip label={chapter ? chapter.name : 'Whole club'} tone="bone" />
        </View>
      </Row>
      {sponsor.blurb ? <Body selectable>{sponsor.blurb}</Body> : null}
      {sponsor.deal ? (
        <View style={{ borderLeftWidth: 3, borderLeftColor: colors.redBright, paddingLeft: space.md, gap: 2 }}>
          <Label style={{ color: colors.redText }}>Member deal</Label>
          <Body strong selectable>
            {sponsor.deal}
          </Body>
        </View>
      ) : null}
      {sponsor.url || keeper ? (
        <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
          {sponsor.url ? (
            <Button
              label={`Visit ${siteLabel(sponsor.url)}`}
              kind="secondary"
              icon="open-outline"
              accessibilityLabel={`Visit ${sponsor.name}’s website`}
              onPress={() => {
                setLinkError(false);
                Linking.openURL(sponsor.url as string).catch(() => setLinkError(true));
              }}
              style={{ flexShrink: 1 }}
            />
          ) : null}
          {keeper ? (
            <Button
              label="Change"
              kind="quiet"
              icon="create-outline"
              accessibilityLabel={`Change ${sponsor.name}`}
              onPress={() => navigation.navigate('EditSponsor', { sponsorId: sponsor.id })}
            />
          ) : null}
        </Row>
      ) : null}
      {linkError ? <Notice tone="danger">That website wouldn’t open. Try again later.</Notice> : null}
    </Card>
  );
}

export function SponsorsScreen({ navigation }: RootScreen<'Sponsors'>) {
  const { me, data } = useClub();
  const { ready, sponsors, loadError, refresh } = useSponsors();
  const keeper = canKeepSponsors(me, data.positions);
  const shown = sponsorsFor(sponsors);
  return (
    <Screen onRefresh={refresh}>
      <Body>
        {me?.approval === 'approved'
          ? 'The businesses that back the club. Tell them you’re a Rustnuts member.'
          : 'The businesses that back the club. Some have deals for members.'}
      </Body>
      {keeper ? <Button label="Add a sponsor" icon="add" onPress={() => navigation.navigate('EditSponsor')} /> : null}
      {loadError ? <Notice tone="danger" title="Couldn’t load the sponsors">{loadError}</Notice> : null}
      {!ready ? (
        <ActivityIndicator color={colors.redText} />
      ) : shown.length === 0 && !loadError ? (
        <Notice title="No sponsors yet">
          {keeper
            ? 'Add the club’s first sponsor. Members will see their logo, a link and any deal for members.'
            : 'When the club has sponsors, they’ll show here with any deals for members.'}
        </Notice>
      ) : (
        shown.map((s) => <SponsorCard key={s.id} sponsor={s} keeper={keeper} />)
      )}
      {keeper ? <Small>Board only: any board seat or the NEC can add, change or take off a sponsor.</Small> : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Adding and changing (the board)
// ---------------------------------------------------------------------------

export function EditSponsorScreen({ route, navigation }: RootScreen<'EditSponsor'>) {
  const { me, data } = useClub();
  const { ready, sponsors, loadError } = useSponsors();
  if (!canKeepSponsors(me, data.positions)) {
    return (
      <Screen>
        <Notice title="Board only">Only the board can look after the club’s sponsors.</Notice>
      </Screen>
    );
  }
  const id = route.params?.sponsorId;
  // Wait for the list, so changing a sponsor never starts as adding a new one.
  if (!ready) {
    return (
      <Screen>
        <ActivityIndicator color={colors.redText} />
      </Screen>
    );
  }
  const existing = id ? sponsors.find((s) => s.id === id && !s.archivedAt) : undefined;
  if (loadError) {
    return (
      <Screen>
        <Notice tone="danger" title="Couldn’t load the sponsors">{loadError}</Notice>
      </Screen>
    );
  }
  if (id && !existing) {
    return (
      <Screen>
        <Notice title="Not found">That sponsor isn’t on the list.</Notice>
      </Screen>
    );
  }
  return <SponsorForm key={existing?.id ?? 'new'} existing={existing} navigation={navigation} />;
}

function SponsorForm({ existing, navigation }: { existing: Sponsor | undefined; navigation: RootScreen<'EditSponsor'>['navigation'] }) {
  const { me, data } = useClub();
  const { sponsors, save, archive } = useSponsors();
  const [name, setName] = useState(existing?.name ?? '');
  const [blurb, setBlurb] = useState(existing?.blurb ?? '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [deal, setDeal] = useState(existing?.deal ?? '');
  const [chapter, setChapter] = useState<string>(existing?.chapterId ?? WHOLE_CLUB);
  const [keptLogo, setKeptLogo] = useState<string | null>(existing?.logoPath ?? null);
  const [newLogo, setNewLogo] = useState<PickedMedia | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input = {
    id: existing?.id ?? null,
    name,
    blurb,
    url,
    deal,
    logoPath: keptLogo,
    chapterId: chapter === WHOLE_CLUB ? null : chapter,
  };

  const pick = () => {
    setError(null);
    pickMedia('library', 1, true)
      .then(([picked]) => {
        if (picked) setNewLogo(picked);
      })
      .catch((e) => setError(e instanceof PickProblem ? e.message : 'That picture couldn’t be opened. Try another.'));
  };

  const submit = () => {
    if (busy) return;
    setError(null);
    const problem = sponsorProblem(me, input, sponsors, data.positions, data.chapters.map((c) => c.id));
    if (problem) return setError(problem);
    setBusy(true);
    save(input, newLogo)
      .then(() => navigation.goBack())
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  const hasLogo = newLogo !== null || keptLogo !== null;
  return (
    <Screen>
      <Card>
        <Field label="Name" value={name} onChangeText={setName} placeholder="The business’s name" maxLength={MAX_SPONSOR_NAME * 2} />
        <Field
          label="About them"
          value={blurb}
          onChangeText={setBlurb}
          multiline
          placeholder="What they do, where they are"
          hint="Optional. A line or two."
          maxLength={MAX_SPONSOR_BLURB * 2}
        />
        <Field
          label="Website"
          value={url}
          onChangeText={setUrl}
          placeholder="https://"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          hint="Optional. Their website or Facebook page."
          maxLength={MAX_SPONSOR_URL * 2}
        />
        <Field
          label="Member deal"
          value={deal}
          onChangeText={setDeal}
          multiline
          placeholder="10% off tyres, show your member card"
          hint="Optional. Only approved members see it."
          maxLength={MAX_SPONSOR_DEAL * 2}
        />
        <Choices<string>
          label="Who they back"
          options={[{ value: WHOLE_CLUB, label: 'Whole club' }, ...data.chapters.map((c) => ({ value: c.id, label: c.name }))]}
          value={chapter}
          onChange={setChapter}
        />
      </Card>

      <SectionTitle title="Logo" />
      <Card>
        <Row style={{ gap: space.md, alignItems: 'center' }}>
          {newLogo ? (
            <View style={{ width: LOGO_TILE, height: LOGO_TILE, borderRadius: radius.md, backgroundColor: LOGO_PLATE, padding: space.xs }}>
              <Image source={newLogo.uri} style={{ width: '100%', height: '100%' }} contentFit="contain" accessibilityLabel="The new logo" />
            </View>
          ) : (
            <LogoTile path={keptLogo} name={name || 'The sponsor'} />
          )}
          <Small style={{ flex: 1 }}>{hasLogo ? 'Shown on a white plate, so a logo made for white looks right.' : 'Optional. A PNG with a see-through background looks best.'}</Small>
        </Row>
        <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
          <Button label={hasLogo ? 'Pick another' : 'Pick a logo'} kind="secondary" icon="image-outline" onPress={pick} />
          {hasLogo ? (
            <Button
              label="Take the logo off"
              kind="quiet"
              icon="close"
              onPress={() => {
                setNewLogo(null);
                setKeptLogo(null);
              }}
            />
          ) : null}
        </Row>
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={existing ? 'Save changes' : 'Add the sponsor'} icon="checkmark" busy={busy} onPress={submit} />
      {existing ? (
        <ConfirmButton
          label="Take them off the list"
          confirmLabel="Take them off"
          kind="quiet"
          icon="archive-outline"
          confirmNote="They’re kept, but members won’t see them any more."
          onConfirm={() =>
            archive(existing.id)
              .then(() => navigation.goBack())
              .catch((e) => setError((e as Error).message))
          }
        />
      ) : null}
    </Screen>
  );
}
