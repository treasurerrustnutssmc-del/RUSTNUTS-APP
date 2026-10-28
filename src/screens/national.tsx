// National: contributions the NEC asks of the chapters (13.6), split by Voting Members, and new
// chapters put forward with their written proposal and founders (12.1).

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { isNational } from '../domain/access';
import { formatAuDate } from '../domain/dates';
import { formatCents, parseDollars } from '../domain/fees';
import { RESULT_LABEL } from '../domain/labels';
import {
  boardVoteFits, CHAPTER_PARTS, necVoteFits, CONTRIBUTION_STATUS_LABEL, contributionsToDecide, PART_LABEL, PROPOSAL_STATUS_LABEL, sharesFor, STATES,
} from '../domain/national';
import { displayName } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import type { ChapterPart, ContributionStatus, Member, ProposalStatus, Vote } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { space, type } from '../theme';
import {
  Body, Button, Card, Chip, Choices, ConfirmButton, Field, H1, IconBadge, Label, ListRow, Notice, Row, Screen, SectionTitle, Small, Stack,
} from '../ui/primitives';
import { ActionWithReason, Fact, MemberPicker, styles, useRun } from './adminBits';

type Tone = 'ok' | 'warn' | 'danger' | 'steel';
const K_TONE: Record<ContributionStatus, Tone> = { proposed: 'warn', approved: 'ok', not_approved: 'danger', withdrawn: 'steel' };
const P_TONE: Record<ProposalStatus, Tone> = K_TONE;
const num = { fontVariant: ['tabular-nums' as const] };
const useNav = () => useNavigation<NavigationProp<RootParams>>();
const patched = (m: Member) => m.approval === 'approved' && (m.status === 'full' || m.status === 'nomad');

function nameOf(id: string | null, members: Member[]): string {
  const m = id ? members.find((x) => x.id === id) : undefined;
  return m ? displayName(m) : 'A former member';
}

