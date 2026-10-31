// The Road Rules (constitution 7.10, 15.4): versions the NEC publishes, and members' yearly
// sign-offs. These are the rules the database's publish_road_rules and sign_road_rules actions
// apply, in the same order with the same words, so the app never offers what the server would refuse.

import { isBoardOf, isNational } from './access';
import { charCount } from './chat';
import { byName } from './crew';
import { expiryState, formatAuDate } from './dates';
import { lastDay, melbourneDate } from './rides';
import { routeChapterName, signedInProblem } from './routes';
import type { ClubData, Member, Ride, RoadRulesVersion, RsvpAnswer } from './types';

/** The longest the Road Rules text can be, in characters (code points). */
export const MAX_RULES_TEXT = 20000;
/** The longest What changed can be, in characters (code points). */
export const MAX_RULES_CHANGES = 500;

/** Refusals the screens and demo also show, in the database's words. */
export const NOT_PUBLISHER = 'Only the NEC can publish the Road Rules.';
export const PUBLISH_CONFLICT =
  'Someone else published a new version while you were editing. Your text isn’t saved: copy it, then open the Road Rules again.';
export const RULES_EMPTY = 'Write the Road Rules first.';
export const RULES_TOO_LONG = 'That’s too long (20000 characters at most).';
export const CHANGES_TOO_LONG = 'Keep what changed to 500 characters at most.';
export const NO_RULES = 'There are no Road Rules to sign yet.';
export const SIGN_OUTDATED = 'The Road Rules changed while you had them open. Read the new version, then sign.';
/** The Going gate: set_rsvp's refusal of Going, and set_crew's of an unsigned target. */
export const SIGN_FIRST = 'Sign the Road Rules first.';
export const CREW_NOT_SIGNED = 'They haven’t signed the Road Rules yet.';

/** Whether an error is one of the two refusals that mean a newer version of the Road Rules is waiting to be loaded. */
export function isRoadRulesVersionRefusal(e: unknown): boolean {
  return e instanceof Error && (e.message === PUBLISH_CONFLICT || e.message === SIGN_OUTDATED);
}

/** What a publisher types: the text, what changed, and whether everyone signs again. */
export interface RoadRulesInput {
  body: string;
  changes: string;
  fresh: boolean;
}

/** Where a member stands with the Road Rules on a given Melbourne date. */
export type RoadRulesState = 'none' | 'unsigned' | 'current' | 'due_soon' | 'expired';

export interface RoadRulesStatus {
  state: RoadRulesState;
  /** The last day the sign-off counts, as an ISO date. Null when no sign-off counts. */
  goodUntil: string | null;
  /** The version the counting sign-off was made on. Null when no sign-off counts. */
  signedVersion: number | null;
}

/** One block of the Road Rules text as the screen shows it. */
export interface RulesBlock {
  kind: 'heading' | 'bullet' | 'para';
  text: string;
}

/** The current version: the highest number. Undefined when nothing is published yet. */
export function currentRoadRules(data: ClubData): RoadRulesVersion | undefined {
  let current: RoadRulesVersion | undefined;
  for (const v of data.roadRules ?? []) if (!current || v.number > current.number) current = v;
  return current;
}

/** Version 1 always needed a fresh sign-off, whatever was stored. */
const needsFresh = (v: RoadRulesVersion): boolean => v.fresh || v.number === 1;

/**
 * The sign-off base: the newest version that needed a fresh sign-off. A sign-off on it or any
 * later version counts. Undefined when nothing is published yet.
 */
export function signoffBase(data: ClubData): RoadRulesVersion | undefined {
  let base: RoadRulesVersion | undefined;
  for (const v of data.roadRules ?? []) if (needsFresh(v) && (!base || v.number > base.number)) base = v;
  return base;
}

/** Who publishes the Road Rules: an approved member of the NEC (`isNational`). */
export function publishesRoadRules(me: Member | null, data: ClubData): boolean {
  return !!me && me.approval === 'approved' && isNational(me.id, data.positions);
}

/**
 * The version as it is saved: both texts trimmed, and fresh forced on for version 1 (when
 * nothing is published yet), whatever was asked.
 */
