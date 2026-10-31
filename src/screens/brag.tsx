// Stage 7: bragging rights, the club's yearly awards. The board opens an award; members nominate a
// ride, a photo or a story, then vote. Counts stay hidden until voting closes.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { PickProblem, pickMedia } from '../data/chat/media';
import { useClub } from '../data/ClubStore';
import { useSocial } from '../data/social/SocialProvider';
import type { PickedMedia } from '../domain/chat';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { displayName } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import {
  awardPhase,
  awardsFor,
  BRAG_KIND_LABEL,
  BRAG_KINDS,
  canRunAwards,
  canWithdraw,
  MAX_AWARD_NAME,
  MAX_BRAG_REASON,
  MAX_BRAG_STORY,
  MAX_BRAG_TITLE,
  MAX_NOMINATIONS,
  nominationProblem,
  openAwardProblem,
  results,
  rideFitsAward,
  type Award,
  type BragKind,
  type Nomination,
} from '../domain/social/brag';
import type { ClubData, Ride } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, MAX_CONTENT_WIDTH, space, type } from '../theme';
import {
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Field,
  H2,
  IconBadge,
  Ionicons,
  ListRow,
  Notice,
  Screen,
  SectionTitle,
  Small,
} from '../ui/primitives';
import { withoutReported } from '../domain/reports'; // Member content rules
import { ReportBox } from '../ui/ReportBox';
import { ListingPhotoBox } from './swap';

type Nav = NavigationProp<RootParams>;

const DEFAULT_TITLE: Record<BragKind, string> = { ride: 'Ride of the year', photo: 'Best photo', story: 'Best breakdown story' };
const KIND_ICON: Record<BragKind, React.ComponentProps<typeof Ionicons>['name']> = {
  ride: 'map-outline',
  photo: 'camera-outline',
  story: 'construct-outline',
};

/** "Nominations close 10/11/2026", "Voting closes 30/11/2026" or "Closed 30/11/2026". */
function phaseLine(a: Award, today: string): string {
  const phase = awardPhase(a, today);
  if (phase === 'nominating') return `Nominations close ${formatAuDate(a.nominationsClose)}`;
  if (phase === 'voting') return `Voting closes ${formatAuDate(a.votingClose)}`;
  return `Closed ${formatAuDate(a.votingClose)}`;
}

function nominationTitle(n: Nomination, rides: Ride[]): string {
  if (n.rideId) return rides.find((r) => r.id === n.rideId)?.title ?? 'A ride';
  return n.title ?? '';
}

function nominatorLine(n: Nomination, data: ClubData): string {
  const m = data.members.find((x) => x.id === n.nominatedBy);
  return `Nominated by ${m ? displayName(m) : 'a former member'}`;
}

// ---------------------------------------------------------------------------
// Members tab: the way in
// ---------------------------------------------------------------------------

export function BragRow({ last = false }: { last?: boolean }) {
  const navigation = useNavigation<Nav>();
  return (
    <ListRow
      left={<IconBadge icon="ribbon-outline" tone="red" />}
      title="Bragging rights"
      subtitle="Ride of the year, best photo, best breakdown"
      onPress={() => navigation.navigate('Bragging')}
      last={last}
    />
  );
}

// ---------------------------------------------------------------------------
// All awards
// ---------------------------------------------------------------------------

function AwardRowItem({ award, last }: { award: Award; last: boolean }) {
  const navigation = useNavigation<Nav>();
  const { today } = useClub();
  const { nominations, tallies, bragRides } = useSocial();
  const phase = awardPhase(award, today);
  const winners = phase === 'closed' ? results(nominations.filter((n) => n.awardId === award.id), tallies).filter((r) => r.winner) : [];
  const subtitle =
    phase === 'closed'
      ? winners.length > 0
        ? `Winner: ${winners.map((w) => nominationTitle(w.nomination, bragRides)).join(' and ')}`
        : nominations.some((n) => n.awardId === award.id)
          ? 'No votes were cast'
          : 'Nothing was nominated'
      : phaseLine(award, today);
  return (
    <ListRow
      left={<IconBadge icon={KIND_ICON[award.kind]} tone={phase === 'closed' ? 'steel' : 'red'} />}
      title={award.title}
      subtitle={subtitle}
      onPress={() => navigation.navigate('Award', { awardId: award.id })}
      last={last}
    />
  );
}

