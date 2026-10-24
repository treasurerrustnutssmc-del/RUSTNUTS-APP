// The Road Rules (constitution 7.10, 15.4): versions the NEC publishes, and members' yearly
// sign-offs. These are the rules the database's publish_road_rules and sign_road_rules actions
// apply, in the same order with the same words, so the app never offers what the server would refuse.

import { isNational } from './access';
import { charCount } from './chat';
import { byName } from './crew';
import { expiryState } from './dates';
import { melbourneDate } from './rides';
import { signedInProblem } from './routes';
import type { ClubData, Member, RoadRulesVersion } from './types';

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
  const { body, changes } = cleanRoadRules(input, data);
  if (body === '') return RULES_EMPTY;
  if (charCount(body) > MAX_RULES_TEXT) return RULES_TOO_LONG;
  if (charCount(changes) > MAX_RULES_CHANGES) return CHANGES_TOO_LONG;
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
  return data.members.filter((m) => m.approval === 'approved' && m.status !== 'legacy').sort(byName);
}

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