export function cleanRoadRules(input: RoadRulesInput, data: ClubData): RoadRulesInput {
  return {
    body: input.body.trim(),
    changes: input.changes.trim(),
    fresh: input.fresh || !currentRoadRules(data),
  };
}

/**
 * Why `me` can't publish this version, or null when they can. Mirrors public.publish_road_rules.
 * `seen` is the current version number the editor opened on (0 when there were none): a publish
 * on top of someone else's newer version is refused, so it never quietly replaces it.
 */
export function publishProblem(me: Member | null, input: RoadRulesInput, seen: number, data: ClubData): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!publishesRoadRules(me, data)) return NOT_PUBLISHER;
  if ((currentRoadRules(data)?.number ?? 0) !== seen) return PUBLISH_CONFLICT;
  return draftProblem(input);
}

/**
 * What's wrong with the text itself, or null: the last three publish checks, in their order
 * (empty, too long, what changed too long). The Publish screen shows it as you type.
 */
export function draftProblem(input: RoadRulesInput): string | null {
  const body = input.body.trim();
  if (body === '') return RULES_EMPTY;
  if (charCount(body) > MAX_RULES_TEXT) return RULES_TOO_LONG;
  if (charCount(input.changes.trim()) > MAX_RULES_CHANGES) return CHANGES_TOO_LONG;
  return null;
}

/**
 * Why `me` can't sign this version, or null when they can. Mirrors public.sign_road_rules.
 * `version` is the number on screen: signing an older one is refused, so a sign-off always means
 * the current text. Signing again while signed is fine: it moves the date on.
 */
export function signProblem(me: Member | null, version: number, data: ClubData): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  const current = currentRoadRules(data);
  if (!current) return NO_RULES;
  if (version !== current.number) return SIGN_OUTDATED;
  return null;
}

// ---------------------------------------------------------------------------
// The version a screen has open
// ---------------------------------------------------------------------------

/** The Road Rules screen's notice when a newer version is published while it's open. */
export const RULES_UPDATED = 'A new version was published while you had this open.';

/** The notice's button: "Read version 3". */
export const readVersionLabel = (n: number): string => `Read version ${n}`;

/**
 * What the Road Rules screen pinned: the number it shows (`shown`), and the current number when
 * it opened or last moved on (`openedOn`, 0 when nothing was published). Shown below openedOn is
 * an older version, read-only.
 */
export interface RoadRulesPin {
  shown: number;
  openedOn: number;
}

/** The pin when the screen opens: the version asked for if it's there, otherwise the current one. */
export function openRoadRules(asked: number | undefined, data: ClubData): RoadRulesPin {
  const current = currentRoadRules(data)?.number ?? 0;
  const there = asked !== undefined && (data.roadRules ?? []).some((v) => v.number === asked);
  return { shown: there ? asked : current, openedOn: current };
}

/**
 * What the Road Rules screen shows: the pinned version, not whatever is current now, so the text
 * never changes under a reader and Sign always sends the version read. A version published since
 * comes back as `newer`, for the screen to offer (an older-version view offers nothing: it stays
 * read-only).
 * - Opened with nothing published, or the pinned version missing: the current one is pinned.
 * - Published by `meId` (the publisher back from Publish): taken without asking.
 * The screen keeps `pin` each time; it is the same object when nothing moved.
 */
