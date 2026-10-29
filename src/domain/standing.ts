// Where a member stands on attendance (constitution v4): a Full Member needs 80% of the ordinary
// monthly Home Chapter meetings held while Full this club year and two applicable Big 4 rides
// (5.2, 5.11); a Nomad two of every three meetings and one Big 4 (5.7); an FNG half of the monthly
// meetings and half of the Big 4 rides held during their trial (4.6: the board's list, Jeff's pick
// of 29 Oct 2026; other rides and events don't count). Counts round up (2.4). Only activities someone opened a
// check-in for are "held"; an excused one drops out of that member's count. This only informs the
// board: a status change still needs the 5.5 process.

import { attended, excusedAway, meetingTypeOf } from './attendance';
import { appliesTo } from './big4';
import { agmOn, clubYearOf } from './clubYear';
import { melbourneDate } from './rides';
import type { CheckinSession, ClubData, Member } from './types';

export type StandingState = 'met' | 'to_go' | 'behind' | 'none';

export interface StandingLine {
  key: 'meetings' | 'big4';
  label: string;
  attended: number;
  /** Held so far and counted for them (for Big 4: those already ridden or missed). */
  held: number;
  needed: number;
  /** Big 4 rides still to come this year. */
  upcoming: number;
  state: StandingState;
}

export interface Standing {
  kind: 'full' | 'nomad' | 'fng';
  /** The first day that counts. */
  from: string;
  onHiatus: boolean;
  lines: StandingLine[];
}

/** Full and Nomad Big 4 lines count rides against a fixed number; every other line is a share of those held. */
export function isShareLine(standing: Standing, line: StandingLine): boolean {
  return line.key !== 'big4' || standing.kind === 'fng';
}

/** The smallest whole number that's at least num/den of held (2.4). */
export function atLeast(held: number, num: number, den: number): number {
  return Math.floor((held * num + den - 1) / den);
}

function countLine(
  key: StandingLine['key'], label: string, sessions: CheckinSession[], member: Member, data: ClubData, today: string, num: number, den: number,
): StandingLine {
  const counted = sessions.filter((s) => !excusedAway(s.id, member.id, data))
    // Today's, while it's still open, only counts for someone already checked in.
    .filter((s) => s.heldOn < today || s.closedAt || attended(s.id, member.id, data));
  const came = counted.filter((s) => attended(s.id, member.id, data)).length;
  const needed = atLeast(counted.length, num, den);
  const state: StandingState = counted.length === 0 ? 'none' : came >= needed ? 'met' : 'behind';
  return { key, label, attended: came, held: counted.length, needed, upcoming: 0, state };
}

function big4Line(member: Member, data: ClubData, from: string, yearEnd: string, today: string, cap: number): StandingLine {
  let came = 0;
  let missed = 0;
  let upcoming = 0;
  for (const b of data.big4Rides ?? []) {
    const ride = data.rides.find((r) => r.id === b.rideId);
    if (!ride || ride.cancelledAt || !appliesTo(b, member)) continue;
    const day = melbourneDate(ride.startsAt);
    if (day < from || day >= yearEnd) continue;
    const s = (data.checkinSessions ?? []).find((x) => x.rideId === ride.id);
    if (s && excusedAway(s.id, member.id, data)) continue;
    if (s && attended(s.id, member.id, data)) came++;
    else if (day >= today) upcoming++;
    else if (s) missed++;
    // A past Big 4 nobody opened check-in for can't be counted for or against anyone (5.11).
  }
  const needed = Math.min(cap, came + missed + upcoming);
  const state: StandingState = needed === 0 ? 'none' : came >= needed ? 'met' : came + upcoming >= needed ? 'to_go' : 'behind';
  return { key: 'big4', label: 'Big 4 rides', attended: came, held: came + missed, needed, upcoming, state };
}

export function standingOf(member: Member, data: ClubData, today: string): Standing | null {
  if (member.approval !== 'approved') return null;
  const sessions = (data.checkinSessions ?? []).filter((s) => s.heldOn <= today);
  const home = (s: CheckinSession) => s.chapterId === member.chapterId;

  if (member.status === 'full' || member.status === 'nomad') {
    const year = clubYearOf(today, data.agms);
    const start = agmOn(year, data.agms);
    const from = member.patchedOn && member.patchedOn > start ? member.patchedOn : start;
    const kind = member.status;
    if (member.onHiatus) return { kind, from, onHiatus: true, lines: [] };
    const ordinary = sessions.filter((s) => s.heldOn >= from && home(s) && meetingTypeOf(s) === 'ordinary');
    const nomad = kind === 'nomad';
    return {
      kind, from, onHiatus: false,
      lines: [
        nomad
          ? countLine('meetings', 'Meetings · two in three', ordinary, member, data, today, 2, 3)
          : countLine('meetings', 'Monthly meetings · 80%', ordinary, member, data, today, 4, 5),
        big4Line(member, data, from, agmOn(year + 1, data.agms), today, nomad ? 1 : 2),
      ],
    };
  }

  if (member.status === 'fng') {
    const from = member.fngStartedOn ?? member.joinedOn;
    if (!from) return null;
    if (member.onHiatus) return { kind: 'fng', from, onHiatus: true, lines: [] };
    const trial = sessions.filter((s) => s.heldOn >= from);
    const isBig4For = (rideId: string | null) => (data.big4Rides ?? []).some((b) =>
      b.rideId === rideId && appliesTo(b, member) && !data.rides.find((r) => r.id === rideId)?.cancelledAt);
    return {
      kind: 'fng', from, onHiatus: false,
      lines: [
        countLine('meetings', 'Monthly meetings · 50%', trial.filter((s) => home(s) && meetingTypeOf(s) === 'ordinary'), member, data, today, 1, 2),
        countLine('big4', 'Big 4 rides · 50%', trial.filter((s) => s.kind === 'ride' && isBig4For(s.rideId)), member, data, today, 1, 2),
      ],
    };
  }
  return null;
}
