// The national level (constitution v4 12.1, 13.6): contributions the NEC asks of the chapters,
// shared by Voting Members, and new chapters. The database's actions refuse with the same words,
// in the same order.

import { activePositions, holdsBoardSeat, isNational } from './access';
import { TITLE_ROLES } from './labels';
import { signedInProblem } from './meetings';
import type {
  ChapterPart, ChapterProposal, ClubData, Contribution, ContributionShare, ContributionStatus, Member, ProposalStatus, Vote,
} from './types';

export const CHAPTER_PARTS: ChapterPart[] = ['location', 'membership', 'leadership', 'budget', 'operations'];
export const PART_LABEL: Record<ChapterPart, string> = {
  location: 'Location',
  membership: 'Membership',
  leadership: 'Leadership',
  budget: 'Budget',
  operations: 'Operations',
};
export const STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
export const MIN_FOUNDERS = 5;
export const MIN_TOTAL_CENTS = 100;
export const MAX_TOTAL_CENTS = 10000000;

export const CONTRIBUTION_STATUS_LABEL: Record<ContributionStatus, string> = {
  proposed: 'With the chapters',
  approved: 'Approved',
  not_approved: 'Not approved',
  withdrawn: 'Withdrawn',
};
export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  proposed: 'With the NEC',
  approved: 'Approved',
  not_approved: 'Not approved',
  withdrawn: 'Withdrawn',
};

export const NO_CONTRIBUTION = 'No such contribution.';
export const CONTRIBUTION_SETTLED = 'That contribution is settled.';
export const NO_PROPOSAL = 'No such proposal.';
export const PROPOSAL_SETTLED = 'That proposal is settled.';
export const NAME_TAKEN = 'There’s already a chapter called that.';
export const NOT_PATCHED_FOUNDERS = 'Founders must be approved Full or Nomad members (12.1).';
export const FOUNDER_SEATS = 'Pick a founding President and Sergeant-at-Arms from the founders (12.1).';
export const NOMAD_SEAT = 'Nomads can’t hold a board seat (9.1).';

const length = (s: string) => [...s].length;
const isVoting = (m: Member) => m.approval === 'approved' && (m.status === 'full' || m.status === 'nomad');

/** Voting Members (Full and Nomad, 2.4) in each chapter, chapters by slug. */
export function votingCounts(data: ClubData): { chapterId: string; votingMembers: number }[] {
  return [...data.chapters]
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((c) => ({ chapterId: c.id, votingMembers: data.members.filter((m) => m.chapterId === c.id && isVoting(m)).length }));
}

/**
 * Splits a total in proportion to Voting Members, to the cent: each chapter gets its whole cents,
 * and the cents left over go one each to the largest fractions, ties to the earlier slug.
 */
export function shareOut(totalCents: number, chapters: { chapterId: string; slug: string; votingMembers: number }[]): ContributionShare[] {
  const sum = chapters.reduce((n, c) => n + c.votingMembers, 0);
  const ordered = [...chapters].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const parts = ordered.map((c) => ({ ...c, whole: sum === 0 ? 0 : Math.floor((totalCents * c.votingMembers) / sum), rest: sum === 0 ? 0 : (totalCents * c.votingMembers) % sum }));
  let left = totalCents - parts.reduce((n, p) => n + p.whole, 0);
  const byRest = [...parts].sort((a, b) => b.rest - a.rest || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const extra = new Set<string>();
  for (const p of byRest) {
    if (left <= 0) break;
    extra.add(p.chapterId);
    left -= 1;
  }
  return parts.map((p) => ({ chapterId: p.chapterId, votingMembers: p.votingMembers, cents: p.whole + (extra.has(p.chapterId) ? 1 : 0) }));
}

export const sharesFor = (totalCents: number, data: ClubData): ContributionShare[] =>
  shareOut(totalCents, votingCounts(data).map((c) => ({ ...c, slug: data.chapters.find((x) => x.id === c.chapterId)!.slug })));

export interface ContributionInput {
  title: string;
  purpose: string;
  totalCents: number;
}

export function proposeContributionProblem(me: Member | null, input: ContributionInput, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!isNational(me!.id, data.positions)) return 'Only the NEC can propose a national contribution (13.6).';
  const title = input.title.trim();
  if (!title) return 'Give it a title.';
  if (length(title) > 80) return 'Keep the title to 80 characters at most.';
  const purpose = input.purpose.trim();
  if (!purpose) return 'Say what it’s for.';
  if (length(purpose) > 1000) return 'Keep it to 1000 characters at most.';
  if (!Number.isInteger(input.totalCents) || input.totalCents < MIN_TOTAL_CENTS || input.totalCents > MAX_TOTAL_CENTS) {
    return 'Enter a total from $1 to $100,000.';
  }
  if (votingCounts(data).every((c) => c.votingMembers === 0)) return 'There are no Voting Members to share it between.';
  return null;
}