export function pinnedRoadRules(
  pin: RoadRulesPin,
  data: ClubData,
  meId: string | null,
): { pin: RoadRulesPin; version: RoadRulesVersion | undefined; older: boolean; newer: RoadRulesVersion | null } {
  const current = currentRoadRules(data);
  if (!current) return { pin, version: undefined, older: false, newer: null };
  const latest = { pin: { shown: current.number, openedOn: current.number }, version: current, older: false, newer: null };
  const pinned = (data.roadRules ?? []).find((v) => v.number === pin.shown);
  if (pin.openedOn === 0 || !pinned) return latest;
  const older = pin.shown < pin.openedOn;
  if (older || current.number <= pin.shown) return { pin, version: pinned, older, newer: null };
  if (meId !== null && current.publishedBy === meId) return latest;
  return { pin, version: pinned, older: false, newer: current };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The last day a sign-off counts: the same Melbourne date one year after signing, as an ISO
 * date. A sign-off on 29 February is good until 28 February.
 */
export function goodUntil(signedAt: string): string {
  const [y, m, d] = melbourneDate(signedAt).split('-').map(Number);
  return `${y + 1}-${pad(m)}-${pad(m === 2 && d === 29 ? 28 : d)}`;
}

/**
 * Where `member` stands at the Melbourne date `today`: 'none' (nothing to sign yet), 'unsigned'
 * (no sign-off since the base), 'current', 'due_soon' (30 days or fewer left, including the
 * good-until day itself) or 'expired' (signed since the base, but more than 12 months ago).
 */
export function roadRulesStatus(member: Member, data: ClubData, today: string): RoadRulesStatus {
  const base = signoffBase(data);
  if (!base) return { state: 'none', goodUntil: null, signedVersion: null };
  const mine = (data.roadRulesSignoffs ?? []).find((s) => s.memberId === member.id);
  if (!mine || mine.version < base.number) return { state: 'unsigned', goodUntil: null, signedVersion: null };
  const until = goodUntil(mine.signedAt);
  const expiry = expiryState(until, today);
  const state = expiry === 'expired' ? 'expired' : expiry === 'soon' ? 'due_soon' : 'current';
  return { state, goodUntil: until, signedVersion: mine.version };
}

/** Who's asked to sign, in name order: every approved member except Legacy (riders, pillions and support alike). */
export function askedToSign(data: ClubData): Member[] {
  return data.members.filter(isAsked).sort(byName);
}

const isAsked = (m: Member): boolean => m.approval === 'approved' && m.status !== 'legacy' && m.status !== 'family';

/**
 * The Who's signed lists for `members` (the caller picks the chapter), each in name order: Not
 * signed (unsigned or expired), Due soon, and Signed. Anyone not asked to sign is left out.
 * With nothing published yet there's nothing to sign, so all three are empty.
 */
export function signoffGroups(
  members: Member[],
  data: ClubData,
  today: string,
): { notSigned: Member[]; dueSoon: Member[]; signed: Member[] } {
  const groups = { notSigned: [] as Member[], dueSoon: [] as Member[], signed: [] as Member[] };
  if (!currentRoadRules(data)) return groups;
  const asked = new Set(askedToSign(data).map((m) => m.id));
  for (const m of members) {
    if (!asked.has(m.id)) continue;
    const { state } = roadRulesStatus(m, data, today);
    if (state === 'current') groups.signed.push(m);
    else if (state === 'due_soon') groups.dueSoon.push(m);
    else groups.notSigned.push(m);
  }
  groups.notSigned.sort(byName);
  groups.dueSoon.sort(byName);
  groups.signed.sort(byName);
  return groups;
}

/**
 * The Road Rules text as blocks for the screen. At the start of a line, `# ` makes a heading and
 * `- ` a bullet. Other lines run together into one paragraph, joined with a space, until a blank
 * line, heading or bullet ends it. Nothing else is formatted, and empty blocks are dropped.
 */
export function rulesBlocks(body: string): RulesBlock[] {
  const blocks: RulesBlock[] = [];
  let para: string[] = [];
  const push = (kind: RulesBlock['kind'], text: string) => {
    if (text !== '') blocks.push({ kind, text });
  };
  const endPara = () => {
    push('para', para.join(' '));
    para = [];
  };
  for (const raw of body.split(/\r\n|\r|\n/)) {
    const line = raw.trimEnd();
    // A marker with only spaces after it is trimmed down to the bare marker: an empty block.
    const marker = line === '#' || line.startsWith('# ') ? 'heading' : line === '-' || line.startsWith('- ') ? 'bullet' : null;
    if (marker) {
      endPara();
      push(marker, line.slice(1).trim());
    } else if (line === '') {
      endPara();
    } else {
      para.push(line.trim());
    }
  }
  endPara();
  return blocks;
}

// ---------------------------------------------------------------------------
// What the screens show
// ---------------------------------------------------------------------------

/** Unsigned or expired: the states the ride screen nudges and the briefing card lists. */
export const needsSigning = (state: RoadRulesState): boolean => state === 'unsigned' || state === 'expired';

/** Whether `member` is one of the members askedToSign covers (so not Legacy, and not an applicant). */
export function asksToSign(member: Member | null): boolean {
  return !!member && isAsked(member);
}

/**
 * The Going gate: whether `member` must sign the Road Rules before saying Going or being put on a
 * crew. That's someone who's asked to sign (approved, not Legacy) and is unsigned or expired at the
 * Melbourne date `today`. Due soon still counts as signed, and with nothing published nobody is
 * stopped. The database's set_rsvp and set_crew use private.road_rules_signed the same way.
 */
export function mustSignFirst(member: Member | null, data: ClubData, today: string): boolean {
  return !!member && asksToSign(member) && needsSigning(roadRulesStatus(member, data, today).state);
}

/**
 * Why `me` can't give this answer for the Road Rules, or null. Only Going is gated: Maybe and
 * Can't make it always work. set_rsvp checks it after rsvpProblem's checks, so callers do too.
 */
export function goingProblem(me: Member | null, answer: RsvpAnswer, data: ClubData, today: string): string | null {
  return answer === 'going' && mustSignFirst(me, data, today) ? SIGN_FIRST : null;
}

/**
 * The words of the ride screen's Going gate prompt for `mine`, your answer to the ride. With no
 * answer, Maybe or Can't make it, it asks you to sign to say Going. When a Going from before the
 * sign-off lapsed still stands, it asks you to sign before you ride, and says changing your answer
 * turns Going off until you sign. An expired sign-off adds when it ran out.
 */
export function signToGoText(status: RoadRulesStatus, mine: RsvpAnswer | null): { lead: string; notes: string[] } {
  const notes: string[] = [];
  if (status.state === 'expired') notes.push(`Your sign-off ran out on ${formatAuDate(status.goodUntil)}.`);
  if (mine === 'going') {
    notes.push('If you change your answer, Going stays off until you sign.');
    return { lead: 'Sign the Road Rules before you ride.', notes };
  }
  return { lead: 'Sign the Road Rules to say Going.', notes };
}

/**
 * The ride screen's "Sign the Road Rules before you ride": for a member who's asked to sign and
 * is unsigned or expired, on a ride that isn't cancelled and whose last day isn't over.
 */
export function showsRoadRulesNudge(me: Member | null, ride: Ride, data: ClubData, today: string): boolean {
  if (!me || !asksToSign(me)) return false;
  if (ride.cancelledAt || lastDay(ride) < today) return false;
  return needsSigning(roadRulesStatus(me, data, today).state);
}

/** The briefing card's "Road Rules not signed": the ride's Going riders who are unsigned or expired, by name. */
export function unsignedGoing(ride: Ride, data: ClubData, today: string): Member[] {
  const going = new Set(data.rsvps.filter((r) => r.rideId === ride.id && r.answer === 'going').map((r) => r.memberId));
  return data.members
    .filter((m) => going.has(m.id) && asksToSign(m) && needsSigning(roadRulesStatus(m, data, today).state))
    .sort(byName);
}

/**
 * The Who's signed chapter choices for `me`, in name order (North, then West, as the live app loads
 * them), with null for Whole club. The NEC gets every chapter and Whole club; any other board member only the
 * chapters they hold a board seat in. Empty for everyone else, who doesn't see the list.
 */
export function signoffChapters(me: Member | null, data: ClubData): (string | null)[] {
  if (!me || me.approval !== 'approved') return [];
  const chapters = [...data.chapters].sort((a, b) => a.name.localeCompare(b.name));
  if (isNational(me.id, data.positions)) return [...chapters.map((c) => c.id), null];
  return chapters.filter((c) => isBoardOf(me, c.id, data.positions)).map((c) => c.id);
}

/** The chapter Who's signed opens on: your own when you can see it, otherwise your first choice. */
export function signoffStart(me: Member | null, data: ClubData): string | null | undefined {
  const options = signoffChapters(me, data);
  return me && options.includes(me.chapterId) ? me.chapterId : options[0];
}

/**
 * "2 of 10 signed · West": the Who's signed count for the chapter that screen opens on, for the
 * links to it. "Nothing to sign yet" before anything is published; null for anyone who can't open it.
 */
export function signoffSummary(me: Member | null, data: ClubData, today: string): string | null {
  const start = signoffStart(me, data);
  if (start === undefined) return null;
  if (!currentRoadRules(data)) return 'Nothing to sign yet';
  return `${signedCountLine(signoffGroups(signoffMembers(start, data), data, today))} · ${routeChapterName(start, data)}`;
}

/** The members a Who's signed choice covers: one chapter, or everyone for Whole club (null). */
export function signoffMembers(chapterId: string | null, data: ClubData): Member[] {
  return chapterId === null ? data.members : data.members.filter((m) => m.chapterId === chapterId);
}

/** "18 of 23 signed": due soon still counts as signed. */
export function signedCountLine(groups: ReturnType<typeof signoffGroups>): string {
  const signed = groups.signed.length + groups.dueSoon.length;
  return `${signed} of ${signed + groups.notSigned.length} signed`;
}

/**
 * One Who's signed row: "Good until DD/MM/YYYY", "Ran out DD/MM/YYYY", "Never signed", or
 * "Signed an older version" for a sign-off from before a version that needed everyone again.
 */
export function signoffLine(member: Member, data: ClubData, today: string): string {
  const status = roadRulesStatus(member, data, today);
  if (status.state === 'current' || status.state === 'due_soon') return `Good until ${formatAuDate(status.goodUntil)}`;
  if (status.state === 'expired') return `Ran out ${formatAuDate(status.goodUntil)}`;
  const any = (data.roadRulesSignoffs ?? []).some((s) => s.memberId === member.id);
  return any ? 'Signed an older version' : 'Never signed';
}

/** The Me row's line, and its colour. */
export function myRoadRulesLine(status: RoadRulesStatus): { text: string; tone: 'ok' | 'warn' | 'danger' | null } {
  switch (status.state) {
    case 'current':
      return { text: `Signed until ${formatAuDate(status.goodUntil)}`, tone: 'ok' };
    case 'due_soon':
      return { text: `Due ${formatAuDate(status.goodUntil)}`, tone: 'warn' };
    case 'none':
      return { text: 'Nothing to sign yet', tone: null };
    default:
      return { text: 'Not signed', tone: 'danger' };
  }
}

/**
 * Home's Road Rules row, for every approved member (Legacy too: they read, they just don't sign).
 * With nothing published it opens the illustrated draft, so there's always something to read;
 * once the NEC publishes, it shows your sign-off line and opens the Road Rules screen. Null for
 * anyone signed out or not approved.
 */
export function homeRoadRulesRow(
  me: Member | null,
  data: ClubData,
  today: string,
): { text: string; tone: 'ok' | 'warn' | 'danger' | null; opens: 'rules' | 'guide' } | null {
  if (!me || me.approval !== 'approved') return null;
  const current = currentRoadRules(data);
  if (!current) return { text: 'Read the illustrated draft', tone: null, opens: 'guide' };
  if (!asksToSign(me)) return { text: `Version ${current.number}`, tone: null, opens: 'rules' };
  return { ...myRoadRulesLine(roadRulesStatus(me, data, today)), opens: 'rules' };
}

/**
 * The sign box's line once you've signed: "Signed on DD/MM/YYYY. Good until DD/MM/YYYY.", or
 * "Ran out DD/MM/YYYY." once it has expired. Null when no sign-off counts.
 */
export function signBoxLine(status: RoadRulesStatus, signedAt: string | null): string | null {
  if (!signedAt || !status.goodUntil || (status.state !== 'current' && status.state !== 'due_soon' && status.state !== 'expired')) return null;
  const until = status.state === 'expired' ? `Ran out ${formatAuDate(status.goodUntil)}.` : `Good until ${formatAuDate(status.goodUntil)}.`;
  return `Signed on ${formatAuDate(melbourneDate(signedAt))}. ${until}`;
}