const voteOption = (v: Vote) => ({
  value: v.id,
  label: `${v.question} · ${v.result ? RESULT_LABEL[v.result] : 'Closed'} ${formatAuDate(melbourneDate(v.closedAt!))}`,
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function NationalScreen({ navigation }: RootScreen<'National'>) {
  const { me, data } = useClub();
  if (!me) return null;
  const nec = isNational(me.id, data.positions);
  const toDecide = contributionsToDecide(me, data);
  const contributions = [...(data.contributions ?? [])].sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
  const proposals = [...(data.chapterProposals ?? [])].sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
  const chapterName = (id: string) => data.chapters.find((c) => c.id === id)?.name ?? 'Chapter';

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>National</H1>
        <Small>What the NEC asks the chapters to fund (13.6), and new chapters (12.1).</Small>
      </Stack>

      {toDecide.length > 0 ? (
        <>
          <SectionTitle title="Your board’s decision" action={<Text style={styles.count}>{toDecide.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {toDecide.map(({ k, chapterId }, i) => (
              <ListRow
                key={`${k.id}-${chapterId}`}
                last={i === toDecide.length - 1}
                left={<IconBadge icon="hand-left-outline" tone="red" />}
                title={k.title}
                subtitle={<Text style={styles.meta}>{`${chapterName(chapterId)} share ${formatCents(k.shares.find((s) => s.chapterId === chapterId)!.cents)}`}</Text>}
                onPress={() => navigation.navigate('Contribution', { contributionId: k.id })}
              />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle title="Contributions" />
      <Card style={{ padding: 0, gap: 0 }}>
        {contributions.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>Nothing asked of the chapters yet.</Small>
          </View>
        ) : (
          contributions.map((k, i) => (
            <ListRow
              key={k.id}
              last={i === contributions.length - 1}
              left={<IconBadge icon="flag-outline" />}
              title={<Text style={type.name} numberOfLines={2}>{k.title}</Text>}
              subtitle={
                <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
                  <Text style={styles.meta}>{`${k.decisions.filter((d) => d.yes).length} of ${k.shares.length} chapters said yes`}</Text>
                  <Chip label={CONTRIBUTION_STATUS_LABEL[k.status]} tone={K_TONE[k.status]} />
                </View>
              }
              right={<Text style={[type.name, num]}>{formatCents(k.totalCents)}</Text>}
              onPress={() => navigation.navigate('Contribution', { contributionId: k.id })}
            />
          ))
        )}
      </Card>
      {nec ? <Button label="Ask the chapters" kind="secondary" icon="add" onPress={() => navigation.navigate('ProposeContribution')} /> : null}

      <SectionTitle title="New chapters" />
      <Card style={{ padding: 0, gap: 0 }}>
        {proposals.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>No new chapters put forward.</Small>
          </View>
        ) : (
          proposals.map((p, i) => (
            <ListRow
              key={p.id}
              last={i === proposals.length - 1}
              left={<IconBadge icon="map-outline" />}
              title={p.name}
              subtitle={
                <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
                  <Text style={styles.meta}>{`${p.area} · ${p.founderIds.length} founders`}</Text>
                  <Chip label={PROPOSAL_STATUS_LABEL[p.status]} tone={P_TONE[p.status]} />
                </View>
              }
              onPress={() => navigation.navigate('ChapterProposal', { proposalId: p.id })}
            />
          ))
        )}
      </Card>
      {nec || patched(me) ? (
        <Button label="Propose a new chapter" kind="secondary" icon="add" onPress={() => navigation.navigate('ProposeChapter')} />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One contribution
// ---------------------------------------------------------------------------

function DecideForChapter({ contributionId, chapterId, proposedAt }: { contributionId: string; chapterId: string; proposedAt: string }) {
  const { data, decideContribution } = useClub();
  const navigation = useNav();
  const votes = (data.votes ?? []).filter((v) => boardVoteFits(v, chapterId, proposedAt, data)).sort((a, b) => b.closedAt!.localeCompare(a.closedAt!));
  const [voteId, setVoteId] = useState<string | null>(votes.length === 1 ? votes[0].id : null);
  const { busy, msg, run } = useRun();
  const chapter = data.chapters.find((c) => c.id === chapterId)?.name ?? 'Chapter';
  return (
    <Card>
      <Text style={type.name}>{`${chapter} board`}</Text>
      <Small>Pick the board’s closed vote on it (13.6). Carried means yes; anything else means no.</Small>
      {votes.length === 0 ? (
        <Stack gap={space.sm}>
          <Small>No closed board vote since it was asked. Hold one, then come back.</Small>
          <Button label="Open a board vote" kind="secondary" icon="hand-left-outline" onPress={() => navigation.navigate('NewVote', { chapterId })} />
        </Stack>
      ) : (
        <>
          <Choices<string> options={votes.map(voteOption)} value={voteId} onChange={setVoteId} />
          <ConfirmButton
            label="Record the decision"
            confirmLabel="Yes, record it"
            kind="primary"
            icon="checkmark"
            disabled={!voteId || busy === 'decide'}
            confirmNote={(() => {
              const v = votes.find((x) => x.id === voteId);
              return v ? `${chapter} says ${v.result === 'carried' ? 'yes' : 'no'}, by “${v.question}”.` : undefined;
            })()}
            onConfirm={() => run('decide', () => decideContribution(contributionId, chapterId, voteId!))}
          />
          <View accessibilityLiveRegion="polite" role="alert">{msg?.tone === 'danger' ? <Notice tone="danger">{msg.text}</Notice> : null}</View>
        </>
      )}
    </Card>
  );
}

export function ContributionScreen({ route }: RootScreen<'Contribution'>) {
  const { me, data, withdrawContribution } = useClub();
  const k = (data.contributions ?? []).find((x) => x.id === route.params.contributionId);
  const { msg, run } = useRun();
  if (!me || !k) {
    return (
      <Screen>
        <Notice tone="info">That contribution isn’t here.</Notice>
      </Screen>
    );
  }
  const mineToDecide = contributionsToDecide(me, data).filter((x) => x.k.id === k.id);
  const chapterName = (id: string) => data.chapters.find((c) => c.id === id)?.name ?? 'A former chapter';
  const yes = k.decisions.filter((d) => d.yes).length;
  const needed = Math.floor(k.shares.length / 2) + 1;

  return (
    <Screen>
      <Stack gap={space.sm}>
        <View style={{ flexDirection: 'row' }}>
          <Chip label={CONTRIBUTION_STATUS_LABEL[k.status]} tone={K_TONE[k.status]} />
        </View>
        <H1>{k.title}</H1>
        <Text style={[type.h2, num]}>{formatCents(k.totalCents)}</Text>
      </Stack>

      <Card>
        <Body selectable>{k.purpose}</Body>
        <Small>{`Asked by ${nameOf(k.proposedBy, data.members)} on ${formatAuDate(melbourneDate(k.proposedAt))}`}</Small>
        {k.status === 'proposed' ? <Fact icon="people-outline" text={`${yes} yes so far · ${needed} needed`} /> : null}
      </Card>

      <SectionTitle title="Each chapter’s share" />
      <Small>By Voting Members (Full and Nomad) when it was asked, to the cent.</Small>
      <Card style={{ padding: 0, gap: 0 }}>
        {k.shares.map((s, i) => {
          const d = k.decisions.find((x) => x.chapterId === s.chapterId);
          return (
            <ListRow
              key={s.chapterId}
              last={i === k.shares.length - 1}
              title={chapterName(s.chapterId)}
              subtitle={
                <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
                  <Text style={styles.meta}>{`${s.votingMembers} voting member${s.votingMembers === 1 ? '' : 's'}`}</Text>
                  <Chip
                    label={d ? (d.yes ? 'Yes' : 'No') : k.status === 'proposed' ? 'Waiting' : 'No decision'}
                    tone={d ? (d.yes ? 'ok' : 'danger') : 'steel'}
                  />
                </View>
              }
              right={<Text style={[type.name, num]}>{formatCents(s.cents)}</Text>}
            />
          );
        })}
      </Card>

      {mineToDecide.length > 0 ? (
        <>
          <SectionTitle title="Your board’s decision" />
          {mineToDecide.map(({ chapterId }) => (
            <DecideForChapter key={chapterId} contributionId={k.id} chapterId={chapterId} proposedAt={k.proposedAt} />
          ))}
        </>
      ) : null}

      <Small>Moving the shares between the funds comes later. For now each treasurer pays theirs as a normal payment.</Small>

      {k.status === 'proposed' && isNational(me.id, data.positions) ? (
        <ConfirmButton
          label="Withdraw it"
          confirmLabel="Yes, withdraw"
          kind="secondary"
          onConfirm={() => run('withdraw', () => withdrawContribution(k.id), 'Withdrawn.')}
        />
      ) : null}
      {msg ? <View accessibilityLiveRegion="polite"><Notice tone={msg.tone}>{msg.text}</Notice></View> : null}
    </Screen>
  );
}

export function ProposeContributionScreen({ navigation }: RootScreen<'ProposeContribution'>) {
  const { me, data, proposeContribution } = useClub();
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [total, setTotal] = useState('');
  const { busy, msg, run } = useRun();
  if (!me || !isNational(me.id, data.positions)) {
    return (
      <Screen>
        <Notice tone="info">Only the NEC can propose a national contribution (13.6).</Notice>
      </Screen>
    );
  }
  const cents = parseDollars(total);
  const shares = cents ? sharesFor(cents, data) : [];
  const chapterName = (id: string) => data.chapters.find((c) => c.id === id)?.name ?? 'Chapter';
  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Ask the chapters</H1>
        <Small>A national event or project budget. Each chapter’s board decides on its share (13.6).</Small>
      </Stack>
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={80} placeholder="National run 2027" />
      <Field label="What it’s for" value={purpose} onChangeText={setPurpose} multiline maxLength={1000} />
      <Field label="Total" value={total} onChangeText={setTotal} keyboardType="decimal-pad" placeholder="1200" error={total.trim() && cents === null ? 'Enter an amount, like 1200.' : null} />
      {shares.length > 0 ? (
        <Card style={{ padding: 0, gap: 0 }}>
          {shares.map((s, i) => (
            <ListRow
              key={s.chapterId}
              last={i === shares.length - 1}
              title={chapterName(s.chapterId)}
              subtitle={<Text style={styles.meta}>{`${s.votingMembers} voting members`}</Text>}
              right={<Text style={[type.name, num]}>{formatCents(s.cents)}</Text>}
            />
          ))}
        </Card>
      ) : null}
      <Small>Most chapters saying yes approves it. The shares are fixed when you ask.</Small>
      <ActionWithReason
        label="Ask the chapters"
        icon="paper-plane-outline"
        big
        busy={busy === 'save'}
        reason={msg?.tone === 'danger' ? msg.text : null}
        onPress={() =>
          run('save', async () => {
            const id = await proposeContribution({ title, purpose, totalCents: cents ?? 0 });
            navigation.replace('Contribution', { contributionId: id });
          })
        }
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// New chapters
// ---------------------------------------------------------------------------

export function ChapterProposalScreen({ route, navigation }: RootScreen<'ChapterProposal'>) {
  const { me, data, settleChapter, withdrawChapter } = useClub();
  const p = (data.chapterProposals ?? []).find((x) => x.id === route.params.proposalId);
  const nec = !!me && isNational(me.id, data.positions);
  const votes = p
    ? (data.votes ?? [])
        .filter((v) => necVoteFits(v, p.proposedAt, data))
        .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))
    : [];
  const [voteId, setVoteId] = useState<string | null>(votes.length === 1 ? votes[0].id : null);
  const { busy, msg, run } = useRun();
  if (!me || !p) {
    return (
      <Screen>
        <Notice tone="info">That proposal isn’t here.</Notice>
      </Screen>
    );
  }
  const chosen = votes.find((v) => v.id === voteId);
  const fail = msg?.tone === 'danger' ? msg.text : null;
  return (
    <Screen>
      <Stack gap={space.sm}>
        <View style={{ flexDirection: 'row' }}>
          <Chip label={PROPOSAL_STATUS_LABEL[p.status]} tone={P_TONE[p.status]} />
        </View>
        <H1>{p.name}</H1>
        <Small>{`${p.area} · ${p.state}`}</Small>
      </Stack>

      {p.status === 'approved' && p.chapterId ? (
        <Card style={{ padding: 0, gap: 0 }}>
          <ListRow last left={<IconBadge icon="flag-outline" />} title={`${p.name} chapter`} subtitle="Open the new chapter" onPress={() => navigation.navigate('ChapterDetail', { chapterId: p.chapterId! })} />
        </Card>
      ) : null}

      <SectionTitle title="The proposal" />
      <Card>
        {CHAPTER_PARTS.map((part) => (
          <View key={part} style={{ gap: 2 }}>
            <Label>{PART_LABEL[part]}</Label>
            <Body selectable>{p.plan[part]}</Body>
          </View>
        ))}
        <Small>{`Put forward by ${nameOf(p.proposedBy, data.members)} on ${formatAuDate(melbourneDate(p.proposedAt))}`}</Small>
      </Card>

      <SectionTitle title="Founders" action={<Text style={styles.count}>{p.founderIds.length}</Text>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {p.founderIds.map((id, i) => (
          <ListRow
            key={id}
            last={i === p.founderIds.length - 1}
            title={nameOf(id, data.members)}
            right={
              id === p.presidentId ? <Chip label="President" tone="bone" /> : id === p.saaId ? <Chip label="SAA" tone="bone" /> : undefined
            }
            onPress={() => navigation.navigate('MemberDetail', { memberId: id })}
          />
        ))}
      </Card>

      {p.status === 'proposed' && nec ? (
        <>
          <SectionTitle title="The NEC’s decision" />
          <Card>
            <Small>Pick the NEC’s closed vote on it (12.1). A carried vote makes the chapter, moves the founders and seats the President and SAA today.</Small>
            {votes.length === 0 ? (
              <Stack gap={space.sm}>
                <Small>No closed NEC vote since it was put forward.</Small>
                <Button label="Open an NEC vote" kind="secondary" icon="hand-left-outline" onPress={() => navigation.navigate('NewVote', { chapterId: null })} />
              </Stack>
            ) : (
              <>
                <Choices<string> options={votes.map(voteOption)} value={voteId} onChange={setVoteId} />
                <ConfirmButton
                  label={chosen && chosen.result !== 'carried' ? 'Mark it not approved' : `Make the ${p.name} chapter`}
                  confirmLabel={chosen && chosen.result !== 'carried' ? 'Yes, not approved' : 'Yes, make it'}
                  kind="primary"
                  icon="checkmark"
                  disabled={!chosen || busy === 'settle'}
                  confirmNote={
                    chosen
                      ? chosen.result === 'carried'
                        ? `“${chosen.question}” carried. This makes the chapter, moves ${p.founderIds.length} founders and seats the President and SAA today. It can’t be undone here.`
                        : `“${chosen.question}” didn’t carry, so the proposal closes as not approved.`
                      : undefined
                  }
                  onConfirm={() =>
                    run('settle', async () => {
                      const chapterId = await settleChapter(p.id, voteId!);
                      if (chapterId) navigation.replace('ChapterDetail', { chapterId });
                    })
                  }
                />
                <View accessibilityLiveRegion="polite" role="alert">{fail ? <Notice tone="danger">{fail}</Notice> : null}</View>
              </>
            )}
          </Card>
        </>
      ) : null}

      {p.status === 'proposed' && (nec || p.proposedBy === me.id) ? (
        <ConfirmButton label="Withdraw it" confirmLabel="Yes, withdraw" kind="secondary" onConfirm={() => run('withdraw', () => withdrawChapter(p.id), 'Withdrawn.')} />
      ) : null}
      {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}
    </Screen>
  );
}

const EMPTY_PLAN: Record<ChapterPart, string> = { location: '', membership: '', leadership: '', budget: '', operations: '' };
const PART_HINT: Record<ChapterPart, string> = {
  location: 'Where it’s based and where it meets.',
  membership: 'Who’s joining and how it will grow.',
  leadership: 'Who leads it to start, and how it elects a board.',
  budget: 'Start-up money and fees until the board sets its own.',
  operations: 'Rides, meetings and how it works with the other chapters.',
};

export function ProposeChapterScreen({ navigation }: RootScreen<'ProposeChapter'>) {
  const { me, data, proposeChapter } = useClub();
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [state, setState] = useState('VIC');
  const [plan, setPlan] = useState(EMPTY_PLAN);
  const [founders, setFounders] = useState<string[]>(me && patched(me) ? [me.id] : []);
  const [presidentId, setPresidentId] = useState<string | null>(null);
  const [saaId, setSaaId] = useState<string | null>(null);
  const { busy, msg, run } = useRun();
  if (!me) return null;
  const choices = data.members.filter(patched);
  const chapterName = (m: Member) => data.chapters.find((c) => c.id === m.chapterId)?.name;
  const seatOptions = founders
    .map((id) => data.members.find((m) => m.id === id))
    .filter((m): m is Member => !!m && m.status === 'full')
    .map((m) => ({ value: m.id, label: displayName(m) }));
  const pickFounders = (ids: string[]) => {
    setFounders(ids);
    if (presidentId && !ids.includes(presidentId)) setPresidentId(null);
    if (saaId && !ids.includes(saaId)) setSaaId(null);
  };
  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Propose a new chapter</H1>
        <Small>A written proposal and at least five patched founders. The NEC approves it by vote (12.1).</Small>
      </Stack>
      <Field label="Name" value={name} onChangeText={setName} maxLength={40} placeholder="Geelong" />
      <Field label="Area" value={area} onChangeText={setArea} maxLength={80} placeholder="Geelong and the Bellarine" />
      <Choices<string> label="State" options={STATES.map((s) => ({ value: s, label: s }))} value={state} onChange={setState} />

      <SectionTitle title="The proposal" />
      {CHAPTER_PARTS.map((part) => (
        <Field
          key={part}
          label={PART_LABEL[part]}
          hint={PART_HINT[part]}
          value={plan[part]}
          onChangeText={(t) => setPlan((x) => ({ ...x, [part]: t }))}
          multiline
          maxLength={2000}
          autoCapitalize="sentences"
        />
      ))}

      <SectionTitle title="Founders" action={<Text style={styles.count}>{founders.length}</Text>} />
      <MemberPicker label="At least five, Full or Nomad" choices={choices} picked={founders} onChange={pickFounders} multi sub={chapterName} />
      {seatOptions.length > 0 ? (
        <>
          <Choices<string> label="Founding President" options={seatOptions} value={presidentId} onChange={setPresidentId} />
          <Choices<string> label="Founding Sergeant-at-Arms" options={seatOptions.filter((o) => o.value !== presidentId)} value={saaId} onChange={setSaaId} />
          <Small>Full members only: Nomads don’t hold board seats (9.1).</Small>
        </>
      ) : null}

      <Row style={{ gap: space.sm }}>
        <Small style={{ flex: 1 }}>Founders holding a post in their old chapter end it before the chapter is made.</Small>
      </Row>
      <ActionWithReason
        label="Put it forward"
        icon="paper-plane-outline"
        big
        busy={busy === 'save'}
        reason={msg?.tone === 'danger' ? msg.text : null}
        onPress={() =>
          run('save', async () => {
            const id = await proposeChapter({ name, area, state, plan, founderIds: founders, presidentId: presidentId ?? '', saaId: saaId ?? '' });
            navigation.replace('ChapterProposal', { proposalId: id });
          })
        }
      />
    </Screen>
  );
}