export function BraggingScreen({ navigation }: RootScreen<'Bragging'>) {
  const { me, data, today, isDemo, refresh: refreshClub } = useClub();
  const { ready, awards, refresh } = useSocial();
  const { open, past } = awardsFor(awards, today);
  return (
    <Screen onRefresh={isDemo ? undefined : () => Promise.all([refresh(), refreshClub()]).then(() => undefined)}>
      {canRunAwards(me, data.positions) ? <Button label="Open an award" icon="add" onPress={() => navigation.navigate('OpenAward')} /> : null}
      <SectionTitle title="Up for grabs" />
      {!ready ? <ActivityIndicator color={colors.redText} /> : null}
      {ready && open.length === 0 ? (
        <Card>
          <Small>No awards open right now. The board opens them when it’s time.</Small>
        </Card>
      ) : null}
      {open.length > 0 ? (
        <Card style={{ padding: 0, gap: 0 }}>
          {open.map((a, i) => (
            <AwardRowItem key={a.id} award={a} last={i === open.length - 1} />
          ))}
        </Card>
      ) : null}
      {past.length > 0 ? (
        <>
          <SectionTitle title="Past winners" />
          <Card style={{ padding: 0, gap: 0 }}>
            {past.map((a, i) => (
              <AwardRowItem key={a.id} award={a} last={i === past.length - 1} />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One award
// ---------------------------------------------------------------------------

function NominationCard({
  nomination,
  award,
  votes,
  winner,
  onError,
}: {
  nomination: Nomination;
  award: Award;
  votes: number | null;
  winner: boolean;
  onError: (message: string | null) => void;
}) {
  const { me, data, today } = useClub();
  const { myVotes, castBragVote, withdrawNomination, bragRides } = useSocial();
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const phase = awardPhase(award, today);
  const mine = nomination.nominatedBy === me?.id;
  const chosen = myVotes.some((v) => v.nominationId === nomination.id);
  const ride = nomination.rideId ? bragRides.find((r) => r.id === nomination.rideId) : undefined;
  // Inside the screen's and the card's padding, and the card's border.
  const photoWidth = Math.floor(Math.min(width, MAX_CONTENT_WIDTH) - space.lg * 4 - 2);
  const photo = nomination.photo;
  const vote = () => {
    if (busy) return;
    onError(null);
    setBusy(true);
    castBragVote(nomination.id)
      .catch((e) => onError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const title = nominationTitle(nomination, bragRides);
  return (
    <Card style={chosen || winner ? { borderColor: colors.redBright } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[type.name, { fontSize: 17 }]}>{title}</Text>
          {ride ? <Text style={[type.name, { fontSize: 13, color: colors.boneMute }]}>{formatAuDate(melbourneDate(ride.startsAt))}</Text> : null}
        </View>
        {winner ? <Chip label="Winner" tone="red" icon="trophy" /> : null}
        {chosen && !winner ? <Chip label="Your vote" tone="redOutline" /> : null}
        {mine && phase !== 'closed' ? <Chip label="Yours" /> : null}
      </View>
      {photo ? (
        <ListingPhotoBox
          path={photo.path}
          bucket="brag"
          icon="camera-outline"
          size={photoWidth}
          height={Math.round(photoWidth * (photo.width && photo.height ? Math.min(photo.height / photo.width, 1.25) : 0.75))}
          label={`Photo: ${title}`}
        />
      ) : null}
      {nomination.story ? <Body selectable>{nomination.story}</Body> : null}
      {nomination.reason ? <Small>{`“${nomination.reason}”`}</Small> : null}
      <Small>{nominatorLine(nomination, data)}</Small>
      {votes !== null ? <Text style={[type.name, { color: colors.boneDim }]}>{`${votes} ${votes === 1 ? 'vote' : 'votes'}`}</Text> : null}
      {phase === 'voting' && !mine && !chosen ? (
        <Button
          label="Vote for this"
          kind="secondary"
          icon="checkmark-circle-outline"
          busy={busy}
          accessibilityLabel={`Vote for ${title}`}
          onPress={vote}
        />
      ) : null}
      {phase === 'nominating' && canWithdraw(me, nomination, data.positions) ? (
        <ConfirmButton
          label="Withdraw"
          confirmLabel="Withdraw it"
          kind="quiet"
          icon="arrow-undo-outline"
          confirmNote="It comes off the list. Anyone can nominate it again while nominations are open."
          onConfirm={() => {
            onError(null);
            return withdrawNomination(nomination.id).catch((e) => onError((e as Error).message));
          }}
        />
      ) : null}
      {!mine ? <ReportBox kind="nomination" targetId={nomination.id} authorId={nomination.nominatedBy} /> : null}
    </Card>
  );
}

export function AwardScreen({ route, navigation }: RootScreen<'Award'>) {
  const { me, data, today, isDemo } = useClub();
  const { ready, awards, nominations, tallies, myVotes, archiveAward, myOpenReports, refresh } = useSocial();
  const [error, setError] = useState<string | null>(null);
  const shown = awards.find((a) => a.id === route.params.awardId && !a.archivedAt);
  const shownPhase = shown ? awardPhase(shown, today) : null;
  // Counts arrive once voting closes: fetch them when an award closes while it's open here.
  useEffect(() => {
    if (!isDemo && shownPhase === 'closed') refresh().catch(() => undefined);
  }, [isDemo, shownPhase, refresh]);
  if (!ready) {
    return (
      <Screen>
        <ActivityIndicator color={colors.redText} />
      </Screen>
    );
  }
  const award = shown;
  if (!award) {
    return (
      <Screen>
        <Notice title="Not found">That award isn’t up any more.</Notice>
      </Screen>
    );
  }
  const phase = awardPhase(award, today);
  // Anything you've reported is out of your view until the board deals with it.
  const list = withoutReported(nominations.filter((n) => n.awardId === award.id && !n.withdrawnAt), 'nomination', myOpenReports);
  const ranked = phase === 'closed' ? results(list, tallies) : list.map((n) => ({ nomination: n, votes: 0, winner: false }));
  const mineCount = list.filter((n) => n.nominatedBy === me?.id).length;
  const voted = myVotes.some((v) => v.awardId === award.id);

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Card>
        <H2>{award.title}</H2>
        <Text style={[type.name, { color: colors.redText }]}>{phaseLine(award, today)}</Text>
        <Small>
          {phase === 'nominating'
            ? `Nominate ${award.kind === 'ride' ? `a club ride from ${award.year}` : BRAG_KIND_LABEL[award.kind].toLowerCase()}, up to ${MAX_NOMINATIONS} each. Voting opens the day after nominations close.`
            : phase === 'voting'
              ? voted
                ? 'You’ve voted. You can change it until voting closes. Counts show once it does.'
                : 'One vote each, not for your own. Counts show once voting closes.'
              : 'Voting has closed. Here’s how it went.'}
        </Small>
      </Card>
      {phase === 'nominating' && mineCount < MAX_NOMINATIONS ? (
        <Button label="Nominate" icon="add" onPress={() => navigation.navigate('Nominate', { awardId: award.id })} />
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ranked.length === 0 ? (
        <Card>
          <Small>{phase === 'nominating' ? 'No nominations yet. Be the first.' : 'Nothing was nominated.'}</Small>
        </Card>
      ) : null}
      {ranked.map((r) => (
        <NominationCard
          key={r.nomination.id}
          nomination={r.nomination}
          award={award}
          votes={phase === 'closed' ? r.votes : null}
          winner={r.winner}
          onError={setError}
        />
      ))}
      {canRunAwards(me, data.positions) ? (
        <ConfirmButton
          label="Take the award off"
          confirmLabel="Take it off"
          kind="quiet"
          icon="archive-outline"
          confirmNote="It’s kept, but members won’t see it or its nominations any more."
          onConfirm={() =>
            archiveAward(award.id)
              .then(() => navigation.goBack())
              .catch((e) => setError((e as Error).message))
          }
        />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Nominate
// ---------------------------------------------------------------------------

export function NominateScreen({ route, navigation }: RootScreen<'Nominate'>) {
  const { me, today } = useClub();
  const { ready, awards, nominations, nominate, bragRides } = useSocial();
  const { width } = useWindowDimensions();
  const [rideId, setRideId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [story, setStory] = useState('');
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState<PickedMedia | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ready) {
    return (
      <Screen>
        <ActivityIndicator color={colors.redText} />
      </Screen>
    );
  }
  const award = awards.find((a) => a.id === route.params.awardId && !a.archivedAt);
  if (!award) {
    return (
      <Screen>
        <Notice title="Not found">That award isn’t up any more.</Notice>
      </Screen>
    );
  }
  const taken = new Set(nominations.filter((n) => n.awardId === award.id && !n.withdrawnAt).map((n) => n.rideId));
  const rides = bragRides
    .filter((r) => rideFitsAward(r, award.year, today) && !taken.has(r.id))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const photoWidth = Math.floor(Math.min(width, MAX_CONTENT_WIDTH) - space.lg * 4 - 2);

  const pick = (source: 'library' | 'camera') => {
    setError(null);
    pickMedia(source, 1, true)
      .then((picked) => {
        const p = picked.find((x) => x.kind === 'photo');
        if (p) setPhoto(p);
      })
      .catch((e) => setError(e instanceof PickProblem ? e.message : 'That photo couldn’t be opened. Try another.'));
  };

  const send = () => {
    if (busy) return;
    setError(null);
    const standIn = photo ? { path: `${me?.id ?? ''}/new-0`, width: photo.width, height: photo.height } : null;
    const input = { awardId: award.id, rideId, title, photo: null, story, reason };
    const problem = nominationProblem(me, { ...input, photo: standIn }, awards, nominations, bragRides, today);
    if (problem) return setError(problem);
    setBusy(true);
    nominate(input, award.kind === 'photo' ? photo : null)
      .then(() => navigation.goBack())
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <H2>{award.title}</H2>
      {award.kind === 'ride' ? (
        <>
          <SectionTitle title="Pick a ride" />
          {rides.length === 0 ? (
            <Card>
              <Small>{`No club rides from ${award.year} left to nominate.`}</Small>
            </Card>
          ) : (
            <Card style={{ padding: 0, gap: 0 }}>
              {rides.map((r, i) => {
                const on = rideId === r.id;
                return (
                  <Pressable
                    key={r.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    aria-checked={on}
                    onPress={() => setRideId(r.id)}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      minHeight: 56,
                      paddingHorizontal: space.lg,
                      paddingVertical: space.sm,
                      borderBottomWidth: i === rides.length - 1 ? 0 : 1,
                      borderBottomColor: colors.line,
                      backgroundColor: pressed || hovered ? colors.steel : 'transparent',
                    })}
                  >
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.redText : colors.boneMute} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={type.name} numberOfLines={1}>
                        {r.title}
                      </Text>
                      <Text style={[type.name, { fontSize: 13, color: colors.boneMute }]}>{formatAuDate(melbourneDate(r.startsAt))}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
          )}
        </>
      ) : (
        <Card>
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder={award.kind === 'photo' ? 'Sunset at Apollo Bay' : 'The Ballan fuel line'}
            maxLength={MAX_BRAG_TITLE * 2}
          />
          {award.kind === 'story' ? (
            <Field
              label="The story"
              value={story}
              onChangeText={setStory}
              multiline
              placeholder="What broke, where, and how you got home"
              maxLength={MAX_BRAG_STORY * 2}
            />
          ) : (
            <>
              {photo ? (
                <View>
                  <ListingPhotoBox uri={photo.uri} size={photoWidth} height={Math.round(photoWidth * 0.75)} label="The photo" />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove the photo"
                    onPress={() => setPhoto(null)}
                    style={{ position: 'absolute', top: 0, right: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="close" size={18} color={colors.bone} />
                    </View>
                  </Pressable>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="Pick a photo" kind="secondary" icon="images-outline" onPress={() => pick('library')} style={{ flex: 1 }} />
                  {Platform.OS !== 'web' ? (
                    <Button label="Camera" kind="secondary" icon="camera-outline" onPress={() => pick('camera')} style={{ flex: 1 }} />
                  ) : null}
                </View>
              )}
            </>
          )}
        </Card>
      )}
      <Card>
        <Field
          label="Why it deserves it"
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder="One line for the voters"
          hint="Optional."
          maxLength={MAX_BRAG_REASON * 2}
        />
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Nominate it" icon="checkmark" busy={busy} onPress={send} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Open an award (the board)
// ---------------------------------------------------------------------------

/** A DD/MM/YYYY box: what's typed, and the ISO date when it's a real one. */
function useDay(initialIso: string) {
  const [text, setText] = useState(formatAuDate(initialIso));
  const iso = parseAuDate(text.trim()) ?? '';
  return { text, setText: (t: string) => setText(typeDate(t)), iso };
}

export function OpenAwardScreen({ navigation }: RootScreen<'OpenAward'>) {
  const { me, data, today } = useClub();
  const { openAward } = useSocial();
  const [kind, setKind] = useState<BragKind>('ride');
  const [title, setTitle] = useState(`${DEFAULT_TITLE.ride} ${today.slice(0, 4)}`);
  const [titleTyped, setTitleTyped] = useState(false);
  const [year, setYear] = useState(today.slice(0, 4));
  const noms = useDay('');
  const votes = useDay('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRunAwards(me, data.positions)) {
    return (
      <Screen>
        <Notice title="Board only">Only the board can run awards.</Notice>
      </Screen>
    );
  }

  // The name follows the kind and year until it's typed in itself.
  const suggest = (k: BragKind, y: string) => {
    if (!titleTyped) setTitle(`${DEFAULT_TITLE[k]}${/^\d{4}$/.test(y) ? ` ${y}` : ''}`);
  };

  const open = () => {
    if (busy) return;
    setError(null);
    const input = {
      kind,
      title,
      year: /^\d{4}$/.test(year.trim()) ? Number(year.trim()) : Number.NaN,
      nominationsClose: noms.iso,
      votingClose: votes.iso,
    };
    const problem = openAwardProblem(me, input, data.positions, today);
    if (problem) return setError(problem);
    setBusy(true);
    openAward(input)
      .then((id) => navigation.replace('Award', { awardId: id }))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <Card>
        <Choices<BragKind>
          label="For"
          options={BRAG_KINDS.map((k) => ({ value: k, label: BRAG_KIND_LABEL[k] }))}
          value={kind}
          onChange={(k) => {
            setKind(k);
            suggest(k, year);
          }}
        />
        <Field
          label="Name"
          value={title}
          onChangeText={(t) => {
            setTitle(t);
            setTitleTyped(true);
          }}
          maxLength={MAX_AWARD_NAME * 2}
        />
        <Field
          label="Year it covers"
          value={year}
          onChangeText={(y) => {
            setYear(y);
            suggest(kind, y);
          }}
          keyboardType="number-pad"
          maxLength={4}
          hint={kind === 'ride' ? 'Members pick club rides from this year.' : undefined}
        />
      </Card>
      <Card>
        <Field
          label="Nominations close"
          value={noms.text}
          onChangeText={noms.setText}
          placeholder="DD/MM/YYYY"
          keyboardType="number-pad"
          maxLength={10}
          hint="Open until the end of this day."
        />
        <Field
          label="Voting closes"
          value={votes.text}
          onChangeText={votes.setText}
          placeholder="DD/MM/YYYY"
          keyboardType="number-pad"
          maxLength={10}
          hint="Voting starts the day after nominations close. Results show the day after this."
        />
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Open the award" icon="checkmark" busy={busy} onPress={open} />
    </Screen>
  );
}
