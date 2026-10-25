// The live database's club_business() read (snake_case JSON) as the app's meetings, action items
// and votes.

import type {
  ActionItem,
  AgendaItem,
  BallotChoice,
  Electorate,
  Meeting,
  MeetingKind,
  Tally,
  Threshold,
  Vote,
  VoteResult,
} from '../domain/types';

export interface BusinessJson {
  meetings: {
    id: string; chapter_id: string | null; kind: MeetingKind; title: string; starts_at: string; location: string | null;
    agenda: AgendaItem[] | null; minutes: string | null; minutes_shared_at?: string | null; minutes_approved_at: string | null;
    minutes_approved_by: string | null;
    cancelled_at: string | null; created_by: string | null;
  }[];
  action_items: {
    id: string; meeting_id: string | null; chapter_id: string | null; title: string; owner_id: string;
    due_on: string | null; done_on: string | null;
  }[];
  votes: {
    id: string; chapter_id: string | null; meeting_id: string | null; subject_member_id: string | null; question: string;
    details: string | null; electorate: Electorate; threshold: Threshold; secret: boolean; quorum: number;
    opened_at: string; closes_at: string; closed_at: string | null; result: VoteResult | null;
    casting_vote: 'yes' | 'no' | null; created_by: string | null; tally: Tally | null; elector_ids: string[];
    voted_ids: string[]; my_voted: boolean; ballots: { member_id: string | null; choice: BallotChoice }[];
  }[];
}

const instant = (ts: string) => new Date(ts).toISOString();
const maybeInstant = (ts: string | null) => (ts ? instant(ts) : null);

export function toBusiness(json: BusinessJson | null | undefined): { meetings: Meeting[]; actionItems: ActionItem[]; votes: Vote[] } {
  return {
    meetings: (json?.meetings ?? []).map((m) => ({
      id: m.id,
      chapterId: m.chapter_id,
      kind: m.kind,
      title: m.title,
      startsAt: instant(m.starts_at),
      location: m.location,
      agenda: (m.agenda ?? []).map((a) => ({ title: a.title, notes: a.notes ?? null })),
      minutes: m.minutes,
      minutesSharedAt: maybeInstant(m.minutes_shared_at ?? null),
      minutesApprovedAt: maybeInstant(m.minutes_approved_at),
      minutesApprovedBy: m.minutes_approved_by,
      cancelledAt: maybeInstant(m.cancelled_at),
      createdBy: m.created_by,
    })),
    actionItems: (json?.action_items ?? []).map((a) => ({
      id: a.id,
      meetingId: a.meeting_id,
      chapterId: a.chapter_id,
      title: a.title,
      ownerId: a.owner_id,
      dueOn: a.due_on,
      doneOn: a.done_on,
    })),
    votes: (json?.votes ?? []).map((v) => ({
      id: v.id,
      chapterId: v.chapter_id,
      meetingId: v.meeting_id,
      subjectMemberId: v.subject_member_id,
      question: v.question,
      details: v.details,
      electorate: v.electorate,
      threshold: v.threshold,
      secret: v.secret,
      quorum: v.quorum,
      openedAt: instant(v.opened_at),
      closesAt: instant(v.closes_at),
      closedAt: maybeInstant(v.closed_at),
      result: v.result,
      castingVote: v.casting_vote,
      tally: v.tally,
      electorIds: v.elector_ids ?? [],
      votedIds: v.voted_ids ?? [],
      ballots: (v.ballots ?? []).map((b) => ({ memberId: b.member_id, choice: b.choice })),
      createdBy: v.created_by,
    })),
  };
}