/** Approved once most of its chapters say yes; not approved once that can't happen; else null. */
export function settledStatus(k: Pick<Contribution, 'shares' | 'decisions'>): ContributionStatus | null {
  const chapters = k.shares.length;
  const yes = k.decisions.filter((d) => d.yes).length;
  const no = k.decisions.length - yes;
  if (yes * 2 > chapters) return 'approved';
  if (no * 2 >= chapters) return 'not_approved';
  return null;
}

/** A vote already standing for a contribution decision, a new chapter or a budget can't stand for another. */
export const voteUsed = (voteId: string, data: ClubData): boolean =>
  (data.contributions ?? []).some((k) => k.decisions.some((d) => d.voteId === voteId)) ||
  (data.chapterProposals ?? []).some((p) => p.voteId === voteId) ||
  (data.budgets ?? []).some((b) => b.approvedVoteId === voteId);

/** A chapter board's vote that can stand for its decision: opened after the proposal, closed, and not used for anything else. */
export const boardVoteFits = (vote: Vote | undefined, chapterId: string, after: string, data: ClubData): boolean =>
  !!vote && vote.chapterId === chapterId && vote.electorate === 'chapter_board' && vote.closedAt !== null && vote.openedAt > after &&
  !voteUsed(vote.id, data);

/** The NEC's vote on a new chapter: opened after the proposal, closed, and not used for anything else. */
export const necVoteFits = (vote: Vote | undefined, after: string, data: ClubData): boolean =>
  !!vote && vote.chapterId === null && vote.electorate === 'nec' && vote.closedAt !== null && vote.openedAt > after && !voteUsed(vote.id, data);

function contributionFor(me: Member | null, id: string, data: ClubData): { problem: string } | { k: Contribution } {
  const signedIn = signedInProblem(me);
  if (signedIn) return { problem: signedIn };
  const k = (data.contributions ?? []).find((c) => c.id === id);
  if (!k) return { problem: NO_CONTRIBUTION };
  if (k.status !== 'proposed') return { problem: CONTRIBUTION_SETTLED };
  return { k };
}

export function decideContributionProblem(me: Member | null, id: string, chapterId: string, voteId: string, data: ClubData): string | null {
  const found = contributionFor(me, id, data);
  if ('problem' in found) return found.problem;
  if (!found.k.shares.some((s) => s.chapterId === chapterId) || !holdsBoardSeat(me!.id, chapterId, data.positions)) {
    return 'Only that chapter’s board can record its decision.';
  }
  if (found.k.decisions.some((d) => d.chapterId === chapterId)) return 'That chapter has already decided.';
  const vote = (data.votes ?? []).find((v) => v.id === voteId);
  if (!boardVoteFits(vote, chapterId, found.k.proposedAt, data)) return 'Pick that chapter board’s closed vote on it (13.6).';
  return null;
}

export function withdrawContributionProblem(me: Member | null, id: string, data: ClubData): string | null {
  const found = contributionFor(me, id, data);
  if ('problem' in found) return found.problem;
  return isNational(me!.id, data.positions) ? null : 'Only the NEC can withdraw it.';
}

/** Chapters whose board hasn't decided yet and that this person sits on. */
export const contributionsToDecide = (me: Member | null, data: ClubData): { k: Contribution; chapterId: string }[] =>
  !me
    ? []
    : (data.contributions ?? []).flatMap((k) =>
        k.status !== 'proposed'
          ? []
          : k.shares
              .filter((s) => holdsBoardSeat(me.id, s.chapterId, data.positions) && !k.decisions.some((d) => d.chapterId === s.chapterId))
              .map((s) => ({ k, chapterId: s.chapterId })),
      );

// New chapters (12.1) ------------------------------------------------------------------------

/** A chapter's slug from its name: lower case, anything but letters and digits as one dash. */
export const slugOf = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export interface ChapterInput {
  name: string;
  area: string;
  state: string;
  plan: Record<ChapterPart, string>;
  founderIds: string[];
  presidentId: string;
  saaId: string;
}

function nameTaken(name: string, data: ClubData, except: string | null): boolean {
  const lower = name.trim().toLowerCase();
  const slug = slugOf(name);
  return (
    data.chapters.some((c) => c.name.trim().toLowerCase() === lower || c.slug === slug) ||
    (data.chapterProposals ?? []).some((p) => p.id !== except && p.status === 'proposed' && (p.name.trim().toLowerCase() === lower || slugOf(p.name) === slug))
  );
}

/** The founders and their seats as 12.1 and 9.1 need them. */
function foundersProblem(founderIds: string[], presidentId: string, saaId: string, data: ClubData): string | null {
  if (new Set(founderIds).size !== founderIds.length || founderIds.length < MIN_FOUNDERS) return 'A new chapter needs at least five founders (12.1).';
  const founders = founderIds.map((id) => data.members.find((m) => m.id === id));
  if (founders.some((m) => !m || !isVoting(m))) return NOT_PATCHED_FOUNDERS;
  if (!founderIds.includes(presidentId) || !founderIds.includes(saaId) || presidentId === saaId) return FOUNDER_SEATS;
  if ([presidentId, saaId].some((id) => data.members.find((m) => m.id === id)!.status === 'nomad')) return NOMAD_SEAT;
  return null;
}

export function proposeChapterProblem(me: Member | null, input: ChapterInput, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!isNational(me!.id, data.positions) && !input.founderIds.includes(me!.id)) return 'Only the NEC or one of the founders can put it forward.';
  const name = input.name.trim();
  if (!name || !slugOf(name)) return 'Name the chapter.';
  if (length(name) > 40) return 'Keep the name to 40 characters at most.';
  if (nameTaken(name, data, null)) return NAME_TAKEN;
  const area = input.area.trim();
  if (!area) return 'Say where it’s based.';
  if (length(area) > 80) return 'Keep the area to 80 characters at most.';
  if (!STATES.includes(input.state)) return 'Pick a state.';
  for (const part of CHAPTER_PARTS) {
    const text = (input.plan[part] ?? '').trim();
    if (!text) return `Cover the ${PART_LABEL[part].toLowerCase()} in the proposal (12.1).`;
    if (length(text) > 2000) return 'Keep each part to 2000 characters at most.';
  }
  return foundersProblem(input.founderIds, input.presidentId, input.saaId, data);
}

function proposalFor(me: Member | null, id: string, data: ClubData): { problem: string } | { p: ChapterProposal } {
  const signedIn = signedInProblem(me);
  if (signedIn) return { problem: signedIn };
  const p = (data.chapterProposals ?? []).find((x) => x.id === id);
  if (!p) return { problem: NO_PROPOSAL };
  if (p.status !== 'proposed') return { problem: PROPOSAL_SETTLED };
  return { p };
}

/**
 * Settles a proposal by the NEC's closed vote on it: carried approves it (and the chapter is made),
 * anything else marks it not approved. The founders are checked again before a chapter is made.
 */
export function settleChapterProblem(me: Member | null, id: string, voteId: string, data: ClubData): string | null {
  const found = proposalFor(me, id, data);
  if ('problem' in found) return found.problem;
  const p = found.p;
  if (!isNational(me!.id, data.positions)) return 'Only the NEC can approve a new chapter (12.1).';
  const vote = (data.votes ?? []).find((v) => v.id === voteId);
  if (!vote || !necVoteFits(vote, p.proposedAt, data)) {
    return 'Pick the NEC’s closed vote on it (12.1).';
  }
  if (vote.result !== 'carried') return null;
  if (nameTaken(p.name, data, p.id)) return NAME_TAKEN;
  const founders = foundersProblem(p.founderIds, p.presidentId, p.saaId, data);
  if (founders) return founders;
  const holdsChapterPost = p.founderIds.some((fid) =>
    activePositions(fid, data.positions).some((x) => x.chapterId !== null && !TITLE_ROLES.includes(x.role)),
  );
  if (holdsChapterPost) return 'Founders have to end their positions in their old chapter first.';
  return null;
}

export function withdrawChapterProblem(me: Member | null, id: string, data: ClubData): string | null {
  const found = proposalFor(me, id, data);
  if ('problem' in found) return found.problem;
  return isNational(me!.id, data.positions) || found.p.proposedBy === me!.id ? null : 'Only the NEC or whoever put it forward can withdraw it.';
}
